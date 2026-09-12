/**
 * Floresta 3D — o DESENHO do cenário que `floresta.js` decidiu.
 *
 * Mesma divisão do mundo 2D (`citymap.js` decide, `tileset.js` desenha), e
 * mesma regra de ouro dele: **a arte é gerada em código**. O front tem zero
 * dependências e o jogo instalado serve `%LOCALAPPDATA%` — um `.glb` de
 * floresta seria mais um binário sem fonte para viajar no `game.zip` e para
 * manter em sincronia com nada. Aqui tudo sai de cone, cilindro e icosaedro,
 * como os bonecos de `actors.js` saem de grade de texto.
 *
 * A paleta é IMPORTADA de `tileset.js` (`CHAO`), não copiada: duas paletas em
 * dois arquivos divergem na primeira mexida, e o sintoma seria os dois mundos
 * parecerem jogos diferentes.
 *
 * As armadilhas do three que erram CALADAS estão comentadas onde acontecem: o
 * `frustumCulled` de um `InstancedMesh`, a intensidade das luzes depois do
 * r155, o `toNonIndexed()` antes de fundir geometria, o deslocamento de
 * vértice por índice numa malha não-indexada, o `ShaderMaterial` que esquece
 * os blocos de tone mapping, o chão que precisa passar da parede do mundo, e a
 * normal da lâmina de capim. `MUNDO-3D-HANDOFF.md` §5 tem a lista inteira com
 * o sintoma de cada uma.
 *
 * Sem DOM: `montarCena` só monta grafo de cena. Quem cria o `<canvas>` e o
 * `WebGLRenderer` é `mundo3d.js` — é isso que deixa este arquivo rodar em Node
 * e ter teste.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { CHAO, rnd } from './tileset.js';
import { MUNDO, alturaDoChao, terraBatida, manchaDeChao } from './floresta.js';

/**
 * As cores. `CHAO.*` vem do tileset do mundo 2D — os tons CLAROS de cada
 * família, porque ali eles já vinham sombreados à mão e aqui quem sombreia é a
 * luz. Usar o tom escuro faria a floresta inteira parecer noite ao meio-dia.
 */
export const COR = {
  grama: CHAO.grama.detalhe,
  gramaEscura: CHAO.grama.base,
  terra: CHAO.terra.alt,
  pedra: CHAO.pedra.alt,
  tronco: '#4a3626',
  copa: '#3e6b46',
  copaClara: '#5a8b5c',
  samambaia: '#4f7a45',
  ceuAlto: '#27436b',
  ceuBaixo: '#d9c49a',
  sol: '#ffe3b0',
  nevoa: '#a3a98d',
};

/** De onde vem o sol. Rasante de propósito: sombra longa mostra o relevo. */
const DIR_SOL = new THREE.Vector3(0.55, 0.40, -0.73).normalize();

/**
 * A névoa, e a conta que depende dela.
 *
 * Ela não é clima: é o que ESCONDE A BORDA DO MUNDO. Por isso o chão não pode
 * ser do tamanho do mundo — ele precisa passar da parede invisível por, no
 * mínimo, a distância em que a névoa já apagou tudo. Com o plano curto, o
 * jogador que chega ao muro (raio 92) vê o chão terminar a poucos metros, no
 * ar, nítido. Não dá erro: dá um mundo que acaba à vista.
 *
 * O invariante é `metadeDoChao - MUNDO.raio >= NEVOA.longe`, e ele tem teste —
 * senão mexer num dos três números quebra calado o que os outros dois
 * garantiam.
 */
const NEVOA = { perto: 20, longe: 62 };
const MARGEM_DO_CHAO = 8;

// ------------------------------------------------------------- geometria

/**
 * Funde várias geometrias numa só, com uma cor por pedaço gravada em
 * `color`. É o que permite uma árvore inteira (tronco + copa, duas cores) ser
 * UM `InstancedMesh` — quatrocentas árvores em uma chamada de desenho.
 *
 * O `toNonIndexed()` não é detalhe: geometria indexada COMPARTILHA vértices, e
 * concatenar duas sem remapear o índice cola a copa de uma árvore no tronco da
 * outra. O resultado não é erro, é uma malha embaralhada.
 */
