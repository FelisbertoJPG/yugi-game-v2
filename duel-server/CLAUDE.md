# CLAUDE.md — `duel-server/` (motor, servidor e distribuição)

> Documentação e comentários do projeto são em **português**. Siga a língua do
> arquivo que você está editando.

Este arquivo cobre o lado de fora do navegador: **`duel-server/`** (o motor de
duelo e a casca), **`supabase/migrations/`** (a verdade do jogo — contas,
economia, conteúdo publicado, RLS), **`tools/`** (conferidores, empacotamento e
publicação) e **`ygo-data/`** (o dataset). O genérico do projeto está na raiz
(`CLAUDE.md`) e é sempre carregado; as telas estão em **`web/CLAUDE.md`**.

> **Compile sempre com o servidor parado**, e nunca suba servidor por conta
> própria para "testar na tela": o `.exe` do usuário fica travado enquanto roda,
> o `dotnet build` falha *e o teste seguinte roda o binário antigo* — parece que
> a mudança não funcionou. Use `npm run duel:build` / `npm run duel:test`, que
> derrubam o servidor antes.

## Comandos

```bash
npm run icones:check         # todo ícone do catálogo tem arte? A imagem mora na
                             # coluna `imagem` (0039) e a coluna é nullable de
                             # propósito, então o banco aceita a linha sem ela —
                             # e quem joga vê o círculo genérico no lugar do
                             # desenho, sem erro em lugar nenhum
npm run data:check           # integridade do banco de cartas (5 checagens)
npm run conteudo:check       # o que o admin editou chegou ao BANCO? (conteudo,
                             # decks de NPC e tabuleiros, disco x Supabase).
                             # Edicao que fica so' em disco nao existe pra ninguem
npm run boosters:check       # **`cartas_obteniveis()` enxerga tudo mesmo?** As
                             # três portas por onde uma carta chega ao jogador —
                             # booster, Deck Estrutural e pool de drop de NPC —
                             # são varridas AQUI por conta própria e comparadas
                             # com a varredura do SERVIDOR (migration 0048).
                             # Ele não pergunta mais "a carta do booster está na
                             # lista?": desde a 0048 isso é tautologia, porque
                             # `lista_ativa()` já devolve a lista publicada MAIS
                             # as obteníveis — e relatório que só sabe dizer
                             # "sim" deixa de ser lido.
                             # A pergunta que sobrou é a que erra CALADA: a SQL
                             # varre JSON editado por painel, e uma forma nova
                             # de dado (um pool aninhado de outro jeito, um
                             # campo renomeado) a faz devolver de menos sem nada
                             # acusar — e as cartas voltam a ser entregues e
                             # injogáveis. É a ÚNICA duplicação legítima do
                             # projeto: a de um conferidor, cujo trabalho é
                             # discordar. Acusa também id que o jogo entrega e
                             # não existe no banco de cartas
npm run data:build           # regenera ygo-data/data a partir do cards.cdb (precisa de Python 3)

npm run duel:build           # para o servidor e compila o duel-server
npm run duel:test            # para, compila e roda --test-npc + --test-summons
npm run stop                 # encerra front e duel-server de forma limpa

duel-server.exe --cobertura <arquivo.ydk>
                             # **O NPC sabe usar as cartas deste deck?** Cada
                             # carta é oferecida ao `NpcBrain` sozinha, em oito
                             # estados de mesa, e a pergunta é se ele a escolhe
                             # em algum deles. Existe porque a resposta antes
                             # saía de LER o `NpcBrain` procurando o id — e ele
                             # tem 3 mil linhas, metade das regras não cita id
                             # nenhum (reconhecem a carta pelo EFEITO), e o que
                             # se procura é justamente o que NÃO está escrito
                             # lá. Procurar ausência lendo código é como o
                             # buraco passa: foi assim que Swords of Concealing
                             # Light, Yellow Luster Shield, Banner of Courage,
                             # Foolish Burial e Shifting Shadows ficaram anos
                             # sem regra, num deck publicado.
                             # As mesas não são decorativas — quase toda regra
                             # olha a relação entre os dois campos (`ameacaReal`),
                             # e duas delas existem por falso positivo medido: o
                             # Foolish Burial só sai com reanimação na MÃO e o
                             # Shifting Shadows só com carta VIRADA, então uma
                             # mesa que nunca tem nem uma coisa nem outra
                             # reportava as duas como buraco. Relatório de
                             # ausência que dá falso positivo deixa de ser lido.
                             # NÃO prova que a jogada é boa nem que sai na hora
                             # certa: é varredura para achar o que olhar, e o
                             # que ela aponta vira regra com teste próprio.

npm run launcher:build       # gera classic-duels.exe / classic-duels-stop.exe (SDK .NET 8)
npm run pack                 # gera dist/ClassicDuels.exe (jogo inteiro num arquivo)
npm run atalho               # poe "Classic Duels" na area de trabalho apontando
                             # para dist/ClassicDuels.exe (precisa do pack antes)
                             # EXIGE um `npm run release:build` antes — o payload embutido
                             # é feito dos MESMOS game.zip/cards.zip do Release, senão a
                             # instalação nova oferece uma atualização do que ela já tem

npm run update:test          # 166 asserções do instalador/auto-updater (sem rede):
                             # --test-casca + --test-update + --test-offline
                             #   + --test-selfupdate + --test-update-duelo
                             # (--test-casca é a troca do MOTOR em disco: o pacote
                             #  que ficou em .staged/, a quarentena de um motor que
                             #  não sobe, e o motor anterior voltando)
                             # --test-update cobre também o EXE que ficou para
                             # trás com o conteúdo em dia: `NadaAFazer` olhava
                             # só arquivos/pacotes/órfãos, então o boot dizia
                             # "tudo em dia" e a troca do exe — que só roda
                             # dentro do Aplicar — nunca era chamada
npm run release:build        # DRY-RUN: gera dist/release/ (game.zip, cards.zip, manifest.json)
                             # o cards.zip (21 mil .lua) é CACHEADO em dist/.cache por
                             # impressão digital das entradas: ~4s quando o banco não
                             # mudou, ~18s quando mudou. Era ~5min todo build (deflate
                             # 'Optimal' + cópia dos 21 mil arquivos para um estágio)
npm run release:test         # instala esses artefatos numa raiz descartável e confere
npm run release:publish      # sobe o Release para o repo privado de distribuição
                             # -- -PodarReleases 5 apaga as tags antigas (opt-in)
                             # PUBLICA EM ETAPAS (13/09/2026), cada uma com novas
                             # tentativas: AVISA (nunca apaga) dos rascunhos de publicacoes que
                             # falharam -> cria o Release em RASCUNHO sem assets
                             # (conferindo antes se um 500 ja' o criou) -> sobe
                             # asset por asset com --clobber -> confere nome e
                             # tamanho no GitHub -> tira do rascunho -> confirma
                             # que /releases/latest e' a tag nova. Era um
                             # `release create` unico de ~115 MB, e o GitHub
                             # derrubou tres seguidos (500, 422 de upload
                             # repetido, 502) com a pagina de status verde.
                             # Rascunho e' o estado SEGURO de uma falha no meio:
                             # /releases/latest os ignora, ninguem baixa pela
                             # metade — e por isso o "tirar do rascunho" e' conferido.
                             # A etapa roda com $ErrorActionPreference='Continue':
                             # o script liga 'Stop' no topo, e no Windows
                             # PowerShell 5.1 um `gh … 2>$null` que falha vira
                             # EXCECAO FATAL — a primeira versao morreu assim ao
                             # nao conseguir apagar um rascunho, que so' devia avisar
                             # --test-remote (na mão) baixa o Release publicado e instala
npm run publicar:build       # gera publicar.exe na raiz (o publicador)
.\publicar.exe               # DOIS CLIQUES = publicar. Faz, nesta ordem: confere
                             # ambiente (dotnet, gh, permissao de ESCRITA no repo
                             # de distribuicao), confere se a casca mudou desde o
                             # ultimo `pack`, para o servidor, compila, roda as 5
                             # suites do instalador, gera dist/release/ em dry-run,
                             # mostra QUAIS marcadores mudaram, **reempacota o exe
                             # se ele ficou para tras** e SOBE o Release.
                             # O reempacotamento entrou em 24/08/2026: a trava do
                             # payload (`dist/.cache/payload.markers` x o manifesto)
                             # morde no `-Publish`, que e' o ULTIMO passo — entao
                             # toda mudanca de FRONT terminava em "rode npm run pack
                             # de novo e publique" depois do preparo inteiro. Como o
                             # front muda em quase todo Release, o "dois cliques" era
                             # falso no caso comum, e sobrava um ritual de tres
                             # comandos na mao (release:build -> pack -> publish) —
                             # exatamente o tipo de coisa que este exe existe para
                             # nao ter, e que ja' foi esquecido em producao antes.
                             # A trava NAO afrouxou: ela continua no ps1 e continua
                             # com a palavra final; o que mudou e' quem executa a
                             # consequencia mecanica do dry-run. `--exe-em-dia` so'
                             # RESPONDE (0 em dia, 1 defasado), sem empacotar nem
                             # publicar, que e' como se confere essa decisao sem
                             # gastar tres minutos de pack.
                             # NAO pergunta nada (20/08/2026): dois cliques
                             # publicam mesmo. A trava nunca esteve na pergunta e
                             # sim nos passos antes dela — ambiente, servidor
                             # parado, suites e o diff na tela.
                             # --so-build para no dry-run; --com-exe sobe o exe
                             # junto; --perguntar devolve a palavra PUBLICAR;
                             # --sim e' aceito e ignorado; --ajuda lista tudo.
                             # Ele NAO reimplementa nada: chama o mesmo
                             # publish-release.ps1 e as mesmas suites, so' que na
                             # ordem certa e recusando sair do lugar quando algo
                             # esta' fora. Dois caminhos que publicam divergiriam.

npm run release:publish -- -ComExe   # EXIGE o exe: falha se dist/ClassicDuels.exe nao
                             # existir. Desde 22/08/2026 o exe ja vai em TODA
                             # publicacao que tenha um empacotado (o campo
                             # `installer` do manifesto e a unica forma de um
                             # cliente saber que existe um exe novo — com ele nulo,
                             # quem esta numa versao antiga fica preso PARA SEMPRE:
                             # recebe o front todo dia e o motor nunca). A flag
                             # sobrou como recusa de publicar sem ele.

cd duel-server && dotnet run -- --app --lan   # o mesmo --app, mas alcançável de outro
                                                # aparelho na rede (app mobile) — ver mobile/README.md
cd mobile && flutter pub get && flutter run   # app mobile (cliente fino do duel-server)
```

