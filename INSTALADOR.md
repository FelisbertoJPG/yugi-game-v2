# Instalador / Auto-Updater do Classic Duels — plano de implementação

Adaptação do mecanismo descrito em [`MECANISMO-INSTALADOR.md`](./MECANISMO-INSTALADOR.md)
(origem: instalador do Souls Craft) para **este** projeto. Aquele documento é o "neurônio"
genérico; este é a versão presa aos nossos arquivos, com as decisões já tomadas e a ordem
exata dos passos.

> **Decisões travadas:** hospedagem em **repositório GitHub privado** com PAT fine-grained
> `Contents: Read-only` embutido no exe (§4 do documento de origem). Motivo: o `cards.cdb` e
> os ~21 mil scripts Lua vêm do ocgcore/EDOPro e não vamos redistribuí-los num repo público.

---

## 1. O ponto de partida: metade já existe

`duel-server/src/Payload.cs` já implementa, sem saber, quatro dos cinco conceitos do §2 —
só que **contra um zip embutido no exe**, não contra um servidor.

| Conceito (doc de origem) | Onde já vive aqui | Estado |
|---|---|---|
| Payload .zip versionado por marcador (§5) | `Payload.Carimbo()` = `sha256(payload.zip)[:16]`, gravado em `<raiz>/.versao` | pronto |
| Raiz da instância (§9.1) | `%LOCALAPPDATA%\ClassicDuels\game` | pronto |
| `removeMode: "keep"` (§2.4) | `Payload.Preservadas = { "store/", "decks/" }` | pronto, mas incompleto (ver §3) |
| Zip-slip (§2.5) | o teste `destino.StartsWith(root + separador)` em `EnsureExtracted` | pronto, vira `SafeCombine` |
| Fallback offline (§7) | o payload embutido no exe | **melhor** que o original: o plano B é permanente |
| Gerador do pacote (§8, passos 1–2) | `tools/pack.ps1` | pronto |
| Manifesto, diff, download, backup | `duel-server/src/update/` | **feito** (ver §5) |
| Gerador do manifesto + publish | `tools/publish-release.ps1` | **feito** |
| Self-tests | `--test-update`, `--test-release` | **feito**, 30/30 e 8/8 |
| Auto-update do próprio exe (§6) | — | **pendente** |
| UI de progresso | — | **pendente** |

**O problema concreto que isto resolve:** hoje, atualizar o jogo é o jogador baixar
`ClassicDuels.exe` (64 MB) na mão, e o `EnsureExtracted` reescrever os ~21 mil arquivos de
uma vez. Um ajuste de 1 KB em `web/js/duel.js` custa 64 MB de download.

---

## 2. Divisão por volatilidade (a lição não-resolvida do §5)

O documento de origem avisa: no Souls Craft, `resourcepacks` + `config` foram no MESMO zip,
então um ajuste de 1 KB obrigava a re-baixar 123 MB. Aqui a divisão certa é evidente, porque
os nossos conteúdos têm ritmos de mudança muito diferentes:

| Pacote | Conteúdo | Tamanho **real** | Muda quando |
|---|---|---|---|
| `ClassicDuels.exe` | a **casca** (`duel-server/host/`) + o runtime .NET + a semente | ~68 MB | mexe em `host/` — raro, de propósito |
| `game.zip` | `web/`, `ygo-data/src/`, e de `ygo-data/data/`: `cards.index.json`, `archetypes.json`, `scripts.index.json`, `meta.json`, `constants.json` | **1,2 MB** | **quase todo dia** |
| `cards.zip` | `ygo-data/data/cards.json` (14 MB), `.../YGODemo/cards.cdb` e os 20.949 `script/*.lua` | **27,1 MB** (20.951 arquivos) | só quando roda `npm run data:build` |
| `engine.zip` | `DuelServer.Engine.dll` — **todo o C#**: motor, `NpcBrain`, `InteractiveDuel`, servidor web | **0,2 MB** | mexe em `duel-server/src/` |
| `native.zip` | `ocgcore.dll` + `sqlite3.dll` | **1,9 MB** | o core é recompilado (quase nunca) |
| `files[]` | `store/banlist.json`, `store/boosters.json`, `store/npcs.json`, `store/cardlists.json` | KB | conteúdo global do jogo, sob demanda |

Os tamanhos acima são medidos, não estimados (`npm run release:build`). Publicar um
ajuste de front custa **1,2 MB** ao jogador; uma correção no `NpcBrain`, **0,2 MB**.

### O motor também é conteúdo (19/08/2026)

As duas últimas linhas são a mudança que fechou o buraco mais caro deste desenho: até
19/08/2026 **todo o C# viajava dentro do `.exe`**. Uma correção de 800 KB no `NpcBrain`
custava 67,8 MB de download — dos quais ~29 MB eram `game.zip` e `cards.zip` que o jogador
já tinha no disco — e só chegava até ele se quem publicou lembrasse de `npm run pack`, do
bump da `InstallerVersion` e do `-ComExe`. Foi esquecido em produção pelo menos uma vez (a
varredura de ATK/DEF: front novo, motor velho, nenhum teste vermelho).

