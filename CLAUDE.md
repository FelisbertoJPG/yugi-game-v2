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
node web/js/drops.test.mjs   # 41 testes do drop por DECK (pool por raridade, a % de cada
                             # uma, o descarte de quem tem carta mas quantidade zero, a
                             # reserva por NPC de quem ainda não tem pool próprio, e o
                             # [definir rápido] — que só leva carta COM raridade e nunca
                             # remexe a que já está num quadro)
node web/js/cardlists.test.mjs  # 15 testes das listas de cartas (pool permitido + resolução)
node web/js/estrutural.test.mjs # 10 testes do rascunho do Deck Estrutural: ele salva
                             # o trabalho, mas NUNCA é carregado de volta — ao abrir a
                             # tela vai para store/bkp/ e sai do navegador
node web/js/trilha.test.mjs  # 19 testes da Trilha de Duelos: a liberação (cada vitória
                             # abre o próximo), a ordem publicada por campanha e o
                             # CHAMADOR — trilha.js passando os vencidos a liberados()
node web/js/decksnpc.test.mjs # 27 testes da trilha de DECKS dentro de um adversário
                             # (o `#libera` de cada deck, a dificuldade como rótulo
                             # livre, e a config torta que nunca pode deixar um
                             # adversário injogável)
node web/js/npcativo.test.mjs # 8 testes do deck ATIVO de cada NPC (conteúdo publicado,
                             # resolvido pelo nome — não pelo índice)
node web/js/boards.test.mjs  # 20 testes do CONTRATO do schema de tabuleiros: toda
                             # zona de `zoneIds()` precisa de posição em
                             # `defaultLayout()`, senão o backfill (editor e duelo)
                             # não tem o que copiar e o elemento cai por cima do campo
                             # — sem erro nenhum. Cobre também a zona de BANIDAS
node web/js/banimento.test.mjs # 17 testes da pilha de cartas BANIDAS: banir com a
                             # face para baixo (chega sem código) e o retorno dela,
                             # que vem COM o código real — sem o par, a carta virada
                             # ficava encalhada na pilha e o contador mentia
node web/js/posicao.test.mjs # 11 testes do rótulo de "mudar posição" no menu da
                             # carta: o motor tem UM comando (reposition) e as regras decidem
                             # o resultado, então o menu promete — virada vira pra cima em
                             # ATAQUE, ataque deita em DEFESA, defesa levanta em ATAQUE.
                             # Um rótulo errado não quebra duelo nenhum, só mente pro jogador
node web/js/ofertas.test.mjs  # 16 testes de QUAL EFEITO esta' sendo oferecido: o
                             # motor nao oferece cartas, oferece EFEITOS — uma
                             # carta com dois aparece DUAS vezes, mesmo codigo e
                             # mesma arte. `mapList` guardava um indice por
                             # posicao da mao, entao o segundo efeito era
                             # impossivel de ativar (em silencio, com o menu
                             # prometendo "Ativar"); e uma copia em CAMPO com o
                             # mesmo codigo roubava a posicao da que estava na
                             # mao. Cobre tambem o rotulo, que erra igualmente
                             # calado: duas linhas escritas igual nao separam
                             # nada — texto do motor quando ele veio, a ordem
                             # quando nao veio, nunca uma frase inventada