## Rodar um teste isolado do duelo

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
`--test-card-builder` (as cartas do **Card Builder** — `web/cardbuilder.html`,
tabela `cartas_custom` — não moram no `cards.cdb` nem na pasta de scripts:
chegam no `/start` como `customCards`, dados + Lua, e `CartaCustom` as registra
no `DatabaseManager` — leitor do motor, `Stats`, `Nome` e o Lua do `Perfil` — e
no `ScriptManager`. O teste prova a leitura do corpo (id OFICIAL recusado, senão
dava para trocar o script do Pote da Ganância; Lua vazio; duplicata), o que o
NPC lê, e um duelo em que a Magia do builder é ATIVADA, compra 2 e vai ao
Cemitério e o Monstro aparece invocável. O par CONTROLE é o mesmo deck sem
`customCards`, onde nada disso é oferecido — os `[ERRO] [lua]` desse trecho são
esperados. A trava de rede (`req.IsLocal`) mora na rota, fora do teste.
A última parte joga a CATEGORIA COMPOSTA com o Lua que o gerador escreve para a
Multistrike Dragon Dragias — custo "descarte 2 Normais de Tipos diferentes",
Invocação-Especial da mão, "então destrua 1 carta", "então ataca 2 vezes" — e
conta os ataques pela ZONA da carta (`sequence`), senão duas Dragias em campo
passariam por uma que atacou duas vezes. O par controle é o mesmo script com
`SetValue(0)`. `LUA_DRAGIAS` é a saída do gerador, e `node
web/js/cardbuilder.test.mjs` cobra que continue sendo: mudou o gerador, atualize
a constante e rode os dois. Joga também a FUSÃO do builder (no Extra Deck, por
Polymerization com Gaia The Fierce Knight + Curse of Dragon) e o RITUAL do builder
pela Magia de Ritual do builder, com Battle Ox de tributo — `LUA_FUSAO`,
`LUA_RITUAL` e `LUA_MAGIA_RITUAL` são saída do gerador, cobradas pelo mesmo teste
JS; o controle das duas é o deck sem `customCards`, em que a magia nunca é
oferecida. Joga ainda a Dragon's Inferno (`LUA_INFERNO`, Armadilha Contínua): o
Curse of Dragon Invocado sem tributo com o campo vazio; o destruir que só aparece
com o Normal Dragão em campo (um efeito a mais depois da Invocação); a busca no
Deck/Cemitério; o baixar de 2 cartas de nomes diferentes; e a conta de cada efeito
(`{id,n}`). Cada efeito é reconhecido pelo que a resolução FEZ, porque os três
chegam com o mesmo código e sem descrição. Os controles trocam uma coisa só no
mesmo script: sem o alcance da mão, o Curse que a própria busca trouxe nunca fica
invocável; com a conta dividida (`id`), usar um efeito apaga os outros),
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
`--test-magos` (o deck **Poder dos Magos**, o primeiro que não cabe em regra por
ID: dezoito cartas com efeito. A cobertura é por **classe** — a `category` do
`cards.cdb` cruzada com o Lua da carta — e o teste prova as duas metades: o
perfil de cada carta bate com o que ela faz, e cada classe dispara na hora certa
com a trava (Thousand Knives só com monstro do outro lado, Dark Magic Attack só
com S/T, Dark Magic Veil só quando preciso de corpo E o custo em LP não fura o
piso). No duelo real as CINCO classes saem sozinhas: busca, compra, destruição,
fusão e invocação especial),
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
`--test-mai` (o deck de HARPIAS da Mai: os efeitos de cada carta conferidos no
MOTOR pelo evento `stats` — Harpie Lady 1 dando +300 a todo WIND inclusive a
quem JA' estava em campo, Cyber Shield +500, Gust Fan +400 e a Mountain +200 —
mais o `NpcBrain` decidindo sozinho: equipa da mao pela tabela `EQUIPAMENTOS` e
ativa magia de campo pela `CAMPOS`, com o par CONTROLE de que a Mountain NAO
sai quando so' o outro lado ganharia. Foi este deck que trouxe a regra 5.355
(equipamento da mao, generica): antes so' saia equipamento com regra propria por
id ou buscado do deck, e o NPC carregava Gust Fan/Cyber Shield/Sword of Dark
Destruction a partida inteira sem equipar — nenhum teste acusava, porque cada
deck novo so' provava as cartas com regra propria),
`--test-mako` (o deck de ÁGUA do Mako, que gira em torno de uma palavra: **"Umi"**.
O **Templo Esquecido das Profundezas** bane um Fish/Sea Serpent/Aqua Nv≤4 do
PRÓPRIO dono e o devolve na End Phase de um turno dele — e o NPC banía o próprio
monstro em TODA janela de corrente, de graça. A causa: o banco marca o Templo com
o bit `0x100000` (INVOCAÇÃO ESPECIAL) por causa do RETORNO, e o cérebro lia isso
como "põe corpo em campo" quando ativar TIRA um corpo do campo; como o efeito é
`EVENT_FREE_CHAIN`, a janela abre sempre e a regra genérica do "corpo de graça"
mordia a isca em todas. Hoje ele mede: bane a Fusão que o Instant/Ready Fusion
condenou à End Phase (ela escapa e volta — o corpo fica de vez), bane para fugir
de uma remoção, e GUARDA o uso quando já tem Torrential Reborn baixado ou
Premature Burial na mão, porque deixar morrer e reviver rende mais. Cada linha
tem par CONTROLE: sem o motivo, "não baniu" não provaria nada. Prova também que a
imunidade a magia que a Umi dá (Torpedo Fish, Deepsea Warrior, Cannonball Spear
Shellfish, Legendary Fisherman) impede o NPC de gastar o Templo contra uma magia
que não alcança o alvo — e que ela **não** cobre armadilha. E prova que ele
**ativa a Umi**: a tabela `CAMPOS` conhecia UMA carta, a Mountain do deck da Mai,
então o NPC nunca punha em campo a magia em torno da qual o deck do Mako inteiro
foi montado — 3 Umi mais 3 Terraforming para achá-la, e a carta chegava à mão e
ficava lá a partida toda. A regra agora conta duas coisas, não uma: quem ganha
ATK (por raça **ou** por atributo — A Legendary Ocean reforça todo WATER, e é
assim que ela alcança o Fisherman, que é Warrior e fica de fora da Umi) e quem
ganha PROTEÇÃO. Sem a segunda metade, o NPC guardava a Umi justamente com o
Fisherman em campo, que é quando ela mais vale: ele não ganha um ponto de ATK
dela, só a intocabilidade),
`--test-efeitos` (**qual efeito** da carta o motor está oferecendo: toda pergunta
que envolve um efeito carrega a `description` dele — o `aux.Stringid(code, i)` do
script —, e é ela que separa duas ofertas idênticas na tela. O Forgotten Temple
of the Deep aparece com o mesmo nome e a mesma arte para "banir 1 peixe" e para
"Invocar Especialmente o banido", e sem a frase o jogador ativa um achando que
ativou o outro. Prova as duas metades, que erram as duas em silêncio: a
decodificação — índice 0 é a `str1`, deslocamento de 20 bits, e `null` onde não
dá para saber, nunca uma frase inventada — e, num duelo real, que a frase chega
INTEIRA na pergunta, o que fixa os offsets da descrição dentro das entradas de 19
(idle) e 23 (corrente) bytes. Ler os 8 bytes do lugar errado devolve lixo, que
vira "sem texto" na tela: o silêncio de sempre, sem erro no servidor),
`--test-atk-vivo` (o NPC decide pelo ATK/DEF **de agora** — equipamento, magia
de campo, efeito contínuo —, e não pelo statline impresso no `cards.cdb`, que
era o que ele lia: o jogador punha +700 num monstro e o NPC atacava assim mesmo,
entregando o corpo numa batalha que a conta dele dizia ganhar. O par CONTROLE é
o teste: no MESMO duelo sem o equipamento ele TEM de atacar, senão "não atacou"
não provaria nada.
> **E o ALVO do ataque é uma SEGUNDA pergunta** — foi por onde a leitura viva
> continuava sendo desfeita. O `SELECT_BATTLECMD` escolhe o ATACANTE, e logo
> depois um `MSG_SELECT_CARD` escolhe em QUEM bater. A `DecideBattle` sempre leu
> o valor vivo e sempre declarou o ataque contra o alvo **mais fraco** do outro
> lado; a lista de alvos, porém, tem a mesma forma de uma remoção (só cartas
> dele, só na zona de monstro) e caía no critério genérico do `DecideSelect` —
> *o de maior ATK IMPRESSO*. Ele declarava contra o 1500 e batia no 1700 que
> três reforços tinham levado a 3300. Era literalmente o relato: *"meu monstro
> tem uns 3 buff e o NPC ataca igual com um mais fraco"*.
> Hoje a declaração passa adiante o ATK vivo do atacante (`_atacanteAtk`) e a
> escolha do alvo é: entre os que eu **venço**, o mais forte — tirar da mesa a
> maior ameaça que dá para tirar; não vencendo nenhum, o mais barato. A marca
> vale por UMA pergunta e é apagada na Main Phase seguinte, senão a próxima
> remoção miraria "quem eu venço" em vez do maior, que é o avesso do que uma
> remoção quer. Os três pares CONTROLE guardam exatamente isso),
`--test-alvos` (**de QUEM é a carta que o NPC escolheu**. O `DecideSelect`
genérico ordenava os alvos por ATK sem perguntar de quem eram, e três coisas
saíam do mesmo buraco: o Inseto Devorador de Homens (Man-Eater Bug) virava e
destruía o monstro do PRÓPRIO Wevil — que era o maior ATK da mesa justamente
porque ele acabara de equipá-lo —; o Insect Armor with Laser Cannon ia parar no
inseto do JOGADOR (o Lua da carta aceita alvo dos dois lados, e num duelo de
teste o NPC levou o Petit Moth do jogador de 300 a 3800 de ATK, com o log
dizendo "+700 no melhor atacante" as quatro vezes); e o equipamento era gasto
num monstro DEITADO, onde o bônus de ATK não vale nada — pior, o ciclo por
atributo (+400 ATK / −200 DEF) TIRA 200 do único número que aquela batalha usa.
Junto vai a posição de entrada, que agora conta o equipamento que está na mão:
ela é decidida ANTES da regra do equipamento, e a regra do equipamento só
reforça quem está de pé, então o corpo entrava deitado e o reforço reservado
para ele nunca chegava. Cobre também o custo da Insect Imitation, que chega como
`MSG_SELECT_CARD` e não como `MSG_SELECT_TRIBUTE` — caía na regra de "o mais
forte" e tributava o MAIOR corpo do campo, o contrário do que o comentário da
própria regra dizia. Cada caso tem par CONTROLE, e os dois duelos reais no fim
provam que a lista chega ao cérebro com os dois lados dentro e com o
`controller` certo),
`--test-armory` (Armory Call: qual equipamento vem do deck e em quem ele entra),
`--test-caos` (o pacote **CAOS** do Yugi — 46 asserções. O relato: *"ele preferiu
invocar um Lustro Negro em vez de usar Magician of Black Chaos + Chaos Scepter =
combo pra banir meu ritual pra sempre; ia tirar 2 cards do meu campo, do jeito
que fez tirou apenas 1"*. A **Chaos Scepter Blast** só liga com um **Mago Nv8+**
com a face para cima, e aí bane 1 carta do campo **com a face para baixo** —
remoção permanente. O NPC tinha na mão a Espada, o Mago do Caos (Nv8 MAGO), o
Lustro Negro (Nv8 GUERREIRO) e os rituais dos dois, e escolheu o Guerreiro, de
3000 de ATK.
> Não era critério errado: `AtivavelSe(q, EhRitual)` devolve o **primeiro** ritual
> ativável da lista. Não havia critério nenhum — a escolha entre 3000 de ATK e um
> combo de duas remoções era a ordem em que o motor tivesse listado as cartas.
> Hoje o cérebro pergunta o que faltava: *"tenho como pôr em campo o corpo que a
> carta parada na minha mão pede?"*. A exigência sai do Lua dela
> (`ExigeCorpo`: a condição perguntando por um monstro meu em `LOCATION_MZONE` e
> o filtro pedindo raça e nível — 27 cartas no banco, **uma** em deck hoje), e
> quem cada ritual pode invocar sai do Lua dele (`RitualInvoca`).
>
> **Ritual que não nomeia ninguém devolve lista vazia, e isso é a resposta
> honesta**: a Black Luster Ritual é `AddProcGreaterCode(c, 8, nil, 5405694)` e
> diz exatamente quem invoca, mas o Chaos Form filtra por arquétipo e não cita
> nome nenhum. Quem lê trata assim — ritual que nomeia só serve para os nomeados,
> ritual que não nomeia é candidato a qualquer um. Fingir uma lista faria o
> cérebro escolher errado com confiança.
>
> A ESCOLHA do monstro vem depois, no `DecideSelect`, pela marca que a regra
> deixou: sem ela o critério genérico (maior ATK) traria o Guerreiro de volta na
> pergunta seguinte, desfazendo a decisão que acabara de ser tomada.
>
> A segunda metade veio do mesmo relato: **baixar a Espada quando ela não tem
> uso**. Parada na mão ela não faz nada; destruída pelo oponente na zona de
> magia, ela Invoca Especialmente do DECK um dos magos do Caos — é o próprio
> texto dela (`SalvaSeDestruida`), e a diferença está na ZONA. Só quando ela NÃO
> está ativável: havendo o corpo, banir uma carta do campo dele vale mais que a
> espera. Com a mesma folga de zona da regra da armadilha, e pelo mesmo motivo.
>
> **A TERCEIRA metade (26/08/2026): a Espada virada contra o próprio NPC.** O
> relato: *"npc brain usou o Chaos Scepter Blast no próprio monstro (esse monstro
> ele tomou controle meu — pegou do meu GY) e era de ATK maior no campo (2900)"*.
> O `duel-server.log` da sessão mostra o caminho inteiro — Monster Reborn traz um
> 2900 do cemitério do JOGADOR, o NPC ataca com ele, e na janela seguinte
> `[npc] chain -> ativa 15256925 em resposta`, que é a linha mais crua do
> arquivo: **ativar sem critério nenhum**.
>
> Eram QUATRO portas, e cada uma sozinha bastava para o estrago:
>
> - **a Espada nunca teve regra de Main Phase.** `DestroiMonstro`/`DestroiSt`
>   exigem `Duel.Destroy` no script e ela usa `Duel.Remove`, então nenhuma regra
>   a enxergava. Hoje é a 5.505, reconhecida por `BaneDoCampo` (banir é mais
>   forte que destruir: não volta e nem se identifica), com a mesma trava da
>   remoção — só sai se há o que tirar do campo DELE;
> - **a janela de corrente genérica**, que ativa qualquer carta "em resposta". O
>   efeito é `EVENT_FREE_CHAIN`, então a janela abre SEMPRE — inclusive com o
>   campo dele vazio, que é quando a única coisa que ela alcança é o próprio NPC.
>   Hoje há a quarta trava dessa família (ao lado da que guarda a Dark Factory):
>   *carta que tira do CAMPO alcançando os dois lados não sai numa janela em que
>   o campo dele está vazio*. O alcance sai do Lua — `LOCATION_ONFIELD,
>   LOCATION_ONFIELD` (os dois lados) contra `0,LOCATION_ONFIELD` (só o dele) —,
>   o mesmo idioma de PAR que o `Trava` e o `ReforcoMeuCampo` já leem;
> - **a regra do "corpo de graça" da janela de corrente, que é a armadilha do
>   Templo do Mako outra vez.** O banco marca a Espada como INVOCAÇÃO ESPECIAL
>   (0x100000) por causa do efeito de ser DESTRUÍDA, e a regra lia isso como
>   "esta carta põe corpo em campo". Ativar não põe corpo nenhum — bane 1 carta.
>   O Templo foi resolvido por uma lista de ids; esta é lida da carta
>   (`SalvaSeDestruida`, o mesmo leitor que decide baixá-la), então vale para a
>   próxima com essa forma. **Foi o teste que achou esta porta**, não a leitura
>   do código;
> - **e a regra 5.375 do Main Phase** ("qualquer carta que ponha corpo em
>   campo"), que lê o MESMO bit e vem ANTES da 5.505, então vencia: com o campo
>   do NPC vazio ela dizia *"põe corpo em campo — estou sem monstro"* sobre uma
>   carta que TIRA do campo. Mesma exclusão, mesmo leitor. **Esta quem achou foi
>   o `--cobertura`**, depois de as outras três estarem fechadas — é literalmente
>   para isso que aquele relatório existe: procurar ausência lendo código é como
>   o buraco passa.
>
> E o ALVO, que erra igual e calado: a lista dela mistura MONSTRO e
> MAGIA/ARMADILHA dos DOIS lados, e nenhum ramo do `DecideSelect` a reconhecia —
> o "alvo em campo" só olha `MZONE` e só dispara quando o oponente tem MONSTRO.
> Sem monstro dele, tudo caía no critério genérico: maior ATK, **sem perguntar de
> quem é a carta**. É a mesma família do Inseto Devorador de Homens do
> `--test-alvos`, por um buraco que aquela correção não fechou. Hoje a marca
> `_remocaoDeCampo` leva a informação que a seleção não teria — que aquela
> pergunta é uma remoção — e mira o lado dele: monstro primeiro, pela ameaça de
> AGORA; só S/T dele, a mais pesada. O último degrau (ele não tem nada na lista)
> não devia acontecer e existe porque o motor JÁ pediu a resposta: aí paga com a
> MINHA carta mais barata, nunca com a melhor.
>
> Os pares CONTROLE guardam cada porta: o Raigeki, que tira do campo mas só do
> lado dele; o Dark Hole, que alcança os dois lados mas DESTRÓI (e já tem regra);
> o Magician of Dark Illusion, que continua sendo corpo de graça de verdade; e a
> mesma lista de alvos sem a marca, que cai no genérico e bane o meu 2900 — sem
> ele, "baniu a carta dele" não provaria que alguém escolheu.
>
> **A QUINTA porta, no mesmo dia: a magia de USO ÚNICO.** Fechadas as quatro, o
> relato seguinte foi *"ele usou num card de adição meu, que naturalmente só tem
> 1 uso, a Summoner's Art — foi gastar uma potencial defesa contra uma ameaça"*.
> O log de novo, inteiro:
>
> ```
> [rpc] /respond activate arg=1                      <- o jogador ativa a busca
> [npc] chain -> ativa 15256925 em resposta
> [npc] remocao de campo: bane 79816536 do lado DELE
> ```
>
> Uma Magia **Normal com a face para CIMA** na zona só está ali porque está
> RESOLVENDO neste instante: banir não impede o efeito (o motor já a ativou) e
> ela ia para o cemitério sozinha. A trava perguntava *"ele tem ALGUMA carta?"* —
> e a Summoner's Art ocupava uma zona. A pergunta certa é *"ele tem alguma que
> VALHA a remoção?"*, e a diferença entre as duas é **PERMANÊNCIA**: vale um
> monstro dele, uma carta VIRADA dele (incógnita, mas fica) ou uma magia que FICA
> em campo (contínua/equipamento/campo — `DatabaseManager.FicaEmCampo`). Não vale
> a Normal aberta. Sem essa distinção o NPC pagava a carta principal de remoção
> do deck para não conseguir nada, e ficava sem ela para a ameaça de verdade.
>
> O mesmo vale para o ALVO (`ValorDeBanirSt`), e ali o erro era calado do mesmo
> jeito: a ordenação por `Peso` empata em 0 tudo que não está na tabela de
> ameaça — inclusive a magia que está resolvendo — e levava a primeira da lista.
> O par CONTROLE é a MESMA zona com um Toon World no lugar da busca: a Espada
> sai, e mira nele.),
`--test-condenado` (o **CORPO CONDENADO** — Instant Fusion e Ready Fusion põem
uma Fusão em campo que **não pode atacar** e é **destruída na End Phase deste
turno**. O buraco tinha três metades: **atacar** já estava segura e não precisou
de regra (o `EFFECT_CANNOT_ATTACK` é do motor, então o corpo nunca aparece em
`attackers`); **pagar com ele** estava invertida — o cérebro media o preço pelo
ATK e por isso PROTEGIA o que ia sumir, tributando um Petit Moth de 300 para
poupar um Barox de 1380 que evaporava no fim do turno; e **contar como campo**
inflava o `MaiorAtkEmCampo`, que responde "eu domino a mesa?" — duplamente
errado, porque o corpo não ataca e nem chega ao turno do oponente, e o NPC
guardava a trava e o reforço achando que estava bem.
> **A marca é por ZONA e vem do que ACONTECEU**: a carta que resolveu condena
> (`Perfil().TrazCorpoCondenado`, lido do Lua) e o monstro que chegou do Extra
> logo depois é ele. Nunca do TIPO da carta — era assim que a única regra que
> sabia disso (o Templo do Mako) adivinhava, por `TYPE_FUSION`, e o argumento
> *"num deck sem Polymerization, uma Fusão em campo só pode ter vindo do Instant
> Fusion"* vale para aquele deck e para mais nenhum. Num deck com Polymerization
> o palpite mandaria tributar de graça o melhor corpo do campo, que ia FICAR.
> A marca sai quando o corpo sai da zona e na virada do turno — marca velha é
> pior que marca nenhuma, porque o próximo monstro daquela zona herdaria a
> condenação.
>
> **O duelo do teste é dirigido pelo JOGADOR, e não pelo NPC** — não por
> preferência, por observabilidade: o turno inteiro do NPC (ativar, batalhar,
> encerrar) é resolvido dentro de um `Respond` só, então o corpo nasce e morre no
> MESMO lote de eventos e a marca já saiu quando alguém de fora consegue olhar.
> Pelo lado do humano o motor devolve uma pergunta com o corpo ainda em campo — e
> isso prova de graça que a marca é da ZONA e não do NPC.
>
> **A quarta metade, achada depois: o EQUIPAMENTO ia parar nele.** O relato foi
> *"ele usa a Ready Fusion, gasta recurso em cima do monstro, e ele não pode
> atacar e na end é destruído"*. O desempate da escolha do alvo (`AlvosDeEquip`)
> reforça "quem já vale mais na mesa" quando o bônus empata — e a Fusão que o
> Instant/Ready Fusion traz costuma ser justamente o maior ATK do campo. O
> prejuízo é duplo: o bônus de ATK não serve para nada (o corpo não batalha) e o
> equipamento vai **junto** para o cemitério na End Phase. Nada acusa: a carta
> equipa, o motor soma, a tela mostra o número novo, e os dois somem no fim do
> turno. Hoje o corpo condenado fica de fora da lista de alvos de equipamento, e
> com o campo TODO condenado a carta simplesmente fica na mão.
>
> **E as três medidas de "quanto custa esse corpo" passaram a ser uma só.**
> `ValorDoMeuCorpo` já sabia que um corpo condenado custa zero, mas
> `CorpoMaisBarato`, `ValorDoTributoQueSai` e o ramo de custo do `DecideSelect`
> mediam pelo `ValorNaBatalha`/`AmeacaDoAlvo` crus — então a regra autorizava
> pensando num corpo e a seleção pagava com outro. É a mesma armadilha que o
> comentário do `ValorDoTributoQueSai` já descrevia, uma função ao lado. Com as
> três medindo igual, o atalho que cobra um tributo sai de graça no turno em que
> há um Instant/Ready Fusion na mesa — que é o que o corpo condenado existe para
> pagar),
`--test-derrota` (a **queima que se paga em vida própria**. O relato: *"quando o
oponente sofre uma derrota devido ao próprio efeito, o jogo não sabe interpretar
isso (o que é uma vitória do player); exemplo é o Panik estar com 500 ou menos
de vida e usar a Tremendous Fire"*. São duas perguntas, e a medida separou uma
da outra: **o motor sabe** — um duelo em que o LP do NPC zera termina com
`ended` e `winner = 0`, o MSG_WIN chega e o front desenha "você venceu" (a
metade que o teste guarda, porque é a única que prova que a vitória por LP
zerado **no meio de uma resolução**, e não numa batalha, chega inteira ao lado
de fora) —; e **o NPC não devia ter feito isso**. A Tremendous Fire tira 1000 do
oponente e **500 de quem a ativa**, e a regra de queima era uma linha só,
*"dano fixo no oponente, ativa sempre que der"*.
> **Não há o que ler no banco**: a `category` da carta é `CATEGORY_DAMAGE` — ela
> diz que a carta causa dano, nunca EM QUEM. Quem sabe é o Lua dela
> (`DatabaseManager.DanoEmMim`), onde quem ativou é `tp` e o oponente é `1-tp`.
> Lê só a forma literal; dano calculado devolve **0**, a mesma resposta honesta
> que `BonusDeCampo` dá a um script que não sabe ler. Os três pares CONTROLE do
> reconhecimento (Ookazi, Hinotama, Final Flame, todas com custo zero) pegariam
> um leitor que confundisse `tp` com `1-tp` — que faria o NPC parar de queimar
> justamente quando estivesse ganhando, o avesso do bug.
> A recusa é só contra a **morte**, e não um piso de LP: queimar é a condição de
> vitória de um deck de queima, e um piso o faria parar de jogar na frente. E
> nem "mas eu levo ele junto" salva — o Lua aplica os dois danos e só depois o
> motor confere o LP (`Duel.RDComplete`), então os dois chegam a zero na mesma
> resolução e o resultado é **empate**, nunca vitória. O filtro entra no
> critério e não depois dele: com uma Ookazi ao lado, ela sai),
`--test-campos` (as **MAGIAS DE CAMPO**. A pergunta era *"o NPC sabe posicionar
magia de campo?"*, e a resposta medida foi: posicionar **sim** (a zona de campo é
`SZONE seq=5`, e o `ParsePlace` a trata — `for (int z = 0; z < 6; ...)`, o 6 é ela),
ativar **quase não** — dos seis campos básicos da Lista 1 ele usava dois. Quem
dizia o que cada carta reforça era uma tabela escrita à mão com TRÊS entradas, e
Forest, Yami, Sogen e Wasteland ficavam mortas na mão para sempre. Hoje quem
responde é o Lua da própria carta (`BonusDeCampo`), nas duas formas em que estes
scripts aparecem: o filtro literal (`aux.TargetBoolFunction(Card.IsRace, …)` +
`SetValue(200)`) e a **função de valor** (`if r&(…)>0 then return 200 elseif …
return -200`). A segunda é a que torna isto melhor que a tabela e não só mais
curto: ela traz a **PENALIDADE** junto — a Umi tira 200 de Máquina e Piro, o Yami
tira 200 de Fada, e a tabela só sabia dizer quem ganhava.
> Não é interpretador de Lua e não tenta ser: agrupa as chamadas por variável de
> efeito, resolve `Clone()` herdando do pai, e só lê o efeito cujo `Code` é
> `EFFECT_UPDATE_ATTACK`. O `Clone()` não é detalhe — em **A Legendary Ocean** o
> PRIMEIRO efeito é um `EFFECT_UPDATE_LEVEL` de **−1**, e o de ATK é o clone
> seguinte; um leitor que casasse "o primeiro SetTarget com o primeiro SetValue"
> concluiria que a carta PIORA o próprio campo. Script fora dessas formas devolve
> "não sei ler" e a carta não é ativada — o mesmo silêncio seguro da tabela.
>
> A DECISÃO também mudou, e é o par controle que importa: magia de campo é
> **global**. "Algum monstro meu ganha" não basta — a Mountain com um Dragão meu
> e dois dele reforça mais o outro lado, e eu ainda pago a carta. A conta agora é
> a DIFERENÇA. E há o guarda de trocar campo por campo: o duelo do teste mostrou
> o NPC trocando Forest por Forest turno após turno (o comentário da regra antiga
> afirmava que "o motor nem oferece a mesma carta" — não é verdade), então ele só
> troca por uma que renda MAIS.),
`--test-custo` (**com o que o NPC paga**. O relato foi *"ele está tirando o único
monstro que controla pra comprar 1 card, ficando com o campo aberto"* — a **Dark
Factory of More Production**, cujo custo é "mande 1 monstro da MÃO **ou do
CAMPO**". Eram três defeitos no mesmo lugar: (1) o motor manda as duas origens na
MESMA lista e o `DecideSelect` olhava só o `location` da PRIMEIRA opção — vindo o
corpo do campo na frente, ele ordenava por maior ATK e pagava com o melhor da
mesa; (2) o `Decide` lia `QtdMonstros`, que só conta o que está com a FACE PARA
CIMA, então com a única parede SETADA a regra concluía "campo vazio, não tenho o
que fazer" e ativava — num deck que seta o tempo todo esse é o caso comum, não o
raro; (3) a carta é quick e `EVENT_FREE_CHAIN`, aparece em TODA janela de
corrente, e a regra genérica do `DecideChain` a ativava em todas, pagando um
monstro por vez. A correção da escolha é de FORMA, não de carta — uma lista que
só tem coisa minha e mistura mão com campo é um custo, e custo se paga com o que
ainda não está em jogo —, então vale para as 142 cartas do banco com esse mesmo
custo. O par controle do reconhecimento é a Graceful Charity, que cobra duas
cartas mas só da MÃO: a trava nova não pode alcançá-la),
`--test-panik` (o pacote de SUPORTE do deck do Panik — três cartas que o cérebro
carregava a partida inteira sem jogar. **Yellow Luster Shield / Banner of
Courage**: reforço PERMANENTE do meu campo, reconhecido só pelo Lua
(`EFFECT_UPDATE_ATTACK/_DEFENSE` + `SetTargetRange(LOCATION_MZONE, 0)`) mais o
tipo, que precisa FICAR em campo — os dois pares controle são a **Sogen**, que
reforça os dois lados, e o **Union Attack**, que reforça só os meus mas é de uma
vez só, e reforço de um turno depende de escolher o turno, coisa que o cérebro
não sabe fazer. **Foolish Burial**: sozinha é perda de carta, então a condição é
o PAR — uma reanimação para o corpo enterrado (a segunda razão, o deck, mora em
`--test-enterro`). **Shifting Shadows**: não muda
um ponto de ATK, apaga o que o outro lado já sabia sobre qual carta está em qual
zona; num deck de cartas setadas é disso que o duelo vive. Ela tem duas jogadas
separadas pela LOCALIZAÇÃO da oferta — da mão é pô-la em campo, do campo é o
efeito que custa 300 LP —, e o par controle é o piso de LP: perder o duelo para
esconder de qual zona é o muro seria o pior negócio possível),
`--test-enterro` (**enterrar para usar depois** — o Foolish Burial. O pedido foi
*"quando ele abrir com Foolish Burial, adiantar o envio de material do deck pro
GY pra usar posteriormente"*, com o deck **Yugi Chaos** de exemplo: ele leva TRÊS
Foolish de propósito, para mandar os Dark Magician of Chaos ao cemitério e
alcançá-los pelos três Monster Reborn. São duas metades, e as duas erram CALADAS.
> **QUANDO** — a regra exigia a reanimação na MÃO. Num deck de 40 com três
> Reborn, ter as duas metades juntas é sorte e não plano: na prática a carta
> ficava na mão a partida inteira. Hoje a segunda razão é o **DECK** — enterrar
> cedo é ADIANTAR, o corpo espera no cemitério a carta que vem. Não é "ativar
> sempre": deck sem reanimação nenhuma continua guardando a carta, e esse é o par
> CONTROLE. Quem responde "o que tem no meu deck" é a DECKLIST do próprio NPC
> (`ListaDoDeck`, em `InteractiveDuel`), que não passa pelo `npcLeitura` porque
> não é leitura escondida — ninguém precisa de permissão para saber o que pôs no
> próprio deck — e vem VAZIA do lado do jogador. É a lista de CONSTRUÇÃO, não o
> que sobrou dentro do deck: seguir cada carta que deixa `LOCATION_DECK` seria
> encanamento novo para uma diferença que sempre cai para o lado barato.
>
> **O QUE — a pergunta que manda.** *"Este monstro pode ser Invocado
> Especialmente do cemitério pelo efeito da carta que o traz de volta? Se sim,
> envia; se não, busca o próximo alvo válido."* São DUAS metades, e as duas erram
> caladas:
>
> - **o motor deixa?** O critério genérico do `DecideSelect` é "maior ATK
>   impresso", e nesse deck o maior ATK é o **Black Luster Soldier** (3000), um
>   monstro de RITUAL. Ritual, fusão, sincro, xyz e os "nomi" só saem do
>   cemitério se tiverem sido corretamente invocados ANTES — e quem foi do deck
>   direto para lá nunca foi. Quem responde é
>   `DatabaseManager.VoltaDoCemiterio`, por dois sinais: o TIPO (pega classes
>   inteiras e vale para a carta sem Lua no disco) e o `EnableReviveLimit` do
>   script, que pega o "nomi" avulso — o mesmo Gate Guardian que o cérebro já
>   protegia por ID, uma carta de cada vez;
> - **a MINHA reanimação alcança?** O **Birthright** e o **Swing of Memories**
>   (os dois vendidos em booster) só trazem monstro NORMAL; o **Eternal Soul** só
>   o Dark Magician, pelo nome; o **Dark Magic Veil** só Mago DARK. Num deck
>   assim, enterrar o Dark Magician of Chaos é rasgar o corpo e a carta. Quem
>   responde é `DatabaseManager.ExigenciaDaReanimacao`, lendo a função-filtro de
>   UMA linha do Lua da reanimação — a forma das 20 do pool de hoje. As
>   constantes (`TYPE_NORMAL`, `RACE_SPELLCASTER`, `CARD_DARK_MAGICIAN`…) saem do
>   `constant.lua` do PRÓPRIO jogo, nunca copiadas: duas fontes para a mesma
>   verdade se desencontram na primeira atualização do banco. **Filtro que o
>   leitor não entende fica `Legivel = false` e a carta sai do plano** (o Master
>   of Chaos filtra por uma função à parte) — fingir que aceita tudo é a promessa
>   que enterra um corpo que ela nunca traria.
>
> Nos dois lados o erro é o mesmo silêncio: a carta vai para o cemitério, o motor
> está certo, e a reanimação seguinte simplesmente NÃO A OFERECE.
>
> **A NECESSIDADE do momento** decide entre os alvos válidos, e cada razão só
> pesa na carência dela — fora dela, o critério continua sendo o maior ATK, senão
> a regra atropela (um corpo de 900 que põe carta na mão passaria na frente de um
> de 3000 numa mesa em que nada aperta):
>
> | preciso de | quando | quem ganha |
> |---|---|---|
> | **Campo** | ele tem monstro que eu não supero | quem **QUEBRA** o campo dele ao voltar; não havendo, quem mais **SEGURA** — `max(ATK, DEF)`, e é aí que uma parede de 0/3000 vence um 2000 de ATK |
> | **Carta** | mesa calma e mão de ≤2 depois de gastar esta carta | quem volta **GERANDO CARTA** |
> | **Corpo** | nada apertando | o maior ATK, como sempre |
>
> Quebrar vem antes de segurar pela mesma razão da regra 5.55: a remoção resolve
> de vez, a parede só adia. O que o corpo faz ao voltar sai de
> `AoVoltarDoCemiterio`, e a trava é `EVENT_SPSUMMON_SUCCESS` — o **Breaker the
> Magical Warrior** destrói uma magia ao ser Invocado, mas só por
> `EVENT_SUMMON_SUCCESS`: revivido, ele volta MUDO. Sem essa metade o cérebro
> enterraria o Breaker achando que enterrava uma remoção. *LIMITE CONHECIDO: não
> amarra a categoria ao efeito exato que o gatilho dispara — o Dark Magician of
> Chaos tem dois e conta como as duas coisas. O erro máximo é preferir um alvo
> bom a outro alvo bom.*
>
> Os pares CONTROLE são o teste: a MESMA oferta com a mesa mudada, três vezes
> (900×3000 pela mão, 2600×3000 pela ameaça, 800/2000×1700/1000 pela parede) —
> é isso que prova que quem decidiu foi a necessidade, e não a carta. Mais o
> MESMO deck trocando só a reanimação (Birthright→Monster Reborn muda o alvo de
> volta para o do Caos), e a mesma lista sem a marca da regra, que cai no
> genérico e escolhe o Lustro. E os duelos reais são QUATRO embaralhamentos:
> fixar um seed viraria falha alheia no dia em que o embaralhamento mudasse),
`--test-trava` (as magias de TRAVA — as **Espadas**. O relato foi *"ele está
perdendo e mesmo assim não usa a Swords of Concealing Light"*, e não era critério
errado: era a AUSÊNCIA de qualquer critério. As duas Espadas vêm com
`category = 0` no `cards.cdb`, então nenhuma das regras por EFEITO as enxergava,
e nenhuma lista por id as citava — o NPC carregava a carta a partida inteira
enquanto apanhava. O reconhecimento é o único do `Perfil` que sai **só do Lua**:
a proibição (`EFFECT_CANNOT_ATTACK*` / `EFFECT_CANNOT_CHANGE_POSITION`) mais o
alcance `SetTargetRange(0, LOCATION_MZONE)` — "nenhuma das minhas, todas as
dele". O alcance é metade da regra: a **Gravity Bind** proíbe igual e mira os
DOIS lados, e um NPC de batida que a ativasse prenderia o próprio campo e não
fecharia mais o duelo. O critério de uso é a mesma `ameacaReal` do resto do
cérebro (ele tem monstro que meu campo não supera), e vem DEPOIS da remoção —
as duas resolvem o mesmo problema, mas a remoção resolve para sempre e a trava
tem prazo. Cobre os dois pares controle, a ordem contra o Raigeki, e um duelo
real, que é o único que prova que a carta chega a `activatable`),
`--test-etapa-dano` (a **ETAPA DE DANO** — o fluxo do ataque, medido. O relato
foi *"a fase de batalha e a etapa de dano não estão bem definidas: no Yu-Gi-Oh
declara-se o ataque, escolhe-se quem ataca e em quem, o monstro virado flipa,
abre uma janela de respostas, os cards colidem e só então vem o cálculo de
dano"*. O motor faz tudo isso — e mandava **três** dessas fronteiras para o
vazio: `MSG_ATTACK_DISABLED (112)`, `MSG_DAMAGE_STEP_START (113)` e
`MSG_DAMAGE_STEP_END (114)` não tinham `case` nenhum. O laço de mensagens anda
pelo tamanho declarado de cada uma, então elas eram puladas **em silêncio**, sem
erro e sem log, e a tela via o ataque como UM instante: a seta aparecia e o
resultado já estava na mesa.
> A sequência que o teste mede — e que o front agora desenha — é:
> `attack → damagestep:inicio → pos (o alvo virado ABRE) → battle (1700 x 1400)
> → damagestep:fim`. A virada do alvo acontecer **dentro** da etapa de dano não
> é detalhe de regra: é a única chance de a tela mostrar a carta antes do golpe.
> O par CONTROLE é o ataque **direto**, que não tem alvo para virar nem com quem
> colidir e mesmo assim abre e fecha a etapa de dano — e que, **medido**, TAMBÉM
> manda MSG_BATTLE, com o lado do defensor zerado.
> O terceiro duelo é o ataque **ANULADO**: o jogador baixa uma Negate Attack, o
> NPC ataca, e a janela de resposta chega com `chainTriggerKind = "attack"` e o
> código do ATACANTE. Eram as duas metades que faltavam — sem o gatilho, a única
> frase honesta na janela mais importante do duelo era a da fase (*"seu oponente
> está indo para a Battle Step"*), no exato instante em que um monstro dele vinha
> para cima do seu; sem o `attackcancel`, anular um ataque é indistinguível, na
> tela, de um ataque que ninguém declarou — a seta some, nenhum LP muda, e quem
> gastou a carta não vê nada acontecer.
> Para o `NpcBrain` o gatilho novo **não muda nada, de propósito**: `ValeNegar`
> só sabe medir invocação, magia e armadilha, então um ataque cai no "não sei
> avaliar" e ele continua sem gastar negação ali — que é o que já acontecia
> quando o gatilho vinha vazio),
`--test-guardiao` (o **suporte do arquétipo Gate Guardian**, que entrou no deck
do Para & Dox em 30/08/2026 e mudou uma premissa antiga do cérebro: com a **Dark
Element**, um monstro "Gate Guardian" no cemitério deixou de ser carta morta e
virou **interruptor**.
> Ela **não reanima** — o corpo que ela põe em campo vem da mão, do deck ou do
> Extra; quem está no cemitério só liga a chave. Foi por isso que o Foolish
> Burial precisou de uma razão NOVA (a (c) da regra 5.56): as duas que já
> existiam perguntam *"eu consigo trazer este corpo de volta?"*, e aqui a
> resposta é **não** — e mesmo assim enterrar é a jogada.
> **"Não jogar todos lá"** é a outra metade do pedido, e quem responde
> *"já tem Guardião no cemitério?"* é o MOTOR: a Dark Element só é oferecida com
> a condição cumprida, então estando ela ativável a chave já está ligada. A
> bandeira `_guardiaoEnterrado` cobre o caso em que ela ainda está no DECK e
> portanto nunca aparece em `activatable` para dizer isso. Zero plumbing — a
> mesma dedução do `--test-cegas`.
> **A outra porta para o cemitério: The Cheerful Coffin** (regra 5.565). O
> relato: *"ele tinha 1 Gate Guardian e 1 Dark Element na mão, podia descartar o
> Guardião e sair jogando — como não fez, perdeu"*. É a irmã da razão (c) do
> Foolish: lá o Guardião sai do DECK, aqui sai da MÃO. Ela exigiu um **descarte
> dirigido**, e é por isso que não cabia na regra genérica — o `ValorDescarte` dá
> **−3** ao Gate Guardian justamente para PROTEGÊ-LO do descarte, e essa proteção
> continua certa em todo outro caso. Aqui o descarte é o objetivo, não o preço. A
> marca vale por UMA pergunta (o par controle prova que no descarte seguinte a
> proteção volta), senão o deck se desmontaria sozinho no primeiro custo.
> **O recurso de graça**: as três magias do arquétipo (Dark Element, Double
> Attack! Wind and Thunder!!, Riryoku Guardian) dividem o mesmo segundo efeito —
> banir-se do cemitério para buscar 1 Sanga/Kazejin/Suijin. Vem cedo, junto das
> compras, porque não custa nada: a carta já estava gasta. E exigiu o
> `AtivavelEm(..., GRAVE)`: as três aparecem TAMBÉM da mão, com o mesmo id, e ali
> a Dark Element cobra **metade dos LP** — sem separar por lugar, a regra "de
> graça" pagaria meia vida achando que não pagava nada. É esse o par CONTROLE.
> O Double Attack não ganhou regra própria de propósito: o Lua dela chama
> `Duel.Destroy`, então a remoção genérica já a enxerga — o pedido era somar ao
> que o Para & Dox já faz, não reescrevê-lo.)
`--test-cegas` (**o que o NPC não CONHECE** — duas decisões que erravam pelo
mesmo motivo, as duas vindas de uma sessão de teste real.
> **Atacar às cegas.** *"Ele tentou me atacar com a Parede do Labirinto (0/3000)
> um monstro meu em DEF face-down."* A causa não era o critério de batalha: era
> `DecideBattle` não distinguir **campo vazio** de **campo que ele não consegue
> LER**. O iniciante só enxerga o que está com a face para cima
> (`MonstrosHonestos` filtra as viradas), então um campo com monstros setados
> chegava como lista VAZIA — e o ramo do campo vazio manda atacar com a
> justificativa de dano de graça, que ali não existe. Que o campo não está vazio
> quem diz é o próprio motor: o ataque direto só é oferecido sem monstro do
> outro lado, e um `diretos` não-vazio já teria retornado antes. Nenhum acessador
> novo. O prejuízo é ASSIMÉTRICO — batendo num deitado com ATK menor que a DEF,
> quem ataca não perde o corpo mas **leva a diferença como dano** —, e com 0 de
> ATK não existe nem o lado bom. Daí o `PISO_ATAQUE_AS_CEGAS`.
> **Tributar quem está equipado.** *"O Wevil equipa spell num monstro e tributa
> ele logo em seguida."* O equipamento vai JUNTO para o cemitério: o atalho é
> pago com duas cartas. O ATK vivo sozinho não resolvia (um 300 com +700 continua
> sendo mais barato que um 1700 ao lado), então quem responde é o PREÇO do corpo
> (`ValorDoMeuCorpo`), que passou a contar a carta que sai junto. A regra do
> Insect Imitation (5.4) já sabia disso e resolvia recusando a jogada inteira;
> aqui a resposta é a mesma um nível abaixo, e por isso vale para TODO atalho que
> cobra tributo, sem cada um precisar lembrar.
> Os quatro pares CONTROLE são o teste: o Battle Ox atacando a MESMA carta
> virada, a mesma Parede contra campo REALMENTE vazio, o NPC avançado decidindo
> pela DEF real, e o mesmo campo sem o equipamento. Sem eles, uma regra que
> simplesmente parasse de atacar ou de tributar passaria igual.)
`--test-campo` (a magia de CAMPO quando o outro lado já tem uma. O relato:
*"tentei ativar o Gateway to Chaos com o oponente tendo um Mausoléu do
Imperador no campo, e só deixou SETAR"*. A leitura óbvia — *"a zona de campo é
uma só"* — é falsa neste motor (`DUEL_1_FACEUP_FIELD` não está ligado), e o teste
não deduz isso: **injeta a magia de campo DELE** (`fieldSpellController: 1`, o
mesmo caminho do tabuleiro temático) e pergunta ao motor. A causa era outra e
está abaixo, no `--test-synthesis`: sem `setcodes`, a condição do Gateway — que
procura um Ritual do arquétipo "Black Luster Soldier" no DECK — nunca se
cumpria. O par CONTROLE é o deck SEM nenhum BLS, onde ele tem mesmo de recusar.)
`--test-synthesis` (**A CARTA QUE NUNCA ATIVAVA, e o buraco que ela
desenterrou.** A
**Super Soldier Synthesis** não ficava ativável, com a mesa exatamente como o
texto dela pede. O relato: *"tenho todas as condições — na mão 1 Envoy of Chaos
e LUZ no deck — e ela não ativa"*. O teste monta a mão (Synthesis + Black Luster
Soldier + Envoy of Chaos TREVAS Nv4) com o LUZ Nv4 no deck e conferia
`ativaveis: (nenhuma)`.
> **O par CONTROLE é o que abriu o caso**: a **Black Luster Ritual**, no MESMO
> arnês, na MESMA seed, invocando o MESMO monstro, aparecia normalmente. A
> diferença entre as duas é como cada script acha o monstro ritual: a clássica
> casa por **CÓDIGO** (`AddProcGreaterCode(c,8,nil,5405694)`), a Synthesis por
> **ARQUÉTIPO** (`Card.IsSetCard, SET_BLACK_LUSTER_SOLDIER`).
>
> **A CAUSA, e ela era enorme:** `DatabaseManager.CardReaderCallback` mandava
> `cardData.setcodes = IntPtr.Zero` para o motor — o campo nunca foi preenchido.
> É dele que sai a resposta de `Card.IsSetCard`, então **toda pergunta de
> arquétipo do jogo respondia `false`**, em silêncio: vetor vazio é uma resposta
> legítima ("esta carta não pertence a arquétipo nenhum"). Duas cartas ficaram
> impossíveis de ativar parecendo cada uma um defeito próprio — esta e o
> **Gateway to Chaos** (`--test-campo`), que procura um Ritual do mesmo
> arquétipo no deck.
>
> O `setcode` do `cards.cdb` é um inteiro de 64 bits com até QUATRO arquétipos
> de 16 bits empilhados; a DLL quer um vetor de 16 bits terminado em zero. O
> bloco fica em cache por carta (`_setcodes`) e é liberado no `Dispose`, porque
> o campo é um PONTEIRO que a DLL guarda e lê depois — alocação temporária ali
> vira memória liberada sendo lida no meio do duelo.
>
> **A primeira hipótese estava errada e vale registrar:** eu havia apontado o
> `Group.Iter` ausente na `ocgcore.dll` (`Auxiliary.SelectUnselectGroup` o usa).
> A ausência é real — os scripts SÃO mais novos que o motor —, mas não era ela
> que barrava a carta: com os `setcodes` no lugar, as duas suítes ficaram verdes
> sem tocar em Lua nenhum. Fica como aviso para a próxima incompatibilidade.)
`--test-flip` (a **Invocação-Virar**. Ela é o único jeito de abrir um monstro
setado, e não emitia evento nenhum para a tela: o `ocgcore` NÃO manda
MSG_POS_CHANGE numa flip summon — ele troca a posição sozinho
(`current.position = POS_FACEUP_ATTACK`) e escreve **MSG_FLIPSUMMONING (64)**,
que ninguém traduzia. O duelo andava no servidor e a tela ficava parada: o
jogador clicava "Virar para Ataque", nada acontecia, e no turno seguinte o mesmo
clique — que o cliente ainda achava ser uma virada — caía no reposition de
verdade e DEITAVA o monstro em defesa face-up. Sem erro no console nem no log.
O teste prova o evento que sai para `web/duel.html` (com `flip: true`, pos 0x1 e
o código real, sem o qual a arte não aparece) e traz o par CONTROLE: o mesmo
comando num monstro já aberto emite `pos` SEM `flip`, deitando em 0x4 — que era
exatamente o evento errado que chegava antes),
`--test-card-advance` (a **Card Advance**, e com ela toda carta que pede para
**declarar um número** ou **ordenar cartas**. O relato: *"a Card Advance não é
tratada no jogo"*, e o log de uma sessão real mostra como: o jogador ativa,
escolhe a zona, e `[retry] o motor recusou a resposta anterior (pergunta
pendente: chain)` se repete até o `[guard] laco fechado`. A carta faz duas
perguntas no meio da resolução — `Duel.AnnounceNumberRange` (**MSG_ANNOUNCE_NUMBER,
143**) e `Duel.SortDecktop` (**MSG_SORT_CARD, 25**) — e nenhuma tinha `case`. A 143
ficava FORA da faixa que o `Parse` marcava como não suportada (10..30), então a
pergunta pendente continuava sendo a janela de corrente anterior: o host
respondia `-1` a uma pergunta de número, o motor recusava, e o laço seguia. Nem a
faixa de "ação não suportada" aparecia.
> Os layouts são MEDIDOS, não copiados: o 143 manda **8 bytes por valor** (len 43
> para 1..5); o 25 manda **13 bytes por carta** — `code(4) ctrl(1) loc(4) seq(4)`,
> sem posição, diferente do `loc_info` de 10 das outras perguntas (len 45 para 3
> cartas). A primeira da lista é a de CIMA (sequências 34/33/32 num deck de 35), e a
> resposta é, para cada carta nessa ordem, o LUGAR que ela ocupa (0 = em cima) — a
> INVERSA da fila de cliques da tela. Mandar a fila crua é aceito pelo motor e deixa
> o deck numa ordem que ninguém pediu; a conversão mora em
> `web/js/ordenarcartas.js`, com teste. Quem pergunta vem do **MSG_CHAIN_SOLVING
> (72)**: os elos são guardados no MSG_CHAINING e a carta do elo que resolve vai no
> `askCode` — o gatilho não serve, ele é a ÚLTIMA carta ativada.
>
> O teste prova, pelo caminho do jogador: os valores 1..5 e quem pergunta; declarar
> 3 traz 3 cartas do deck; ordem torta é recusada e a MESMA pergunta volta (o motor
> a recusaria com RETRY e a tela ficaria parada); a ordem invertida muda a compra do
> turno seguinte; e o segundo efeito da carta vale (o Summoned Skull oferecido
> depois de um Nv4). Os pares CONTROLE, na mesma seed: manter a ordem compra a carta
> que já estava em cima — é ele que fixa qual ponta da lista é o topo —, e sem a
> Card Advance o Skull não é oferecido.
>
> A faixa do "não suportada" virou 10..29 e 140..143. O **30** (MSG_CONFIRM_DECKTOP,
> que o Monster Gate manda) é só aviso e virava não suportada à toa; as
> **declarações de raça, atributo e carta (140–142)** continuam sem tradução, mas
> agora aparecem na faixa da tela em vez de morrer caladas no `[guard]`.
>
> **O NPC não usa a Card Advance** (`--cobertura`: *nenhuma regra escolheu*). As
> respostas dele existem — declara o MAIOR número (`NpcBrain.DecideNumber`) e mantém
> a ordem — e são os mesmos bytes que o teste prova pelo jogador, mas nenhum duelo
> de NPC chega lá até a carta ganhar regra.)
As sondas do protocolo binário são `--probe-idle`, `--probe-pos`, `--probe-battle`,
`--probe-chain`, `--probe-tribute`, `--brute-tribute`, e `--selfplay` despeja as
mensagens cruas do motor. `npm run duel:test` só roda `--test-npc` +
`--test-summons`; as outras suítes precisam ser chamadas na mão (ver
`package.json`).

