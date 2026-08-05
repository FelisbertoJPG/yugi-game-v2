/**
 * Tileset — a arte do mundo, DESENHADA EM CÓDIGO.
 *
 * O front não tem build step nem dependências, e as artes de carta já vêm da
 * internet (ygoprodeck) — o mapa não podia depender de mais um arquivo binário
 * pra existir. Então cada tile e cada prédio é pintado uma única vez, no boot,
 * num `<canvas>` fora da tela; a cada quadro o loop só COPIA (`drawImage`)
 * esses canvases prontos. Redesenhar tudo a cada quadro seria lento à toa.
 *
 * Tudo aqui é medido em PIXELS LÓGICOS (`TILE` = 16). O canvas da cena tem o
 * tamanho lógico de verdade e é ampliado por CSS com `image-rendering:
 * pixelated` — é isso que dá pixel art nítida em vez de um desenho borrado.
 */

export const TILE = 16;

// ---------------------------------------------------------------- utilidades

/**
 * Ruído determinístico por coordenada: a MESMA posição sempre devolve o mesmo
 * valor. É o que deixa a grama ter variação sem o mapa "piscar" quando o chão
 * é repintado (e sem precisar guardar a variação de cada tile em lugar nenhum).
 */
export function rnd(x, y, salt = 0) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Clareia (amt > 0) ou escurece (amt < 0) um `#rrggbb`. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const alvo = amt > 0 ? 255 : 0;
    return Math.round(v + (alvo - v) * Math.abs(amt));
  });
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function novoCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { cv, g };
}

// ---------------------------------------------------------------- chão

const CHAO = {
  grama:  { base: '#33513a', alt: '#3b5f43', escuro: '#2a4430', detalhe: '#48734f' },
  terra:  { base: '#6b563e', alt: '#77634a', escuro: '#5a4632', detalhe: '#8a7458' },
  pedra:  { base: '#464e63', alt: '#515a72', escuro: '#394153', detalhe: '#5d6784' },
  agua:   { base: '#1e4864', alt: '#265a7c', escuro: '#163648', detalhe: '#3d84ab' },
  areia:  { base: '#8a7852', alt: '#96855f', escuro: '#75643f', detalhe: '#a89468' },
};

export const AGUA = 'agua';   // o único tipo de chão que bloqueia passagem

function pintaGrama(g, x, y) {
  const c = CHAO.grama;
  g.fillStyle = c.base; g.fillRect(0, 0, TILE, TILE);
  // tufos: posições fixas por tile, quantidade variável
  for (let i = 0; i < 5; i++) {
    const r = rnd(x, y, i);
    if (r < 0.45) continue;
    const tx = Math.floor(rnd(x, y, i + 10) * (TILE - 2));
    const ty = Math.floor(rnd(x, y, i + 20) * (TILE - 2));
    g.fillStyle = r > 0.8 ? c.alt : c.escuro;
    g.fillRect(tx, ty, 2, 1);
  }
  // uma florzinha de vez em quando
  if (rnd(x, y, 77) > 0.93) {
    const fx = 3 + Math.floor(rnd(x, y, 78) * 9);
    const fy = 3 + Math.floor(rnd(x, y, 79) * 9);
    g.fillStyle = c.detalhe; g.fillRect(fx, fy + 1, 1, 2);
    g.fillStyle = rnd(x, y, 80) > 0.5 ? '#e8c46a' : '#d8737f';
    g.fillRect(fx, fy, 1, 1);
  }
}

function pintaTerra(g, x, y) {
  const c = CHAO.terra;
  g.fillStyle = c.base; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 7; i++) {
    const r = rnd(x, y, i + 40);
    const tx = Math.floor(rnd(x, y, i + 50) * TILE);
    const ty = Math.floor(rnd(x, y, i + 60) * TILE);
    g.fillStyle = r > 0.6 ? c.alt : c.escuro;
    g.fillRect(tx, ty, 1, 1);
  }
  if (rnd(x, y, 91) > 0.85) {
    g.fillStyle = c.detalhe;
    g.fillRect(4 + Math.floor(rnd(x, y, 92) * 7), 5 + Math.floor(rnd(x, y, 93) * 6), 2, 2);
  }
}

