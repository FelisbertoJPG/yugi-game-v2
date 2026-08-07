# Mecanismo do Instalador / Auto-Updater — "neurônio" para reaproveitar

Documento de referência de COMO o instalador do Souls Craft funciona, escrito para ser
reaproveitado em outro app. Descreve a arquitetura de forma genérica (não presa ao Minecraft),
com os pontos exatos onde o código real está, para você copiar a **ideia** e adaptar os nomes.

> Origem: `C:\Users\Mestre\Desktop\mine\souls2-installer\` — .NET 8 + WinForms + WebView2,
> publicado como `.exe` single-file self-contained (win-x64). Molde original: engenharia reversa
> do PokeDOG Installer.

---

## 1. A ideia em uma frase

**Um servidor de arquivos "burro" (GitHub Releases) + um manifesto que descreve o estado desejado
+ um cliente que calcula a diferença (diff) entre o disco local e o manifesto, e baixa só o que
falta.** O manifesto é a *fonte da verdade*; tudo o mais é consequência.

É o mesmo princípio de um `rsync` ou de um gerenciador de pacotes, reduzido ao mínimo:

```
             ┌────────────────────────┐
             │  GitHub Release (tag)  │   ← você publica aqui
             │  ─ manifest.json       │
             │  ─ arquivo_a.bin       │
             │  ─ arquivo_b.jar       │
             │  ─ payload.zip         │
             │  ─ MeuApp.exe          │  (para auto-update do próprio instalador)
             └───────────┬────────────┘
                         │ HTTPS (API + token, se repo privado)
                         ▼
   ┌─────────────────────────────────────────────────┐
   │  Instalador (.exe no PC do usuário)              │
   │  1. baixa manifest.json                          │
   │  2. para cada arquivo: compara size+sha256       │
   │     local × manifesto  → lista "a baixar"        │
   │  3. baixa só os diferentes/faltando              │
   │  4. verifica sha256 de cada download             │
   │  5. troca (com backup do antigo)                 │
   └─────────────────────────────────────────────────┘
```

---

## 2. Os 5 conceitos que fazem tudo funcionar

### 2.1. Manifesto = estado desejado (a fonte da verdade)
Um único JSON que lista **cada arquivo que deveria existir**, com seu `sha256` e `size`. O cliente
nunca "adivinha" — ele compara o disco com o manifesto. Quem publica uma versão nova só precisa
regenerar o manifesto e subir os arquivos que mudaram.

Arquivo real: [`Manifest.cs`](./Manifest.cs). Schema (simplificado, renomeie à vontade):

```jsonc
{
  "packVersion": "app-20260711",       // rótulo humano da versão do conteúdo
  "displayName": "Meu App",

  "installer": {                        // metadados do PRÓPRIO instalador (auto-update)
    "version": "0.2.0",
    "asset":   "MeuApp-Installer.exe",  // nome do asset no Release
    "sha256":  "…",
    "size":    72000000
  },

  "managedRoots": [                     // pastas que o instalador "governa"
    { "path": "mods",   "removeMode": "backup" },
    { "path": "config", "removeMode": "keep"   }
  ],

  "files": [                            // arquivos individuais versionados
    {
      "path":   "mods/meucore-1.0.0.jar",   // relativo à raiz da instância
      "sha256": "abc123…",
      "size":   1048576,
      "asset":  "meucore-1.0.0.jar",         // nome do asset no Release (repo privado)
      "url":    "",                          // OU uma URL http/https/file direta
      "policy": "required"
    }
  ],

  "payload": {                          // opcional: um .zip para conteúdo com MUITOS arquivos
    "version": "content-c3361d0f1203", // se == ao marcador salvo no disco, NÃO re-baixa
    "asset":   "app-content.zip",
    "sha256":  "…",
    "size":    123000000,
    "roots":   ["resourcepacks", "assets"]  // pastas que o zip preenche
  }
}
```

**Regra de ouro:** `files[]` para poucas coisas que mudam individualmente (ex.: os `.jar` do
seu app); `payload` (um zip) para diretórios com **milhares** de arquivos (listar 34 mil arquivos
1-a-1 no manifesto é inviável — vira um zip só, versionado por um marcador).

### 2.2. Diff por conteúdo (`size` + `sha256`), NUNCA por data
Datas de modificação mentem (cópia, backup, fuso). O diff compara:

1. arquivo local existe? não → **baixar**;
2. `size` bate? não → **baixar** (barato, evita hashear);
3. `sha256` bate? não → **baixar**; sim → **em dia**.

Arquivo real: `BuildPlan()` em [`InstallerEngine.cs`](./InstallerEngine.cs) (linhas ~92–149).
O resultado é um `InstallPlan` com quatro tipos de ação: `UpToDate`, `Download`, `BackupOrphan`,
`DeleteOrphan`.

### 2.3. Cache de hash — a joia técnica
Hashear centenas de MB a cada abertura seria lento. O cache guarda `sha256` chaveado por
**`(caminho | tamanho | mtime)`**: se os três baterem, reusa o hash salvo; só recomputa o que
mudou. Persistido como TSV (uma linha por arquivo).

Arquivo real: [`HashCache.cs`](./HashCache.cs). O coração:

```csharp
private static string KeyFor(FileInfo fi)
    => $"{fi.FullName}|{fi.Length}|{fi.LastWriteTimeUtc.Ticks}";