## Release, motor e casca

> **Mexeu em C#? O Release comum LEVA a sua mudança** — desde 19/08/2026. O motor
> deixou de morar dentro do executável: ele é o pacote **`engine`** (o
> `DuelServer.Engine.dll`, ~200 KB) mais o **`native`** (`ocgcore`+`sqlite3`,
> ~1,9 MB), publicados pelo `release:build` como `game`/`cards` sempre foram.
> Então a sequência voltou a ser a mesma do front: `npm run release:build` →
> `npm run release:publish`. Sem `pack`, sem `-ComExe`, sem bump de versão na mão.
>
> Antes disto, o `duel-server` viajava **só dentro do `ClassicDuels.exe`**: uma
> correção de 800 KB no `NpcBrain` custava 67,8 MB ao jogador e dependia de um
> ritual manual que já foi esquecido em produção — a varredura de ATK/DEF (magia
> de campo) saiu publicada no front e ausente no motor, o Umi seguia sem efeito na
> tela de quem jogava, e os testes todos passavam aqui. Hoje o `pack.ps1` recusa
> um `engine.zip` mais velho que os fontes em C#, que é a mesma checagem que ele
> já fazia para o front.
>
> **O `.exe` só precisa ser republicado quando a CASCA muda** (`duel-server/host/`
> — ~400 linhas que resolvem a instalação, aplicam o motor em estágio e o
> carregam). Aí sim: `npm run pack` + bump da `InstallerVersion`. Quanto menos a
> casca fizer, mais raro isso é — e é de propósito.
>
> **Mas o exe VIAJA em toda publicação, desde 22/08/2026** — mesmo sem `-ComExe`,
> mesmo sem bump. Não é redundância: o campo `installer` do manifesto é a ÚNICA
> forma de um cliente descobrir que existe um executável novo
> (`UpdateEngine.Montar`), e com ele nulo o jogador de exe antigo não é avisado de
> nada. Como o motor agora cai em `.staged/` e **quem aplica o estágio é a casca
> ≥ 0.15.0**, um exe 0.14.x baixa o `engine.zip` todo dia e nada o carrega: front
> novo, motor congelado **para sempre**, sem um erro sequer.
>
> Aconteceu de verdade. Só os dois Releases de 19/08/2026 saíram com o exe; todos
> os seguintes com `installer: null`. Quem não abriu o jogo naquela janela de 25
> minutos ficou preso — o sintoma, do lado de quem joga, foi a magia de campo do
> tabuleiro entrando do lado do JOGADOR em vez do NPC (`fieldSpellController`,
> motor 0.3.0) e o ATK/DEF sem aparecer impresso na carta (o evento `stats` da
> `VarrerStats`, motor 0.6.0 — `duel.html` só desenha o rótulo quando o valor
> chega). Os dois estavam corrigidos no repositório havia dias.
>
> O custo é de quem PUBLICA (~66 MB de upload), nunca de quem joga: o cliente
> compara `installer.version` com a compilada dentro dele e não baixa nada quando
> são iguais. `-ComExe` sobrou como "exija o exe" — falha em vez de avisar quando
> `dist/ClassicDuels.exe` não existe. E o `publish-release.ps1` agora **recusa**
> publicar um exe empacotado antes da última mexida na casca (compara
> `dist/.cache/casca.digital`), que entregaria uma casca velha carregando um motor
> novo, em silêncio.

