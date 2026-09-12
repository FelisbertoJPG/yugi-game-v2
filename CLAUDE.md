# CLAUDE.md

> Documentação e comentários do projeto são em **português**. Siga a língua do
> arquivo que você está editando.

Este arquivo é o **genérico**: o que vale para o projeto inteiro. O detalhe de
cada camada mora em dois arquivos irmãos, carregados sozinhos quando você mexe
na pasta de cada um.

| você vai mexer em | leia |
|---|---|
| `web/` — telas, módulos ESM, CSS, os testes em Node, as bancadas visuais | **`web/CLAUDE.md`** |
| `duel-server/`, `supabase/migrations/`, `tools/`, `ygo-data/` | **`duel-server/CLAUDE.md`** |
| qualquer coisa | este arquivo, sempre carregado |

> **`supabase/` e `tools/` não têm CLAUDE.md próprio, de propósito.** A verdade
> deles — a RLS, as migrations, o que entra num Release — é indivisível do
> servidor: `salvar_deck` e `premiar_vitoria` são o outro lado de `drops.js` e
> de `deck.js`, e `publish-release.ps1` é o outro lado do `UpdateEngine`. Dois
> arquivos sobre a mesma verdade divergiriam calados. Mexeu ali, leia
> **`duel-server/CLAUDE.md`**.

## As três camadas

Três camadas independentes, unidas por HTTP local:

- **`web/`** — o jogo. HTML/CSS/JS puro, ESM, **zero dependências**, sem
  framework e sem build step: uma página por tela e um módulo por assunto em
  `web/js/`.
- **`duel-server/`** — .NET 8 hospedando o `ocgcore` (edo9300) por P/Invoke e
  expondo o duelo como RPC HTTP em 8770. É também quem serve o front dentro do
  `.exe` (`--app`) e quem instala e atualiza o jogo na máquina de quem joga.
- **`ygo-data/`** — dataset gerado do `cards.cdb` (13.728 cartas em JSON,
  índice de 2 MB para o browser, 12.702 scripts Lua). Camada de **dados**,
  nunca de regras.

Debaixo das três, e valendo mais que qualquer uma, está o **Supabase**
(`supabase/migrations/`): contas, carteira, coleção, decks, conteúdo publicado,
drops, trilha e presença. Quem decide o que o jogador pode é a RLS e os RPCs —
o cliente obedece.

> **As regras do Yu-Gi-Oh! *são* o `ocgcore` mais os scripts Lua.** Nunca
> reimplemente regra do lado de fora: se um monstro pode ou não mudar de posição,
> se uma armadilha pode ser ativada — o motor já responde isso nas listas que
> manda. Desenhe o que ele ofereceu.

## Comandos essenciais

```bash
npm run dev                  # front estático em http://localhost:8080 (Node puro, zero deps)
cd duel-server && dotnet run -- --serve   # motor de duelo em http://localhost:8770
```

Não existe `npm install` — o front tem **zero dependências**. Requer Node >= 18;
o duelo requer .NET 8 e **Windows x64** (`ocgcore.dll`/`sqlite3.dll` são nativas,
em `duel-server/native/`). O app mobile (`mobile/`) requer o Flutter SDK.

O catálogo completo de comandos está dividido como o resto: os testes em Node e
as bancadas visuais em **`web/CLAUDE.md`**; as suítes do motor (`--test-*`), os
conferidores (`data:check`, `conteudo:check`, `boosters:check`), o
empacotamento e a publicação em **`duel-server/CLAUDE.md`**.

## Dados e persistência

### Cópia local nunca vence a nuvem

O `localStorage` é cópia de TRABALHO. Onde ele é cache, só substitui o valor
local quando a leitura **alcançou** a fonte (`alcancou` em `pullFileEx`) — sem
rede, quem joga fica com o último estado conhecido em vez de cair num padrão
inventado. Isso vale para `npcs`, `npc-base-meta`, `npc-deck-ativo`, `banlist`,
`boosters` e `cardlists`, e é por isso que eles nunca competem com o publicado.

O **rascunho do Deck Estrutural** era a exceção, e custou caro: o boot fazia
`if (!restaurarRascunho()) limpar()`, então a cópia local vencia a nuvem
**sempre**. Um deck editado e publicado numa máquina (o comprador recebe na
hora, pelo gatilho da 0025) abria VELHO ao reabrir o editor noutra, porque ali
havia um rascunho pendurado — e ele só era apagado ao publicar **com sucesso
naquela máquina**, então quem publicou de outro lugar nunca o limpava.

Hoje o rascunho é **arquivado, não carregado**: ao abrir a tela ele vai para
`store/bkp/estrutural-<slug>-<carimbo>.json` e sai do navegador. Nada se perde e
nada compete com o publicado. Se o servidor estiver fora do ar ele **fica** no
navegador para a próxima tentativa — jogá-lo fora ali seria destruir o backup
por falta de servidor.