export function fundir(partes) {
  const prontas = partes.map(({ geo, cor }) => ({
    g: geo.index ? geo.toNonIndexed() : geo,
    cor: new THREE.Color(cor),
  }));

  const total = prontas.reduce((s, p) => s + p.g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);

  let o = 0;
  for (const { g, cor } of prontas) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) {
      col[(o + i) * 3] = cor.r;
      col[(o + i) * 3 + 1] = cor.g;
      col[(o + i) * 3 + 2] = cor.b;
    }
    o += n;
  }

  const fim = new THREE.BufferGeometry();
  fim.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fim.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  fim.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return fim;
}

/** Conífera: tronco fino e três saias de cone. Altura ~5,3 na escala 1. */
export function geoConifera() {
  const tronco = new THREE.CylinderGeometry(0.17, 0.30, 2.3, 6, 1);
  tronco.translate(0, 1.15, 0);
  const saias = [[1.85, 2.5, 2.30, 0.0], [1.45, 2.2, 3.40, 0.4], [0.95, 1.9, 4.45, 0.8]];
  return fundir([
    { geo: tronco, cor: COR.tronco },
    ...saias.map(([r, h, y, giro], i) => {
      const c = new THREE.ConeGeometry(r, h, 7);
      c.rotateY(giro);
      c.translate(0, y, 0);
      return { geo: c, cor: i === 1 ? COR.copaClara : COR.copa };
    }),
  ]);
}

/** Copada: tronco grosso e bolhas de folhagem. Mesma altura da conífera. */
export function geoCopada() {
  const tronco = new THREE.CylinderGeometry(0.20, 0.36, 2.9, 6, 1);
  tronco.translate(0, 1.45, 0);
  const bolhas = [[0, 3.7, 0, 1.75], [0.95, 3.15, 0.35, 1.20], [-0.85, 3.35, -0.5, 1.15], [0.2, 4.5, -0.7, 1.0]];
  return fundir([
    { geo: tronco, cor: COR.tronco },
    ...bolhas.map(([x, y, z, r], i) => {
      const b = new THREE.IcosahedronGeometry(r, 0);
      b.scale(1, 0.86, 1);
      b.translate(x, y, z);
      return { geo: b, cor: i % 2 ? COR.copaClara : COR.copa };
    }),
  ]);
}

/** Samambaia: um leque de folhas tombadas para fora. Não bloqueia passagem. */
export function geoSamambaia() {
  const folhas = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.ConeGeometry(0.15, 0.95, 3);
    f.translate(0, 0.47, 0);
    f.rotateX(0.55);
    f.rotateY((i / 5) * Math.PI * 2);
    folhas.push({ geo: f, cor: i % 2 ? COR.samambaia : COR.copaClara });
  }
  return fundir(folhas);
}

/**
 * Pedra: icosaedro AMASSADO. O deslocamento sai da própria coordenada do
 * vértice, e não do índice dele — a geometria é não-indexada (cada face tem
 * cópia própria dos cantos), então deslocar por índice rasgaria a malha em
 * triângulos soltos.
 */
export function geoPedra() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.70 + rnd(Math.round(x * 64), Math.round(z * 64), Math.round(y * 64)) * 0.55;
    p.setXYZ(i, x * k, y * k * 0.72, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Tufo de capim: duas lâminas cruzadas, para ter volume de qualquer ângulo. */
export function geoCapim() {
  const a = new THREE.PlaneGeometry(0.11, 0.52);
  a.translate(0, 0.26, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const g = fundir([{ geo: a, cor: COR.grama }, { geo: b, cor: COR.gramaEscura }]);

  // Normal para CIMA, e não a normal real da lâmina. Uma folha em pé tem
  // normal HORIZONTAL, e com o sol a 40° isso a deixa quase preta — o gramado
  // vira uma penugem escura sobre um chão claro, que é o avesso do que se quer.
  // Apontando para cima, cada tufo recebe a mesma luz do chão em que está. É o
  // truque padrão de grama estilizada, e é de graça: nenhum triângulo a mais.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

// ----------------------------------------------------------------- o chão

function malhaDoChao() {
  // Ver `NEVOA`: o chão passa da parede do mundo pelo alcance inteiro da
  // névoa, para que a borda dele nunca esteja à vista de onde se pode chegar.
  const lado = (MUNDO.raio + NEVOA.longe + MARGEM_DO_CHAO) * 2;
  const seg = 192;                        // ~1,7 m por quadrado
  const g = new THREE.PlaneGeometry(lado, lado, seg, seg);
  g.rotateX(-Math.PI / 2);

  const p = g.attributes.position;
  const cores = new Float32Array(p.count * 3);
  const escura = new THREE.Color(COR.gramaEscura);
  const clara = new THREE.Color(COR.grama);
  const terra = new THREE.Color(COR.terra);
  const tom = new THREE.Color();

  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    // A altura vem de `alturaDoChao` e de mais lugar nenhum: é a mesma
    // função que põe os pés do jogador no chão (ver o cabeçalho de
    // `floresta.js`). Uma segunda conta aqui faria o boneco flutuar.
    p.setY(i, alturaDoChao(x, z));
    tom.copy(escura).lerp(clara, manchaDeChao(x, z));
    tom.lerp(terra, terraBatida(x, z));
    cores[i * 3] = tom.r; cores[i * 3 + 1] = tom.g; cores[i * 3 + 2] = tom.b;
  }

  g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  g.computeVertexNormals();

  const chao = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
  }));
  chao.receiveShadow = true;
  chao.name = 'chao';
  return chao;
}