> **A SEGUNDA metade do mesmo congelamento (23/08/2026).** Preencher o
> `installer` no manifesto não bastava: quem troca o exe é o `UpdateService`, e
> ele só é chamado DENTRO do `Aplicar` — que só roda quando o boot decide que há
> atualização, isto é, quando o plano não diz `NadaAFazer`. E `NadaAFazer` olhava
> só arquivos, pacotes e órfãos. Bastava o CONTEÚDO ficar em dia (o que acontece
> no primeiro update bem-sucedido) para todo boot seguinte responder "tudo em
> dia" com um exe de duas versões atrás — e nunca mais oferecer a troca.
>
> O desfecho era o mesmo de antes, por um caminho diferente: exe < 0.15.0 não
> aplica o pacote `engine` (ele fica em `.staged/`), então o motor congelava
> junto, **para sempre**, enquanto o front continuava chegando. O relato do
> jogador foi literalmente *"atualizou umas 2 vezes e mesmo assim está com um
> cliente bem antigo"*.
>
> Hoje `NadaAFazer = SemConteudo && !InstaladorDesatualizado`, e o `AplicarAsync`
> sai por `SemConteudo` (senão abriria uma pasta de backup vazia a cada boot). O
> `Resumo()` e o `BytesTotais` passaram a contar o exe — a tela prometia "0,8 MB"
> e baixava setenta. Coberto por `ExeVelhoNaoFicaCongelado` em `--test-update`,
> com o par CONTROLE de que o exe EM DIA continua não abrindo tela nenhuma.