node web/js/setaataque.test.mjs # 16 testes da SETA do ataque (quem ataca quem,
                             # desenhado na mesa). O ataque tem DOIS momentos e
                             # a tela juntava os dois: a investida do atacante
                             # rodava ja' na DECLARACAO, entao quem ia responder
                             # via o golpe acontecer e so' depois era perguntado
                             # se queria impedi-lo. Hoje a declaracao desenha a
                             # seta (e ela FICA enquanto a janela de resposta
                             # esta' aberta) e a investida saiu para a
                             # RESOLUCAO — `battle`, ou o dano no ataque direto.
                             # A geometria e' testada porque erra CALADO: um
                             # NaN no `d` do caminho nao desenha nada e nao
                             # avisa. Cobre a divisao por zero (atacante e alvo
                             # no mesmo ponto), as oito direcoes, e o recuo que
                             # nao pode comer o caminho todo entre zonas
                             # vizinhas. E cobre a armadilha que fez a seta ser
                             # PUBLICADA invisivel: `svg.hidden = false` nao faz
                             # nada — `hidden` e' propriedade do HTMLElement e um
                             # <svg> e' SVGElement, entao aquilo virava um campo
                             # solto no objeto e o atributo (com o display:none)
                             # continuava. Sem erro, sem console: a camada
                             # inteira ficava escondida. Hoje e'
                             # `mostrarCamada`/`esconderCamada`, por atributo
node web/js/pacote.test.mjs  # 19 testes da CHANCE que a Loja promete em cada
                             # gaveta de um booster. Quem sorteia e' o banco
                             # (`abrir_pacote()`), e ele NAO renormaliza os
                             # pesos entre as raridades presentes: rola os
                             # 706/252/38/4 fixos e, quando a gaveta sorteada
                             # esta' vazia, DESCE pela cascata ate' achar uma
                             # com carta. Um booster sem UR nao "dilui" os 0,4%
                             # dela no resto — eles viram SR. Copiar a formula
                             # do drop do NPC (que renormaliza de verdade)
                             # daria 3,8% onde o sorteio da' 4,2%: a tela
                             # prometeria o que o servidor nao cumpre, e nada
                             # acusaria
node web/js/ydk.test.mjs     # 35 testes do formato .ydk e das gavetas de um
                             # DECK (o "ver as cartas" de um Deck Estrutural na
                             # Loja). Ler o .ydk errado nao da' erro nenhum:
                             # devolve um deck com cartas a menos, ou com o
                             # Extra misturado no main, e a tela mostra a lista
                             # incompleta com a maior naturalidade. Cobre
                             # tambem a ORDEM em que a raridade e' procurada, a
                             # mesma do servidor (`raridade_da_carta`, 0019):
                             # o BOOSTER vence, o mapa do proprio estrutural
                             # entra depois, o resto e' N — inverte-la faria a
                             # carta aparecer UR na Loja e ser vendida como N
                             # no Inventario, cada tela certa pela sua conta
node web/js/pendencias.test.mjs # 23 testes da fila do que ainda não subiu para a
                             # nuvem (uma pendência por chave, sempre a mais nova;
                             # sai quando o BANCO aceita — o disco não conta)
node web/js/notificacoes.test.mjs # 21 testes das notificações da home e do
                             # protocolo do Realtime. As duas metades erram
                             # CALADAS: a CHAVE de uma notificação precisa ser
                             # estável (senão o cartão aberto se fecha sozinho a
                             # cada 15s, na cara de quem lia o convite) e única
                             # (senão a mesma coisa aparece duas vezes e o
                             # contador mente); e um campo do Phoenix lido do
                             # lugar errado devolve `undefined`, o aviso não
                             # aparece e não há erro nem no console
npm run data:check           # integridade do banco de cartas (5 checagens)
npm run conteudo:check       # o que o admin editou chegou ao BANCO? (conteudo,
                             # decks de NPC e tabuleiros, disco x Supabase).
                             # Edicao que fica so' em disco nao existe pra ninguem
npm run boosters:check       # cruza os boosters PUBLICADOS com a lista ativa —
                             # acusa carta que o jogador compra e não pode jogar
npm run data:build           # regenera ygo-data/data a partir do cards.cdb (precisa de Python 3)

npm run duel:build           # para o servidor e compila o duel-server
npm run duel:test            # para, compila e roda --test-npc + --test-summons
npm run stop                 # encerra front e duel-server de forma limpa