> `bkp/` é a **única** subpasta que `/__store/` aceita, e a regra está nos DOIS
> back-ends: `safeStorePath` (`tools/serve.mjs`) e `CaminhoStore`
> (`duel-server/src/StaticServer.cs`). Divergir faz a gravação funcionar no
> `npm run dev` e falhar no jogo instalado. O `startsWith`/`StartsWith` continua
> sendo a trava contra `..` — o regex só decide o formato do nome.
> `store/bkp/` está no `.gitignore` (é registro de uma máquina, não conteúdo) e
> sobrevive à atualização, porque `store/` é intocável (`UpdateEngine.Intocaveis`).

### Persistência em três níveis

1. **`localStorage`** — cópia de trabalho, rápida e síncrona. Não viaja entre
   máquinas nem sobrevive a limpar os dados do site.
2. **`decks/*.ydk` e `store/*.json`** — a verdade, versionada no git. Gravados
   pelo dev-server em `/__decks/*` e `/__store/*` — **POST** (gravar) só de
   localhost, sempre; **GET** (ler) libera de qualquer IP da rede quando o
   servidor sobe com `--lan` (é o que o app `mobile/` usa pra listar
   NPCs/decks sem escrever nada).
   Sem servidor no ar, a leitura ainda funciona por HTTP estático e a gravação
   cai para download do arquivo.
3. `.ydk` é o formato do ygopro — o mesmo que o `ocgcore` consome; nossos
   metadados vão em comentários `#chave valor`, que qualquer parser ignora.

Ordem que importa: **hidrate antes de gravar** (`hydrateWallet`, `hydrateBoosters`,
`hydrateDecks`, `loadNpcDecks` no boot da página). Gravar antes de ler é como um
estado vazio sobrescreve dados bons — já aconteceu.

O deck do jogador foi o último a entrar nesse esquema (antes só existia no
`localStorage`, e mudar de máquina mostrava os decks antigos daquele navegador).
`hydrateDecks` (`web/js/storage.js`) faz uma coisa a mais que os outros
`hydrate*`: antes de sobrescrever o cache local ele **migra** todo deck que só
existe naquele navegador para `decks/player/`, sempre num arquivo livre — nunca
por cima de um `.ydk` vindo de outra máquina. Sem servidor no ar ele não faz
nada, de propósito: mexer no `localStorage` sem conseguir ler o disco só
destruiria a cópia de trabalho.

### Dado de conta não vai pro git

`store/accounts/`, `store/users/`, `decks/users/` e `store/sessions.json`
estão no `.gitignore` — ao contrário do resto de `store/`/`decks/` (que é
verdade do jogo versionada de propósito), dado de conta não tem por que ir
pro git. `store/wallet.legacy-backup.json` e `decks/legacy-backup-player/`
são o que existia ANTES do login existir, preservado como histórico —
nenhuma conta nova herda esses dados automaticamente.

## Armadilhas que atravessam as camadas

- **O jogo se chamava Duel Academy.** Virou **Classic Duels** em 17/08/2026, e
  três nomes NÃO acompanharam a troca, cada um por um motivo:
  - a pasta **`duel_academy/`** é o protótipo Unity e a raiz do
    `StreamingAssets` (o `cards.cdb` e os 21 mil `.lua` saem dali, via
    `YGODEMO_PATH`). É caminho de arquivo, não nome de produto;
  - existe uma **carta de verdade chamada "Duel Academy"** (id 5833312) no
    banco. Nunca rode um replace em `ygo-data/`;
  - a pasta de marcadores do instalador (`UpdateEngine.PastaMarcadores`)
    continua **`.duelacademy`**. Ela é invisível e mora DENTRO da instalação, que
    é movida inteira: renomeá-la faria todo cliente instalado concluir que não
    tem nada e rebaixar 28 MB à toa.

  A instalação mudou de `%LOCALAPPDATA%\DuelAcademy` para `…\ClassicDuels`, com
  migração no primeiro boot (`Payload.MigrarInstalacaoAntiga`) — dentro dela
  moram os `decks/` e o `store/`, que são de quem joga. Nunca sobrescreve e
  nunca apaga; falhar ali só significa instalar do zero. Coberto por
  `--test-update`.
- **`store/*.json` nascem sozinhos enquanto se joga e são fáceis de esquecer
  como untracked.** Depois de mexer na Loja/Booster Builder, confira `git status`.
- **`.gitignore`:** não adicione `*.csproj`/`*.sln` — `duel-server` e `launcher`
  são projetos .NET de verdade e precisam ser versionados.
- Pegadinhas do formato dos dados (`level` empacota 3 valores, `def` guarda link
  markers em Link, `atk == -2` significa "?", `alias != 0` quer dizer que o
  **nome** é tratado como o de outra carta — e isso é arte alternativa só quando
  o nome BATE; com nome diferente é carta distinta, com efeito e Lua próprios,
  então use `isAlternateArt`/`alt` e nunca `alias != 0` na mão) estão em `ygo-data/README.md` — leia antes de tocar em decodificação.

## Onde ler antes de mexer

- **`web/CLAUDE.md`** — obrigatório antes de tocar em `web/`. Traz o catálogo
  dos testes em Node (cada um documentando o bug real que o originou), a
  arquitetura das telas, e as armadilhas de CSS/DOM que erram **caladas**.
