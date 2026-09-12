# `web/vendor/` — as bibliotecas de terceiros

Esta é a **única** pasta do front com código que não é nosso, e ela existe por
uma razão só: **o jogo não pode depender de CDN**.

O front tem zero dependências e nenhum `build step`, então a alternativa
natural — `npm install three` — não existe aqui. A outra alternativa,
`import ... from 'https://cdn…'`, foi descartada porque o `ClassicDuels.exe`
serve `%LOCALAPPDATA%` na máquina de quem joga: um `import` externo deixa o
mundo 3D sem abrir exatamente quando a conexão está pior, e a falha é
silenciosa (um `import` que dá 404 mata o `<script type="module">` inteiro,
sem uma linha no console para quem não sabe abrir o F12).

Vendorizar resolve os dois lados de graça: o arquivo viaja no `game.zip` como
qualquer coisa de `web/` (`Copy-Item -Recurse` em `tools/publish-release.ps1`),
e o navegador o carrega do disco.

## three.js

| | |
|---|---|
| versão | **r185** (`three@0.185.1`) |
| origem | `https://cdn.jsdelivr.net/npm/three@0.185.1/build/` |
| arquivos | `three.module.min.js` + `three.core.min.js` + `LICENSE` |
| tamanho | 734 KB no disco · **~184 KB** dentro do `game.zip` |
| licença | MIT |

`three.module.min.js` importa `./three.core.min.js` por caminho **relativo** —
os dois têm de ficar lado a lado, com esses nomes.

### Os addons

| addon | para quê | custo no `game.zip` |
|---|---|---|
| `GLTFLoader.js` | ler `.glb`/`.gltf`/`.vrm` | — |
| `BufferGeometryUtils.js` | fundir malhas por junta | — |
| `SkeletonUtils.js` | clonar um corpo COM o esqueleto dele | — |
| `FBXLoader.js` + `libs/fflate` + `curves/NURBS*` | ler as animações do **Mixamo** | **50 KB** |

O `FBXLoader` é importado **sob demanda** (`await import(...)` dentro de
`carregarAnimacoes`, em `modelos.js`), e não no topo: quem nunca põe uma
animação não paga o download nem o parse dele. Ele traz duas dependências
próprias — `fflate` (os FBX vêm comprimidos) e `NURBSCurve` —, e os `import`
delas foram reescritos para caminho relativo, como o resto.

Quem usa: `web/js/floresta3d.js`, `web/js/boneco3d.js` e `web/js/mundo3d.js`
(o mundo andável em 3D da Área de Teste). Os dois primeiros não encostam em
DOM de propósito — é isso que deixa `web/js/floresta.test.mjs` montar a cena
inteira em Node e provar que este pacote carrega.

### Para atualizar

```powershell
$v = '0.185.1'   # troque pela versao nova
foreach ($f in 'build/three.module.min.js','build/three.core.min.js','LICENSE') {
  Invoke-WebRequest "https://cdn.jsdelivr.net/npm/three@$v/$f" `
    -OutFile ("web/vendor/three/" + (Split-Path $f -Leaf)) -UseBasicParsing
}
node web/js/floresta.test.mjs
```

Duas coisas que a atualização quebra **caladas**, e que o teste guarda:

- **a intensidade das luzes.** A partir do r155 elas são físicas. Valores de
  exemplo antigos (0.6, 0.8) renderizam uma cena quase preta, e a reação
  natural — clarear as cores — deixa tudo lavado. Os valores de
  `floresta3d.js` são para esta cena, com tone mapping ACES ligado;
- **o nome do build.** Se um dia o `three.module.min.js` deixar de existir (ou
  parar de importar o `three.core.min.js`), o `import` falha e o mundo 3D não
  abre. O teste confere que os três arquivos estão no lugar e que nenhum
  módulo nosso voltou a importar de fora.

## addons/ — o GLTFLoader (31/08/2026)

```
three/addons/
  GLTFLoader.js            115 KB   le .glb / .gltf
  BufferGeometryUtils.js    38 KB   o GLTFLoader importa
  SkeletonUtils.js          12 KB   idem
```

Baixados de `cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/` — **a mesma
revisao do three vendorizado ao lado**. Custam ~36 KB no `game.zip`.

Servem ao personagem do Mundo: `web/js/modelos.js` troca as capsulas do boneco
por arte modelada, uma peca de cada vez. Ver `web/modelos/README.md`.

> **O UNICO ajuste no fonte foi o caminho do import**, e ele e' o que quebra em
> silencio. Os tres vinham com `from 'three'` — um *bare specifier*, que o
> navegador **nao resolve** sem import map. Um `import` que da' 404 mata o
> `<script type="module">` INTEIRO, sem uma linha no console: e' o mesmo
> estrago dos dez arquivos orfaos de 24/08/2026, quando a home passou a
> desenhar so' o casco estatico. Hoje e' `from '../three.module.min.js'`, e
> `web/js/modelos.test.mjs` cobra que nenhum voltou ao bare.

> **Ao ATUALIZAR o three, atualize os tres juntos** e reescreva o import de
> novo. Um addon de uma revisao contra um three de outra nao da' erro de
> import — da' comportamento torto, muito depois.

> **Nao ha' DRACOLoader nem MeshoptDecoder.** GLB comprimido e' recusado pelo
> loader e vira uma falha contada em `estadoDosModelos()`; exporte sem
> compressao.
