# Mesa viva — deixar o duelo parecido com um duelo

> Referência declarada: **Yu-Gi-Oh! Tag Force**. Não é cópia de arte — é cópia
> de **leitura**: onde o olho procura cada informação e quantos cliques custa
> uma jogada.

O duelo já é correto (quem decide as regras é o `ocgcore`). O que faltava era
ele *parecer* um duelo: o placar espalhado, o cemitério como um número, e um
modal no meio da tela toda vez que se toca numa carta.

O trabalho está separado em duas fases por um motivo prático: o que a **Fase 2**
tem em comum é criar **zona nova no schema de tabuleiros** (`web/js/boards.js`)
e, portanto, passar pelo **editor de campo do admin** (`web/campo.html`) e por
todo `boards/*.json` já gravado.

A Fase 1 começou inteira dentro de `web/duel.html`; o item 1.4 (a pilha de
banidas) foi promovido para cá quando você pediu, e é o primeiro que atravessou
o editor.

---

## Fase 1 — feita

### 1.1 Placar no topo *(só `duel.html`)*: `LP você · TURNO n · LP adversário`

Uma faixa fixa (`.hud`) entre a barra de cima e a mesa, com o nome de cada
duelista, o total de LP, uma barra proporcional e o número do turno no meio.

- Fica **fora da `.arena`** de propósito: a arena tem `zoom: 1.25` e um layout
  que pode vir do editor de campo. O placar não é zona de carta — nenhuma carta
  "mora" ali — e não pode depender de para onde alguém arrastou a barra do meio.
- Por isso os LP **saíram da `mid`**: dois lugares mostrando o mesmo número
  seriam duas verdades para manter em sincronia. A `mid` ficou só com a FASE, e
  o rótulo dela no editor mudou de "Fases / LP" para "Fase".
- O HTML do placar é montado **uma vez** e só atualizado (`atualizarHud()`).
  Reconstruí-lo a cada `render()` mataria a animação da barra: a transição de
  CSS precisa do mesmo elemento nos dois estados.
- **O golpe aparece**: `pulsarLp()` treme a faixa atingida e sobe o número do
  dano (`−1800`). Ele é chamado do evento `lp`, e não do `render()`, porque
  quem sabe *quanto* mudou é o evento — o render só conhece o total depois.
  Sem isso, um ataque de 1800 e um de 200 eram visualmente idênticos.
- O rótulo `turno: VOCÊ` saiu da barra do topo: quem diz de quem é a vez agora
  é o lado **aceso** do placar.

### 1.2 Cemitério com a última carta no topo *(só `duel.html`)*

`pileEl()` desenha a arte da carta mais recente com o contador virando um selo
no canto. O array `f.g` cresce por `push` (evento `move`), então o topo é o
**último** elemento, não o primeiro.

Passar o mouse já lê a carta no inspetor; clicar continua abrindo a pilha
inteira — agora ordenada **da mais nova para a mais velha**, a mesma ordem que a
miniatura anuncia.

### 1.3 O menu da carta (a "janelinha") *(só `duel.html`)*

Clicar numa carta abre um quadro **colado nela**, com seta apontando para a
carta, em vez do modal central que cobria a mesa justamente na hora de decidir.

| onde | o que aparece |
|---|---|
| mão (monstro) | **Invocar** · Posicionar · Detalhes |
| mão (magia/armadilha) | **Ativar** · Posicionar · Detalhes |
| campo, virada | **Virar para Ataque** · Detalhes |
| campo, em ataque | **Mudar para Defesa** · Detalhes |
| campo, em defesa | **Mudar para Ataque** · Detalhes |
| campo, sem jogada | Detalhes |

- Quem decide **quais linhas existem** continua sendo o motor: elas saem de
  `question.summonable` / `settable` / `activatable` / `repositionable`. Nada
  é inventado aqui.
- **"Detalhes" é novo e importante**: até agora a única forma de ler uma carta
  era o toque longo, um gesto que ninguém descobre sozinho.
- O rótulo de posição **diz a verdade em vez de perguntar**. O motor tem um
  comando só (`reposition`) e as regras decidem o resultado; oferecer duas
  opções seria mentira, porque a segunda ele recusaria. A regra virou módulo
  próprio, `web/js/posicao.js`, provado por `node web/js/posicao.test.mjs`
  (11 asserções) — um rótulo errado não quebra nada, só promete ao jogador uma
  jogada diferente da que vai acontecer, e nenhum teste de duelo acusaria.
- Arrastar até a zona continua funcionando e abre o menu **na zona de destino**,
  que é onde o olho está.
- O menu **nunca** cobre o clique de ATACAR: na Battle Phase ele não é ligado.
- Ele fecha sozinho quando a pergunta do motor muda (`apply`), no clique fora e
  no `Esc`. Fechar sem escolher desfaz a mão selecionada e a zona pendente do
  arrasto.
