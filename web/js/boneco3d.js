/**
 * Boneco 3D — o duelista, montado de cápsulas e esferas.
 *
 * É o irmão de `actors.js` (a grade de texto do mundo 2D) e continua usando **a
 * mesma paleta**: sem aparência salva, `padraoDe(id)` cai em `coresPara(id)`,
 * então o mesmo adversário tem a mesma cara nos dois mundos, sem guardar
 * aparência em lugar nenhum.
 *
 * ---
 *
 * ## O contrato: uma FÁBRICA DE GEOMETRIA por peça
 *
 * `aparencia.js` diz **quais peças existem**; este arquivo diz **qual é a
 * forma** de cada uma. Cada construtor devolve uma lista de partes —
 * `{ geo, cor, em, pos, rot, esc }` — e nada mais: quem monta, posiciona e
 * pinta é o `vestir()` aqui embaixo.
 *
 * Isso é de propósito, e é o que torna o caminho para modelos de verdade uma
 * troca e não uma reescrita: **esse dia já chegou pela metade.** `modelos.js`
 * carrega `.glb` no boot, e toda peça pergunta por um ANTES de montar a forma
 * escrita aqui. Havendo modelo, ele vence; não havendo, a cápsula assume.
 *
 * O que isso compra é a troca **gradual e reversível**: modela-se um cabelo
 * hoje, o resto continua procedural, e apagar o arquivo devolve a cápsula. Nem
 * o vestiário, nem a posse, nem o banco, nem a rede sabem a diferença.
 *
 * ## O boneco olha para +Z
 *
 * Isso é **contrato** com quem o gira: o giro em Y de um alvo em (x,z) é
 * `Math.atan2(dx, dz)`. Montá-lo olhando para -Z (que é para onde uma câmera do
 * three olha por padrão) faria todo duelista ficar de costas para quem chega, e
 * nada acusaria — só pareceria grosseria.
 *
 * ## A perna pendura na ARTICULAÇÃO
 *
 * Ela e o braço são um `Group` na altura da junta, com a malha deslocada para
 * baixo. Girar a malha direto giraria em torno do meio da coxa, e o passo
 * viraria uma perna que encolhe e cresce.
 *
 * ## As geometrias são COMPARTILHADAS e nunca descartadas
 *
 * São ~20 formas no jogo inteiro, e um `Group` novo por pessoa que entra na
 * floresta. Cada boneco criar as suas seria refazer vinte buffers a cada
 * chegada; então elas ficam num cache por chave e `descartar()` **solta só os
 * materiais**, que são os que carregam a cor e por isso existem um por boneco.
 *
 * > Descartar a geometria compartilhada seria o pior tipo de defeito: some a
 * > peça do PRÓXIMO boneco, muito depois, e a causa fica a dez minutos de
 * > distância. Guardado por teste.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { normalizar } from './aparencia.js';
import {
  geometriaDe, parteDoCorpo, temCorpoModelado, corpoVivo, ANCORAS, ALTURA_BONECO,
} from './modelos.js';
import { clone as clonarComEsqueleto } from '../vendor/three/addons/SkeletonUtils.js';
import { poseDeRepouso } from './corpovivo.js';
import { materialDoPersonagem } from './personagens3d.js';

/**
 * Do pé ao alto da cabeça, em metros. **Vem de `modelos.js`** junto com as
 * âncoras: é o número pelo qual um personagem importado é normalizado, e duas
 * cópias dele dariam um modelo de um tamanho e um esqueleto de outro.
 */
export const ALTURA = ALTURA_BONECO;

// As juntas. Tudo se pendura nelas, e o `andar()` gira exatamente estas.
// As posições saem de `ANCORAS` pela mesma razão: quem importa um modelo
// desconta exatamente estas coordenadas.
const Y_QUADRIL = ANCORAS.pernaE[1];
const Y_OMBRO = ANCORAS.bracoE[1];
const Y_PESCOCO = 1.38;
const Y_CABECA = ANCORAS.cabeca[1];

// ---------------------------------------------------------------- o cache
/**
 * Geometria por chave. Ver o cabeçalho: são poucas e valem para todos os
 * bonecos, então nascem uma vez e não são descartadas.
 */
const _geos = new Map();
function geo(chave, montar) {
  let g = _geos.get(chave);
  if (!g) { g = montar(); _geos.set(chave, g); }
  return g;
}

/** Só para o teste conseguir provar que o descarte não come o cache. */
export const _cacheDeGeometria = _geos;

// Cápsula deitada no eixo Z (a cápsula do three nasce em pé, no Y).
function capsulaZ(chave, raio, comp, segs = 8) {
  return geo(chave, () => {
    const g = new THREE.CapsuleGeometry(raio, comp, 4, segs);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

const capsula = (chave, raio, comp, segs = 8) =>
  geo(chave, () => new THREE.CapsuleGeometry(raio, comp, 4, segs));
const esfera = (chave, raio, w = 16, h = 12) =>
  geo(chave, () => new THREE.SphereGeometry(raio, w, h));

/**
 * Meia esfera — a calota que é a base de quase todo cabelo. `phiLength` até
 * `PI/2` corta na altura do equador; o `openEnded` fica falso para a calota não
 * ficar oca vista de baixo, que é o que se vê quando a câmera passa por trás.
 */
const calota = (chave, raio, ate = Math.PI / 2) =>
  geo(chave, () => new THREE.SphereGeometry(raio, 18, 12, 0, Math.PI * 2, 0, ate));

/** A camisa por baixo do blazer. Quase-branco: o branco puro estoura na luz. */
const BRANCO_DE_CAMISA = '#f2f4f8';

/**
 * A cor do slot, puxada para o escuro — a gravata, o laço, as pregas da saia.
 *
 * É derivada e não fixa porque a mesma forma veste as duas campanhas: a
 * Academia em azul e o Reino em vermelho. Um preto fixo ficaria pesado sobre
 * uma cor clara e sumiria sobre um azul-marinho; puxar a MESMA cor para baixo
 * mantém o contraste em qualquer escolha, e ainda parece o mesmo uniforme.
 *
 * O piso de `0.12` no brilho evita o outro extremo: escurecer um azul já escuro
 * até o preto apagaria o detalhe de novo, que é o defeito que isto conserta.
 */
function escurecer(hex) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), Math.max(0.12, hsl.l * 0.45));
  return '#' + c.getHexString();
}