public string Sha256(string path) {
    var fi = new FileInfo(path);
    string key = KeyFor(fi);
    if (_map.TryGetValue(key, out var cached)) return cached; // hit → não re-hasheia
    string hash = ComputeSha256(path);
    _map[key] = hash; _dirty = true;
    return hash;
}
```

> Sem esse cache, o app fica lento proporcional ao tamanho total. **Copie esse arquivo quase
> inteiro** — é agnóstico.

### 2.4. Nunca apaga sem backup
Arquivos "órfãos" (existem no disco, dentro de uma pasta gerenciada, mas não no manifesto) são
**movidos para `.<app>-backups/<data-hora>/`**, não apagados. Cada `managedRoot` tem um
`removeMode`:

- `"keep"` — não mexe em órfãos (mais seguro; use no começo);
- `"backup"` — move para a pasta de backup (**default**);
- `"delete"` — apaga de fato (só se você confia).

Downloads que substituem um arquivo existente também **movem o antigo para o backup** antes de
trocar. Isso torna toda operação reversível. (No projeto original, o "delete abrupto" foi
vetado de propósito.)

### 2.5. Segurança de extração (zip-slip)
Todo caminho vindo do manifesto/zip passa por `SafeCombine()`, que resolve o caminho absoluto e
**exige que ele fique dentro da raiz da instância**. Sem isso, um zip malicioso com
`../../Windows/System32/...` escaparia. Vale para `files[]` e para a extração do payload.

```csharp
private static string SafeCombine(string baseDir, string rel) {
    string full = Path.GetFullPath(Path.Combine(baseDir, rel));
    string root = Path.GetFullPath(baseDir);
    if (!full.StartsWith(root + Path.DirectorySeparatorChar, …) && !full.Equals(root, …))
        throw new InvalidOperationException($"Caminho inseguro no manifesto: {rel}");
    return full;
}
```

---

## 3. O ciclo completo de uma execução

```
LoadManifestAsync()   remoto (URL/API) → cache local → fallback embutido no exe
        │             (sempre tem um plano B: offline não trava)
        ▼
BuildPlan()           diff size+sha256 → InstallPlan { Download[], Orphans[], PayloadNeeded }
        │
        ▼