function pintaPedra(g, x, y) {
  const c = CHAO.pedra;
  g.fillStyle = c.base; g.fillRect(0, 0, TILE, TILE);
  // lajotas de 8x8, cada uma com um tom levemente diferente
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const r = rnd(x * 2 + sx, y * 2 + sy, 5);
      g.fillStyle = r > 0.66 ? c.alt : (r > 0.33 ? c.base : c.escuro);
      g.fillRect(sx * 8, sy * 8, 7, 7);
    }
  }
  // rejunte
  g.fillStyle = 'rgba(0,0,0,.22)';
  g.fillRect(0, 7, TILE, 1); g.fillRect(7, 0, 1, TILE);
  if (rnd(x, y, 6) > 0.9) {   // uma rachadura
    g.fillStyle = c.escuro;
    g.fillRect(2 + Math.floor(rnd(x, y, 7) * 4), 2 + Math.floor(rnd(x, y, 8) * 4), 3, 1);
  }
}

function pintaAgua(g, x, y) {
  const c = CHAO.agua;
  g.fillStyle = c.base; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 3; i++) {
    if (rnd(x, y, i + 30) < 0.55) continue;
    g.fillStyle = c.escuro;
    g.fillRect(Math.floor(rnd(x, y, i + 31) * 10), Math.floor(rnd(x, y, i + 32) * 14), 6, 1);
  }
  if (rnd(x, y, 33) > 0.7) {
    g.fillStyle = c.alt;
    g.fillRect(2 + Math.floor(rnd(x, y, 34) * 8), 4 + Math.floor(rnd(x, y, 35) * 8), 4, 1);
  }
}

function pintaAreia(g, x, y) {
  const c = CHAO.areia;
  g.fillStyle = c.base; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 6; i++) {
    const r = rnd(x, y, i + 70);
    g.fillStyle = r > 0.6 ? c.detalhe : c.escuro;
    g.fillRect(Math.floor(rnd(x, y, i + 71) * TILE), Math.floor(rnd(x, y, i + 72) * TILE), 1, 1);
  }
}

const PINTORES = {
  grama: pintaGrama, terra: pintaTerra, pedra: pintaPedra,
  agua: pintaAgua, areia: pintaAreia,
};

/**
 * Pinta o mapa inteiro num canvas só (fora da tela). O chão é estático, então
 * isso roda UMA vez — o loop depois só recorta a parte visível.
 */
export function buildGround(tiles) {
  const h = tiles.length, w = tiles[0].length;
  const { cv, g } = novoCanvas(w * TILE, h * TILE);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const kind = tiles[y][x];
      g.save();
      g.translate(x * TILE, y * TILE);
      (PINTORES[kind] ?? pintaGrama)(g, x, y);

      // Borda: onde o tile encosta num chão DIFERENTE, uma sombrinha de 1px.
      // Sem isso, calçada e grama se encostam com um corte reto que denuncia
      // a grade; com isso o desenho ganha profundidade de graça.
      g.fillStyle = 'rgba(0,0,0,.20)';
      if (y > 0 && tiles[y - 1][x] !== kind) g.fillRect(0, 0, TILE, 1);
      if (y < h - 1 && tiles[y + 1][x] !== kind) g.fillRect(0, TILE - 1, TILE, 1);
      if (x > 0 && tiles[y][x - 1] !== kind) g.fillRect(0, 0, 1, TILE);
      if (x < w - 1 && tiles[y][x + 1] !== kind) g.fillRect(TILE - 1, 0, 1, TILE);
      g.restore();
    }
  }
  return cv;
}

// ---------------------------------------------------------------- prédios e objetos

function sombraChao(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.30)';
  g.fillRect(3, h - 4, w - 6, 4);
  g.fillStyle = 'rgba(0,0,0,.16)';
  g.fillRect(1, h - 3, w - 2, 3);
}

/** Parede + rodapé + ripas — a base comum de casa/loja. */
function parede(g, w, topo, base, cor = '#3c4257') {
  g.fillStyle = cor; g.fillRect(3, topo, w - 6, base - topo);
  g.fillStyle = shade(cor, 0.12); g.fillRect(3, topo, w - 6, 3);
  g.fillStyle = shade(cor, -0.22); g.fillRect(3, base - 5, w - 6, 5);
  g.fillStyle = 'rgba(0,0,0,.10)';
  for (let x = 8; x < w - 6; x += 7) g.fillRect(x, topo + 3, 1, base - topo - 8);
}

/**
 * Telhado em TRAPÉZIO (topo mais estreito que a base): é o que faz ler como
 * duas águas visto de cima. Um retângulo reto vira uma tábua colorida e o
 * prédio inteiro perde a forma.
 */
