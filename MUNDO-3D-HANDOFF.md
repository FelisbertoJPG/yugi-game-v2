# Handoff — Mundo andável em 3D (three.js)

> Documento para uma sessão nova do Claude Code, possivelmente em **outra
> máquina**, continuar este trabalho. **Autocontido**: não depende de memória de
> sessão nenhuma. Leia junto com o `CLAUDE.md` (a seção *"O mesmo mundo andável
> em 3D (three.js) — prova de conceito"*), que é o resumo; aqui está o porquê de
> cada decisão e o que fazer a seguir.
>
> Data da entrega inicial: **31/08/2026**. Estado: **fora do fluxo do jogador**
> desde 08/09/2026 — ele foi a opção 5 do menu da home entre 31/08 e 08/09, e
> hoje se alcança pela Área de Teste. Ver §1. A entrega inicial (prova de conceito na
> Área de Teste, com os duelistas de `npcs.js` na clareira) durou o mesmo dia;
> a segunda entrega, abaixo, mudou o que a tela É.

---

## 1. O que é, em uma frase

`web/mundo3d.html` é o **MUNDO**: uma floresta 3D andável onde os jogadores se
encontram. Entra-se pela **Área de Teste**, anda-se, vê-se quem mais está
andando, e **`Esc` volta para a home**.

> **A porta mudou duas vezes.** Ele nasceu na Área de Teste (prova de conceito),
> virou a opção **5** do menu da home em 31/08/2026, e VOLTOU para a Área de
> Teste em 08/09/2026. O que o tirou do menu foi a própria frase acima: um mundo
> **sem interação nenhuma** não se sustenta como uma das cinco opções que o
> jogador tem à frente. E o que nasceu aqui com pernas próprias — o **Editor de
> Cena** (§10) — virou **projeto à parte** (`three_js_scene_editor`, fora deste
> repositório), onde é o produto em vez de uma ferramenta escondida.
>
> O que NÃO voltou atrás foi o guarda: a tela continua pedindo `requireLogin`,
> e não `requireAdmin`. Quem guarda a porta é o `teste.html`, que é de admin —
> devolver o `requireAdmin` para cá faria a tela abrir, piscar e mandar de volta
> quem chegasse por um link salvo.

**Sem interação nenhuma**, e isso é a feature e não uma etapa: não há duelo,
conversa, esbarrão nem colisão entre pessoas. Você vê os outros caminhando —
e vê **como cada um se vestiu**, porque cada jogador customiza o próprio
personagem (tecla **V**, §6.2).

### Como ela chegou aqui (as duas entregas)

O pedido original foi: *"sabe o three.js? tem como integrar no projeto? se sim
gostaria de fazer o mundo andável por ele, usar um cenário qualquer de floresta
só pra teste"*. Saiu uma **prova de conceito na Área de Teste**: a mesma ideia
de `web/cidade.html` (andar até um duelista e apertar espaço para duelar), em
3D, com os adversários de `npcs.js` esperando na clareira.

O pedido seguinte, no mesmo dia, mudou o que a tela é: *"deixe os NPC do mundo
3D desativados, e faça com que tenha no menu ao invés de [multiplayer] →
[Mundo], então permita que os players possam se encontrar lá (sem interação) e
se apertarmos [esc] voltamos pra home"*.

E o terceiro trouxe a **customização**: *"ter personagens com modelos bons e
editáveis, assim cada player pode customizar seu char, cabelo, cor, roupa; as
roupas e cabelos poderiam virar uma classe de item obtível"*. A escolha feita
ali, e que decide tudo no §6.2, foi **construir o SISTEMA agora com as peças
ainda geradas em código**, cada slot atrás de uma fábrica de geometria — porque
o sistema é idêntico com peças procedurais ou com `.glb`, e só a fábrica muda.

Então **a floresta continua sendo um cenário qualquer** — não gaste tempo
fazendo dela um bioma definitivo antes de perguntar (ver §9.2). O que deixou de
ser provisório é o PAPEL da tela.

### O que mudou de lugar

| | antes | agora |
|---|---|---|
| porta | Área de Teste | **menu da home, opção 5** (e a Área de Teste também) — o menu SAIU em 08/09/2026, ver §1 |
| guarda | `requireAdmin` | **`requireLogin`** |
| habitantes | todos os NPCs de `npcs.js` | **as outras pessoas** (`mundovivo.js`) |
| NPCs | clicáveis, com painel e duelo | **desligados** (`NPCS_NO_MUNDO`) |
| `Esc` | fechava o painel | fecha o painel, **ou volta para a home** |
| menu 5 | Multiplayer | Mundo |

**O Multiplayer não foi removido — só saiu do menu.** `web/multiplayer.html`
continua inteiro e continua sendo o caminho do duelo entre pessoas; quem desafia
chega lá pelo cartão do amigo, na lateral da home, que é de onde o convite parte
de qualquer jeito. Ver o comentário do `desafiar` em `index.html`: quem desafia
precisa entrar no duelo no instante em que o outro aceita, e essa espera só
existe lá.

**E o mundo 2D continua inteiro**, na Área de Teste, sem nada disto.

---

## 2. Como ver isso rodando

```bash
npm run dev            # front estático em http://localhost:8080
```

Depois: **Home → 5 (Mundo)**. Ou direto: `http://localhost:8080/web/mundo3d.html`
(o atalho da Área de Teste, tecla **F**, continua existindo para admin).

> **Precisa de sessão** — qualquer uma. A tela chama `requireLogin()`; sem
> sessão vai para o login. Não é mais `requireAdmin`: com a porta no menu da
> home, exigir admin faria a tela abrir, piscar e mandar todo jogador comum de
> volta, com o menu prometendo um lugar onde ninguém entra.

> **Para ver DUAS pessoas você precisa de duas contas.** O canal manda
> `self: false`, então o servidor não devolve o seu próprio recado — e
> `limparRecado` ainda descarta o seu id de propósito, para a segunda aba da
> MESMA conta não virar um sósia andando em cima de você. Duas janelas anônimas
> com contas diferentes é o jeito.

**Controles:** WASD/setas andam (relativo à câmera), **shift** corre, **arrastar
com o mouse** gira a câmera, **Q/E** giram pelo teclado, **roda** aproxima,
**Esc** volta para a home.

### O teste automatizado (é o que substitui o "abre e vê")

```bash
node web/js/floresta.test.mjs      # 28 asserções, ~1s, sem servidor e sem login
node web/js/mundovivo.test.mjs     # 21 asserções da presença (ver §6.1)
```

Ele monta **a cena inteira em Node**, o que só é possível porque `floresta3d.js`
e `boneco3d.js` não encostam em DOM (ver §4). É o teste que prova, entre outras
coisas, que o pacote vendorizado do three carrega.

Rode também as três varreduras que valem para toda página nova:

```bash
node web/js/vivo.test.mjs        # a batida /__vivo — sem ela o jogo se fecha sozinho
node web/js/esconder.test.mjs    # o atributo `hidden` realmente esconde?
node web/js/atalhos.test.mjs     # `{ nomeDe }` referenciando variável que não existe
```

> **Nota sobre o estado do repositório:** `node web/js/bootguard.test.mjs`
> falha em **`itens.html`** (ela não importa o `bootguard`). Isso é
> **anterior** a este trabalho e não tem relação com o mundo 3D. Não é
> regressão sua; conserte só se o usuário pedir.

---

## 3. O three.js: como foi integrado

### 3.1. Vendorizado, nunca CDN

```
web/vendor/
├── README.md                 ← como atualizar, e o que a atualização quebra
└── three/
    ├── three.module.min.js   357 KB
    ├── three.core.min.js     376 KB
    └── LICENSE               (MIT)
```

Versão **r185** (`three@0.185.1`), baixada de
`https://cdn.jsdelivr.net/npm/three@0.185.1/build/`.

**Por que vendorizar e não importar de CDN — a razão é dura:** o
`ClassicDuels.exe` serve `%LOCALAPPDATA%` na máquina de quem joga. Um `import`
externo deixaria o mundo 3D sem abrir exatamente quando a conexão está pior — e
**em silêncio**, porque um `import` que dá 404 mata o `<script type="module">`
inteiro. Este projeto já pagou por isso: os 10 arquivos órfãos de 24/08/2026, em
que `index.html` importava três módulos apagados e a home passou a desenhar só o
casco estático, sem erro em lugar nenhum.

**Por que não `npm install`:** o front tem **zero dependências** e nenhum build
step, de propósito. Não existe `node_modules` aqui e não deve passar a existir.

### 3.2. Os dois arquivos andam juntos

`three.module.min.js` faz `from "./three.core.min.js"` — caminho **relativo**.
Os dois têm de ficar lado a lado, com esses nomes exatos. Se um dia o build do
three mudar de forma, o `import` falha e o mundo não abre; o teste confere que
os três arquivos estão no lugar.

### 3.3. Como os módulos importam

```js
// floresta3d.js e boneco3d.js (precisam rodar em Node, no teste)
import * as THREE from '../vendor/three/three.module.min.js';

// mundo3d.js (só navegador, segue a convenção de módulo-de-página)
import * as THREE from '/web/vendor/three/three.module.min.js';
```

Os dois resolvem para a **mesma URL** no navegador, então há **uma instância
só** do three. A forma relativa nos dois primeiros não é estilo: é o que faz
`node web/js/floresta.test.mjs` conseguir importá-los (`/web/...` em Node
resolveria contra a raiz do disco). Essa é a mesma convenção que os outros
módulos testáveis do projeto já seguem (`drops.js` importa `./projectstore.js`).

### 3.4. O que isso custa no Release

`web/` inteiro viaja no `game.zip` (`Copy-Item -Recurse` em
`tools/publish-release.ps1`), então `web/vendor/` vai junto **sem passo
nenhum**. Conferido.

| | |
|---|---|
| no disco | 734 KB |
| dentro do `game.zip` (deflate) | **~184 KB** |
| `game.zip` antes | ~1,5 MB |
| `game.zip` depois | ~1,7 MB |

Publicar continua sendo `.\publicar.exe` (dois cliques). Como só mudou
`web/`, **não** precisa de `npm run pack` nem de `-ComExe` — mas o
`publicar.exe` já reempacota o exe sozinho quando ele fica para trás, desde
24/08/2026. Não invente ritual novo.

---

## 4. Arquitetura — e a razão de cada arquivo

A divisão é **a mesma do mundo 2D**, e isso é deliberado: quem conhece
`citymap.js` (decide) + `tileset.js` (desenha) + `cidade.js` (o loop) já sabe
onde procurar aqui.

| arquivo | papel | roda em Node? |
|---|---|---|
| `web/js/floresta.js` | **decide**: relevo, onde nasce cada árvore, o que bloqueia, onde os duelistas ficam | ✅ sem three, sem DOM |
| `web/js/floresta3d.js` | **desenha o cenário**: chão, céu, árvores, pedras, samambaias, capim, luzes, vento | ✅ usa three, sem DOM |
| `web/js/boneco3d.js` | **desenha o duelista** (caixas) e o passo | ✅ usa three, sem DOM |
| `web/js/aparencia.js` | **decide o que se veste**: catálogo de peças, paleta, normalização, regra da posse | ✅ sem three, sem DOM |
| `web/js/mundovivo.js` | **decide quem mais está aqui**: cadência do envio, validação do recado, prazo de sumiço | ✅ sem three, sem DOM |
| `web/js/mundo3d.js` | **o loop**: renderer, entrada, câmera, colisão, etiquetas, os corpos das pessoas | ❌ só navegador |
| `web/mundo3d.html` | a página | — |
| `web/js/floresta.test.mjs` | 28 asserções | ✅ |
| `web/js/aparencia.test.mjs` | 21 asserções | ✅ |
| `web/js/mundovivo.test.mjs` | 21 asserções | ✅ |

> **Por que os três primeiros não encostam em DOM.** Foi essa escolha que tornou
> o trabalho testável: `three` roda inteiro em Node **menos** o
> `WebGLRenderer` (que precisa de um `<canvas>`). Deixando a renderização
> sozinha em `mundo3d.js`, o teste monta a cena de verdade — geometria, luzes,
> matrizes de instância — e confere tudo. Se você acrescentar um
> `document.createElement` em `floresta3d.js`, o teste morre e a cobertura vai
> junto. Não faça.

### 4.1. A arte é gerada em CÓDIGO

Nenhum `.glb`, nenhuma textura, nenhum arquivo de imagem. Árvore é cone
empilhado sobre cilindro, pedra é icosaedro amassado, samambaia é um leque de
cones, capim são duas lâminas cruzadas, o duelista é um monte de caixas.

Isso não é limitação técnica: é a **mesma regra** do mundo 2D
(`tileset.js`/`actors.js`, pixel art escrita em código) e existe pelo mesmo
motivo — o front tem zero dependências, e um binário sem fonte é mais uma coisa
para viajar no `game.zip` e para manter em sincronia com nada.

**A paleta é IMPORTADA, não copiada.** `floresta3d.js` faz
`import { CHAO } from './tileset.js'` — a mesma paleta do mundo 2D. Foi preciso
trocar `const CHAO` por `export const CHAO` em `tileset.js` (mudança aditiva, a
única que fiz num arquivo existente além do `teste.html`). Duas paletas em dois
arquivos divergem na primeira mexida, e o sintoma seria os dois mundos
parecerem jogos diferentes.

E o boneco reusa `coresPara(id)` de `actors.js`: o **mesmo adversário tem a
mesma cara nos dois mundos**, sem guardar aparência em lugar nenhum.

### 4.2. A API de cada módulo

```js
// floresta.js  — tudo puro e determinístico
export const MUNDO = { raio, clareira, rampa, raioJogador, raioInteracao };
export function alturaDoChao(x, z)          // → y, a ÚNICA fonte de altura
export function terraBatida(x, z)           // → 0..1, quanto é terra vs mato
export function manchaDeChao(x, z)          // → 0..1, variação de tom
export function construirFloresta()         // → { arvores, pedras, moitas, grama,
                                            //     colisores, vagas, entrada }
export function vagasDeNpc(colisores, n=12) // → [{ x, z, y, giro }]
export function livre(colisores, x, z, r)   // → bool
export function mover(colisores, x, z, dx, dz, r)  // → { x, z }, deslizando

// floresta3d.js
export const COR                            // a paleta resolvida
export function montarCena(mapa)            // → { scene, sol, atualizar(t), seguirSol(x, z) }

// boneco3d.js
export const ALTURA                         // 1.72 m, do pé ao alto da cabeça
export function criarBoneco(cores)          // → { grupo, andar(fase, andando), descartar() }

// mundovivo.js — tudo puro menos o entrarNoMundo
export const ENVIO_MS, BATIDA_MS, SUMICO_MS, NOME_MAX, SALA
export function limparRecado(carga, meuId)  // → {id,nome,x,z,giro} ou NULL
export function aplicar(mundo, dados, agora)      // → "entrou" | "moveu"
export function sumidos(mundo, agora, prazo)      // → [id]
export function deveMandar(estado, agora, pos)    // → bool  (a CADÊNCIA)
export function desvioDeEntrada(id)               // → { dx, dz }
export const normalizarGiro                       // ângulo → [-PI, PI]
export function entrarNoMundo(conf, ganchos)      // → { passar(agora,pos), mundo, sair() }
```

### 4.3. Números do mundo

```
MUNDO.raio          92    parede invisível
MUNDO.clareira      13    o descampado dos duelistas
MUNDO.rampa         10    transição entre a clareira plana e o relevo
NEVOA               { perto: 20, longe: 62 }      (em floresta3d.js)
chão                lado = (raio + nevoa.longe + 8) * 2 = 324 m, 192 segmentos
```

Povoamento resultante (determinístico, sempre igual):
**420 árvores · 60 pedras · 520 samambaias · 1460 tufos de capim · 12 vagas**.

Custo medido: **138.884 triângulos em 7 draw calls** (5 deles instanciados) — o
chão sozinho é 73.728 deles. Construir o mapa leva ~12 ms e montar a cena ~80 ms,
medido em Node, três corridas. Há folga enorme — não otimize nada sem medir antes.

---

## 5. As armadilhas do three que este código já pagou

Estão comentadas no ponto onde acontecem, mas leia aqui antes de mexer. **Todas
erram caladas** — nenhuma dá erro no console.

### 5.1. `frustumCulled` num `InstancedMesh`

A esfera de recorte de um `InstancedMesh` sai da **geometria**, que aqui é uma
árvore de dois metros na origem — as outras 419 ficam fora dela. Com o recorte
ligado, **a floresta inteira some** conforme a câmera aponta para longe da
origem. Por isso todo `InstancedMesh` daqui tem `frustumCulled = false`. Custa
nada: são 6 malhas.

*(Existe `im.computeBoundingSphere()`, que considera as instâncias. Vale trocar
se um dia houver dezenas de malhas — hoje não vale.)*

### 5.2. As luzes são FÍSICAS desde o r155

Valores de exemplo antigos (`0.6`, `0.8`) renderizam uma cena **quase preta**, e
a reação natural — clarear as cores da paleta — deixa tudo lavado. Os valores
daqui (`HemisphereLight 1.35`, `DirectionalLight 2.6`) são **para esta cena**,
com `ACESFilmicToneMapping` e `toneMappingExposure = 1.05` ligados no renderer.
Mexeu num, confira os outros.

### 5.3. `toNonIndexed()` antes de fundir geometria

`fundir()` (em `floresta3d.js`) concatena várias geometrias numa só para que uma
árvore inteira — tronco + copa, duas cores — seja **um** `InstancedMesh`.
Geometria indexada **compartilha vértices**: concatenar duas sem remapear o
índice cola a copa de uma no tronco da outra. O resultado não é erro, é uma
malha embaralhada.

### 5.4. Deslocar vértices por ÍNDICE rasga a malha

`geoPedra()` amassa um icosaedro. A geometria é **não-indexada** (cada face tem
cópia própria dos cantos), então deslocar por índice separa os triângulos. O
deslocamento sai da **própria coordenada** do vértice — vértices duplicados
recebem o mesmo empurrão e a malha continua fechada.

### 5.5. `Math.floor`, e não `Math.round`, no redimensionamento

O `setSize` do three faz `canvas.width = Math.floor(width * pixelRatio)`
(conferido no bundle vendorizado). Comparando com `round`, em DPR fracionário
— **1,25, que é o padrão de um monitor com escala do Windows** — os dois nunca
batem e o canvas é reconstruído **a cada quadro**. Não dá erro: dá um jogo mais
lento sem motivo aparente.

### 5.6. Nada de `ResizeObserver`

O tamanho é reconferido **dentro do laço**, comparando dois inteiros. Mexer no
layout durante a entrega de um observer deixa notificação pendente no fim do
quadro, o navegador dispara `ResizeObserver loop completed with undelivered
notifications`, isso chega como `ErrorEvent` na `window`, e o `bootguard` cobre
o jogo com a faixa "esta tela não terminou de abrir". **Já aconteceu neste
projeto**, na serpentina da Trilha de Duelos.

### 5.7. Nada de `ShaderMaterial` (por enquanto)

O céu é uma esfera vista por dentro com o degradê e o halo do sol pintados nos
**vértices**, com `MeshBasicMaterial({ vertexColors: true })`. Um shader escrito
à mão precisa incluir na unha os blocos `<tonemapping_fragment>` e
`<colorspace_fragment>` do three; esquecê-los devolve um céu estourado que
ninguém sabe explicar. Se precisar de shader, inclua os dois chunks — e teste.

### 5.8. O plano do chão tem de passar da parede do mundo

**Invariante, com teste:** `metadeDoChao − MUNDO.raio ≥ scene.fog.far`.

A névoa não é clima — é ela que esconde a borda do mundo. Com o plano curto,
quem chega ao muro (raio 92) **vê o chão terminar no ar**, nítido, a poucos
metros. São três números em dois arquivos (`MUNDO.raio`, o tamanho do plano e
`NEVOA.longe`) e mexer em qualquer um quebra o que os outros dois garantiam.

Pela mesma razão, o capim só é plantado até 54 m: a névoa tem de apagar essa
borda, senão vê-se o gramado terminar numa circunferência perfeita em volta do
jogador. O teste confere que ela está ≥70% apagada ali.

### 5.9. A câmera precisa alcançar o domo do céu

`near = 0.25`, `far = 700`. O domo tem raio `MUNDO.raio * 3.2 = 294`, e o `far`
precisa alcançá-lo **de um canto do mapa**, não só do centro — recortado, o céu
some e aparece a cor de fundo no lugar dele. E `near` não pode ser 0,1 junto de
um `far` desses: a razão entre os dois é o que gasta a precisão do buffer de
profundidade, e o sintoma é o relevo distante piscando contra si mesmo.

### 5.10. O aviso de "sem WebGL" e o `bootguard`

Quando o `WebGLRenderer` não sobe, a página mostra `#semwebgl` e dá `throw`
para parar a corrente de `await` — que é como toda tela daqui para. Mas o
`bootguard` escuta a rejeição e **cobriria o aviso** com a faixa genérica, a
não ser que a frase case com o `DE_PROPOSITO` dele. Por isso o `throw` diz
`'sem WebGL — indo para o aviso na tela'`. O teste **lê o regex do próprio
bootguard** em vez de copiá-lo.

### 5.11. `scene.remove()` não devolve nada à GPU

Isto só passou a doer quando as pessoas entraram: no mundo de NPCs os bonecos
eram montados uma vez e ficavam até a página fechar, mas quem anda na floresta
**entra e sai o tempo todo**, e cada corpo é um `Group` de treze `BoxGeometry`
e sete materiais. Tirar do grafo não libera buffer de vídeo — o navegador não
coleta memória de GPU por alcançabilidade. Numa sessão longa a memória sobe
sozinha até o contexto de WebGL se perder, e a tela apaga **sem um erro que
aponte para cá**. Por isso `criarBoneco` devolve `descartar()`, e
`morreJogador` o chama junto com o `el.remove()` da etiqueta.

### 5.12. `setFromRotationMatrix` supõe uma matriz SEM escala

O relato foi *"o modelo está com os pés enterrados, e as mãos flickando"*. São
dois defeitos, e os dois nascem da escala que `normalizar()` (em `modelos.js`)
põe na raiz do corpo para o personagem ter 1,72 m — ela desce para a
`matrixWorld` dos 152 nós.

`Quaternion.setFromRotationMatrix` supõe que os 3×3 de cima são uma **rotação
pura**. Com a escala junto, a fórmula do traço devolve um quatérnio **não
unitário** — e não unitário por um fator que depende da própria rotação, então
não dá para "dividir pela escala" depois. Medido: **|q| = 0,975 em todas as 22
pistas religadas**.

O estrago fica escondido mais um nível: `Matrix4.compose` usa a fórmula do
quatérnio unitário, então `|q| ≠ 1` monta uma base torta e **o osso filho passa
a nascer a uma distância que muda conforme o pai gira**. Medido antes do
conserto: o antebraço encolhendo e crescendo **1,8% de um quadro para o outro**.
Quatro níveis abaixo do ombro está a mão — daí ser ela que treme. Nada dá erro:
nem o mixer, nem o *skinning*, nem o console.

O certo é `matrixWorld.decompose(pos, quat, esc)`, que separa a escala de
verdade (é o que `Object3D.getWorldQuaternion` faz por dentro). E vale a pena
`normalize()` no quatérnio que vai para a pista: `Quaternion.invert()` é a
**conjugada**, que só é a inversa de um unitário.

### 5.13. Normal para cima no capim

Uma folha em pé tem normal **horizontal**, e com o sol a 40° isso a deixa quase
preta — o gramado vira uma penugem escura sobre um chão claro. `geoCapim()`
força todas as normais para `(0,1,0)`. É o truque padrão de grama estilizada e
não custa um triângulo.

---

## 6. A decisão mais importante: UMA conta de altura

`alturaDoChao(x, z)` tem **dois leitores independentes**:

1. a malha do terreno, que desloca cada vértice;
2. o loop, que põe os pés do jogador e dos NPCs no chão.

Duas contas parecidas mas diferentes **não dão erro nenhum** — dão um boneco
flutuando um palmo acima da grama, ou enterrado até o joelho, conforme o pedaço
do mapa. É a mesma família do `chancesDe` × `chancesDoPacote` que o `CLAUDE.md`
já documenta: duas verdades sobre o mesmo número, cada tela certa pela sua
conta.

Por isso **tudo que `construirFloresta()` planta já guarda o `y` que veio de
`alturaDoChao`**, e quem desenha só copia. O teste cobra isso item por item
(420 + 60 + 520 + 1460 objetos). Se você precisar da altura em algum lugar
novo, **chame a função** — não estime, não interpole, não guarde numa segunda
tabela.

---

## 6.1. A OUTRA decisão: a cadência do envio

É o §6 da presença, e é o defeito principal daquela feature.

Mandar a posição **só quando ela muda** é a economia óbvia, e é errado: quem
fica parado deixa de dar notícia, o prazo de `SUMICO_MS` vence, e o corpo
**evapora da tela dos outros** enquanto a pessoa está claramente ali, de pé. Do
lado de quem olha, isso é indistinguível de a pessoa ter saído do jogo.

O avesso custa igual: mandar a cada quadro são sessenta mensagens por segundo
por pessoa, que o servidor passa a descartar por excesso — e aí o mundo engasga
para todo mundo ao mesmo tempo. Nenhum dos dois dá erro em lugar nenhum.

Daí os **dois ritmos** e a folga entre eles:

```
ENVIO_MS    120 ms     enquanto me mexo
BATIDA_MS   2 000 ms   parado — é esta que sustenta a presença
SUMICO_MS   8 000 ms   sem notícia por isto, o corpo sai da tela
```

`SUMICO_MS` é quatro batidas: três podem se perder inteiras sem ninguém ver
diferença. É a mesma conta que `presenca.js` faz contra a janela do banco (45s
contra 2min), e mexer num dos três sem olhar os outros faz a pessoa **piscar**
entre existir e não existir.

### E o recado que ninguém validou

Uma linha de tabela passou por policy, por tipo de coluna e por gatilho. Uma
transmissão foi escrita pelo cliente do outro lado e chega **crua**. Por isso
tudo passa por `limparRecado`, que **descarta** em vez de consertar — palpite
sobre dado torto é um corpo no lugar errado, que é pior que corpo nenhum.

A linha que mais importa ali é a conferência ser `Number.isFinite` sobre o valor
**cru**. Um `Number(carga.z)` antes inventaria a coordenada, porque
`Number(null)`, `Number("")` e `Number([])` são todos **0** — um lugar legítimo
no meio da clareira, onde o corpo apareceria plantado com toda a naturalidade.
(Este erro estava escrito na primeira versão; foi o teste que o achou.)

---

## 6.2. A TERCEIRA decisão: o código diz o que existe, o banco diz o que se vende

Cabelo, blusa, calça, calçado e cor da pele, numa gaveta lateral do próprio
Mundo. **Cor é livre; forma é o que se compra.**

A pergunta que decide o desenho todo é *"quem é a autoridade sobre o catálogo?"*,
e a resposta não é a mesma do ícone de perfil:

| | ícone (0035/0039) | peça de roupa |
|---|---|---|
| o que é | um PNG numa coluna | **geometria**, em `boneco3d.js` |
| o banco pode inventar um? | **sim** | **não** — sem construtor, a peça não existe |
| catálogo | a tabela | `PECAS`, em `aparencia.js` |
| preço e posse | a tabela | a tabela (`itens`, 0051) |

Daí a varredura que **nenhum código faz em tempo de execução**: toda peça do
catálogo tem construtor, e todo construtor está no catálogo. Peça sem forma é um
cosmético que se compra e não aparece — a pessoa paga DP, escolhe, salva e
continua igual. Forma sem peça é trabalho que nenhum slot alcança.

### A posse, em uma frase escrita duas vezes

> *"Se a peça está no catálogo de venda, você precisa tê-la. Se não está, é de
> graça."*

O cliente a aplica para saber o que **oferecer** (`disponivel`); o gatilho
`perfis_aparencia_valida` (migration 0054) para saber o que **aceitar**. A
segunda é a que vale: a policy `perfis_atualizar_proprio` deixa o dono escrever
na própria linha, então sem o gatilho bastaria um `PATCH /perfis?id=eq.<meu>`
para vestir a peça mais cara da loja. **É literalmente o furo que a 0035 tinha e
a 0036 fechou para o ícone** — e a resposta é a mesma: um gatilho cuja regra é
do *dono da linha*, e não de quem está escrevendo.

Repare no que a regra **não** tem: uma lista de peças gratuitas. Grátis é a
AUSÊNCIA em `itens`, o que faz um admin pôr uma peça à venda (ou tirá-la) sem
ninguém editar código dos dois lados. E o id da peça **é** o id do item
(`cabelo-moicano`): montá-lo a partir de um nome curto seria a mesma regra
escrita em JS e em SQL, e no dia em que os dois discordassem sobre um hífen
todo mundo passaria a vestir de graça, em silêncio.

### O que isso consertou de quebra

A aparência precisa chegar aos OUTROS, e a policy de `perfis` é
`id = auth.uid()` — ninguém lê a linha de mais ninguém. A porta estreita é a
`rpc/aparencias(uuid[])`, que devolve **nome e aparência, e nada mais** do
perfil (sem `dp`, `etiqueta`, `visto_em`, `admin` ou e-mail).

E foi ela que fechou o limite conhecido que este documento carregava: o NOME
viajava no recado de posição, dito pelo cliente. O aviso dizia *"no dia em que
houver interação, o nome tem de vir do servidor, senão a etiqueta vira
credencial"* — e roupa comprável **é** esse dia. Hoje `limparRecado` devolve só
`{id, x, z, giro}`, e não tem mais campo de nome nenhum em vez de ter um que
ninguém lê: **campo que existe é campo que alguém volta a usar**.

### O caminho para modelos de verdade

Cada peça é uma **fábrica de geometria**: um construtor que devolve uma lista de
partes `{ geo, cor, em, pos, rot, esc }`, onde `em` é a junta em que a parte
pendura. Nada além disso.

```
hoje:   'cabelo-moicano' → CapsuleGeometry + calota
depois: 'cabelo-moicano' → um nó de um .glb
```

O vestiário, a posse, o gatilho, a coluna, a `rpc/aparencias` e a rede **não
sabem a diferença**. Foi por isso que o sistema veio antes da arte: ele é o
trabalho de engenharia, e é idêntico nos dois mundos.

O que muda no dia do `.glb`: vendorizar o `GLTFLoader` (~100 KB, e ele NÃO está
em `web/vendor/` hoje), encerrar a regra da arte gerada em código, e um
personagem modular **rigado contra um esqueleto único** — peças de fontes
diferentes não encaixam, e essa é a restrição que se descobre tarde.

### As armadilhas que já custaram, aqui

- **a geometria é COMPARTILHADA** entre todos os bonecos (~20 formas contra um
  `Group` por pessoa que entra). `descartar()` solta só os **materiais**, que
  são os que carregam a cor. Soltar a geometria apagaria a peça do PRÓXIMO
  boneco, muito depois, com a causa a dez minutos de distância;
- **o porto seguro não pode estar à venda.** `normalizar` cai na primeira peça
  de cada slot quando não reconhece a escolhida; se essa primeira fosse vendida,
  o gatilho recusaria o salvamento inteiro de quem caísse nela — por uma escolha
  que a pessoa nem fez;
- **o cliente velho contra o item novo.** Um admin cadastra um cabelo hoje; quem
  não atualizou não tem a geometria. Peça desconhecida vira a padrão, nunca um
  id sem construtor descendo para o `boneco3d`;
- **cor torta sai BRANCA.** `new THREE.Color()` com lixo resmunga no console e
  deixa a peça branca, que no meio de um boneco parece escolha ruim;
- **dois números em dois idiomas.** O teto do JSON está em `aparencia.js` e no
  `check` da coluna; os tipos de item, aqui e no `check` de `itens`. O teste os
  **lê do SQL** em vez de copiar;
- **os DEDOS de um clipe importado precisam viajar.** Eram as 30 pistas
  descartadas de 53, e a justificativa escrita era *"o nosso boneco não move os
  dedos"* — verdade sobre o `andar()` em código, irrelevante sobre um clipe de
  arquivo. O que sobrava era a mão na pose de bind do VRoid: reta e aberta, uma
  espátula na ponta de um braço que se move bem, e ninguém olha para a mão de um
  personagem e pensa "faltou religar pista" — pensa que o modelo é ruim. O
  relato foi *"as mãos duras, estáticas, esticando as mesmas"*. Medido no que
  estava sendo jogado fora: **até 29,8° (parado) e 49,2° (andar)** de desvio do
  descanso, mais 10,9°/18,9° de variação dentro do clipe;
- **o POLEGAR é o único osso em que o mesmo nome quer dizer coisas
  diferentes.** VRM 0.x: `Proximal → Intermediate → Distal`. VRM 1.0: renomeou o
  primeiro para `Metacarpal` e empurrou os outros dois um degrau — então
  `leftThumbProximal` é a BASE num arquivo e o do MEIO no outro. Errar move o
  polegar inteiro uma articulação, e o resultado parece decisão de quem modelou.
  A grafia é decidida para o CONJUNTO (`ossosDoMixamo`), nunca osso a osso;
- **a altura do quadril de um clipe importado é MEDIDA no esqueleto que vai
  recebê-lo.** Ela chegava como `ANCORAS.pernaE[1]` (0,80 m) — a junta da coxa
  do boneco de CÁPSULAS, que não é o quadril de ninguém. O quadril do modelo
  está em 1,0127 m, então a pista entrava escalada para a altura errada, o corpo
  inteiro descia 21 cm e **o dedo do pé ia parar a −15 cm do chão**. É a mesma
  família do §6 (duas contas para o mesmo número), e o conserto é o mesmo:
  perguntar ao esqueleto (`religarPelaPose` lê o `position.y` do quadril do
  alvo) em vez de receber uma constante de fora;
- **escalar a pista do quadril NÃO põe os pés no chão** — são duas contas
  diferentes com o mesmo número. A escala é MULTIPLICATIVA (a unidade do clipe,
  a proporção da perna); onde o corpo pousa é ADITIVA, e as duas só coincidem
  quando a pose média do clipe é a pose de descanso do modelo. Numa caminhada
  nunca é: o joelho fica dobrado o tempo todo e o quadril tem de ficar MAIS
  BAIXO que no descanso. Medido: −4,9 cm em `andar` contra ~0 em `parado`, no
  mesmo corpo. Por isso existe `plantarNoChao` (em `animacao.js`), que mede o
  clipe já montado e desloca a pista para o ponto mais baixo do passo aterrissar
  em `y = 0`. A referência é o **descanso de cada osso do pé**, e não zero: o
  osso do dedo nasce a 4,5 cm do chão e o do tornozelo a 12 cm — é a espessura
  do pé e do sapato, e plantar o OSSO em zero enterraria o modelo de novo, pela
  metade.

---

## 7. O que os 70 testes guardam (e por quê)

Cada um existe porque a decisão erra **calada**. Não os enfraqueça para fazer
uma mudança passar; se um reprovar, é quase certo que ele está certo.

| grupo | o que protege |
|---|---|
| relevo | altura finita e pura; clareira plana (com tolerância — no raio exato o `hypot` devolve 13.000000000000002); nenhum paredão (inclinação < 0,75) |
| povoamento | a floresta é **idêntica** em toda construção (ruído sorteado por boot faria todo relato de bug deixar de ser reproduzível); as duas espécies aparecem; a mata rareia perto da clareira; o capim rareia sobre a terra batida |
| altura única | todo objeto plantado tem `y === alturaDoChao(x, z)` |
| colisão | o colisor é do **tronco** (0,2 < r < 1,9): copa inteira vira parede invisível a três metros, zero deixa atravessar; samambaia e capim **não** bloqueiam; a parede do mundo existe; esbarrar num eixo ainda deixa deslizar no outro |
| duelistas | as 12 vagas estão livres, dentro da clareira e **olham para o centro** (`atan2` com o sinal certo — trocado, todo duelista fica de costas para quem chega); a vaga sobre um obstáculo é descartada, **com o caso ruim provado**; a clareira é 100% andável |
| three | os 3 arquivos vendorizados existem; **nenhum módulo nosso importa de fora**; a cena monta com a contagem certa de instâncias; sem NaN em matriz de instância (a árvore só não aparece); `frustumCulled === false`; céu, chão, névoa e sol com sombra presentes; o invariante da borda do chão; o vento e o sol rodam sem produzir NaN |
| boneco | pés em y≈0 e cabeça em `ALTURA` (senão a etiqueta de nome flutua); **rosto para +Z**; parado não mexe as pernas, andando mexe |
| a tela | carrega o módulo e o `bootguard`; tem o guarda `[hidden]`; pede **`requireLogin`** e **não** importa `requireAdmin`; **NÃO** está ligada no menu da home (saiu em 08/09/2026 — a âncora é o `location.href`, e não a palavra solta, porque `mundo3d.html` aparece no comentário que explica a saída) e **está** no `teste.html`, que é a última porta; os dois botões de Área de Teste **nascem `hidden`**; `Esc` volta para a home **com o painel vindo antes**; a frase do `throw` de WebGL casa com o `DE_PROPOSITO` do bootguard |

E os 21 de `mundovivo.test.mjs`:

| grupo | o que protege |
|---|---|
| o recado cru | coordenada que não é número é **descartada, nunca consertada** (`Number(null)` é 0); fora da parede do mundo; id vazio, gigante ou ausente; o **meu próprio id** (o sósia da segunda aba); nome cortado em `NOME_MAX`, e a falta dele não apaga a pessoa; giro normalizado. **Cada recusa tem par CONTROLE** — sem o recado bom passando ao lado, um `limparRecado` que devolvesse `null` sempre passaria em tudo e o mundo ficaria permanentemente vazio, com os testes verdes |
| guardar | a primeira notícia **cria** o corpo e as seguintes só o **miram** (a posição vira ALVO, senão o boneco anda em degraus); quem para de dar notícia sai e quem deu há pouco fica |
| a cadência | **parado ainda manda** — o teste que justifica o arquivo; andando manda no ritmo de andar e não antes; a primeira sai sempre; girar conta, o tremor do mouse não; `SUMICO_MS ≥ 3× BATIDA_MS` |
| nascer | o desvio é determinístico, diferente por id, e cai perto o bastante para ser a porta e longe o bastante para dois corpos não se sobreporem |
| a tela | o Mundo importa e LIGA a presença (senão a floresta fica vazia sem erro nenhum); a etiqueta entra por **`textContent`**, nunca `innerHTML`; quem sai é **devolvido à GPU** e a etiqueta sai do DOM; existe selo de estado do canal (senão "vazio" e "sem conexão" são a mesma tela) |

---

## 8. Decisões que foram tomadas DE PROPÓSITO — não as "conserte"

Cada linha aqui é algo que parece faltando e não está.

- **Os NPCs estão DESLIGADOS, e não apagados** (`NPCS_NO_MUNDO`, uma linha em
  `mundo3d.js`). Duas razões, e a segunda é a que pesa: um duelista de máquina
  parado aqui responde a outra pergunta — a de "contra quem eu jogo", que é da
  **Trilha de Duelos**, onde cada vitória libera o próximo —, e tê-lo aqui
  abriria a porta que a Trilha fecha, porque esta tela mostra TODOS os
  adversários cadastrados, sem cadeado nenhum. É exatamente o furo que mandou
  `adversario.html` e `cidade.html` para a Área de Teste. A lista é montada por
  uma **condição** e não deletada porque a máquina de habitantes serve aos dois:
  o que está desligado continua exercitado pelo mesmo código que desenha as
  pessoas, e religar é mudar aquela linha.
- **A floresta não está em `world.js` (`SCENARIOS`).** Pô-la lá a faria aparecer
  no mapa mundi 2D e passaria a rotear NPCs por campanha para ela, mudando
  comportamento existente. Ela é uma tela solta, alcançada pela Área de Teste.
- **Não há colisão entre pessoas** — atravessa-se. Sem dono, dois clientes
  empurrando o mesmo corpo discordariam sobre onde ele parou, e cada tela
  ficaria certa pela sua conta. Atravessar é a escolha honesta enquanto não
  houver interação nenhuma aqui. A colisão contra a FLORESTA continua valendo.
- **A etiqueta de outra pessoa não é clicável, e não é dourada.** Dourado nesta
  tela é a cor de "dá para interagir", e no Mundo não dá — prometer um clique
  que não acontece é pior que não prometer nada.
- **A COR é livre e a FORMA é que se compra.** Cor não custa nada para produzir
  e é o que faz alguém sem nenhum item parecer uma pessoa em vez de um clone.
  Cobrar por ela transformaria a primeira impressão do Mundo numa fileira de
  bonecos idênticos esperando para pagar.
- **Quem nunca abriu o vestiário mantém a cara que já tinha.** `padraoDe(id)`
  cai em `coresPara(id)`, a mesma função do mundo 2D e dos adversários — a
  customização entrou sem migrar dado nenhum e sem clonar ninguém.
- **A peça presa aparece, com o preço.** Cosmético que ninguém vê é cosmético
  que ninguém compra.
- ~~**O NOME vem no recado, dito pelo cliente que o manda.**~~ **Resolvido** na
  customização (§6.2): hoje nome e aparência saem da `rpc/aparencias`. O
  parágrafo abaixo fica como registro do que a decisão custava.
- **O NOME vinha no recado, dito pelo cliente que o manda.** A policy de `perfis`
  é `id = auth.uid()`, então ninguém lê o perfil de outra pessoa e resolvê-lo
  pelo banco exigiria migration nova. Enquanto o Mundo for só um lugar de andar,
  o estrago máximo de um nome mentiroso é uma etiqueta mentirosa — nada aqui
  decide DP, carta, deck ou duelo. **No dia em que houver interação, isto tem de
  mudar**: a etiqueta viraria credencial.
- **Aba escondida some do mundo, e está certo.** O relógio da presença é o do
  laço (`requestAnimationFrame`), não um `setInterval` — que o navegador
  estrangula para uma batida por minuto na aba oculta, bem mais que o
  `SUMICO_MS`. Então quem minimiza para de dar notícia e sai da tela dos outros
  (não está mais olhando o mundo mesmo), e voltar para a aba o repõe no quadro
  seguinte, sozinho.
- **Sem pointer lock e sem `OrbitControls`.** A câmera orbital é ~30 linhas em
  `mundo3d.js`; o `OrbitControls` é um arquivo a mais para vendorizar e não faz
  o que se quer (ele orbita um alvo fixo, não um jogador que anda).
- **Sem `GLTFLoader`.** Nenhum modelo externo — ver §4.1. Vendorizá-lo é fácil
  se um dia houver um modelo de verdade a carregar; hoje não há.
- **Sem física.** A colisão é círculo contra círculo em 2D mais a altura do
  terreno. Não há gravidade, salto nem rampa intransponível.
- **O boneco olha para +Z.** Isso é **contrato** com quem o gira: o giro em Y de
  um alvo em (x,z) é `Math.atan2(dx, dz)`. Montá-lo olhando para −Z (que é para
  onde uma câmera do three olha por padrão) faria todo duelista ficar de costas
  para quem chega, e nada acusaria.
- **O painel do duelista continua DUPLICADO** entre `cidade.js` e `mundo3d.js`,
  mesmo desligado aqui — ver §9.1. Ele não foi apagado junto com os NPCs porque
  a dívida se resolve extraindo um módulo, não deletando um dos dois lados.

---

## 9. O que falta, por prioridade

### 9.-1. **APLICAR A MIGRATION 0054** *(bloqueia o resto)*

O arquivo está em `supabase/migrations/0054_aparencia_do_jogador.sql` e **ainda
não foi aplicado** — a última no banco é a 0053. Sem ele:

- o vestiário salva e leva erro (a coluna `aparencia` não existe);
- a `rpc/aparencias` dá 404, e aí **ninguém tem nome sobre a cabeça** — a
  etiqueta fica escondida de propósito em vez de virar uma caixa vazia, mas o
  Mundo perde os nomes que hoje tem.

**Aplique-a ANTES de publicar este front.** É a única ordem que importa: o
contrário deixa a versão nova falando com um banco velho, que é exatamente o
congelamento que o `CLAUDE.md` documenta para o motor.

### 9.0. **PROVAR O ENCONTRO AO VIVO** *(a única parte não verificada)*

Tudo o mais aqui foi provado por teste automatizado. O **canal de transmissão**
do Supabase Realtime não dá para provar assim: ele exige duas sessões de
verdade contra o projeto de verdade, e este documento foi escrito sem subir
servidor (ver §10.7 — subir o 8080 aqui derruba o `.exe` de quem está jogando).

O que está provado: a tradução do protocolo (`interpretar`, com o `broadcast`
aninhado em `payload.payload`), a cadência, a validação, o ciclo entrar/sair, e
que os módulos carregam. O que **não** está: que o `phx_join` num tópico sem
`postgres_changes` é aceito por este projeto, e que a mensagem de um cliente
chega ao outro.

Como conferir, em cinco minutos: `npm run dev`, duas janelas anônimas com
**contas diferentes**, as duas em `/web/mundo3d.html`. O selo da barra tem de ir
para **● ao vivo** nas duas, e o contador tem de dizer "mais 1 pessoa por aqui".
Andando numa, o boneco anda na outra.

Se o selo ficar em `○ sem conexão`, o join foi recusado — abra o console e olhe
o `phx_reply`. A suspeita ordenada é: (1) Broadcast desligado no painel do
projeto; (2) o join sem `postgres_changes` sendo recusado, e aí o remédio é
declarar uma tabela qualquer no canal do Mundo só para o join passar;
(3) `esperaTabelas` — mas esse só afeta o SELO, e não a entrega: se os corpos
aparecerem com o selo apagado, é este.

### 9.1. Tirar a duplicação do painel do duelista *(dívida conhecida)*

O painel (arte, campanha, deck, recompensa, botão de duelar) existe em
`cidade.js` + o markup de `cidade.html`, e de novo em `mundo3d.js` + o markup de
`mundo3d.html` — desligado aqui, mas inteiro. Mantive assim de propósito para
**não desestabilizar a tela 2D**, mas duas cópias divergem caladas, e o
`CLAUDE.md` é enfático sobre isso.

O caminho: um módulo `web/js/painelduelista.js` que **cria o próprio DOM**
(overlay + painel), mais um `web/css/painelduelista.css` linkado pelas duas
páginas. As duas telas perdem ~35 linhas de JS e ~25 de markup cada.

> Com os NPCs desligados, a alternativa barata é APAGAR o painel daqui e deixar
> a cópia só na `cidade.js`. Não fiz porque isso decide, de lado, que os NPCs
> nunca voltam a esta tela — e essa é uma decisão do usuário, não minha.

### 9.2. Decidir o que a floresta É

O PAPEL da tela está decidido (é o lugar de encontro). O que continua aberto é
o **cenário** e o que se faz nele — **para o usuário decidir, não para você
escolher sozinho**:

- a floresta continua sendo "um cenário qualquer", ou vira um lugar com
  identidade? Há um só, ou vários (praça, arena, salão)?
- **qual é a primeira interação?** Hoje não há nenhuma, de propósito. As
  candidatas óbvias são desafiar para duelar e conversar — e as duas já existem
  na home, então a pergunta real é o que o Mundo acrescenta que a lista de
  amigos não dá. *Qualquer uma delas obriga o nome a vir do servidor* (§8).
- o `cidade.html` 2D convive, ou é aposentado?
- os NPCs voltam em algum lugar do Mundo — e, se voltarem, respeitando o cadeado
  da Trilha?

### 9.2.1. O que a presença vai precisar quando crescer

Nada disto é necessário hoje, e nenhum deles vale ser feito por antecipação:

- **salas.** Hoje o canal é um só (`SALA = "mundo"`), e todo mundo cabe na
  mesma floresta. Com gente demais, o custo é o de N² mensagens — a saída é
  fatiar por sala/instância, que é uma linha no `sala` do `entrarNoMundo`;
- **o nome pelo servidor** (§8), assim que houver interação;
- **interpolação com carimbo de tempo.** Hoje o corpo caminha até a última
  posição conhecida com suavização exponencial, o que basta para caminhada. Um
  jogo com tiro ou com esbarrão precisaria de buffer com carimbo;
- **NPCs que andam**, ciclo dia/noite, LOD, som — tudo como já estava.

### 9.3. Uma bancada visual

O projeto tem `tools/bancada-*.mjs`: geram um `.html` na raiz que roda **sem
servidor e sem login**, com o módulo real fatiado do jogo. Existem porque
"mudança visual não se prova em teste de lógica".

Uma `tools/bancada-floresta.mjs` teria um problema a resolver antes: as bancadas
funcionam abrindo o arquivo direto (`file://`), e `file://` **bloqueia ES
modules**. As atuais contornam isso embutindo o fonte do módulo no HTML gerado —
com o three seriam 734 KB embutidos. Dá para fazer; confirme com o usuário se
vale.

### 9.4. Coisas de mundo que ainda não existem

Nenhuma é necessária para o que foi pedido:

- NPCs que andam — e, antes disso, NPCs (estão desligados: ver §8). Quando
  ligados, ficam parados na vaga e só viram para quem chega;
- ciclo dia/noite (o sol é fixo — `DIR_SOL`, em `floresta3d.js`);
- LOD nas árvores (não precisa: 139k triângulos é folga);
- som;
- caminho/estrada ligando a clareira a outra coisa;
- suporte a toque (o `pointerdown/move/up` já é `PointerEvent`, então arrastar
  funciona no celular, mas não há controle de andar).

### 9.5. Mobile

O app `mobile/` (Flutter) é cliente fino do `duel-server` e **não** carrega
`web/`. Nada disto o alcança. Não tente.

---

## 10. Regras do projeto que valem aqui e é fácil esquecer

Estas custaram tempo antes; estão no `CLAUDE.md`, repetidas aqui porque uma
sessão nova tropeça nelas.

1. **Documentação e comentários em português.** Siga a língua do arquivo.
2. **Toda página de `web/` precisa da batida `manterVivo()`** — sem ela o
   servidor se encerra debaixo de quem está jogando, depois de 15 s. A tela nova
   já tem; `vivo.test.mjs` reprova quem esquecer.
3. **Todo `hidden` precisa de guarda no CSS.** O atributo é uma regra da folha
   do navegador, a especificidade mais baixa que existe, e qualquer `display`
   nosso ganha dela. `mundo3d.html` resolve com um `[hidden] { display: none
   !important }` global, que `esconder.test.mjs` reconhece como saída legítima.
4. **Caminhos absolutos** (`/web/js/...`) nas páginas; **relativos**
   (`./x.js`, `../vendor/...`) nos módulos que precisam rodar em Node.
5. **`web/teste.html` e o `CLAUDE.md` são CRLF.** Um `old_string` multi-linha
   com `\n` **não casa**, mesmo idêntico ao que o Read mostrou. Use edições de
   uma linha só, ou um script que preserve `newline=''` e monte o bloco com
   `\r\n` (foi assim que os dois foram editados aqui).
6. **Não rode `git init` nesta pasta** — ela é cópia de trabalho; o repositório
   fica na pasta original.
7. **Não suba servidor (8080/8770) para "testar ao vivo"** — isso derruba o
   `.exe` do usuário. Prove por teste automatizado; o teste ao vivo é dele.
8. **Não mate processos a esmo** (`taskkill`/`Stop-Process` amplo): pode
   derrubar um servidor de dev com trabalho não salvo.

---

## 11. Mapa rápido de "quero mexer em X"

| quero… | mexo em |
|---|---|
| deixar a floresta mais/menos densa | `DENSIDADE` em `floresta.js` |
| mudar o relevo | `alturaDoChao` em `floresta.js` (**e só ali**) |
| mudar o tamanho do mundo / da clareira | `MUNDO` em `floresta.js` — depois **rode o teste**, o invariante da borda (§5.8) depende disso |
| mudar cor de árvore, chão, céu | `COR` em `floresta3d.js` (a de chão vem do `CHAO` de `tileset.js`) |
| mudar a névoa | `NEVOA` em `floresta3d.js` — mesma advertência do invariante |
| trocar a forma de uma árvore/pedra/samambaia | `geoConifera` / `geoCopada` / `geoPedra` / `geoSamambaia` / `geoCapim` em `floresta3d.js` |
| mexer no vento | `atualizar()` em `montarCena`, `floresta3d.js` |
| mexer no boneco | `boneco3d.js` (o rosto **tem** de continuar em +Z) |
| velocidade, câmera, teclas | `mundo3d.js` (`VEL`, `VEL_CORRIDA`, `orbita`, `MAPA_TECLAS`) |
| onde os duelistas ficam | `vagasDeNpc` em `floresta.js` |
| **religar os NPCs** | `NPCS_NO_MUNDO` em `mundo3d.js` — uma linha; leia §8 antes (eles furam o cadeado da Trilha) |
| **acrescentar uma peça de roupa** | `PECAS` em `aparencia.js` **e** `CONSTRUTORES` em `boneco3d.js` — os dois, sempre; o teste cruza. Para vendê-la, uma linha em `itens` com o MESMO id |
| **mudar a forma de uma peça** | o construtor dela em `boneco3d.js` |
| **a paleta de cores** | `PALETA` em `aparencia.js` |
| **a câmera do vestiário** | `CAM_VESTIARIO` em `mundo3d.js` |
| o painel de duelo | `abrePainel` em `mundo3d.js` + markup em `mundo3d.html` (ver a dívida em §9.1) |
| **o ritmo do envio da posição** | `ENVIO_MS` / `BATIDA_MS` / `SUMICO_MS` em `mundovivo.js` — os três se seguram, ver §6.1 |
| **o que se aceita de outro cliente** | `limparRecado` em `mundovivo.js` (**e só ali**) |
| **quão macio o outro corpo se move** | `SUAVIZA_S` / `TELETRANSPORTE` em `mundo3d.js` |
| **onde as pessoas nascem** | `desvioDeEntrada` em `mundovivo.js` + `mapa.entrada` em `floresta.js` |
| **o canal / salas** | `SALA` em `mundovivo.js`, e `ouvirTransmissoes` em `realtime.js` |
| atualizar o three | `web/vendor/README.md` tem o comando |

---

## 12. Arquivos tocados na TERCEIRA entrega (a customização)

**Criados**

```
supabase/migrations/0054_aparencia_do_jogador.sql   NAO APLICADA — ver §9.-1
web/js/aparencia.js          catalogo de pecas, paleta, normalizacao, posse
web/js/aparencia.test.mjs    21 assercoes
```

**Alterados**

```
web/js/boneco3d.js     reconstruido: capsulas e esferas no lugar de caixas,
                       montado a partir dos SLOTS, com cache de geometria
                       compartilhada e `vestir()` para trocar sem remontar
web/js/mundo3d.js      o vestiario (gaveta + camera de perto), a aparencia dos
                       outros pela rpc, tecla V, Esc em tres camadas
web/mundo3d.html       a gaveta do vestiario e o CSS dela
web/js/mundovivo.js    o recado perdeu o NOME (vem do servidor agora) e ganhou
                       o aviso `vesti`
web/js/mundovivo.test.mjs  o teste do nome virou o teste de que ele NAO passa
                           mais por ali
CLAUDE.md              a suite nova + a secao da customizacao
MUNDO-3D-HANDOFF.md    este arquivo
```

Nenhum arquivo do duelo, do servidor, do instalador, do Multiplayer ou do mundo
2D foi tocado.

---

## 12.1. Arquivos tocados na SEGUNDA entrega (o Mundo)

**Criados**

```
web/js/mundovivo.js          a presença: cadência, validação, prazo de sumiço
web/js/mundovivo.test.mjs    21 asserções
```

**Alterados**

```
web/js/realtime.js     `abrirCanal` privado + `ouvirTransmissoes`; `interpretar`
                       passou a ler `broadcast` e ganhou `esperaTabelas`
web/js/mundo3d.js      requireLogin; NPCS_NO_MUNDO; os corpos das pessoas;
                       Esc -> home; baterPonto; botoes de admin escondidos
web/mundo3d.html       titulo, dica, selo #vivo e contador #quantos,
                       botoes de Area de Teste com `hidden`
web/js/boneco3d.js     `descartar()` (aditivo)
web/index.html         o botao 5 do menu: Multiplayer -> Mundo
web/js/floresta.test.mjs   a tela virou de jogador; + o teste do Esc
web/js/atalhos.test.mjs    a varredura enxergava dentro de funcao com valor
                           padrao aninhado? Nao — furo consertado, com par
                           CONTROLE proprio
CLAUDE.md              a suite nova + a secao do Mundo
MUNDO-3D-HANDOFF.md    este arquivo
```

Nenhum arquivo do duelo, do servidor, do instalador, do banco, do Multiplayer ou
do mundo 2D foi tocado. **Nenhuma migration** — a presença não encosta no
Postgres.

---

## 12.2. Arquivos tocados na PRIMEIRA entrega (a prova de conceito)

**Criados**

```
web/mundo3d.html
web/js/floresta.js
web/js/floresta3d.js
web/js/boneco3d.js
web/js/mundo3d.js
web/js/floresta.test.mjs
web/vendor/README.md
web/vendor/three/{three.module.min.js, three.core.min.js, LICENSE}
MUNDO-3D-HANDOFF.md          ← este arquivo
```

**Alterados** (o mínimo possível, e nada de comportamento existente)

```
web/js/tileset.js   const CHAO → export const CHAO   (aditivo)
web/teste.html      botão "Mundo andável em 3D (floresta)" + atalho F
CLAUDE.md           a suíte no bloco de comandos + a seção de arquitetura
```

Nenhum arquivo do duelo, do servidor, do instalador, do banco ou do mundo 2D foi
tocado.
