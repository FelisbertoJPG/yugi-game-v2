# CLAUDE.md — `web/` (o front)

> Documentação e comentários do projeto são em **português**. Siga a língua do
> arquivo que você está editando.

Este arquivo cobre **`web/`**: as telas, os módulos ESM de `web/js/`, o CSS de
`web/css/`, os testes em Node e as bancadas visuais de `tools/bancada-*.mjs`.
O genérico do projeto está na raiz (`CLAUDE.md`) e é sempre carregado; o motor
de duelo, o Supabase e o Release estão em **`duel-server/CLAUDE.md`**.

> **O front é HTML/CSS/JS puro, ESM, com ZERO dependências.** Não existe `npm
> install`, não existe framework e não existe build step. O que precisa de
> biblioteca é **vendorizado** (`web/vendor/`, como o three.js e os addons dele)
> para viajar dentro do `game.zip` — um `import` de CDN deixa a tela sem abrir
> exatamente quando a conexão está pior, e um `import` que dá 404 mata o
> `<script type="module">` inteiro, em silêncio.

> **As regras do Yu-Gi-Oh! não moram aqui.** O `ocgcore` já responde o que pode
> ser ativado, invocado ou reposicionado nas listas que manda — desenhe o que
> ele ofereceu. Regra reimplementada no cliente diverge do motor sem ninguém ver.

## Comandos

```bash
node web/js/deck.test.mjs    # 33 testes das regras de construção de deck
node web/js/banlist.test.mjs # 29 testes da banlist (Ponto/Banlist/Lista compartilhada)
                             # e da FRASE do problema (`textoDoProblema`), que
                             # agora tem DOIS leitores: o Deck Builder, que
                             # bloqueia o salvar, e a porta do duelo, que
                             # bloqueia a partida. Duas frases escritas em
                             # lugares diferentes recusariam a mesma carta com
                             # dois motivos, conforme onde o jogador esbarrasse
                             # nela
node web/js/portadoduelo.test.mjs # 10 testes da PORTA DO DUELO. O relato: *"o
                             # player ta conseguindo duelar com um deck que
                             # possui mais de uma copia de cards limitados"*.
                             # `salvar_deck` sempre cobrou a banlist — mas o
                             # duelo NAO passa por ele: `chosenDeck()` le o deck
                             # do localStorage e manda as cartas direto para o
                             # motor local, e o unico servidor no caminho
                             # (`iniciar_duelo`) recebia so' o NOME do deck. O
                             # builder recusava salvar, o banco recusava gravar,
                             # e o deck ficava so' naquele navegador — de onde o
                             # duelo o carregava normalmente.
                             # Sao DUAS camadas, e este arquivo guarda a de ca':
                             # a PORTA (`podeDuelar`, em duel.html) existe para o
                             # aviso dizer O QUE esta' errado; ela le a copia
                             # local da banlist e por isso so' sabe ACRESCENTAR
                             # um motivo, nunca dar permissao (copia velha deixa
                             # passar, e ai' quem responde e' o servidor). A
                             # FECHADURA e' `iniciar_duelo` (migration 0047),
                             # que recebe as CARTAS e recusa.
                             # O que ele mais guarda e' a ORDEM: uma trava que
                             # roda depois do `/start` nao e' trava, e' aviso — o
                             # duelo ja' esta' na tela — e nada acusaria, porque
                             # o texto seria o mesmo. Cobre tambem o registro do
                             # duelo vindo ANTES do motor (o que conserta de
                             # quebra a parede de versao e o teto por hora, que
                             # eram descobertos com o duelo ja' rolando e viravam
                             # premio negado no fim, sem explicacao)
node web/js/automontagem.test.mjs  # 18 testes da Auto montagem (curva, ritual, fusão)
node web/js/ponte.test.mjs   # 22 testes da ponte: a perspectiva (virar a mesa) e o
                             # DESFECHO. O relato do fim: *"quando a battle e' vencida
                             # por um jogador a batalha deve encerrar e ambos devem ser
                             # redirecionados pra Home. Inclusive se um player desistir
                             # o outro tbm... Hoje a sala fica aberta e o duelo n
                             # encerra"*. Quem desistia fechava a partida no banco e ia
                             # embora; o adversario ficava com o tabuleiro na tela,
                             # pesquisando lances de uma partida encerrada, para sempre.
                             # Hoje o servidor manda a noticia (`lances.tipo = 'fim'`,
                             # migration 0056) e o `desfechoDoFim` a traduz para trofeu
                             # ou caveira — errar essa conta mostra a tela do VENCEDOR
                             # para quem perdeu, sem erro nenhum aparecer
node web/js/correntes.test.mjs # 24 testes do modo das correntes (desligado/auto/sempre).
                             # O modo `auto` (o PADRAO) responde por voce nas
                             # janelas de rotina, e por isso ele ENGOLE CALADO o
                             # que nao souber reconhecer: o relato foi *"a Golden
                             # Ladybug nao pediu pra ativar o efeito da standby,
                             # ou ele foi consumido por outra coisa"* — foi
                             # consumido pelo proprio modo. O efeito dela e'
                             # `EVENT_PHASE|PHASE_STANDBY` + `LOCATION_HAND` +
                             # `SetCountLimit(1)`: ninguem invoca, ninguem ativa,
                             # ninguem ataca, entao a janela caia em "rotina" e
                             # era passada todo turno, sem uma linha no log. Do
                             # lado de quem joga a carta so' nunca fazia nada.
                             # Os dois momentos novos sao PROXIES assumidos (o
                             # motor nao diz "este efeito some se voce passar"):
                             # carta na MAO numa janela que ninguem abriu (a de
                             # campo com livre encadeamento volta em TODA janela;
                             # da mao, fora de uma resposta, so' aparece o que tem
                             # hora marcada) e a MINHA Standby Phase, que acontece
                             # uma vez por turno. Cada um tem par CONTROLE — a
                             # mesma carta em campo fora da Standby, e a Standby
                             # DELE —, senao "perguntou" nao provaria nada
node web/js/batalha.test.mjs # 16 testes dos CINCO momentos do ataque. No
                             # Yu-Gi-Oh a batalha nao e' um instante: declara-se
                             # o ataque escolhendo quem ataca e em quem, o alvo
                             # com a face para baixo ABRE, uma janela de resposta
                             # permite impedir o golpe, os corpos colidem e so'
                             # entao o dano e' calculado. A tela mostrava um
                             # instante so'.
                             # O motor sempre mandou as fronteiras — o que
                             # faltava era traduzi-las (ver `--test-etapa-dano`,
                             # que as MEDE no motor; as sequencias deste arquivo
                             # sao as de la', nao inventadas).
                             # A regra erra CALADA nos dois sentidos: momento
                             # velho promete "responda ao ataque" numa janela em
                             # que nao ha ataque nenhum, e momento que morre cedo
                             # apaga a seta no meio da etapa de dano.
                             # E o CALCULO tem duas armadilhas que mostram um
                             # numero plausivel: o ataque DIRETO tambem manda
                             # MSG_BATTLE (com o lado do defensor zerado — quem
                             # o desenhar poe na tela um adversario de 0 de ATK
                             # apanhando), e um monstro DEITADO luta pela DEF,
                             # entao mostrar o ATK dele anuncia "1700 x 1400"
                             # numa batalha que o motor resolveu como 1700 x 1200
                             # — e o resultado deixa de fechar com os numeros a'
                             # vista
node web/js/filavisoes.test.mjs # 12 testes da fila de visões (concorrência do multiplayer:
                             # a visão que chega no meio da aplicação da anterior). O
                             # `drenar` é o mais novo: o aviso de FIM da partida chega
                             # logo atrás da visão do golpe final, que ainda está sendo
                             # animada — sem esperar a fila assentar, o quadro de
                             # vitória entra por cima do último ataque e o perdedor lê
                             # "você perdeu" sem ver por quê
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
node web/js/gavetas.test.mjs # 8 testes das GAVETAS por raridade (a caixa "ver as
                             # cartas" da Loja, que é a MESMA lista de drops da
                             # Trilha). O assunto é o gesto de LER a carta, que
                             # a Loja liga e a Trilha não: a miniatura abrindo o
                             # SEU id (uma função presa na variável do laço
                             # abriria sempre a última carta da gaveta, e a
                             # janela abre — com a carta de outra pessoa), o
                             # "consumiu?" do `wireLongPress` barrando o clique
                             # de soltar (senão o detalhe abre duas vezes), o
                             # `draggable="false"` da arte (o navegador arrasta
                             # a `<img>` ao primeiro pixel de movimento e o
                             # `dragstart` CANCELA a contagem do segurar — o
                             # gesto falha calado para quem não segura a mão
                             # parada), e a caixa da Trilha ficando INERTE sem
                             # `aoAmpliar`. O módulo é carregado com o import de
                             # `wallet.js` trocado por dois retornos fixos (o
                             # caminho é absoluto e não resolve em Node, e a
                             # carteira arrastaria o Supabase junto) — a troca é
                             # conferida, senão o teste rodaria num arquivo que
                             # não existe mais
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
                             # A MESMA seta virou tambem a ESCOLHA do alvo. Declarar
                             # o ataque abria uma JANELA com as cartas do outro lado:
                             # escolhia-se em quem bater olhando uma lista de
                             # miniaturas, com o tabuleiro atras de um vidro no unico
                             # momento em que o que importa e o tabuleiro — e com a
                             # seta, que e o desenho de "quem bate em quem",
                             # esperando do lado de fora ate a escolha estar feita.
                             # Hoje o clique no atacante acende a seta e ela segue o
                             # ponteiro (`iniciarMira`, em duel.html): passa-se de
                             # alvo em alvo olhando a mesa, o alvo sob o cursor
                             # acende, e o clique fixa e declara.
                             # Quem diz QUAIS sao os alvos continua sendo o motor — a
                             # lista do MSG_SELECT_CARD que ele manda depois da
                             # declaracao. Adivinhar ("todo monstro do outro lado
                             # serve") acertaria quase sempre e erraria calado na
                             # carta que obriga a ataca-la, que e quando importa; e
                             # lista que nao tem a forma de alvo de batalha, ou que
                             # peca mais de uma carta, cai na janela de sempre — a
                             # mira nao tem onde acumular nem botao de confirmar.
                             # Duas armadilhas caladas: o traco e repintado a cada
                             # movimento do mouse, entao NENHUMA animacao de entrada
                             # pode valer na mira (`seta-cresce` reiniciaria 60x por
                             # segundo, `seta-ponta` tem 300ms de atraso e a cabeca
                             # nunca apareceria); e a seta FICA congelada no clique
                             # que a responde — apaga-la ali daria um piscar entre a
                             # escolha e a declaracao —, o que exige a regra que
                             # fecha o ciclo no fim do `apply`: sem ataque em curso e
                             # sem mira, nao pode haver seta na tela.
node web/js/alvos.test.mjs   # 29 testes de DE QUEM E' A CARTA que estou
                             # escolhendo. O relato: *"quando eu ativo um card,
                             # aparecem todos os cards elegiveis pra selecionar,
                             # porem nao diferencia quais sao meus e quais sao
                             # do oponente"* — com o Chaos Scepter Blast de
                             # exemplo, que bane 1 carta do CAMPO (dos dois
                             # lados) e pode banir uma minha por engano. O pior
                             # caso e' o dele: as cartas SETADAS chegam sem
                             # codigo e sao todas desenhadas com o mesmo verso,
                             # entao meia duzia de versos identicos numa grade
                             # nao e' escolha, e' sorteio.
                             # O `controller` sempre veio na lista (`Sel`, em
                             # InteractiveDuel) e no multiplayer ja' chega
                             # VIRADO (`CAMPOS_DE_JOGADOR`, em ponte.js) — o que
                             # faltava era usa-lo. Sao DUAS respostas: tudo no
                             # CAMPO vira escolha NA MESA, sem quadro (o
                             # tabuleiro ja' separa os lados desenhando um em
                             # cima e o outro embaixo — a mesma decisao da MIRA
                             # do ataque); o resto continua no quadro, mas
                             # AGRUPADO por dono E LUGAR, com selo em cada carta
                             # — o titulo do grupo sai da vista assim que a
                             # grade rola.
                             # O LUGAR entrou depois, e por um relato do mesmo
                             # tamanho: *"tributei meu Lustro Negro errado
                             # porque eu tinha 1 na mao e 1 no campo, e os dois
                             # apareceram iguais, sem dizer de onde era cada
                             # um"*. As duas eram MINHAS — o selo de dono estava
                             # certo e era inutil —, e o que separava as cartas
                             # so' existia no `title`, atras de um hover.
                             # Tooltip nao e' feedback visual: numa escolha que
                             # nao da' para desfazer, ou esta' desenhado, ou nao
                             # existe. O selo agora diz so' o que VARIA
                             # (`eixosQueVariam`): dono, lugar, ou os dois —
                             # carimbar "sua" em seis cartas todas minhas e'
                             # ruido, e ruido esconde a informacao que importa.
                             # Casos de rituais caem aqui de proposito
                             # (`selectsum` fica fora da escolha na mesa), e sao
                             # justamente os que tributam da MAO e do CAMPO na
                             # mesma pergunta.
                             # A decisao erra CALADA nos dois sentidos: cair no
                             # quadro quando dava para clicar na mesa e' so'
                             # chato; cair NA MESA com uma carta que nao tem
                             # zona a' vista (material de Xyz, ou duas cartas na
                             # mesma zona) deixa a pergunta sem resposta
                             # possivel e o duelo para ali. Por isso a condicao
                             # "a zona existe na TELA" e' um callback: e' a
                             # unica metade que so' o duel.html sabe responder.
                             # O ritual (`selectsum`) fica de fora de proposito
                             # — ali quem decide e' o NIVEL de cada carta, que o
                             # quadro imprime no canto da miniatura e a zona nao
                             # mostra.
                             # Os tres ultimos testes sao de CSS, que e' onde
                             # esta feature erra sem que logica nenhuma veja:
                             # `#sel-overlay[hidden]` e `#sel-overlay.no-campo`
                             # tem a MESMA especificidade e a segunda vem
                             # depois, entao um `display` escrito ali venceria o
                             # `[hidden]` e a barra ficaria na tela para sempre;
                             # e sem `pointer-events: none` o overlay
                             # transparente (que e' `inset: 0`) engole TODO
                             # clique no tabuleiro — a mesa fica desenhada,
                             # piscando as candidatas, e nada responde.
                             # E o pior deles e' o que a ESCOLHA NA MESA
                             # desenterrou: *"na hora de selecionar, os cards
                             # saem de suas posicoes originais"*. Com um
                             # tabuleiro ativo cada zona e' posicionada em
                             # PIXEL (`applyZonePosition`), e isso era a ULTIMA
                             # linha de `zoneEl` — enquanto o ramo da selecao
                             # devolvia a zona 90 linhas antes. A zona
                             # candidata perdia a posicao e caia no FLUXO do
                             # flexbox: o tabuleiro se desmontava no exato
                             # momento em que se pede para clicar nele. O
                             # defeito e' ANTIGO e ficou invisivel porque o
                             # quadro era um modal com vidro por cima — a mesa
                             # se desmontava atras dele. Hoje toda saida de
                             # `zoneEl` passa pela `pronta()`, e a varredura
                             # cobra isso (com o caso ruim provado).
                             # Os QUATRO seguintes sao de um duelo que PAROU: o
                             # log mostra a pergunta do alvo do Dust Tornado
                             # chegando e, por 39 segundos, nenhum `/respond`
                             # saindo — o jogador clicou, nada respondeu, e ele
                             # saiu do duelo. A condicao "a zona existe" era uma
                             # SEGUNDA condicao: `zoneEl` so' torna a zona
                             # clicavel quando ela tem CARTA (`if (cell &&
                             # selKey)`), entao uma zona que o motor oferece e a
                             # tela desenha vazia existe no documento e nao
                             # recebe clique. Hoje quem responde e' a classe
                             # `selectable`, lida do MESMO elemento que recebe o
                             # clique. E a escolha na mesa ganhou SAIDA — o
                             # [ver a lista] devolve o quadro para aquela
                             # escolha (vale por escolha, nunca vira
                             # preferencia), porque qualquer motivo de a carta
                             # nao ser alcancavel na mesa deixava o "desistir"
                             # como unica porta. A barra tambem parou de dizer
                             # "aguarde…" durante uma escolha: com o quadro
                             # modal isso nao custava nada, com o tabuleiro
                             # sendo a interface e' o jogo pedir uma resposta
                             # afirmando que espera outra coisa
