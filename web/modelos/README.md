# `web/modelos/` — a arte do personagem

Solte aqui os `.glb` e escreva o `modelos.json`. **Enquanto esta pasta estiver
vazia, o jogo funciona igual** — o boneco é montado de cápsulas e esferas
escritas em código (`web/js/boneco3d.js`), e cada arquivo que chegar substitui
uma peça, uma de cada vez.

Quem lê isto é `web/js/modelos.js`. Leia o cabeçalho dele antes de mudar o
contrato abaixo.

---

## 0. O que ja esta aqui (31/08/2026)

```
kenney/character-a.glb          113 KB   o personagem
kenney/Textures/texture-a.png    20 KB   o visual dele MORA aqui
kenney/LICENSE.txt                       CC0
```

Do pacote **Blocky Characters 2.0** do Kenney (CC0). E o `modelos.json` ja o
aponta como `corpo`, com os apelidos de junta.

> **Este pacote nao tem pecas modulares** — e a descoberta que fechou o assunto.
> Os dezoito personagens dele (`character-a` a `character-r`) tem **geometria
> identica** e diferem so' pela TEXTURA. Entao ele da' *um corpo e dezoito
> pinturas*, e nao cabelo/blusa/calca separados.
>
> Duas consequencias, e as duas estao no codigo:
>
> - o material do `corpo` **nao e' descartado** (a regra do §3 vale so' para
>   peca): sem a textura, sobra um vulto branco;
> - com um `corpo` carregado, **as pecas procedurais cedem** — empilhar uma
>   capsula de blusa sobre um personagem ja' vestido seria uma segunda roupa por
>   cima da primeira. O vestiario volta inteiro no dia em que houver `.glb` POR
>   PECA, sem mais nada mudar.
>
> Trocar o visual e' trocar a textura: `character-b.glb` + `texture-b.png`, e
> assim por diante. Como a geometria e' a mesma, dezoito visuais custariam ~15 KB
> cada.

## 1. O manifesto

`web/modelos/modelos.json` — um objeto plano, `chave: caminho`:

```json
{
  "corpo": { "arquivo": "kenney/character-a.glb", "juntas": { "head": "cabeca", "torso": "tronco" } },

  "corpo-cabeca":   "corpo/cabeca.glb",
  "corpo-tronco":   "corpo/tronco.glb",
  "corpo-braco":    "corpo/braco.glb",
  "corpo-perna":    "corpo/perna.glb",

  "cabelo-moicano": "pecas/cabelo-moicano.glb",
  "roupa-jaqueta":  "pecas/roupa-jaqueta.glb"
}
```

**Só entra o que está listado.** Sem o `modelos.json` o boot faz *uma*
requisição, recebe 404 e segue procedural — de propósito: tentar baixar as ~21
chaves para descobrir que nenhuma existe encheria o console do jogador de
vermelho, que é como um erro de verdade deixa de ser notado.

Chave que não é uma peça do catálogo nem uma parte do corpo é **recusada e
reportada** (`estadoDosModelos().falhas`). Sem isso, um erro de digitação seria
indistinguível de "ainda não modelei essa peça".

## 2. As chaves que existem

**Corpo** — opcionais, uma a uma:

| chave | vira |
|---|---|
| `corpo-cabeca` | a cabeça (e os olhos passam a ser por sua conta) |
| `corpo-tronco` | o tronco |
| `corpo-braco`  | **os dois** braços |
| `corpo-perna`  | **as duas** pernas |

**Peças** — o `id` de cada peça em `PECAS`, dentro de `web/js/aparencia.js`.
Hoje: `cabelo-curto`, `cabelo-careca`, `cabelo-espetado`, `cabelo-rabo`,
`cabelo-moicano`, `cabelo-longo`, `roupa-camiseta`, `roupa-jaqueta`,
`roupa-colete`, `roupa-tunica`, `calca-comprida`, `calca-bermuda`,
`calca-saia`, `sapato-tenis`, `sapato-bota`.