- **`duel-server/CLAUDE.md`** — obrigatório antes de tocar em `duel-server/`,
  `supabase/migrations/` ou `tools/`. Traz as suítes do motor, as regras do
  `NpcBrain`, o instalador/updater e o ritual de publicar.
- **`DUEL-TRAINING-HANDOFF.md`** — obrigatório para qualquer trabalho no duelo.
  Traz o protocolo binário do ocgcore decifrado empiricamente (tamanhos de
  entrada por mensagem, formato de resposta de cada seleção, os bugs que cada um
  causa), as regras do `NpcBrain` e a lista do que falta. Um tamanho errado de
  entrada desalinha o parse **sem erro nenhum** — o sintoma aparece turnos depois.
- **`INSTALADOR.md`** — obrigatório antes de mexer em `duel-server/src/update/` ou
  em `tools/publish-release.ps1`. Traz o schema do manifesto, a divisão por
  volatilidade, as travas de dado de conta e o porquê da limpeza por inventário.
  **`INSTALADOR-PENDENCIAS.md`** é o par dele: o que ficou faltando, por impacto
  no jogador. A atualização fantasma, a trava do update durante duelo, a poda dos
  backups, o caminho de volta e os testes offline/selfupdate já foram fechados —
  o que sobra é publicar um Release com `-ComExe` (a única parte da troca do exe
  que não dá para testar localmente) e decidir se `decks/npc/*.ydk` passam a
  viajar no Release. **Não rode `git init` aqui** — esta pasta é cópia de
  trabalho; o repositório fica na pasta original (§13 do documento).
  `MECANISMO-INSTALADOR.md` é o documento genérico de origem (instalador do
  Souls Craft), útil como referência do mecanismo em abstrato.
- **`CONTEUDO-COMPRADO-E-ATUALIZADO.md`** — o que fazer com quem já pagou no dia
  em que o conteúdo muda. A trava de 1 por conta (`compras_estruturais`, PK
  composta) é permanente, e por isso editar um Deck Estrutural já vendido era
  uma armadilha silenciosa. **Desde a migration 0025 não é mais:** um gatilho
  (`decks_estruturais_sincroniza`) credita na Coleção de quem comprou as cartas
  que ENTRARAM na versão nova e troca a cópia do deck dele — a não ser que ele
  tenha customizado, caso em que só as cartas vão (o deck dele é dele). Carta
  removida nunca é tomada de volta. O documento continua obrigatório pela
  decisão editorial que nenhum código resolve: **errata × nova edição** — a
  segunda é `id` novo e custa zero.
- **`TAGFORCE-BATALHA.md`** — o que a batalha do Tag Force 1 é por dentro (ela é 2D,
  sem modelo 3D nenhum) e o timing exato de cada animação, lido do ISO. Os
  formatos byte a byte estão em `tools/tagforce/README.md`.
- **`MUNDO-3D-HANDOFF.md`** — obrigatório antes de mexer no **Mundo**
  (`web/mundo3d.html`, `floresta*.js`, `boneco3d.js`, `mundovivo.js`) ou em
  `web/vendor/`. Autocontido, escrito para uma sessão nova em outra máquina:
  por que o three é VENDORIZADO e não vem de CDN, a divisão decide/desenha/loop
  (e por que os dois primeiros não podem encostar em DOM — é o que deixa a cena
  ser montada em Node no teste), as doze armadilhas do three que erram CALADAS,
  as DUAS decisões que mandam (uma conta de altura só; a cadência do envio da
  posição), o que os 49 testes guardam, e o que foi decidido de propósito para
  ninguém "consertar" depois — inclusive por que os NPCs estão desligados ali.
  **O §9.0 é a única parte não verificada por teste** (o canal de transmissão
  ao vivo) e traz como conferir em cinco minutos. `web/vendor/README.md` é o par
  dele: como atualizar o three e o que a atualização quebra em silêncio.
- `decks/README.md`, `store/README.md`, `boards/README.md`, `ygo-data/README.md`
  — formato e contrato de cada pasta.
- `continue.md` é local (gitignored) e **parcialmente desatualizado**: a seção
  "não existe duelo ainda" foi superada pelo `duel-server`. Vale pelas armadilhas
  do protótipo Unity e do formato dos dados.
- `duel_academy/` é o protótipo Unity que provou a integração com o `ocgcore` e
  a origem dos dados. Não é alvo de trabalho; `duel-server/src/*.cs` são as
  versões portadas e depuradas dos quatro `.cs` de lá.

## Agentes

Três agentes em `.claude/agents/` (`frontend`, `backend`, `arquiteto`) — cada um
já sabe qual CLAUDE.md ler e o que não pode fazer. Quem faz o quê, quando NÃO
chamar cada um, os dois modos (`/agent1`, `/bug`) e como acrescentar um:
**`AGENTES.md`**.

## Commits

Conventional Commits com escopo, no imperativo e **sem acentos no assunto**:
`feat(booster): trava a raridade do reprint e da ordem a vitrine`. O histórico é
misto EN/PT (os recentes em PT). Ver `duel_academy/commit_guide.md`.