Hoje o executável é uma **casca**: ele resolve a instalação, aplica o motor que ficou em
estágio e carrega `engine/DuelServer.Engine.dll` **por bytes** (nunca `LoadFrom`, que
travaria o arquivo e impediria a atualização seguinte de substituí-lo). O motor virou um
pacote como qualquer outro.

**Por que `engine`/`native` caem em `.staged/` e não no lugar definitivo.** Quem baixa a
atualização é o próprio motor — é ele que tem a tela `web/atualizando.html` e as rotas
`/__update/*` —, e nesse instante ele e a `ocgcore.dll` estão carregados no processo; o
Windows não deixa sobrescrever DLL em uso. Então o zip publicado traz as entradas com o
prefixo `.staged/`, o `UpdateEngine` as extrai ali sem saber de nada, e a casca aplica no
boot seguinte, quando nada foi aberto ainda (`host/Estagio.cs`). O cliente descobre que
precisa reabrir pelas próprias `roots` do pacote (`Manifest.EmEstagio`), não por um campo
novo — assim não há como publicar um zip que cai em estágio e o cliente não saber.

**A rede de segurança.** Um motor baixado é um `.dll` que ninguém revisou na máquina do
jogador; se ele puder travar o boot, não há como consertar do outro lado. Então: falha de
CARGA reverte na hora; exceção nos primeiros 20 segundos põe o motor de castigo
(`engine.ruim-<carimbo>`), restaura o anterior de `.staged-bak/` e ainda tenta subir o
motor embutido no MESMO boot; e uma sentinela (`.engine-tentativa`) pega o caso em que o
processo morre sem exceção — duas sobras seguidas e ele vai para a quarentena. O
`--test-casca` cobre os cinco casos.

Os três `store/*.json` acima são **conteúdo do jogo** versionado de propósito (banlist,
boosters, NPCs customizados), não progresso de ninguém — por isso entram em `files[]` e
podem ser atualizados individualmente. Todo o resto de `store/` e `decks/` é do jogador.

### Raízes sobrepostas — e por que a limpeza é por inventário

`game.zip` e `cards.zip` **dividem a pasta `ygo-data/data`**: os 5 índices pequenos são
voláteis e o `cards.json` de 14 MB é estável. O molde original limpa os restos varrendo as
`roots` do payload — e com raízes sobrepostas isso faz o **segundo pacote apagar em silêncio
o que o primeiro acabou de instalar**. Aconteceu de verdade aqui: o `--test-release` contra
os artefatos reais mostrou a instalação "com sucesso" e sem `cards.index.json`.

A correção não foi separar as pastas (o front espera os arquivos onde estão), foi trocar o
critério: cada pacote grava um **inventário** do que escreveu
(`.duelacademy/<id>.files`) e só governa esses arquivos. Na atualização seguinte, remove o
que estava no inventário antigo e não está no zip novo. Raízes podem se sobrepor à vontade.

De brinde, isso deixa a varredura de órfãos ser mais precisa que a do original: ele **pula**
as raízes de payload inteiras (senão os 12.734 arquivos do `ygo-data` apareceriam todos como
órfãos); aqui não é preciso pular nada, porque sabemos exatamente quais arquivos cada pacote
pôs ali. Um arquivo largado à mão dentro de `web/js/` é detectado; os legítimos, não.

---

## 3. `managedRoots` — e a armadilha das contas

```jsonc
"managedRoots": [
  { "path": "web",                                   "removeMode": "keep" },
  { "path": "ygo-data",                              "removeMode": "keep" },
  { "path": "duel_academy/Assets/StreamingAssets",   "removeMode": "keep" }
]
```

Começa tudo em `"keep"` (§9.9); só vira `"backup"` quando o diff estiver provado pelo
self-test. `store/` e `decks/` **nunca** entram em `managedRoots`.

**Atenção redobrada:** `Payload.Preservadas` foi escrito quando `store/` e `decks/` eram só
carteira e decks. Hoje eles guardam **contas de verdade** — `store/accounts/`,
`store/users/<usuário>/wallet.json`, `store/sessions.json`, `decks/users/<usuário>/player/*.ydk`
(ver a seção "Conta" do `CLAUDE.md`). Um `removeMode: "backup"` mal escopado ali não perde um
save: **desloga todo mundo e some com a coleção**. A varredura de órfãos tem que pular essas
pastas explicitamente, como o §5 manda pular os `roots` do payload.