- O `#pos-overlay` **continua existindo**, e só para a pergunta de POSIÇÃO do
  motor (`SELECT_POSITION`, Ritual/Invocação Especial): aquela é modal de
  verdade — recusar trava o duelo.

**Sai de cena:** a `.actbar` do rodapé e o estado `selectedField`. O rodapé
voltou a ser só o aviso do que se espera de você.

### 1.4 Pilha de BANIDAS (`LOCATION_REMOVED`, 0x20) *(passou pelo editor)*

Este é o primeiro item que **passou pelo editor**: `p0:banido` / `p1:banido`
entraram no schema (`web/js/boards.js`), então a zona aparece sozinha no editor
de campo — `campo.html` e `campoeditor.js` enumeram tudo por `allZoneIds()` — e
o admin a posiciona onde quiser.

- **Tabuleiro já salvo não perde nada.** O backfill que já existia
  (`backfillMissingZones` no editor, `loadActiveBoard` no duelo) copia a
  posição do `defaultLayout()` para toda zona ausente. Os quatro
  `boards/*.json` do repositório receberam a nova sem conflito com nada que já
  estava posicionado. Esse par — zona no schema **e** posição no padrão — passou
  a ser guardado por `node web/js/boards.test.mjs`.
- Na mesa ela desenha como o cemitério: carta do topo à vista, total num selo,
  clique abre a pilha inteira (da mais nova para a mais velha). As duas pilhas
  agora ladeiam a fileira de monstro — banidas à esquerda, cemitério à direita.
- **Banir com a face para baixo existe**, e é a razão de a regra ter virado
  módulo (`web/js/banimento.js`, `node web/js/banimento.test.mjs`): a carta
  virada do adversário chega com `code: 0` (`Projetar`) e é desenhada como
  verso; quando ela **volta**, volta com o código real e não casa com nenhuma
  entrada da pilha. Sem tratar esse par ela ficaria encalhada para sempre e o
  contador mentiria pelo resto do duelo.
- A pilha do adversário fica igualmente visível: banimento é informação pública
  pelas regras, e o único segredo é o que o próprio dado já esconde.

---

## Fase 2 — precisa do editor de campo (não feita)

Cada item aqui cria zona nova no schema. Duas coisas valem para **todos**:

> **Zona nova precisa de posição padrão em `defaultLayout()`** — e todo
> `boards/*.json` já gravado (inclusive o `oficial.json`, que é o padrão de
> quem nunca escolheu nada) foi salvo sem ela. `applyZonePosition` ignora zona
> ausente em silêncio, então o elemento cai no flexbox e "some" do tabuleiro
> customizado sem erro nenhum. O caminho é o mesmo backfill que a zona `acts`
> já usa em `loadActiveBoard`.

> **`boards/*.json` viajam no `game.zip`.** Mexeu neles, o Release comum leva
> (`npm run release:build` → `release:publish`). Não precisa de `pack`.

### 2.1 — Retrato do duelista (os dois cantos do Tag Force)

Zonas `p0:avatar` / `p1:avatar`. Puxam a arte do NPC (`advNpc`) e um retrato
para o jogador. É o que mais aproxima a tela da referência, e é o único item da
Fase 2 que também mexe no **cadastro de NPC** (`web/npcs.html`) — hoje não há
campo de retrato.

### 2.2 — Trilha de fases (DP ▸ SP ▸ M1 ▸ BP ▸ M2 ▸ EP)

A régua horizontal do Tag Force, com a fase atual acesa e as passadas apagadas.
Hoje a `mid` mostra só o nome da fase atual, em texto. As 6 pastilhas já
existiram e foram removidas por não dizerem nada; **com a régua ligada elas
voltam a dizer**: mostram *onde no turno* você está, não só *em que fase*.
Precisa decidir se a régua substitui a `mid` ou se é zona nova ao lado dela.

### 2.3 — Placar posicionável

Devolver o `.hud` ao editor como zona (`hud`, ou `lp0`/`lp1`/`turno`
separadas). Hoje ele é fixo no topo, fora da arena, e essa é uma escolha
consciente da Fase 1 — não uma pendência. Só vale fazer se você quiser mesmo
poder mover o placar.

### 2.4 — Contagem de cartas colada no Deck/Extra

No Tag Force o número fica **sobre** a pilha, e a pilha tem arte de verso. Hoje
`deckEl`/`extraEl` são caixas tracejadas com o número no meio. É trabalho de
`duel.html` puro **exceto** se as duas pilhas passarem a poder ficar em
tamanhos diferentes no editor.

---

## Fora das duas fases (nem `duel.html`, nem editor)

- **Animação de ataque** (o corte, o recuo). Hoje há tremor no alvo
  (`fx-shake`) e o fantasma que voa. O resto é `TAGFORCE-BATALHA.md`, que já
  traz o timing exato lido do ISO.
- **Som.** Não existe nada no projeto.