node tools/bancada-visual.mjs # gera bancada.html na raiz: as animacoes da mesa
                             # (seta de ataque, numero de dano/cura, brilho de
                             # entrada em campo) rodando num quadro de mentira,
                             # sem servidor e sem login — dois cliques no
                             # arquivo. As funcoes sao FATIADAS do duel.html por
                             # marcadores, nunca copiadas: uma copia passaria a
                             # valer por si e deixaria de provar o que esta' no
                             # jogo. Existe porque mudanca VISUAL nao se prova em
                             # teste de logica — a seta foi publicada invisivel
                             # com 13 testes de geometria passando

node tools/gerar-icone.mjs   # redesenha assets/icone.ico + web/img/icone.png
                             # (o ícone é CÓDIGO, não um binário sem fonte)
npm run launcher:build       # gera classic-duels.exe / classic-duels-stop.exe (SDK .NET 8)
npm run pack                 # gera dist/ClassicDuels.exe (jogo inteiro num arquivo)
npm run atalho               # poe "Classic Duels" na area de trabalho apontando
                             # para dist/ClassicDuels.exe (precisa do pack antes)
                             # EXIGE um `npm run release:build` antes — o payload embutido
                             # é feito dos MESMOS game.zip/cards.zip do Release, senão a
                             # instalação nova oferece uma atualização do que ela já tem

npm run update:test          # 126 asserções do instalador/auto-updater (sem rede):
                             # --test-casca + --test-update + --test-offline
                             #   + --test-selfupdate + --test-update-duelo
                             # (--test-casca é a troca do MOTOR em disco: o pacote
                             #  que ficou em .staged/, a quarentena de um motor que
                             #  não sobe, e o motor anterior voltando)
npm run release:build        # DRY-RUN: gera dist/release/ (game.zip, cards.zip, manifest.json)
                             # o cards.zip (21 mil .lua) é CACHEADO em dist/.cache por
                             # impressão digital das entradas: ~4s quando o banco não
                             # mudou, ~18s quando mudou. Era ~5min todo build (deflate
                             # 'Optimal' + cópia dos 21 mil arquivos para um estágio)
npm run release:test         # instala esses artefatos numa raiz descartável e confere
npm run release:publish      # sobe o Release para o repo privado de distribuição
                             # -- -PodarReleases 5 apaga as tags antigas (opt-in)
                             # --test-remote (na mão) baixa o Release publicado e instala
npm run publicar:build       # gera publicar.exe na raiz (o publicador)
.\publicar.exe               # DOIS CLIQUES = publicar. Faz, nesta ordem: confere
                             # ambiente (dotnet, gh, permissao de ESCRITA no repo
                             # de distribuicao), confere se a casca mudou desde o
                             # ultimo `pack`, para o servidor, compila, roda as 5
                             # suites do instalador, gera dist/release/ em dry-run,
                             # mostra QUAIS marcadores mudaram e SOBE o Release.
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
não provaria nada),
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
`--test-armory` (Armory Call: qual equipamento vem do deck e em quem ele entra).
As sondas do protocolo binário são `--probe-idle`, `--probe-pos`, `--probe-battle`,
`--probe-chain`, `--probe-tribute`, `--brute-tribute`, e `--selfplay` despeja as
mensagens cruas do motor. `npm run duel:test` só roda `--test-npc` +
`--test-summons`; as outras suítes precisam ser chamadas na mão (ver
`package.json`).

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

**Drop por vitória** (`web/js/drops.js`): cada **deck** de NPC pode ter um
**pool** de cartas e uma **quantidade** por vitória — pool de 20, quantidade 3, e cada
vitória sorteia 3 dentro dos 20. Antes a vitória dava sempre a mesma carta de
assinatura, o que fazia a décima vitória entregar a décima cópia dela.

> **O pool é por DECK, não por adversário** (`decks[<nome do deck>]` dentro de
> `conteudo/npc-drops`). É o que dá sentido a destrancar o deck difícil: se o
> prêmio fosse o mesmo, escolher o caminho duro não teria motivo. O pool do
> **NPC inteiro** continua existindo debaixo dele como **reserva** — vale para
> todo deck que ainda não tem o seu, então quem montou um pool antes disto não
> perde nada e um deck recém-criado já nasce dropando. A resolução (deck
> primeiro, NPC depois) está em `dropsDoDeck` e é repetida no servidor
> (`premiar_vitoria`, migration 0033); as duas precisam concordar.

