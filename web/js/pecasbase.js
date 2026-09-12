/**
 * **PEÇAS BASE** — árvore, pedra e chão para o Editor de Cena.
 *
 * Elas não são importadas de lugar nenhum: são **as mesmas** que o Mundo já
 * desenha. `geoConifera`, `geoCopada`, `geoPedra`, `geoSamambaia` e `geoCapim`
 * moram em `floresta3d.js` e agora são exportadas — uma segunda árvore neste
 * arquivo divergiria da floresta na primeira mexida, e o sintoma seria a cena
 * montada no editor parecer um jogo diferente do mundo em que ela entra.
 *
 * O que este módulo acrescenta é só o que a floresta não tinha por ser peça de
 * EDITOR: as placas de chão (a floresta gera um terreno inteiro, não pedaços) e
 * os metadados que a gaveta mostra.
 *
 * ---
 *
 * ## Elas custam ZERO byte no `game.zip`
 *
 * É a regra da casa (*"a arte é gerada em código"*), e aqui ela paga duas
 * vezes: nenhum arquivo viaja, e o editor **tem o que colocar mesmo sem a
 * biblioteca do Tag Force** — que é gerada por uma ferramenta que só roda em
 * quem tem o ISO. Antes disto, abrir o editor sem `web/pecas/` dava uma gaveta
 * vazia.
 *
 * ## A COR vem no vértice, não numa textura
 *
 * `fundir` grava uma cor por vértice (é assim que a floresta pinta tronco e
 * copa numa malha só), então o material precisa de `vertexColors: true`. Sem
 * isso a peça sai **branca** — não quebra nada, e é indistinguível de uma
 * escolha de arte ruim.
 *
 * ## A DIMENSÃO é medida, nunca escrita
 *
 * A gaveta mostra "2,4 × 5,3 × 2,4 m" ao lado de cada peça, e é por esse número
 * que se decide se ela cabe. Escrevê-lo à mão envelhece calado: mexer na
 * geometria não muda o texto, e a gaveta passa a mentir sobre o tamanho.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { CHAO } from './tileset.js';
import {
  COR, fundir, geoConifera, geoCopada, geoSamambaia, geoPedra, geoCapim,
} from './floresta3d.js';

/** Todo id de peça base começa assim — é o que a separa das do Tag Force. */
export const PREFIXO_BASE = 'base-';
export const ehPecaBase = (id) => typeof id === 'string' && id.startsWith(PREFIXO_BASE);

/**
 * Põe o PISO da geometria em `y = 0`.
 *
 * O editor solta a peça no chão, então uma malha centrada na origem nasce com
 * metade enterrada — foi o que o teste pegou na pedra (icosaedro, base em
 * `y = −0,48`). Assentar aqui, medindo, é o que impede o próximo de errar:
 * acertar o `translate` de cada peça à mão envelhece a cada mexida na forma.
 */
function assentar(g) {
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  return g;
}

/**
 * Uma placa de chão: quadrado deitado, com uma leve variação de cor.
 *
 * `altura` é uma FUNÇÃO `(x, z) => metros`, em coordenadas locais da placa
 * (`−lado/2 … +lado/2`), e ela é lida **em cada vértice** — exatamente como
 * `malhaDoChao` (`floresta3d.js`) desloca os 37 mil vértices do chão da
 * floresta por `alturaDoChao`. É a diferença entre ter relevo e não ter:
 *
 * > A primeira versão passava as QUATRO alturas dos cantos e interpolava por
 * > dentro. Parecia certo e era pior que nada. A grade do relevo tem passo de
 * > 4 m e as placas de 4 m grudam em múltiplos de 4, então os cantos delas
 * > caem sempre no MEIO de dois nós: um morro de 6 m no nó (0,0) virava uma
 * > placa **plana** a 2,26 m — o cume, que é o único lugar onde se olha,
 * > era o único achatado. Medido, não deduzido.
 *
 * A subdivisão é de ~1 m (a mesma ordem do chão da floresta, ~1,7 m): com dois
 * triângulos por placa o morro vira uma dobra diagonal grosseira.
 */
