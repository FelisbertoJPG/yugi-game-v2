/**
 * Mapas dos cenários andáveis.
 *
 * O chão NÃO é escrito tile a tile: é um fundo (`base`) mais uma lista de
 * "pinceladas" (retângulos ou elipses) aplicadas em ordem. Mexer no traçado de
 * uma avenida é mudar 4 números, não reescrever 28 linhas de 40 caracteres —
 * e é bem mais difícil de errar.
 *
 * `props` são os objetos do `tileset.js` (prédios, árvores, fonte…), posicionados
 * em TILES. `spots` são as vagas onde os NPCs ficam de pé: quem mora no cenário
 * vem de `npcs.js` em tempo de execução, então o mapa só reserva os lugares e o
 * `cidade.js` distribui.
 *
 * Convenção: prédio tem a porta EMBAIXO, então caminho de terra sempre desce da
 * porta até a rua.
 */
import { TILE, PROPS, AGUA } from '/web/js/tileset.js';

/** A cidade inicial — praça com fonte, avenidas em cruz, lago e a arena. */
const CIDADE = {
  w: 40, h: 28,
  base: 'grama',
  spawn: [19, 22],
  brushes: [
    { t: 'pedra', rect: [18, 0, 3, 28] },     // avenida norte-sul
    { t: 'pedra', rect: [0, 13, 40, 3] },     // avenida leste-oeste
    { t: 'pedra', rect: [0, 25, 40, 2] },     // rua do sul
    { t: 'pedra', rect: [14, 9, 11, 10] },    // praça central
    { t: 'agua',  rect: [2, 18, 9, 6], round: true },  // lago
    { t: 'areia', rect: [1, 17, 11, 8], round: true, under: 'agua' }, // margem
    { t: 'terra', rect: [6, 9, 2, 4] },       // caminho: casa oeste → avenida
    { t: 'terra', rect: [32, 9, 2, 4] },      // caminho: loja → avenida
    { t: 'terra', rect: [31, 16, 2, 3] },     // caminho: avenida → arena
    { t: 'terra', rect: [13, 24, 2, 1] },     // caminho: casa sul → rua do sul
  ],
  props: [
    { kind: 'casa',  x: 4,  y: 4,  tint: '#7d3f45' },
    { kind: 'loja',  x: 29, y: 4,  tint: '#3d5a80' },
    { kind: 'casa',  x: 11, y: 19, tint: '#5b4a7d' },
    { kind: 'arena', x: 27, y: 19 },
    { kind: 'fonte', x: 17, y: 12 },

    { kind: 'poste', x: 16, y: 10 }, { kind: 'poste', x: 22, y: 10 },
    { kind: 'poste', x: 16, y: 16 }, { kind: 'poste', x: 22, y: 16 },
    { kind: 'poste', x: 9,  y: 10 }, { kind: 'poste', x: 27, y: 10 },
    { kind: 'poste', x: 11, y: 16 }, { kind: 'poste', x: 26, y: 16 },

    { kind: 'placa', x: 33, y: 17 },
    { kind: 'placa', x: 8,  y: 11 },

    { kind: 'arvore', x: 1,  y: 0 }, { kind: 'arvore', x: 11, y: 0 },
    { kind: 'arvore', x: 14, y: 1 }, { kind: 'arvore', x: 23, y: 0 },
    { kind: 'arvore', x: 26, y: 1 }, { kind: 'arvore', x: 37, y: 0 },
    { kind: 'arvore', x: 0,  y: 5 }, { kind: 'arvore', x: 1,  y: 9 },
    { kind: 'arvore', x: 37, y: 5 }, { kind: 'arvore', x: 36, y: 9 },
    { kind: 'arvore', x: 37, y: 17 }, { kind: 'arvore', x: 37, y: 21 },
    { kind: 'arvore', x: 24, y: 20 }, { kind: 'arvore', x: 24, y: 23 },
    { kind: 'arvore', x: 22, y: 5 },  { kind: 'arvore', x: 0,  y: 16 },

    { kind: 'arbusto', x: 12, y: 10 }, { kind: 'arbusto', x: 12, y: 11 },
    { kind: 'arbusto', x: 26, y: 11 }, { kind: 'arbusto', x: 26, y: 12 },
    { kind: 'arbusto', x: 12, y: 17 }, { kind: 'arbusto', x: 26, y: 18 },
    { kind: 'pedra',   x: 12, y: 21 }, { kind: 'pedra',   x: 3,  y: 26 },

    { kind: 'cerca', x: 4,  y: 9 }, { kind: 'cerca', x: 5,  y: 9 },
    { kind: 'cerca', x: 8,  y: 9 }, { kind: 'cerca', x: 9,  y: 9 },
    { kind: 'cerca', x: 29, y: 9 }, { kind: 'cerca', x: 30, y: 9 },
    { kind: 'cerca', x: 31, y: 9 }, { kind: 'cerca', x: 34, y: 9 },
    { kind: 'cerca', x: 35, y: 9 },
  ],
  // Onde os NPCs ficam de pé, em ordem de preferência.
  spots: [
    [7, 11], [32, 11], [23, 11], [15, 17], [23, 17],
    [31, 18], [13, 11], [8, 17], [17, 21], [29, 12],
    [11, 14], [28, 27],
  ],
};