/**
 * O céu: uma esfera vista por dentro, com o degradê e o halo do sol pintados
 * nos VÉRTICES. Sem `ShaderMaterial` de propósito — um shader escrito à mão
 * precisa incluir na unha os blocos de tone mapping e de espaço de cor do
 * three, e esquecê-los devolve um céu estourado que ninguém sabe explicar.
 */
function domoDoCeu() {
  const g = new THREE.SphereGeometry(MUNDO.raio * 3.2, 64, 40);
  const p = g.attributes.position;
  const cores = new Float32Array(p.count * 3);
  const alto = new THREE.Color(COR.ceuAlto);
  const baixo = new THREE.Color(COR.ceuBaixo);
  const rente = new THREE.Color(COR.nevoa);
  const luz = new THREE.Color(COR.sol);
  const tom = new THREE.Color();
  const dir = new THREE.Vector3();
  const macio = (t) => t * t * (3 - 2 * t);

  for (let i = 0; i < p.count; i++) {
    dir.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    // TRÊS faixas, e a de baixo é a COR DA NÉVOA. Com duas, o horizonte tinha
    // um degrau: o chão distante chega à linha do horizonte já apagado na cor
    // da névoa, e logo acima começava o tom quente do céu. A emenda aparecia
    // como um risco em volta do mundo inteiro.
    const t = Math.max(0, Math.min(1, (dir.y + 0.02) / 0.12));
    tom.copy(rente).lerp(baixo, macio(t));
    const u = Math.max(0, Math.min(1, (dir.y - 0.10) / 0.45));
    tom.lerp(alto, macio(u));
    const halo = Math.pow(Math.max(0, dir.dot(DIR_SOL)), 7) * 0.55;
    tom.r += luz.r * halo; tom.g += luz.g * halo; tom.b += luz.b * halo;
    cores[i * 3] = tom.r; cores[i * 3 + 1] = tom.g; cores[i * 3 + 2] = tom.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cores, 3));

  const domo = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  domo.frustumCulled = false;
  domo.name = 'ceu';
  return domo;
}

// ----------------------------------------------------------- povoamento 3D

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function plantar(geo, mat, postos, { sombra = true, aoPor } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, postos.length));
  im.count = postos.length;
  im.castShadow = sombra;
  // Receber sombra é o que faz o tronco escurecer sob a copa vizinha. Custa
  // uma linha no shader, e sem isso a mata fica com aquele ar de maquete: cada
  // árvore iluminada igual, independentemente de quantas há na frente dela.
  im.receiveShadow = sombra;
  // A esfera de recorte de um InstancedMesh sai da GEOMETRIA, que aqui é uma
  // árvore de dois metros na origem — as outras 399 ficam fora dela. O
  // resultado é a floresta inteira sumindo quando a câmera aponta para longe
  // da origem, sem erro nenhum. Desligar o recorte custa nada: são cinco malhas.
  im.frustumCulled = false;
  for (let i = 0; i < postos.length; i++) im.setMatrixAt(i, aoPor(postos[i], i));
  im.instanceMatrix.needsUpdate = true;
  return im;
}

