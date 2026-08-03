# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Documentação e comentários do projeto são em **português**. Siga a língua do
> arquivo que você está editando.

## Comandos

```bash
npm run dev                  # front estático em http://localhost:8080 (Node puro, zero deps)
cd duel-server && dotnet run -- --serve   # motor de duelo em http://localhost:8770

node web/js/deck.test.mjs    # 23 testes das regras de construção de deck
node web/js/banlist.test.mjs # 24 testes da banlist (Ponto/Banlist/Lista compartilhada)
npm run data:check           # integridade do banco de cartas (5 checagens)
npm run data:build           # regenera ygo-data/data a partir do cards.cdb (precisa de Python 3)

npm run duel:build           # para o servidor e compila o duel-server
npm run duel:test            # para, compila e roda --test-npc + --test-summons
npm run stop                 # encerra front e duel-server de forma limpa

npm run launcher:build       # gera duel-academy.exe / duel-academy-stop.exe (SDK .NET 8)
npm run pack                 # gera dist/DuelAcademy.exe (jogo inteiro num arquivo)

cd duel-server && dotnet run -- --app --lan   # o mesmo --app, mas alcançável de outro
                                                # aparelho na rede (app mobile) — ver mobile/README.md
cd mobile && flutter pub get && flutter run   # app mobile (cliente fino do duel-server)
```

Não existe `npm install` — o front tem **zero dependências**. Requer Node >= 18;
o duelo requer .NET 8 e **Windows x64** (`ocgcore.dll`/`sqlite3.dll` são nativas,
em `duel-server/native/`). O app mobile (`mobile/`) requer o Flutter SDK.

**Rodar um teste isolado do duelo:** cada suíte é uma flag do binário em
`.\duel-server\bin\Debug\net8.0\win-x64\duel-server.exe`:
`--test-npc` (regras do NPC), `--test-summons` (tributo/ritual), `--test-battle`,
`--test-fusion` (Extra Deck + Polymerization + busca no deck), `--test-grave`
(saída do cemitério), `--test-chain` (corrente de armadilhas), `--test-equip`,
`--test-kaiba` e `--test-joey` (decks completos dos NPCs jogando sozinhos),
`--test-dust` (Dust Tornado/remoção de magia-armadilha), `--test-synchro`
(Invocação-Sincro pelo Extra Deck + negação do Stardust Dragon via corrente),
`--test-xyz` (Invocação-Xyz + desanexação de material do Number 39: Utopia),
`--test-fieldbonus` (Bônus de Campo do editor de tabuleiro: Forest injetada
ativa dá +200 de ATK de verdade a um Inseto, consultado no motor), `--test-toon`
(NpcBrain ativa Toon World e invoca especialmente — `spsummon` — os Toons
"clássicos" da mão, ex.: Toon Mermaid/Toon Summoned Skull), `--test-weevil`
(as cartas COM EFEITO que o deck do Weevil trouxe pra Lista 1: Cocoon of
Evolution equipado troca o ATK do Petit Moth, Insect Imitation invoca do deck,
o equipamento de Inseto dá +700, e as três mariposas só ficam invocáveis no
2º/4º/6º turno com o casulo — contagem lida do próprio motor),
`--test-equip-classicos` (os dois ciclos completos de equipamento da Lista 1,
+300 por Tipo e +400/−200 por Atributo: cada carta equipada no monstro certo,
ATK conferido no motor — um equipamento sem alvo válido nunca é oferecido pelo
core e ficaria morto na lista sem ninguém notar).
As sondas do protocolo binário são `--probe-idle`, `--probe-pos`, `--probe-battle`,
`--probe-chain`, `--probe-tribute`, `--brute-tribute`, e `--selfplay` despeja as
mensagens cruas do motor. `npm run duel:test` só roda `--test-npc` +
`--test-summons`; as outras suítes precisam ser chamadas na mão (ver
`package.json`).

> **Compile sempre com o servidor parado.** O `.exe` fica travado enquanto roda,
> o `dotnet build` falha *e o teste seguinte roda o binário antigo* — parece que a
> mudança não funcionou. Use `npm run duel:build` / `npm run duel:test`, que
> derrubam o servidor antes.

## Arquitetura

Três camadas independentes, unidas por HTTP local:

**`web/`** — o jogo. HTML/CSS/JS puro, ESM, sem framework nem build step. Uma
página por tela (`index`, `deck`, `booster`, `loja`, `inventario`, `npcs`,
`adversario`, `duel`, `teste` — Área de Teste, separada da home real) e um
módulo por assunto em `web/js/`. Os módulos-base são `deck.js` (regras
oficiais de construção, sem DOM, testável em Node — tudo depende dele),
`boosters.js` (raridade UR/SR/R/N), `wallet.js` (DP + coleção) e `npcs.js`. As
artes vêm do ygoprodeck.com sob demanda — sem internet as cartas ficam em
branco, mas o resto funciona.

