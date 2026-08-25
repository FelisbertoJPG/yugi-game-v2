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
node web/js/drops.test.mjs   # 59 testes do drop por DECK (pool por raridade, a % de cada
                             # uma, o descarte de quem tem carta mas quantidade zero, a
                             # reserva por NPC de quem ainda não tem pool próprio, e o
                             # [definir rápido] — que só leva carta COM raridade e nunca
                             # remexe a que já está num quadro). As três últimas são de
                             # MARKUP, não de lógica: o quadro do ÍCONE é escrito à mão
                             # no `deck.html` e o CSS tem
                             # `.quadro:not(.aberto) .quadro-corpo { display:none }` —
                             # sem a classe `aberto` ali, ele nunca a recebe de ninguém
                             # (o cabeçalho dele não abre nada), e a escolha de ícones
                             # era desenhada dentro de um container invisível. O
                             # `renderIcones` rodava certo, o DOM enchia, e a tela
                             # mostrava só o cabeçalho — sem um erro no console
node web/js/revelacao.test.mjs  # 9 testes da REVELAÇÃO carta a carta (o drop virado
                             # do fim de duelo, hoje também a abertura de pacote
                             # na Loja). O visual não se prova aqui — é
                             # `tools/bancada-revelacao.mjs` que o põe na tela.
                             # O que se testa é o pouco que TRAVA o jogo: o
                             # `aoTerminar` disparando na ÚLTIMA carta e uma vez
                             # só (é ele que religa os botões de saída do duelo
                             # e o [abrir outro] da Loja — nunca disparar deixa
                             # o jogador preso numa tela de botões desligados,
                             # sem erro nenhum), a carta que abre uma vez (ela
                             # continua clicável de propósito: `disabled` a
                             # apagaria pelo `button:disabled` de `ui.css` e
                             # mataria o "segurar para ampliar"), e a varredura
                             # de que toda página que importa o módulo linka o
                             # CSS dele — sem a folha nada gira e a grade
                             # desmonta, calada
node web/js/cardlists.test.mjs  # 15 testes das listas de cartas (pool permitido + resolução)
node web/js/estrutural.test.mjs # 10 testes do rascunho do Deck Estrutural: ele salva
                             # o trabalho, mas NUNCA é carregado de volta — ao abrir a
                             # tela vai para store/bkp/ e sai do navegador
node web/js/trilha.test.mjs  # 19 testes da Trilha de Duelos: a liberação (cada vitória
                             # abre o próximo), a ordem publicada por campanha e o
                             # CHAMADOR — trilha.js passando os vencidos a liberados()
node web/js/serpentina.test.mjs # 13 testes da SERPENTINA da Trilha de Duelos: quantos
                             # quadros cabem numa linha, medido, em vez dos
                             # QUATRO que estavam escritos a mao. O desenho
                             # antigo nao media nada — o comentario do CSS dizia
                             # isso com todas as letras ("o layout e' o
                             # desenho") — e a linha invertida e' `row-reverse`:
                             # sem largura propria, ela encosta os quadros na
                             # borda direita da TELA. Numa janela larga a linha
                             # de cima ficava a' esquerda, a de baixo do outro
                             # lado do monitor, e o conector vertical descia
                             # para o vazio.
                             # A conta erra CALADA nos dois sentidos: para mais
                             # (esquecer que sao n-1 vaos) a linha transborda e
                             # a serpentina sai do lugar; para menos sobra um
                             # buraco que ninguem identifica como defeito. E
                             # nunca pode dar ZERO — o laco que fatia a lista
                             # avanca de `cols` em `cols`, entao zero e' a tela
                             # congelada a 100% de CPU.
                             # Guarda tambem o `scrollbar-gutter: stable` do
                             # palco: sem ele a barra de rolagem tira ~15px,
                             # cai um quadro por linha, a trilha fica mais
                             # alta, a barra continua — e o desenho oscila
                             # entre dois estados para sempre.
                             # Guarda ainda o que o conserto QUEBROU na
                             # primeira tentativa: mexer no layout DENTRO da
                             # entrega do ResizeObserver deixa notificacao
                             # pendente no fim do quadro, o navegador dispara
                             # "ResizeObserver loop completed with undelivered
                             # notifications" — que chega como ErrorEvent na
                             # window — e o `bootguard` cobria o jogo com a
                             # faixa "esta tela nao terminou de abrir", num
                             # jogo que tinha aberto inteiro. Hoje o redesenho
                             # sai para o quadro seguinte
                             # (`requestAnimationFrame`) e o observador so'
                             # comeca DEPOIS do carregamento — registrado antes,
                             # a primeira entrega dele (que e' automatica) pega
                             # `campanhas` vazia e escreve "esta campanha ainda
                             # nao tem adversario" na tela.
                             # O que ele NAO prova e' a aparencia: para isso e'
                             # `tools/bancada-trilha.mjs`
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
node web/js/recorte.test.mjs # 23 testes do ENQUADRAMENTO do recorte circular
                             # (subir uma foto e ajustar no círculo, estilo
                             # rede social). A conta inteira erra CALADA: um
                             # limite frouxo deixa a imagem descolar e o ícone
                             # sai com faixa vazia na borda; a área de origem
                             # calculada sem desfazer a escala parece certa em
                             # zoom 1 e escorrega em qualquer outro; e o zoom
                             # sem ponto fixo faz a foto fugir do centro a cada
                             # rolada da roda. Nada disso dá erro — o admin
                             # recorta, salva, publica, e o ícone só fica torto
