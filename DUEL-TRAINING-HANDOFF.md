# Handoff — Servidor de Duelo & Treino (Frente 3 / W2)

> Documento pra uma sessão nova do Claude Code (possivelmente em outra máquina)
> continuar o trabalho do **duelo jogável**. Autocontido: não depende de memória
> de sessão. Complementa o `continue.md` (que é local/gitignored e cobre o resto
> do projeto: Deck Builder, ygo-data, NPCs, cartas customizadas, Lista 1).

## 1. O que é

Mini-RPG de Yu-Gi-Oh com duelo **fiel às regras** (o motor é o `ocgcore` + os
scripts Lua oficiais). O duelo roda num **servidor C# (.NET 8)** que expõe o motor
via HTTP local; o front web (`web/duel.html`) desenha o estado e manda as jogadas.
O objetivo do "treino" é **validar a mecânica** — jogar contra o motor e ver o que
quebra.

> A IA dos NPCs é escrita **só em código**, no `NpcBrain.cs`, como regras
> explícitas. Houve um plano de gravar as jogadas do jogador (`localStorage:
> ygo:plays`) pra virar "memória" do NPC; foi **descartado**, e o botão "salvar
> jogada" saiu do `duel.html`. Não reintroduza.

## 1.1. NPC do Teste de Batalha

O oponente **joga** (`web/js/`… não: `duel-server/src/NpcBrain.cs`). Regras, em
ordem de prioridade — são exatamente as especificadas, nada além:

1. **Pote da Ganância antes de tudo.** Se dá para ativar, ativa antes de invocar.
2. **Nível maior tem precedência.** Se dá para invocar com tributo, é essa a jogada.
3. **Statline da própria carta decide o modo.** Só vai para ataque quem tem
   **ATK > DEF**. Um 1200/2000 é parede: mesmo podendo vencer o que está em campo,
   rende mais setado do que atacando.
4. **Depois, o campo.** Se a ameaça do oponente supera o melhor *atacante*
   disponível, seta o de maior DEF em vez de entregar o monstro.
5. Sem jogada possível, encerra o turno.

A ordem das duas comparações importa: **primeiro o statline da carta, depois o
campo**. É o que faz o NPC setar um Aqua Madoor (1200/2000) contra um 1100 em vez
de invocá-lo em ataque — ele venceria a batalha, mas 2000 de defesa segura muito
mais do que 1200 de ataque.

**3.5. O campo à vista pode desmentir o statline** (`BaterRendeMaisQueAParede`).
O statline sozinho é cego: ele mandava SETAR um Ryu-Ran (2200/2600) recém-
invocado por tributo diante de dois monstros que ele atropelava — e esses dois
corpos viravam, no turno seguinte, o tributo/material de ritual de algo maior
que ele. A regra é uma troca, medida na mesma moeda dos dois lados:

- **ganho de bater** = o dano que passa (`ATK − valor do alvo`) mais **metade**
  do corpo que sai do campo dele (metade porque o corpo não vira meu: o que eu
  levo é o campo dele mais vazio, um tributo a menos). Campo vazio: o ataque
  direto inteiro.
- **perda de bater** = `DEF − ATK`, a defesa de que se abre mão ficando de pé.

Bate quando `ganho >= perda` — e **nunca** antes da segurança: se algo com a
face para cima do lado dele supera meu ATK, a parede ganha sempre. É esse peso
que separa os dois casos sem `if` para nenhum: o Aqua Madoor continua setando
(650 de ganho contra 800 de defesa aberta) e o Ryu-Ran bate.

Com **leitura** entra a segunda metade: se o corpo em campo dele já é o tributo
de um monstro na mão que quebra a minha DEF (`MaterialQueQuebraAParede`), deitar
não adia nada — derrubar o corpo agora é um tributo a menos. Sem leitura a mão
dele vem vazia e a regra some sozinha.

Vale nos **dois** caminhos, porque o furo entrava pelos dois: a invocação normal
(`Escolher`) e o `MSG_SELECT_POSITION` das Invocações Especiais (`DecidePosicao`,
que por isso recebe quem está invocando) — sem o segundo, o mesmo Ryu-Ran que
chega pelas Regras Antigas nasceria deitado.

Detalhes que importam:
- **"Pôr em defesa" = Set.** Pelas regras oficiais a Invocação Normal é sempre em
  ataque com a face para cima; a única forma legal de pôr um monstro em defesa no
  próprio turno é setá-lo. Por isso as regras de defesa viram `setmonster`.