> **É o mesmo id da tabela `itens`.** Uma peça à venda tem uma linha em `itens`
> com este id — é assim que o gatilho `perfis_aparencia_valida` (migration 0054)
> sabe conferir a posse sem ninguém montar o id nos dois lados.

## 3. O material: depende de quem está sendo carregado

São **duas leis**, e a diferença não é capricho — é a diferença entre um
cosmético e um personagem:

| o que | material | por quê |
|---|---|---|
| **peça** (cabelo, blusa…) | o nosso, tingido | um cabelo serve para doze cores; se viesse pintado, a customização morria |
| **`corpo`** (personagem inteiro) | **o do arquivo, com textura** | é um personagem pronto, e o visual dele MORA na textura |

Ou seja: **peça texturizada chega como forma lisa** (a textura é descartada e
a cor do vestiário assume), e **personagem chega como foi pintado**.

Para PEÇAS, então, o pacote a escolher é low-poly de cor chapada. Para o
`corpo`, textura é bem-vinda — é o caso do Kenney que está no §0.

> **A textura pode ser um arquivo à parte**, referenciado de dentro do `.glb`
> (o Kenney aponta para `Textures/texture-a.png`). Ela é procurada na **pasta
> do `.glb`**, e é por isso que o pacote vai numa subpasta com a sua própria
> `Textures/` ao lado. Textura que não é achada não dá erro: o modelo carrega
> assim mesmo e o personagem aparece **branco**. Há teste cobrando que toda
> textura referenciada existe onde o `.glb` a procura.

## 4. Uma peça em várias juntas

Uma jaqueta cobre o tronco **e** os braços, e braço se mexe. Uma malha só,
pendurada no tronco, ficaria rígida enquanto o braço anda por dentro dela.

Então **nomeie os nós do `.glb` como as juntas** e cada um vai para a sua:

```
raiz · tronco · cabeca · bracoE · bracoD · pernaE · pernaD
```

Um `.glb` que não nomeia nó nenhum vai inteiro para a junta padrão do slot:

| slot | junta padrão |
|---|---|
| `cabelo` | `cabeca` |
| `roupa`  | `tronco` |
| `calca`  | **as duas** pernas |
| `sapato` | **as duas** pernas |

Cabelo e sapato quase sempre são do segundo tipo (um arquivo, sem nó nomeado).
Jaqueta e túnica, do primeiro.

## 5. Escala e origem

O boneco tem **1,72 m**, os pés em `y = 0`, e olha para **+Z**. As juntas ficam
em:

```
perna    y = 0.80      ombro  y = 1.30
pescoço  y = 1.38      cabeça y = 1.565 (centro da esfera)
```

> A primeira linha é a junta da **coxa** do boneco de cápsulas (`ANCORAS.pernaE`),
> e ela já se chamou "quadril" aqui. O nome custou caro: alguém a passou como
> `alturaDoQuadril` para o religamento de animação, e o modelo entrou 21 cm
> abaixo do chão (§7). O quadril de um corpo humanoide fica bem mais alto — no
> `generico.glb`, em 1,0127 m.

E aqui as duas leis voltam a divergir:

**O `corpo` é NORMALIZADO na entrada.** Ele é medido e reescalado para 1,72 m,
com os pés em `y = 0` e centrado em x/z — então **pode vir na unidade que for**.
O do Kenney tem ~2,5 unidades e a origem no meio do corpo; sem normalizar, ele
entrava com **4,27 m e os pés a 80 cm do chão**, e o mundo inteiro passava a
mentir junto (a câmera enquadrava errado, a etiqueta de nome flutuava longe da
cabeça). A escala é MEDIDA e não se pede no manifesto: um fator errado não dá
erro, dá um gigante.

Depois de normalizado, cada parte tem a **âncora da junta subtraída** — ela já
vem no lugar certo dentro do arquivo, e pendurá-la na junta somaria a posição
duas vezes. É isso que faz o `andar()` continuar movendo braço e perna de um
modelo importado.