node web/js/icones.test.mjs  # 15 testes dos ÍCONES de perfil. A posse e a
                             # escolha são decididas no SERVIDOR, então o que
                             # se prova aqui é o que erra CALADO no cliente: a
                             # arte vem do banco como data URL, e um valor
                             # torto (vazio, texto, `data:text/html`) vira um
                             # `src` que o navegador busca, não acha e desenha
                             # como quadrado vazio
node web/js/selobanlist.test.mjs # 26 testes do SELO da banlist ([L1]/[L2]/BAN) e da
                             # LISTA permitida. O selo e a validacao dependiam
                             # do checkbox "Lista 1" do Deck Builder — que e' um
                             # FILTRO DO POOL e nasce DESMARCADO. Com ele
                             # desligado o builder dizia "deck valido" para tres
                             # copias de uma Limitada, deixava salvar, e o banco
                             # recusava: o deck ficava so' naquele navegador. A
                             # banlist nunca esteve desligada — quem a cobra e'
                             # `salvar_deck` pela lista ativa (0020), marcado ou
                             # nao; o checkbox so' escondia a regra de quem
                             # precisava dela. Hoje as duas valem sempre, e o
                             # selo aparece tambem na LOJA (a carta revelada e o
                             # "ver as cartas"): saber que a carta e' Limitada
                             # importa ANTES de gastar DP atras da terceira
                             # copia.
                             # Cobre ainda a carta BANIDA, que era uma
                             # divergencia CALADA entre as duas pontas: o
                             # servidor sempre a cobrou (o teto sai de
                             # `least(3, coalesce(cardLimits[id], 3))`, que da'
                             # 0 e recusa), e o cliente nao sabia express -la
                             # (`addRule` exigia valor > 0) nem confer -la
                             # (`validateBanlist` fazia `lim > 0 && n > lim`,
                             # entao o teto 0 passava batido). O selo dela e'
                             # BAN com fundo cheio, e nao um "L0" — banida nao
                             # e' o degrau seguinte de L1/L2, e' a unica que
                             # proibe a carta inteira
node web/js/poolordem.test.mjs # 15 testes da ORDENAÇÃO do pool de cartas — uma
                             # regra, CINCO telas (Deck Builder, Booster
                             # Builder, Banlist, Listas e Deck Estrutural). Ela
                             # estava escrita quatro vezes (duas em módulos,
                             # duas soltas dentro do HTML) e DUAS já haviam
                             # divergido em silêncio: as do Booster Builder e do
                             # Deck Estrutural não entendiam o sufixo `-asc`,
                             # então aquelas telas ofereciam metade das ordens.
                             # Erro de ordenação não dá erro — a lista aparece,
                             # só que na ordem errada, e quem olha vê uma lista
                             # plausível.
                             # A ordem por RARIDADE (UR→SR→R→N, e o inverso) é o
                             # motivo de o módulo ter nascido: montar deck e
                             # escolher o que entra na Lista 1 ou ganha regra na
                             # Banlist é leitura por raridade. Ela não custa
                             # consulta nova — `annotateDb` já escreve `rarity`
                             # na entrada do índice; só o Deck Builder passa a
                             # própria função, porque é o único que conhece
                             # também a raridade dos Decks Estruturais (as 36
                             # cartas que nunca entraram em booster).
                             # "Sem raridade" fica no fim nas DUAS direções: não
                             # é um degrau da escala, é a ausência dela — só
                             # invertê-la abriria "N→UR" com centenas de cartas
                             # fora de booster na frente. Duas varreduras
                             # guardam o resto: toda tela com `#f-sort` oferece
                             # a raridade, e nenhuma voltou a ter cópia própria
                             # da regra