node web/js/movimento.test.mjs # 9 testes de PARA ONDE A CARTA FOI. O relato:
                             # *"a carta escolhida simplesmente desaparece da
                             # zona, sem animacao nenhuma — parece que foi pra
                             # mao do oponente"*. Era isso mesmo: a MAO nao e'
                             # uma zona, nao tinha ancora nenhuma, e o
                             # `flyGhost` desiste EM SILENCIO sem destino
                             # (`if (!from || !to) return`). A carta devolvida a'
                             # mao saia da mesa entre dois quadros de video e
                             # reaparecia como um numero maior na contagem da
                             # mao do outro lado — que e', pra quem olha, uma
                             # carta teleportada. O EXTRA estava fora do mapa
                             # pelo mesmo motivo. O estado sempre esteve certo
                             # (o `handle` do `move` trata a mao desde sempre);
                             # faltava o desenho. Mesma familia do "card
                             # alvejado vai pra mao do oponente" da investida:
                             # ninguem le um movimento que nao acontece —
                             # inventa-se um.
                             # O teste que vale e' a VARREDURA: toda
                             # localizacao que o motor sabe mandar tem de ter
                             # lugar na tela, porque foi uma localizacao
                             # legitima e nao mapeada que abriu o buraco, e
                             # buraco nao acusa nada. E a outra metade e' o que
                             # a TELA faz com `null`: a carta SOME NO LUGAR
                             # (encolhendo), nunca entre dois quadros —
                             # `flyGhost` continua desistindo sem destino, que
                             # e' o que protege do NaN no transform, entao quem
                             # fecha o buraco e' o `else sumirGhost`
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
node web/js/defesavirada.test.mjs # 5 testes da DEFESA ESPERADA de uma carta
                             # VIRADA — a conta que o NPC faz para decidir se
                             # bate nela. O relato: *"ele esta' com medo de
                             # bater em qualquer card meu em def"*. Estava: para
                             # o iniciante a carta virada nao existia, e quem
                             # nao ve a carta ora se joga contra ela, ora nao
                             # ataca nunca — os dois sintomas do MESMO buraco.
                             # Hoje ele faz a conta de qualquer jogador: *"so'
                             # SETOU, entao e' nivel <=4, entao tem no maximo
                             # tanto de DEF"*. A faixa sai dos TRIBUTOS pagos
                             # (0 → Nv<=4, 1 → 5-6, 2 → 7+), que e' informacao
                             # PUBLICA — por isso vale para os dois niveis, e o
                             # avancado continua sendo o unico que le a carta.
                             # **Nao e' um TETO, e' uma APOSTA — e a diferenca e'
                             # a feature.** O pior caso do pool para Nv<=4 e'
                             # 2400; apostar no pior caso e' voltar ao medo,
                             # porque um deck de 40-60 leva no maximo tres
                             # copias de UM muro e a chance de ser justamente
                             # ele e' pequena. Entao a aposta fica ABAIXO do
                             # pior caso de proposito: 2000/2500/3000, e quem a
                             # fura e' CONTADO — 1,7%, 3,6% e 1,0% do pool. O
                             # preco de errar e' uma batalha; o de nunca atacar
                             # e' o duelo.
                             # **A aposta cai quando ha informacao melhor**: o
                             # NPC guarda o que VIU ir para a mao do jogador
                             # (busca no deck, recuperacao do cemiterio, resgate
                             # das banidas — tudo publico, a carta e' mostrada
                             # ao adversario), e se um muro daquela faixa foi
                             # visto e ainda nao apareceu, o setado e' quase
                             # certamente ele: vale a DEF DELE, nao a aposta. A
                             # memoria some quando a carta deixa a mao — ela
                             # responde "o que esta na mao dele AGORA", nao um
                             # historico.
                             # Os numeros ENVELHECEM CALADOS, e por isso este
                             # teste nao copia nenhum: LE as constantes do
                             # `NpcBrain.cs` e mede o pool publicado (a mesma
                             # escolha do `vivo.test.mjs`). Cobra os dois lados
                             # — aposta furada por gente demais (o NPC se joga
                             # contra paredes) e aposta que virou teto de novo
                             # (o medo volta junto).
                             # O que NAO da' para fazer, e por que: pesar a
                             # chance pelo TAMANHO do deck exigiria saber a
                             # composicao do deck do jogador, que e' leitura
                             # escondida — nem o avancado tem isso
node web/js/inventarioitens.test.mjs # 11 testes da aba ITENS GERAIS do
                             # inventario (a terceira, ao lado de CARDS e
                             # DECKS). A posse vem de DUAS fontes — `meus_icones`
                             # (o icone tem tabela e regras proprias desde a
                             # 0035) e `meus_itens` (0052) —, lidas separadas:
                             # junta-las no servidor seria uma TERCEIRA verdade
                             # sobre posse, e ela envelheceria calada no dia em
                             # que uma das duas ganhasse uma regra (o icone
                             # gratuito, que ninguem "ganha" e todo mundo tem).
                             # So' a apresentacao e' comum.
                             # Erra dos dois lados, calado: as consultas
                             # devolvem o CATALOGO inteiro com um `tenho` (de
                             # proposito — a mesma consulta serve a uma
                             # vitrine), entao sem o filtro o jogador abre o
                             # inventario e ve o catalogo do jogo como se fosse
                             # dele; e um tipo NOVO, cadastrado por um admin com
                             # o servidor mais novo, nao pode sumir do
                             # inventario de quem ainda nao atualizou —
                             # aparecer com o nome cru e' ruim, sumir e' pior.
                             # Guarda tambem a troca das abas de BOOLEANO para
                             # nome: com duas, "nao e' cards" bastava; com tres
                             # ele passa a significar duas coisas
node web/js/itens.test.mjs   # 13 testes do cadastro de ITENS (sleeve, playmat,
                             # deck box e o `generico`, migration 0051). O
                             # ÍCONE continua na tabela dele: ele ja' e' usado
                             # por `perfis.icone_id`, `escolher_icone()` e o
                             # gatilho `perfis_icone_valido` — generalizar
                             # aquilo seria trocar um caminho que funciona por
                             # um que ainda nao existe. Por isso `icone` e' uma
                             # opcao da TELA e um tipo RECUSADO na tabela: um
                             # item de tipo `icone` em `itens` seria um
                             # cosmetico que a tela de perfil nunca oferece —
                             # cadastrado, pago e inutil.
                             # A tela e' uma so' (`web/itens.html`) e o tipo e'
                             # a primeira escolha dela; em `icone` ela DELEGA
                             # para o editor que ja' existe em vez de ter uma
                             # segunda copia do formulario, e o teste cobra
                             # isso (nada de `recorte.js` ali). Duas telas que
                             # gravam a mesma coisa divergem na primeira
                             # mudanca — e o recorte do icone e' circular, o do
                             # item nao e'.
                             # O resto e' o que erra CALADO entre a tela e o
                             # banco: `data:text/html` casa com "data:" e nao e'
                             # imagem (vira quadrado vazio, sem erro), e mandar
                             # `imagem: null` ao editar so' o preco APAGARIA a
                             # arte de um item que ja' esta' na Loja — por isso
                             # a chave nem vai quando nao ha' arte nova
node web/js/cardbuilder.test.mjs # o CARD BUILDER escreve Lua, e Lua errado
                             # não dá erro em lugar nenhum daqui: a tela mostra,
                             # o banco grava, e só um duelo descobriria que a
                             # carta nunca é oferecida. Varre TODA combinação de
                             # tipo × momento × ação × alvo × custo × limite e
                             # cobra: constante escrita existe no `constant.lua`
                             # do MOTOR (inexistente vira `nil`, e `SetCode(nil)`
                             # registra um efeito que nunca dispara), `Cost.*` e
                             # os `proc_*` existem, `function`+`if` = `end`, os
                             # números de tipo/raça/atributo lidos do arquivo, o
                             # nome que não vira linha de código, a Contínua que
                             # ganha a ativação para entrar na zona, e a faixa de
                             # id igual à CHECK da migration 0058
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
node web/js/organizardeck.test.mjs # 16 testes do [organizar deck] — a ordem
                             # DENTRO do deck (Ritual → Monstro de Efeito →
                             # Monstro Normal → Magia → Armadilha, e, dentro de
                             # cada um, as de 3 cópias antes das de 2 e das de
                             # 1). Vale para os dois builders, porque é o mesmo
                             # `deck.html`: o do jogador e o `?npc=<id>` do
                             # admin. A CATEGORIA manda mais que a quantidade —
                             # o Efeito de 2 cópias vem antes do Normal de 3 —,
                             # e o contrário também pareceria certo na tela.
                             # Erra CALADO nas três decisões: a palavra engana
                             # ("Ritual Spell" não é ritual, "Normal Spell" não
                             # é monstro Normal, "Fusion/Effect" não é efeito),
                             # a ordem errada continua sendo um deck de 40
                             # cartas que salva e duela igual, e a saída
                             # PRECISA ser uma permutação da entrada — a carta
                             # que o índice não conhece (customizada, id de um
                             # banco mais novo) é justamente a que sumiria sem
                             # ninguém notar. Guarda também a idempotência: a
                             # ordem é o que vira o `.ydk`, então o botão suja
                             # o deck (`markDirty`), e sujá-lo sem ter mexido
                             # em nada cobraria um "descartar alterações?" por
                             # um clique à toa
node web/js/vistoem.test.mjs # 22 testes do "VISTO POR ÚLTIMO" da lista de
                             # amigos — a tradução do carimbo de presença
                             # (`meus_amigos.visto_em`, migration 0049) para uma
                             # linha. As três decisões erram CALADAS: o carimbo
                             # que não veio (cliente novo contra servidor sem a
                             # 0049) viraria "Invalid Date" na tela, uma frase
                             # que parece uma data — aqui é `null`, e a linha
                             # não aparece; "ontem" é dia de CALENDÁRIO e não 24
                             # horas, então às 00:30 uma conta por
                             # milissegundos diria "hoje" sobre 23:50 da véspera
                             # (e o avesso: às 01:00, 26 horas atrás é
                             # ANTEONTEM); e a conta entre as meias-noites
                             # LOCAIS é o que atravessa horário de verão — um
                             # dia de 23h ou 25h — sem escorregar um dia.
                             # As datas do teste são construídas com o
                             # construtor LOCAL, nunca com string ISO em UTC:
                             # a função responde no fuso de quem lê, e uma
                             # string fixa passaria aqui e falharia noutra
                             # máquina
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
node web/js/atalhos.test.mjs # varre TODA página de web/ e todo módulo de
                             # web/js/ atrás de UMA armadilha: o **atalho de
                             # propriedade que referencia uma variável que não
                             # existe**. `{ nomeDe }` parece uma chave e é uma
                             # LEITURA de variável — sintaxe válida, nada acusa
                             # ao salvar nem ao carregar a página, e o
                             # `ReferenceError` só aparece no instante em que
                             # aquela linha executa. Se a linha mora num caminho
                             # raro, ela viaja para produção.
                             # Este projeto pagou DUAS vezes: `{ turno }` onde a
                             # variável se chama `turn` (o duelo morria na
                             # primeira janela de corrente), e `{ nomeDe }` onde
                             # a função se chama `nameOf` — este segundo só
                             # estourava ao VENCER um adversário COM pool de
                             # drop, e a linha quebrada fica entre
                             # `liberarSaidaDoFim(false)` e
                             # `$('end-overlay').hidden = false`: a tela de fim
                             # nunca aparecia, os dois botões de saída ficavam
                             # desligados, e o prêmio já estava creditado no
                             # servidor. Vitória sem saída.
                             # A varredura é estreita de propósito (só o atalho
                             # sozinho numa linha, a forma exata dos dois casos
                             # reais) e escopo-cega: basta o nome existir no
                             # arquivo. Em troca, zero falso positivo — varredura
                             # que grita à toa deixa de ser lida. Prova também
                             # que RECONHECE o caso ruim
node web/js/fimduelo.test.mjs # 11 testes da TELA DE FIM DE DUELO, a menos
                             # exercitada do jogo: só aparece quando o duelo
                             # acaba, e a parte com prêmio só quando você VENCE
                             # alguém com pool de drop. As funções são FATIADAS
                             # do `duel.html` (nunca copiadas — uma cópia
                             # passaria a valer por si) e rodam com o
                             # `montarRevelacao` de verdade e um DOM de mentira.
                             # Guarda a CONSEQUÊNCIA que o jogador sentiu, e que
                             # qualquer exceção naquele trecho reproduz: o
                             # overlay aparece, o nome da carta chega à
                             # revelação, e os botões de saída VOLTAM quando a
                             # última carta abre. Com o par CONTROLE de quem
                             # PERDE e de quem vence sem pool — os dois seguem
                             # verdes mesmo com o bug, que é exatamente por que
                             # ele só aparecia contra adversário com drop.
                             # Os quatro últimos guardam o fim no MULTIPLAYER:
                             # `soHome` deixa UMA saída ([novo duelo] reabriria
                             # uma sala que não existe mais) e `motivo` escreve
                             # POR QUE acabou — ganhar por desistência sem uma
                             # palavra é um troféu que aparece do nada no meio
                             # do seu turno. As duas viajam em `opcoes`, e não
                             # de um `ehMultiplayer()` lido lá dentro: a função
                             # é FATIADA e executada em Node
node web/js/modelos.test.mjs # 16 testes da PONTE para modelos `.glb`. O boneco
                             # é montado de cápsulas escritas em código; este
                             # módulo troca cada peça por arte modelada **uma
                             # de cada vez**, e a regra que sustenta tudo é que
                             # **FALTAR ARQUIVO É NORMAL** — hoje não existe
                             # `.glb` nenhum e o Mundo funciona; apagar um
                             # devolve a cápsula. Se a falta virasse erro, o
                             # Mundo não abriria, que é o pior desfecho.
                             # Mas o avesso é igualmente calado: nome errado
                             # no manifesto, arquivo no lugar errado e GLB
                             # recusado dão EXATAMENTE a mesma tela de "ainda
                             # não modelei essa peça" — por isso tudo que
                             # falha é contado em `estadoDosModelos()`.
                             # As outras duas: a MATRIZ DE MUNDO (o exportador
                             # aninha nós, e ler a geometria sem aplicá-la
                             # empilha as partes na origem — o boneco monta,
                             # não reclama, e as peças ficam dentro do peito) e
                             # a JUNTA (uma jaqueta cobre tronco e braços; uma
                             # malha só no tronco fica rígida com o braço
                             # andando por dentro — o `.glb` diz a junta pelo
                             # NOME do nó, e nome desconhecido cai na padrão do
                             # slot).
                             # O GLB do teste é MONTADO byte a byte ali: um
                             # binário commitado seria arte sem fonte num
                             # projeto cuja regra é o contrário, e um teste
                             # preso a um arquivo que ninguém sabe regenerar