Backups em `%LOCALAPPDATA%\ClassicDuels\backups\<AAAA-MM-DD-HHmmss>\`, fora da raiz da
instância (senão viram órfãos de si mesmos na próxima varredura).

---

## 4. Schema do manifesto

```jsonc
{
  "gameVersion": "classic-duels-20260807",   // rótulo humano
  "displayName": "Classic Duels",

  "installer": {                            // o PRÓPRIO exe (auto-update, §6 do original)
    "version": "0.2.0",
    "asset":   "ClassicDuels.exe",
    "sha256":  "…",
    "size":    14000000
  },

  "managedRoots": [ /* ver §3 */ ],

  "files": [
    { "path": "store/banlist.json",  "asset": "banlist.json",  "sha256": "…", "size": 4096, "policy": "required" },
    { "path": "store/boosters.json", "asset": "boosters.json", "sha256": "…", "size": 8192, "policy": "required" },
    { "path": "store/npcs.json",     "asset": "npcs.json",     "sha256": "…", "size": 2048, "policy": "required" }
  ],

  "payloads": [                             // PLURAL — é a nossa mudança sobre o original
    {
      "id":      "game",
      "version": "game-<digital[:12]>",
      "asset":   "game.zip",
      "sha256":  "…",
      "size":    3000000,
      "roots":   ["web", "ygo-data/src", "ygo-data/data"]
    },
    {
      "id":      "cards",
      "version": "cards-<digital[:12]>",
      "asset":   "cards.zip",
      "sha256":  "…",
      "size":    47000000,
      "roots":   ["duel_academy/Assets/StreamingAssets/YGODemo"]
    }
  ]
}
```

Cada payload tem seu próprio marcador no disco: `<raiz>/.duelacademy/<id>.version`. O
`.versao` de hoje (marcador único do `Payload.cs`) continua existindo como marcador do
**payload embutido**, para o caminho offline não mudar de comportamento.

Grave o JSON **sem BOM** (`UTF8Encoding($false)` no PowerShell) e faça o parser dar
`TrimStart` no BOM mesmo assim (§7 do original).

---

## 5. Arquivos novos

Tudo em `duel-server/src/update/`, reusando o `Log` que já existe
(`logs/duel-server.log`, ao lado do exe).

| Arquivo | Papel | Estado |
|---|---|---|
| `SafePath.cs` | `Combine`/`Rel`/`DentroDe` — o teste de zip-slip extraído do `Payload.cs` | **feito** |
| `Manifest.cs` | modelo do manifesto (§4) + `Parse` tolerante a BOM | **feito** |
| `HashCache.cs` | cache `(path\|size\|mtime) → sha256`, TSV | **feito** |
| `FonteDeAssets.cs` | de onde vêm manifesto e assets; `FonteLocal` (pasta/`file://`) | **feito** |
| `UpdateEngine.cs` | `CarregarManifestoAsync` → `Montar` → `AplicarAsync`; progresso por `Action<Progresso>` | **feito** |
| `GitHubReleases.cs` | `FonteGitHub`: resolve `asset → apiUrl` via API + token; `NomeSeguro` | **feito** |
| `BuildConfig.cs` | `Owner`/`Repo`/`Tag`/`InstallerVersion`; o token vem de fora | **feito** |
| `SelfUpdater.cs` | `.new` + `.bat` de troca (ver §7 — tem armadilha nossa) | pendente |

`Payload.cs` continua sendo o plano B permanente: o `UpdateEngine` pergunta ao remoto,
depois ao cache do último manifesto bom, e quem chama cai no payload embutido se as duas
falharem.

O `HashCache` só se justifica de verdade por causa de `files[]` — para os payloads em zip o
marcador de versão já evita hashear qualquer coisa. Vale ter mesmo assim: é agnóstico, e no
dia em que quisermos listar `web/` arquivo-a-arquivo ele já está lá.

---

## 6. A UI: sem WinForms, sem WebView2

O original usa WinForms + WebView2 porque não tinha servidor. **Nós temos** — o
`StaticServer.cs` já serve o front inteiro no modo `--app`. Então:

- rota nova `/__update/*` no `StaticServer` (o padrão `/__` já existe: `/__decks/`,
  `/__store/`, `/__boards/`, `/__auth/`, e a linha 59 já barra POST não-local);
- `GET /__update/check` → o `InstallPlan` serializado (o que falta baixar, quantos MB);
- `POST /__update/apply` → dispara o `ApplyAsync`, com o progresso saindo por SSE;
- `web/atualizando.html` mostra a barra e chama a home quando termina.

No boot do `--app`, antes de abrir o navegador, o `Program` faz o check **com timeout
curto**. Se houver atualização — **ou se a checagem não alcançar o servidor** — abre o
navegador em `/web/atualizando.html`; senão, na home de sempre.