> **A TERCEIRA vez, e a pior: o exe DESFAZENDO a atualização (24/08/2026).** O
> relato foi *"as versões antigas baixam o conteúdo, mas ficam presas numa home
> sem interação e sem informações da conta — e no banco o login nem é
> realizado"*. Não era o login: era um **laço infinito de atualização**, lido do
> `duel-server.log` de uma máquina de verdade:
>
> ```
> pacote 'game' instalado (132 arquivos) — game-e8fb91c13b31  ← do Release: certo
> executavel novo instalado — reabrindo o Classic Duels
> =====  nova sessao  =====
> versao nova do jogo — atualizando os arquivos
> pacote 'game' embutido: 122 arquivos — game-7abc579bf254    ← rebaixou tudo
> atualizacao disponivel: game + engine + 10 orfao(s)         ← e recomeça
> ```
>
> A causa é o `.exe` de um Release embutir um `game.zip` **mais velho que o
> `game.zip` daquele mesmo Release** — basta o `pack` ter rodado antes do último
> `release:build`. É a armadilha que o `npm run atalho` já documentava, agora
> mordendo no `publicar.exe`. O boot seguinte via o `.versao` diferente,
> concluía "versão nova do jogo" e reinstalava o payload INTEIRO por cima do que
> o updater acabara de baixar, **carimbando o marcador antigo**. A checagem
> seguinte oferecia a mesma atualização. Para sempre.
>
> Do lado de quem joga não havia "atualização falhou": o jogo ficava
> permanentemente no front da data do `pack`, rodando contra um banco que já
> tinha seguido em frente. Os 10 órfãos são a conta exata: 132 − 122.
>
> **O conserto é uma regra de autoridade, não uma comparação de versões**: o
> marcador é um DIGEST (`game-e8fb91c13b31`), não um número — não existe "maior".
> Havendo marcador em disco, o pacote é administrado pelo updater e **o payload
> embutido não encosta nele** (`Payload.ExtrairPacote`). O payload voltou a ser o
> que sempre devia ter sido: a **semente da primeira instalação**, nunca uma
> sobrescrita. É a mesma regra do resto do projeto — *cópia local nunca vence a
> nuvem* —, e aqui o payload embutido É a cópia local.
>
> De brinde, a troca de executável parou de reescrever os ~21 mil `.lua` do
> `cards` toda vez: eles eram reextraídos mesmo com o marcador idêntico ao do
> disco, só porque o `.versao` do payload havia mudado.
>
> Coberto por `PayloadVelhoNaoRebaixaOQueOUpdaterInstalou` em `--test-update`,
> com o par CONTROLE de que a instalação NOVA (sem marcador) continua sendo
> servida pela semente — sem ele, um `ExtrairPacote` que nunca extraísse nada
> passaria em todas as outras asserções e deixaria todo download novo do jogo
> sem conteúdo, que é um estrago bem maior que o laço.
>
> E a outra metade, para não voltar: `tools/pack.ps1` registra em
> `dist/.cache/payload.markers` o que embutiu, e `publish-release.ps1`
> **recusa publicar** quando isso não bate com os pacotes do manifesto que está
> subindo. A digital da casca, que já existia, responde *"o exe tem o CÓDIGO mais
> novo"*; esta responde a metade que ela não vê — *"o exe tem o CONTEÚDO mais
> novo"*.