**Cada deck de um NPC pode destrancar OUTRO deck dele** (`web/js/decksnpc.js`).
No `.ydk`, dois metadados novos: `#dificuldade` (rótulo **livre** — quem edita
escreve "fácil", "iniciante", o que fizer sentido — e que **não** muda como o
adversário joga: quem decide se ele lê a sua mão continua sendo o `level` do
NPC) e `#libera <nome do outro deck>`. Um deck é porta de entrada quando
ninguém aponta para ele; os demais abrem quando um dos que apontam cai. Pelo
**nome**, nunca pelo índice — a mesma regra do deck ativo (0030) e da ordem da
trilha (0032). No painel da Trilha, o nome do deck virou um seletor **▾** com a
dificuldade de cada um e o cadeado de quem ainda não foi liberado. Qual deck
foi enfrentado viaja em `duel.html?npc=<id>&deck=<nome>` e é gravado em
`duelos.deck_npc` — sem isso o servidor não saberia de que pool sortear nem
qual deck a vitória destranca.

> Renomear um deck reaponta sozinho quem o liberava (`religarLibera`) e move o
> pool de drop para a chave nova. Sem isso a cadeia apontaria para um deck
> inexistente — e a regra é tolerante com isso de propósito, o que faria o deck
> difícil ficar destrancado **para sempre**, em silêncio.

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

O botão **[definir rápido]** enche os quadros de uma vez com as cartas **deste
deck** que já têm raridade, cada uma na gaveta dela — é o caso comum (o prêmio
que faz sentido é o do baralho que o jogador acabou de enfrentar) e montá-lo à
mão são 40 a 60 cliques. A regra mora em `planoRapido` (`drops.js`), sem DOM e
com teste, porque as três decisões dela erram **caladas**:

> **carta sem raridade fica de FORA.** Quem dá raridade são **duas** fontes, na
> mesma ordem do servidor (`raridade_da_carta`, migration 0019): o **booster**
> primeiro (`rarityIndex`) e o **Deck Estrutural** depois
> (`decks_estruturais.raridades`, juntados por `raridadesDosEstruturais` em
> `ydk.js` — a maior vence quando dois listam a mesma carta). Parar no booster
> deixaria de fora justamente a carta que só existe em estrutural, e hoje são
> **36** delas. Jogar a sem-raridade em N "para não perder" faria o oposto:
> despejaria o deck inteiro no pool — e um pool cheio parece certo.
> **Carta já no pool não é mexida**, nem para a gaveta do booster: ela pode ter
> sido posta à mão numa gaveta diferente de propósito, que é o que deixa um
> adversário largar uma Normal como prêmio raro. E **cópia repetida conta uma
> vez**: o sorteio é uniforme dentro da gaveta, então três cópias da mesma carta
> roubariam a chance das outras.

O toast diz o que entrou por gaveta **e o que ficou de fora** — a segunda metade
é a que ninguém confere carta por carta depois.

> **Sem conseguir ler os estruturais, o botão se recusa a rodar.** Eles vêm do
> banco (não têm espelho em `store/`), e `listarEstruturais` devolvia `[]` tanto
> para "não há nenhum" quanto para "a rede caiu" — tratar a segunda como a
> primeira faria o preenchimento sair pela metade, calado. Por isso existe
> `listarEstruturaisEx`, que diz se a leitura **alcançou** o banco: a mesma
> distinção do `alcancou` de `pullFileEx`. "Não sei" nunca vira "não tem".

A raridade (booster e estrutural, por `raridadeReal` no builder) virou
**sugestão**: o quadro
correspondente se destaca durante o arrasto, mas quem manda é onde a carta foi
solta — o servidor lê a gaveta gravada, sem reconsultar booster nenhum. É o que
deixa um adversário largar um Normal como prêmio raro sem mexer na Loja.

