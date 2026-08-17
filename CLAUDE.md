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
node web/js/ponte.test.mjs   # 14 testes da perspectiva do multiplayer (virar a mesa)
node web/js/correntes.test.mjs # 16 testes do modo das correntes (desligado/auto/sempre)
node web/js/filavisoes.test.mjs # 9 testes da fila de visões (concorrência do multiplayer:
                             # a visão que chega no meio da aplicação da anterior)
node web/js/drops.test.mjs   # 15 testes do drop por NPC (pool por raridade + a % de cada uma)
node web/js/cardlists.test.mjs  # 15 testes das listas de cartas (pool permitido + resolução)
node web/js/estrutural.test.mjs # 7 testes do rascunho do Deck Estrutural (não perder deck)
npm run data:check           # integridade do banco de cartas (5 checagens)
npm run boosters:check       # cruza os boosters PUBLICADOS com a lista ativa —
                             # acusa carta que o jogador compra e não pode jogar
npm run data:build           # regenera ygo-data/data a partir do cards.cdb (precisa de Python 3)

npm run duel:build           # para o servidor e compila o duel-server
npm run duel:test            # para, compila e roda --test-npc + --test-summons
npm run stop                 # encerra front e duel-server de forma limpa

node tools/gerar-icone.mjs   # redesenha assets/icone.ico + web/img/icone.png
                             # (o ícone é CÓDIGO, não um binário sem fonte)
npm run launcher:build       # gera classic-duels.exe / classic-duels-stop.exe (SDK .NET 8)
npm run pack                 # gera dist/ClassicDuels.exe (jogo inteiro num arquivo)
                             # EXIGE um `npm run release:build` antes — o payload embutido
                             # é feito dos MESMOS game.zip/cards.zip do Release, senão a
                             # instalação nova oferece uma atualização do que ela já tem

npm run update:test          # 79 asserções do instalador/auto-updater (sem rede):
                             # --test-update + --test-offline + --test-selfupdate
                             #   + --test-update-duelo
npm run release:build        # DRY-RUN: gera dist/release/ (game.zip, cards.zip, manifest.json)
                             # o cards.zip (21 mil .lua) é CACHEADO em dist/.cache por
                             # impressão digital das entradas: ~4s quando o banco não
                             # mudou, ~18s quando mudou. Era ~5min todo build (deflate
                             # 'Optimal' + cópia dos 21 mil arquivos para um estágio)
npm run release:test         # instala esses artefatos numa raiz descartável e confere
npm run release:publish      # sobe o Release para o repo privado de distribuição
                             # -- -PodarReleases 5 apaga as tags antigas (opt-in)
                             # --test-remote (na mão) baixa o Release publicado e instala
