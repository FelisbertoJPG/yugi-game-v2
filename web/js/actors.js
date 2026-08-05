/**
 * Actors — os bonecos (jogador e NPCs), também desenhados em código.
 *
 * A arte é escrita como GRADE DE TEXTO: cada caractere é 1 pixel lógico e vira
 * uma cor pela paleta. É o jeito mais legível de manter pixel art dentro de um
 * `.js` — dá pra editar o desenho olhando pra ele, sem contar coordenada.
 *
 * O sprite é montado em três pedaços (cabeça + tronco + pernas) porque só a
 * cabeça muda com a direção e só as pernas mudam com o passo. Fossem 4 direções
 * × 4 quadros desenhados inteiros, seriam 16 grades pra manter em sincronia.
 *
 * `direita` é a `esquerda` espelhada — não existe grade separada pra ela.
 */

export const ACTOR_W = 12;
export const ACTOR_H = 18;

// . = transparente · o = contorno · h = cabelo · s = pele · e = olho
// c = roupa · a = detalhe/gola · p = calça · b = bota
const CABECA = {
  baixo: [
    '...oooooo...',
    '..ohhhhhho..',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohssssssho.',
    '.ohsessesho.',
    '.ohssssssho.',
    '..osssssso..',
    '...oaaaao...',
  ],
  cima: [
    '...oooooo...',
    '..ohhhhhho..',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '..ohhhhhho..',
    '...oaaaao...',
  ],
  esquerda: [
    '...oooooo...',
    '..ohhhhhho..',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.osssshhhho.',
    '.osesshhhho.',
    '.osssshhhho.',
    '..ossshhho..',
    '...oaaaao...',
  ],
};

// O detalhe (`a`) é uma faixa de 2px no meio exato dos 12 — fora do centro ele
// vira um risco torto, que a 8x salta aos olhos.
const TRONCO = [
  '..occcccco..',
  '.soccaaccos.',
  '.soccaaccos.',
  '..occaacco..',
  '..oppppppo..',
];

const PERNAS = {
  parado: [
    '..opp..ppo..',
    '..opp..ppo..',
    '..obb..bbo..',
    '...oo..oo...',
  ],
  passoA: [
    '..opp..ppo..',
    '.opp...ppo..',
    '.obb...bbo..',
    '..oo....oo..',
  ],
  passoB: [
    '..opp..ppo..',
    '..opp...ppo.',
    '..obb...bbo.',
    '..oo....oo..',
  ],
};

// Ciclo de caminhada: parado entre um passo e outro dá a "quicada" natural.
const CICLO = ['parado', 'passoA', 'parado', 'passoB'];
export const QUADROS = CICLO.length;

function pinta(g, linhas, cores, espelhado) {
  linhas.forEach((linha, y) => {
    for (let x = 0; x < linha.length; x++) {
      const cor = cores[linha[x]];
      if (!cor) continue;                     // '.' e chaves não mapeadas
      g.fillStyle = cor;
      g.fillRect(espelhado ? ACTOR_W - 1 - x : x, y, 1, 1);
    }
  });
}

/**
 * Monta o sprite completo: `{ baixo|cima|esquerda|direita: [canvas × 4] }`.
 * Chame uma vez por personagem — depois o loop só copia os canvases.
 */
export function makeActor(cores) {
  const out = {};
  for (const dir of ['baixo', 'cima', 'esquerda', 'direita']) {
    const cabeca = CABECA[dir === 'direita' ? 'esquerda' : dir];
    const espelhado = dir === 'direita';
    out[dir] = CICLO.map((passo) => {
      const cv = document.createElement('canvas');
      cv.width = ACTOR_W; cv.height = ACTOR_H;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      pinta(g, [...cabeca, ...TRONCO, ...PERNAS[passo]], cores, espelhado);
      return cv;
    });
  }
  return out;
}

/**
 * O jogador: azul com detalhe dourado, os acentos da interface.
 *
 * Calça e bota são claras o bastante pra destacar do chão escuro — no tom
 * original elas sumiam no fundo e o passo (que muda 1px de perna) não aparecia.
 */
export const CORES_JOGADOR = {
  o: '#12151d', h: '#3a2a1c', s: '#e6b78b', e: '#12151d',
  c: '#3d5a80', a: '#e8c46a', p: '#3c4665', b: '#262e42',
};

const CAMISAS = ['#7d3f45', '#3d6b45', '#5b4a7d', '#2f7a72', '#8a5a2b', '#8f4a70', '#4a5a2f', '#2f5f8a'];
const CABELOS = ['#2a2118', '#4a3320', '#6b5230', '#1f2430', '#5a2a2a', '#3a3a4a', '#7a6a3a'];
const PELES   = ['#e6b78b', '#d9a273', '#c08a5e', '#a8724a'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Paleta estável a partir do id do NPC: o mesmo adversário tem sempre a mesma
 * cara, sem precisar guardar aparência em lugar nenhum.
 */
export function coresPara(id) {
  const h = hash(String(id));
  const camisa = CAMISAS[h % CAMISAS.length];
  return {
    o: '#12151d',
    h: CABELOS[(h >> 3) % CABELOS.length],
    s: PELES[(h >> 7) % PELES.length],
    e: '#12151d',
    c: camisa,
    a: (h >> 11) % 3 === 0 ? '#e8c46a' : '#d8dce8',
    p: ['#3c4665', '#4c4030', '#3c4a41'][(h >> 13) % 3],
    b: '#262e42',
  };
}