// ------------------------------------------------------- os construtores
/**
 * Cada peça devolve partes. `cor` é `'cor'` (a cor escolhida no slot) ou
 * `'pele'`; `em` é a junta onde a parte pendura.
 *
 * As juntas válidas são as de `montarCorpo`: `raiz`, `tronco`, `cabeca`,
 * `bracoE`, `bracoD`, `pernaE`, `pernaD`. Uma junta que não existe faria a
 * parte sumir em silêncio — por isso o `vestir()` reclama alto (ver lá).
 */
const CONSTRUTORES = {
  // ------------------------------------------------------------- cabelo
  'cabelo-careca': () => [],

  'cabelo-curto': () => [
    { geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.004, 0], esc: [1, 1.06, 1] },
    { geo: capsula('nuca', 0.075, 0.06, 10), cor: 'cor', em: 'cabeca', pos: [0, -0.02, -0.10], esc: [1.5, 1, 0.7] },
  ],

  'cabelo-espetado': () => {
    const partes = [{ geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.005, 0] }];
    // Cinco espetos em leque, inclinados para trás.
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.42;
      partes.push({
        geo: geo('espeto', () => new THREE.ConeGeometry(0.036, 0.20, 6)),
        cor: 'cor', em: 'cabeca',
        pos: [Math.sin(a) * 0.10, 0.16, Math.cos(a) * 0.06 - 0.02],
        rot: [-0.45, 0, -a * 0.55],
      });
    }
    return partes;
  },

  'cabelo-rabo': () => [
    { geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.004, 0], esc: [1, 1.06, 1] },
    { geo: capsula('rabo', 0.055, 0.24, 10), cor: 'cor', em: 'cabeca', pos: [0, -0.02, -0.17], rot: [0.55, 0, 0] },
  ],

  'cabelo-moicano': () => [
    { geo: capsula('crista', 0.045, 0.20, 8), cor: 'cor', em: 'cabeca',
      pos: [0, 0.13, -0.01], rot: [Math.PI / 2, 0, 0], esc: [1, 1, 1.5] },
  ],

  'cabelo-longo': () => [
    { geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.004, 0], esc: [1, 1.06, 1] },
    { geo: capsula('juba', 0.13, 0.16, 12), cor: 'cor', em: 'cabeca',
      pos: [0, -0.13, -0.05], esc: [1.05, 1, 0.75] },
  ],

  /**
   * CHANQUINHA com franja — o corte colegial mais reconhecível.
   *
   * A FRANJA é o que faz o corte: sem ela a calota lisa lê como "cabelo curto"
   * genérico. Ela é uma caixa fina à frente da testa, e não uma deformação da
   * calota, porque a calota é compartilhada por todos os cabelos (`geo` guarda
   * por chave) — deformá-la mudaria os outros seis.
   */
  'cabelo-chanel': () => [
    { geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.004, 0], esc: [1, 1.05, 1] },
    { geo: geo('franja', () => new THREE.BoxGeometry(0.26, 0.06, 0.03)),
      cor: 'cor', em: 'cabeca', pos: [0, 0.075, 0.132], rot: [0.22, 0, 0] },
    // os dois lados descem até o queixo: é o comprimento que define o chanel
    ...[-1, 1].map((lado) => ({
      geo: capsula('mecha-lateral', 0.043, 0.13, 8), cor: 'cor', em: 'cabeca',
      pos: [0.135 * lado, -0.055, 0.02], esc: [0.85, 1, 1.1],
    })),
    { geo: capsula('nuca-cheia', 0.09, 0.10, 10), cor: 'cor', em: 'cabeca',
      pos: [0, -0.04, -0.085], esc: [1.5, 1, 0.85] },
  ],

  /** Duas MARIA-CHIQUINHAS. */
  'cabelo-chiquinhas': () => [
    { geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.004, 0], esc: [1, 1.05, 1] },
    { geo: geo('franja', () => new THREE.BoxGeometry(0.26, 0.06, 0.03)),
      cor: 'cor', em: 'cabeca', pos: [0, 0.075, 0.132], rot: [0.22, 0, 0] },
    ...[-1, 1].map((lado) => ({
      geo: capsula('chiquinha', 0.05, 0.17, 8), cor: 'cor', em: 'cabeca',
      pos: [0.17 * lado, -0.06, -0.05], rot: [0.2, 0, 0.55 * lado],
    })),
  ],

  /** Repartido de lado, com a franja caída — o colegial masculino. */
  'cabelo-reparticao': () => [
    { geo: calota('calota-15', 0.152), cor: 'cor', em: 'cabeca', pos: [0, 0.004, 0], esc: [1, 1.04, 1] },
    { geo: geo('franja-lado', () => new THREE.BoxGeometry(0.20, 0.055, 0.03)),
      cor: 'cor', em: 'cabeca', pos: [0.035, 0.082, 0.128], rot: [0.3, 0, -0.28] },
    { geo: capsula('nuca', 0.075, 0.06, 10), cor: 'cor', em: 'cabeca',
      pos: [0, -0.02, -0.10], esc: [1.5, 1, 0.7] },
  ],

  // -------------------------------------------------------------- roupa
  // A manga é parte da BLUSA, e não do braço: é ela que decide se o braço
  // aparece de pele ou de pano, e é a diferença que se vê entre um colete e
  // uma jaqueta.
  'roupa-camiseta': () => [
    { geo: capsula('torso-roupa', 0.205, 0.30, 14), cor: 'cor', em: 'tronco', pos: [0, 0, 0], esc: [1, 1, 0.68] },
    ...['bracoE', 'bracoD'].map((em) => (
      { geo: capsula('manga-curta', 0.075, 0.10, 10), cor: 'cor', em, pos: [0, -0.11, 0] }
    )),
  ],

  'roupa-jaqueta': () => [
    { geo: capsula('torso-roupa-g', 0.215, 0.32, 14), cor: 'cor', em: 'tronco', pos: [0, 0, 0], esc: [1, 1, 0.70] },
    { geo: geo('gola', () => new THREE.TorusGeometry(0.10, 0.032, 6, 14)), cor: 'cor', em: 'tronco',
      pos: [0, 0.27, 0], rot: [Math.PI / 2, 0, 0], esc: [1, 0.72, 1] },
    ...['bracoE', 'bracoD'].map((em) => (
      { geo: capsula('manga-longa', 0.072, 0.26, 10), cor: 'cor', em, pos: [0, -0.19, 0] }
    )),
  ],

  'roupa-colete': () => [
    { geo: capsula('torso-roupa', 0.205, 0.30, 14), cor: 'cor', em: 'tronco', pos: [0, -0.02, 0], esc: [1, 0.92, 0.68] },
  ],

  'roupa-tunica': () => [
    { geo: capsula('torso-roupa-g', 0.215, 0.32, 14), cor: 'cor', em: 'tronco', pos: [0, 0, 0], esc: [1, 1, 0.70] },
    // A saia da túnica desce do TRONCO, e não da perna: pendurada na perna ela
    // balançaria com o passo, e túnica não é calça.
    { geo: geo('saia-tunica', () => new THREE.CylinderGeometry(0.20, 0.27, 0.30, 16, 1, true)),
      cor: 'cor', em: 'tronco', pos: [0, -0.36, 0], esc: [1, 1, 0.8] },
    ...['bracoE', 'bracoD'].map((em) => (
      { geo: capsula('manga-longa', 0.072, 0.26, 10), cor: 'cor', em, pos: [0, -0.19, 0] }
    )),
  ],

  // ---------------------------------------------------- o UNIFORME escolar
  //
  // > **Peça de peito tem de CRUZAR a superfície do tronco, não encostar nela.**
  // > O torso vestido é uma cápsula de raio `0,215` achatada em `z` por `0,70`:
  // > a frente dele está em **`z = 0,1505`**. Uma gravata pousada em `0,166`
  // > fica 6 mm à frente do pano, e 6 mm é o bastante para ela parecer solta
  // > quando a câmera chega perto — sem nada acusar, porque não há erro: a peça
  // > está exatamente onde foi mandada. Os números abaixo entram POR DENTRO.
  //
  // As campanhas são "Academia de Duelo" e "Reino dos Duelistas", e o eleno é
  // colegial. Ele é GERADO EM CÓDIGO como todo o resto (a lei da casa), e isso
  // não é teimosia: custa zero byte no `game.zip`, não tem licença para
  // respeitar, e **anda** — as partes penduram nas juntas e o `andar()` de
  // sempre as move. Um `.glb` de personagem anético gratúis entra com esqueleto e
  // fica parado numa pose de T (ver `conferirmodelo.js`).
  //
  // O que faz "parecer uniforme" não é polígono, são três detalhes de
  // silhueta, e são baratos: a **gola em V** do blazer, a **gravata** (ou o
  // **laço**) no peito, e a **lapela**. Sem eles, um blazer é uma jaqueta
  // qualquer.
  //
  // A cor vem do slot, como em toda peça — é o que deixa a mesma forma servir
  // à Academia (azul) e ao Reino (vermelho) sem um segundo modelo.

  /** O corpo do blazer, comum às duas variantes. */
  'roupa-blazer': () => [
    { geo: capsula('torso-roupa-g', 0.215, 0.32, 14), cor: 'cor', em: 'tronco', pos: [0, 0, 0], esc: [1, 1, 0.70] },
    // A LAPELA: dois planos inclinados no peito. É o que separa "blazer" de
    // "jaqueta" à distância em que o jogador vê o NPC.
    ...[-1, 1].map((lado) => ({
      geo: geo('lapela', () => new THREE.BoxGeometry(0.075, 0.20, 0.02)),
      cor: 'cor', em: 'tronco', pos: [0.062 * lado, 0.10, 0.152], rot: [0.06, 0, 0.30 * lado],
    })),
    // A camisa por baixo, no V da gola. Ela é SEMPRE clara e não usa a cor do
    // slot: uma camisa da cor do blazer apagaria o V, e o V é o desenho inteiro.
    { geo: geo('camisa-v', () => new THREE.BoxGeometry(0.10, 0.21, 0.02)),
      cor: 'branco', em: 'tronco', pos: [0, 0.105, 0.146] },
    { geo: geo('gola-camisa', () => new THREE.TorusGeometry(0.093, 0.022, 6, 12)),
      cor: 'branco', em: 'tronco', pos: [0, 0.245, 0.01], rot: [Math.PI / 2, 0, 0], esc: [1, 0.7, 1] },
    ...['bracoE', 'bracoD'].map((em) => (
      { geo: capsula('manga-longa', 0.072, 0.26, 10), cor: 'cor', em, pos: [0, -0.19, 0] }
    )),
  ],

  /** Blazer com GRAVATA — o uniforme masculino clássico. */
  'roupa-uniforme': () => [
    ...CONSTRUTORES['roupa-blazer'](),
    { geo: geo('gravata', () => new THREE.BoxGeometry(0.042, 0.19, 0.018)),
      cor: 'detalhe', em: 'tronco', pos: [0, 0.10, 0.150] },
    { geo: geo('no-gravata', () => new THREE.BoxGeometry(0.05, 0.045, 0.028)),
      cor: 'detalhe', em: 'tronco', pos: [0, 0.205, 0.155] },
  ],

  /** Blazer com LAÇO — a variante do uniforme feminino. */
  'roupa-uniforme-laco': () => [
    ...CONSTRUTORES['roupa-blazer'](),
    ...[-1, 1].map((lado) => ({
      geo: geo('asa-laco', () => new THREE.BoxGeometry(0.055, 0.05, 0.02)),
      cor: 'detalhe', em: 'tronco', pos: [0.042 * lado, 0.20, 0.152], rot: [0, 0, 0.35 * lado],
    })),
    { geo: geo('no-laco', () => new THREE.BoxGeometry(0.028, 0.04, 0.026)),
      cor: 'detalhe', em: 'tronco', pos: [0, 0.20, 0.158] },
  ],

  /** Colete de tricô sobre a camisa — o meio-termo, sem o blazer. */
  'roupa-sueter': () => [
    { geo: capsula('torso-roupa', 0.205, 0.30, 14), cor: 'cor', em: 'tronco', pos: [0, -0.01, 0], esc: [1, 0.96, 0.68] },
    { geo: geo('camisa-v', () => new THREE.BoxGeometry(0.10, 0.21, 0.02)),
      cor: 'branco', em: 'tronco', pos: [0, 0.105, 0.135] },
    { geo: geo('gola-camisa', () => new THREE.TorusGeometry(0.093, 0.022, 6, 12)),
      cor: 'branco', em: 'tronco', pos: [0, 0.245, 0.01], rot: [Math.PI / 2, 0, 0], esc: [1, 0.7, 1] },
    { geo: geo('gravata', () => new THREE.BoxGeometry(0.042, 0.19, 0.018)),
      cor: 'detalhe', em: 'tronco', pos: [0, 0.10, 0.145] },
    ...['bracoE', 'bracoD'].map((em) => (
      { geo: capsula('manga-curta', 0.075, 0.10, 10), cor: 'cor', em, pos: [0, -0.11, 0] }
    )),
  ],

  // -------------------------------------------------------------- calça
  'calca-comprida': () => ['pernaE', 'pernaD'].map((em) => (
    { geo: capsula('perna-roupa', 0.088, 0.494, 10), cor: 'cor', em, pos: [0, -0.335, 0] }
  )),

  'calca-bermuda': () => ['pernaE', 'pernaD'].map((em) => (
    { geo: capsula('perna-roupa-curta', 0.092, 0.166, 10), cor: 'cor', em, pos: [0, -0.175, 0] }
  )),

  'calca-saia': () => [
    { geo: geo('saia', () => new THREE.CylinderGeometry(0.17, 0.30, 0.26, 16, 1, true)),
      cor: 'cor', em: 'raiz', pos: [0, Y_QUADRIL - 0.07, 0], esc: [1, 1, 0.82] },
  ],

  /**
   * A SAIA PREGUEADA do uniforme. As pregas são o desenho: uma saia lisa lida
   * como vestido, e o vinco é o que a faz colegial — doze planos finos em volta
   * do cone, que é mais barato que subdividir a malha.
   *
   * Ela desce da RAIZ, como `calca-saia`: pendurada na perna balançaria com o
   * passo, e saia não é calça.
   */
  'calca-saia-pregueada': () => {
    const partes = [
      { geo: geo('saia', () => new THREE.CylinderGeometry(0.17, 0.30, 0.26, 16, 1, true)),
        cor: 'cor', em: 'raiz', pos: [0, Y_QUADRIL - 0.07, 0], esc: [1, 1, 0.82] },
    ];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      partes.push({
        geo: geo('prega', () => new THREE.BoxGeometry(0.012, 0.26, 0.028)),
        cor: 'detalhe', em: 'raiz',
        pos: [Math.sin(a) * 0.245, Y_QUADRIL - 0.07, Math.cos(a) * 0.245 * 0.82],
        rot: [0, a, 0],
      });
    }
    return partes;
  },

  // ------------------------------------------------------------- calçado
  'sapato-tenis': () => ['pernaE', 'pernaD'].map((em) => (
    { geo: capsulaZ('pe', 0.072, 0.10, 10), cor: 'cor', em, pos: [0, -0.739, 0.03], esc: [1, 0.85, 1] }
  )),

  /** Sapato social com MEIA alta — a silhueta colegial abaixo do joelho. */
  'sapato-colegial': () => ['pernaE', 'pernaD'].map((em) => [
    { geo: capsula('meia', 0.086, 0.16, 10), cor: 'branco', em, pos: [0, -0.60, 0] },
    { geo: capsulaZ('pe', 0.072, 0.10, 10), cor: 'cor', em, pos: [0, -0.739, 0.03], esc: [1, 0.8, 1] },
  ]).flat(),

  'sapato-bota': () => ['pernaE', 'pernaD'].map((em) => [
    { geo: capsulaZ('pe', 0.072, 0.10, 10), cor: 'cor', em, pos: [0, -0.739, 0.03], esc: [1.05, 0.85, 1] },
    { geo: capsula('cano', 0.092, 0.10, 10), cor: 'cor', em, pos: [0, -0.63, 0] },
  ]).flat(),
};