> **Pool com carta e quantidade ZERO é descartado** (`normalizarDrops`) — é o
> mesmo que não ter drop, e é o que faz o servidor cair na carta de assinatura.
> A regra está certa; o que faltava era a TELA dizer. O editor agora liga a
> quantidade em 1 ao entrar a primeira carta, e avisa quando você salva com o
> pool montado e o campo zerado — antes a configuração sumia calada e quem
> montou continuava achando que tinha salvado. Coberto por `drops.test.mjs`.

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

**"Ver as cartas" de um conteúdo da Loja** (`web/js/gavetas.js` +
`web/css/gavetas.css`). Todo booster e todo Deck Estrutural da vitrine tem um
botão que abre a MESMA caixa da lista de drops da Trilha de Duelos: as cartas
separadas por raridade, com a chance de cada gaveta e o ✔ nas que já estão na
Coleção, mais o "faltam N". A pergunta do jogador é a mesma nos dois lugares —
*o que vem aqui dentro, e o que disso ainda me falta?* —, então é literalmente
a mesma caixa; duas cópias divergiriam caladas, uma ganhando o selo de "você
tem" e a outra não. O botão nunca desliga por falta de DP: quem está sem saldo
é justamente quem precisa escolher onde gastar o próximo.

> **A chance de cada gaveta não é uma fórmula só.** O booster e o drop do NPC
> sorteiam DIFERENTE, e cada um tem de bater com o seu servidor: `chancesDe`
> (`drops.js`) renormaliza entre as gavetas que têm carta, como `premiar_vitoria`
> faz; `chancesDoPacote` (`pacote.js`) reproduz a CASCATA de `abrir_pacote()`,
> que não renormaliza — ele rola os pesos fixos e desce até achar gaveta com
> carta. Reaproveitar uma no lugar da outra mostra uma porcentagem que o
> sorteio não cumpre, e nada acusa. Por isso as duas contas são testadas em
> Node, e o `openPack` do front — que renormaliza e não é chamado por ninguém
> desde que a economia foi para o banco — está marcado como não sendo o sorteio
> do jogo.
>
> No Deck Estrutural não há chance nenhuma: vem tudo, e vem repetido (o `×3`
> no canto da miniatura). A lista sai do `.ydk` (`ydk.js`).

`web/js/customcards.js` importa cartas de um "card maker" externo (nome, tipo,
ATK/DEF, arte) para o Deck Builder. Isso só monta o **esqueleto** da carta —
o `ocgcore` roda Lua e o card maker não gera Lua, então toda carta importada
nasce com a tag `sem-efeito` e não pode ser usada num duelo de verdade. IDs
começam em `900000000` (acima de qualquer carta real) para nunca colidir com
o banco do `ygo-data`.

**`web/campo.html`** é o editor de campo (estilo *scene* do Unity): desenha
layouts de tabuleiro arrastando/redimensionando as zonas que o `ocgcore`
realmente entende (monstro, magia/armadilha, campo, deck, extra, cemitério,
**banidas** e mão — por jogador), com snapping de tamanho/espaçamento. Salva em
`boards/*.json` (mesmo padrão de `decks/`, ver `boards/README.md`). Qual
tabuleiro está *ativo* é preferência local (`localStorage: ygo:activeBoard`,
não conteúdo do jogo) — o `duel.html` lê essa chave no boot e, se apontar
para um tabuleiro salvo, sobrepõe posição/tamanho customizados no layout
flexbox de sempre; sem tabuleiro ativo, nada muda. O motor de arrastar/snap
mora em `web/js/campoeditor.js`; o schema das zonas e o gerador do layout
padrão, em `web/js/boards.js`.