**A rotação NÃO é mexida.** Se o pacote olhar para −Z, o personagem fica de
costas para quem chega, e o conserto é reexportar: adivinhar a frente a partir
da caixa envolvente acerta em uns e erra calado noutros.

**As PEÇAS não são normalizadas.** Modele-as na posição final, em metros, com
as juntas acima como referência: uma cápsula tem `position`/`scale` porque é uma
primitiva que precisa virar forma; uma malha autoral já é a forma.

> Se uma PEÇA aparecer no chão, no meio do corpo ou gigante, é isto: o `.glb`
> não foi exportado na escala/origem do boneco.

## 5.1 Conferir ANTES de adotar

Dois caminhos, e os dois julgam pelo **mesmo** codigo (`web/js/conferirmodelo.js`)
— duas regras divergiriam caladas, e uma aprovaria o que a outra recusa:

```bash
node tools/conferir-modelos.mjs <pasta|arquivo.glb|pacote.zip>
```

e a **Bancada de Modelos**, em `web/modelos.html`: arraste o `.glb` (com a
textura junto, se houver) e veja o laudo ao lado do modelo, com uma regua de
metro em metro e um corpo cinza de 1,72 m encostado nele. Ela nao manda nada
para lugar nenhum — o arquivo e' lido no navegador — e faz o boneco ANDAR, que
e' a metade da pergunta que leitura nenhuma responde.

> **A trava que reprova quase todo pacote gratis e' o ESQUELETO.** Ver §8: um
> `.glb` com `skins` carrega, aparece e fica PARADO numa pose de T enquanto o
> boneco anda. Nada no console. O conferidor cobra `skins: 0` antes de tudo.

Medido em 07/09/2026, com este conferidor:

| fonte | licenca | veredito |
|---|---|---|
| **[VRoid Studio](https://vroid.com/en/studio)** | o modelo e SEU | **o caminho recomendado.** Criador de personagem anime, gratis, com uniforme escolar. Exporte **VRM** — o `.vroid` e o PROJETO, nao o modelo |
| Sketchfab, modelos rigidos | varia — confira o license.txt | servem; `.gltf` solto precisa virar `.glb` (ver abaixo) |
| [Kenney Blocky Characters](https://kenney.nl/assets/blocky-characters) | CC0 | servem — corpo em blocos, nos nomeados |
| [Kenney Mini Characters](https://kenney.nl/assets/mini-characters) | CC0 | servem; os 14 acessorios (oculos, mascara) cabem como PECA |
| [Quaternius](https://quaternius.com) | CC0 | servem (rigados, repartidos por posicao) |
| Kenney "Modular Characters", "Toon Characters" | CC0 | **sao 2D** (PNG/SVG), apesar da etiqueta `character` |
| Kenney "Animated Characters *" | CC0 | so **FBX**, sem `.glb` |

> **O ESQUELETO deixou de reprovar.** Ate 07/09/2026 um modelo rigado era
> recusado, e como quase todo personagem gratis vem rigado, isso reprovava o
> mundo inteiro. `repartir.js` passou a fatiar o corpo pela POSICAO a partir da
> pose de bind, e o `andar()` gira as fatias.

### Preparar um modelo baixado

```bash
node tools/gltf-para-glb.mjs <pasta com scene.gltf>   # 13 arquivos -> 1
node tools/enxugar-modelo.mjs <modelo.vrm>            # tira as expressoes faciais
```

**`.gltf` solto tem de virar `.glb`** porque ele busca o `.bin` numa SEGUNDA
requisicao, feita pelo `GLTFLoader` e nao pelo `buscar` que injetamos — entao um
modelo `.gltf` **nao pode ser testado em Node**. Ele funciona no navegador e
ninguem consegue provar que continua funcionando.

**Enxugar** tira os *morph targets* — as dezenas de expressoes faciais que o
VRoid embute (piscar, sorrir, as vogais da boca). `modelos.js` **ja as descarta**
ao montar o boneco: nosso rosto nao anima. Elas viajavam no `game.zip` e nunca
chegavam a tela. Medido num VRM de verdade: **342 expressoes, 16,6 -> 11,2 MB,
33% do arquivo**.

## 6. Conferir que entrou

Abra o Mundo e olhe o console: `modelos.js` resume o que carregou e o que
falhou. Programaticamente, `estadoDosModelos()`.

**Faltar arquivo é normal e não é erro** — mas "faltou" nunca pode virar
"faltou e ninguém viu": um nome errado no manifesto, um arquivo no lugar errado
e um GLB recusado dariam exatamente a mesma tela de "ainda não modelei essa
peça".

## 7. De onde tirar os modelos

O que decide a fonte não é a beleza: é que **peças modulares precisam vir do
mesmo autor**, com a mesma proporção e o mesmo estilo. Peça de dois pacotes
diferentes não encaixa.

| fonte | licença | serve para |
|---|---|---|
| [Kenney](https://kenney.nl/assets/blocky-characters) | CC0 | **o unico que serve HOJE** — corpo rigido, nos nomeados |
| [Quaternius](https://quaternius.com) | CC0 | personagens modulares low-poly — **rigados**, so' depois do §8 |
| [Synty POLYGON](https://syntystore.com) | paga | qualidade acima, estilo consistente |

> **Conferir antes de baixar dez pacotes:** `node tools/conferir-modelos.mjs`
> aceita o `.zip` direto, sem descompactar. Ver §5.1 para a medicao de cada um.

### Os outros 17 do Blocky custam 2 MB, e a conta nao e' a que este README dizia

O §0 supunha que os dezoito visuais custariam ~15 KB cada, por a geometria ser a
mesma. **Medido: cada `.glb` tem 113 KB** (as 27 animacoes viajam dentro dele), e
os dezoito somam **1997 KB de `.glb` + 295 KB de textura**. Os arquivos nao sao
identicos entre si nem descontando o nome da textura.

Como `web/` INTEIRO viaja no `game.zip`, adotar os dezoito custa ~2 MB a todo
mundo que baixa o jogo. Por isso eles **nao** foram instalados: ficam em
`modelos-teste/` (gitignored) para experimentar na bancada, e so' entra aqui o
que for escolhido. O caminho barato — um `.glb` e dezoito texturas, ~400 KB —
depende de `modelos.js` aprender a trocar a textura pelo manifesto, o que hoje
ele nao faz.

CC0 é o que não dá dor de cabeça: **este jogo redistribui o asset dentro do
`game.zip`**, o que já elimina várias licenças "grátis".

## 7.1 ANIMAÇÃO de arquivo (Mixamo)

O motor é o `AnimationMixer`, que **já vem no three** — nada a instalar. O que
faltava era trazer o clipe, e o formato do Mixamo (`.fbx`) agora é lido: o
`FBXLoader` está vendorizado e custa **50 KB** no `game.zip`, carregado sob
demanda.

```json
{
  "corpo": { "arquivo": "generico/generico.glb" },
  "animacoes": { "parado": "anim/idle.fbx", "andar": "anim/walking.fbx" }
}
```

`parado` e `andar` são os dois nomes que o `boneco3d.js` procura; a troca entre
eles é **cruzada** em 0,22 s, e não um corte — trocar de clipe no quadro
seguinte faz o corpo saltar da pose de um para a do outro, e a 60 Hz isso
aparece como um espasmo.

### Não é preciso enviar o seu personagem ao Mixamo

E nem dá: o Mixamo não aceita `.vrm`. **Não precisa.** Escolha qualquer
animação no catálogo, no boneco padrão deles, e baixe em **FBX** com
*"Without Skin"* (só o movimento, sem o corpo — fica em torno de 100 KB em vez
de 4 MB). O religamento (`animacao.js`) traduz o clipe para o esqueleto do SEU
modelo.

> **Trocar o nome da pista NÃO basta — e o sintoma engana.** Uma rotação local
> só quer dizer a mesma coisa em dois esqueletos se o osso **nasce apontando
> para o mesmo lado** nos dois. Mixamo e VRoid não nascem, e o resultado foi um
> corpo *"com as pernas pra cima, os braços pra trás, atravessando o tronco"* —
> com a animação perfeitamente **fluida**, porque o movimento estava certo e o
> referencial não. Quem olha culpa o modelo.
>
> O `retargetClip` do `SkeletonUtils` também não resolve: ele copia a rotação de
> MUNDO do osso de origem para o de destino, que é a mesma suposição por outro
> caminho. Medido antes de escrever o nosso: cabeça, ombro e quadril saíam
> plausíveis e **o pé ia parar a 1,64 m**, acima da cabeça.
>
> `religarPelaPose` amostra o clipe e transfere o **desvio da pose de descanso**:
>
> ```
> W_destino(t) = W_origem(t) · W_origem_descanso⁻¹ · W_destino_descanso
>                └──────────────── o desvio ───────┘
> ```
>
> Em palavras: *o quanto este osso girou em relação a como ele nasceu*, aplicado
> a como o osso do destino nasceu. Descansos iguais fazem os termos se
> cancelarem e sobra a cópia direta — que é o caso fácil, e era o que escondia o
> defeito.
>
> Duas consequências que o teste guarda: **osso sem par fica na pose de
> descanso** (um VRoid tem 124 ossos — cabelo, saia, seios — e o Mixamo manda
> 65; soltos, o cabelo voaria para dentro da cabeça), e a amostragem **prende o
> fim do clipe** (`LoopOnce` + `clampWhenFinished`), porque `setTime(duracao)` dá a
> volta e devolve o quadro zero — inofensivo numa caminhada, destrutivo num
> gesto que não fecha.

A tradução passa por um terceiro vocabulário, o **osso humanoide**
(`leftUpperArm`): do Mixamo ele vem por convenção de nome (`LeftArm`), e do VRM
vem **declarado dentro do arquivo**. Medido contra um VRoid: **as 53 pistas
religam** — 23 de corpo (quadril, coluna, pescoço, cabeça, os dois braços com
antebraço e mão, as duas pernas com pé e dedo) e 30 de falange.

> **Tocar um clipe no esqueleto errado não dá erro.** O mixer procura os nós
> pelos nomes das pistas, não acha nenhum, e o personagem fica parado — sem uma
> linha no console. Parece uma animação que não foi baixada direito. É por isso
> que `carregarAnimacoes` relata quantas pistas religaram, e que uma pista sem
> destino **sai** do clipe em vez de ficar quieta (trinta avisos do mixer
> afogariam qualquer erro de verdade).

> **Os DEDOS viajam** (desde 07/09/2026), e as 53 pistas religam. Eles eram as
> 30 descartadas, com a justificativa de que *"o nosso boneco não move os
> dedos"* — o que é verdade sobre o `andar()` escrito em código e irrelevante
> sobre um clipe de arquivo, que move. O que sobrava era a mão na **pose de
> bind** do VRoid: reta e aberta, uma espátula na ponta de um braço que se move
> bem. O relato foi *"as mãos duras, estáticas, esticando as mesmas — perde a
> naturalidade do restante da movimentação"*.
>
> O que estava sendo jogado fora, medido nos dois FBX: os dedos chegam
> **desviados do descanso em até 29,8° (parado) e 49,2° (andar)** — a mão
> relaxada, a curva que separa "mão" de "espátula" — e ainda **variam 10,9° e
> 18,9° ao longo do clipe**. Custam ~150 KB por clipe e nenhum desenho a mais: o
> *skinning* já paga a malha da mão, dobrada ou reta.

> **O POLEGAR é o único osso do corpo em que o mesmo nome quer dizer coisas
> diferentes.** O VRM 0.x nomeia os três `Proximal → Intermediate → Distal`; o
> 1.0 renomeou o primeiro para `Metacarpal` e **empurrou os outros dois um
> degrau** — então `leftThumbProximal` é o osso da BASE num arquivo e o do MEIO
> no outro. Com a grafia errada o polegar inteiro anda uma articulação e fica
> torto, o que parece decisão de quem modelou. A escolha é do CONJUNTO (quem
> declara `thumbMetacarpal` é 1.0), e não osso a osso pelo "primeiro nome
> declarado" — isso acertaria o 1.0 e erraria o 0.x justo no do meio, que é onde
> os dois nomes se cruzam. E o Mixamo escreve `Pinky` onde o VRM escreve
> `little`.

> **A POSIÇÃO só vale no quadril, e vai escalada.** Nos outros ossos ela estica
> o esqueleto de destino para as proporções do clipe — o braço sai do ombro, a
> perna descola do quadril. E o Mixamo trabalha em CENTÍMETROS: crua, a
> translação do quadril joga o personagem cem vezes para cima, e como o `y` do
> grupo é somado ao chão, ele some da tela sem erro. A escala sai da altura
> MÉDIA do quadril no clipe — o pico e o vale são o passo.

> **A altura do quadril é MEDIDA NO SEU MODELO**, e não uma constante que quem
> chama passa. Ela era `ANCORAS.pernaE[1]` (0,80 m), que é a junta da coxa do
> boneco de CÁPSULAS — o quadril do `generico.glb` está em 1,0127 m. A pista
> entrava escalada para a altura errada, o corpo descia 21 cm e **o dedo do pé
> ia parar a −15 cm do chão**: os pés enterrados. Hoje `religarPelaPose` lê o
> `position.y` do quadril do alvo. Se o seu rig põe o quadril na origem (o
> deslocamento todo num nó pai), a pista é DESCARTADA — sem quique, mas sem
> afundar.

> **E escalar a pista NÃO põe os pés no chão.** São duas contas: a escala é
> multiplicativa (unidade e proporção), o pouso é aditivo, e elas só coincidem
> quando a pose média do clipe é a pose de descanso do modelo — numa caminhada
> nunca é (joelho dobrado o tempo todo). Por isso `plantarNoChao` mede o clipe
> já religado e desloca o quadril para o ponto mais baixo do passo aterrissar em
> `y = 0`, com o **descanso de cada osso do pé** como referência (o osso do dedo
> nasce a 4,5 cm do chão, o do tornozelo a 12 cm — plantar o osso em zero
> enterraria o modelo pela espessura do sapato). O console diz quanto deslocou.

> **A escala da raiz não pode entrar na conta da rotação.** `normalizar()` põe
> o fator de 1,72 m na raiz do corpo, e `Quaternion.setFromRotationMatrix`
> supõe uma matriz sem escala: o quatérnio sai **não unitário** (medido: 0,975),
> `Matrix4.compose` monta uma base torta com ele, e o osso filho passa a nascer
> a uma distância que muda conforme o pai gira — **as mãos tremendo**, quatro
> níveis abaixo do ombro, com o resto do corpo liso. O caminho certo é
> `matrixWorld.decompose`.

## 8. O que ainda NÃO é suportado

- **expressão facial.** O VRM traz *blend shapes* (`VRMC_vrm_expressions`) e
  nada aqui os toca: o rosto fica na cara neutra do arquivo;
- **corpo por NPC.** Só um `corpo` é carregado por vez, e todo mundo usa o
  mesmo. Cada personagem da campanha com o seu modelo é trabalho separado;
- **textura em PEÇA** (no `corpo` ela funciona — ver §3);
- **peças modulares vindas de pacote pronto.** Nenhum pacote CC0 que olhei traz
  cabelo/blusa/calça como arquivos separados no mesmo rig; o do Kenney traz um
  corpo e dezoito pinturas (§0). Enquanto houver um `corpo` carregado, as peças
  procedurais cedem, e o vestiário fica sem forma para oferecer;
- **Draco/Meshopt**: os decodificadores não estão vendorizados. Exporte sem
  compressão.