function matrizDe(posto, balanco = 0) {
  _e.set(Math.cos(posto.giro) * ((posto.tombo ?? 0) + balanco), posto.giro,
         Math.sin(posto.giro) * ((posto.tombo ?? 0) + balanco));
  _q.setFromEuler(_e);
  _p.set(posto.x, posto.y, posto.z);
  _s.setScalar(posto.escala);
  return _m.compose(_p, _q, _s);
}

// ------------------------------------------------------------------ a cena

/**
 * Monta a cena inteira a partir do mapa de `construirFloresta()`.
 *
 * Devolve `atualizar(t)` (o vento) e `seguirSol(x, z)` — a câmera de sombra é
 * uma caixa apertada em volta do jogador; deixá-la cobrir os 184 m do mundo
 * daria uma sombra de tal resolução que não se veria nenhuma.
 */
export function montarCena(mapa) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COR.nevoa);
  scene.fog = new THREE.Fog(COR.nevoa, NEVOA.perto, NEVOA.longe);

  scene.add(domoDoCeu());
  scene.add(malhaDoChao());

  // Depois do r155 as luzes do three são FÍSICAS: os valores de intensidade de
  // um exemplo antigo (0.6, 0.8) renderizam uma cena quase preta aqui, e a
  // reação natural — clarear as cores — deixa tudo lavado. Estes são os
  // valores desta cena, com tone mapping ACES ligado no renderer.
  const hemi = new THREE.HemisphereLight('#9fc0e0', '#3a4a2c', 1.35);
  scene.add(hemi);

  const sol = new THREE.DirectionalLight(COR.sol, 2.6);
  sol.position.copy(DIR_SOL).multiplyScalar(60);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.camera.near = 1;
  sol.shadow.camera.far = 180;
  sol.shadow.camera.left = -32; sol.shadow.camera.right = 32;
  sol.shadow.camera.top = 32; sol.shadow.camera.bottom = -32;
  sol.shadow.bias = -0.0006;
  sol.shadow.normalBias = 0.035;
  scene.add(sol, sol.target);

  const matVeg = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const matPedra = new THREE.MeshLambertMaterial({ color: COR.pedra, flatShading: true });
  const matCapim = new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide,
  });

  const coniferas = mapa.arvores.filter((a) => a.conifera);
  const copadas = mapa.arvores.filter((a) => !a.conifera);

  const arvoresA = plantar(geoConifera(), matVeg, coniferas, { aoPor: (p) => matrizDe(p) });
  const arvoresB = plantar(geoCopada(), matVeg, copadas, { aoPor: (p) => matrizDe(p) });
  const pedras = plantar(geoPedra(), matPedra, mapa.pedras, { aoPor: (p) => matrizDe(p) });
  const moitas = plantar(geoSamambaia(), matVeg, mapa.moitas, { sombra: false, aoPor: (p) => matrizDe(p) });
  const capim = plantar(geoCapim(), matCapim, mapa.grama, { sombra: false, aoPor: (p) => matrizDe(p) });

  scene.add(arvoresA, arvoresB, pedras, moitas, capim);

  /**
   * O vento. Só o que se mexe: árvore, samambaia e capim; a pedra fica quieta.
   * São ~2500 matrizes por quadro, que em JS custa uma fração de milissegundo
   * — o caro seria animar por shader e ter de reescrever o material do three.
   */
  function balancar(im, postos, amplitude, ritmo) {
    for (let i = 0; i < postos.length; i++) {
      const p = postos[i];
      im.setMatrixAt(i, matrizDe(p, Math.sin(ritmo + p.fase) * amplitude));
    }
    im.instanceMatrix.needsUpdate = true;
  }

  function atualizar(t) {
    balancar(arvoresA, coniferas, 0.014, t * 0.9);
    balancar(arvoresB, copadas, 0.019, t * 0.8);
    balancar(moitas, mapa.moitas, 0.075, t * 1.6);
    balancar(capim, mapa.grama, 0.16, t * 2.1);
  }

  function seguirSol(x, z) {
    sol.position.set(x + DIR_SOL.x * 60, DIR_SOL.y * 60, z + DIR_SOL.z * 60);
    sol.target.position.set(x, 0, z);
    sol.target.updateMatrixWorld();
  }

  return { scene, sol, atualizar, seguirSol };
}