node web/js/aparencia.test.mjs # 29 testes da APARÊNCIA do jogador (cabelo,
                             # pele, roupa) e do VESTIÁRIO do Mundo. A
                             # decisão que manda: **o CÓDIGO diz o que
                             # existe, o BANCO diz o que se vende**. Um
                             # ícone é um PNG numa coluna e o banco o
                             # inventa sozinho; uma peça de roupa é
                             # GEOMETRIA, e geometria mora em `boneco3d.js`
                             # — peça que o código não sabe construir não
                             # existe, por mais linhas que tenha no banco.
                             # Daí o teste que nenhum código faz sozinho: o
                             # cruzamento catálogo × geometria, nas DUAS
                             # pontas. Peça sem forma é um cosmético que se
                             # compra e não aparece (paga DP, escolhe,
                             # salva, continua igual); forma sem peça é
                             # trabalho que nenhum slot alcança.
                             # A POSSE é uma frase só, escrita duas vezes
                             # de propósito: *"se a peça está no catálogo
                             # de venda, você precisa tê-la; se não está, é
                             # de graça"*. Aqui para saber o que OFERECER,
                             # e no gatilho `perfis_aparencia_valida` (0054)
                             # para saber o que ACEITAR — a segunda é a que
                             # vale, porque a policy de `perfis` deixa o
                             # dono escrever na própria linha e um `PATCH`
                             # direto vestiria o cosmético mais caro de
                             # graça. É o mesmo furo que a 0035 tinha e a
                             # 0036 fechou para o ícone.
                             # Desde 07/09/2026 há também o **UNIFORME
                             # ESCOLAR** (blazer com gravata ou laço, suéter,
                             # saia pregueada, sapato com meia alta, três
                             # cortes de cabelo colegiais). Ele é gerado em
                             # código como o resto: zero byte no `game.zip`,
                             # licença nenhuma para respeitar, e **anda**, que
                             # é o que um `.glb` de personagem grátis não faz
                             # (ver `conferirmodelo.js`).
                             # Junto vieram os testes que MEDEM a geometria,
                             # e eles existem porque geometria escrita à mão
                             # erra CALADA: as 864 combinações são montadas
                             # e conferidas (sem NaN — um vértice NaN faz o
                             # boneco sumir INTEIRO sem erro; pés em y=0;
                             # altura de gente), e a varredura do PEITO cobra
                             # que gravata, laço e lapela CRUZEM a superfície
                             # do tronco em vez de encostar nela — 6 mm à
                             # frente do pano já lê como peça solta de perto,
                             # e a peça está exatamente onde foi mandada.
                             # Ela tem par CONTROLE, e não por formalidade:
                             # a varredura passou VERDE duas vezes sem medir
                             # nada — uma porque o filtro de altura descartava
                             # o próprio torso, outra porque
                             # `updateMatrixWorld` num filho **não atualiza os
                             # pais** e todas as caixas voltavam para a origem.
                             # Repare no que a regra NÃO tem: uma lista de
                             # peças gratuitas. Grátis é a AUSÊNCIA em
                             # `itens` — duas listas se desencontrariam na
                             # primeira peça nova, e o sintoma seria a tela
                             # deixar vestir e o banco recusar.
                             # Cobre ainda a peça de PORTO SEGURO (o
                             # `normalizar` cai na primeira de cada slot;
                             # se ela estivesse à venda, o porto seguro
                             # seria uma peça que a maioria não tem), o
                             # cliente VELHO contra o item NOVO (peça
                             # desconhecida vira a padrão, nunca um id sem
                             # construtor), a cor torta que sairia BRANCA, e
                             # os dois números que moram em dois idiomas —
                             # o teto do JSON e os tipos de item são LIDOS
                             # do SQL, nunca copiados.
                             # E o pior defeito possível: a geometria é
                             # COMPARTILHADA entre todos os bonecos, então
                             # `descartar()` solta só os MATERIAIS. Soltar
                             # a geometria apagaria a peça do PRÓXIMO
                             # boneco, muito depois, com a causa a dez
                             # minutos de distância
node web/js/mundovivo.test.mjs # 21 testes de QUEM MAIS ESTÁ NA FLORESTA — as
                             # outras pessoas andando no Mundo, que desde
                             # 08/09/2026 se alcança pela Área de Teste (foi
                             # a opção 5 do menu da home entre 31/08 e 08/09;
                             # o Multiplayer, que ele substituiu ali,
                             # continua inteiro e é alcançado pelo cartão do
                             # amigo). Duas coisas erram CALADAS ali e são o
                             # arquivo inteiro.
                             # A CADÊNCIA: mandar a posição só quando ela
                             # MUDA é a economia óbvia e é o defeito
                             # principal — quem fica parado deixa de dar
                             # notícia, o prazo vence, e o corpo EVAPORA da
                             # tela dos outros com a pessoa de pé ali. O
                             # avesso custa igual: mandar a cada quadro são
                             # 60 mensagens por segundo por pessoa, que o
                             # servidor descarta, e o mundo engasga para
                             # todos. Daí os DOIS ritmos (`ENVIO_MS`
                             # andando, `BATIDA_MS` parado) e a folga de
                             # quatro batidas até o `SUMICO_MS`.
                             # E o RECADO QUE NINGUÉM VALIDOU: linha de
                             # tabela passou por policy, por tipo de coluna
                             # e por gatilho; transmissão foi escrita pelo
                             # cliente do outro lado e chega crua. Um `x`
                             # que não é número vira NaN na matriz do
                             # boneco, e objeto com matriz NaN NÃO APARECE —
                             # a mesma armadilha que o handoff documenta
                             # para as instâncias. `limparRecado` DESCARTA
                             # em vez de consertar, e a linha que importa é
                             # `Number.isFinite` sobre o valor CRU: um
                             # `Number(carga.z)` antes inventaria a
                             # coordenada, porque `Number(null)`,
                             # `Number("")` e `Number([])` são todos ZERO —
                             # um lugar legítimo no meio da clareira, onde o
                             # corpo apareceria plantado com toda a
                             # naturalidade. Cada recusa tem par CONTROLE:
                             # sem o recado bom passando ao lado do torto,
                             # um `limparRecado` que devolvesse null sempre
                             # passaria em tudo e o mundo ficaria
                             # permanentemente vazio, com os testes verdes
node web/js/floresta.test.mjs # 28 testes do MUNDO ANDÁVEL EM 3D (three.js). O
                             # Mundo é tela de JOGADOR desde 31/08/2026 —
                             # por isso o teste cobra `requireLogin` (e a
                             # AUSÊNCIA de `requireAdmin` no import, porque
                             # a palavra aparece em comentário e varredura
                             # que grita à toa deixa de ser lida), o botão
                             # na home (sem ele a única porta some, já que a
                             # Área de Teste é de admin) e o `Esc` voltando
                             # para a home com o painel vindo ANTES.
                             # Mundo se julga OLHANDO, então este
                             # arquivo guarda só o que erra CALADO — e a
                             # decisão que manda é a ALTURA DO CHÃO ser uma
                             # função pura com DOIS leitores: a malha do
                             # terreno, que desloca cada vértice, e o loop, que
                             # põe os pés do jogador. Duas contas parecidas mas
                             # diferentes dão um boneco flutuando um palmo
                             # acima da grama, ou enterrado até o joelho,
                             # conforme o pedaço do mapa — e o jogo roda igual.
                             # Por isso tudo que é plantado guarda o `y` que
                             # veio de `alturaDoChao`, e o teste cobra isso
                             # carta a carta.
                             # As outras: a VAGA em cima de um tronco (um
                             # adversário impossível de alcançar — a mesma
                             # armadilha que `buildMap()` já documenta no mundo
                             # 2D, lá sem teste), a floresta que precisa ser
                             # DETERMINÍSTICA (ruído sorteado por boot faz todo
                             # relato de bug deixar de ser reproduzível), o
                             # colisor do tamanho errado (copa inteira vira
                             # parede invisível a três metros da árvore; zero
                             # deixa atravessar o tronco), e a PAREDE do mundo
                             # — sem ela sai-se andando para o vazio, a névoa
                             # esconde que o chão acabou, e nada acusa.
                             # A segunda metade prova o que teste de lógica
                             # normalmente não alcança: que o **three
                             # vendorizado carrega** e que a cena monta
                             # inteira. `three` roda em Node menos o
                             # `WebGLRenderer`, e é por isso que `floresta3d.js`
                             # e `boneco3d.js` não encostam em DOM — a
                             # renderização fica sozinha em `mundo3d.js`. Ali
                             # ele mede o que some sem erro: contagem de
                             # instâncias contra o mapa, NaN em matriz de
                             # instância (a árvore simplesmente não aparece), o
                             # `frustumCulled` de um InstancedMesh (a esfera de
                             # recorte sai da GEOMETRIA — uma árvore na origem
                             # —, então a floresta inteira some conforme a
                             # câmera aponta), e o boneco olhando para +Z, que
                             # é o contrato do `atan2(dx, dz)` de quem o gira:
                             # montado ao contrário, todo duelista fica de
                             # costas para quem chega.
                             # O último é o mais teimoso: a página mostra o
                             # aviso de "sem WebGL" e dá `throw` para parar a
                             # corrente de `await`, e o `bootguard` cobriria o
                             # aviso com a faixa genérica se a frase não casasse
                             # com o `DE_PROPOSITO` dele — que é LIDO de lá, não
                             # copiado
node web/js/cenario.test.mjs # 27 testes do CENÁRIO — a construção modelada que o
                             # Mundo põe na clareira (hoje o dormitório Osiris
                             # Red, extraído do Tag Force por
                             # `tools/tagforce/mapa.mjs`). Três decisões, todas
                             # caladas: VALIDAR (um pacote torto não dá erro, ele
                             # DESENHA — meia malha na tela passa por malha
                             # inteira, então a recusa é com MOTIVO e cada motivo
                             # tem o caso que o dispara), ASSENTAR (errar o `y`
                             # deixa o cenário enterrado ou flutuando, e o jogo
                             # roda igual) e COLIDIR.
                             # A colisão é a que mais erra: ela sai da própria
                             # malha, por CÉLULA, e o teste pegou o defeito antes
                             # de existir tela — eu carimbava a célula onde o
                             # VÉRTICE cai na faixa de altura, e uma parede de
                             # piso a teto tem os vértices em y=0 e y=3, os DOIS
                             # fora dela. A parede inteira deixava de barrar, que
                             # é o caso mais comum que existe. Hoje o teste é de
                             # CRUZAMENTO, e as arestas são andadas em
                             # meia-célula (só os vértices deixariam vão no meio
                             # de uma parede de 8 m). Cobre também o par CONTROLE
                             # do telhado, e o raio ser a meia-diagonal — menos
                             # que isso abre furo e se atravessa a parede na
                             # diagonal
node web/js/pecasbase.test.mjs # 26 testes das PEÇAS BASE (árvore, pedra, chão)
                             # e da GAVETA agrupada do Editor de Cena. Elas são
                             # geometria, e geometria erra CALADA: sem `color`
                             # no vértice a peça sai BRANCA, sem `normal` sai
                             # PRETA, e uma malha centrada na origem nasce com
                             # metade ENTERRADA — foi o que o teste pegou na
                             # pedra, com a base em y = −0,48.
                             # A dimensão é MEDIDA da geometria e conferida
                             # contra ela: é por esse número que se decide se a
                             # peça cabe, e escrevê-lo à mão faz a gaveta mentir
                             # sobre o tamanho no dia em que a forma mudar.
                             # Do lado da gaveta: o grupo do Tag Force nasce
                             # FECHADO (142 peças contra uma dúzia de base) e
                             # BUSCANDO tudo abre — resultado dentro de seção
                             # fechada não aparece, e a busca parece quebrada
node web/js/cena.test.mjs    # 102 testes da CENA — o arranjo de peças que o
                             # Editor de Cena monta. Cena é dado que ENVELHECE:
                             # gravada hoje, lida daqui a meses, contra uma
                             # biblioteca que mudou. Três defeitos nascem disso
                             # e nenhum dá erro. Número torto vira NaN na matriz
                             # e **objeto com matriz NaN não aparece** — por
                             # isso a leitura DESCARTA em vez de converter:
                             # `Number(null)` é 0, um lugar legítimo no meio do
                             # mapa, onde a peça apareceria plantada com toda a
                             # naturalidade. Peça que sumiu da biblioteca é
                             # problema DIFERENTE de item torto e sai separada
                             # (`faltando`): derrubar a cena por causa de uma
                             # peça renomeada apagaria o trabalho todo. E
                             # escala 0 some, escala negativa nasce do avesso
                             # (faces para dentro, invisíveis no culling) —
                             # limitada, não descartada, porque quem digitou 0
                             # quis dizer "pequena".
                             # Guarda também o ciclo: o que o editor grava tem
                             # de voltar igual, sem um item descartado — senão
                             # a cena encolhe a cada salvamento
node web/js/malha.test.mjs   # 11 testes de SUBDIVIDIR e DEFORMAR uma malha
                             # importada. As peças de chão do Tag Force (as
                             # estradas) têm 3 a 8 triângulos: marcá-las como
                             # terreno e deslocar os vértices não produz fenda
                             # nenhuma, porque entre quatro cantos a superfície
                             # é um plano e o buraco não tem onde existir. Os
                             # testes guardam o teto (cada passe DOBRA a
                             # contagem), o `uv` que tem de vir junto (sem ele
                             # a textura embola e parece erro do extrator), e o
                             # NaN, que faz o objeto inteiro sumir sem erro
node web/js/personagens.test.mjs # 21 testes de QUEM É O SEU CORPO no Mundo. O
                             # pacote Kenney tem dezoito personagens de
                             # geometria IDÊNTICA que diferem só pela TEXTURA —
                             # então um personagem custa ZERO byte no game.zip:
                             # a variante é pintada no navegador, girando o
                             # matiz da textura que já viaja.
                             # A decisão que o teste guarda é o piso: eu ia
                             # separar pele de camisa por SATURAÇÃO do HSL, e a
                             # pele tem saturação 0,78 — tão "saturada" quanto a
                             # camisa, porque o `s` do HSL é relativo à distância
                             # de 0,5 de luminosidade e pele clara mora perto do
                             # topo. Por CROMA (max−min) a conta se separa
                             # sozinha: pele 0,31, camisa 0,56, calça 0,45,
                             # cabelo 0,05. O piso de saturação teria despintado
                             # o ROSTO de todo personagem, e nada acusaria.
                             # O par CONTROLE é o piso em zero, onde a pele TEM
                             # de mudar — senão uma tinta que não pintasse nada
                             # passaria em tudo

node tools/bancada-cena.mjs  # gera bancada-cena.html na raiz: o EDITOR DE CENA
                             # com as peças de verdade embutidas, sem servidor
                             # e sem login. Existe porque "dá para montar um
                             # lugar movendo peças?" não é pergunta que teste de
                             # lógica responda. Já pagou por si: a checagem do
                             # JS embutido pegou uma colisão de nome que abriria
                             # a página preta e muda