> **O ÓRFÃO QUE APAGAVA O QUE O PACOTE ACABARA DE INSTALAR (24/08/2026).** O
> segundo defeito do mesmo dia, independente do laço acima e **muito** mais
> visível: a lista de órfãos é montada no PLANO, contra o inventário de ANTES, e
> aplicada **depois** de os pacotes serem reinstalados. Todo arquivo que o pacote
> NOVO trazia e o inventário VELHO não conhecia era instalado — e apagado
> segundos depois.
>
> Na instalação de teste sumiram dez: `bootguard.js`, `versao.js`, `chatdoca.js`,
> `chat.js`, `poolordem.js` e os `.test.mjs` deles. `index.html` importa três, e
> **um `import` que dá 404 mata o `<script type="module">` inteiro** — a home
> passou a desenhar só o casco estático de fábrica. É literalmente o relato:
> *"fica travado numa home sem interação e sem informações da conta"*. E não
> havia erro em lugar nenhum porque o módulo que existe para mostrar a falha na
> tela (`bootguard.js`) era um dos apagados.
>
> Quem estava no laço do payload era exatamente quem tinha o inventário
> desatualizado — então os dois defeitos se alimentavam: o laço produzia o
> inventário torto, e o inventário torto fazia a atualização seguinte apagar os
> módulos novos.
>
> **São dois consertos, e cada um cobre o que o outro não cobre:**
>
> - **impedir** — na hora de apagar, o `AplicarAsync` relê os inventários
>   RECÉM-ESCRITOS e cancela o órfão que o pacote novo reivindica (`orfao
>   cancelado: … — o pacote novo o traz`);
> - **curar** — o diff dos pacotes é por MARCADOR e só por ele, então *marcador
>   em dia com arquivo faltando* é um estado que **nada** reinstalava: o plano
>   dizia "tudo em dia" para sempre. Agora o `Montar` confere se todo arquivo do
>   inventário está no disco e, faltando um, marca o pacote como pendente.
>
> A checagem de integridade custa **zero I/O extra**: pergunta apenas pelos
> arquivos que a varredura de órfãos já enumerou. E não é coincidência que baste
> — quem apaga é essa mesma varredura, então nenhum arquivo fora dela corre esse
> risco. Hashear os 21 mil `.lua` do `cards` por boot para chegar à mesma
> conclusão seria pagar segundos por algo que a lista já sabia.
>
> Coberto por `OrfaoNaoApagaOQuePacoteNovoTrouxe` em `--test-update`, que prova
> as duas metades separadamente e traz o par CONTROLE de que uma instalação
> intacta continua sendo "tudo em dia" — sem ele, uma checagem que pedisse
> reinstalação sempre passaria nas outras asserções e faria todo boot baixar 27
> MB de `cards`.