`web/js/lista1.js` define a **Lista 1**: o pool restrito da fase 1 (jogador e
os 3 NPCs jogam só com isto) — todos os monstros Normais (vanilla) do banco
mais uma seleção fixa de magia/armadilha por ID. São cartas reais e clássicas
escolhidas por já terem Lua pronto no `ocgcore`, então nenhum efeito precisa
ser escrito à mão.

`web/js/cardlists.js` é o registro de **listas de cartas** que uma banlist
pode reger — hoje só a Lista 1, mas o desenho escala: pra adicionar uma
"Lista 2" basta um novo arquivo com sua função de filtro (formato de
`inLista1`) e uma entrada no registro.

`web/js/banlist.js` é uma camada **opcional** por cima da lista escolhida
(`banlist.listId`) — não mexe nas regras oficiais de `deck.js` (min/max, 3
cópias continuam sempre valendo). Três regras independentes, aplicadas
juntas: **Ponto** (uma carta tagueada custa X pontos POR CÓPIA; a soma de
Main+Extra não passa do orçamento), **Banlist** (o limitado/semilimitado
oficial do TCG — cada carta tem seu PRÓPRIO teto de 1 ou 2, sem dividir com
nenhuma outra) e **Lista compartilhada** (um número N em 2+ cartas faz elas
DIVIDIREM N cópias no total entre si — ex.: Pote da Ganância e Foolish
Burial os dois em "2" = só 2 cópias somando os dois, não 2 de cada; é o que
a Banlist normal não consegue expressar). Editado em `web/banlist.html`
(Área de Teste), no mesmo molde de duas colunas do Deck Builder: à esquerda
os **campos de regra** (criados vazios e depois preenchidos), à direita o
pool completo (mesmo filtro do Deck Builder — nome, tipo, atributo, raça,
arquétipo, tag, raridade, nível, ATK/DEF); clique num campo pra selecioná-lo,
clique numa carta do pool pra atribuir. O Deck Builder mostra a violação no
status quando a Lista 1 está marcada — pro jogador isso nunca pode ser
ignorado, mas o modo NPC do builder tem um checkbox "ignorar banlist" (dá
mais liberdade pros decks de adversário). Persiste em `store/banlist.json`
via a API genérica `/__store/`, sem rota nova.

`web/js/customcards.js` importa cartas de um "card maker" externo (nome, tipo,
ATK/DEF, arte) para o Deck Builder. Isso só monta o **esqueleto** da carta —
o `ocgcore` roda Lua e o card maker não gera Lua, então toda carta importada
nasce com a tag `sem-efeito` e não pode ser usada num duelo de verdade. IDs
começam em `900000000` (acima de qualquer carta real) para nunca colidir com
o banco do `ygo-data`.

**`web/campo.html`** é o editor de campo (estilo *scene* do Unity): desenha
layouts de tabuleiro arrastando/redimensionando as zonas que o `ocgcore`
realmente entende (monstro, magia/armadilha, campo, deck, extra, cemitério,
mão — por jogador), com snapping de tamanho/espaçamento. Salva em
`boards/*.json` (mesmo padrão de `decks/`, ver `boards/README.md`). Qual
tabuleiro está *ativo* é preferência local (`localStorage: ygo:activeBoard`,
não conteúdo do jogo) — o `duel.html` lê essa chave no boot e, se apontar
para um tabuleiro salvo, sobrepõe posição/tamanho customizados no layout
flexbox de sempre; sem tabuleiro ativo, nada muda. O motor de arrastar/snap
mora em `web/js/campoeditor.js`; o schema das zonas e o gerador do layout
padrão, em `web/js/boards.js`.

Um tabuleiro também pode fixar um **Bônus de Campo** (`fieldSpell` no JSON,
escolhido no editor entre os 6 campos básicos da Lista 1): a magia de campo
de verdade entra ativada antes do duelo começar
(`DuelSession.InjectField`), tipo "campo de Floresta do Weevil" no anime —
sem simular efeito nenhum, é o Lua da própria carta.

Todo NPC — os 3 fixos da fase 1 e os customizados (`web/npcs.html` →
`web/js/npcs.js`) — pode ter `campaign` (nome livre) e `board` (path de um
`boards/*.json`), editáveis a qualquer momento pelo botão "editar
configurações" de cada card — base da campanha estilo Reino dos Duelistas.
Os 3 fixos guardam esses dois campos num overlay à parte
(`store/npc-base-meta.json`, já que `BASE_NPCS` é um array const no código)
em vez de junto do registro deles; nome/tema desses 3 continuam fixos, só
campanha/tabuleiro mudam. `web/adversario.html` (a página do jogador) é
organizada só por campanha — sem lista "todos" solta — com uma seção "Sem
campanha" para quem ainda não tem uma definida. Em `duel.html`, o tabuleiro
do NPC (`advNpc.board`) manda mais que o `ygo:activeBoard` global, então cada
adversário duela sobre o próprio campo sem o jogador precisar ativar nada.