node tools/bancada-visual.mjs # gera bancada.html na raiz: as animacoes da mesa
                             # (seta de ataque, numero de dano/cura, brilho de
                             # entrada em campo, a VIRADA da carta em campo e a
                             # FAIXA DA BATALHA — os tres
                             # passos do ataque, a frase de quem ataca quem e os
                             # dois numeros do calculo) rodando num quadro de
                             # mentira,
                             # sem servidor e sem login — dois cliques no
                             # arquivo. As funcoes sao FATIADAS do duel.html por
                             # marcadores, nunca copiadas: uma copia passaria a
                             # valer por si e deixaria de provar o que esta' no
                             # jogo. Existe porque mudanca VISUAL nao se prova em
                             # teste de logica — a seta foi publicada invisivel
                             # com 13 testes de geometria passando
                             # (o mesmo vale para a VIRADA da carta em campo: a
                             # decisao "este `pos` abriu alguma coisa?" e a
                             # geometria do giro erram as duas em silencio — a
                             # frente sem o `rotateY(180deg)` faz a carta abrir no
                             # proprio VERSO, e o `rotate(90deg)` de um monstro
                             # deitado, morando no mesmo elemento do giro, gira
                             # tambem o eixo Y e a carta capota de lado em vez de
                             # levantar. A virada e a MESMA cerimonia do drop e do
                             # pacote (`revelacao.css`) — mesma curva, mesmo tempo —,
                             # e ninguem compara dois gestos lendo dois arquivos de
                             # CSS)
                             # Cobre tambem a MIRA — a seta da escolha do alvo
                             # seguindo o mouse. Ali o que erra calado e o CSS: as
                             # animacoes de ENTRADA da seta reiniciam a cada
                             # movimento do ponteiro, e o resultado e uma seta
                             # piscando que nenhum teste de logica ve. A DECISAO
                             # (quais alvos, lida do motor) fica de fora de
                             # proposito: ela nao desenha nada.
                             # E a INVESTIDA, que e o unico gesto do ataque em
                             # que uma CARTA se move — e a que so se julga
                             # OLHANDO, porque o que ela erra e uma distancia.
                             # Ela ia CENTRO A CENTRO ate o alvo: o fantasma tem
                             # o tamanho de uma carta, entao pousava em cima da
                             # carta atacada, cobria-a por um terco de segundo e
                             # voltava para a zona de quem atacou. Quem olhava a
                             # carta atacada via uma carta sair de cima dela e ir
                             # embora — e, com o NPC atacando, "ir embora" e para
                             # CIMA, na direcao da mao dele: o relato foi "o card
                             # alvejado vai pra mao do oponente", sobre uma carta
                             # que nunca saiu do lugar (nenhum evento move o alvo
                             # de uma batalha; o estado sempre esteve certo).
                             # Hoje e um avanco curto, com TETO em pixels — as
                             # duas fileiras de monstro sao vizinhas, entao uma
                             # fracao sozinha ja bastaria para cobrir o alvo.
                             # Quem diz que houve colisao passou a ser so o
                             # tremor do alvo (`fx-hit`, hoje tambem fatiado
                             # daqui), os dois numeros da faixa e o dano voando
                             # ate os LP — nenhum deles mexe na carta atacada

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
```

## Arquitetura do front

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

> **O que o jogo ENTREGA, o jogo ACEITA** (migration 0048). O Booster Builder
> monta do banco INTEIRO, não do pool da lista, e nada impede pôr num booster
> uma carta que a Lista 1 não conhece. O estrago era silencioso e caro: o
> jogador paga DP, abre a carta, ela entra na Coleção e aparece no Deck
> Builder; só na hora de **salvar** o deck é que `salvar_deck` dizia "não está
> na lista permitida".
>
> A resposta era um relatório (`npm run boosters:check`) e a disciplina de
> rodá-lo — e não funcionou: no dia da 0048 havia **10 cartas** obteníveis e
> injogáveis no banco, nove delas dos pacotes de NPC (Shifting Shadows, Dark
> Factory of More Production, Multiplication of Ants, Insect Neglect…). O
> jogador vencia o Panik, ganhava a carta e não montava deck com ela.
>
> Hoje é INVARIANTE, não tarefa: `lista_ativa()` devolve a lista publicada
> **mais** `cartas_obteniveis()` — os ids que aparecem em qualquer booster,
> Deck Estrutural ou pool de drop de NPC. Acrescentar a carta em qualquer uma
> das três portas já a faz contar na lista, sem passo nenhum.
>
> **Calculada na leitura, nunca gravada.** Materializá-la dentro de
> `conteudo/lista1` criaria estado que envelhece — e que o próximo "salvar" do
> editor de listas apagaria, porque ele republica o array resolvido inteiro.
> Assim ela é auto-curativa: tirar a carta do booster tira da lista no mesmo
> instante. E ela **não entra na FONTE** (`conteudo/cardlists`, o que o editor
> edita): lá ficam só as escolhas de quem administra, senão a carta viraria
> escolha à mão e sair do booster deixaria de tirá-la da lista.
>
> **Uma implementação só.** A tela não refaz a conta — ela LÊ
> `rpc/cartas_obteniveis` (`hydrateCardLists`, em `cardlists.js`) e alimenta
> `inLista1`. Uma segunda conta no navegador divergiria em silêncio da que
> `salvar_deck` usa, e o sintoma seria o pior tipo: o Deck Builder deixando
> montar e o banco recusando salvar, cada tela certa pela sua conta.
>
> Antes de pôr uma carta nova numa das três portas, confira que o efeito roda
> — é para isso que serve `--test-cartas-booster`. Foi assim que De-Spell,
> Ritual Cage, Birthright e Swing of Memories apareceram vendidas e injogáveis
> a primeira vez.

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

A aba DROPS tem também o **BÔNUS DE PRIMEIRA VITÓRIA** (migration 0050): um
quadro que abre e fecha, com cartas (cada uma com a sua **quantidade**) e uma
lista de **itens** — hoje ícone e Deck Estrutural, e o formato `{tipo, id}` é
aberto de propósito para o próximo tipo ser um `case` a mais, sem migration.

> **É o contrário das gavetas, e por isso não reaproveita a estrutura delas.**
> O pool é a economia CONTÍNUA (sorteio, repetição, e é ela que faz querer
> duelar de novo); o bônus é **fixo, garantido e uma vez só**. Raridade ali
> existe para PESAR o sorteio, e aqui não há sorteio nenhum — daí a quantidade
> por carta em vez de gaveta.
>
> **"Primeira vitória" não custou coluna nova.** `premiar_vitoria` já carimba
> `duelos.premiado_em` e só roda quando o jogador vence, então "é a primeira" é
> *não existe outro duelo meu contra este NPC e este DECK já premiado*. Uma
> coluna `bonus_pago` seria uma segunda verdade sobre o mesmo fato, e as duas se
> desencontrariam no primeiro duelo que falhasse no meio. O `is not distinct
> from` no `deck_npc` não é preciosismo: ele pode ser nulo, e `null = null` é
> falso — o bônus sairia em TODA vitória.
>
> **Ganhar um estrutural conta como compra** (entra em `compras_estruturais`):
> a trava de 1 por conta vale igual no caminho de graça, senão o bônus seria a
> porta dos fundos dela. E a entrega saiu de dentro de `comprar_deck_estrutural`
> para a `entregar_estrutural(uid, id)`, que as duas chamam — copiar o corpo
> criaria duas verdades sobre "receber um estrutural", e a segunda envelheceria
> calada. Ela **nunca levanta exceção**: devolve `null` quando não dá para
> entregar. Quem cobra DP confere antes, com as mensagens boas; quem premia uma
> vitória não pode derrubar a premiação por causa de um item torto.
>
> **Item repetido é pulado em silêncio** e o resto do bônus é entregue —
> vitória nenhuma é negada por causa de um prêmio que a pessoa já tem.
>
> A ORDEM dentro da função é o que quase deu errado: os itens são pagos DEPOIS
> do `update` da carteira, porque a entrega do estrutural credita as cartas dele
> na mesma carteira por conta própria. Fazendo antes, o `update` apagaria o que
> ela acabou de creditar.

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

> **Segurar (ou clicar, ou botão direito) LÊ a carta**, na caixa e no pacote
> recém-aberto — o mesmo gesto do Deck Builder, com o mesmo anel de progresso
> (`wireLongPress`) e a mesma janela (`showCardDetail`). É onde a informação
> decide a compra e a miniatura não cabe: 68px de arte e o nome em 9px não
> dizem o que a carta FAZ. Aqui o CLIQUE abre também, ao contrário do Deck
> Builder — lá ele já tem dono (adicionar uma cópia), e nesta caixa não há o
> que fazer com a carta além de lê-la.
>
> As duas peças chegam de FORA (`aoAmpliar`/`ligarGesto`), porque `gavetas.js`
> e `revelacao.js` são compartilhados: quem carrega o banco de cartas é a tela.
> **A Trilha ainda não liga o gesto** — a caixa dela continua inerte, e é o
> único ponto em que as duas divergem hoje.
>
> Para o detalhe funcionar, a Loja passou a fazer o que o Deck Builder já fazia
> com as CUSTOMIZADAS: `db.addCustom` + `descOf`. Elas não existem no
> `cards.json`, e sem isso a miniatura seguia com o id cru no lugar do nome e a
> janela abria em "(carta não encontrada no banco)".

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

**`web/cardbuilder.html`** (Área de Teste → "Card Builder", 13/09/2026) é o
estágio seguinte: em vez de importar um esqueleto, **cria a carta com efeito**.
Três passos — a ARTE; o TIPO (Monstro Normal/Efeito, Magia e Armadilha com os
subtipos), que já escreve o esqueleto Lua dele (`aux.AddEquipProcedure`,
`Ritual.AddProcGreater`, a ativação que deixa a Contínua na zona,
`EVENT_CHAINING` da Contra-Armadilha); e os EFEITOS — adicionar, comprar,
reviver, destruir, bônus —, cada um com momento, custo, limite por turno, e
"para esta carta ou para outra", com um filtro em OPÇÕES ("raça X **ou** Nível
3–4 com ATK 1000–1800"). O gerador (`web/js/cardbuilder.js`, sem DOM) escreve no
idioma dos scripts oficiais que o motor já roda; a gravação vai para a tabela
`cartas_custom` (migration 0058, `web/js/cardbuilderbanco.js`), com `dados`
como fonte e `lua` como derivado regenerado a cada salvar. Ids em
`950000000–999999999`, separados do import local. O **visual** tem três modos
(`dados.visual`): o layout desenhado pelo builder (`renderFramedCard`), uma
**moldura importada** com a arte e o texto por cima nas proporções da carta
oficial (`renderCardOnFrame`), ou a **carta completa importada**, usada como
está. A imagem importada mora na coluna `imagem` (migration 0059), separada da
`arte`, e quem escolhe entre os três é UMA função (`desenharCarta`, em
`cartasdobuilder.js`) — editor, Deck Builder e duelo passam por ela. O visual
nunca muda o Lua.

Três peças entraram para montar efeitos compostos (o da Multistrike Dragon
Dragias: *descarte Normais Nv5+ com ATK ≤1900 de Tipos diferentes; Invoque esta
carta por Invocação-Especial, então destrua 1 carta no campo; se fizer, ela pode
atacar 2 vezes*): o custo **descartar cartas com filtro** (com "de Tipos
diferentes"), a ação **ataques extras** (`EFFECT_EXTRA_ATTACK`) e o **"e depois,
se isso resolver"** (`ef.depois`, até 3 passos). Com sequência, a escolha de
cartas dos passos é feita NA RESOLUÇÃO, sem alvo — é o "então" do texto
oficial —, e cada passo só roda se o anterior fez alguma coisa, com
`Duel.BreakEffect()` entre eles. O custo "Tipos diferentes" é escrito à mão
(escolhe uma carta, tira as do mesmo Tipo, repete) e não por
`aux.SelectUnselectGroup`: esse usa `Group.Iter`, que a `ocgcore.dll` daqui não
tem.

Na tela, a **ação do efeito é o 1º passo** e os do "e depois" são numerados a
partir do 2º. Não é enfeite: a Dragias foi salva com a Invocação num passo e a
ação principal esquecida no valor padrão ("adicionar outra carta"), então a carta
buscava no Deck antes de tudo. E "Invocar **esta** carta" vale também num passo,
quando o efeito é da carta na mão ou no Cemitério — por isso `alvosDoPasso` e
`ajustarPasso` recebem o MOMENTO do efeito; sem ele, o ajuste trocava "esta" por
"outra" em silêncio ao salvar. O custo **revelar esta carta** (`Cost.SelfReveal`)
entrou pelo mesmo pedido. A Invocação-Especial de OUTRA carta sai do Cemitério
(seu ou de qualquer lado), da mão, do Deck ou das banidas (face para cima):
Cemitério e banidas são ALVO, mão e Deck se escolhem na resolução
(`LUGAR_DA_INVOCACAO`); `origem` desconhecido cai no Cemitério, que era o único
antes. E "adicionar à mão" ganhou **de Tipos diferentes** e **de Atributos
diferentes**, combináveis — a mesma seleção à mão do custo (escolhe, tira as do
mesmo Tipo/Atributo, repete).

**Monstro de Fusão e Monstro de Ritual** entraram como tipos (os efeitos são
opcionais nos dois). Os dois ganham `c:EnableReviveLimit()`; a Fusão, também
`Fusion.AddProcMixN(c,true,true,s.material1,n1,…)` com uma função por material
(`fusao.materiais = [{ qtd, filtros }]`, o mesmo filtro dos efeitos — um id no
filtro é "aquela carta"), e mora no Extra Deck porque o `tl` sai `Fusion/…`. Não
tem efeito "da mão". O Ritual sai pela Magia de Ritual do builder com o id dele.
O `type` do motor é MONSTER|FUSION (ou RITUAL), com EFFECT só se houver efeito —
antes deste ramo a Fusão caía no `else` de magia/armadilha e saía com `type` 4, que
o motor leria como Armadilha.

A **Dragon's Inferno** (Armadilha Contínua, 13/09/2026) trouxe cinco peças, todas
genéricas. A ação **Invocação-Normal sem tributo** existe só no contínuo: é o
`EFFECT_SUMMON_PROC` de campo do Metaphys Factor (`aux.FieldSummonProcTg`), com
`IsLevelAbove(5)` sempre no alvo — sem ele um Nv4 ganharia uma segunda oferta de
Invocação idêntica. A **condição** "se você controlar um monstro … com a face para
cima" (`ef.condicao` + `condicaoFiltros`) SE SOMA à condição que o momento já traz:
a antiga vira `s.condicaobaseN`, porque trocar uma pela outra faria a Armadilha de
ataque ativar sem ataque nenhum. A origem **Deck ou Cemitério**
(`LOCATION_DECK|LOCATION_GRAVE`, `LUGAR_DA_BUSCA`) vale para adicionar e para
baixar. A ação **baixar Magia/Armadilha** é `IsSSetable` + `Duel.SSet`, com "até
N" limitado às zonas livres, e o "de nomes diferentes" é escrito à mão com
`SelectUnselect` — `aux.dncheck` passa por `aux.SelectUnselectGroup` e pelo
`Group.Iter` que a dll não tem. O filtro de "uma destas cartas" é uma OPÇÃO por id.
E o limite **"pelo nome, só este efeito"** é `{id,n}`: o `por-nome` continua sendo
a conta DIVIDIDA entre os efeitos (a Dragias salva no banco depende disso), e o
"Você só pode usar cada efeito de X uma vez por turno" precisa de uma conta por
efeito.

A tela também importa o **`.json` do card maker** (`cartaDoCardmaker`): nome,
tipo/subtipo, os números, o texto COM as quebras (o `strip` do import do Deck
Builder junta os "●" numa linha só) e a arte. Os efeitos não vêm, porque o card
maker não conhece regra nenhuma. A carta importada nasce sem id: salvar cria outra
linha, e nunca sobrescreve a que estava aberta.

**Como a carta chega ao jogo** (`web/js/cartasdobuilder.js`): o Deck Builder e
o `duel.html` leem `cartas_custom` no boot e injetam cada carta no índice
(`addCustom`), com a carta desenhada como arte e o texto no detalhe. O motor
**não lê o Supabase**: o `start()` do duelo manda `customCards` (a linha
`datas` de `dadosDoMotor` + a coluna `lua`) no `/start`, e o `WebServer` só
aceita isso de chamada LOCAL — com `--lan` a 8770 é alcançável pela rede, e Lua
de outro aparelho não pode rodar no motor. Carta do builder que o banco não
devolveu recusa o duelo NA PORTA, com aviso: sem os dados o motor a trataria
como inexistente e ela ficaria muda. O Deck Builder (admin, caminho livre) e a
porta do duelo já aceitam cartas fora da lista para admin, e `iniciar_duelo`
dispensa o admin — por isso a carta é testável sem mexer em lista nenhuma.
**Ainda não cobre** o multiplayer (`startMultiplayer` não manda `customCards`),
a Loja, boosters nem a Coleção de jogador comum. `--test-card-builder` prova o
lado do motor.

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
> registro, então a presença sai por dois caminhos estreitos — o que
> `meus_amigos()` (security definer) devolve **dos seus amigos**, e o número
> agregado de `bater_ponto()`. Conferido: uma conta comum autenticada enxerga 1
> perfil, o dela.

**"Visto por último"** (migration 0049). `meus_amigos()` passou a devolver
também o `visto_em` cru, e não só o booleano `online` — a lateral dizia OFFLINE
para quase todo mundo quase o tempo todo, sem separar quem fechou o jogo há
cinco minutos de quem não entra há três semanas, que são decisões diferentes na
hora de chamar para duelar, mandar mensagem ou remover alguém. Aparece no
**tooltip** do amigo na lista e como uma linha no **cartão** que o clique abre.

> Isto ALARGA a presença de propósito: antes saía um booleano, agora sai o
> instante. Continua valendo só para quem é **amigo** (a função junta por
> `amizades`) — `buscar_jogador` não devolve isto e a policy de `perfis` segue
> fechada.

> **A frase é do cliente, o carimbo é do servidor** (`web/js/vistoem.js`, sem
> DOM e com teste). Calcular a presença no navegador é o defeito que fez o
> `online` nascer no banco — dois relógios discordando, cada um certo pela sua
> conta —, e um "há 3 dias" medido localmente erra do mesmo jeito, com o erro
> crescendo em vez de expirar. O que o cliente faz é só traduzir o instante para
> a hora LOCAL de quem lê. Erra calado de três jeitos: carimbo ausente (servidor
> anterior à 0049) vira `null`, e não a frase "Invalid Date" na tela; "ontem" é
> dia de CALENDÁRIO, não 24 horas (às 00:30, 23:50 foi ontem, e uma conta por
> milissegundos diria "hoje"); e a conta entre meias-noites locais atravessa
> horário de verão sem escorregar um dia.

> **Quem está ONLINE não ganha a frase na lista**, só no cartão: o carimbo dele
> é de no máximo dois minutos atrás, e a lateral é estreita — uma segunda linha
> por amigo empurraria para fora da tela justamente os que estão online, que vêm
> primeiro na ordem.

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

### O MUNDO — a floresta 3D onde os jogadores se encontram (31/08/2026)

`web/mundo3d.html` é uma floresta em three.js, com câmera de terceira pessoa e
WASD, onde se anda e **se vê quem mais está andando**. `Esc` volta para a home.

> **Ele SAIU do menu da home em 08/09/2026, e a porta voltou a ser a Área de
> Teste.** Foi a opção **5** do menu (no lugar do Multiplayer) entre 31/08 e
> 08/09. Duas coisas o tiraram de lá: um mundo **sem interação nenhuma** não
> se sustenta como uma das cinco opções que o jogador tem à frente, e o que
> nasceu dele com pernas próprias — o **Editor de Cena** — virou **projeto à
> parte** (`three_js_scene_editor`, fora deste repositório), onde é o produto
> em vez de uma ferramenta escondida.
>
> A tela continua **inteira** e continua pedindo só `requireLogin`, não
> `requireAdmin`: quem guarda a porta é o `teste.html`, que é de admin.
> Devolver o `requireAdmin` para cá faria a tela abrir, piscar e mandar de
> volta quem chegasse por um link salvo. `floresta.test.mjs` guarda as duas
> metades — o botão não pode voltar sozinho à home, e a Área de Teste não pode
> perder o atalho, porque é a última porta que sobrou.

Ele nasceu como prova de conceito do mundo andável (ao lado de `cidade.html`),
com os duelistas de `npcs.js` esperando na clareira. Hoje é outra coisa: um
lugar de ENCONTRO, e **sem interação nenhuma** — não há duelo, conversa,
esbarrão nem colisão entre pessoas. Você vê os outros caminhando, e é isso.

> **Os NPCs estão DESLIGADOS** (`NPCS_NO_MUNDO`, em `mundo3d.js`). Duas
> razões, e a segunda é a que pesa: um duelista de máquina parado aqui
> responde a outra pergunta — a de "contra quem eu jogo", que é da **Trilha de
> Duelos** —, e tê-lo aqui abriria a porta que a Trilha fecha, porque esta
> tela mostra TODOS os adversários cadastrados, sem cadeado nenhum. É
> exatamente o furo que mandou `adversario.html` e `cidade.html` para a Área
> de Teste. A máquina de habitantes serve aos dois: ligar de volta é mudar
> aquela linha, e nada abaixo precisa saber a diferença — o que está
> desligado continua exercitado pelo mesmo código que desenha as pessoas.

> **O Multiplayer não foi removido — só saiu do menu.** `web/multiplayer.html`
> continua inteiro e continua sendo o caminho do duelo entre pessoas; quem
> desafia chega lá pelo cartão do amigo, na lateral da home, que é de onde o
> convite parte de qualquer jeito (ver `desafiar`, em `index.html`: quem
> desafia precisa entrar no duelo no instante em que o outro aceita, e essa
> espera só existe lá).

> **O FIM da partida chega pela ponte, e ele é uma coisa só para os dois.**
> O relato: *"quando a battle e' vencida por um jogador a batalha deve encerrar
> e ambos devem ser redirecionados pra Home. Inclusive se um player desistir o
> outro tbm... Hoje a sala fica aberta e o duelo n encerra"*. Quem desistia
> fechava a partida no banco e ia embora; o adversário ficava com o tabuleiro na
> tela, pesquisando lances de uma partida encerrada, para sempre. Hoje o
> servidor escreve a notícia no mesmo canal das jogadas (`lances.tipo = 'fim'`,
> migration 0056), `abrirPonte` a entrega no callback `aoEncerrar`, e
> `fimPelaSala` (em `duel.html`) mostra o quadro com quem venceu e **uma** saída:
> [voltar para a home]. Três coisas seguram isso de pé, e nenhuma é opcional:
>
> - **`fimPelaSala` espera `filaVisoes.drenar()`.** O aviso vem logo atrás da
>   visão do golpe final, que ainda está sendo ANIMADA — mostrar o quadro na
>   frente dela cortaria o último ataque no meio, e o perdedor leria "você
>   perdeu" sem ter visto por quê;
> - **`ended` manda.** No fim normal os dois lados veem o `end` do motor e já
>   mostram o quadro sozinhos; `fimPelaSala` é só para quando o fim NÃO veio
>   pelo tabuleiro. Sem essa guarda, o quadro apareceria duas vezes;
> - **a ponte se FECHA no fim.** Ela pesquisa o banco a cada 900 ms enquanto
>   viver, e uma tela de fim com um laço de rede atrás dela era, literalmente, o
>   duelo que "não encerrava". Vale para a vitória, para a desistência e para o
>   aviso vindo de fora.
>
> A conta de "venci ou perdi" mora em `desfechoDoFim` (`ponte.js`), fora da
> tela e provada em Node: ela compara `partidas.vencedor` com `sala.meuId`, e
> errá-la mostra a tela do VENCEDOR para quem perdeu, sem erro nenhum aparecer.
> A ponte ainda confere `partidas.estado` a cada 5 voltas — rede embaixo do
> caminho rápido, para o fim escrito por fora (o SQL Editor, o "estou preso" do
> outro). O que ela NÃO cobre é a aba fechada no meio do duelo: ali ninguém
> encerrou nada, e encerrar no `pagehide` transformaria um F5 em derrota.

> **A tela deixou de ser de admin.** Ela chama `requireLogin`, e não
> `requireAdmin`: com a porta na home, exigir admin faria a tela abrir,
> piscar e mandar todo jogador comum de volta — o menu prometendo um lugar
> onde ninguém entra. Os dois atalhos de Área de Teste da barra (`mundo 2D`,
> `← área de teste`) nascem `hidden` e só aparecem quando o SERVIDOR diz que
> o perfil é admin, como o botão "⚙ Área de Teste" da home. A tela continua
> listada na Área de Teste também.

#### Customizar o personagem (`web/js/aparencia.js` + migration 0054)

Cada jogador escolhe **cabelo, blusa, calça, calçado e cor da pele** numa
gaveta lateral do próprio Mundo (tecla **V**), vendo o boneco de perto e
girando-o com o mouse. A **cor é livre**; a **forma** é o que se compra: cada
peça paga é uma linha em `itens` (0051), com os tipos novos `cabelo`, `roupa`,
`calca` e `sapato`.

> **O CÓDIGO diz o que existe; o BANCO diz o que se vende.** Um ícone de
> perfil é um PNG numa coluna — o banco o inventa sozinho. Uma peça de roupa é
> GEOMETRIA, e geometria mora em `boneco3d.js`: uma peça que o código não sabe
> construir não existe, por mais linhas que tenha no banco. `PECAS` (em
> `aparencia.js`) diz quais peças existem, `boneco3d.js` diz qual é a forma, e
> `itens` diz o preço e quem tem. O cruzamento das duas primeiras é o que
> nenhum código faz em tempo de execução, e por isso tem varredura.

> **A posse é uma frase, escrita duas vezes de propósito:** *"se a peça está no
> catálogo de venda, você precisa tê-la; se não está, é de graça"*. O cliente a
> aplica para saber o que OFERECER; o gatilho `perfis_aparencia_valida` (0054)
> para saber o que ACEITAR — e a segunda é a que vale, porque a policy de
> `perfis` deixa o dono escrever na própria linha e um `PATCH` direto vestiria
> o cosmético mais caro da loja de graça. É o mesmo furo que a 0035 tinha e a
> 0036 fechou para o ícone, e a resposta é a mesma: um gatilho cuja regra é do
> **dono da linha**, e não de quem está escrevendo.

> **Nenhuma lista de peças gratuitas existe em lugar nenhum.** Grátis é a
> ausência em `itens`, o que faz um admin pôr uma peça à venda (ou tirá-la) sem
> ninguém editar código dos dois lados. Uma lista aqui e outra no SQL se
> desencontrariam na primeira peça nova, e o sintoma seria a tela deixar vestir
> e o banco recusar o salvamento inteiro.

> **O id da peça é o id do ITEM** (`cabelo-moicano`), e não um nome curto que
> alguém prefixa. O gatilho procura `value->>'peca'` direto em `itens.id`;
> montar o id nos dois lados seria a mesma regra escrita duas vezes, e no dia
> em que o JS e o SQL discordassem sobre um hífen todo mundo passaria a vestir
> de graça, em silêncio.

> **Quem nunca abriu o vestiário mantém a cara que já tinha.** `padraoDe(id)`
> cai em `coresPara(id)` — a mesma função do mundo 2D e dos adversários —, então
> a customização entrou sem transformar o Mundo numa fileira de clones, e sem
> migrar dado nenhum.

> **A geometria é COMPARTILHADA e nunca descartada.** São ~20 formas no jogo
> inteiro contra um `Group` novo por pessoa que entra na floresta, então elas
> ficam num cache por chave e `descartar()` solta só os materiais, que são os
> que carregam a cor. Descartar a geometria compartilhada apagaria a peça do
> PRÓXIMO boneco, muito depois, com a causa a dez minutos de distância.

> **A gaveta não é modal.** No único momento em que o que importa é ver o
> boneco, um vidro por cima seria escolher às cegas — a mesma decisão da MIRA do
> ataque em `duel.html`. Ela ocupa a direita, a câmera se aproxima e empurra o
> olhar para a esquerda (deslocando o ALVO, não a projeção), e o canvas continua
> recebendo o arrastar, que é como se vê o boneco de trás.

> **O caminho para modelos de verdade é uma TROCA, não uma reescrita.** Cada
> peça é uma fábrica de geometria em `boneco3d.js` que devolve uma lista de
> partes. No dia em que houver `.glb`, a fábrica passa a devolver nós
> carregados — e nem o vestiário, nem a posse, nem o banco, nem a rede sabem a
> diferença. Foi por isso que o sistema veio antes da arte.

#### Ver as outras pessoas (`web/js/mundovivo.js`)

As posições viajam por **transmissão** (o `broadcast` do Realtime, cliente a
cliente), e não por tabela: uma posição vale 120 ms, e gravá-la seria escrever
no banco oito vezes por segundo por pessoa para guardar um dado que já nasceu
velho — mais o WAL, a replicação e a policy de leitura.

> **Isto NÃO substitui `presenca.js`.** Aquilo responde *"quem está jogando
> agora"*, o BANCO decide, e é o que a lista de amigos e o contador da home
> leem; o Mundo bate ponto como o Multiplayer e o duelo batem. Isto responde
> *"quem está nesta floresta, nesta coordenada, neste instante"*, e some junto
> com a aba. Perguntas diferentes, prazos diferentes.

`realtime.js` ganhou a **segunda face** para isso: `ouvirTransmissoes`, ao lado
de `ouvirMudancas`. As duas dividem UMA canalização (`abrirCanal`, privada) —
reconexão com espera dobrada, heartbeat, renovação de token e a hora exata em
que o canal está de pé são o que erra calado, e é por isso que não podem
existir em duas cópias.

> **A marca de "o canal subiu" mudou de forma.** Ela era a presença de
> `postgres_changes` na resposta do join — o que separa o reply do join do
> reply da renovação de token. Um canal só de transmissão não pede tabela
> nenhuma e pode responder sem essa chave, então quem chama diz o que pediu
> (`esperaTabelas`). Assumir que ela sempre vem faria o canal do Mundo nunca
> se declarar de pé; assumir que nunca vem faria o canal das notificações
> tratar cada renovação de token como um join novo. As duas erram caladas, em
> direções opostas.

> **Transmissão não é linha de tabela, e NADA a valida.** Ela foi escrita pelo
> cliente do outro lado: não passou por policy, por gatilho nem por tipo de
> coluna. Por isso tudo passa por `limparRecado`, que **descarta** em vez de
> consertar — palpite sobre dado torto é corpo no lugar errado, pior que corpo
> nenhum. E a conferência é `Number.isFinite` sobre o valor CRU: converter
> antes inventaria coordenada, porque `Number(null)`, `Number("")` e
> `Number([])` são todos **0**, um lugar legítimo no meio da clareira.

> **O recado carrega COORDENADA, e nada de identidade** — e isso MUDOU em
> 31/08/2026. O nome viajava aqui, dito pelo cliente que o mandava, e este
> documento registrava como limite conhecido que *"no dia em que houver
> interação, o nome tem de passar a vir do servidor, senão a etiqueta vira
> credencial"*. Esse dia foi a roupa comprável: apresentação que o cliente
> escolhe sozinho **é** uma credencial. Hoje quem responde "quem é este e o que
> ele veste" é a `rpc/aparencias` (0054) — uma porta estreita que devolve nome
> e aparência e nada mais do perfil —, e `limparRecado` não tem mais campo de
> nome nenhum, em vez de ter um que ninguém lê: campo que existe é campo que
> alguém volta a usar.

> **A colisão é contra a FLORESTA, nunca contra as outras pessoas.** Sem dono,
> dois clientes empurrando o mesmo corpo discordariam sobre onde ele parou, e
> cada tela ficaria certa pela sua conta. Atravessar é a escolha honesta
> enquanto não houver interação nenhuma aqui.

> **O relógio é o do LAÇO, e não um `setInterval`.** Uma aba escondida tem os
> timers estrangulados (cai para um por minuto, bem mais que o `SUMICO_MS`),
> então o comportamento fica honesto: aba escondida para de dar notícia, o
> corpo sai da tela dos outros (a pessoa não está mais olhando o mundo mesmo),
> e voltar para a aba a repõe no quadro seguinte, sozinho.

> **O selo de estado do canal não é enfeite.** "Não tem ninguém aqui" e "não
> consegui ligar" são a MESMA floresta vazia na tela, e a primeira conclusão
> de quem abre um mundo deserto é que a feature não funciona. Daí o `#vivo` e
> o `#quantos` na barra.