> **A parede de versão não sobe na tela de LOGIN** (`deveBloquear`, 24/08/2026).
> Ela é `position: fixed; inset: 0` e cobria o formulário inteiro — foi metade do
> relato acima, na população que roda um exe anterior a 0.15.0: esses aplicam o
> `game.zip` mas nunca o `engine`, então ficam com o front de hoje sobre um motor
> que **não tem a rota `/__versao`**. O 404 vira selo vazio, vazio não alcança
> piso nenhum, e com `modo='bloquear'` a parede subia em cima do login.
>
> Barrar ali não protegia nada — quem barra de verdade é `iniciar_duelo`, na
> porta — e criava um beco sem saída: a isenção de ADMIN (`eh_admin()`, migration
> 0042) lê `auth.uid()`, que sem sessão é nulo. Com a parede antes do login, o
> admin de cliente velho não conseguia se autenticar para ser isento — exatamente
> o "trancar do lado de fora quem pode desligar a trava" que a 0042 foi escrita
> para impedir, um passo mais cedo.

> **Compile sempre com o servidor parado.** O `.exe` fica travado enquanto roda,
> o `dotnet build` falha *e o teste seguinte roda o binário antigo* — parece que a
> mudança não funcionou. Use `npm run duel:build` / `npm run duel:test`, que
> derrubam o servidor antes.

## Arquitetura do servidor

**`duel-server/`** — .NET 8 que hospeda o `ocgcore` (edo9300) via P/Invoke e o
expõe como **RPC HTTP** em 8770. São **dois projetos** desde 19/08/2026:
`engine/duel-engine.csproj` compila `src/**` como **`DuelServer.Engine.dll`** (o
motor: `InteractiveDuel`, `NpcBrain`, `WebServer`, `StaticServer`, o updater e as
suítes) e `duel-server.csproj` compila só `host/**` — a **casca**, o executável
que resolve a instalação, aplica o motor que ficou em estágio e o carrega **do
disco, por bytes** (`Assembly.Load(byte[])` — `LoadFrom` travaria o arquivo e a
atualização seguinte não conseguiria substituí-lo). Os fontes do motor **não
mudaram de lugar**: continuam em `duel-server/src/`.

> É essa separação que faz uma correção no `NpcBrain` chegar ao jogador como um
> pacote de 0,2 MB (`engine.zip`) em vez de um executável de 66 MB. A casca chama
> o motor por **reflexão** (`DuelServer.EngineEntry.Main`) e nunca usa um tipo
> dele: uma referência estática faria o runtime carregar a cópia embutida antes
> de a gente ter a chance de preferir a do disco. A cópia embutida existe e é a
> rede de segurança — é ela que roda em desenvolvimento e quando o motor baixado
> não sobe (`--motor-embutido` força na mão; `CLASSICDUELS_RAIZ` aponta uma
> instalação de mentira, que é como se testa o caminho do jogador daqui).

O contrato do RPC: `POST /start {deck,npcDeck?,seed?,flags?,npc?}`
e `POST /respond {action,arg,args?}` → `{events:[…], question:{…}|null, ended}`.
`InteractiveDuel.cs` é o coração: avança o motor até a *sua* decisão, resolve
sozinho o que não é decisão (correntes, posição, oponente) e traduz o buffer
binário em eventos + a pergunta pendente. `NpcBrain.cs` é a IA do adversário —
regras explícitas e ordenadas, cada jogada emite um evento com o `why`.

**`ygo-data/`** — dataset gerado (`tools/build.py`) do `cards.cdb`: 13.728 cartas
em JSON, índice enxuto de 2 MB para o browser, 12.702 scripts Lua. `src/ygodb.js`
é a API de consulta (ESM, Node e browser). É camada de **dados**, não de regras.
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

## Diagnóstico ao vivo: o raio-x e o log da mão do NPC

> **RAIO-X: a caixa "ver a mão do NPC"** na tela do duelo, só para admin. É o
> mesmo diagnóstico do log, mas ao vivo — a pergunta que o originou foi *"o que
> ele tem de tão brickado que não descarta, não compra e não popula o campo?"*.
> A mão vem por uma rota à parte (`POST /espiar`, em 8770), nunca nos eventos do
> duelo: `Projetar` manda `code: 0` do lado do oponente, e é ele que impede a
> mão de vazar para quem não pediu — enfiar isso no `Entregar` um dia vazaria
> para a tela de quem não pediu.
>
> **A trava de verdade é uma só: contra um HUMANO a mão não sai.** No
> multiplayer quem hospeda roda o motor para os dois e tem a mão do outro
> jogador na memória (`ponte.js`), então `MaoDoNpc()` devolve `null` ali —
> `null` e não lista vazia, porque "não posso mostrar" e "ele está sem cartas"
> são respostas diferentes. O "só admin" é guarda de TELA (a caixa nasce
> `hidden` e só aparece quando o SERVIDOR diz que o perfil é admin, como o botão
> da Área de Teste): este servidor roda na máquina do jogador e não valida token
> do Supabase, então chamá-lo de fechadura seria mentira. `IsLocal` fecha a
> porta para a rede, que com `--lan` alcança a 8770. Coberto por
> `--test-multiplayer`, com o par controle — sem ele, uma `MaoDoNpc()` que
> devolvesse `null` sempre passaria no teste e o raio-x não mostraria nada, em
> silêncio.

> **O log diz o que o NPC tinha na MÃO** (`[npc] mao (5): 62121 Nv4 920/1930 | …`),
> uma linha por mudança de mão, escrita pelo `Decide`. Todas as outras linhas
> `[npc]` dizem o que ele decidiu e por quê; nenhuma dizia com o que ele estava
> decidindo — e sem isso um turno em que ele "não fez nada" tem duas explicações
> indistinguíveis: a mão não tinha jogada, ou tinha e a regra não a viu. É
> exatamente a pergunta de quem desconfia do cérebro. De fora não dá para
> reconstruir: a mão dele nunca chega ao front (`Projetar` manda `code: 0`), e
> repetir o embaralhamento pelo seed exigiria os dois decks na ordem exata em que
> foram enviados, que o log não guarda. Os códigos vão crus porque o motor não
> conhece o nome das cartas — o nome mora no `ygo-data`, que é do front.

## Instalador e atualização

### Atualizar deixou de ser opcional (23/08/2026)