/** Quais peças este arquivo sabe construir. O teste cruza com `PECAS`. */
export const PECAS_CONSTRUIVEIS = Object.keys(CONSTRUTORES);

/**
 * As partes de uma peça: **o modelo, se houver; a forma escrita aqui, se não**.
 *
 * Esta é a ponte inteira, e ela é uma linha de decisão de propósito — o resto
 * do arquivo não sabe que existe `.glb`. `geometriaDe` devolve as geometrias já
 * repartidas POR JUNTA (uma jaqueta modelada com nós `tronco`/`bracoE`/`bracoD`
 * chega aqui como três), e a cor continua sendo nossa: dali sai forma, nunca
 * material. Ver `modelos.js`.
 */
function partesDaPeca(pecaId) {
  const doModelo = geometriaDe(pecaId);
  if (doModelo) {
    return Object.entries(doModelo).map(([em, geo]) => ({ geo, cor: 'cor', em }));
  }
  return CONSTRUTORES[pecaId]?.() ?? null;
}

/**
 * O mesmo para uma parte do CORPO. `espelho` existe porque braço e perna são
 * modelados uma vez e usados dos dois lados — cobrar o simétrico de quem modela
 * seria pedir dois arquivos idênticos.
 */
function formaDoCorpo(chave, junta, procedural) {
  const doModelo = geometriaDe(chave);
  return doModelo?.[junta] ?? procedural();
}