> **A regra "offline nunca trava o jogo" (§7 do original) foi revogada em
> 23/08/2026.** A tela perdeu o "jogar sem atualizar" e o boot deixou de entrar
> offline: login, carteira, coleção, decks, adversários e trilha moram no Supabase,
> então entrar sem rede entregava uma home vazia com cara de quebrada — e deixava um
> cliente para trás, que é o defeito mais caro que este projeto já pagou (o motor
> congelado de 19/08/2026). Sem conexão o jogo **espera** na tela, que reconsulta
> sozinha a cada 10s; `POST /__update/rechecar` (só localhost) é o "tentar de novo"
> sem custar um boot inteiro.
>
> O que sobrevive intacto da regra antiga: **nenhuma falha de rede pode virar
> exceção no boot**. Toda falha continua virando um ESTADO (`Indisponivel`) que a
> tela sabe mostrar.
>
> O **cache do manifesto** entrou junto: ele responde, mas agora se anuncia
> (`UpdateEngine.ManifestoVeioDoCache`), e `Checar` trata cache como "sem conexão".
> Um manifesto do cache diz o que era verdade da última vez — aceitá-lo deixava
> passar exatamente o cliente velho que não consegue perguntar se está velho.

O `Action<Progress>` do original vira o mesmo desacoplamento aqui: o núcleo não sabe se quem
escuta é o SSE, o console ou o self-test.

---

## 7. Duas armadilhas que são só nossas

**Marca da Web (erro 1223).** Já documentada no `CLAUDE.md` e tratada em
`launcher/Program.cs` (`OfferUnblock`, linha ~223: apaga o fluxo `Zone.Identifier` via
`DeleteFileW(f + ":Zone.Identifier")`). O exe **baixado pelo auto-updater** vai carregar esse
fluxo. Como o `.bat` de troca do §6 dá `start "" ClassicDuels.exe` com janela oculta, o
Windows cancela sem perguntar nada e o jogador vê o jogo simplesmente não abrir. **O
`SelfUpdater` tem que apagar o ADS do `.new` antes de mover** — reusando a mesma
`DeleteFileW` do launcher. Isto não é hipótese: é o mesmo bug que já custou tempo aqui.

**O exe travado durante a extração.** O `CLAUDE.md` avisa: "compile sempre com o servidor
parado". A mesma regra vale para o update — se o `duel-server` estiver rodando
(`classic-duels.exe` do launcher, ou uma segunda janela do jogo), o `ApplyAsync` pode falhar
ao substituir arquivo em uso. O update roda no boot, **antes** de o `HttpListener` subir, e
o `SelfUpdater` só age depois de o processo atual pedir para encerrar.

---

## 8. Publicar uma versão

`tools/publish-release.ps1` (feito), reusando os passos 1–2 do `pack.ps1`:

1. monta as três árvores (`game`, `cards`, e os `files[]` avulsos);
2. zipa `game.zip` e `cards.zip`; o `version` é `"<id>-" + digitalDoConteudo[:12]` — a
   identidade vem do **conteúdo**, então não dá para esquecer de incrementar;

   > **A digital é do que está DENTRO do zip, não dos bytes do zip** (`DigitalDoConteudo`,
   > desde 19/08/2026): uma linha `entrada|sha256` por arquivo, ordenadas por *ordinal*, e o
   > `sha256` disso. Até então o marcador era o `sha256` do próprio `.zip`, e dois zips com
   > exatamente os mesmos arquivos dentro **não têm os mesmos bytes fora** — a saída do
   > *deflate* muda com a versão do runtime que comprimiu. Empacotar noutra máquina gerava
   > marcador novo para conteúdo idêntico, e o cliente compara MARCADOR. Foi medido: o
   > `game.zip` (92 entradas) e o `cards.zip` (20.951) publicados e regerados batiam entrada
   > por entrada, com **zero** diferenças, e mesmo assim ganhavam marcador novo — 28 MB de
   > download para cada jogador receber o que já tinha.
   >
   > O campo `sha256` do manifesto continua sendo o do **arquivo**: são perguntas diferentes —
   > "preciso baixar?" (marcador) e "o que baixei chegou inteiro?" (sha do zip). O cliente não
   > mudou: para ele o marcador sempre foi uma string opaca.
3. calcula `sha256`+`size` dos `files[]`;
4. sanitiza o campo `asset` (`[^A-Za-z0-9._-]` → `.`) mantendo o `path` real — o GitHub
   renomeia assets e isso quebra o match manifesto→asset (§7 do original);
5. escreve `manifest.json` **sem BOM**;
6. **dry-run por padrão**; com `-Publish`, cria o Release via `gh` CLI e sobe os assets.
   Inclui o `ClassicDuels.exe` e lê a `InstallerVersion` do `BuildConfig.cs` **sempre** que
   houver um exe empacotado em `dist/` (desde 22/08/2026 — com `installer: null` o cliente
   de versão antiga nunca fica sabendo que existe um exe novo, e desde que o motor mora em
   `.staged/` isso o congela para sempre; ver INSTALADOR-PENDENCIAS §0.1). `-ComExe` sobrou
   como "exija o exe": falha em vez de avisar quando ele não está lá. Recusa também um exe
   empacotado antes da última mexida na casca (`dist/.cache/casca.digital`).