function geoPlaca(lado, cor, corAlt, altura = null) {
  const seg = Math.max(4, Math.round(lado));
  const g = new THREE.PlaneGeometry(lado, lado, seg, seg);
  g.rotateX(-Math.PI / 2);

  if (altura) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, altura(pos.getX(i), pos.getZ(i)));
  }

  // Duas cores em xadrez para a placa não virar um plano chapado — sem isso,
  // duas placas lado a lado não se distinguem e a cena parece um vazio.
  //
  // Aqui não se usa `fundir`: ele quer uma geometria por cor, e uma placa de
  // 12 m tem 288 triângulos. Criar 288 `BufferGeometry` a cada pincelada, para
  // todas as placas, é o que faz um editor "funcionar" e travar — que na tela é
  // indistinguível de não funcionar.
  const meio = g.toNonIndexed();
  const p = meio.attributes.position;
  const n = p.count;
  const nor = new Float32Array(n * 3);
  const cores = new Float32Array(n * 3);
  const a = new THREE.Color(cor), b = new THREE.Color(corAlt);

  for (let i = 0; i < n; i += 3) {
    // A normal sai da FACE, e não de um `+Y` escrito à mão: com relevo, uma
    // normal fixa para cima deixaria o morro iluminado como se fosse plano —
    // ele existiria na silhueta e desapareceria na luz.
    const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const c = Math.hypot(nx, ny, nz) || 1;
    nx /= c; ny /= c; nz /= c;
    const t = (i / 3) % 3 === 0 ? b : a;
    for (let k = 0; k < 3; k++) {
      nor[(i + k) * 3] = nx; nor[(i + k) * 3 + 1] = ny; nor[(i + k) * 3 + 2] = nz;
      cores[(i + k) * 3] = t.r; cores[(i + k) * 3 + 1] = t.g; cores[(i + k) * 3 + 2] = t.b;
    }
  }

  meio.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  meio.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  g.dispose();
  return meio;
}

/** Pedregulho: a mesma pedra da floresta, achatada e virada — não é outra malha. */
function geoPedregulho() {
  const g = geoPedra();
  g.scale(1.6, 0.55, 1.3);
  g.rotateY(0.7);
  return assentar(fundir([{ geo: g, cor: COR.pedra }]));
}

/** Pedra em pé, mais alta que larga. */
function geoMenir() {
  const g = geoPedra();
  g.scale(0.55, 2.2, 0.6);
  return assentar(fundir([{ geo: g, cor: COR.pedra }]));
}

/** Três pedras juntas — o agrupamento que ninguém quer montar peça a peça. */
function geoPedras() {
  const partes = [];
  for (const [x, z, s, gy] of [[0, 0, 1, 0], [1.1, 0.5, 0.6, 1.2], [-0.8, 0.7, 0.45, 2.1]]) {
    const g = geoPedra();
    g.scale(s, s * 0.8, s);
    g.rotateY(gy);
    g.translate(x, s * 0.4, z);
    partes.push({ geo: g, cor: COR.pedra });
  }
  return assentar(fundir(partes));
}

/** Um tufo com várias lâminas, porque uma só some de longe. */
function geoMoita() {
  const partes = [];
  for (const [x, z] of [[0, 0], [0.18, 0.1], [-0.15, 0.12], [0.05, -0.16]]) {
    const g = geoCapim();
    g.translate(x, 0, z);
    partes.push({ geo: g, cor: COR.grama });
  }
  return fundir(partes);
}

/**
 * O catálogo. `grupo` é o que a gaveta usa para as gavetas dobráveis — sem ele,
 * as peças base ficariam na mesma lista de 142 do Tag Force, que é o problema
 * que os grupos existem para resolver.
 */