> **Zona nova custa DOIS lugares**: `zoneIds()` (aparece no editor) e
> `defaultLayout()` (ganha posição). Esquecer o segundo não dá erro nenhum:
> todo `boards/*.json` já salvo foi gravado antes dela existir, e o backfill
> (`backfillMissingZones` no editor, `loadActiveBoard` no duelo) copia do
> layout padrão — sem a posição lá, a zona fica solta em fluxo numa fileira
> toda absoluta e aterrissa por cima do campo. `node web/js/boards.test.mjs`
> guarda esse par. A pilha de **banidas** (`p{n}:banido`,
> `LOCATION_REMOVED`) foi a última a entrar assim: sem ela, carta banida sumia
> da tela e não ia para lugar nenhum.

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

**`web/trilha.html` é a Trilha de Duelos** — a porta de entrada dos
adversários a partir da home, no lugar da grade de cards. A campanha (o campo
`campaign`, definido pelo admin) vira um CAMINHO: os adversários dela em
serpentina, ligados por traços, e **cada um libera o próximo ao ser vencido**.
Passar o mouse por um quadro liberado abre o painel da esquerda com o deck, a
arte, a recompensa e o botão da **lista de drops** (as gavetas com a % de cada
raridade — `chancesDe`, a MESMA conta do sorteio no servidor — e um ✔ nas
cartas que já estão na Coleção). O quadro trancado mostra só o cadeado: revelar
o deck e os drops de quem ainda não foi liberado entregaria a campanha de graça.

> **O progresso mora no BANCO** (`npcsVencidos`, que lê `duelos` filtrado pela
> RLS). Em `localStorage` ele sumiria ao trocar de máquina ou limpar o site — e
> liberaria a trilha inteira para quem abrisse o console.

A **ORDEM** de cada campanha é definida pelo admin em **`web/ordenar.html`**
(Área de Teste → "Ordenar Trilha"): arrasta-se a lista (ou ▲▼) e publica-se em
`conteudo/npc-trilha` (migration 0032), na forma `{ campanha: [id, id, …] }` —
**por id, nunca por índice**. Índice muda de significado quando um adversário
novo entra na campanha, e trocaria a trilha de todo mundo sem ninguém mexer em
nada (a mesma armadilha do deck ativo, migration 0030). Quem não estiver na
lista publicada aparece **no fim**, na ordem de criação: sumir da trilha por
falta de configuração seria pior que ficar fora de ordem.

> A regra mora em **`web/js/trilhaordem.js`**, sem DOM e sem `fetch`, porque os
> TRÊS a usam — a trilha, a tela de ordenação e o teste. Importar `trilha.js` de
> dentro da tela de ordenação executaria o boot da trilha na página errada.
> `node web/js/trilha.test.mjs` (16 checagens) cobre as duas metades: a
> liberação — inclusive a vitória fora de ordem, que abre o vencido e o seguinte
> e nunca a trilha toda — e a ordenação, inclusive o adversário novo que entra
> sem mexer nos outros.

A grade antiga (`web/adversario.html`) continua inteira, agora na **Área de
Teste**: sem trilha e sem cadeado, é o caminho curto para testar um duelo.
Ela é organizada só por campanha — sem lista "todos" solta — com uma seção "Sem
campanha" para quem ainda não tem uma definida. Em `duel.html`, o tabuleiro
do NPC (`advNpc.board`) manda mais que o `ygo:activeBoard` global, então cada
adversário duela sobre o próprio campo sem o jogador precisar ativar nada.

### A home é social (22/08/2026)

`web/index.html` deixou de ser só o menu: ganhou uma **coluna lateral** com o
seu perfil (nome, etiqueta, DP), a **lista de amigos** com quem está online, e o
botão de **notificações** no pé. O menu de sempre (Loja, Deck Builder,
Inventário, Trilha, Multiplayer) e os atalhos 1–5 continuam intactos à direita,
e o canto superior direito mostra **quantas pessoas estão jogando agora**.

**Presença** (`web/js/presenca.js` + migration 0034). O mecanismo é um
**batimento**: cada tela que conta como estar jogando — home, Multiplayer e
duelo — chama `bater_ponto()` a cada 45s; o banco carimba `perfis.visto_em` e
devolve, na MESMA resposta, quantos bateram dentro da janela.