A tela de atualização (`web/atualizando.html`) tinha um **"jogar sem atualizar"**,
e o boot deixava entrar quem estivesse **offline**. As duas saíram, e as duas
pelo mesmo motivo: a premissa que as justificava (*"offline nunca trava o
jogo"*) deixou de valer quando login, carteira, coleção, decks, adversários e
trilha foram todos para o Supabase. Entrar sem rede não entrega mais um jogo —
entrega uma home vazia com cara de quebrada. E o cliente parado numa versão
velha, esse sim, custa caro: front novo falando com motor velho, deck que o
servidor recusa por uma regra que só existe na versão nova, e o congelamento de
19/08/2026, que passou dias entregando front e nenhum motor.

Hoje: havendo atualização, a única ação é **atualizar agora**; não alcançando o
servidor, o jogo **espera** na tela, que reconsulta sozinha a cada 10s (e tem um
**tentar de novo** para quem não quer esperar). O **"voltar para a versão
anterior"** saiu junto, pela mesma razão — voltar é ficar para trás. Os backups
continuam sendo feitos (nada é apagado numa atualização) e a rota
`/__update/restaurar` continua existindo; o que deixou de existir é oferecê-la
como escolha a quem joga. Ela é a alavanca de quem conserta um Release quebrado,
e o caso comum nem chega nela: a casca reverte sozinha um MOTOR que não sobe. A rota nova é
`POST /__update/rechecar`, só de localhost — sem ela, cada tentativa custava um
boot inteiro do jogo.

> **O cache do manifesto também não passa mais.** `CarregarManifestoAsync` cai
> no `.duelacademy/manifest.cache.json` quando a rede falha, e o plano montado
> em cima dele dizia "tudo em dia" — o jogo abria offline achando-se atualizado.
> Ele continua existindo e continua respondendo, mas agora se **anuncia**
> (`UpdateEngine.ManifestoVeioDoCache`), e `Checar` trata isso como "sem
> conexão". O cache diz o que era verdade **da última vez**; aceitá-lo como
> resposta deixava passar exatamente o cliente velho que não consegue perguntar
> se está velho. Coberto por `--test-offline`, com o par controle.

> **O que NÃO mudou:** nada disto pode virar exceção no boot. Toda falha de rede
> continua virando um ESTADO (`Indisponivel`) que a tela sabe mostrar — jogo que
> não abre e não diz por quê continua sendo o pior desfecho possível.

> **`npm run dev` e `--sem-update` não são afetados**: a checagem só roda com
> `Payload.Exists` (jogo empacotado). Em desenvolvimento nada disso acontece.

### Duas janelas do jogo depois de atualizar (23/08/2026)

A troca do motor e a do exe fecham o jogo e o reabrem por um `.bat`. O processo
novo abria o navegador — e a janela ANTERIOR (a que mostrou a barra de
progresso) continuava viva, consultando `/__update/status`: quando o servidor
novo respondia "tudo em dia", ela ia sozinha para a home. Duas cópias do jogo na
tela, e como o navegador abre em modo `--app` (sem barra de endereço), cada uma
parece um executável. O relato foi *"2 exe abrindo após att"*.

> **A metade que faltava, e que quebrou o boot (23/08/2026).** Passar o
> argumento só serve se quem o recebe continuar sendo o JOGO — e a condição de
> modo era `bool app = … || (args.Length == 0 && Payload.Exists)`. Com
> `--reaberto`, o executável empacotado via UM argumento, concluía que não era
> `--app` e caía no **modo de demonstração**: rodava um duelo de teste no
> console, nunca subia o servidor do front, e a janela do navegador ficava
> consultando `/__update/status` num servidor que não existia. Do lado de quem
> joga: *"o launcher fica travado nessa tela e preciso fechar e abrir de novo"*.
> `--lan`, `--sem-update`, `--no-browser` e `--motor-embutido` tinham a mesma
> armadilha esperando — qualquer um sozinho caía no mesmo lugar. Hoje a regra é
> sobre o que o argumento SIGNIFICA (`Program.EhModoApp` + a lista
> `MODIFICADORES`), não sobre quantos vieram, e é `internal` justamente para ter
> teste: `Main` não é chamável de fora, e a decisão erra calada.

O `.bat` agora reabre com **`--reaberto`**, e com essa flag o boot **não abre
janela nenhuma**: a que já está aberta é a janela do jogo, e é ela que vai para
a home. A rede de segurança é `WebServer.Atendidas` — se ninguém falar com o
servidor em 6 segundos, a janela anterior foi fechada durante a atualização, e
aí sim se abre uma nova. Coberto por `--test-selfupdate`, que confere o
argumento que chega ao processo reaberto.

> Efeito colateral bem-vindo: como a janela é a mesma, o `sessionStorage`
> sobrevive à atualização — quem não marcou "manter login" não é deslogado por
> ter atualizado.

### O jogo não abre mais uma janela de terminal (23/08/2026)

`ClassicDuels.exe` virou **`WinExe`**: o Windows para de criar a janela de
console, que aparecia por cima do jogo e tinha de ser minimizada. Três peças
pagam o preço disso, e nenhuma é opcional:

- **`host/Console.cs`** — um `WinExe` chamado de um terminal **não se anexa a
  ele**, e as suítes (`--test-*`, `--cobertura`, `--probe-*`) ficariam mudas.
  `AttachConsole(ATTACH_PARENT_PROCESS)` resolve os dois casos com a mesma linha,
  porque a resposta vem de quem chamou: do terminal, anexa; de dois cliques, o
  pai é o Explorer e não há nada a anexar.
  > **Só quando não há para onde escrever.** A primeira versão anexava sempre e
  > reabria `Console.Out` — o que **jogava fora o pipe** de quem tinha
  > redirecionado. O sintoma foi `npm run update:test` respondendo exit 0 com a
  > saída das suítes sumida. Hoje um `GetFileType` decide: handle utilizável
  > (pipe, arquivo ou console herdado) → não encosta em nada. E "não é nulo" não
  > basta — o handle de um `WinExe` vem não-nulo e **inválido**, e a primeira
  > escrita morria com `IOException`.
- **`AvisoDaCasca`** — sem console, `CascaLog.Err` só escrevia no arquivo, e "o
  motor não subiu" virava o jogo não aparecer em silêncio absoluto. Agora é caixa
  de diálogo, como o `Aviso` do lado do motor (que não dá para reusar daqui: ele
  mora no motor, que é justamente o que falhou).
- **`Console.OutputEncoding` e `Console.Title` viraram `try/catch`.** As duas
  EXIGEM console e lançam sem ele — e a exceção subia até o `Motor.Invocar`, que
  a lia como *"o motor novo quebrou ao subir"*, punha o motor de castigo e caía
  para o embutido. Um enfeite de acentuação teria feito o updater **rejeitar todo
  motor novo**, na primeira linha executada.

**E quem fecha o jogo agora?** Era a janela do terminal ("DEIXE ESTA JANELA
ABERTA"). Passou a ser a ausência de batidas: toda tela de `web/` chama
`manterVivo()` (`web/js/vivo.js`), que pinga `POST /__vivo` a cada 5s, e
`WebServer.VigiarAJanela` encerra o processo depois de `JANELA_VIVO` (15s) sem
nenhuma. Só no modo `--app` — em `npm run dev` o duel-server é outro processo, que
ninguém manda sair —, e só **depois da primeira batida**: entre subir o servidor e
o navegador abrir passam segundos, e um relógio contando desde o boot encerraria
o jogo antes de ele aparecer.

> **Não é o processo do navegador que se espera morrer**, que seria menos código:
> com `--app=URL` e sem `--user-data-dir`, um Chrome já aberto repassa a janela
> para a instância existente e o processo que lançamos **morre na hora** — o
> servidor cairia com o jogo aberto na tela, e só para quem já estava com o
> navegador aberto. Consertar isso exigiria um perfil de navegador dedicado, que
> muda o `localStorage` de lugar e desloga todo mundo uma vez.

> **A janela DOBRA quando a página está oculta** (`JANELA_VIVO_OCULTO`, 10 min), e
> essa é a metade que faltaria: o navegador **estrangula `setInterval` em página
> minimizada** — o Chrome derruba para cerca de uma batida por minuto. Com os 15s
> valendo ali, minimizar o jogo por um minuto o encerraria, e o jogador voltaria
> para uma janela morta sem ter fechado nada. A batida manda `?oculto=1` e
> também dispara no `visibilitychange`, para o servidor saber disso na hora. Os
> dez minutos ainda limitam o estrago do caso indetectável (o navegador morto
> enquanto minimizado, sem `pagehide`).

> **`node web/js/vivo.test.mjs`** varre TODA página de `web/` exigindo a linha —
> uma tela que a esqueça faz o jogo se fechar debaixo de quem está jogando, e o
> sintoma não é erro nem log, é o jogo sumindo depois de quinze segundos parado
> numa tela específica. O teste também **lê a `JANELA_VIVO` do fonte em C#** em
> vez de copiar o número: dois valores escritos à mão em linguagens diferentes se
> desencontram no primeiro ajuste, e aqui o desencontro só encurta a folga até o
> dia em que o jogo começa a se fechar sozinho. `--test-vivo` cobre a decisão do
> outro lado (o boot, a batida atrasada, o relógio ajustado para trás, a página
> oculta), com par controle.

## Contas (o lado servidor)

> A metade cliente disto — `requireLogin`, `requireAdmin`, onde a sessão é
> guardada e o que a Área de Teste esconde — está em **`web/CLAUDE.md`**.

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

## O fim da partida no multiplayer (07/09/2026)

> A metade cliente disto — a ponte, a fila de visões e o quadro de fim — está em
> **`web/CLAUDE.md`**.

**Quem decide o fim é o banco, e é o banco que avisa.** `encerrar_partida`
(0016) sempre fechou a linha em `partidas`, mas só quem chamou ficava sabendo: o
adversário estava com o `duel.html` aberto ouvindo `ler_lances`, e a desistência
não escrevia lance nenhum. Ele ficava olhando um tabuleiro vivo de uma partida
encerrada, para sempre — o relato foi *"hoje a sala fica aberta e o duelo n
encerra"*. A única saída era o "estou preso" do Multiplayer, que não conta a
ninguém quem ganhou.

A **migration 0056** fecha isso pelo canal que já existe: `lances` ganha o tipo
`fim`, e a própria `encerrar_partida` insere a notícia (`{vencedor, motivo}`) na
caixa do OUTRO. Nada de canal novo, nada de consulta nova — a notícia chega na
mesma volta do laço em que chegaria uma jogada. `sair_de_tudo` faz o mesmo, e
por isso deixou de ser um `update` em lote: cada partida precisa do aviso para o
seu adversário, e um comando em lote não tem onde escrever isso.

Três coisas para não desfazer sem querer:

- **A saída antecipada de `encerrar_partida` é o que evita o aviso em dobro.**
  No fim normal os DOIS lados chamam (cada um ao ver o `end` do motor); sem o
  `ja_estava`, o vencedor receberia um "a partida acabou" depois de já ter visto
  a própria vitória.
- **`p_empate` existe porque `p_vencedor` nulo já queria dizer outra coisa** —
  "eu desisti, o outro ganha". O empate era gravado como vitória de quem não
  ganhou, e agora viraria também um *"seu adversário desistiu"* na tela dele. A
  função de 2 argumentos foi DERRUBADA e recriada com o terceiro tendo default:
  o PostgREST casa pelo conjunto de nomes que chegam no corpo, então um cliente
  antigo continua funcionando.
- **O front não confia só no lance.** A ponte confere `partidas.estado` a cada 5
  voltas (~4,5 s). É a rede embaixo do caminho rápido: cobre a linha fechada por
  fora (o SQL Editor), um servidor sem a 0056 e um lance perdido. O que ela NÃO
  cobre é a aba fechada no meio do duelo — ali ninguém encerrou nada, e o
  "estou preso" continua sendo a saída (de propósito: um encerramento no
  `pagehide` transformaria um F5 em derrota).

## Armadilhas conhecidas do servidor

- **`decks/npc/*.ydk` e o pool de drop NÃO viajam no Release.** O manifesto leva
  `web/`, `ygo-data/`, `boards/` e quatro `store/*.json`; `store/` e `decks/`
  são intocáveis por código (`UpdateEngine.Intocaveis`), com uma allowlist
  fechada (`GlobaisPermitidos`) para o punhado de arquivos que são conteúdo. O
  deck de NPC no disco é só a SEMENTE que veio dentro do exe — quem manda é o
  banco, e é de lá que o jogo lê. Não "conserte" isso publicando `.ydk` no
  Release: o caminho é o Supabase.
- **Marca da Web (erro 1223).** Arquivo que veio de fora da máquina carrega o
  fluxo `Zone.Identifier`; o `Spawn` do launcher usa ShellExecute com janela
  oculta, então o Windows cancela sem perguntar nada e o sintoma é
  `nao consegui iniciar o duel-server: … A operação foi cancelada pelo usuário`.
  O launcher detecta esse erro, explica e **pede autorização** antes de remover
  a marca (`OfferUnblock` em `launcher/Program.cs`). Na mão:
  `Get-ChildItem duel-server\bin -Recurse -File | Unblock-File`.