ApplyAsync()          1) baixa cada arquivo → .part
                      2) confere sha256 (se falhar, aborta e não instala)
                      3) se destino existe → move p/ backup → move .part p/ destino
                      4) órfãos → backup (ou delete/keep)
                      5) payload: baixa zip → confere sha256 → backup das pastas → extrai (zip-slip)
                                  → grava marcador de versão
                      6) salva o cache de hash
```

Arquivo real: `LoadManifestAsync`, `BuildPlan`, `ApplyAsync` em
[`InstallerEngine.cs`](./InstallerEngine.cs).

**Progresso:** a engine reporta via `Action<Progress>` (`Progress(stage, detail, fraction)`), o
que desacopla o núcleo da UI. Qualquer front-end (WinForms, console, web) só assina esse callback.

---

## 4. Distribuir de repo PRIVADO (o pulo do gato do token)

Se o repo é **público**, `browser_download_url` funciona e você nem precisa de token. Se é
**privado** (foi o caso aqui, por causa de licença de arquivos de terceiros), há duas armadilhas:

1. **NÃO use `browser_download_url`** (`github.com/.../releases/download/...`) — em repo privado
   ela ignora o token e dá 404. Use o **endpoint da API do asset**:
   `GET https://api.github.com/repos/{owner}/{repo}/releases/assets/{id}` com o header
   **`Accept: application/octet-stream`** (sem esse Accept, vem o JSON de metadados, não o binário).

2. **O redirect para o CDN.** O HttpClient tira o header `Authorization` automaticamente no
   redirect cross-host (da `api.github.com` para o CDN de download) — isso é o comportamento
   **correto e seguro** (não vaza seu token pro CDN). Não force o auth no redirect.

Fluxo de resolução de assets (arquivo real: [`GitHubReleases.cs`](./GitHubReleases.cs)):

```csharp
// GET /releases/latest  (ou /releases/tags/{tag}) → mapeia nome_do_asset → { id, size, apiUrl }
var gh = await GitHubReleases.LoadAsync(owner, repo, tag, http);
// depois, para baixar, resolve o "asset" do manifesto para a apiUrl e manda Accept: octet-stream
```

O `HttpClient` é criado uma vez com os headers default (arquivo real: `GitHubReleases.NewHttp`):

```csharp
h.DefaultRequestHeaders.UserAgent.ParseAdd("MeuApp-Installer/0.1"); // GitHub exige User-Agent
h.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
h.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
h.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
```

### O token embutido — riscos e mitigação
- O token vai **embutido no exe** (`BuildConfig.cs`) e **é extraível** por qualquer um com o
  binário. Aceite isso e **limite o dano**:
  - **PAT fine-grained, `Contents: Read-only`, escopado SÓ no repo de distribuição.** O pior caso
    é alguém baixar o que já ia distribuir de graça.
  - Teste a escuridão: `PUT /contents` tem que dar **403** (prova real do read-only). O campo
    `permissions.admin` do `GET /repos` **engana** (reflete o papel do dono, não o poder do token).
- **Expiração:** PAT fine-grained expira (o de teste original expirava em 30 dias). Para
  distribuir de verdade, use validade longa (até 1 ano) e lembre de rotacionar. **Nunca embuta
  um token amplo** (ex.: o `gho_…` do `gh` CLI tem escopo `repo`/`workflow` — largo demais).
- **Mantenha o `BuildConfig.cs` fora do git** (no projeto original, o instalador não é um repo,
  então o token nunca foi commitado). Se seu projeto for versionado, ponha o token num arquivo
  ignorado ou injete no build via variável de ambiente / secret de CI.

> Alternativas ao token embutido, se um dia quiser subir o nível: repo público (sem token);
> um proxy/servidor próprio que assina URLs temporárias; ou um device-flow OAuth (usuário loga).
> Para um instalador de modpack entre amigos, o PAT read-only escopado é o ponto ótimo de esforço.

---

## 5. Payload .zip (conteúdo com milhares de arquivos)