node web/js/sessao.test.mjs   # 16 testes de ONDE a sessão do jogador é guardada
                             # (a caixa "manter login nesta máquina"). Marcada,
                             # a sessão vai para o `localStorage` e sobrevive a
                             # fechar o jogo; desmarcada — o padrão —, vai para
                             # o `sessionStorage` e morre com a janela. A regra
                             # erra CALADA e sempre a favor de quem não devia
                             # entrar: ler os dois armazenamentos "para não
                             # perder a sessão" faz uma sessão esquecida no
                             # `localStorage` manter a pessoa entrada para
                             # sempre — e "continuou logado" é indistinguível de
                             # "funcionou". Cobre também o `sair()`, que precisa
                             # limpar os DOIS (limpar um só é um sair que não
                             # sai, num PC compartilhado)
node web/js/esconder.test.mjs # varre TODA página de web/ **e todo módulo de
                             # web/js/** perguntando uma coisa
                             # só: o atributo `hidden` realmente esconde? Ele
                             # não é mágica — é um `[hidden] { display:none }`
                             # na folha do NAVEGADOR, a especificidade mais
                             # baixa que existe, e qualquer `#foo { display: }`
                             # nosso ganha dela. O JS marca o atributo, o DOM
                             # fica certo, `el.hidden` é `true`, e o elemento
                             # continua na tela: sem erro, sem console, e quem
                             # olhou só viu o caso em que ele DEVE aparecer.
                             # Foi assim que "ÍCONE NOVO — escolha-o no seu
                             # perfil" ficou aparecendo em TODO fim de duelo,
                             # com a arte vazia, inclusive para quem perdeu.
                             # Prova também que a varredura reconhece o caso
                             # ruim — senão "nenhum culpado" não provaria nada.
                             #
                             # A varredura tinha DOIS furos, e cada um escondia
                             # bugs vivos (7 no total, achados de uma vez):
                             # ela olhava só regras por `#id`, e só o `<script>`
                             # INLINE da página. Mas o `display` costuma vir de
                             # uma CLASSE (`<div class="acoes" id="linha-voltar"
                             # hidden>` — era por isso que "voltar para a versão
                             # anterior" aparecia em toda atualização, mesmo sem
                             # backup), e o `.hidden =` costuma morar num MÓDULO
                             # (`mostrarAba` em `builder.js` escondia
                             # `#aba-deck`/`#aba-drops`, que ganham `display`
                             # de `.aba` — trocar de aba não escondia nada, as
                             # duas ficavam empilhadas, e o editor do pool de
                             # drop aparecia até no Deck Builder do jogador
                             # comum). Hoje ela segue os dois caminhos, e cada
                             # um tem asserção própria provando que ela os vê
npm run icones:check         # todo ícone do catálogo tem arte? A imagem mora na
                             # coluna `imagem` (0039) e a coluna é nullable de
                             # propósito, então o banco aceita a linha sem ela —
                             # e quem joga vê o círculo genérico no lugar do
                             # desenho, sem erro em lugar nenhum
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

node tools/bancada-revelacao.mjs # gera bancada-revelacao.html na raiz: as cartas
                             # viradas (a virada, a aproximacao da revelada e a
                             # grade de sete colunas) com 50 cartas de mentira,
                             # sem servidor e sem login. O modulo e o CSS sao
                             # LIDOS do jogo, nunca copiados. Existe porque olhar
                             # isso no jogo custava um duelo vencido ou 1000 DP
                             # num [abrir 10]

node tools/bancada-trilha.mjs # gera bancada-trilha.html na raiz: a SERPENTINA da
                             # Trilha de Duelos com treze adversarios de
                             # mentira, sem servidor e sem login — dois cliques
                             # no arquivo, e ARRASTE a borda da janela. O CSS e'
                             # FATIADO do web/trilha.html e a conta vem do mesmo
                             # web/js/serpentina.js, nunca copiados. Treze
                             # adversarios de proposito: e' com a ULTIMA linha
                             # INCOMPLETA que a serpentina erra, porque e' ela
                             # que a linha invertida tem de encostar na direita
                             # da LINHA e nao na do ultimo quadro dela.
                             # Uma regua no canto diz a largura medida, quantos
                             # cabem e quantas linhas sairam

node tools/bancada-home.mjs  # gera bancada-home.html na raiz: a HOME com a
                             # lateral social desenhada com dados de mentira,
                             # sem servidor e sem login — dois cliques no
                             # arquivo. O CSS e o markup sao FATIADOS do
                             # web/index.html por marcadores, nunca copiados
                             # (uma copia passaria a valer por si e daria para
                             # consertar a bancada publicando a home quebrada).
                             # Existe porque a lateral saiu publicada uma vez
                             # FLUTUANDO no meio da tela, com os 21 testes de
                             # notificacao passando: nenhum deles olha para
                             # onde a caixa aterrissa