> **Por que carimbo de tempo, e não um booleano `online`.** Um booleano ligado no
> login fica preso em `true` para sempre quando o navegador é fechado, a máquina
> cai ou a rede some — não existe evento de "saiu" em que se possa confiar. Um
> carimbo expira sozinho. E **quem decide o que é estar online é o banco**
> (`janela_online()`, hoje 2 minutos): se o cliente decidisse, duas máquinas com
> relógios diferentes discordariam sobre quem está online, cada uma certa pela
> sua conta.

O batimento é de 45s contra uma janela de 2 minutos de propósito: dá duas
batidas por janela, então uma pode se perder inteira sem ninguém piscar entre
online e offline.

> `visto_em` **não vaza**: a policy de `perfis` só deixa cada um ver o próprio
> registro, então a presença sai por dois caminhos estreitos — o booleano
> `online` que `meus_amigos()` (security definer) devolve **dos seus amigos**, e
> o número agregado de `bater_ponto()`. Conferido: uma conta comum autenticada
> enxerga 1 perfil, o dela.

**Notificações em tempo real** (`notificacoes.js` + `notificacoesvivo.js` +
`realtime.js`). Desafio para duelar e pedido de amizade viram uma lista só; o
botão da lateral mostra a contagem e pisca, e clicar abre o cartão que diz o que
é e oferece aceitar/recusar — aceitar um duelo leva à partida, aceitar uma
amizade põe a pessoa na lista ao lado.

Chegam por **dois caminhos**, e isso não é redundância desperdiçada:

- o **Realtime** do Supabase, que traz em menos de um segundo;
- uma **consulta de reserva** a cada 15s, que garante a entrega com o socket
  caído, o token vencido ou o serviço fora do ar. *Um push que falha calado é
  pior que nenhum push.*

O cliente de Realtime é escrito à mão sobre o `WebSocket` do navegador
(`web/js/realtime.js`): o `@supabase/realtime-js` é um pacote npm e este front
tem **zero dependências**. O protocolo é o do Phoenix — `phx_join` num tópico
`realtime:*` declarando as tabelas, `heartbeat` a cada 30s, e as linhas chegando
como `postgres_changes`. Três armadilhas, todas silenciosas:

> **O RLS vale no Realtime.** O `access_token` vai no join e o servidor só
> entrega o que aquele usuário poderia ler por `select` — é por isso que a
> policy de `partidas` precisou enxergar o `convidado` (0012). Sem a policy, a
> linha não chega e nada acusa.
> **O token expira** (~1h) e o canal não renova sozinho: o socket segue aberto,
> aparentemente saudável, e para de entregar. Por isso o `access_token` é
> reenviado a cada batida de heartbeat.
> **O canal só está de pé depois do `phx_reply`.** Anunciar "ligado" no `onopen`
> desligaria a reserva cedo demais, e um join recusado passaria por conexão boa.

O evento é usado só como *"algo mudou, olhe de novo"* — quem monta a lista é o
banco, com a RLS e o prazo (`meus_desafios` só devolve os últimos 10 minutos).
Reconstruir isso da linha crua faria a tela mostrar um desafio já expirado.

> **`amizades` entrou na publicação do Realtime** (0034) e ganhou `replica
> identity full`. Sem o `full`, o UPDATE chega sem a linha ANTIGA — "o pedido
> foi aceito" sem dizer de quem era.

**Desafiar da home leva ao Multiplayer.** Não é preguiça: quem desafia precisa
entrar no duelo no instante em que o outro aceita, e essa espera já existe lá
(`pintarPartida` + `aguardavaSala`). Ficando na home, o convite seria aceito do
outro lado e o desafiante continuaria parado olhando o menu.

O **amigo offline não é clicável** — o convite expira em 10 minutos e chamar
quem está com o jogo fechado é gastá-lo à toa —, mas continua **visível**:
sumir com ele faria a lista dançar sozinha e esconderia quem você tem.

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