npm run release:publish -- -ComExe   # o MESMO, subindo o exe junto (auto-update do
                             # próprio executável). Precisa de `npm run pack` antes
                             # e do bump da InstallerVersion em BuildConfig.cs

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
(saída do cemitério), `--test-chain` (corrente de armadilhas), `--test-equip`
(o bônus do equipamento E **em que resposta** o ATK novo chega na tela: o
relato foi "equipei e o ATK só subiu quando fui pra Battle Phase" — a
`VarrerStats` só rodava quando a volta trazia mensagem, e a volta que POSA a
pergunta não traz; agora `Entregar` varre uma vez por entrega. Cobre as duas
formas: equipamento e efeito contínuo de monstro, o Star Boy subindo o ATK de
quem já estava em campo),
`--test-kaiba` e `--test-joey` (decks completos dos NPCs jogando sozinhos),
`--test-dust` (Dust Tornado/remoção de magia-armadilha), `--test-synchro`
(Invocação-Sincro pelo Extra Deck + negação do Stardust Dragon via corrente),
`--test-xyz` (Invocação-Xyz + desanexação de material do Number 39: Utopia),
`--test-fieldbonus` (Bônus de Campo do editor de tabuleiro: Forest injetada
ativa dá +200 de ATK de verdade a um Inseto, consultado no motor E o evento
`stats` que acende o destaque de ATK em `duel.html` chega sozinho ao entrar
em campo, sem precisar de equipamento; e a Umi ativada DA MÃO alcança quem JÁ
estava em campo — 7 Colored Fish 1800→2000, Mechanicalchaser 1850→1650, o
bônus e a penalidade lidos do Lua da própria carta), `--test-toon`
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
sozinho), `--test-pegasus` (o pacote "Normal grande" do deck do Pegasus:
Summoner's Art busca 1 Normal Nv5+ do deck e Ancient Rules o Invoca
Especialmente da mão — o NPC ativa as duas sozinho, na ordem que fecha o combo
no MESMO turno, escolhe sempre o de maior ATK entre os oferecidos e guarda as
Regras quando não há alvo Nv5+ na mão; o duelo real prova que o corpo chega ao
campo, e que quem chega é o Ryu-Ran de 2200, não o Parrot Dragon de 2000),
`--test-compra` (as cartas de **compra**, reconhecidas pelo EFEITO e não por uma
lista de IDs: a `category` do `cards.cdb` diz que a carta compra, o Lua dela diz
se cobra descarte e se alguma outra reanima do cemitério — nenhuma das duas
últimas está na categoria. Compra limpa vem antes de qualquer invocação;
compra com descarte só sai quando não há jogada nenhuma OU quando o descarte
vira ganho — corpo grande preso na mão mais uma reanimação para trazê-lo de
volta —, com o par controle sem a reanimação. Prova a generalização com cartas
que o código NUNCA cita por id, Upstart Goblin e Jar of Greed. O duelo real no
fim existe porque a leitura do Lua depende de achar o arquivo no disco: com o
caminho errado nada é reconhecido como compra e nenhuma regra acusa),
`--test-paradox` (o pacote **Para & Dox**, o Labirinto: um deck de corpos que o
jogo normal não deixa invocar — Nv7 aos montes e o Gate Guardian de 3750, que
nem invocação normal tem —, então ele vive de ATALHOS. Prova as quatro regras
com a trava de cada uma: Tribute Doll só com um Nv7 na mão, Metamorphosis
e Monster Gate só com 2+ corpos em campo (tributar o único deixaria o campo
vazio), Magical Labyrinth equipando o muro, e a Invocação Especial GENÉRICA —
que pega o Gate Guardian, mas recusa trocar um corpo em campo por um menor.
Prova também **o que o NPC não pode gastar**: o Gate Guardian não volta do
cemitério (precisa ter sido corretamente invocado antes), e a regra de descarte
— que joga fora o MAIOR monstro da mão — o rasgava toda vez; hoje ele e as três
peças ficam abaixo até de "não é monstro" na fila do descarte, e os atalhos que
cobram um tributo se recusam a sair quando em campo só há peça. E o **Mausoléu
do Imperador**, que é como as peças chegam ao campo: paga LP no lugar dos dois
tributos, escolhendo a opção de 2000 (o Nv7) em vez da de 1000 (o muro de 0 de
ATK), e subindo a peça que FALTA em vez do Nv7 de ATK igual. E prova o **preço
de um tributo**: um Labyrinth Wall de 0/3000 deitado não é o corpo mais barato
do campo — medir por ATK fazia o NPC trocar a parede que segurava o duelo por um
corpo de 2400 —, com o par controle de um corpo de 1200, onde a mesma jogada TEM
de sair. No duelo real, os atalhos disparam sozinhos com a mão que o
embaralhamento dá, o Mausoléu sai da mão e uma peça chega ao campo),
`--test-cartas-booster` (as cartas que os BOOSTERS já vendiam e a Lista 1 não
conhecia — De-Spell, Ritual Cage, Birthright e Swing of Memories: os três duelos
são dirigidos pelo jogador HUMANO, pelo mesmo `Respond` de `web/duel.html`, e
provam o efeito de verdade — o Normal voltando do cemitério pela magia da mão e
pela armadilha ativada do campo, a Magia Contínua ficando na zona e a De-Spell a
destruindo. E, no fim, que nenhuma pergunta do motor caiu fora do que o front
sabe desenhar: uma carta que peça um `kind` novo vira "⚠ ação não suportada" na
tela e o duelo morre ali, sem erro nenhum no servidor),
`--test-atk-vivo` (o NPC decide pelo ATK/DEF **de agora** — equipamento, magia
de campo, efeito contínuo —, e não pelo statline impresso no `cards.cdb`, que
era o que ele lia: o jogador punha +700 num monstro e o NPC atacava assim mesmo,
entregando o corpo numa batalha que a conta dele dizia ganhar. O par CONTROLE é
o teste: no MESMO duelo sem o equipamento ele TEM de atacar, senão "não atacou"
não provaria nada).
As sondas do protocolo binário são `--probe-idle`, `--probe-pos`, `--probe-battle`,
`--probe-chain`, `--probe-tribute`, `--brute-tribute`, e `--selfplay` despeja as
mensagens cruas do motor. `npm run duel:test` só roda `--test-npc` +
`--test-summons`; as outras suítes precisam ser chamadas na mão (ver
`package.json`).