function telhado(g, w, alturaTelhado, cor) {
  const recuo = Math.min(9, Math.round(w * 0.09));

  g.save();
  g.beginPath();
  g.moveTo(recuo, 2); g.lineTo(w - recuo, 2);
  g.lineTo(w, alturaTelhado); g.lineTo(0, alturaTelhado);
  g.closePath();
  g.clip();
  g.fillStyle = cor; g.fillRect(0, 0, w, alturaTelhado);
  g.fillStyle = shade(cor, -0.20);                                  // fiadas de telha
  for (let y = 7; y < alturaTelhado; y += 4) g.fillRect(0, y, w, 1);
  g.fillStyle = shade(cor, -0.30);                                  // águas laterais
  g.fillRect(0, 0, 3, alturaTelhado); g.fillRect(w - 3, 0, 3, alturaTelhado);
  g.restore();

  g.fillStyle = shade(cor, 0.26);                                   // cumeeira
  g.fillRect(recuo, 2, w - recuo * 2, 2);
  g.fillStyle = 'rgba(0,0,0,.38)';                                  // beiral
  g.fillRect(0, alturaTelhado - 1, w, 2);
}

function janela(g, x, y, w = 12, h = 10) {
  g.fillStyle = '#262b38'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle = '#f0c56b'; g.fillRect(x, y, w, h);
  g.fillStyle = '#c99f4c';
  g.fillRect(x, y + Math.floor(h / 2), w, 1);
  g.fillRect(x + Math.floor(w / 2), y, 1, h);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 1, y + 1, 3, 2);
}

function porta(g, cx, base, w = 13, h = 20) {
  const x = Math.round(cx - w / 2), y = base - h;
  g.fillStyle = '#262b38'; g.fillRect(x - 1, y - 1, w + 2, h + 1);
  g.fillStyle = '#5a4430'; g.fillRect(x, y, w, h);
  g.fillStyle = '#6b5238'; g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = '#4a381f'; g.fillRect(x + 1, y + 5, w - 2, 1);
  g.fillStyle = '#e8c46a'; g.fillRect(x + w - 4, y + Math.floor(h / 2), 2, 2);
}

function paintCasa(g, w, h, _f, tint) {
  const cor = tint || '#7d3f45';
  const alturaTelhado = Math.round(h * 0.46);
  const topoParede = alturaTelhado - 5;
  const baseParede = h - 3;

  sombraChao(g, w, h);
  parede(g, w, topoParede, baseParede);
  porta(g, w / 2, baseParede);
  janela(g, 8, topoParede + 8);
  janela(g, w - 20, topoParede + 8);
  telhado(g, w, alturaTelhado, cor);

  g.fillStyle = '#3a3f52'; g.fillRect(w - 18, 0, 7, 9);   // chaminé
  g.fillStyle = '#4a5066'; g.fillRect(w - 18, 0, 7, 2);
}

function paintLoja(g, w, h, _f, tint) {
  const cor = tint || '#3d5a80';
  const alturaTelhado = Math.round(h * 0.40);
  const topoParede = alturaTelhado - 5;
  const baseParede = h - 3;

  sombraChao(g, w, h);
  parede(g, w, topoParede, baseParede, '#3f4559');

  // vitrine: cartas expostas atrás do vidro
  const vx = 9, vy = topoParede + 10, vw = w - 40, vh = 20;
  g.fillStyle = '#262b38'; g.fillRect(vx - 2, vy - 2, vw + 4, vh + 4);
  g.fillStyle = '#16324a'; g.fillRect(vx, vy, vw, vh);
  for (let i = 0; i < 4; i++) {
    const cx = vx + 3 + i * 11;
    g.fillStyle = ['#7d3f45', '#3d6b45', '#5b4a7d', '#8a6a2b'][i];
    g.fillRect(cx, vy + 4, 8, 12);
    g.fillStyle = 'rgba(255,255,255,.20)'; g.fillRect(cx, vy + 4, 8, 2);
  }
  g.fillStyle = 'rgba(160,210,255,.14)'; g.fillRect(vx, vy, vw, vh);

  porta(g, w - 18, baseParede);

  // toldo listrado sobre a vitrine
  const ty = topoParede + 4;
  for (let i = 0; i * 8 < vw + 8; i++) {
    g.fillStyle = i % 2 ? '#e8dfc8' : shade(cor, 0.05);
    g.fillRect(vx - 4 + i * 8, ty, 8, 7);
  }
  g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(vx - 4, ty + 7, vw + 8, 2);

  telhado(g, w, alturaTelhado, cor);

  // placa da loja pendurada, com "letras"
  const px = w - 34, py = alturaTelhado + 2;
  g.fillStyle = '#262b38'; g.fillRect(px - 1, py - 1, 30, 12);
  g.fillStyle = '#1b2130'; g.fillRect(px, py, 28, 10);
  g.fillStyle = '#e8c46a';
  for (let i = 0; i < 5; i++) g.fillRect(px + 3 + i * 5, py + 4, 3, 3);
}