- **Publicar é `fire-and-forget`, e o que não sobe fica numa FILA.** As telas
  gravam a cada tecla e não podem esperar a rede, então `pushFile` não devolve
  nada. Um 403 de quem não é admin, uma sessão vencida ou a rede caída gravavam
  o disco, a tela dizia "salvo" e a edição **não existia para mais ninguém** — o
  pior desfecho para conteúdo compartilhado, porque quem editou continua vendo o
  certo. Hoje o `projectstore.js` avisa sozinho em qualquer página **e guarda a
  edição** (`pendencias.js`, no `localStorage`), reenviando no boot de qualquer
  página, quando a conexão volta e a cada 20s enquanto sobrar pendência. O aviso
  some sozinho quando a fila esvazia, e `npm run conteudo:check` continua
  respondendo depois a pergunta "está tudo publicado?".
- **A trava `leu*Disco` não descarta mais a edição.** Seis chaves (`banlist`,
  `boosters`, `cardlists`, `npcs`, `npc-base-meta`, `npc-deck-ativo`) só
  publicam depois de terem LIDO a fonte — sem isso, uma máquina offline
  sobrescreveria o banco com um estado que ela mesma inventou por padrão. A
  trava está certa; errado era o que ela fazia com a edição do admin:
  **descartava**, e em quatro das seis sem nem um `console.warn`. Hoje é
  `pushFileGuardado(chave, dados, fonteLida)`, que enfileira em vez de jogar
  fora.
- **Deck de NPC salvo ≠ deck de NPC publicado.** `saveProjectDeck` devolve
  `publicado`/`erroRemoto`, e `saveNpcDeckAt` os descartava: com a sessão
  vencida o `.ydk` gravava no disco, a tela dizia "salvo em decks/…" e o
  adversário não chegava em ninguém — foi assim que o deck do Pegasus precisou
  ser inserido no banco na mão. Hoje o builder diz as duas coisas, separadas.
- **O que é CONTEÚDO do jogo não pode morar no `localStorage`.** A lista de
  decks de cada NPC sempre veio do banco (`decks_npc`, leitura aberta), mas
  **qual deles estava ativo** era preferência do navegador — e o sintoma
  demorou a aparecer porque, na máquina de quem escolheu, estava tudo certo.
  Dois jogadores com o MESMO jogo, lendo a MESMA lista, viam adversários
  diferentes: quem nunca escolheu caía no primeiro da ordem alfabética. Hoje vai
  para `conteudo/npc-deck-ativo` (migration 0030), e o `localStorage` é cache e
  fallback offline. A escolha é resolvida pelo **nome** do deck, não pelo
  índice: a lista é ordenada por nome, então um deck novo entrando antes trocaria
  o adversário de todo mundo sem ninguém mexer em nada
  (`node web/js/npcativo.test.mjs`).
- **`decks/npc/*.ydk` e o pool de drop NÃO viajam no Release.** O manifesto leva
  `web/`, `ygo-data/`, `boards/` e quatro `store/*.json`; `store/` e `decks/`
  são intocáveis por código (`UpdateEngine.Intocaveis`), com uma allowlist
  fechada (`GlobaisPermitidos`) para o punhado de arquivos que são conteúdo. O
  deck de NPC no disco é só a SEMENTE que veio dentro do exe — quem manda é o
  banco, e é de lá que o jogo lê. Não "conserte" isso publicando `.ydk` no
  Release: o caminho é o Supabase.

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
  markers em Link, `atk == -2` significa "?", `alias != 0` quer dizer que o
  **nome** é tratado como o de outra carta — e isso é arte alternativa só quando
  o nome BATE; com nome diferente é carta distinta, com efeito e Lua próprios,
  então use `isAlternateArt`/`alt` e nunca `alias != 0` na mão) estão em `ygo-data/README.md` — leia antes de tocar em decodificação.
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