Para diretórios enormes (no caso, `resourcepacks/` com ~34 mil arquivos, 123 MB), listar
arquivo-a-arquivo é inviável. Solução:

- Empacota tudo num `payload.zip` (asset único do Release).
- O manifesto guarda a **versão do payload** (ex.: `content-<sha256[:12]>`).
- No disco fica um **marcador** (`.<app>/payload.version`). Se o marcador == versão do manifesto,
  **não re-baixa** (evita puxar 123 MB por um ajuste de config).
- As pastas do payload (`roots`) são **puladas na varredura de órfãos** (senão os 34k arquivos
  apareceriam todos como "órfãos"), e são movidas para backup em bloco antes de extrair a nova.

> **Lição de design não-resolvida no original:** hoje `resourcepacks` + `config` + tudo mais vão
> no MESMO zip. Um ajuste de 1 KB no config obriga a re-baixar 123 MB. **No seu app, separe
> payloads por volatilidade**: um zip para o conteúdo pesado e estável, `files[]` (ou um zip
> pequeno separado) para o que muda com frequência.

---

## 6. Auto-update do PRÓPRIO instalador

O Windows não deixa sobrescrever um `.exe` em execução. O truque (arquivo real:
[`SelfUpdater.cs`](./SelfUpdater.cs)):

1. Compara `manifest.installer.version` com a `InstallerVersion` compilada no exe.
2. Se houver versão nova + asset dela no Release → baixa para `MeuApp.exe.new`, confere sha256.
3. Escreve um `.bat` no `%TEMP%` que:
   - espera o PID atual encerrar (`tasklist /fi "PID eq …"` num loop);
   - `copy /y MeuApp.exe.new MeuApp.exe`;
   - `start "" MeuApp.exe` (reabre) e se autodeleta (`del "%~f0"`).
4. O app encerra; o `.bat` faz a troca e reabre a versão nova.

Isso costuma rodar numa **splash screen** de boot (arquivo real: `SplashForm.cs` + `Program.cs`
`BootContext`): abre → checa/atualiza (com timeout, offline não trava) → fecha → abre a janela
principal.

---

## 7. Robustez / cantos que já custaram caro

Coisas que quebraram no original e você vai querer já prevenir:

- **GitHub renomeia assets:** troca espaços/especiais por `.` no nome do asset do Release
  (`Extra Armor.jar` → `Extra.Armor.jar`). Isso quebra o match manifesto→asset. **Fix nas duas
  pontas:** o gerador escreve o campo `asset` já sanitizado (`[^A-Za-z0-9._-]` → `.`), mas mantém
  o `path` com o nome real (pra instalar no lugar certo); e o resolvedor tenta o nome exato **e**
  o sanitizado. Ver `GitHubReleases.SafeAssetName` e `ResolveUrl`.
- **Fallback em cadeia do manifesto:** remoto → cache local → embutido no exe. Offline nunca deve
  travar o app; sempre há um plano B.
- **Verificar sha256 DEPOIS de baixar, ANTES de instalar.** Download corrompido/cortado é comum;
  se o hash não bate, apaga o `.part` e aborta — o arquivo bom antigo continua intacto.
- **`.NET` single-file self-contained:** o usuário não instala runtime nenhum. No `csproj`,
  ative `PublishSingleFile`/`SelfContained`/`RuntimeIdentifier` só no `Release`.
- **WebView2 (se usar UI HTML):** o runtime já vem no Windows 10/11 (Evergreen). Sirva a UI e os
  assets **inline / via `SetVirtualHostNameToFolderMapping`**, nunca de CDN (offline + confiança).
- **`app.manifest`:** mantenha MÍNIMO (`asInvoker` + compat Win10/11). NÃO ponha
  `<assemblyIdentity>` nem bloco de DPI ali — causou erro "side-by-side incorreta" (SxS) que
  impedia o exe de abrir. DPI resolve-se por código (`Application.SetHighDpiMode`).