function paintArena(g, w, h, _f, tint) {
  const cor = tint || '#4a5066';
  const alturaTelhado = Math.round(h * 0.30);
  const topoParede = alturaTelhado - 4;
  const baseParede = h - 6;

  sombraChao(g, w, h);

  // corpo de pedra
  g.fillStyle = '#454b60'; g.fillRect(4, topoParede, w - 8, baseParede - topoParede);
  g.fillStyle = '#525a72'; g.fillRect(4, topoParede, w - 8, 3);
  g.fillStyle = '#343a4b'; g.fillRect(4, baseParede - 6, w - 8, 6);
  // blocos
  g.fillStyle = 'rgba(0,0,0,.13)';
  for (let y = topoParede + 6; y < baseParede - 6; y += 7) g.fillRect(4, y, w - 8, 1);

  // colunas
  for (const cx of [10, w - 20]) {
    g.fillStyle = '#565f79'; g.fillRect(cx, topoParede + 2, 10, baseParede - topoParede - 2);
    g.fillStyle = '#646e8c'; g.fillRect(cx, topoParede + 2, 3, baseParede - topoParede - 2);
    g.fillStyle = '#3a4054'; g.fillRect(cx - 2, baseParede - 5, 14, 5);
    g.fillStyle = '#646e8c'; g.fillRect(cx - 2, topoParede + 2, 14, 4);
  }

  // portão duplo
  const pw = 30, px = Math.round(w / 2 - pw / 2), py = baseParede - 34;
  g.fillStyle = '#262b38'; g.fillRect(px - 2, py - 2, pw + 4, 36);
  g.fillStyle = '#2f3546'; g.fillRect(px, py, pw, 34);
  g.fillStyle = '#3b4356'; g.fillRect(px + 1, py + 1, pw / 2 - 2, 32);
  g.fillStyle = '#3b4356'; g.fillRect(px + pw / 2 + 1, py + 1, pw / 2 - 2, 32);
  g.fillStyle = '#e8c46a';
  g.fillRect(px + pw / 2 - 3, py + 16, 2, 5); g.fillRect(px + pw / 2 + 1, py + 16, 2, 5);

  // emblema dourado acima do portão
  const ex = w / 2, ey = topoParede + 14;
  g.fillStyle = '#e8c46a'; g.beginPath(); g.arc(ex, ey, 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1b2130'; g.beginPath(); g.arc(ex, ey, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8c46a'; g.fillRect(ex - 1, ey - 4, 2, 8); g.fillRect(ex - 4, ey - 1, 8, 2);

  // estandartes
  for (const bx of [22, w - 30]) {
    g.fillStyle = '#3d5a80'; g.fillRect(bx, topoParede + 5, 9, 26);
    g.fillStyle = '#4a6d9b'; g.fillRect(bx, topoParede + 5, 3, 26);
    g.fillStyle = '#e8c46a'; g.fillRect(bx, topoParede + 5, 9, 2); g.fillRect(bx + 3, topoParede + 14, 3, 3);
    g.fillStyle = '#3d5a80';
    g.beginPath();
    g.moveTo(bx, topoParede + 31); g.lineTo(bx + 4.5, topoParede + 36); g.lineTo(bx + 9, topoParede + 31);
    g.closePath(); g.fill();
  }

  telhado(g, w, alturaTelhado, cor);

  // escadaria
  for (let i = 0; i < 3; i++) {
    g.fillStyle = i % 2 ? '#4d5670' : '#434b61';
    g.fillRect(px - 8 - i * 3, baseParede + i * 2, pw + 16 + i * 6, 2);
  }
}

function paintArvore(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.30)';
  g.beginPath(); g.ellipse(w / 2, h - 4, w / 2 - 3, 4, 0, 0, Math.PI * 2); g.fill();

  // tronco
  g.fillStyle = '#43321f'; g.fillRect(w / 2 - 3, h - 20, 6, 17);
  g.fillStyle = '#55402a'; g.fillRect(w / 2 - 3, h - 20, 2, 17);

  // copa em camadas: escuro por baixo, claro por cima-esquerda (luz do NO)
  const copa = [
    { x: w / 2, y: h - 30, r: 12, c: '#254429' },
    { x: w / 2 - 8, y: h - 34, r: 9, c: '#2c5133' },
    { x: w / 2 + 8, y: h - 33, r: 9, c: '#2c5133' },
    { x: w / 2 - 2, y: h - 39, r: 10, c: '#356040' },
    { x: w / 2 - 6, y: h - 42, r: 6, c: '#3f7049' },
  ];
  for (const c of copa) {
    g.fillStyle = c.c;
    g.beginPath(); g.arc(c.x, c.y, c.r, 0, Math.PI * 2); g.fill();
  }
}