```bash
npm run release:build      # dry-run: gera dist/release/ e lista os tamanhos
npm run release:test       # instala esses artefatos numa raiz descartavel (§9)
npm run release:publish    # sobe o Release
```

### Repositório e token

Repo de distribuição: **`FelisbertoJPG/yugi-server-`** (privado, só Releases, sem código) —
já é o que está fixo no `BuildConfig.cs`. Com `Tag = ""`, o cliente busca `/releases/latest`.

O token **não** mora num `.cs`. Ele entra como recurso embutido a partir de
`duel-server/token.txt`, pela mesma condicional do `.csproj` que o `payload.zip` já usa: se o
arquivo existe vira recurso, se não existe o build sai igual ao de sempre. `token.txt` está no
`.gitignore`, na mesma linhagem de `store/accounts/` e `store/sessions.json`. Para depurar sem
recompilar, a variável de ambiente `DUELACADEMY_TOKEN` também é lida.

Exigências do token — **PAT fine-grained, `Contents: Read-only`, escopado só neste repo**:

- ele **é extraível** de dentro do exe por qualquer um. O dano é limitado pelo escopo: o pior
  caso é alguém baixar o que já ia ser distribuído;
- teste a escuridão: `PUT /contents` tem que dar **403**. O campo `permissions.admin` do
  `GET /repos` **engana** — reflete o papel do dono, não o poder do token;
- **nunca embuta o token do `gh` CLI**. O desta máquina é `gho_…` com escopos
  `gist, read:org, repo, workflow` — isso é poder de **escrita** no repositório;
- PAT fine-grained expira. Use validade longa e lembre de rotacionar.

---

## 9. Self-tests headless

Seis flags no `duel-server`, no mesmo molde das ~20 suítes que já existem. Elas pegam falhas
**diferentes**: a engine, os arquivos que você vai publicar, o transporte, a rede fora do ar,
a troca do próprio exe, e a trava do duelo.

`npm run update:test` roda as quatro que não precisam de rede
(`--test-update`, `--test-offline`, `--test-selfupdate`, `--test-update-duelo`).

### `--test-update` — a engine (63 asserções, sem rede)

Monta um "Release falso" no `%TEMP%` e roda `Carregar` → `Montar` → `Aplicar` → re-scan pelo
mesmo caminho de código do GitHub. Os casos:

| Caso | O que prova |
|---|---|
| instalação limpa + re-scan | instala tudo, e rodar de novo não acha nada (idempotência) |
| marcador igual / diferente | marcador igual não re-baixa; mexer no marcador de `cards` pede **só** ele |
| sha256 errado | aborta, devolve falha, o arquivo bom antigo fica intacto, o `.part` é apagado |
| `../` no zip | não escreve fora da raiz, e o resto do pacote instala normal |
| dado de conta | `store/users/…/wallet.json` e `decks/users/…` intactos mesmo vindo no zip |
| órfão | detectado dentro de uma raiz de payload, vai pro backup, é recuperável |
| manifesto com BOM | parseia mesmo assim |
| volatilidade | ajuste no front pede só `game`, e o pacote de cartas não é tocado |
| raízes sobrepostas | regressão do bug do §2 — os dois pacotes convivem em `ygo-data/data` |
| payload embutido | instalação nova nasce **em dia** (§11); e sem o `payload.markers` o fantasma reaparece |
| exe velho, conteúdo em dia | o boot AINDA oferece atualização — era aqui que o cliente congelava (§12) |

### `--test-casca` — a troca do motor em disco (25 asserções, sem rede)

Cobre o que só existe na máquina do jogador: o pacote `engine` chegou em `.staged/` e a
troca acontece no boot seguinte (`duel-server/host/Estagio.cs`). Os casos:

1. **caminhos** — o prefixo `.staged/` sai; `..` e caminho absoluto são recusados;
2. **aplicar** — o motor novo entra, o que o pacote não trazia continua onde estava, o
   anterior vai para `.staged-bak/` e o `.staged/` é limpo (senão seria reaplicado todo boot);
3. **escopo** — um pacote em estágio só escreve em `engine/`; um zip publicado por engano com
   `store/wallet.json` dentro não sobrescreve a carteira de ninguém por este caminho;
4. **sentinela** — a primeira sobra é tolerada (o jogo pode ter sido morto pelo Gerenciador de
   Tarefas); a segunda põe o motor de castigo em `engine.ruim-<carimbo>` e restaura o anterior;
5. **sem anterior** — reverter ainda funciona: o `engine/` some e o boot cai no motor embutido;
6. **quarentena** — só a mais recente fica (são ~5 MB por cópia);
7. **constantes** — a casca duplica `PASTA`/`PASTA_ANTIGA` do `DuelServer.Payload` (ela precisa
   saber onde o jogo mora ANTES de poder olhar dentro do motor) e o teste confere que as duas
   concordam. Duplicata sem guarda envelhece: discordando, a casca procuraria o motor numa
   pasta e o motor instalaria o jogo noutra.