> **Mexeu em C#? O Release comum NÃO leva a sua mudança.** `game.zip` é front +
> índices; `cards.zip` é banco + Lua. O `duel-server` (o motor, o `NpcBrain`, o
> `InteractiveDuel`) viaja **só dentro do `ClassicDuels.exe`**. Então a sequência
> depois de qualquer mudança no C# é `npm run release:build` → `npm run pack` →
> `npm run release:publish -- -ComExe`; sem o `pack`, o `dist/ClassicDuels.exe`
> que você distribui continua sendo o de antes. Foi assim que a varredura de
> ATK/DEF (magia de campo) saiu publicada no front e ausente no motor: na tela do
> jogador o Umi seguia sem efeito nenhum, e os testes todos passavam aqui.

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

> **O Booster Builder monta do banco INTEIRO, não do pool da lista.** Nada
> impede pôr num booster uma carta que a Lista 1 não conhece — e o estrago é
> silencioso e caro: o jogador paga DP, abre a carta, ela entra na Coleção e
> aparece no Deck Builder; só na hora de **salvar** o deck é que
> `salvar_deck` diz "não está na lista permitida". Depois de mexer nos
> boosters, rode `npm run boosters:check` (lê o BANCO, não o espelho em
> `store/` — que envelhece e dizia estar tudo certo). Foi assim que De-Spell,
> Ritual Cage, Birthright e Swing of Memories apareceram vendidas e injogáveis
> — hoje estão na Lista 1, com `--test-cartas-booster` provando que os efeitos
> rodam.

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

**Drop por vitória** (`web/js/drops.js`): cada NPC pode ter um **pool** de
cartas e uma **quantidade** por vitória — pool de 20, quantidade 3, e cada
vitória sorteia 3 dentro dos 20. Antes a vitória dava sempre a mesma carta de
assinatura, o que fazia a décima vitória entregar a décima cópia dela.

O pool é **dividido em quatro gavetas por raridade** (UR/SR/R/N) e o sorteio
tem dois passos: primeiro a raridade, pelos pesos de `DROP_ODDS` renormalizados
entre as gavetas que REALMENTE têm carta (senão um pool só de N teria 48% de
chance de não dar nada), depois uma carta uniforme dentro dela.

Editado no **Deck Builder do NPC** (`deck.html?npc=<id>`), na aba **DROPS** da
coluna da esquerda — a mesma coluna do deck, alternada por abas. Cada raridade
é um **quadro** com moldura própria: clicar abre um (e fecha os outros), e o
quadro aberto é o alvo do clique nas cartas do pool da direita; arrastar
funciona igual, para qualquer quadro, aberto ou fechado, inclusive de um quadro
para o outro (troca a raridade da carta ali). Antes disto o pool era uma tira de
34vh no rodapé da coluna, com as quatro raridades misturadas na mesma janela — e
as cartas de que o adversário joga 3 cópias, justamente as que mais se quer dar
de prêmio, nasciam **sem `draggable`** no pool da direita (`el.draggable =
!full`, uma regra do DECK aplicada a um alvo que não é o deck). Não havia aviso
nenhum: o gesto simplesmente não começava. Hoje, no modo NPC, a miniatura arrasta
mesmo no limite de cópias, e o clique é um caminho que não depende do arrasto.

A raridade dos boosters (`reprintsOf`) virou **sugestão**: o quadro
correspondente se destaca durante o arrasto, mas quem manda é onde a carta foi
solta — o servidor lê a gaveta gravada, sem reconsultar booster nenhum. É o que
deixa um adversário largar um Normal como prêmio raro sem mexer na Loja.

Guardado em `conteudo/npc-drops` (espelhado em `store/npc-drops.json`) — chave
PRÓPRIA, e não um campo dentro de `conteudo/npcs`, porque os 3 NPCs fixos não
estão naquele array (são `const` no código com um overlay à parte) e uma chave
por fora vale igual para fixo e customizado. **Quem sorteia é o servidor**
(`premiar_vitoria`, migrations 0027/0028): o duelo roda na máquina do jogador,
então sortear no navegador seria deixar escolher o próprio prêmio. Com repetição
de propósito — é o que faz uma carta rara no meio de 20 comuns ser rara de
verdade, e evita a pergunta sem resposta boa de "e quando o pool acabar?". Sem
pool configurado, o prêmio é o de antes (a assinatura).