- **Encoding do manifesto:** cuidado com BOM em UTF-8 (o `Set-Content` do PowerShell adiciona
  BOM). Ou grave sem BOM (`UTF8Encoding($false)`), ou faça o parser tolerar (o `Manifest.Parse`
  do original dá `TrimStart` no BOM).

---

## 8. O outro lado: publicar uma versão

O que gera o manifesto e sobe o Release (no original, `tools/publish-release.ps1`):

1. Varre as pastas do pack; para `files[]`, calcula `sha256`+`size` de cada arquivo.
2. Zipa o conteúdo pesado num `payload.zip`; calcula seu `sha256`; define
   `payload.version = "content-" + sha256[:12]`.
3. Escreve `manifest.json` (sem BOM).
4. **Dry-run por padrão** (gera os artefatos localmente, não publica). Com uma flag `-Publish`,
   cria o Release via `gh` CLI e sobe os assets (jars + zip + manifest + o próprio exe do
   instalador, se for shipar auto-update).

Para lançar uma atualização do instalador: bump da `InstallerVersion` no `BuildConfig` → publish
Release → incluir o exe novo como asset → instaladores antigos se auto-atualizam via §6.

> **Validação sem depender da rede:** o original tem modos headless (`--selftest`, `--checkpack`,
> `--checkremote`) que exercitam a engine inteira usando `file://` para simular um Release local.
> Vale a pena replicar: um teste que monta um "Release falso" no disco e roda
> load→plan→apply→re-scan pega 90% das regressões sem publicar nada.

---

## 9. Checklist para portar isto ao seu outro app

1. [ ] Defina a **raiz da instância** (a pasta que o app governa) e os `managedRoots`.
2. [ ] Copie **quase inteiros**: `HashCache.cs`, `SafeCombine`/`ExtractZipSafe`, o loop de
       `BuildPlan`/`ApplyAsync`. São agnósticos.
3. [ ] Adapte o **schema do manifesto** aos seus arquivos (renomeie `packVersion` etc.).
4. [ ] Decida **público vs privado**. Privado → PAT fine-grained read-only + API de asset +
       `Accept: octet-stream` (§4). Público → só a URL direta.
5. [ ] Separe **payload pesado** de **arquivos voláteis** para não re-baixar tudo por um ajuste.
6. [ ] Escreva o **gerador de manifesto** (script) com dry-run + flag de publish.
7. [ ] Adicione **self-update** (§6) se o instalador for na mão de outras pessoas.
8. [ ] Escreva um **self-test headless** com `file://` antes de depender do GitHub real.
9. [ ] `managedRoots` começa em `"keep"`; só ligue `"backup"` quando confiar no diff.

---

## Mapa de arquivos (referência rápida)

| Arquivo | Papel |
|---|---|
| `Manifest.cs` | Modelo do manifesto (o "estado desejado"). |
| `InstallerEngine.cs` | Núcleo: load manifesto, diff, apply, backup, zip-slip, payload. |
| `HashCache.cs` | Cache `(path\|size\|mtime)→sha256`. Copiar. |
| `GitHubReleases.cs` | Resolve assets de Release privado via API + token. |
| `BuildConfig.cs` | Consts de build: owner/repo/tag/token/versão. (Token fora do git.) |
| `SelfUpdater.cs` | Auto-update do próprio exe (`.new` + `.bat` de troca). |
| `SplashForm.cs` / `Program.cs` | Boot: splash → checa update → abre a janela. |
| `MainForm.cs` / `ui/index.html` | UI (WebView2 + HTML inline); ponte host↔JS. |
| `AppPaths.cs` | Onde ficam instância, cache e backups. |
| `SelfTest.cs` | Modos headless (`--selftest`/`--checkpack`/`--checkremote`). |
| `tools/publish-release.ps1` | Gera manifesto + zip e publica o Release. |
```