// ---------------------------------------------------------------- montar
/**
 * Monta um duelista.
 *
 * `quem` é `{ id, aparencia }` — o `id` decide a aparência de fábrica (ver
 * `padraoDe`), e a `aparencia` a sobrepõe quando existe. Passar só um id já
 * devolve o boneco de sempre.
 *
 * Devolve o `Group` (origem nos PÉS, para bastar somar a altura do chão), um
 * `andar(fase, andando)` para o loop, um `vestir(aparencia)` para trocar de
 * roupa sem remontar o corpo, e um `descartar()` para quando este corpo deixar
 * de existir.
 */
export function criarBoneco(quem) {
  const id = quem?.id ?? quem;
  const grupo = new THREE.Group();
  const materiais = [];

  const mat = (hex) => {
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
    materiais.push(m);
    return m;
  };

  // ------------------------------------------------------------ o corpo
  const juntas = { raiz: grupo };

  const pele = mat('#ffffff');           // a cor certa entra no `vestir`
  const olho = mat('#12151d');

  function membro(nome, y, x) {
    const j = new THREE.Group();
    j.position.set(x, y, 0);
    grupo.add(j);
    juntas[nome] = j;
    return j;
  }

  const pernas = [membro('pernaE', Y_QUADRIL, ANCORAS.pernaE[0]),
                  membro('pernaD', Y_QUADRIL, ANCORAS.pernaD[0])];
  const bracos = [membro('bracoE', Y_OMBRO, ANCORAS.bracoE[0]),
                  membro('bracoD', Y_OMBRO, ANCORAS.bracoD[0])];

  const tronco = new THREE.Group();
  tronco.position.set(...ANCORAS.tronco);
  grupo.add(tronco);
  juntas.tronco = tronco;

  const cabeca = new THREE.Group();
  cabeca.position.set(...ANCORAS.cabeca);
  grupo.add(cabeca);
  juntas.cabeca = cabeca;

  function pendurar(pai, g, material, pos, rot, esc) {
    const m = new THREE.Mesh(g, material);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (esc) m.scale.set(esc[0], esc[1], esc[2]);
    m.castShadow = true;
    pai.add(m);
    return m;
  }

  // A pele. Cada junta pergunta por um modelo antes de usar a cápsula: um
  // personagem inteiro (`corpo`) responde por todas, um `corpo-cabeca.glb`
  // troca só a cabeça, e o que não tiver modelo continua primitiva.
  //
  // O modelo vem MODELADO no lugar certo, então ele não leva a posição nem a
  // escala da cápsula que substitui — elas existem para dar forma a uma
  // primitiva, e aplicá-las a uma malha autoral a deformaria.
  //
  // `parte.mat` é o material do ARQUIVO, e ele NÃO passa pelo `mat()`: os
  // materiais do arquivo são compartilhados entre todos os bonecos (vêm do
  // cache de `modelos.js`), e descartá-los no `descartar()` apagaria a textura
  // do PRÓXIMO — o mesmo defeito que o cache de geometria já evita.
  // QUEM eu sou: o personagem escolhido troca a TEXTURA do corpo, e nada mais.
  // O material vem clonado e CACHEADO por personagem (`personagens3d.js`), então
  // dez pessoas com o mesmo personagem dividem um material — e nenhum deles é
  // descartado aqui, pelo mesmo motivo dos materiais do arquivo.
  const quemSou = quem?.aparencia?.personagem?.peca;
  const daJunta = (junta) => {
    const parte = parteDoCorpo(junta);
    if (!parte) return null;
    const trocado = materialDoPersonagem(quemSou, parte.mat);
    return trocado ? { geo: parte.geo, mat: trocado } : parte;
  };

  // ------------------------------------------------------- O CORPO VIVO
  //
  // Um corpo com esqueleto entra INTEIRO, clonado, e o `andar()` gira os ossos
  // em vez de girar `Group`s com pedaços de malha pendurados. A diferença é a
  // dobra: o skinning deforma a pele no ombro, e some o corte seco que o
  // fatiamento deixa (ver `repartir.js`).
  //
  // **E ele DISPENSA o corpo procedural.** Isto não é economia: `parteDoCorpo`
  // devolve `null` para o corpo vivo (a geometria dele não passa por
  // `geometriaDe`), e sem a guarda abaixo cada `else` mais adiante monta a sua
  // cápsula — o boneco de cápsulas fica DENTRO do personagem, aparecendo pelas
  // bordas. Nada dá erro; são dois corpos no mesmo lugar.
  //
  // **`SkeletonUtils.clone`, e não `Object3D.clone`.** O segundo copia a malha e
  // deixa o ESQUELETO compartilhado: duas pessoas na floresta andariam em
  // sincronia perfeita, com os mesmos ossos, e a terceira mexeria as duas. Não
  // dá erro — parece coreografia.
  const vivo = corpoVivo();
  let ossos = null;
  let corpoClonado = null;
  /** O `AnimationMixer` deste boneco, quando há clipe. `null` = anda no código. */
  let mixer = null;
  /** `nome -> AnimationAction`. As ações são deste boneco; os clipes, de todos. */
  const acoes = new Map();
  /** A ação que está tocando agora — para saber de onde sair na transição. */
  let tocando = null;
  if (vivo) {
    corpoClonado = clonarComEsqueleto(vivo.cena);
    // O VRM olha para −Z e o nosso boneco para +Z. Sem a meia-volta todo mundo
    // anda de costas — impossível de não notar jogando, e fácil de não notar
    // num teste que só mede a caixa envolvente.
    if (vivo.frente < 0) corpoClonado.rotation.y = Math.PI;
    grupo.add(corpoClonado);

    // A pose de bind do VRM é T. Baixar os braços é o que separa "personagem"
    // de "boneco de vitrine" — ver `poseDeRepouso`.
    // A pose de repouso depende de ser VRM (a pose de bind dele é T), e NÃO de
    // para onde ele olha — eram a mesma pergunta enquanto a frente era deduzida
    // do formato, e deixaram de ser quando ela passou a ser medida.
    const repouso = poseDeRepouso(vivo.vrm);

    ossos = new Map();
    for (const [junta, nome] of Object.entries(vivo.ossos ?? {})) {
      const o = corpoClonado.getObjectByName(nome);
      if (!o) continue;
      const r = repouso[junta];
      if (r) o.rotation[r.eixo] += r.valor;
      // a POSE de repouso é guardada: o passo é um desvio a partir dela, e não
      // uma rotação absoluta. Zerar o osso desmontaria a pose do modelo.
      ossos.set(junta, { o, base: o.rotation.x });
    }
    if (!ossos.size) console.warn('[boneco3d] corpo com esqueleto e nenhum osso reconhecido');

    // ------------------------------------------------------- as ANIMAÇÕES
    //
    // Cada boneco tem o SEU mixer, sobre o SEU clone: um mixer compartilhado
    // poria todo mundo no mesmo quadro da mesma animação, e dez pessoas na
    // floresta virariam um corpo de baile.
    //
    // Os CLIPES, esses, são compartilhados — eles são dados, e o mixer só os
    // lê. Clonar um clipe de 18 s por pessoa seria pagar a mesma tabela de
    // quadros dez vezes.
    if (vivo.clipes?.size) {
      mixer = new THREE.AnimationMixer(corpoClonado);
      for (const [nome, clipe] of vivo.clipes) acoes.set(nome, mixer.clipAction(clipe));
    }
  }

  if (!vivo) montarCorpoProcedural();

  function montarCorpoProcedural() {
  const doTronco = daJunta('tronco');
  if (doTronco) pendurar(tronco, doTronco.geo, doTronco.mat ?? pele);
  else pendurar(tronco, capsula('torso', 0.19, 0.28, 14), pele, [0, 0, 0], null, [1, 1, 0.66]);

  const daCabeca = daJunta('cabeca');
  if (daCabeca) pendurar(cabeca, daCabeca.geo, daCabeca.mat ?? pele);
  else {
    pendurar(grupo, capsula('pescoco', 0.055, 0.05, 8), pele, [0, Y_PESCOCO, 0]);
    pendurar(cabeca, esfera('cabeca', 0.145, 20, 14), pele, [0, 0, 0], null, [1, 1.07, 0.95]);
    // Os olhos são da cápsula: um modelo de cabeça traz os dele (ou não tem,
    // e aí é escolha de quem modelou).
    for (const lado of [-1, 1]) {
      pendurar(cabeca, esfera('olho', 0.021, 8, 6), olho, [lado * 0.062, 0.015, 0.133]);
    }
  }

  for (const [b, junta] of [[bracos[0], 'bracoE'], [bracos[1], 'bracoD']]) {
    const parte = daJunta(junta);
    if (parte) { pendurar(b, parte.geo, parte.mat ?? pele); continue; }
    pendurar(b, capsula('braco', 0.062, 0.26, 10), pele, [0, -0.19, 0]);
    pendurar(b, esfera('mao', 0.058, 10, 8), pele, [0, -0.36, 0]);
  }
  for (const [p, junta] of [[pernas[0], 'pernaE'], [pernas[1], 'pernaD']]) {
    const parte = daJunta(junta);
    if (parte) { pendurar(p, parte.geo, parte.mat ?? pele); continue; }
    pendurar(p, capsula('perna', 0.078, 0.544, 10), pele, [0, -0.35, 0]);
  }
  }

  // ----------------------------------------------------------- a roupa
  // As peças vivem num Group por junta, para trocar de roupa ser esvaziar e
  // remontar SÓ isso — o corpo e as articulações ficam de pé, e é o que deixa o
  // vestiário responder a cada clique sem piscar o boneco inteiro.
  const vestidos = [];
  let aparenciaAtual = null;

  function despir() {
    for (const m of vestidos) { m.removeFromParent(); }
    vestidos.length = 0;
    // Os materiais das peças saem junto: eles são um por peça e por cor, e
    // trocar de roupa dez vezes no vestiário criaria dez materiais órfãos cada.
    for (let i = materiais.length - 1; i >= 0; i--) {
      if (materiais[i].userData.dePeca) { materiais[i].dispose(); materiais.splice(i, 1); }
    }
  }

  function vestir(aparencia) {
    const a = normalizar(aparencia, id);
    aparenciaAtual = a;
    despir();

    pele.color.set(a.pele);

    // **Um personagem pronto já vem vestido.** As peças procedurais são
    // cápsulas pensadas para o corpo de cápsulas; empilhá-las sobre um modelo
    // texturizado seria pôr uma segunda roupa por cima da primeira, com a
    // proporção errada. Enquanto o `corpo` estiver carregado, a roupa cede.
    //
    // Isto é um ESTADO conhecido, e não uma capitulação: o pacote que temos
    // hoje (Kenney Blocky) não traz peças separadas — traz um corpo e dezoito
    // pinturas. Quando houver `.glb` POR PEÇA, esta condição sai e o vestiário
    // volta inteiro, sem mais nada mudar.
    if (temCorpoModelado()) return;

    for (const slot of ['cabelo', 'roupa', 'calca', 'sapato']) {
      const escolha = a[slot];
      // A ponte: modelo se houver, forma escrita aqui se não.
      const partes = partesDaPeca(escolha.peca);
      // `normalizar` já garante que a peça existe no catálogo; chegar aqui sem
      // forma NENHUMA é o catálogo e a geometria terem se desencontrado, e o
      // sintoma seria um buraco no boneco. Barulho no console é o mínimo — o
      // teste que cruza os dois é quem impede isto de chegar em produção.
      if (!partes) { console.warn(`[boneco3d] sem geometria para "${escolha.peca}"`); continue; }

      const material = mat(escolha.cor);
      material.userData.dePeca = true;

      // As duas cores FIXAS de uma peça, e por que elas existem.
      //
      // O uniforme escolar depende de contraste: a camisa no V da gola e a
      // gravata são o desenho inteiro, e pintá-las com a cor do slot as apaga —
      // sobra uma jaqueta lisa. Mas fixar um vermelho de gravata mataria a outra
      // metade: a MESMA forma tem de servir à Academia (azul) e ao Reino
      // (vermelho), e é a cor do slot que faz isso sem um segundo modelo.
      //
      // Então `branco` é fixo (camisa é camisa) e `detalhe` é DERIVADO: a cor do
      // slot puxada para o escuro, o suficiente para a gravata se destacar em
      // qualquer cor que se escolha — inclusive nas claras, onde um preto fixo
      // ficaria pesado e num azul-marinho sumiria.
      let branco = null, detalhe = null;
      const daPeca = (m) => { m.userData.dePeca = true; return m; };

      for (const parte of partes) {
        const pai = juntas[parte.em];
        if (!pai) { console.warn(`[boneco3d] junta "${parte.em}" nao existe`); continue; }

        let usar = material;
        if (parte.cor === 'pele') usar = pele;
        else if (parte.cor === 'branco') usar = branco ??= daPeca(mat(BRANCO_DE_CAMISA));
        else if (parte.cor === 'detalhe') usar = detalhe ??= daPeca(mat(escurecer(escolha.cor)));

        vestidos.push(pendurar(pai, parte.geo, usar, parte.pos, parte.rot, parte.esc));
      }
    }
  }

  vestir(quem?.aparencia ?? null);

  /**
   * O passo. `fase` é tempo acumulado ANDANDO (não o relógio): parar no meio
   * de uma passada e voltar deixaria a perna dar um salto se a fase fosse o
   * relógio corrido.
   */
  function andar(fase, andando, dt = 0) {
    // ------------------------------------------------- ANIMAÇÃO DE ARQUIVO
    //
    // Quando há clipe, ele MANDA: o mixer escreve nos ossos, e a nossa conta de
    // seno escreveria por cima no mesmo quadro — o resultado seria a animação
    // "tremendo", com dois donos disputando a mesma rotação a 60 Hz.
    //
    // A troca entre parado e andando é CRUZADA (`crossFadeTo`), e não um corte:
    // trocar de clipe no quadro seguinte faz o corpo saltar da pose de um para
    // a do outro, e a 60 Hz isso aparece como um espasmo.
    if (mixer) {
      // PARADO sem clipe de "parado" é ficar parado — e não tocar a caminhada.
      //
      // O `??` que caía no primeiro clipe disponível parecia razoável e dava um
      // personagem **andando no lugar** enquanto o jogador não aperta nada: os
      // pés se mexem, o corpo não sai do lugar, e a cena inteira fica com cara
      // de defeito. Com só uma animação instalada — que é o caso comum —, esse
      // era o estado da MAIOR parte do tempo.
      const alvo = andando ? (acoes.get('andar') ?? [...acoes.values()][0]) : acoes.get('parado');

      if (alvo !== tocando) {
        if (alvo) {
          alvo.reset().play();
          if (tocando) tocando.crossFadeTo(alvo, 0.22, false);
        } else if (tocando) {
          // sem clipe de destino, some com o atual em vez de cortá-lo: um corte
          // trava o corpo na pose exata do quadro em que se soltou a tecla
          tocando.fadeOut(0.18);
        }
        tocando = alvo;
      }
      // o mixer PRECISA continuar avançando durante o fade-out — parar aqui
      // deixaria o corpo congelado no meio da transição, para sempre

      // `dt` em segundos. Sem ele o mixer não avança — e o personagem fica na
      // pose do primeiro quadro, que é indistinguível de "a animação não
      // carregou". Quem chama tem de passá-lo; o `0` do padrão é o que mantém
      // um chamador antigo desenhando, mesmo que parado.
      mixer.update(dt);
      grupo.position.y = grupo.userData.chao ?? 0;
      return;
    }

    const balanco = andando ? Math.sin(fase * 9.5) * 0.62 : 0;

    // COM ESQUELETO, quem anda é o osso — e o balanço é MENOR.
    //
    // Os 0,62 rad do boneco de cápsulas existem para uma perna que é um cilindro
    // rígido: sem exagero, o passo não se lê. Num corpo com pele a mesma
    // amplitude vira uma passada de desenho animado, e a coxa deformada aparece
    // atravessando a saia. Dois terços é o que ficou parecendo gente.
    //
    // O sinal do braço é o oposto do da perna do mesmo lado: é assim que se
    // anda. Igualá-los dá um boneco marchando.
    if (ossos?.size) {
      const b = balanco * 0.66;
      const par = [['pernaE', b], ['pernaD', -b], ['bracoE', -b * 0.7], ['bracoD', b * 0.7]];
      for (const [junta, v] of par) {
        const alvo = ossos.get(junta);
        if (alvo) alvo.o.rotation.x = alvo.base + v;
      }
      grupo.position.y = (grupo.userData.chao ?? 0)
        + (andando ? Math.abs(Math.sin(fase * 9.5)) * 0.03 : 0);
      return;
    }

    pernas[0].rotation.x = balanco;
    pernas[1].rotation.x = -balanco;
    bracos[0].rotation.x = -balanco * 0.75;
    bracos[1].rotation.x = balanco * 0.75;
    // Um quique de dois centímetros no meio do passo. É pouco de propósito:
    // mais que isso e a câmera, que segue o boneco, começa a enjoar.
    grupo.position.y = (grupo.userData.chao ?? 0) + (andando ? Math.abs(Math.sin(fase * 9.5)) * 0.03 : 0);
  }

  /**
   * Devolve à GPU o que este boneco alocou — **os materiais, e só eles**.
   *
   * As pessoas ENTRAM E SAEM da floresta o tempo todo, e `scene.remove()` tira
   * do grafo sem liberar nada: o navegador não coleta buffer de vídeo por
   * alcançabilidade, e numa sessão longa a memória sobe até o contexto de WebGL
   * se perder — a tela apaga sem um erro que aponte para cá.
   *
   * A GEOMETRIA fica: ela é compartilhada entre todos os bonecos (ver o
   * cabeçalho). Descartá-la aqui apagaria a peça do PRÓXIMO boneco, muito
   * depois, com a causa a dez minutos de distância.
   */
  function descartar() {
    for (const m of materiais) m.dispose();
    materiais.length = 0;
    // O clone tem MALHA e ESQUELETO próprios (`SkeletonUtils.clone`), e o
    // navegador não coleta buffer de vídeo por alcançabilidade: sem devolver,
    // cada pessoa que entra e sai da floresta deixa 36 mil triângulos para trás
    // e a sessão longa perde o contexto de WebGL — a tela apaga sem erro.
    //
    // A GEOMETRIA do clone é compartilhada com o original (o `clone` copia o
    // grafo, não os buffers), então ela NÃO se descarta aqui — só os materiais,
    // que são clonados junto.
    // O mixer segura referências ao grafo do clone; sem soltá-lo, o clone não é
    // coletado e o personagem inteiro fica na memória depois de a pessoa sair.
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(corpoClonado); mixer = null; }
    acoes.clear();
    tocando = null;
    if (corpoClonado) {
      corpoClonado.traverse((n) => {
        if (!n.isMesh) return;
        for (const m of (Array.isArray(n.material) ? n.material : [n.material])) m?.dispose?.();
      });
      corpoClonado.removeFromParent();
      corpoClonado = null;
    }
    grupo.removeFromParent();
  }

  grupo.userData.chao = 0;
  return { grupo, andar, vestir, descartar, get aparencia() { return aparenciaAtual; } };
}