node tools/gerar-icone.mjs   # redesenha assets/icone.ico + web/img/icone.png
                             # (o ícone é CÓDIGO, não um binário sem fonte)
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
`--test-caos` (o pacote **CAOS** do Yugi — 21 asserções. O relato: *"ele preferiu
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
> espera. Com a mesma folga de zona da regra da armadilha, e pelo mesmo motivo.),
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
a MÃO — ter uma reanimação para o corpo enterrado. **Shifting Shadows**: não muda
um ponto de ATK, apaga o que o outro lado já sabia sobre qual carta está em qual
zona; num deck de cartas setadas é disso que o duelo vive. Ela tem duas jogadas
separadas pela LOCALIZAÇÃO da oferta — da mão é pô-la em campo, do campo é o
efeito que custa 300 LP —, e o par controle é o piso de LP: perder o duelo para
esconder de qual zona é o muro seria o pior negócio possível),
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
exatamente o evento errado que chegava antes).
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

> **`dropsDoDeck` devolve a configuração INTEIRA, e não uma cópia de dois
> campos.** Ela remontava `{ quantidade, pool }` à mão, e o ÍCONE ficava para
> trás — sem erro, porque o objeto continuava parecendo certo. O estrago não
> parava em "não mostrou": a aba DROPS carrega dali, então o ícone voltava sempre
> como *nenhum selecionado* e o **salvamento seguinte apagava do banco** o que
> estava gravado. Do lado de quem edita: *"tive que salvar 2x; voltei ao deck e o
> ícone não estava selecionado com a taxa dele"*. O servidor (`premiar_vitoria`)
> sempre leu certo — o buraco era só a volta. Uma lista de campos escrita à mão
> envelhece toda vez que a configuração ganha um.
>
> O teste que devia ter pego existia e tinha o nome certo (*"o ícone também vale
> por deck"*), mas a asserção era `assert.ok(d)`: conferia só que a função
> devolveu **alguma coisa**. Hoje ele confere o ciclo completo — o que o editor
> grava tem de voltar igual —, com par controle de que quem não configurou ícone
> não ganha os campos do nada.

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

A aba DROPS configura também o **ícone de perfil** que o deck pode largar —
uma lista e uma chance em %, ao lado do pool. Ver "Ícone como prêmio de
vitória", mais abaixo: ele fica FORA das gavetas de raridade de propósito, e
um deck que só dá ícone (sem carta nenhuma) é configuração legítima.

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

**A revelação carta a carta** (`web/js/revelacao.js` + `web/css/revelacao.css`).
As cartas chegam VIRADAS e são abertas uma a uma, com um **[revelar rápido]**
para quem não quer a cerimônia; a revelada **se aproxima da tela e volta**, num
movimento só, e traz a moldura da raridade e o selo **NEW!!** de quem entrou na
Coleção agora. Nasceu no drop do NPC (fim de duelo) e hoje é literalmente a
mesma nas **duas** telas — a da Loja despejava as cartas já abertas, sem virada
e sem dizer o que era inédito, e o mesmo prêmio parecia valer menos vindo do
pacote. Pelo mesmo motivo de `gavetas.js`: duas cópias de uma cerimônia divergem
sem ninguém perceber.

> **A caixa da Loja não passa da altura da janela.** Um [abrir 10] traz 50
> cartas; a rolagem é da LISTA e nunca da página, senão o título sai por cima e
> os botões de [abrir outro]/[fechar] ficam abaixo do fim da tela,
> inalcançáveis. E a grade quebra em **sete** por linha: numa fileira que só
> quebra quando não cabe mais, as cinquenta encolhem até virar selo. O
> `--rev-cols` se fecha no número de cartas quando são menos que isso (três
> cartas de drop numa fileira de sete ficavam encostadas à esquerda).

> **[organizar por raridade]**, ao lado do [revelar rápido]: agrupa UR→N e
> volta. Ele **revela o que ainda estiver virado** — agrupar cartas viradas
> diria onde estão as boas antes de alguém as virar, e a cerimônia morreria sem
> aviso nenhum. É vai-e-volta porque a ordem do sorteio é a única que mostra em
> qual dos dez pacotes cada carta veio. Carta sem raridade fica no FIM (a mesma
> regra de `poolordem.js`: ausência não é degrau da escala — e o `indexOf` cru
> devolve −1, que a jogaria na frente da UR, calado).

> **O "NEW!!" tem de ser lido ANTES da compra.** `abrirPacote` grava a carteira
> de volta no cache, e depois dela toda carta do lote "já está na Coleção" — a
> pergunta deixa de ter resposta. É a mesma razão pela qual o drop do NPC
> responde isso no SERVIDOR, antes de creditar (migration 0029). Na Loja quem
> responde é o cliente, com a coleção de antes da chamada, e o campo `nova` do
> servidor vence esse palpite no dia em que `abrir_pacote()` passar a mandá-lo.
> Cópia repetida DENTRO do mesmo lote conta uma vez: a segunda cópia da mesma
> carta nos dez pacotes não é nova.

> **[abrir outro] fica desligado enquanto sobrar carta virada** — ele redesenha
> a caixa por cima, e um clique apressado apagaria o pacote antes de alguém ter
> visto o que veio nele. O **[fechar] não**: com 50 cartas isso prenderia o
> jogador até o quinquagésimo clique, e o [revelar rápido] está bem ali. (No fim
> de duelo os DOIS ficam desligados, porque lá a saída é o "novo duelo".)

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

> **O cartão do perfil errava para o ADMIN.** `meuPerfil()` fazia
> `perfis?select=…&limit=1`, e a policy de `perfis` é `id = auth.uid() OR
> eh_admin()`: para uma conta comum aquilo devolve uma linha só, mas para um
> admin devolve a tabela inteira — e o `limit=1` pegava o perfil de OUTRA
> PESSOA. O admin via o nome e a etiqueta de outro jogador no próprio cartão,
> com o DP e a lista de amigos certos ao lado, e nada acusava (a consulta
> respondia 200 com um perfil legítimo). Pior no Multiplayer, onde é essa
> etiqueta que ele copia e manda para alguém adicionar. Hoje filtra pelo
> próprio id, como `perfilAtual` e o `auth.js` sempre fizeram.

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

**A lista de amigos ganhou as duas pontas que faltavam** (23/08/2026): clicar num
amigo abre um cartão com **desafiar** e **remover amigo**, e uma **busca** entre o
cabeçalho e a lista adiciona alguém por nome ou etiqueta (`buscar_jogador` +
`pedir_amizade`, os dois já existiam — o único caminho era ir ao Multiplayer).

> **O amigo OFFLINE voltou a ser clicável.** Ele estava desabilitado por um bom
> motivo (desafiar quem está com o jogo fechado gasta um convite que expira em 10
> minutos), e esse motivo continua valendo — quem decide é o cartão, que só
> oferece "chamar" a quem está online. O que a trava fazia junto, sem querer, era
> **impedir remover um amigo offline**: o clique é a única porta para isso, e ela
> estava fechada justamente para a maior parte da lista na maior parte do tempo.

> A busca **cruza o resultado com a sua lista** antes de oferecer "adicionar":
> `buscar_jogador` responde o que a policy de `perfis` permitiria a qualquer um e
> não sabe quem já é seu amigo. Sem o cruzamento, o botão prometeria adicionar
> quem já está lá e o servidor devolveria um erro que ninguém pediu. E cada
> digitada carrega um selo de ordem — as consultas voltam fora de ordem, e uma
> resposta velha chegando depois pintaria o resultado de um termo que ninguém
> está mais buscando.

**Desafiar da home leva ao Multiplayer.** Não é preguiça: quem desafia precisa
entrar no duelo no instante em que o outro aceita, e essa espera já existe lá
(`pintarPartida` + `aguardavaSala`). Ficando na home, o convite seria aceito do
outro lado e o desafiante continuaria parado olhando o menu.

O **amigo offline não é clicável** — o convite expira em 10 minutos e chamar
quem está com o jogo fechado é gastá-lo à toa —, mas continua **visível**:
sumir com ele faria a lista dançar sozinha e esconderia quem você tem.

### Chat: o global e a conversa com um amigo (23/08/2026)

Uma **doca** no rodapé da home com janelinhas lado a lado: o **chat global**
(botão de globo na lateral) e uma conversa por amigo (`[abrir chat]` no cartão
dele). Várias abertas ao mesmo tempo; ao minimizar uma, as outras se grudam na
lateral — a doca é um `flex` e as minimizadas são reinseridas primeiro no DOM,
em vez de posição absoluta com conta de largura refeita a cada abrir/fechar.

**Uma tabela para os dois** (`mensagens`, migration 0040), e a diferença é uma
coluna: `para` nulo = global. Duas tabelas exigiriam duas policies, dois RPCs de
envio e dois caminhos de Realtime para a mesma coisa.

> **Quem pode falar com quem é decidido no BANCO.** A conversa privada só existe
> entre amigos (`amizades` aceita), e a tabela **não tem policy de INSERT** — um
> `POST /mensagens` direto é recusado, e todo envio passa pelo `enviar_mensagem`
> (`security definer`), que é onde a regra de amizade e o limite de ritmo vivem.
> Se a trava morasse na tela, bastaria abrir o console.

> **O nome de quem falou vem do RPC**, e não de uma consulta da tela: a policy de
> `perfis` só deixa cada um ver o próprio registro, então sem a junção do
> `chat_global`/`chat_com` (que rodam como `definer`) o chat mostraria uuids.

> **`mensagens` viaja no MESMO canal de Realtime das notificações.** O Phoenix
> cobra um join por canal e um heartbeat por socket; abrir um segundo socket para
> o mesmo usuário dobraria os dois sem ganhar nada. O aviso é separado no
> despacho — mensagem vai para o chat, o resto para a lista de notificações; sem
> isso, cada linha de conversa faria o sino piscar.

> **`juntar` existe porque a entrega tem dois caminhos** (Realtime + releitura de
> reserva), e isso é ótimo para a entrega e péssimo para a lista: a mesma
> mensagem chega duas vezes e as releituras se cruzam. Sem ele a conversa mostra
> tudo em dobro e embaralhado — e nada disso dá erro.
> `node web/js/chat.test.mjs`.

> **Texto de outra pessoa entra por `textContent`, nunca `innerHTML`.** É a
> ÚNICA entrada do jogo em que alguém digita algo que aparece na tela de
> terceiros; montar a linha com `innerHTML` seria pôr um `<script>` de um jogador
> na home de todos os outros.

### Ícones de perfil (22/08/2026)

O avatar do jogador. Clicar no slot da lateral abre a escolha **entre os que
você tem**; o admin cadastra o catálogo em `web/icones.html` (Área de Teste).

Três coisas separadas no banco (migration 0035), e a separação é o ponto:

| onde | o quê |
|---|---|
| `icones` | o **catálogo** — que ícones existem, quanto custam, qual é gratuito |
| `icones_do_jogador` | a **posse** — quem tem cada um |
| `perfis.icone_id` | a **escolha** — qual está em uso agora |

> Juntar posse e escolha num campo só perderia a coleção no instante em que a
> pessoa trocasse de ícone, e não haveria como oferecer "os que você tem".

**A imagem mora no BANCO**, na coluna `imagem` de cada ícone: uma `data:` URL de
um PNG 128×128 (~1 a 40 KB). Ela chega junto com a linha, então funciona no
`.exe`, no `npm run dev` e para todo jogador — **sem publicar Release**.

> **A versão anterior (0035) guardava só o nome de um arquivo** em
> `web/img/icones/`, que viajava no `game.zip`. A ideia tinha lógica — arte é
> conteúdo do repositório, como os tabuleiros — e um custo que só apareceu no
> uso: a rota que grava o PNG só existe no `tools/serve.mjs`, porque o jogo
> instalado serve `%LOCALAPPDATA%`, que nenhum Release lê. Para quem roda o
> `.exe`, que é como o jogo é usado, subir um ícone virava "mova o arquivo à mão
> e publique um Release" — **por ícone**. Na prática, cadastrar era impossível,
> e foi assim que a feature saiu publicada sem funcionar.
>
> `arquivo` **saiu** junto (0039). Com a imagem no banco ele seria uma segunda
> fonte para a mesma coisa — o erro que este projeto já pagou (`chancesDe` ×
> `chancesDoPacote`) —, e as duas se desencontrariam no primeiro ícone
> cadastrado por um caminho só.

Duas travas na coluna, porque as duas erram calado: um **teto de 256 KB** (um
engano — a foto de 12 MB sem recortar — viajaria para todo jogador que abrisse a
lista, para sempre) e o formato, que precisa ser `data:image/...`. Sem o
segundo, um `data:text/html` entraria e o navegador simplesmente não desenharia
nada. `npm run icones:check` continua existindo, agora perguntando só *"algum
ícone está sem arte?"* — a coluna é nullable de propósito.

**O painel é um formulário só.** Escolher a imagem, enquadrar no círculo, dar
nome e salvar: a arte vai no MESMO `upsert` que o preço e a raridade. Separá-la
em duas chamadas deixaria a linha existir sem arte no intervalo entre elas — e
para sempre, se a segunda falhasse.

> Ao editar, a arte só é reenviada quando há **foto nova**. Mandar a imagem a
> cada salvamento reenviaria 40 KB para trocar um preço, e mandar `null` (o que
> um canvas vazio produz) **apagaria** a arte de um ícone que já está no perfil
> de gente.

**[usar no meu perfil agora]** põe o ícone aberto no perfil do próprio admin.
São **duas** chamadas e não uma: `escolher_icone()` recusa o que não é seu, e um
ícone recém-cadastrado não é de ninguém — nem de quem o criou. Sem o
`dar_icone()` antes, o botão devolveria *"você não tem este ícone"* no exato
momento em que a pessoa quer conferir o próprio trabalho. Depois de salvar, o
formulário **continua editando** o que acabou de ser criado, em vez de limpar:
era o `limpar()` que escondia esse botão justamente na hora de usá-lo.

**Quem decide o que você pode usar é o servidor**, e por dois caminhos, não um:

> `escolher_icone()` recusa o que não é seu. Mas a policy de `perfis` é
> `id = auth.uid() OR eh_admin()`, isto é, **o dono escreve na própria linha** —
> um `PATCH /perfis?id=eq.<meu>` passaria por cima da função inteira. Ao provar
> as travas da 0035 isso só não passou porque o ícone escolhido não existia no
> catálogo (a chave estrangeira barrou); com um ícone real, teria passado. A
> 0036 fecha com o gatilho `perfis_icone_valido`, cuja regra é do **dono da
> linha** e não de quem escreve: "este perfil só pode usar um ícone que ESTE
> perfil tem". Assim vale igual para o jogador, para o admin editando outra
> pessoa e para qualquer função futura.

A lista de amigos recebe o `icone_id` de cada um (`meus_amigos`), nunca a arte —
a policy de `perfis` não deixaria. A home busca as artes de quem aparece na tela
(`artesDe`: a minha e a dos amigos), e não o catálogo inteiro: trazer 40 KB por
ícone a cada abertura para desenhar meia dúzia seria pagar a coleção toda.

**Subir uma arte pelo painel.** O admin escolhe um arquivo, **arrasta para
posicionar e usa a roda para o zoom** dentro de um círculo — o mesmo arranjo de
uma foto de perfil de rede social —, e o que fica dentro vira um PNG de 128×128.
A conta do enquadramento mora em `web/js/recorte.js`, sem DOM e com teste,
porque ela erra calada: um limite frouxo deixa a imagem descolar e o ícone sai
com uma faixa vazia na borda.

> O recorte é desenhado num **canvas**, e não posicionado por CSS: o que sai no
> arquivo tem de ser exatamente o que está à vista, e com CSS haveria duas
> contas de enquadramento (a da tela e a da exportação) divergindo no primeiro
> arredondamento. E o corte é **circular**, não quadrado — o ícone é redondo em
> toda tela onde aparece, e um quadrado com os cantos escondidos por CSS
> mostraria as pontas em qualquer lugar que esquecesse o `border-radius`.

O PNG não vai para lugar nenhum: ele **é** a coluna `imagem` da linha do ícone,
gravada no mesmo `upsert` que o resto do cadastro.



#### Ícone como prêmio de vitória (migration 0038)

Cada deck de NPC pode largar um **ícone**, configurado na aba DROPS ao lado do
pool de cartas: uma lista de ícones e uma **chance própria** em % por vitória.

> **O quadro do ícone precisa da classe `aberto` escrita no HTML.** Ele reusa a
> moldura `.quadro` das gavetas de raridade, e junto com o visual vem a regra
> `.quadro:not(.aberto) .quadro-corpo { display: none }`. As gavetas ganham e
> perdem o `aberto` sozinhas (`renderDropPool`, uma aberta por vez); o do ícone é
> markup fixo, com o cabeçalho sem `onclick` — então ele nunca receberia a classe
> de ninguém. Sem ela, `renderIcones()` roda certo, enche o DOM e a tela mostra
> só o cabeçalho: *"não está deixando escolher entre os ícones"*, sem um erro no
> console. Guardado pelas três últimas asserções de `drops.test.mjs`, que valem
> para **qualquer** `.quadro` escrito à mão — markup fixo não passa pelo código
> que abre e fecha.

> **Por que fora das gavetas de raridade.** Três razões: carta **repete** e
> ícone não (a segunda cópia de uma rara é o jogo funcionando, o mesmo ícone
> duas vezes é um prêmio vazio); as gavetas já significam a % que a tela promete
> (`chancesDe`), e um ícone dentro da UR mudaria essa conta **sem mudar o
> texto** — a tela passaria a mentir sem ninguém mexer nela; e um ícone é um
> evento raro, que merece uma chance dita em número redondo em vez de diluída
> entre trinta cartas.

O sorteio só olha os que o jogador **ainda não tem** — quem completou a coleção
não "ganha" nada com 5% de chance, e a tela de fim de duelo não precisa explicar
um prêmio que não existe. Ícone **gratuito** fica de fora nas duas pontas (o
servidor nunca o sortearia, e o editor não o oferece: seria prometer o
impossível).

> O ícone volta num campo **`icone`** do `premiar_vitoria`, e não como uma
> entrada em `drops`: cada `drops[i].id` é desenhado como código de CARTA, e um
> id de texto ali viraria uma arte quebrada em quem ainda não atualizou. Campo
> novo, o cliente antigo ignora.

Na tela de fim de duelo ele aparece **aberto**, e não virado como as cartas: é
um só e é raro, e a virada existe para dar ritmo a três ou quatro cartas.

> **E some quando não houve ícone — o que exigiu um `#end-icone[hidden]`.** O
> `mostrarIconeGanho(null)` sempre fez `caixa.hidden = true`, e isso não fazia
> nada: o `hidden` do HTML é uma regra da folha do NAVEGADOR, e o
> `#end-icone { display: flex }` de `duel.html` ganhava dela. O aviso "ÍCONE
> NOVO — escolha-o no seu perfil" ficava na tela em todo fim de duelo, com a
> arte vazia e o nome em branco, **inclusive para quem perdeu**. Todos os outros
> overlays da tela (`#end-overlay`, `#sel-overlay`, `#chain-overlay`, `#reveal`,
> `#coin-overlay`, `#atk-seta`…) já tinham o seu guarda; este foi o único
> esquecido. `node web/js/esconder.test.mjs` varre isso em toda página.

> **A Loja ainda não vende ícone.** O catálogo já tem `preco`, `na_loja` e
> `raridade`, e `dar_icone()` (admin) é a porta de serviço enquanto a compra não
> existe. A vitrine de cosméticos entra quando houver ícone cadastrado — uma
> aba vazia não se prova.

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

`requireLogin()` no boot de `index/loja/deck/inventario/duel.html` redireciona
pra `web/login.html` sem sessão.

> **A sessão morre com a janela, a não ser que o jogador peça o contrário**
> (23/08/2026). A tela de login tem uma caixa **"manter login nesta máquina"**:
> marcada, a sessão vai para o `localStorage` e sobrevive a fechar o jogo;
> desmarcada — o padrão —, vai para o `sessionStorage`, e abrir o jogo de novo
> pede a senha. Quem decide onde gravar é `armazenamento()` em `supabase.js`, e
> a escolha (`ygo:manter-login`) fica no `localStorage` dos dois jeitos: ela é
> preferência, não sessão, e é o que faz a caixa aparecer como a pessoa a
> deixou.
>
> Três armadilhas, todas silenciosas e todas a favor de quem não devia entrar:
> `sessao()` lê **um** armazenamento só (ler os dois "para não perder a sessão"
> faria uma sessão esquecida no `localStorage` manter a pessoa entrada para
> sempre); gravar **apaga a cópia do outro lado** (senão ela ressuscita no dia
> em que a escolha mudar); e `limparSessao()` limpa os **dois** — sair que limpa
> só um é um sair que não sai. Um `import` de `supabase.js` também varre a
> sessão que ficou no `localStorage` sem a escolha ligada: é o caso de todo
> jogador que já estava logado no dia desta mudança, e deixá-la ali guardaria um
> refresh token válido no disco para sempre. `node web/js/sessao.test.mjs`.
>
> Nada disso vale prazo de expiração próprio: o `sessionStorage` é o navegador
> quem apaga. Um "vence em N dias" gravado junto do token seria um prazo que
> qualquer um edita.

**A Área de Teste inteira é de ADMIN** (23/08/2026), por `requireAdmin()`
(`web/js/auth.js`): sem sessão vai pro login, com sessão de jogador comum volta
pra home. Vale para o `teste.html` e para CADA ferramenta dele —
`banlist`, `listas`, `npcs`, `campo`, `ordenar`, `icones`, `estrutural`,
`booster` (Booster Builder), `adversario`, `mundo`/`cidade`, e o
`deck.html?npc=<id>` (que edita o deck e o pool de drop de um ADVERSÁRIO). O
botão "⚙ Área de Teste" da home nasce `hidden` e só aparece com
`meuPerfil().admin` — ao contrário, ele piscaria na tela de todo jogador no
intervalo entre o boot e a resposta do perfil.

> **Isto é a PORTA, não a fechadura.** Quem barra de verdade é a RLS: `conteudo`,
> `decks_npc`, `tabuleiros`, `icones` e `creditar_dp` exigem `eh_admin()`, e o
> campo `perfis.admin` não é auto-atribuível (gatilho `travar_admin`). O guarda
> do cliente existe porque uma ferramenta de administração aberta na cara do
> jogador é uma promessa que o servidor não cumpre: ele monta a banlist inteira,
> clica em publicar e leva 403 — pior que não ter visto o botão. Por isso a
> resposta vem do SERVIDOR a cada abertura, e não de um `admin` guardado no
> `localStorage`, que viraria uma linha de texto que qualquer um edita.

Antes disto só `deck.html` fora do modo NPC pedia login, e as ferramentas não
pediam nada — "são ferramenta de configuração, não progresso de ninguém". O que
essa conta esquecia é que `adversario.html` e `cidade.html` **furam a Trilha**:
são a grade sem cadeado, e qualquer jogador que soubesse o endereço enfrentava
qualquer adversário sem ter destrancado nada.

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