> **`criarBoneco` ganhou `descartar()`.** As pessoas ENTRAM E SAEM o tempo
> todo, e cada uma é um `Group` de treze geometrias e sete materiais.
> `scene.remove()` tira do grafo e **não** devolve nada à GPU — o navegador
> não coleta buffer de vídeo por alcançabilidade. Numa sessão longa a memória
> sobe até o contexto de WebGL se perder, e a tela apaga sem um erro que
> aponte para lá.

#### O CENÁRIO: uma construção modelada na clareira (06/09/2026)

A floresta continua gerada em código; dentro dela, na clareira, entra um pedaço
de mundo **modelado** — hoje o **dormitório Osiris Red**, extraído do ISO do
Tag Force por `tools/tagforce/mapa.mjs`. `cenario.js` decide (valida, assenta,
gera colisão), `cenario3d.js` desenha, `mundo3d.js` amarra.

> **DESLIGADO por padrão** (`CENARIO_PADRAO = null`), e isto reverteu uma
> decisão de um dia antes. Ele nasceu ligado, com o argumento de que um mundo
> que muda conforme o console de cada um não é lugar de encontro — o argumento
> continua de pé e ficou irrelevante: *"o mundo que tem hoje (o dormitório)
> está bugado"*, e **o Mundo é a floresta, que funciona**.
>
> Ligar é `localStorage['ygo:cenario'] = '<nome>'`, e isso não é código morto:
> é o caminho de quem DESENVOLVE um cenário. Desligado ele não paga nem o 404
> (`nomeDoCenario` responde `null` antes da requisição), e nome fora da forma
> de slug vira `null` em vez de virar URL.
>
> **O `web/cenarios/dormitorio.json` saiu do repositório** — 557 KB viajando no
> `game.zip` para uma feature desligada. Volta com um comando:
> `node tools/tagforce/mapa.mjs <arquivo.ehp> --nome dormitorio`.

