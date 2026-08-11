# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Documentação e comentários do projeto são em **português**. Siga a língua do
> arquivo que você está editando.

## Comandos

```bash
npm run dev                  # front estático em http://localhost:8080 (Node puro, zero deps)
cd duel-server && dotnet run -- --serve   # motor de duelo em http://localhost:8770

node web/js/deck.test.mjs    # 33 testes das regras de construção de deck
node web/js/banlist.test.mjs # 24 testes da banlist (Ponto/Banlist/Lista compartilhada)
node web/js/automontagem.test.mjs  # 18 testes da Auto montagem (curva, ritual, fusão)
node web/js/ponte.test.mjs   # 13 testes da perspectiva do multiplayer (virar a mesa)
node web/js/cardlists.test.mjs  # 15 testes das listas de cartas (pool permitido + resolução)
node web/js/estrutural.test.mjs # 7 testes do rascunho do Deck Estrutural (não perder deck)
npm run data:check           # integridade do banco de cartas (5 checagens)
npm run data:build           # regenera ygo-data/data a partir do cards.cdb (precisa de Python 3)

npm run duel:build           # para o servidor e compila o duel-server
npm run duel:test            # para, compila e roda --test-npc + --test-summons
npm run stop                 # encerra front e duel-server de forma limpa

npm run launcher:build       # gera duel-academy.exe / duel-academy-stop.exe (SDK .NET 8)
npm run pack                 # gera dist/DuelAcademy.exe (jogo inteiro num arquivo)
                             # EXIGE um `npm run release:build` antes — o payload embutido
                             # é feito dos MESMOS game.zip/cards.zip do Release, senão a
                             # instalação nova oferece uma atualização do que ela já tem

npm run update:test          # 79 asserções do instalador/auto-updater (sem rede):
                             # --test-update + --test-offline + --test-selfupdate
                             #   + --test-update-duelo
npm run release:build        # DRY-RUN: gera dist/release/ (game.zip, cards.zip, manifest.json)
npm run release:test         # instala esses artefatos numa raiz descartável e confere
npm run release:publish      # sobe o Release para o repo privado de distribuição
                             # -- -PodarReleases 5 apaga as tags antigas (opt-in)
                             # --test-remote (na mão) baixa o Release publicado e instala

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
`--test-leitura` (a LEITURA do NPC — ele enxerga de propósito a mão do oponente
e as cartas baixadas: batalha contra o monstro setado pela DEF real, a "isca"
que impede o jogador de puxar a negação com uma carta média, remoção que mira na
carta que atrapalha, e a regra de não pôr o 2º corpo em campo contra um Raigeki
conhecido; o duelo real no fim prova que essa visão chega mesmo ao cérebro —
sem ela as regras somem em silêncio),
`--test-counter` (as armadilhas de CONTRA do NPC: o que vale negar, com qual
carta e a que preço — e, nos dois duelos reais, que o contexto da janela de
corrente chega mesmo, isto é, QUE invocação/magia abriu a janela; sem esse
contexto o NPC não nega nada e nenhuma regra acusa),
`--test-fusion` (Extra Deck + Polymerization + busca no deck), `--test-grave`
(saída do cemitério), `--test-chain` (corrente de armadilhas), `--test-equip`,
`--test-kaiba` e `--test-joey` (decks completos dos NPCs jogando sozinhos),
`--test-dust` (Dust Tornado/remoção de magia-armadilha), `--test-synchro`
(Invocação-Sincro pelo Extra Deck + negação do Stardust Dragon via corrente),
`--test-xyz` (Invocação-Xyz + desanexação de material do Number 39: Utopia),
`--test-fieldbonus` (Bônus de Campo do editor de tabuleiro: Forest injetada
ativa dá +200 de ATK de verdade a um Inseto, consultado no motor E o evento
`stats` que acende o destaque de ATK em `duel.html` chega sozinho ao entrar
em campo, sem precisar de equipamento), `--test-toon`
(NpcBrain ativa Toon World e invoca especialmente — `spsummon` — os Toons
"clássicos" da mão, ex.: Toon Mermaid/Toon Summoned Skull), `--test-weevil`
(as cartas COM EFEITO que o deck do Weevil trouxe pra Lista 1: Cocoon of
Evolution equipado troca o ATK do Petit Moth, Insect Imitation invoca do deck,
o equipamento de Inseto dá +700, e as três mariposas só ficam invocáveis no
2º/4º/6º turno com o casulo — contagem lida do próprio motor),
`--test-equip-classicos` (os dois ciclos completos de equipamento da Lista 1,
+300 por Tipo e +400/−200 por Atributo: cada carta equipada no monstro certo,
ATK conferido no motor — um equipamento sem alvo válido nunca é oferecido pelo
core e ficaria morto na lista sem ninguém notar), `--test-weevil-npc`
(o `NpcBrain` sozinho, sem script — invoca o Petit Moth em ATAQUE, não
setado, porque o Lua do Cocoon de Evolução só aceita alvo com a face para
cima; equipa o casulo no inseto certo sem desperdiçar uma segunda cópia no
mesmo alvo, o que reseta a contagem de turnos; e chega a Invocar
Especialmente uma mariposa de verdade — `--test-weevil` já provava que as
cartas rodam certo quando ALGUÉM manda ativar, este prova que o NPC decide
sozinho).
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
pode reger, e a camada de persistência delas. Uma lista tem duas partes: os
**tipos por regra** (os `tl` que entram em bloco — `Normal Monster`, `Fusion
Monster`; não dá pra listar 1005 monstros à mão) e as **cartas avulsas**
(magia, armadilha, Sincro, Xyz, escolhidas uma a uma). O `lista1.js` acima é
só o **padrão de fábrica**: a verdade viva é publicada no Supabase e entra
por `hydrateCardLists()` no boot de quem filtra pelo pool (Deck Builder,
Booster Builder, Deck Estrutural, Banlist).

Editado em **`web/listas.html`** (Área de Teste), no mesmo molde de duas
colunas da Banlist — pool à direita com o filtro completo do Deck Builder
(nome, tipo, atributo, raça, arquétipo, tag, raridade, nível, ATK/DEF,
banlist) mais um de **pertinência** (dentro/avulsa/fora da lista
selecionada). Salvar grava as DUAS chaves de uma vez:
`conteudo/cardlists` (a fonte, espelhada em `store/cardlists.json`) e
`conteudo/<id da lista>` (o **resultado resolvido** contra o banco de
cartas). São duas porque `salvar_deck` roda no Postgres, que não tem o banco
de cartas e não consegue avaliar "todo monstro Normal" — quem resolve a
regra é o navegador, que tem o índice. Antes disto, acrescentar uma carta à
Lista 1 era editar `lista1.js`, rodar `tools/publicar-conteudo.mjs` e
publicar um Release. Qual lista vale no servidor sai do `listId` da banlist
(`lista_ativa()`, migration 0020), não mais de um `'lista1'` escrito na mão.
Só admin publica (RLS `eh_admin()`); a chave da lista tem que casar
`^lista[a-z0-9-]{0,31}$`, e o editor já gera o slug assim.

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

Os `boards/*.json` **viajam dentro do `game.zip`** (pacote `game`, ver
`tools/publish-release.ps1`). Isso não é detalhe: até 11/08/2026 eles não
viajavam em lugar nenhum, e o jogo instalado não tinha a pasta `boards/` —
`/__boards/list` voltava vazio, `duel.html` caía no layout padrão do
`boards.js` e o Bônus de Campo do adversário sumia. No `npm run dev` sempre
funcionou (o servidor lê a pasta do repositório), então o buraco só aparecia
no `.exe`. A limpeza é por inventário, então tabuleiro criado pelo JOGADOR no
editor sobrevive à atualização.

Um tabuleiro também pode fixar um **Bônus de Campo** (`fieldSpell` no JSON,
escolhido no editor entre os 6 campos básicos da Lista 1): a magia de campo
de verdade entra ativada antes do duelo começar
(`DuelSession.InjectField`), tipo "campo de Floresta do Weevil" no anime —
sem simular efeito nenhum, é o Lua da própria carta.

Todo NPC — os 3 fixos da fase 1 e os customizados (`web/npcs.html` →
`web/js/npcs.js`) — pode ter `level` (**`iniciante`** ou `avancado`),
`campaign` (nome livre) e `board` (path de um
`boards/*.json`), editáveis a qualquer momento pelo botão "editar
configurações" de cada card — base da campanha estilo Reino dos Duelistas.
Os 3 fixos guardam esses campos num overlay à parte
(`store/npc-base-meta.json`, já que `BASE_NPCS` é um array const no código)
em vez de junto do registro deles; nome/tema desses 3 continuam fixos, só
nível/campanha/tabuleiro mudam.

O **nível** é a dificuldade do adversário, e a diferença entre os dois é uma
só: o `avancado` **lê** a mão e as cartas baixadas do jogador (e por isso não
cai em isca de negação, não ataca a parede virada e não se estende contra um
Raigeki que viu); o `iniciante` decide só com o que está à vista. Os dois jogam
pelas mesmas regras — ver "Leitura" no `DUEL-TRAINING-HANDOFF.md`. Viaja no
`POST /start` como `npcLevel`; sem o campo, o servidor assume iniciante, que é
o que todo NPC criado antes disto existir continua sendo. A dificuldade mora
num ponto só (qual acesso é plugado no `NpcBrain`), nunca em `if` espalhado
pelas regras. Na lista do jogador, só o avançado ganha etiqueta — ele precisa
saber, antes de entrar, que aquele adversário lê a mão dele.

`web/adversario.html` (a página do jogador, e a **porta de entrada** dos
adversários a partir da home) é organizada só por campanha — sem lista "todos" solta — com uma seção "Sem
campanha" para quem ainda não tem uma definida. Em `duel.html`, o tabuleiro
do NPC (`advNpc.board`) manda mais que o `ygo:activeBoard` global, então cada
adversário duela sobre o próprio campo sem o jogador precisar ativar nada.

### Mundo andável (mapa mundi + cenários) — **em standby**

O **mapa mundi** (`web/mundo.html`) são nós de cenário ligados por uma estrada,
cada um levando a um **cenário andável** (`web/cidade.html`) no estilo Tag
Force — você caminha (WASD/setas) até um duelista e aperta espaço pra abrir o
duelo. Ele chegou a ser a porta de entrada dos adversários, mas **hoje está em
standby na Área de Teste** (`teste.html` → "Mundo andável"): o fluxo do jogador
voltou a ser a grade de cards de `adversario.html`, que é para onde a home
aponta. O código continua inteiro e funcionando — pra devolvê-lo ao jogador
basta apontar o `btn-adv` de `index.html` de volta para `/web/mundo.html`. O
duelo em si é o mesmo `duel.html?npc=<id>` nos dois caminhos.

- `web/js/world.js` — registro de cenários. Um cenário RESERVA nomes de
  campanha (`claims`): todo NPC com uma dessas campanhas mora nele, e quem não
  casa com nenhuma (inclusive quem não tem campanha) cai na `cidade`. Foi de
  propósito que isso não exigiu migrar dado nenhum — dar à campanha o nome do
  `claims` já muda o NPC de cenário. **O desbloqueio ainda é fixo (`locked`)**:
  não existe sistema de missão/progresso, então `isUnlocked()` é o único ponto
  a trocar quando existir.
- `web/js/citymap.js` — os mapas. O chão NÃO é escrito tile a tile: é um fundo
  mais uma lista de "pinceladas" (retângulos/elipses) aplicadas em ordem, mais
  os objetos e as vagas (`spots`) onde os NPCs ficam de pé.
- `web/js/tileset.js` e `web/js/actors.js` — **a arte é pixel art gerada em
  código**, sem nenhum arquivo de imagem (o front tem zero dependências). Cada
  tile/prédio/boneco é pintado uma vez num canvas fora da tela no boot; o loop
  só copia. Os bonecos são grades de TEXTO (1 caractere = 1 pixel), montadas em
  cabeça + tronco + pernas pra não precisar manter 16 desenhos em sincronia.

O mundo roda num canvas de resolução **lógica** (320x180) ampliado por CSS com
`image-rendering: pixelated` — todas as contas de `cidade.js` são em pixel
lógico. Só as etiquetas de nome são DOM por cima do canvas, pra o texto não
escalar junto e virar borrão. A ordem de desenho é pela linha do "pé" de cada
coisa, que é o que faz o jogador passar atrás da casa e na frente dela sem
nenhuma lógica de camada.

> Ao mexer nos mapas, confira que nenhum objeto ficou com o pé na água/fora do
> mapa e que todo `spot` continua livre e alcançável a pé a partir do `spawn` —
> um NPC preso dentro de uma parede não dá erro nenhum, só é impossível de
> alcançar. `buildMap()` já descarta `spot` em cima de sólido, mas não avisa.

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

**`duel-server/src/update/`** — o instalador/auto-updater. Um manifesto no
GitHub descreve o estado desejado; o cliente compara com o disco e baixa só a
diferença. O conteúdo é dividido **por volatilidade**: `game.zip` (front +
índices, 0,8 MB, muda todo dia) e `cards.zip` (`cards.json` + `cards.cdb` +
20.949 scripts Lua, 24,9 MB, quase nunca muda), cada um versionado por um
marcador de conteúdo — assim publicar um ajuste de front custa 0,8 MB ao
jogador em vez dos 64 MB do exe inteiro. `store/`/`decks/` são **intocáveis
por código** (guardam conta de gente), mesmo que um manifesto peça. A limpeza
é por **inventário** (`.duelacademy/<id>.files`), não varrendo as `roots`:
`game` e `cards` dividem a pasta `ygo-data/data`, e varrer fazia o segundo
apagar em silêncio o que o primeiro instalou.

No boot do `--app` (só com payload embutido — em desenvolvimento `appRoot` é o
repositório, e atualizar ali sobrescreveria seu código-fonte; `--sem-update`
pula) o `UpdateService` checa com timeout de 8s e falha silenciosa: offline
nunca trava o jogo. Havendo novidade, o navegador abre em
`web/atualizando.html`, que consulta `/__update/status` e dispara
`/__update/aplicar` (só localhost, mesmo com `--lan`). O `SelfUpdater` troca o
próprio exe por um `.bat` que espera o PID morrer — e **apaga o
`Zone.Identifier` do exe baixado**, senão cai no erro 1223 já conhecido do
launcher. Ver **`INSTALADOR.md`**.

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

### Conta (login/registro)

`store/wallet.json` e `decks/player/*.ydk` viraram dado de **conta**, não da
aplicação: pertencem a `store/users/<usuário>/wallet.json` e
`decks/users/<usuário>/player/*.ydk`, e exigem sessão pra ler/gravar — o
resto de `store/` (`banlist.json`, `boosters.json`, `npcs.json`) e
`decks/npc/*` continuam globais, sem sessão nenhuma. `web/js/auth.js`
(`register`/`login`/`logout`/`me`/`requireLogin`) fala com `/__auth/*`, que
`tools/serve.mjs` **e** `duel-server/src/StaticServer.cs` implementam em
paralelo (mesmo algoritmo — PBKDF2-HMAC-SHA256, 210 mil iterações — e mesmo
formato de arquivo nos dois, então uma conta funciona idêntica em qualquer
um dos dois back-ends). Sessão por cookie httpOnly (`store/sessions.json`);
como o front sempre fala com o mesmo origin da API, `fetch` já manda o
cookie sozinho, sem precisar mexer em nenhuma chamada existente.

`requireLogin()` no boot de `index/loja/deck/inventario/adversario/duel.html`
redireciona pra `web/login.html` sem sessão. `deck.html` só exige login FORA
do modo NPC (`?npc=<id>` edita o deck do ADVERSÁRIO, não mexe em nada seu);
`npcs.html`/`campo.html`/`banlist.html` (Área de Teste) não pedem login —
são ferramenta de configuração do jogo, não progresso de ninguém.

`store/accounts/`, `store/users/`, `decks/users/` e `store/sessions.json`
estão no `.gitignore` — ao contrário do resto de `store/`/`decks/` (que é
verdade do jogo versionada de propósito), dado de conta não tem por que ir
pro git. `store/wallet.legacy-backup.json` e `decks/legacy-backup-player/`
são o que existia ANTES do login existir, preservado como histórico —
nenhuma conta nova herda esses dados automaticamente.

## Armadilhas conhecidas

- **Caminhos são absolutos** (`/web/js/...`) e o dev-server redireciona `/` com
  302 de verdade. Servir o HTML direto em `/` faz os módulos darem 404 e a página
  morre em silêncio. Não troque por relativos.
- **Marca da Web (erro 1223).** Arquivo que veio de fora da máquina carrega o
  fluxo `Zone.Identifier`; o `Spawn` do launcher usa ShellExecute com janela
  oculta, então o Windows cancela sem perguntar nada e o sintoma é
  `nao consegui iniciar o duel-server: … A operação foi cancelada pelo usuário`.
  O launcher detecta esse erro, explica e **pede autorização** antes de remover
  a marca (`OfferUnblock` em `launcher/Program.cs`). Na mão:
  `Get-ChildItem duel-server\bin -Recurse -File | Unblock-File`.
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
- **`TAGFORCE-BATALHA.md`** — o que a batalha do Tag Force 1 é por dentro (ela é 2D,
  sem modelo 3D nenhum) e o timing exato de cada animação, lido do ISO. Os
  formatos byte a byte estão em `tools/tagforce/README.md`.
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