function paintPalmeira(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.30)';
  g.beginPath(); g.ellipse(w / 2, h - 4, w / 2 - 5, 4, 0, 0, Math.PI * 2); g.fill();

  // tronco curvado
  g.strokeStyle = '#6b5238'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(w / 2 - 2, h - 4); g.quadraticCurveTo(w / 2 + 4, h - 24, w / 2 - 1, h - 36); g.stroke();
  g.strokeStyle = '#856848'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(w / 2 - 3, h - 6); g.quadraticCurveTo(w / 2 + 2, h - 24, w / 2 - 2, h - 35); g.stroke();

  // folhas
  const cx = w / 2 - 1, cy = h - 37;
  for (const [dx, dy] of [[-13, -4], [13, -4], [-9, -11], [9, -11], [0, -14], [-14, 4], [14, 4]]) {
    g.fillStyle = (dy < -8) ? '#3f7049' : '#2c5133';
    g.beginPath(); g.ellipse(cx + dx, cy + dy, 8, 4, Math.atan2(dy, dx), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#8a6a2b';
  g.fillRect(cx - 2, cy - 1, 3, 3); g.fillRect(cx + 2, cy + 1, 3, 3);
}

/** Fonte da praça — 2 quadros pra água se mexer. */
function paintFonte(g, w, h, frame) {
  g.fillStyle = 'rgba(0,0,0,.30)';
  g.beginPath(); g.ellipse(w / 2, h - 6, w / 2 - 4, 6, 0, 0, Math.PI * 2); g.fill();

  // bacia
  g.fillStyle = '#565f79';
  g.beginPath(); g.ellipse(w / 2, h - 14, w / 2 - 3, 14, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#454d64';
  g.beginPath(); g.ellipse(w / 2, h - 16, w / 2 - 6, 11, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1e4864';
  g.beginPath(); g.ellipse(w / 2, h - 16, w / 2 - 9, 8, 0, 0, Math.PI * 2); g.fill();

  // ondinhas (deslocadas no 2º quadro)
  g.fillStyle = '#3d84ab';
  const off = frame ? 3 : 0;
  g.fillRect(w / 2 - 12 + off, h - 19, 7, 1);
  g.fillRect(w / 2 + 2 - off, h - 15, 6, 1);
  g.fillRect(w / 2 - 6 + off, h - 12, 5, 1);

  // pilar + taça
  g.fillStyle = '#565f79'; g.fillRect(w / 2 - 4, h - 34, 8, 18);
  g.fillStyle = '#646e8c'; g.fillRect(w / 2 - 4, h - 34, 3, 18);
  g.fillStyle = '#565f79';
  g.beginPath(); g.ellipse(w / 2, h - 34, 11, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1e4864';
  g.beginPath(); g.ellipse(w / 2, h - 35, 8, 3, 0, 0, Math.PI * 2); g.fill();

  // jorro
  g.fillStyle = '#7fc4e8';
  g.fillRect(w / 2 - 1, h - 46 + (frame ? 1 : 0), 2, 11);
  g.fillStyle = 'rgba(160,220,255,.55)';
  g.fillRect(w / 2 - 8, h - 40 + (frame ? 2 : 0), 2, 5);
  g.fillRect(w / 2 + 6, h - 39 + (frame ? 0 : 2), 2, 5);
}

function paintPoste(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.28)';
  g.beginPath(); g.ellipse(w / 2, h - 3, 5, 3, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3a4054'; g.fillRect(w / 2 - 4, h - 7, 8, 5);
  g.fillStyle = '#4a5163'; g.fillRect(w / 2 - 2, 10, 4, h - 15);
  g.fillStyle = '#59627a'; g.fillRect(w / 2 - 2, 10, 1, h - 15);
  g.fillStyle = '#2a2f3d'; g.fillRect(w / 2 - 5, 4, 10, 8);
  g.fillStyle = '#f0c56b'; g.fillRect(w / 2 - 3, 6, 6, 5);
  g.fillStyle = '#fff2cc'; g.fillRect(w / 2 - 2, 7, 4, 2);
  g.fillStyle = '#3a4054'; g.fillRect(w / 2 - 5, 2, 10, 3);
}

function paintPlaca(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.26)';
  g.beginPath(); g.ellipse(w / 2, h - 3, 4, 2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5a4430'; g.fillRect(w / 2 - 2, h - 16, 4, 14);
  g.fillStyle = '#262b38'; g.fillRect(1, 4, w - 2, 14);
  g.fillStyle = '#6b5238'; g.fillRect(2, 5, w - 4, 12);
  g.fillStyle = '#e8c46a';
  g.fillRect(4, 8, w - 8, 2); g.fillRect(4, 12, w - 11, 2);
}

function paintArbusto(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.24)';
  g.beginPath(); g.ellipse(w / 2, h - 3, 6, 3, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#254429';
  g.beginPath(); g.arc(w / 2, h - 7, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#316039';
  g.beginPath(); g.arc(w / 2 - 2, h - 9, 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3f7049';
  g.beginPath(); g.arc(w / 2 - 3, h - 10, 2, 0, Math.PI * 2); g.fill();
}

function paintCerca(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, h - 3, w, 2);
  g.fillStyle = '#6b5238'; g.fillRect(0, h - 12, w, 3); g.fillRect(0, h - 7, w, 3);
  g.fillStyle = '#856848'; g.fillRect(0, h - 12, w, 1);
  g.fillStyle = '#5a4430'; g.fillRect(2, h - 15, 3, 13); g.fillRect(w - 5, h - 15, 3, 13);
}

function paintPedra(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,.26)';
  g.beginPath(); g.ellipse(w / 2, h - 3, 6, 3, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#4a5163';
  g.beginPath(); g.ellipse(w / 2, h - 7, 7, 6, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#59627a';
  g.beginPath(); g.ellipse(w / 2 - 2, h - 9, 4, 3, 0, 0, Math.PI * 2); g.fill();
}

/**
 * Catálogo. `tw/th` = tamanho em TILES; `solid` = [x, y, w, h] em tiles,
 * relativo ao canto do objeto — só o "pé" costuma bloquear (o telhado e a copa
 * ficam POR CIMA do jogador, que passa atrás sem esbarrar).
 */
export const PROPS = {
  casa:     { tw: 6, th: 5, solid: [0, 2, 6, 3], paint: paintCasa },
  loja:     { tw: 7, th: 5, solid: [0, 2, 7, 3], paint: paintLoja },
  arena:    { tw: 9, th: 6, solid: [0, 2, 9, 4], paint: paintArena },
  arvore:   { tw: 2, th: 3, solid: [0, 2, 2, 1], paint: paintArvore },
  palmeira: { tw: 2, th: 3, solid: [0, 2, 2, 1], paint: paintPalmeira },
  fonte:    { tw: 4, th: 4, solid: [0, 1, 4, 3], paint: paintFonte, frames: 2 },
  poste:    { tw: 1, th: 3, solid: [0, 2, 1, 1], paint: paintPoste, luz: true },
  placa:    { tw: 1, th: 2, solid: [0, 1, 1, 1], paint: paintPlaca },
  arbusto:  { tw: 1, th: 1, solid: [0, 0, 1, 1], paint: paintArbusto },
  cerca:    { tw: 1, th: 1, solid: [0, 0, 1, 1], paint: paintCerca },
  pedra:    { tw: 1, th: 1, solid: [0, 0, 1, 1], paint: paintPedra },
};

// Cada objeto é pintado uma vez e reaproveitado. A chave inclui o `tint`
// porque duas casas de telhado diferente são dois desenhos diferentes.
const cacheProps = new Map();

export function getProp(kind, tint) {
  const meta = PROPS[kind];
  if (!meta) return null;
  const chave = `${kind}:${tint ?? ''}`;
  if (cacheProps.has(chave)) return cacheProps.get(chave);

  const w = meta.tw * TILE, h = meta.th * TILE;
  const quadros = [];
  for (let f = 0; f < (meta.frames ?? 1); f++) {
    const { cv, g } = novoCanvas(w, h);
    meta.paint(g, w, h, f, tint);
    quadros.push(cv);
  }
  const item = { meta, quadros, w, h };
  cacheProps.set(chave, item);
  return item;
}