> **Quando um cenário voltar, ele viaja no `game.zip`** (`web/cenarios/`), e não
> em `store/`, que o Release não leva — bom para provar, inútil para publicar.
> Ver a decisão sobre asset da Konami no `tools/tagforce/README.md`.
>
> **O caminho dali para a frente é o Editor de Cena**, e não outro mapa
> importado inteiro: um cenário montado peça a peça é arrumável, e o mapa
> monolítico só dá para aceitar ou recusar.

> **A geometria é arredondada na EXPORTAÇÃO, e não é economia:** é parar de
> imprimir dígito que não existe. A posição sai de um `int16` sobre uma caixa de
> ~23 unidades (resolução ≈ 0,00036), e o `JSON.stringify` escrevia
> `0.000019074068422497703` — 23 caracteres de ruído de ponto flutuante para um
> número com três casas de informação. O pacote caiu de 1.078 KB para 557 KB.

> **A colisão sai da MALHA, em círculos** — os mesmos que barram as árvores. Ela
> tem duas armadilhas caladas, e as duas estão em `cenario.test.mjs`: a faixa de
> altura decide por CRUZAMENTO e não por pertencimento (uma parede de piso a
> teto tem os vértices fora da faixa, e perguntar "o vértice está nela?" faz a
> parede inteira parar de barrar), e o raio é a meia-diagonal da célula (menos
> que isso abre furo e se atravessa a parede na diagonal).

> **A ENTRADA nunca é bloqueada.** O dormitório tem 23 m de fundo e a clareira
> 26 de diâmetro: a pegada dele passa por cima de onde o jogador nasce. Nascer
> dentro de um colisor não é "difícil de sair" — `livre()` é falso na volta
> inteira e não se anda para lado nenhum. O Mundo abriria com o boneco imóvel,
> indistinguível de travado.

#### O EDITOR DE CENA (`web/cena.html`, Área de Teste, 06/09/2026)

Montar um lugar **movendo peças 3D**: clicar numa peça da gaveta, clicar no
chão, arrastar até o lugar, girar, redimensionar, salvar. `cena.js` decide (o
que é um item válido, o que é uma cena legível) e tem 25 testes;
`cenaeditor.js` monta a malha; `cenapagina.js` responde ao mouse. A mesma
divisão de `boards.js`/`campoeditor.js`, o editor de tabuleiro.

> **Sem física e sem desfazer — ainda de propósito.** A primeira versão
> respondeu à pergunta que importava (*dá para montar um lugar movendo peças?*),
> e o que entrou depois entrou por uso, não por antecipação.

**GRUDAR NA GRADE** (`grudar`/`passoDe`, em `cena.js`). O passo é escolhido na
tela (livre · 0,25 · 0,5 · 1 · 2 · 4 m), e **a peça com `modulo` gruda no
tamanho DELA** — as placas de chão declaram 4 m e 12 m.

> O módulo vence o passo do editor **inclusive no modo livre**: quem escolheu
> "livre" quer liberdade para a árvore, não para o ladrilho. Com o passo de 1 m
> dá para pôr uma placa de 4 em `x=0` e outra em `x=3`: elas se cruzam, e a
> costura no chão só aparece quando a câmera passa por cima. **O fantasma gruda
> junto** — prévia que desliza livre mente sobre o próprio clique.

**ALTURA E POUSO.** `Shift`+arrastar sobe e desce (é assim que se faz uma
montanha), `W`/`S` ajustam pelo teclado, e **`F` assenta** a peça no topo do que
estiver embaixo — ou no chão, se não houver nada.

> **`assentar` SOBE**, e isso é a feature: o caso principal é a pedra posta no
> chão, dentro da montanha, indo para o topo. Um teto de subida a deixaria
> enterrada — que é exatamente o que o pedido existe para resolver.

> A conta é de CAIXA e não de raycast (`alturaDePouso`): o raio atravessa o vão
> entre as bolhas da copa de uma árvore e a peça afundaria até o tronco, com a
> malha inteira paga para errar. E ela **ignora a si mesma**, senão a peça sobe
> um andar a cada tecla.

**`Ctrl`+roda muda o TAMANHO** — da peça selecionada, ou do fantasma quando se
está pondo (ajustar antes é o gesto de quem vai deixar dez cópias iguais).

> O `preventDefault` vem ANTES de qualquer ramo: com `Ctrl`, a roda é o zoom do
> NAVEGADOR, e deixá-lo passar aumentaria a página inteira — com o canvas
> esticando junto, que é pior que não fazer nada.

**RELEVO** (`R`, ou o botão): arrastar no chão esculpe. O seletor ao lado diz o
que o pincel faz — **levantar**, **cavar** (a fenda) ou **aplainar** —, e
`Shift` inverte os dois primeiros. É como se faz um morro sem empilhar peça.

> **O modo explícito não é conforto: sem ele o cavar não existia na prática.**
> Ele só morava no `Shift`, e o `Shift` é o gesto de quem já está com a mão no
> mouse levantando — quem senta para cavar um vale inteiro não segura tecla por
> um minuto. O relato foi *"só cria relevo alto"*, com o código do `Shift`
> ligado e correto.

> **A pincelada se ANCORA na altura em que começou** (`planoDoPincel`). Mirar na
> malha viva a cada movimento parece mais certo e é instável: a superfície sob o
> cursor muda, o raio passa a encontrá-la noutro ponto, e o pincel anda sozinho.
> E anda de forma ASSIMÉTRICA — cavando, o ponto foge para longe da câmera (o
> raio atravessa mais fundo antes de bater) e o buraco vira um risco comprido e
> raso indo embora do cursor; levantando, o ponto vem para perto e o efeito se
> contém. Era a outra metade do "só cria morro". O primeiro toque ainda lê o
> terreno de verdade (`miraNoTerreno`), senão a pincelada num morro de 6 m cai
> metros atrás do que se está vendo.

> **A grade do relevo é o TETO da finura, e nenhum pincel a contorna.** Com
> `PASSO_RELEVO = 4` o menor acidente possível tinha 8 m de boca — um vale,
> nunca uma greta. Hoje são **2 m** (mínimo de 4 m de boca), e há pincel de 2 m.
> Não custa nada em cena plana: o relevo é esparso. Cena antiga continua com a
> grade dela, porque `passo` é gravado DENTRO do relevo e `lerRelevo` lê o que
> está lá — mudar a constante não pode reescrever o morro de ontem.

> **O relevo é da CENA, não da peça.** As alturas moram numa grade
> compartilhada, e cada placa de terreno **lê a altura em cada vértice seu**
> dessa grade, nas coordenadas do mundo onde aquele vértice vai parar — é o
> que faz duas placas vizinhas **casarem sozinhas**: as duas leem a mesma
> função nas mesmas coordenadas, na borda que dividem. Fosse propriedade de
> cada placa, montar um morro exigiria acertar canto a canto e casar com a
> vizinha à mão, e um erro de um centímetro abriria uma fresta que só aparece
> com a câmera rente ao chão.

> **Vértice a vértice, e não pelos quatro CANTOS — foi o bug que matou a
> primeira versão.** Ela passava as quatro alturas dos cantos da placa para
> `geoPlaca` e interpolava por dentro. A grade do relevo tem passo de 4 m e as
> placas de 4 m grudam em múltiplos de 4, então os cantos delas caem **sempre**
> no meio de dois nós: um morro de 6 m no nó (0,0) virava uma placa **plana a
> 2,26 m**. O cume — o único lugar para onde se olha — era o único achatado, e
> só as placas vizinhas mostravam rampa. Nada levantava, nada avisava; quem
> pintava concluía que o relevo não funcionava, e concluiu.
>
> Hoje `geoPlaca(lado, cor, corAlt, altura)` recebe uma **função** `(x, z) =>
> metros` em coordenadas locais e a lê em cada vértice — que é literalmente o
> que `malhaDoChao` faz com `alturaDoChao` no chão da floresta. `geoDoItem`
> desfaz o giro e a escala do item ao montar essa função: a malha é girada e
> escalada DEPOIS, e sem desfazer os dois uma placa girada 90° leria o morro de
> lado, e uma placa do dobro do tamanho o leria com o dobro da altura.
> Guardado por `pecasbase.test.mjs` ("o cume nao pode achatar").

> **A subdivisão da placa é de ~1 m**, proporcional ao lado (4 m → 4×4, 12 m →
> 12×12), a mesma ordem do chão da floresta (~1,7 m). Com quatro cantos a
> subdivisão não pagava nada — a superfície era bilinear de qualquer jeito.

> **O pincel mira no chão JÁ DEFORMADO** (`miraNoTerreno`), não no plano zero.
> Enquanto o terreno é plano os dois dão o mesmo ponto; depois da primeira
> pincelada, não: com a câmera baixa, um morro de 6 m põe o encontro com o
> plano zero metros ATRÁS do que se está vendo, e o morro "anda" enquanto se
> pinta.

> **A pincelada só redesenha as placas que ela alcança** (`redesenharTerreno`
> recebe a área). Refazer o mapa inteiro a cada `pointermove` é meio segundo
> por quadro com cem placas — e um editor que engasga a cada pincelada é, na
> tela, indistinguível de um que não funciona. Pelo mesmo motivo `geoPlaca` não
> usa `fundir`: ele quer uma geometria por cor, e criar 288 `BufferGeometry`
> por placa e por quadro custava mais que a placa inteira.

> **Só o SOLO se deforma**, que é o pedido. Quem responde é o `terreno` do
> catálogo (as placas de chão declaram o lado; árvore e pedra declaram nada), e
> o pincel **recusa esculpir onde não há placa** — sem essa condição ele
> levantaria a grade num lugar sem chão, nada apareceria na tela, e a conclusão
> seria que o relevo não funciona. Árvore e pedra não se deformam: elas
> **pousam** na altura do terreno.

> **A interpolação é BILINEAR.** Com "o nó mais perto" o chão vira degraus de
> 4 m, e uma peça posta no meio da célula pousa flutuando acima do triângulo
> que a placa desenha ali. A placa é desenhada pela MESMA `alturaDoRelevo` que
> põe a peça em cima dela — é a lei do `alturaDoChao` da floresta: dois
> leitores, uma conta. `cantosDaPlaca` foi apagada por ser a segunda leitura.

> **A placa com relevo ganha geometria PRÓPRIA.** A da biblioteca é
> compartilhada entre todas as cópias, então deformá-la deformaria todas as
> placas do mapa de uma vez — e descartar a de uma apagaria a das outras.

> **A normal sai da FACE, e não de um `+Y` escrito à mão.** Com relevo, uma
> normal fixa para cima deixa o morro iluminado como se fosse plano: ele existe
> na silhueta e desaparece na luz, sem nada acusar.

> **`assentar` conta o terreno junto**, senão `F` num morro devolveria a peça ao
> plano zero — enterrando justamente o que se acabou de levantar. E **pôr** uma
> peça também pousa no relevo: no morro, ela nasceria enterrada até a copa.

> **Nó que volta a zero SAI do mapa** (o relevo é esparso), e há teto de 40 m:
> sem os dois, a cena incha a cada pincelada desfeita e o pincel joga o chão na
> estratosfera.