- **Ameaça** se mede só pelo que está **com a face para cima** (pelo ATK vivo,
  um monstro deitado não ataca ninguém, então contá-lo como ameaça deixaria o NPC
  medroso à toa. Isso **não** é mais o limite do que ele *sabe* — ver "Leitura",
  abaixo.
- **ATK/DEF são os de AGORA, não os impressos na carta.** Todo número que o
  cérebro compara (ameaça, alvo do ataque, quem ataca, o que vale tributar)
  sai de `InteractiveDuel.StatsEmCampo`, que **pergunta ao core** — Equip
  Spell, magia de campo e efeito contínuo já resolvidos. Ele lia
  `DatabaseManager.Stats(code)`, o statline do `cards.cdb`, e o sintoma era o
  NPC atacar um monstro do jogador que já valia mais do que ele: +700 de
  equipamento eram invisíveis, e ele entregava o corpo numa batalha que a
  conta dele dizia ganhar. Nada acusava — a TELA já mostrava o ATK certo
  (evento `stats`), só quem decide o ataque é que não via. Sem acessador
  (testes de decisão isolada, que montam campo só com códigos) cai no
  impresso, que é o comportamento antigo. Teste: `--test-atk-vivo`, com o par
  controle — o MESMO duelo sem o equipamento, onde ele tem de atacar.
- Cada jogada vira um evento `{type:"npc", action, why}`, que o front mostra no
  log com o motivo. É assim que se confere se ele está seguindo as regras.
- `POST /start {"npc": false}` volta ao oponente desligado (auto-passa), que é o
  modo de treinar sozinho.

Teste: `npm run duel:test` (ou `duel-server.exe --test-npc`) — 63 checagens, a
maioria de decisão isolada (cada regra em situação controlada, incluindo o caso
da parede que venceria atacando, o Ryu-Ran que atropela o campo e os controles
que mantêm o Aqua Madoor e a Mystical Elf deitados) mais um duelo real onde o
NPC usa os Potes, invoca por ATK, faz invocação com tributo e seta em defesa
quando ameaçado.

### Leitura (o NPC vê a mão e as cartas baixadas) — e o NÍVEL

**Decisão de projeto, deliberada:** um NPC **avançado** enxerga o que um humano
não veria — a **mão** do oponente (`HandOf`), os monstros **virados** com a DEF
real (`AllMonstersPos`) e as magias/armadilhas **setadas** com o código real
(`SetStOf`). Não é bug nem vazamento para a tela: é o que permite medir o impacto
de cada carta em vez de jogar às cegas. O front continua sem receber nada disso
(o `Oculta()` do `InteractiveDuel` segue mascarando o que vai para o cliente); só
o cérebro enxerga.

> **Iniciante × Avançado.** A dificuldade é escolhida por adversário (`level` em
> `npcs.js`, `npcLevel` no `POST /start`) e existe num ponto só: **qual acesso é
> plugado no `NpcBrain`**. O iniciante recebe a visão honesta (`HandHonesta`,
> `MonstrosHonestos`, `SetStHonesto`: do lado do jogador só o que está com a face
> para cima, do próprio lado tudo) e, sem conhecer as cartas, as quatro regras
> abaixo não têm o que avaliar e ficam quietas sozinhas — sem um único `if` de
> dificuldade espalhado pelas regras. Os dois jogam igual; só um sabe o que você
> tem. **O padrão é iniciante**, inclusive para todo NPC criado antes disto
> existir e para os 3 fixos.

Tudo passa por uma escala única, `PESO_AMEACA` — quanto uma magia/armadilha
atrapalha, **medido na unidade do ATK**. É o que torna comparável "a magia que ele
acabou de ativar" com "o monstro que ainda está na mão dele". Quem não está na
tabela pesa 0.

Quatro regras usam isso:

1. **Batalha.** O monstro setado entra na conta pela DEF real (antes era "risco
   assumido" e o Battle Ox se jogava contra uma parede de 2000). Armadilha
   conhecida muda a jogada: com uma que pune o atacante (Sakuretsu/Cylinder) ele
   ataca com o **mais barato que ainda vence**; com uma que varre o campo
   (Mirror Force) ele **não ataca com vários** — mas ataca com **um só**, para
   puxá-la. Nunca atacar travaria o duelo até o deck acabar.
2. **A isca.** O golpe clássico contra bot é queimar uma carta média para o NPC
   gastar a negação nela. Agora ele compara o peso do gatilho com a maior ameaça
   na mão do oponente e **segura**, com dois limites para não virar paralisia:
   some o efeito se ele tiver 2+ negações baixadas, e acima de `PESO_INEGOCIAVEL`
   (2500) ele nega de qualquer jeito — deixar um Raigeki resolver "porque pode vir
   coisa pior" é perder hoje para se proteger de amanhã.
3. **Remoção direcionada.** O Dust Tornado/MST só sai se existir alvo que pese
   (antes bastava "ele tem alguma coisa setada"), e o `DecideSelect` **mira** na
   carta escolhida — sem isso ele estourava a primeira zona da lista, já que
   magia/armadilha tem ATK 0 no critério genérico.
4. **Não se estender.** Com Raigeki/Dark Hole na mão dele, o NPC não põe o segundo
   corpo em campo (os dois sairiam na mesma carta); com Heavy Storm/Harpie's, não
   seta a segunda armadilha. Só segura quando já tem campo que dá conta — estando
   atrás, precisa arriscar.
5. **Formação de isca.** O complemento da regra 1: em vez de só recusar o ataque
   contra uma Mirror Force baixada, ele **deita os outros e ataca com um só**
   (`reposition`, comando 2 do SELECT_IDLECMD). Em defesa os grandes ficam fora
   do alcance da varredora, e quem fica de pé é o mais barato que ainda GANHA a
   batalha — precisa vencer, senão a `DecideBattle` não declara ataque nenhum e a
   armadilha nunca sai. Casa a opção do motor pela **`sequence`**, não pelo
   código: dois Battle Ox iguais não se distinguem de outro jeito.

> Sem os acessos de leitura ligados, **todas simplesmente não fazem nada** e
> nenhuma dá erro. Por isso `--test-leitura` termina em duelos reais: um onde o
> NPC recusa o ataque **citando o código da carta virada** (prova positiva de que
> o encanamento chegou), o MESMO duelo no nível iniciante — onde ele ataca a
> parede às cegas, provando que a dificuldade é real — e um terceiro onde o motor
> **aceita** a mudança de posição (errar o comando `2` não dá erro: vira
> MSG_RETRY e a jogada some).

Teste: `duel-server.exe --test-leitura` — 29 checagens.

### Armadilhas de contra (negação)

A Lista 1 tem quatro: **Solemn Judgment** (metade dos LP, nega invocação *ou*
magia/armadilha), **Magic Jammer** (descarta 1, nega Magia), **Seven Tools of the
Bandit** (1000 LP, nega Armadilha) e **Horn of Heaven** (tributa 1 monstro, nega
invocação). O motor abre a janela delas sozinho na hora certa, então o problema
não é *quando pode* — é **se compensa**: ativar por ativar joga a carta (e, no
caso do Solemn, metade da vida) fora.

`NpcBrain.EscolheNegacao` decide em três perguntas, nesta ordem:

1. **O que abriu a janela?** Vem de `Question.chainTrigger*` (ver §4). Sem essa
   informação, ou se o gatilho for do PRÓPRIO NPC, ele **não nega** — no escuro,
   guardar é sempre melhor que chutar.
2. **Aquilo vale?** Invocação se mede sozinha: nega só o que tem **ATK ≥ 1800**
   *e* que o campo dele não supera (se ele já tem algo maior, a batalha resolve de
   graça). Magia e armadilha não dá para medir — o efeito mora no Lua —, então vão
   por lista fechada (`MAGIA_PERIGOSA` / `ARMADILHA_PERIGOSA`): só o que varre o
   campo, rouba, revive ou nega. O silêncio da lista significa "não vale", que é
   o erro barato.
3. **Dá para pagar?** Nenhum custo pode levar abaixo de **1000 LP**; o Horn só
   sai se o monstro que ele tributaria (o mais fraco, que é o que o `DecideSelect`
   sacrifica) valer menos que o que está sendo negado. Entre as que servem, escolhe
   a **mais barata** (`Contra.Ordem`) — Magic Jammer antes de Solemn Judgment
   contra uma magia, e o Solemn fica para o que só ele resolve.

Duas notas de manutenção:
- A tabela `CONTRA` vai **por ID, não pelo bit TYPE_COUNTER**. O Negate Attack
  também é Armadilha de Contra, mas o gatilho dele é uma *declaração de ataque* —
  pela regra genérica ele já é ativado na hora certa; se entrasse pelo tipo, a
  avaliação acima não acharia gatilho e o NPC pararia de usá-lo.
- A negação é a única que pode **furar a regra de "uma carta por cadeia"**: se o
  oponente encadeou algo por cima da carta que o NPC acabou de ativar, negar é
  exatamente o caso em que somar uma segunda carta não é desperdício.

Teste: `duel-server.exe --test-counter` — 17 checagens de decisão isolada e 8 de
dois duelos reais (negar uma invocação e negar um Raigeki). Os duelos reais estão
lá por um motivo específico: se o contexto da janela parar de chegar, nenhuma
regra acusa nada — o sintoma seria só "ele nunca mais usou Solemn Judgment".

> **Compile com o servidor parado.** O `.exe` fica travado enquanto roda e o
> `dotnet build` falha — mas o teste seguinte roda o binário ANTIGO e parece que
> a mudança não funcionou. Use `npm run duel:build` / `npm run duel:test`, que
> derrubam o servidor antes. Pelo mesmo motivo o launcher agora escolhe o build
> **mais recente** (antes preferia Release, e subia um binário de horas atrás) e
> imprime a data do que subiu.

## 2. Como rodar

**Atalho (Windows):** duplo clique em `duel-academy.exe` na raiz — sobe os dois
servidores, confere 200 OK em cada um, abre a página e fecha sozinho.
`duel-academy-stop.exe` encerra tudo de forma limpa. Se os exes não existirem,
`npm run launcher:build`. Fonte em `launcher/` (um `Program.cs` gera os dois).

Na mão:
```bash
# 1) front estático (raiz do repo)
npm run dev                       # http://localhost:8080

# 2) servidor de duelo (noutro terminal)
cd duel-server
dotnet run -- --serve             # http://localhost:8770

# abrir: http://localhost:8080/web/duel.html  (ou Home → opção 5 "Treino de duelo")
```
Requisitos: .NET SDK 8, Node >=18, **Windows x64** (a `ocgcore.dll`/`sqlite3.dll` são
nativas Win-x64, ficam em `duel-server/native/`).

**Encerramento limpo:** `POST /shutdown` no duel-server (libera a memória nativa do
ocgcore via `Dispose` antes de sair) e `POST /__shutdown` no front (só aceita de
localhost). É o que o `duel-academy-stop.exe` usa; o kill por PID é só o último
recurso, se o servidor não responder em 8s.

Modos do exe: sem args = demo no console; `--serve` = servidor web; `--selfplay` =
harness de diagnóstico que joga sozinho e despeja as mensagens do motor (foi assim
que o protocolo abaixo foi decifrado — use pra achar novos formatos).

## 3. Arquitetura

**C# (`duel-server/src/`):**
- `YgoCoreAPI.cs` — P/Invoke da `ocgcore.dll` (edo9300).
- `DatabaseManager.cs` — lê `cards.cdb` (SQLite P/Invoke) no callback de carta.
- `ScriptManager.cs` — serve os `.lua` no callback; **e pré-carrega os globais**.
- `DuelSession.cs` — cria o duelo, **pré-carrega `constant.lua`+`utility.lua`**,
  **embaralha o deck** (o ocgcore NÃO embaralha), injeta, inicia. `Step()`/`Respond()`.
- `InteractiveDuel.cs` — **o coração**: `Advance()` dá passos até a SUA decisão,
  resolve o oponente (auto-passa) e as correntes (-1), e parseia as mensagens em
  eventos + a "pergunta pendente". `Respond(action,arg)` codifica a jogada.
- `WebServer.cs` — HttpListener, modelo **RPC**: `POST /start {deck,seed?,flags?}` e
  `POST /respond {action,arg}` → `{events:[...], question:{...}|null, ended}`.
  Default `flags = NO_HAND_LIMIT (0x1000000)`.
- `SelfPlay.cs` — harness de diagnóstico do protocolo.

**Web (`web/duel.html`):** carrega o deck escolhido, desenha o campo (zonas M/S/F dos
2 lados, cemitério clicável, LP), traduz eventos→estado e mostra as ações da carta
selecionada (Invocar/Utilizar/Setar).

### A barra do topo: informação, e um botão só

Ela guarda **informação** (conexão e turno) e **um** botão: `desistir`. Os
CONTROLES desceram para a mesa — botões de fase e modo das correntes são caixas
posicionáveis no editor de campo, fases e LP moram na `mid`, e o nome/efeito da
carta no inspetor à esquerda.

Saíram os botões que repetiam algo ou não serviam no meio de um duelo:
`encerrar turno` (o `⏭ End Phase` da caixa de fases faz o mesmo), `novo duelo`
(a tela de fim já oferece) e o seletor de deck — o duelo passou a usar sempre o
deck **ativo**, escolhido no Deck Builder, que é um lugar só em vez de dois que
podiam discordar.

**`desistir` é a única saída, e isso é a regra**: ela encerra o duelo direito
(registra a derrota no servidor, fecha a partida online) e só então a tela de
fim oferece `[novo duelo]` ou `[voltar para a home]`. O `← home` que existia
solto na barra pulava esse encerramento e deixava duelo pendurado. No online,
"novo duelo" leva ao matchmaking em vez de reabrir a sala que acabou de fechar.

### Inspetor: a carta sob o mouse (`web/duel.html`)

O painel do Tag Force / YGOPro, fixo à esquerda: passou o mouse, leu a carta —
sem clique, sem janela. Vale para a mão, o campo dos dois, o cemitério, o Extra
e as janelas de seleção/corrente.

- **A regra de sigilo é o próprio dado.** `espiar(el, code)` só é ligado onde o
  código é conhecido de direito, e o código da carta virada do OPONENTE chega ao
  front como `0` (a `Projetar` do servidor apaga na saída, uma vez por
  espectador). A sua carta virada chega inteira — e mostrá-la não é vantagem, é
  memória. Não há decisão de sigilo na tela: ela mostra o que recebeu.
- **O texto do efeito exige o banco completo** (~14 MB); o índice enxuto já traz
  nome, tipo, ATK/DEF, nível, atributo e raça. O `duel.html` carrega o completo
  em SEGUNDO PLANO no boot e o entrega à janela de detalhes
  (`configureCardDetail({ full })`) — sem isso a mesma página carregaria os
  mesmos 14 MB duas vezes, uma para o inspetor e outra no primeiro toque longo.
- **O Extra Deck consultável** (`openExtra`) não vem do motor: ele nunca manda o
  conteúdo do Extra, e faz bem — para o oponente aquilo é informação escondida.
  Quem sabe é a tela, que carregou o deck no `/start`; daí em diante
  `extraCards` acompanha o `move` nas duas direções (quem é invocada sai, quem
  volta entra). Só o SEU Extra abre; o do oponente continua fechado.

### Ritmo e correntes (`web/duel.html`)

Duas coisas que mudam o *como se joga*, não o que é jogado:

- **Concorrência: uma visão de cada vez** (`web/js/filavisoes.js`). No modo NPC
  a visão chega como retorno da própria jogada; no MULTIPLAYER ela chega por
  canal, a qualquer momento. Enquanto aplicar era instantâneo isso não
  incomodava — passou a incomodar quando o `apply` começou a ESPERAR por dentro
  (o aviso de fase). Duas aplicações se sobrepunham e a mais VELHA terminava por
  último, escrevendo `question` do estado antigo por cima do novo: a janela de
  corrente sumia da tela e o duelo travava esperando uma resposta impossível
  (aconteceu em 17/08/2026, com 1,15 s entre a End Phase e a janela da Aegis).
  As TRÊS entradas (`/start`, `/respond` e a visão da ponte) passam pela fila.
  9 testes em Node, incluindo um que prova que **sem** a fila o bug acontece.
- **O aviso de fase segura o duelo.** `avisoFase()` é `await`-ado dentro do laço
  de eventos do `apply()`, que roda com `busy = true` — enquanto a faixa está na
  tela, nenhum clique passa pelo `act()`. Com visão ESPERANDO na fila ele deixa
  de segurar (só aparece): aí a pausa não é mais ritmo, é atraso — quem espera
  passa a ser o duelo inteiro, não o jogador olhando a tela. Antes era um `setTimeout` solto: os
  eventos continuavam entrando por baixo e a rajada de fim de turno
  (turno → draw → standby → main) passava numa piscada, sem dar tempo de ler.
  Os tempos estão em **`AVISO_MS`** (turno 1500 ms, fase 1100 ms, carta 1200 ms) —
  é o botão de volume do ritmo, e é de propósito que seja um lugar só.
- **A carta ativada aparece grande no meio da tela** (`revelarAtivacao`), no
  mesmo espírito do Tag Force: acende na zona, vem ao centro por um instante, e
  só então o efeito resolve. Não pede clique — quem segura o duelo é o mesmo
  `await` do laço de eventos. O gatilho é o evento **`chaining`** (MSG_CHAINING),
  e não o `move`: o `move` só existe para a carta que TROCA de lugar, então
  armadilha já baixada e efeito de monstro em campo não acendiam nada e a jogada
  do oponente passava sem o jogador ver a causa, só o resultado.
- **Modo das correntes** (`web/js/correntes.js`, preferência em
  `ygo:chainMode`, caixa no TABULEIRO — zona de UI `correntes`, posicionável no
  editor de campo como os botões de fase). Nasceu de uma Forgotten Temple of
  the Deep perguntando a cada fase, todo turno, enquanto houvesse monstro em
  campo. Os três modos são **os do Master Duel/EDOPro**, com o mesmo sentido —
  e **nenhum deles ativa carta por você**: em jogo nenhum de Yu-Gi-Oh existe
  "encadeia sozinho" (encadear na hora errada perde duelo). O que muda é QUANDO
  o jogo pergunta:

  | modo | equivalente | o que faz |
  |---|---|---|
  | `off` | MD "OFF" / EDOPro "Chain: OFF" | não pergunta por efeito opcional nenhum |
  | `auto` | MD "Auto" (**padrão** lá e aqui) | pergunta nos 4 momentos que importam |
  | `on` | MD "ON" / EDOPro "Chain: ON" | pergunta em toda janela que o motor abrir |

  Os quatro momentos do `auto`: **invocação** e **ativação** saem do
  `chainTrigger*` que o motor já manda; o **ataque declarado** vem do evento
  `attack` (é o único que não está na própria pergunta, por isso o
  `ataqueDeclarado` no `duel.html`, zerado a cada turno e a cada janela
  respondida); e a **End Phase do oponente**, a hora clássica do MST baixado.

  A janela **obrigatória** (`chainForced`) ignora o modo e sempre pergunta — ali
  não existe passar, e responder sozinho escolheria a carta pelo jogador. Quem
  responde é o `apply()`, junto das outras auto-respostas, porque só lá a trava
  de `busy` já foi solta. Regra sem DOM e com 16 testes:
  `node web/js/correntes.test.mjs`. `manual` era o nome antigo do `on` e é
  migrado por `normalizarModo`.
- A janela de corrente diz **por que abriu**: o gatilho (`chainTrigger*`, o mesmo
  que o `NpcBrain` usa para decidir a negação) vira "Seu oponente ativou X"; sem
  gatilho, foi a mudança de fase, e o texto é "Seu oponente está indo para a
  Battle Phase — deseja ativar uma carta?". **`chainTriggerPlayer` nomeia jogador**,
  então entrou em `CAMPOS_DE_JOGADOR` (`web/js/ponte.js`): sem espelhar, o
  segundo jogador do multiplayer leria a frase com os lados trocados.

## 4. Protocolo ocgcore (edo9300, DLL 11.0) — DECIFRADO empiricamente

Buffer de `OCG_DuelGetMessage`: sequência de `[int32 len][byte type][payload]`.
`OCG_DuelProcess` retorna 0=END, 1=AWAITING, 2=CONTINUE.

**SELECT_IDLECMD (11):** `type(1) player(1)` + **6 listas** nesta ordem:
summon, spsummon, **reposition**, mset (set monstro), sset (set magia/arm), activate.
Depois **3 bytes de flag** (to_bp, to_ep, shuffle).
- Resposta = `(índice << 16) | comando`. Comandos: **0** summon · **1** spsummon ·
  **2** mudar posição · **3** mset · **4** sset · **5** ativar · **6** ir pra Battle ·
  **7** End Phase. No `SELECT_BATTLECMD`: **0** atacar · **1** ativar · **2** ir pra
  Main 2 · **3** End Phase.
- Entradas de mão (summon/spsummon/mset/sset) = **10 bytes**: `code(4) ctrl(1) loc(1) seq(4)`.

> **As regras de "quando pode virar" são do motor, não nossas.** Um monstro
> invocado neste turno simplesmente não entra na lista `reposition`; uma
> armadilha baixada agora não entra em `activatable`, e uma magia normal entra.
> Basta desenhar o que o motor ofereceu — reimplementar isso do lado de fora
> seria duplicar regra e errar.
- Entradas de **reposition = 7 bytes** (`seq` de 1 byte, é carta no campo) ⚠️ (bug já
  corrigido — ler repos como 10 desalinhava tudo do turno 3 em diante).
- Entradas de **activate = 19 bytes**: `code(4) ctrl(1) loc(1) seq(4) description(8)
  client_mode(1)`. ⚠️ O `client_mode` é fácil de esquecer: com 18 bytes a lista
  desalinha a partir da **segunda** carta, e o sintoma é "só a primeira magia da mão
  pode ser ativada" — sem erro nenhum. Confirmado na fonte e medido com `--probe-idle`.

> **Como medir isso sem chutar:** a mensagem termina em 3 bytes de flag, então o
> cursor tem de parar exatamente em `fim - 3`. `--probe-idle` testa as combinações
> de tamanho e diz qual fecha a conta; ele só é conclusivo quando as listas em
> questão não estão vazias (por isso ele joga, em vez de só passar o turno).
> O `ParseIdle` agora faz essa verificação sozinho e grita no log se desalinhar.
- Resposta = **int32 `(índice << 16) | comando`**: 0=Normal Summon, 3=set monstro,
  4=set magia/arm, 5=ativar, **7=encerrar turno**, 6=ir pra Battle (provável).

**SELECT_PLACE (18):** `player(1) count(1) flag(4)`. No flag, bits 0-4 = zonas de
monstro proibidas, **bits 8-12 = zonas de magia/armadilha**. Zona de campo = SZONE
`seq=5`. Resposta = **3 bytes** `[player, location, sequence]` (loc 0x4=MZONE, 0x8=SZONE).

**Seleção de cartas — SELECT_CARD (15), SELECT_TRIBUTE (20), SELECT_SUM (23):**
resposta `[int32 tipo][uint32 quantidade][índices…]`.
`tipo` 0 = índices uint32, 1 = uint16, 2 = uint8, 3 = bitfield, **-1 = cancelar**.
> **O prefixo de tipo era o que faltava.** Sem ele o motor devolve MSG_RETRY para
> qualquer buffer, por mais correto que o resto pareça — foi por isso que as 8
> tentativas anteriores (e mais 30 minhas) falharam. Fonte: `parse_response_cards`
> em `playerop.cpp` do edo9300/ygopro-core. `returns.at<T>(i)` indexa por
> ELEMENTO, então os índices sempre começam no byte 8, seja qual for a largura.

Mensagem dos três: `type(1) player(1) cancelable(1) min(4) max(4) count(4)` +
entradas. Entrada = 10 bytes no SELECT_CARD, **11** no SELECT_TRIBUTE (o byte
extra é quantos tributos a carta vale), **14** no SELECT_CARD de alvo de ataque
(as 10 usuais + posição) e **18** no SELECT_SUM (`code(4) + info_location(10) +
sum_param(4)`). **Deduza o tamanho pelo comprimento da mensagem** em vez de
assumir — ele varia com o contexto, como a lista acima mostra.

> **O byte 10 só é "release" no SELECT_TRIBUTE.** Nas entradas de 14 bytes do
> SELECT_CARD o mesmo byte é a **posição** (deck = `0x8`, mão = `0xa`, campo
> aberto = `0x1`/`0x4`) — e ela nunca é zero. Ler os dois do mesmo jeito
> (`entry >= 11 ? d[p+10] : 1`, que foi o que `ParseSelectCards` fez até
> 14/08/2026) faz **toda** seleção de carta chegar ao `NpcBrain` parecendo um
> tributo, e num tributo ele sacrifica o mais FRACO. O sintoma é exatamente o
> da armadilha do começo desta seção: nenhum erro, nenhum log, só a jogada
> errada — o Summoner's Art buscava o Parrot Dragon (2000) em vez do Ryu-Ran
> (2200) enquanto o log dizia 2200, e as prioridades de busca do Toon World e
> do Cocoon nunca rodavam num duelo de verdade (o ramo do tributo vinha antes
> delas). Guarda de regressão: `--test-pegasus`.

**SELECT_UNSELECT_CARD (26):** o seletor incremental do core novo — é ele que o
tributo usa de fato. Escolhe-se UMA carta por vez e o motor repergunta.
Mensagem: `type(1) player(1) finishable(1) cancelable(1) min(4) max(4)` +
`count(4)`+entradas de **14 bytes** (selecionáveis) + `count(4)`+entradas (já
escolhidas, para desmarcar).
Resposta: **`[int32 1][int32 índice]`** — o primeiro campo tem que ser
**exatamente 1**; `0` ou `>1` devolve RETRY. `[int32 -1]` encerra/cancela.

**SELECT_SUM (23):** ritual. As cartas escolhidas têm de **somar exatamente** o
`acc` pedido (nível), descontando as obrigatórias. Precisa de subconjunto-soma,
não de escolha gulosa. Entrada da mensagem = 18 bytes (`code(4) +
info_location(10) + sum_param(4)`), e o `sum_param` é o nível que a carta soma.

Quem escolhe os tributos é o **jogador**: a pergunta vai para o front com o nível
de cada carta e um contador de "somados / alvo". Só resolvemos sozinho quando há
uma única combinação possível — aí perguntar seria uma etapa sem decisão.

**SELECT_BATTLECMD (10):** `type(1) player(1)` + lista de **ativáveis** (19 bytes,
igual ao idle) + lista de **atacantes** (**8 bytes**: `code(4) ctrl(1) loc(1)
seq(1) podeAtacarDireto(1)`) + **2 flags** (pode Main 2, pode End).
⚠️ Como a lista de ativáveis vem primeiro, **ativar é o comando 0 e ATACAR é o 1**
— o contrário do que a intuição sugere. Atacar com `0` dá RETRY silencioso.

Fluxo do ataque: `attack (índice<<16|1)` → o motor pede o **alvo** num
`SELECT_CARD (15)` (entradas de **14 bytes** aqui: as 10 usuais + posição) →
responde-se com o formato normal de seleção → o combate resolve.

**MSG_ATTACK (110):** atacante`{ctrl(1)loc(1)seq(4)pos(4)}` + alvo`{...}`.
**MSG_BATTLE (111):** por lado, `loc(10) atk(4) def(4) destruido(1)` = 19 bytes.
Traz ATK/DEF dos dois e quem morreu — o motor já resolveu tudo, isto é só relato.
Dano, destruição e ida ao cemitério vêm de graça (MSG_DAMAGE + MSG_MOVE).

**SELECT_CHAIN (16):** resposta `int32 -1` (não encadear).
⚠️ A janela lista **só as suas cartas ativáveis** — ela NÃO diz a que elas
responderiam. Quem sabe disso são as mensagens que vêm ANTES, no mesmo buffer:
**MSG_SUMMONING (60)** / **MSG_SPSUMMONING (62)** (invocação em andamento) e
**MSG_CHAINING (70)** (carta que acabou de ser ativada). As três começam igual —
`code(4)` + `loc_info`, cuja **primeira posição é o controlador** —, então
`code = int32 @ +1` e `controller = byte @ +5` valem para todas, sem depender do
resto do layout (que muda entre mensagens: veja o `seq` de 1 byte do MSG_POS_CHANGE).
`InteractiveDuel` guarda esse gatilho e o entrega em `Question.chainTrigger{Kind,Code,Player}`;
ele é limpo em MSG_SUMMONED (61), MSG_SPSUMMONED (63), MSG_CHAIN_END (74) e a cada
turno novo — gatilho velho é pior que gatilho nenhum, faria o NPC "negar a
invocação do turno passado".
O MSG_CHAINING também vira **evento de tela** (`{type:"chaining", code, controller}`):
é o ÚNICO ponto em que o motor diz "esta carta foi ativada" para qualquer ativação.
O `move` não serve de substituto — uma armadilha já baixada não troca de lugar ao
ser ativada, e um efeito de monstro em campo não move nada. Coberto por
`--test-chain` (a Mirror Force ativada tem de aparecer no evento, com `controller = 0`).
**SELECT_POSITION (19):** resposta `int32 posição` (POS_FACEUP_ATTACK=0x1).
**MSG_MOVE (50):** `code(4)` + prev`{ctrl(1)loc(1)seq(4)pos(4)}` + curr`{...}` + reason(4)`.
**MSG_POS_CHANGE (53):** `code(4) ctrl(1) loc(1) seq(1) posAnterior(1) posAtual(1)`.
⚠️ O `seq` aqui tem **1 byte**, ao contrário do MSG_MOVE, onde tem 4. Mudança de
posição NÃO emite MSG_MOVE — sem tratar o 53, a carta vira no motor e não na tela.
Medido com `--probe-pos`.
**MSG_DRAW (90):** `player(1) count(4)` + por carta `code(4) status(4)` (bit 0x80000000=oculta).
**MSG_DAMAGE(91)/RECOVER(92)/PAY_LPCOST(100):** `player(1) amount(4)`. LP começa 8000.
**MSG_TOSS_COIN (115):** `player(1) count(1) res(count bytes)` (1 = Cara / Heads, 0 = Coroa / Tails). Emitido em efeitos como o Mago do Tempo.
**MSG_TOSS_DICE (116):** `player(1) count(1) res(count bytes)` (resultados de 1 a 6).
NEW_TURN=40, NEW_PHASE=41 (int16), SUMMONING=60, SUMMONED=61.

**Constantes (`.../YGODemo/script/constant.lua`):** LOCATION_MZONE=0x4, SZONE=0x8,
HAND=0x2, GRAVE=0x10, FZONE=0x100; POS_FACEUP_ATTACK=0x1, FACEDOWN_DEFENSE=0x8;
PHASE_MAIN1=0x4, BATTLE=0x80, END=0x200.

### Descobertas-chave (não óbvias, custaram caro)
1. **Efeitos só funcionam se pré-carregar `constant.lua` e `utility.lua`** — a DLL
   NÃO os pede pelo callback; sem eles `aux`/constantes ficam nil e os efeitos das
   cartas falham ao se registrar (a carta fica só *setável*, nunca *ativável*).
2. **O ocgcore não embaralha o deck** — a seed não muda a mão. Embaralhamos nós.
3. **RNG usa 4 seeds** (seed0..3) — derivadas via splitmix64.
4. **Deck de teste precisa de monstros Nv≤4** (Nv5+ exige tributo → nada invocável
   no turno 1). Vanilla Nv4: Battle Ox 5053103, Mystical Elf 15025844, La Jinn 97590747.

## 5. O que FUNCIONA (validado)

- Criar duelo com o deck do jogador, **mão aleatória** por partida.
- **Invocar** monstro (clicar carta → Invocar → escolher zona), regra "1 summon/turno"
  aplicada pelo motor.
- **Setar** monstro (deita, horizontal) e magia/armadilha (em pé, vertical).
- **Utilizar** magia da mão quando a condição está OK (o motor decide) → resolve o
  efeito. Ex.: **Pot of Greed compra 2**, **Tremendous Fire tira 1000/500 de LP**.
- **Zona de campo**, **cemitério** (pilha clicável mostrando as cartas).
- **LP** dos dois lados (8000 → atualiza no dano; log diz quem venceu).
- **Turnos rodam sem travar** (NO_HAND_LIMIT evita o descarte por limite de mão).
- **Parse correto do turno 3+** (bug do reposition 7-byte corrigido).
- Erros de JS agora aparecem numa barra vermelha (não trava mais em silêncio).

## 6. O que FALTA / bugs conhecidos (prioridade)

1. **Replicar a batalha para o NPC** — hoje ele invoca e defende, mas nunca ataca.
   A decisão vai no `NpcBrain`, na mesma forma das outras regras.
2. **Tela de vitória** — falta achar o id do `MSG_WIN`; hoje o fim é detectado
   pelo status END e o vencedor é inferido pelos LP.
3. **`SELECT_YESNO/EFFECTYN/OPTION` (12/13/14)** — hoje "não suportado"; quando
   aparecer (efeitos opcionais), tratar.
4. **Ativar magia/armadilha JÁ SETADA no campo** (hoje só ativa da mão).
5. **Cartas customizadas do usuário** (Kuriboh etc.) — precisam de Lua manual
   (Estágio 2, ver `continue.md`); as cartas da **Lista 1** são reais e já funcionam.

### Resolvido (era o item 2 e 3 desta lista)

**Invocação por TRIBUTO e RITUAL funcionam.** O bloqueio era o formato de resposta
da seleção de cartas, agora decifrado (seção 4) a partir da fonte do ocgcore em vez
de tentativa e erro. Com isso vieram juntos o descarte por limite de mão e a base
para cartas com alvo — todos usam o mesmo `parse_response_cards`.

Teste de aceitação: `duel-server.exe --test-summons` (6 checagens; joga de verdade
pelo `InteractiveDuel`, confirma que os tributos vão ao cemitério e que o monstro
entra em campo). As sondas `--probe-tribute` e `--brute-tribute` ficaram no
repositório para quando aparecer a próxima mensagem desconhecida.

> Lição: **força bruta contra biblioteca nativa não presta.** Depois de ~785
> respostas malformadas o ocgcore estourou com SEHException — ou seja, o estado
> dele já estava corrompido e os RETRYs anteriores não eram confiáveis. Ler a
> fonte resolveu em duas consultas o que a busca não resolveria nunca.

## 6.1. Onde os decks moram (mudou)

Decks agora são **arquivos `.ydk` em `decks/`**, versionados no git — não mais
localStorage. `decks/npc/<npcId>/*.ydk` para os adversários, `decks/player/*.ydk`
para os seus. Metadados nossos (nome, npc, carta que dropa) vão em comentários
`#chave valor`, que qualquer parser de `.ydk` ignora — o arquivo segue válido no
EDOPro.

A gravação é feita pelo servidor de desenvolvimento (`/__decks/save`, só
localhost, só `.ydk` dentro de `decks/`). Sem ele no ar, o Deck Builder baixa o
arquivo para você mover na mão. `web/js/projectdecks.js` é a camada cliente;
`web/js/npcs.js` hidrata um cache em memória com `loadNpcDecks()` no boot, para
os consumidores seguirem síncronos.

No `localStorage` restaram só preferências locais: qual deck de cada NPC está
ativo, e os decks do jogador em edição. Decks antigos que ficaram presos no
navegador aparecem na página de NPCs com um botão **"migrar para o projeto"**.

## 7. Onde mexer

- Novo tipo de pergunta do motor não tratado → aparece como "unsupported" no front.
  Rode `duel-server.exe --selfplay` (ou adicione o tipo ao dump em `SelfPlay.cs`),
  ache o formato de resposta, e trate em `InteractiveDuel.Parse()` + `Advance()`.
- A Lista 1 (pool jogável) está em `web/js/lista1.js`. Todas são cartas reais com
  script no ocgcore — funcionam sem Lua custom.