### `--test-offline` — a rede FORA do ar (19 asserções)

O contrário do `--test-remote`, e o caso que acontece de verdade com o jogador. Prova que
**toda falha de rede vira um ESTADO, nunca uma exceção**: fonte inexistente, manifesto
corrompido (o HTML de um 500), cache do manifesto ilegível e asset que some no meio do
download. Todos viram "não consegui perguntar" ou "falhou sem estragar nada" — nenhum vira
exceção subindo até o boot.

O caso do meio é o que mais paga, e é onde a mudança de 23/08/2026 mora: depois de UMA
checagem boa o manifesto fica em cache, e ele **continua** respondendo — mas se ANUNCIA
como cache, e é essa bandeira (com o par controle do manifesto vindo da rede) que impede um
cliente velho de concluir que está em dia sem ter conseguido perguntar.

### `--test-selfupdate` — a troca do próprio exe (19 asserções)

A coreografia inteira com um exe de mentira no `%TEMP%`: baixar o `.new`, conferir o sha256,
apagar o `Zone.Identifier`, escrever o `.bat`, esperar um PID morrer, copiar por cima, apagar
o `.new` e o `.bat` se autodeletar. O `.bat` roda **de verdade** — o PID esperado é o de um
processo que já morreu, então a espera termina na hora sem encerrar quem está testando.

Ele confere também **quais argumentos** chegam ao processo reaberto: o `.bat` reabre com
`--reaberto`, e é essa flag que faz o boot novo NÃO abrir uma segunda janela do navegador.
Sem ela, a atualização terminava com duas cópias do jogo na tela (a janela que mostrou a
barra de progresso continuava viva e ia sozinha para a home quando o servidor novo
respondia) — e como o navegador abre em modo `--app`, sem barra de endereço, cada uma parece
um executável: *"2 exe abrindo após att"*. A rede de segurança é `WebServer.Atendidas`: se
ninguém falar com o servidor em 6 segundos, a janela anterior foi fechada e aí sim se abre
uma nova.

O que ele **não** cobre, e continua exigindo uma publicação real: baixar o exe pelo navegador
para ele vir com a Marca da Web de verdade. O caso 3 põe a marca à mão e confere que ela sai,
mas quem a produz é o navegador.

### `--test-update-duelo` — a trava do duelo (13 asserções)

Precisa do `cards.cdb` de verdade. Mede no arquivo, em vez de deduzir: com um duelo vivo o
`cards.cdb` **não** pode ser aberto em exclusiva (é o que a extração do zip precisaria fazer);
depois do `Dispose`, pode. E o estado que a rota consulta responde certo nas três situações —
sem duelo, com duelo vivo, e com duelo já encerrado (que precisa **soltar** o arquivo, não só
responder "não tem duelo").

### `--test-remote` — o transporte (rede de verdade)

Instala o Release **publicado**, pela rede, com o token embutido. É o único teste que
exercita as três armadilhas do repo privado (§4 do documento de origem) ao mesmo tempo: o
endpoint da API do asset em vez do `browser_download_url`, o `Accept: application/octet-stream`,
e o redirect para o CDN em que o `HttpClient` tira o `Authorization`.

Um `Accept` esquecido passa liso por todos os outros testes — o download "funciona", só que
o que chega é o JSON de metadados do asset, e o sintoma é um "sha256 não confere" sem
explicação nenhuma.

### `--test-release <pasta>` — os artefatos de verdade (11 asserções)

Instala o que o `publish-release.ps1` acabou de gerar numa raiz descartável do `%TEMP%` e
confere que o jogo ficou completo (`web/index.html`, `web/duel.html`, `cards.index.json`,
`cards.cdb`, > 20.000 `.lua`) e que o re-scan fica vazio.

Depois faz o mesmo pelo OUTRO caminho: monta o `payload.zip` como o `tools/pack.ps1` monta,
instala pelo `Payload` e exige que o diff contra ESTE Release não peça pacote nenhum. É o
único ponto em que o formato do payload e o formato do manifesto se encontram sobre os
arquivos reais — um `pack.ps1` que volte a montar a própria árvore falha aqui, mesmo
continuando a produzir um exe que abre e joga.

**Não é redundante com o primeiro** — foi ele que achou o bug das raízes sobrepostas. Um
`roots` errado ou um asset esquecido no manifesto passa liso pelo teste da engine (que usa
zips de brinquedo) e só apareceria na máquina do jogador. Rode sempre antes de `-Publish`.

---

## 10. Ordem de implementação