/** A ilha do torneio — ainda trancada no mapa mundi, mas já desenhada. */
const REINO = {
  w: 36, h: 26,
  base: 'agua',
  spawn: [18, 21],
  brushes: [
    { t: 'areia', rect: [2, 2, 32, 23], round: true },
    { t: 'grama', rect: [5, 4, 26, 18], round: true },
    { t: 'pedra', rect: [17, 8, 3, 14] },
    { t: 'pedra', rect: [11, 8, 15, 6] },
    { t: 'terra', rect: [8, 15, 2, 4] },
    { t: 'terra', rect: [27, 15, 2, 4] },
  ],
  props: [
    { kind: 'arena', x: 14, y: 2 },
    { kind: 'casa',  x: 6,  y: 12, tint: '#8a5a2b' },
    { kind: 'casa',  x: 25, y: 12, tint: '#2f7a72' },
    { kind: 'poste', x: 15, y: 11 }, { kind: 'poste', x: 21, y: 11 },
    { kind: 'poste', x: 15, y: 18 }, { kind: 'poste', x: 21, y: 18 },
    { kind: 'placa', x: 20, y: 20 },

    { kind: 'palmeira', x: 4,  y: 6 },  { kind: 'palmeira', x: 30, y: 6 },
    { kind: 'palmeira', x: 4,  y: 16 }, { kind: 'palmeira', x: 31, y: 15 },
    { kind: 'palmeira', x: 8,  y: 19 }, { kind: 'palmeira', x: 26, y: 19 },
    { kind: 'palmeira', x: 12, y: 20 }, { kind: 'palmeira', x: 22, y: 20 },

    { kind: 'pedra', x: 6, y: 9 },  { kind: 'pedra', x: 29, y: 9 },
    { kind: 'pedra', x: 10, y: 20 }, { kind: 'pedra', x: 25, y: 20 },
    { kind: 'arbusto', x: 13, y: 16 }, { kind: 'arbusto', x: 23, y: 16 },
  ],
  spots: [
    [13, 19], [23, 19], [10, 13], [26, 13], [18, 19],
    [15, 15], [21, 15], [12, 10], [24, 10],
  ],
};

const MAPAS = { cidade: CIDADE, reino: REINO };

function aplicaPinceladas(def) {
  const tiles = Array.from({ length: def.h }, () => Array(def.w).fill(def.base));
  for (const b of def.brushes ?? []) {
    const [x0, y0, bw, bh] = b.rect;
    const cx = x0 + bw / 2 - 0.5, cy = y0 + bh / 2 - 0.5;
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = x0; x < x0 + bw; x++) {
        if (x < 0 || y < 0 || x >= def.w || y >= def.h) continue;
        if (b.round) {
          const dx = (x - cx) / (bw / 2), dy = (y - cy) / (bh / 2);
          if (dx * dx + dy * dy > 1) continue;
        }
        // `under` = só pinta por baixo do que já está lá (margem de areia que
        // não pode comer o lago que a pincelada anterior desenhou).
        if (b.under && tiles[y][x] === b.under) continue;
        tiles[y][x] = b.t;
      }
    }
  }
  return tiles;
}

/**
 * Constrói o cenário pronto pro loop: grade de chão, grade de colisão e os
 * objetos com a posição já em pixels lógicos.
 */
export function buildMap(id) {
  const def = MAPAS[id] ?? CIDADE;
  const tiles = aplicaPinceladas(def);

  // Colisão: água + o "pé" de cada objeto.
  const solid = Array.from({ length: def.h }, () => Array(def.w).fill(false));
  for (let y = 0; y < def.h; y++) {
    for (let x = 0; x < def.w; x++) if (tiles[y][x] === AGUA) solid[y][x] = true;
  }

  const props = [];
  for (const p of def.props ?? []) {
    const meta = PROPS[p.kind];
    if (!meta) continue;
    const [sx, sy, sw, sh] = meta.solid;
    for (let y = p.y + sy; y < p.y + sy + sh; y++) {
      for (let x = p.x + sx; x < p.x + sx + sw; x++) {
        if (x >= 0 && y >= 0 && x < def.w && y < def.h) solid[y][x] = true;
      }
    }
    props.push({
      ...p,
      px: p.x * TILE,
      py: p.y * TILE,
      // Ordena o desenho pela linha do "pé": é o que faz o jogador passar ATRÁS
      // da copa da árvore e NA FRENTE do tronco, sem nenhuma lógica de camada.
      baseY: (p.y + meta.th) * TILE,
    });
  }

  // As vagas de NPC e o ponto de entrada não podem cair dentro de um objeto —
  // um NPC preso numa parede é impossível de alcançar.
  const livres = (def.spots ?? []).filter(([x, y]) => !solid[y]?.[x]);

  return {
    id, def,
    w: def.w, h: def.h,
    wpx: def.w * TILE, hpx: def.h * TILE,
    tiles, solid, props,
    spots: livres,
    spawn: def.spawn ?? [Math.floor(def.w / 2), Math.floor(def.h / 2)],
  };
}