> **A cena publica em `conteudo` como `cena-<nome>`, e a `chave` daquela tabela
> tem LISTA BRANCA.** `conteudo_chave_check` recusava `cena-*`, então o Editor
> de Cena nunca publicou nada: o espelho em disco gravava, o banco devolvia 400,
> e a cena parecia salva para quem editou e não existia para mais ninguém. O
> único sintoma foi a faixa de `pendencias.js` grudada na tela — ela dizia a
> verdade, e a fila só larga a chave quando o banco ACEITA, então o reenvio
> batia na mesma parede a cada 20 s para sempre. Aberto pela **migration 0057**.
> `ehNomeDeCena` e a constraint têm de casar; `conferir-conteudo.mjs` guarda o
> par (`PUBLICAVEIS`) e agora acusa chave que existe só no disco.

**COLISÃO** (`C`, ou o botão): a caixa de cada peça, desenhada em volta e
seguindo o tamanho. Verde barra quem anda; azul é chão/decalque, que **não**
barra.

> A caixa desenhada e o colisor do Mundo saem da MESMA `caixaDoItem` — desenhar
> por um caminho e colidir por outro daria uma tela que promete o que o jogo não
> cumpre, sem nada acusar. Ela acompanha escala e **giro**: a 45° a peça ocupa
> mais que a largura dela, e ignorar isso deixa o colisor menor que a peça — o
> jogador entra pela quina, e reporta como *"atravessei a parede"*.

> **Uma peça comprida vira VÁRIOS círculos** (`colisoresDaCena`), na mesma forma
> que `floresta.js` usa para as árvores. Um só, com o raio da diagonal,
> engordaria um muro de 8 m num disco de 4 m de raio e fecharia a passagem ao
> lado dele. E o **chão fica de fora** por altura: pegada enorme com altura zero
> viraria um disco intransponível — o defeito mais fácil de criar aqui.

> **O MODO é a interface inteira**, e hoje são quatro: *pondo* (peça escolhida
> na gaveta — o clique põe uma cópia e a peça segue o ponteiro, translúcida),
> *escolhendo* (o clique seleciona, o arrasto move), *apagando* (`Del` — cada
> clique tira o que acertar) e *relevo* (`R`). Eles são **exclusivos nos dois
> sentidos**: pegar uma peça desliga o pincel e o apagar, ligar o pincel larga a
> peça, e assim por diante. `Esc` desfaz um por vez, na ordem pincel → apagar →
> peça → seleção — juntá-los faria "parar de esculpir" apagar a seleção junto.
>
> O *apagando* nasceu do trabalho repetido: limpar uma área era
> selecionar–apagar–selecionar–apagar, e metade dos cliques era em cima do vazio,
> só para largar a seleção anterior. `Backspace` continua apagando a peça
> selecionada — uma tecla, um significado, em vez de `Del` fazer duas coisas
> conforme haja ou não seleção.
>
> Sem essa separação o clique tem de adivinhar a intenção, e adivinhava errado:
> **com uma peça escolhida, clicar num objeto para apagá-lo punha outro em cima
> dele**, e não havia como largar a peça. Era o relato — *"os objetos já em cena
> não consigo deletar"*. Por isso o selo de MODO fica no alto do palco: ele é a
> única coisa que explica por que o clique põe em vez de selecionar, e sem ele
> à vista o editor parece quebrado.

> **O mouse VIRA a câmera; não arrasta o mundo.** São dois modelos opostos e os
> dois se defendem sozinhos — "agarrar e puxar" (o mundo segue o cursor, como
> num mapa) e "olhar" (a câmera gira, o mundo corre para o outro lado, como em
> qualquer jogo em primeira pessoa). O que não se defende é um em cada controle,
> e era o que havia: o botão direito puxava o mundo e o `WASD` andava com a
> câmera. A mão faz as duas coisas no mesmo gesto de enquadrar uma peça, e
> trocar de referencial no meio deixa a câmera *"ruim de controlar"* sem que se
> saiba dizer por quê — foi assim que o relato chegou. Como o `WASD` é câmera
> por natureza, é o mouse que se alinha a ele.
>
> O vertical é mais lento que o horizontal (`GIRO`) porque percorre um arco
> PRESO (0,08 a 1,5 rad): na mesma sensibilidade, o gesto bate na trava nos dois
> sentidos antes de a mão terminar o movimento.

> **`WASD` é da CÂMERA, e foi ela que empurrou dois atalhos.** A altura da peça
> saiu de `W`/`S` para `PgUp`/`PgDn` (o slider e `Shift`+arraste continuam), e
> duplicar saiu de `D` para `Ctrl+D`. Quem move é o **laço**, a partir de um
> conjunto de teclas seguradas: mover no `keydown` faz a câmera andar no ritmo da
> repetição do teclado do sistema — trancos, e diferentes em cada máquina. A
> direção sai do ÂNGULO da órbita (um `W` que empurrasse para `-Z` mandaria a
> câmera de lado quando ela estivesse girada), a velocidade cresce com a
> distância, e o `dt` é preso a 0,1 s porque uma aba que volta do segundo plano
> traz um salto de vários segundos — a câmera pularia para o outro lado do mapa
> num quadro. O `blur` da janela LIMPA o conjunto: sem ele, trocar de janela com
> o `W` apertado deixa a tecla presa (o `keyup` acontece na outra janela) e a
> câmera volta voando sozinha.

> **`Ctrl+Z`/`Ctrl+Y` guardam CENAS INTEIRAS, não operações inversas**
> (`criarHistorico`, em `cena.js`). Desfazer por operação exige um inverso
> escrito à mão para cada gesto novo, e o que envelhece calado é o gesto que
> ninguém lembrou de inverter: o `Ctrl+Z` "funciona" e deixa a cena um pouco
> errada. Aqui a cena é imutável, então guardar o anterior custa uma referência.
>
> O que faz o desfazer ser **útil** é o GESTO: `abrirGesto` guarda uma vez só por
> arrasto. Sem isso, arrastar uma peça por dois segundos empilha sessenta estados
> e o `Ctrl+Z` anda um pixel por vez — desfazer que não desfaz nada visível é
> pior que não ter. O gesto fecha no `pointerup` **da janela** (é o que faz os
> sliders da lateral contarem como um gesto só) e no `keyup`.
>
> `montarCena` é o caminho de recuperação e **não mexe no histórico**; `usarCena`
> (abrir arquivo) é a capa que guarda antes — abrir por engano com uma tarde de
> trabalho na tela é exatamente quando se quer o `Ctrl+Z`. E ela **descarta a
> geometria própria** das placas com relevo ao desmontar: sem isso cada desfazer
> numa cena com morro vaza uma malha na GPU.

> **TESTAR (`T`, ou o botão) põe o JOGADOR na cena e anda nela.** É a única
> coisa que responde a pergunta que o editor sozinho não responde: *dá para
> andar aqui?* As caixas de colisão (`C`) mostram as formas, mas caixa desenhada
> não diz se sobrou passagem entre duas árvores, se a rampa do morro é subível,
> nem se o piso que se acabou de montar tem uma fresta que prende os pés.
>
> **As três contas são as do Mundo, e nenhuma foi reescrita aqui** — é isso que
> faz o teste valer alguma coisa. Quem barra é `colisoresDaCena` (o que o Mundo
> lê ao montar um cenário); quem move é `mover`/`livre` de `floresta.js` (o laço
> do jogador de lá, com `VEL`/`VEL_CORRIDA` iguais — testar mais devagar daria um
> vão que "passa correndo" aqui e não lá); e a altura é
> `max(alturaDoRelevo, alturaDePouso)`, o mesmo par do `assentar`. Uma segunda
> conta em qualquer uma daria um editor que aprova o que o jogo recusa, e o erro
> só apareceria com o ambiente já publicado.
>
> **A parede do mundo virou PARÂMETRO** (`livre(..., parede)`): a floresta acaba
> em 92 m e uma cena vai a 400 (`LIMITE.xz`), então sem isso metade do mapa
> seria intestável — e a alternativa, uma colisão própria do editor, é o defeito
> que o parágrafo acima existe para impedir. O padrão continua `MUNDO.raio`.
>
> **O boneco é INJETADO** (`criarJogador`), como o `carregar` já era: a cadeia
> dele (`boneco3d` → `modelos` → `GLTFLoader` + `fetch`) não existe em `file://`,
> e `tools/bancada-cena.mjs` monta o MESMO editor a partir de um HTML solto. Sem
> a injeção, ou a bancada quebrava ou o editor ganhava um segundo boneco só dela.
> O de reserva tem **tamanho de gente** (1,72 m) porque o tamanho é metade da
> pergunta: um marcador menor passa por vãos onde a pessoa não passa, e o teste
> diria que está bom. A altura é MEDIDA do boneco que chegou, nunca escrita.
>
> **Nascer dentro de um colisor não é "difícil de sair"**: `livre` é falso na
> volta inteira e não se anda para lado nenhum — o teste abriria com o boneco
> imóvel, indistinguível de um editor travado. É a armadilha que o Mundo já
> documenta na entrada da clareira, e a resposta é a mesma: passar por `mover`,
> que desliza para fora, e AVISAR se ainda assim ficou preso. Ele nasce onde a
> câmera está olhando, não na origem: testa-se o pedaço que se acabou de montar.
>
> **Testando não se edita.** A lateral inteira some, os modos recusam e o clique
> não faz nada além de girar a câmera — mexer na cena por baixo do boneco mudaria
> justamente os colisores que se está provando. `C` é a única exceção: ele mostra
> a caixa, não muda a cena, e vê-la no instante do esbarrão é metade do
> diagnóstico. As caixas de pouso são apuradas UMA vez, ao entrar: `caixasDaCena()`
> constrói uma por item, e chamá-la por quadro seriam duzentas alocações por
> quadro numa cena grande.

> **REGRAS por CLASSE e por PEÇA** (`porRegra`, `colide`, `segueRelevo`). Duas
> perguntas que o catálogo sozinho não responde, e que são a mesma pergunta com
> dois campos: *esta peça barra quem anda?* e *esta peça acompanha o relevo?*
> A resolução tem três níveis, do específico ao geral: **a peça**, **a classe**, e
> **o catálogo** (a altura decide a colisão, o `terreno` decide o relevo).
>
> **Três estados, não dois.** "Não decidi" e "decidi que não" são coisas
> diferentes: com um par ligado/desligado não haveria como DESFAZER uma decisão
> de classe — ela ficaria para sempre, e a classe inteira herdaria um `false` que
> ninguém quis. `porRegra(..., undefined)` apaga; `lerRegras` só aceita booleano,
> porque `Number(null)` e a string `'false'` são verdadeiros em JS e converter
> aqui transformaria lixo numa decisão explícita.
>
> **As regras moram na CENA**, não numa configuração global: elas viajam com o
> arquivo (o Mundo lê a mesma decisão que o editor provou, sem uma segunda
> publicação que pode não acontecer) e cenas diferentes podem discordar de
> propósito — um mapa de corrida quer a grama sólida.
>
> Na gaveta, os dois seletores da classe ficam sempre à vista; os da **exceção**
> só aparecem depois que a classe ou a peça foi mexida. Pendurar dois seletores
> em cada uma das 142 peças do Tag Force transformaria a gaveta num formulário e
> esconderia as peças, que são o que se veio procurar ali.

> **A malha IMPORTADA precisa ser subdividida antes de seguir o relevo**
> (`malha.js`). As peças de chão do Tag Force — as estradas, os pátios — têm
> **3 a 8 triângulos**. Marcar uma como terreno e deslocar os vértices não produz
> fenda nenhuma: com quatro cantos, a superfície entre eles é um plano, e o
> buraco cavado no meio dela não tem onde existir. É o MESMO defeito que matou a
> primeira versão do relevo, vindo de outro lado — lá era a conta, aqui é a falta
> de vértice onde pôr o resultado. `geoPlaca` escapa disso porque nasce
> subdividida; uma peça importada chega pronta, e a única saída é acrescentar
> vértices.
>
> `subdividir` parte pela aresta MAIS LONGA (o baricentro produz lascas cada vez
> mais finas, que somem na tela e continuam custando o mesmo), leva todo atributo
> junto (esquecer o `uv` deixa a estrada com a textura embolada, e o sintoma
> parece erro do extrator), e tem **TETO** conferido antes de cada passe: cada
> passe dobra a contagem, e uma peça de 3 mil triângulos marcada como terreno
> viraria centenas de milhares sem nada avisar. `deformarPeloRelevo` **SOMA** a
> altura em vez de substituir — uma calçada com 8 cm de meio-fio tem de continuar
> com o meio-fio depois de subir o morro.

> **O COLISOR é ajustável por item** (`caixaDeColisao`, `col` no item): ligar e
> desligar, apertar nos três eixos e subir — as alças verdes da Unity, em
> números. Três coisas que não são óbvias:
>
> - **`caixaDoItem` e `caixaDeColisao` são funções diferentes de propósito.** A
>   primeira é a FORMA (o pouso, o encaixe, o `terrenoCoberto`); a segunda é o
>   colisor. Misturadas, apertar o colisor de uma pedra mudaria a altura em que
>   as coisas pousam em cima dela — efeito colateral que ninguém pediu e que só
>   apareceria depois.
> - **as escalas são MULTIPLICADORES**, e o deslocamento acompanha a escala da
>   peça. Um colisor em metros fixos deixaria de acompanhar a peça redimensionada
>   — o defeito que a caixa "que segue o tamanho" existiu para resolver.
> - **`col: false` é falsy, e isso já custou um bug.** `if (col)` na leitura
>   descartava a decisão "esta peça não colide", e o colisor desligado voltava
>   ligado ao reabrir a cena — sem erro nenhum, a peça só barrava de novo. É
>   `!== null`. Guardado por teste.
>
> O colisor encolhe pelo **centro**, como na Unity, e se move com o `dy`. Encolher
> pela base pareceria mais útil para quem põe coisas no chão, mas seria uma
> segunda convenção na mesma tela, e o ajuste aprendido num campo erraria no outro.
>
> **A caixa DESENHADA é o colisor**, não a forma: mostrar uma e colidir pela outra
> daria uma tela que promete o que o jogo não cumpre — e as alças não teriam o que
> arrastar. Verde barra, azul está na cena e não barra.

> **Chão posto em cima de chão TROCA o de baixo** (`terrenoCoberto`). Duas placas
> coplanares brigam pelo pixel, e tirá-las à mão era metade do trabalho de montar
> um piso. Três cuidados, cada um por um caso ruim: **encostar não é cobrir** (a
> margem estrita é o que impede o piso inteiro de se apagar sozinho enquanto se
> monta a fileira); **só terreno apaga terreno** (pôr chão não pode limpar a
> floresta em cima dele); e **altura diferente é degrau, não sobra** (com relevo
> dá para empilhar patamares de propósito, e apagar o de baixo abriria um buraco
> no que se acabou de construir). A remoção acontece **depois** de a peça nova
> entrar na cena — apagar primeiro e falhar em seguida deixaria o buraco. E ela
> nunca é silenciosa: a tela diz quantas placas saíram.

> **O fantasma não entra na cena e não é alvo de raycast.** Fosse um item,
> apareceria no contador, entraria no arquivo salvo e o raio bateria nele em vez
> do chão — o clique miraria o próprio cursor. E ele leva o giro e o tamanho que
> a peça VAI ter (`giroDoProximo`): prévia que mente sobre o que o clique
> produz é pior que prévia nenhuma.