**`duel-server/`** — .NET 8 que hospeda o `ocgcore` (edo9300) via P/Invoke e o
expõe como **RPC HTTP** em 8770: `POST /start {deck,npcDeck?,seed?,flags?,npc?}`
e `POST /respond {action,arg,args?}` → `{events:[…], question:{…}|null, ended}`.
`InteractiveDuel.cs` é o coração: avança o motor até a *sua* decisão, resolve
sozinho o que não é decisão (correntes, posição, oponente) e traduz o buffer
binário em eventos + a pergunta pendente. `NpcBrain.cs` é a IA do adversário —
regras explícitas e ordenadas, cada jogada emite um evento com o `why`.

**`ygo-data/`** — dataset gerado (`tools/build.py`) do `cards.cdb`: 13.728 cartas
em JSON, índice enxuto de 2 MB para o browser, 12.702 scripts Lua. `src/ygodb.js`
é a API de consulta (ESM, Node e browser). É camada de **dados**, não de regras.

> **As regras do Yu-Gi-Oh! *são* o `ocgcore` mais os scripts Lua.** Nunca
> reimplemente regra do lado de fora: se um monstro pode ou não mudar de posição,
> se uma armadilha pode ser ativada — o motor já responde isso nas listas que
> manda. Desenhe o que ele ofereceu.

O `duel-server` também sabe servir o front sozinho (`StaticServer.cs`,
modo `--app`), que é como o `dist/DuelAcademy.exe` roda tudo num processo só,
com o payload embutido instalado em `%LOCALAPPDATA%\DuelAcademy\game`.

**`mobile/`** — app Flutter, **cliente fino** do MESMO `duel-server` (fala o
mesmo RPC `/start`/`/respond` que `web/duel.html`, nenhuma regra reimplementada
— o `ocgcore` só existe como DLL Windows, então o motor continua no PC). Por
padrão o servidor só aceita `localhost`; a flag `--app --lan` (`Program.cs`)
abre pra rede local, imprimindo o IP pro celular digitar nas Configurações do
app. Ver `mobile/README.md`. É uma segunda casca por cima da mesma engine —
`web/` continua existindo do jeito que sempre foi, sem nenhuma dependência
nova.

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

## Armadilhas conhecidas

- **Caminhos são absolutos** (`/web/js/...`) e o dev-server redireciona `/` com
  302 de verdade. Servir o HTML direto em `/` faz os módulos darem 404 e a página
  morre em silêncio. Não troque por relativos.
- **`store/*.json` nascem sozinhos enquanto se joga e são fáceis de esquecer
  como untracked.** Depois de mexer na Loja/Booster Builder, confira `git status`.
- **`.gitignore`:** não adicione `*.csproj`/`*.sln` — `duel-server` e `launcher`
  são projetos .NET de verdade e precisam ser versionados.
- Pegadinhas do formato dos dados (`level` empacota 3 valores, `def` guarda link
  markers em Link, `atk == -2` significa "?", `alias != 0` é arte alternativa sem
  script) estão em `ygo-data/README.md` — leia antes de tocar em decodificação.
- O pool do builder renderiza no máximo `MAX_RENDER` (240) miniaturas de 13.728.

## Onde ler antes de mexer

- **`DUEL-TRAINING-HANDOFF.md`** — obrigatório para qualquer trabalho no duelo.
  Traz o protocolo binário do ocgcore decifrado empiricamente (tamanhos de
  entrada por mensagem, formato de resposta de cada seleção, os bugs que cada um
  causa), as regras do `NpcBrain` e a lista do que falta. Um tamanho errado de
  entrada desalinha o parse **sem erro nenhum** — o sintoma aparece turnos depois.
- `decks/README.md`, `store/README.md`, `boards/README.md`, `ygo-data/README.md`
  — formato e contrato de cada pasta.
- `continue.md` é local (gitignored) e **parcialmente desatualizado**: a seção
  "não existe duelo ainda" foi superada pelo `duel-server`. Vale pelas armadilhas
  do protótipo Unity e do formato dos dados.
- `duel_academy/` é o protótipo Unity que provou a integração com o `ocgcore` e
  a origem dos dados. Não é alvo de trabalho; `duel-server/src/*.cs` são as
  versões portadas e depuradas dos quatro `.cs` de lá.

## Commits

Conventional Commits com escopo, no imperativo e **sem acentos no assunto**:
`feat(booster): trava a raridade do reprint e da ordem a vitrine`. O histórico é
misto EN/PT (os recentes em PT). Ver `duel_academy/commit_guide.md`.