Na tela de fim de duelo as cartas chegam VIRADAS: clique em cada uma para
revelar, ou use o **[pular]**. Os botões de saída ficam desligados até a última
abrir — não para prender ninguém, mas para o prêmio não passar despercebido
atrás de um clique apressado em "novo duelo".

A carta revelada mostra a **raridade** (moldura + selo, mesmo código de cores da
revelação da Loja) e, quando for o caso, o selo **NEW!!**. As duas coisas vêm do
campo `drops` do servidor (migration 0029), e nenhuma delas o navegador consegue
calcular: a raridade do prêmio é a **gaveta** de onde a carta saiu — não a que
ela tem nos boosters, que é justamente o que deixa um adversário largar um
Normal como prêmio raro —, e "é nova" só existe **antes** do crédito (a carteira
que volta na resposta já tem a carta dentro). Servidor sem a 0029 devolve
`cartas` sem `drops` e a tela mostra a carta sem selo nenhum, como antes.
**Segurar amplia**, o mesmo gesto da mão, do campo, do cemitério e do Extra
(`wireLongPress` + `showCardDetail`, com o anel de progresso de sempre) — e o
botão direito como atalho. Só depois de revelada: segurar uma carta ainda
virada abriria o detalhe e mataria a virada, então ali o gesto **revela**, como
o clique, em vez de não fazer nada e ainda engolir o clique seguinte.

Por causa disso a carta revelada **não** fica `disabled`, e o `abertas` do
`renderDrops` é quem impede a segunda virada. São duas razões: navegador nenhum
entrega evento de ponteiro a um controle desligado (o "segurar" não começaria),
e o `button:disabled { opacity: .4 }` de `web/css/ui.css` apagava justamente o
prêmio recém-ganho — a carta ficava quase invisível.

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

**De quem é essa carta importa.** Quando o tabuleiro veio do ADVERSÁRIO
(`advNpc.board`), ela entra do lado DELE — o front manda `fieldSpellOwner:
'npc'` no `/start`, e o `fieldSpellController` chega até o `InjectField`. Ela
nascia sempre como do jogador (`controller: 0`), o que virava o efeito do
avesso: o campo temático do NPC ocupava a SUA zona de campo, e bastava você
ativar uma magia de campo qualquer da mão para ele sumir de graça, sem gastar
remoção nenhuma. Com cada um na própria zona, as duas convivem e derrubar a
dele voltou a custar uma carta. O tabuleiro que VOCÊ ativou no editor
(`ygo:activeBoard`, modo Treino) continua sendo seu. Teste:
`--test-fieldbonus`, com o par controle — como carta do jogador ela É
substituída, como carta do NPC ela sobrevive.

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
modo `--app`), que é como o `dist/ClassicDuels.exe` roda tudo num processo só,
com o payload embutido instalado em `%LOCALAPPDATA%\ClassicDuels\game`.

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

**Admin gravando deck na Área de Teste.** O Deck Builder sem `?owned=1` mostra
o banco inteiro, mas `salvar_deck` confere POSSE carta a carta — então o deck
montado ali nunca chegava ao banco: ficava só no `localStorage` daquele
navegador, com o alerta "cartas que você não possui" num builder que existe
justamente para ignorar a Coleção. A migration 0024 dá um `p_livre` a
`salvar_deck`, que pula as conferências de JOGO (posse, teto de cópias, pontos,
lista compartilhada, pool) **e só para admin**; o TAMANHO continua valendo para
todo mundo, porque um main de 12 é deck que o motor recusa. O builder liga
sozinho (`gravarLivre`, em `web/js/builder.js`) e o toast diz por qual caminho
foi. Do outro lado, `web/teste.html` lista os decks **no banco** desta conta com
um botão de excluir cada (`apagar_deck`, que filtra por `usuario_id =
auth.uid()` — nem admin apaga deck alheio). A lista do Deck Builder vem do
`localStorage` hidratado e a de lá vem do banco: quando as duas discordam, é
ali que se vê.

`store/accounts/`, `store/users/`, `decks/users/` e `store/sessions.json`
estão no `.gitignore` — ao contrário do resto de `store/`/`decks/` (que é
verdade do jogo versionada de propósito), dado de conta não tem por que ir
pro git. `store/wallet.legacy-backup.json` e `decks/legacy-backup-player/`
são o que existia ANTES do login existir, preservado como histórico —
nenhuma conta nova herda esses dados automaticamente.

## Armadilhas conhecidas

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