1. [x] Extrair o teste de zip-slip do `Payload.cs` para `SafePath.cs` — sem mudar comportamento.
2. [x] `Manifest.cs` + `HashCache.cs` (agnósticos).
3. [x] `UpdateEngine.cs` com fonte de assets **abstrata** (`FonteLocal` primeiro).
4. [x] `--test-update` (§9) — verde antes de tocar em rede. **30/30**.
5. [x] `tools/publish-release.ps1` gerando `game.zip` / `cards.zip` / `files[]`, dry-run por padrão.
6. [x] `--test-release` contra os artefatos reais. **8/8**.
7. [x] `GitHubReleases.cs` + `BuildConfig.cs` apontando para `FelisbertoJPG/yugi-server-`.
8. [x] PAT fine-grained criado e embutido via `duel-server/token.txt`.
       Verificado: `GET /repos` 200, `PUT /contents` **403**.
9. [x] Primeiro Release publicado (`release-20260807-0157`, 6 assets).
10. [x] `--test-remote` — instalação pela rede, ponta a ponta. **10/10**.
11. [x] `/__update/status` e `/__update/aplicar` no `StaticServer` + `web/atualizando.html`
        + check no boot do `--app` (timeout de 8s, falha silenciosa).
12. [x] `SelfUpdater.cs` — **com** o tratamento da Marca da Web (§7).
13. [x] Resolver a atualização fantasma da instalação nova (ver abaixo).
14. [x] Virar `managedRoots` de `"keep"` para `"backup"`, um de cada vez. **`web/` virou**;
        `ygo-data` e `StreamingAssets` seguem em `keep` (são compartilhadas entre os dois
        pacotes e têm arquivos que o `data:build` gera localmente).
15. [x] Recusar `/__update/aplicar` com duelo ativo (409) — e **soltar** o `cards.cdb` do
        duelo já encerrado, senão atualizar depois de jogar uma vez exigiria fechar o jogo.
16. [x] Poda dos backups (mantém os 3 mais recentes) e caminho de volta
        (`/__update/restaurar`). **O botão saiu da tela em 23/08/2026** — pela
        mesma razão que o "jogar sem atualizar": voltar é ficar para trás. A rota
        fica como alavanca de quem conserta um Release quebrado (POST de
        localhost, na mão), não como opção de quem joga. O caso comum já se
        resolve sozinho e por outro caminho: a casca reverte um MOTOR que não
        sobe (`Estagio.Reverter`).
17. [x] `--test-offline` e `--test-selfupdate`.

A cadeia inteira funciona: o `--app` checa no boot, abre `atualizando.html` se houver
novidade, o jogador clica, a barra anda e o jogo entra sozinho.

### Detalhes que custaram um ciclo de teste

- **A barra precisa andar durante o download E a extração.** Na primeira versão o progresso
  só avançava por pacote: ficava em 3% por ~15 segundos e pulava para 100%. O peso de cada
  pacote é dividido 70% download / 30% extração, com aviso a cada 256 KB baixados e a cada
  250 arquivos extraídos. Uma barra que mente é pior que barra nenhuma — quem acha que travou
  mata o processo no meio da instalação.
- **O check só roda com payload embutido** (`Payload.Exists`). Em desenvolvimento, `appRoot`
  é a pasta do repositório: atualizar ali sobrescreveria o código-fonte de quem está
  programando com os arquivos do último Release. `--sem-update` pula a checagem.
- **`/__update/aplicar` exige localhost** mesmo com `--lan` ligado. A trava geral de `/__` só
  cobre não-GET, e instalar é comando de máquina, não de rede.
- **O `.bat` de troca usa `ping` como sleep.** O `timeout` do Windows exige console
  interativo e aborta com "Input redirection is not supported" quando roda sem janela —
  exatamente o nosso caso.

> As pendências completas — com o porquê de cada uma e onde mexer — estão em
> **[`INSTALADOR-PENDENCIAS.md`](./INSTALADOR-PENDENCIAS.md)**. O que segue abaixo é só a
> maior delas.

---

## 11. A atualização fantasma — resolvida, e por que assim

Uma instalação recém-baixada oferecia uma atualização de **25,7 MB que ela já tinha por
dentro**. O `ClassicDuels.exe` embute `payload.zip`, mas quem registrava os marcadores
(`.duelacademy/<id>.version`) era só o `UpdateEngine` — o `Payload` não escrevia nenhum. Sem
marcador, o diff concluía (corretamente, pelo que sabia) que faltava tudo.

**Não dava para calcular os marcadores por fora.** Dois `CreateFromDirectory` sobre o mesmo
conteúdo não produzem bytes idênticos (o zip guarda o timestamp de cada entrada), e o marcador
é derivado do sha256 do zip. Um `payload.zip` montado pelo `pack.ps1` nunca casaria com o
Release — sempre sobraria a oferta fantasma.

A saída foi o `pack.ps1` **consumir os mesmos arquivos** que o `publish-release.ps1` gerou. O
payload embutido virou:

```
payload.zip
├── game.zip          copia BYTE A BYTE do dist\release\game.zip publicado
├── cards.zip         idem
├── payload.markers   "game=game-abc123def456" + "cards=cards-…", lidos do manifest.json
└── seed/…            o que os dois pacotes NÃO trazem (store/, decks/, package.json)
```

O `Payload` extrai os dois zips como o updater faria e chama
`UpdateEngine.RegistrarPacoteInstalado` — marcador **e** inventário, no mesmo formato. A
instalação nova nasce em dia.

**Isso mudou um comando que você usa:** `npm run pack` deixou de ser autossuficiente.
`npm run release:build` é pré-requisito, e o `pack.ps1` recusa com mensagem clara em três
casos — `dist\release\` ausente, sha256 dos zips não batendo com o `manifest.json` (alguém
mexeu na pasta depois de gerada, e os marcadores embutidos seriam mentira), e `game.zip`
mais velho que o arquivo mais novo de `web/`/`ygo-data/src` (release velho é pior que release
ausente: o exe sairia com um front antigo e nada acusaria).

Sem os marcadores o bug volta, e é isso que a última linha da tabela do §9 prende: o
`--test-update` monta o payload nos dois jeitos e exige que **com** marcadores a instalação
nova não peça nada, e que **sem** eles ela volte a pedir os dois pacotes.

> Ordem de trabalho, agora: `npm run release:build` → `npm run release:test` → `npm run pack`
> → (se for trocar o exe) `npm run release:build` de novo e `-Publish -ComExe`.

> **Um build de desenvolvimento contém o token.** Com o `token.txt` no lugar, o PAT vira
> recurso do `duel-server.dll` — está literalmente dentro do binário compilado. Por isso
> `duel-server/bin/` entrou no `.gitignore`: um `git add -A` de rotina publicaria o segredo,
> e nada acusaria, porque o arquivo é binário e o diff não mostra nada legível.

---

## 12. O exe congelado — a segunda metade da atualização fantasma

**O sintoma, palavras do jogador:** *"atualizou umas 2 vezes e mesmo assim está com um
cliente bem antigo"*.

**A cadeia.** Quem baixa e troca o executável é `UpdateService.TrocarExecutavel()`, e ele
só é chamado de dentro de `UpdateService.Rodar()` — ou seja, **dentro do `Aplicar`**. O
`Aplicar` só roda quando o boot decidiu que há atualização, e essa decisão é uma linha só:

```csharp
_plano = _engine.Montar(_manifesto, BuildConfig.InstallerVersion);
if (_plano.NadaAFazer) return false;   // -> abre web/index.html, nao a tela de update
```

E o `NadaAFazer` era:

```csharp
public bool NadaAFazer =>
    !ABaixar.Any() && !PayloadsPendentes.Any() && Orfaos.Count == 0;
```

O `InstaladorDesatualizado` — calculado logo ali, no passo 4 do `Montar` — **não entrava na
conta**. Então bastava o conteúdo ficar em dia (o que acontece no primeiro update que dá
certo) para todo boot seguinte responder "tudo em dia" com um exe de duas versões atrás.
Nunca mais havia uma janela em que a troca pudesse ser oferecida.

**Por que isso congela o MOTOR junto.** Desde 19/08/2026 o `engine.zip` cai em
`.staged/engine` e quem o aplica é a casca (`duel-server/host/Estagio.cs`), que só existe a
partir da 0.15.0. Um exe anterior baixa o pacote, grava o marcador, e roda para sempre o
motor embutido nele. Front novo todo dia, motor parado, sem um erro em lugar nenhum — o
mesmo desfecho do `installer: null` (§0.1 das pendências), por um caminho diferente e
sobrevivente à correção daquele.

**A correção (23/08/2026).**

```csharp
public bool SemConteudo => !ABaixar.Any() && !PayloadsPendentes.Any() && Orfaos.Count == 0;
public bool NadaAFazer  => SemConteudo && !InstaladorDesatualizado;
```

Três ajustes vêm junto, e cada um evita um efeito colateral:

- **`AplicarAsync` sai por `SemConteudo`**, não por `NadaAFazer`. Sair por `NadaAFazer`
  deixaria de sair (o plano tem o exe pendente) e abriria uma pasta de backup vazia a cada
  boot; entrar de vez também não serve, porque não há arquivo nenhum a trocar ali.
- **`BytesTotais` conta o exe**, e o denominador do progresso do conteúdo virou
  `BytesConteudo`. Sem isso a tela prometia "0,8 MB" e baixava setenta.
- **`Resumo()` diz "o proprio Classic Duels (x.y.z)"** — antes a tela abriria dizendo
  "tudo em dia" no exato boot em que havia algo a fazer.

**Coberto por** `ExeVelhoNaoFicaCongelado` (`--test-update`), com o par CONTROLE: com o exe
em dia e o conteúdo em dia, `NadaAFazer` continua verdadeiro e nenhuma tela abre.