> **A interação mora em `cenaeditor.js` (`montarEditor`), e as duas telas a
> CHAMAM** — a página e a bancada põem só a volta (login, gaveta, salvar). A
> primeira versão tinha a interação copiada na bancada, e o primeiro pedido de
> mudança teria sido feito num lugar e não no outro: a bancada continuaria
> "funcionando", provando o editor de ontem.

**A gaveta tem GRUPOS dobráveis** (`cenagaveta.js`): *Árvores e plantas*,
*Pedras*, *Chão* e *Tag Force — modelos de cenário*. O último nasce **fechado**:
são 142 peças importadas contra uma dúzia de base, e numa lista só as importadas
enterram justamente as que se usa primeiro. Buscando, **tudo abre** — resultado
dentro de seção fechada não aparece, e a busca parece não funcionar.

> `<details>`/`<summary>` é HTML: abrir e fechar é do navegador, sem estado
> nosso e sem ouvinte de clique — e sem o defeito clássico do acordeão escrito à
> mão, o `display` que some junto com a classe e deixa a seção aberta e vazia.

**As peças BASE são geradas em código** (`pecasbase.js`) e custam **zero byte**
no `game.zip`. Elas não são arte nova: `geoConifera`, `geoCopada`, `geoPedra`,
`geoSamambaia` e `geoCapim` são **as mesmas** do `floresta3d.js`, que passaram a
ser exportadas — uma segunda árvore divergiria da floresta na primeira mexida, e
a cena montada no editor pareceria um jogo diferente do mundo em que ela entra.

> Isso paga duas vezes: nada viaja, e **o editor tem o que colocar mesmo sem a
> biblioteca do Tag Force** — que é gerada por uma ferramenta que só roda em
> quem tem o ISO. Antes, abrir o editor sem `web/pecas/` dava uma gaveta vazia.

> **Três coisas erram CALADAS numa peça base, e cada uma tem asserção:** sem
> `color` no vértice o material sai **branco** (o editor usa `vertexColors`, e
> branco é indistinguível de arte ruim); sem `normal` a peça fica **preta** sob
> luz direcional; e uma malha centrada na origem nasce com **metade enterrada** —
> foi o que o teste pegou na pedra (base em `y = −0,48`). Hoje `assentar()` põe
> o piso em `y = 0` **medindo**, em vez de acertar o `translate` de cada uma à
> mão, que envelhece a cada mexida na forma.

> **A DIMENSÃO que a gaveta mostra é medida da geometria**, nunca escrita: é por
> ela que se decide se a peça cabe, e um número à mão não muda quando a forma
> muda — a gaveta passaria a mentir sobre o tamanho.

**A biblioteca do Tag Force sai de FATIAR os mapas** (`tools/tagforce/pecas.mjs`), e não de
achar arquivos avulsos — medido: **não existe** biblioteca de objetos no jogo.
Cada TGMS traz uma tabela de objetos, e é ela que dá as peças: 13 mapas → **142
peças**, mediana de 60 triângulos.

> **O limite honesto:** os objetos do TGMS são agrupados por MATERIAL, não por
> objeto físico. "Todo o gramado do mapa" é uma peça só, e "todas as madeiras"
> é outra. Cerca de 100 têm tamanho de móvel e servem como peça; o resto são
> pedaços grandes de cenário. É o que dá para extrair sem modelar.

> **O "filtro pra deixar leve" é SOLDA, não decimação — e a diferença foi
> medida.** Das 152 peças, **duas** passam de 2.000 triângulos: o material é de
> PSP e já nasceu low-poly, então simplificar malha resolveria um problema que
> não existe (e custaria vendorizar o `SimplifyModifier`). O desperdício real é
> outro: a leitura expande TRIANGLE_STRIP e cada vértice interno se repete de
> três a seis vezes. `soldar` junta os repetidos e vira malha indexada —
> **−70% de vértices, −69% de bytes, 11.069 triângulos degenerados fora**. Não
> tira um triângulo da tela; tira bytes do arquivo e vértices da GPU.

> **A peça é baixada UMA vez e a geometria é COMPARTILHADA** entre as cópias.
> Uma fileira de vinte cercas seriam vinte malhas na GPU — e descartar a de uma
> apagaria a das outras, o mesmo defeito que o cache de `boneco3d.js` documenta.

> **Arrastar é raycast contra um PLANO, nunca contra a peça.** Mirando na
> malha, a peça foge do cursor assim que sai de baixo dele (o raio deixa de
> acertá-la) e o gesto morre no meio. E `miraNoChao` devolve `null` com o raio
> paralelo ao plano: um ponto ali jogaria a peça no infinito, o `LIMITE` a
> prenderia na borda do mapa, e ela "escaparia" sem explicação.

> **A cena é gravada por `pushFile`**, a chave de `projectstore.js` — o mesmo
> caminho de `banlist` e `boosters`. Ela dá três coisas de graça, já pagas de
> outra forma: publica no Supabase (montar numa máquina e abrir noutra),
> espelha em `store/` e entra na FILA de pendências quando a rede cai, em vez
> de dizer "salvo" sobre uma edição que não existe para mais ninguém. **Custo
> assumido: a cena ainda não viaja no Release** (`store/` tem allowlist de
> cinco `.json`); quando uma estiver pronta para o jogador, ela vai para
> `web/cenas/` como o cenário do dormitório foi.

> **`web/pecas/` custa +1,3 MB comprimidos no `game.zip`** (2,1 → 3,4 MB), e
> isso é uma pendência declarada: a biblioteca inteira é ferramenta de ADMIN, e
> o jogador só precisa das peças que a cena usa. `pecasUsadas(cena)` já
> responde quais são — falta o `publish-release.ps1` levar só essas.

> **`node tools/bancada-cena.mjs`** gera `bancada-cena.html` na raiz: o editor
> com as peças de verdade embutidas, sem servidor e sem login. Existe porque
> *"dá para montar um lugar movendo peças?"* não é pergunta que teste de lógica
> responda. Ela **usa** `cena.js` e `cenaeditor.js` do jogo, com um `carregar`
> que lê das peças embutidas — `file://` não faz `fetch` de arquivo local, e é
> o único ponto em que as duas telas diferem.
>
> Ela já se pagou **três vezes**, e as três abririam a página *preta e muda*:
> uma colisão de nome (`CATALOGO`, declarado no `cena.js` e de novo na
> bancada); um **backtick dentro do template literal**, que fecha a string do
> gerador; e um `^import .*$` que apagava só a PRIMEIRA linha de um `import`
> multi-linha, deixando a lista de nomes órfã no meio do arquivo.

#### A Página de Personagens (`web/personagens.html`, 06/09/2026)

Escolher **quem você é** no Mundo, ao lado do vestiário, que escolhe o que você
veste. As duas gravam no MESMO `perfis.aparencia`, pelo mesmo `paraGravar` e
pelo mesmo `PATCH`.

> **Um personagem é uma TEXTURA, não uma malha.** Os dezoito personagens do
> pacote Kenney têm geometria idêntica e diferem só pela textura — então a
> variante é pintada no navegador (rotação de matiz sobre a textura que o `.glb`
> já trouxe) e custa **zero byte** no `game.zip`. É a regra da casa (*"a arte é
> gerada em código"*) aplicada a um asset que veio pronto.

> **O catálogo sai do ELENCO** (`npcs.js` + `coresPara`), e não de uma terceira
> lista: uma lista à mão envelheceria a cada adversário novo, e o sintoma seria
> uma tela plausível faltando gente. **O Mundo hidrata o elenco mesmo com os
> NPCs desligados**, porque o catálogo dele tem de ser o MESMO da página — fossem
> dois, alguém escolheria lá um personagem que aqui não existe e o corpo voltaria
> ao padrão sem uma linha no console.

> **A escolha entra em `aparencia.personagem`, na forma `{ peca }`** — a mesma
> dos slots de roupa. Não é capricho: é assim que o gatilho
> `perfis_aparencia_valida` (0054) enxerga a chave, então no dia em que um
> personagem for vendido em `itens` a regra de posse já vale para ele sem uma
> linha nova de SQL. E `normalizar` precisou aprender a chave: ele monta a saída
> do ZERO, então o que ele não conhece **some entre escolher e salvar**, calado.

> **Os modelos de personagem do Tag Force NÃO entraram**, e o motivo está medido
> no `tools/tagforce/README.md`: são malhas *skinned*, com o vértice em espaço de
> osso, e sem espaço de modelo não há gabarito para conferir a leitura.

**O three.js é VENDORIZADO** em `web/vendor/three/` (r185, pinado, MIT — ver
`web/vendor/README.md`), e não importado de CDN. Não é preferência: o
`ClassicDuels.exe` serve `%LOCALAPPDATA%` na máquina de quem joga, e um
`import` externo deixaria o mundo 3D sem abrir exatamente quando a conexão está
pior — em silêncio, porque um `import` que dá 404 mata o `<script
type="module">` inteiro. Vendorizado ele viaja no `game.zip` como qualquer
coisa de `web/` (`Copy-Item -Recurse`), sem passo nenhum: **+184 KB** no pacote.

> **A arte do CENÁRIO continua sendo gerada em código**, como a pixel art de
> `tileset.js` e os bonecos de `actors.js`. Árvore é cone
> empilhado, pedra é icosaedro amassado, o duelista é um monte de caixas. E a
> paleta é IMPORTADA (`CHAO`, de `tileset.js`) em vez de copiada — duas paletas
> em dois arquivos divergem na primeira mexida, e o sintoma seria os dois
> mundos parecerem jogos diferentes.

> **O PERSONAGEM abriu exceção — e a exceção tem porta e volta.** Cápsula e
> esfera não viram "modelo bom" por mais que se ajuste raio e escala, e
> personagem de verdade se modela. Então `web/js/modelos.js` carrega `.glb` no
> boot e **toda peça pergunta por um antes de montar a forma escrita em**
> **código**. Havendo modelo, ele vence; não havendo, a cápsula assume.
>
> Isso compra a troca **gradual e reversível**: modela-se um cabelo hoje, o
> resto segue procedural, e apagar o arquivo devolve a cápsula. O que NÃO muda
> é o resto — vestiário, posse, gatilho, `rpc/aparencias` e rede não sabem que
> `.glb` existe. Era para isso que o sistema veio antes da arte.
>
> O `GLTFLoader` está vendorizado em `web/vendor/three/addons/` (mais
> `BufferGeometryUtils` e `SkeletonUtils`, que ele arrasta): **160 KB crus,
> ~36 KB no `game.zip`**. Os três importavam de `'three'` — um *bare*
> *specifier* que o navegador não resolve sem import map, e um `import` que
> falha mata o `<script type="module">` inteiro em silêncio —, então o caminho
> foi reescrito para o relativo, e há teste cobrando que nenhum voltou.
>
> O contrato de pastas, escala e nomes de nó está em `web/modelos/README.md`.
> Sem `modelos.json`, o boot faz UMA requisição, recebe 404 e segue procedural.

> **E existe ARTE no repositório desde 31/08/2026** — a primeira, e ela quebra a
> regra da arte gerada em código de propósito: `web/modelos/kenney/` traz um
> personagem do pacote **Blocky Characters** (CC0), 133 KB entre `.glb` e
> textura, com a licença ao lado. A licença viaja junto porque o asset viaja
> dentro do `game.zip`, e há teste cobrando que ela esteja lá.
>
> **O pacote não tem peças modulares**, e isso decidiu duas coisas: os dezoito
> personagens dele têm geometria IDÊNTICA e diferem só pela TEXTURA. Então o
> material do `corpo` **não é descartado** (a regra "sai geometria, a cor é
> nossa" vale só para PEÇA — sem a textura sobra um vulto branco), e enquanto
> houver um `corpo` carregado **as peças procedurais cedem**, porque empilhar uma
> cápsula de blusa sobre um personagem já vestido é uma segunda roupa por cima da
> primeira. O vestiário volta inteiro no dia em que houver `.glb` por peça.
>
> **O personagem é NORMALIZADO na entrada**: medido e reescalado para 1,72 m, pés
> em y=0, e com a âncora da junta subtraída de cada parte. Sem isso ele entrava
> com 4,27 m e os pés a 80 cm do chão — e o mundo inteiro mentia junto (câmera,
> etiqueta de nome, altura do chão). A escala é MEDIDA, e não pedida no
> manifesto: um fator errado não dá erro, dá um gigante. `ALTURA_BONECO` e
> `ANCORAS` moram em `modelos.js` porque os DOIS lados precisam do mesmo número —
> quem pendura e quem desconta.

> O boneco reusa `coresPara(id)` (por `padraoDe`), então o
> mesmo adversário tem a mesma cara nos dois mundos, sem guardar aparência em
> lugar nenhum.

A divisão é a MESMA do mundo 2D, de propósito: **`floresta.js` decide** (relevo,
onde nasce cada árvore, o que bloqueia, onde os duelistas ficam de pé),
**`floresta3d.js` e `boneco3d.js` desenham**, e **`mundo3d.js` cuida do que muda
a cada quadro**. Os dois do meio não encostam em DOM — é isso que deixa
`node web/js/floresta.test.mjs` montar a cena inteira em Node e provar que o
pacote vendorizado carrega.

> **A altura do chão tem DOIS leitores e uma conta só.** A malha do terreno
> desloca cada vértice por `alturaDoChao`, e o loop põe os pés do jogador pela
> mesma função. Uma segunda conta em qualquer um dos lados dá um boneco
> flutuando ou enterrado, conforme o pedaço do mapa, e o jogo roda igual. É a
> mesma família do `chancesDe` × `chancesDoPacote`: duas verdades sobre o mesmo
> número, cada tela certa pela sua conta.

> **O `ResizeObserver` ficou de fora de propósito.** O canvas é reconferido
> dentro do LAÇO, comparando dois inteiros. Mexer no layout durante a entrega de
> um observer deixa notificação pendente no fim do quadro, o navegador dispara
> `ResizeObserver loop completed with undelivered notifications`, isso chega
> como `ErrorEvent` na window e o `bootguard` cobre o jogo com a faixa de tela
> quebrada — já aconteceu aqui, na serpentina da Trilha. E a comparação é com
> `Math.floor`, que é o que o `setSize` do three faz: com `round`, em DPR
> fracionário (1,25 — o padrão de um monitor com escala do Windows) os dois
> nunca batem e o canvas é reconstruído a cada quadro, sem erro nenhum, só
> lento.

**O que ainda é duplicado, e vai ter de sair:** o painel do duelista (arte,
deck, recompensa, botão de duelar) existe em `cidade.js` e de novo em
`mundo3d.js`. Foi mantido assim para não desestabilizar a tela 2D por causa de
uma prova de conceito — quando esta graduar, o painel vira módulo e as duas
passam a usar o mesmo. Duas cópias divergem caladas.

## Login, sessão e Área de Teste (do lado do cliente)

> A metade servidora disto — onde a conta é gravada, o `/__auth/*` em paridade
> entre `tools/serve.mjs` e `StaticServer.cs`, e a RLS que barra de verdade —
> está em **`duel-server/CLAUDE.md`**.

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
`banlist`, `listas`, `npcs`, `campo`, `ordenar`, `icones`, `estrutural`, `cardbuilder`,
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

## Armadilhas conhecidas do front

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
- **Caminhos são absolutos** (`/web/js/...`) e o dev-server redireciona `/` com
  302 de verdade. Servir o HTML direto em `/` faz os módulos darem 404 e a página
  morre em silêncio. Não troque por relativos.
- O pool do builder renderiza no máximo `MAX_RENDER` (240) miniaturas de 13.728.