export const PECAS_BASE = [
  { id: 'base-conifera', nome: 'Pinheiro', grupo: 'Árvores e plantas', geo: geoConifera },
  { id: 'base-copada', nome: 'Árvore copada', grupo: 'Árvores e plantas', geo: geoCopada },
  { id: 'base-samambaia', nome: 'Samambaia', grupo: 'Árvores e plantas', geo: geoSamambaia },
  { id: 'base-moita', nome: 'Moita de capim', grupo: 'Árvores e plantas', geo: geoMoita },

  { id: 'base-pedra', nome: 'Pedra', grupo: 'Pedras', geo: () => assentar(fundir([{ geo: geoPedra(), cor: COR.pedra }])) },
  { id: 'base-pedregulho', nome: 'Pedregulho', grupo: 'Pedras', geo: geoPedregulho },
  { id: 'base-menir', nome: 'Pedra em pé', grupo: 'Pedras', geo: geoMenir },
  { id: 'base-pedras', nome: 'Três pedras', grupo: 'Pedras', geo: geoPedras },

  { id: 'base-chao-grama', nome: 'Chão de grama', grupo: 'Chão', modulo: 4, terreno: 4,
    geo: (altura) => geoPlaca(4, CHAO.grama.base, CHAO.grama.detalhe, altura) },
  { id: 'base-chao-terra', nome: 'Chão de terra', grupo: 'Chão', modulo: 4, terreno: 4,
    geo: (altura) => geoPlaca(4, CHAO.terra.base, CHAO.terra.alt, altura) },
  { id: 'base-chao-pedra', nome: 'Chão de pedra', grupo: 'Chão', modulo: 4, terreno: 4,
    geo: (altura) => geoPlaca(4, CHAO.pedra.base, CHAO.pedra.alt, altura) },
  { id: 'base-chao-grande', nome: 'Chão grande (12 m)', grupo: 'Chão', modulo: 12, terreno: 12,
    geo: (altura) => geoPlaca(12, CHAO.grama.base, CHAO.grama.detalhe, altura) },
];

/**
 * A geometria de uma peça base, ou `null` se o id não for de uma.
 *
 * `altura` só é usada pelas placas de TERRENO: é a função `(x, z) => metros`
 * que `geoPlaca` lê em cada vértice. Sem ela a placa sai plana — e plana é o
 * padrão, porque a geometria da biblioteca é COMPARTILHADA entre todas as
 * cópias e deformá-la deformaria o mapa inteiro de uma vez.
 */
export function geometriaBase(id, altura = null) {
  const p = PECAS_BASE.find((x) => x.id === id);
  return p ? p.geo(altura) : null;
}

/** O lado da placa, se esta peça for TERRENO. `0` = não se deforma. */
export const ladoDoTerreno = (id) => PECAS_BASE.find((x) => x.id === id)?.terreno ?? 0;

/**
 * O catálogo para a gaveta, com a dimensão **medida** da geometria — nunca
 * escrita à mão, que envelheceria calada na primeira mexida na forma.
 *
 * Roda uma vez e joga as geometrias fora: quem as usa de verdade é
 * `carregarPeca`, que as cacheia. Medir aqui custa uma construção por peça no
 * boot, e é o que impede a gaveta de mentir sobre o tamanho.
 */
export function catalogoBase() {
  return PECAS_BASE.map((p) => {
    const g = p.geo();
    g.computeBoundingBox();
    const c = g.boundingBox;
    const dim = [c.max.x - c.min.x, c.max.y - c.min.y, c.max.z - c.min.z]
      .map((v) => Math.round(v * 10) / 10);
    const tri = g.attributes.position.count / 3;
    g.dispose();
    return { id: p.id, nome: p.nome, grupo: p.grupo, dim, tri, tex: null, base: true,
             ...(p.modulo ? { modulo: p.modulo } : {}),
             ...(p.terreno ? { terreno: p.terreno } : {}) };
  });
}
