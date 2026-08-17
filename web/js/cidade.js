/**
 * Cidade — o cenário andável. O jogador caminha até um duelista e fala com ele
 * pra abrir o duelo; o duelo em si continua sendo `duel.html?npc=<id>`, esta
 * tela só troca a GRADE de cards de `adversario.html` por um mundo.
 *
 * EM STANDBY: o fluxo do jogador hoje é `adversario.html`; o mundo fica na
 * Área de Teste (`teste.html`) até voltar a ser a porta de entrada.
 *
 * Divisão de trabalho: `citymap.js` diz o que existe e onde, `tileset.js` e
 * `actors.js` sabem desenhar, e este arquivo cuida do que muda a cada quadro —
 * câmera, colisão, ordem de desenho e interação.
 *
 * O mundo é desenhado num canvas de resolução LÓGICA (320x180), ampliado por
 * CSS. Todas as contas daqui são em pixel lógico; só as etiquetas de nome
 * (DOM, pra o texto não borrar) convertem pra pixel de tela.
 */
import { getScenario, isUnlocked, scenarioForCampaign } from '/web/js/world.js';
import { NPCS, loadNpcDecks, getNpcActiveDeck, hydrateCustomNpcs } from '/web/js/npcs.js';
import { getDP, hydrateWallet } from '/web/js/wallet.js';
import { TILE, buildGround, getProp, rnd } from '/web/js/tileset.js';
import { makeActor, coresPara, CORES_JOGADOR, ACTOR_W, ACTOR_H, QUADROS } from '/web/js/actors.js';
import { buildMap } from '/web/js/citymap.js';
import { YgoDB } from '/ygo-data/src/ygodb.js';
import { requireLogin } from '/web/js/auth.js';

const $ = (id) => document.getElementById(id);
const ART = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;

const VIEW_W = 320, VIEW_H = 180;
const VEL = 74;             // px lógicos por segundo
const RAIO_INTERACAO = 26;  // distância pra "chegar perto"
const PE_W = 9, PE_H = 6;   // caixa de colisão (só os pés — a cabeça passa por cima)

const scenarioId = new URLSearchParams(location.search).get('id') || 'cidade';
const scenario = getScenario(scenarioId);
if (!scenario || !isUnlocked(scenario)) {
  location.href = '/web/mundo.html?blocked=1';
  throw new Error('cenário bloqueado ou inexistente');
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

let db = null;
const nameOf = (id) => db?.brief(id)?.name ?? String(id);

// ---------------------------------------------------------------- boot
const username = await requireLogin();
if (!username) throw new Error('redirecionando para login');

$('title').textContent = `▚ ${scenario.name.toUpperCase()}`;
document.title = `${scenario.name} — Classic Duels`;

await hydrateWallet();
$('dp').textContent = `${getDP()} DP`;
try { db = await YgoDB.load('/ygo-data/data', { full: false }); } catch { /* segue sem nomes */ }
await hydrateCustomNpcs();
await loadNpcDecks();

const mapa = buildMap(scenarioId);
const chao = buildGround(mapa.tiles);

const cv = $('cv');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------------------------------------------------------------- habitantes
/**
 * Quem mora neste cenário: a campanha do NPC decide (ver `world.js`); quem não
 * tem campanha fica na cidade inicial. Cada um ganha uma vaga do mapa — se
 * houver mais NPC que vaga, as extras entram deslocadas na mesma vaga, o que é
 * feio mas nunca esconde ninguém.
 */
function moradores() {
  const lista = NPCS.filter((npc) => {
    const dono = npc.campaign ? scenarioForCampaign(npc.campaign) : 'cidade';
    return dono === scenarioId;
  });

  return lista.map((npc, i) => {
    const vaga = mapa.spots[i % mapa.spots.length] ?? mapa.spawn;
    const volta = Math.floor(i / mapa.spots.length);
    const ativo = getNpcActiveDeck(npc.id);
    return {
      npc,
      ativo,
      temDeck: !!(ativo && ativo.deck && ativo.deck.main.length > 0),
      x: vaga[0] * TILE + TILE / 2 + volta * 14,
      y: vaga[1] * TILE + TILE,      // y é a linha dos PÉS
      sprite: makeActor(coresPara(npc.id)),
      dir: 'baixo',
      el: null,
    };
  });
}

const gente = moradores();
if (!gente.length) toast('nenhum adversário mora neste cenário ainda');

// etiquetas de nome (DOM sobre o canvas)
const camadaLabels = $('labels');
camadaLabels.replaceChildren(...gente.map((p) => {
  const el = document.createElement('div');
  el.className = 'plabel';
  el.innerHTML =
    `<span class="key">␣ falar</span>` +
    `<span class="nm${p.temDeck ? '' : ' semdeck'}"></span>`;
  el.querySelector('.nm').textContent = p.npc.name;
  el.querySelector('.nm').onclick = () => abrePainel(p);
  p.el = el;
  return el;
}));

// ---------------------------------------------------------------- painel
let alvoPainel = null;

function abrePainel(p) {
  alvoPainel = p;
  const sig = p.ativo?.signatureId ?? p.npc.signatureId;
  const capa = p.ativo?.coverId ?? sig;

  $('panel-title').textContent = p.npc.name;
  $('panel-sub').textContent = p.npc.theme || '';
  $('panel-art').style.backgroundImage = capa ? `url('${ART(capa)}')` : '';
  $('panel-campanha').innerHTML = `campanha: <b>${p.npc.campaign || 'nenhuma'}</b>`;
  $('panel-deck').innerHTML = p.temDeck
    ? `deck: <b>${p.ativo.name}</b> (${p.ativo.deck.main.length} cartas)`
    : `deck: <b>nenhum montado</b>`;
  $('panel-reward').innerHTML = `recompensa: <b>${sig ? nameOf(sig) : '—'}</b>` +
    (p.ativo ? ` · <b>${p.ativo.rewardDp} DP</b>` : '');

  const botao = $('btn-duelar');
  botao.disabled = !p.temDeck;
  botao.textContent = p.temDeck ? 'duelar' : 'sem deck (monte na Área de Teste)';
  $('overlay').classList.add('show');
  teclas.clear();     // senão a tecla que estava presa continua andando por baixo
}

const painelAberto = () => $('overlay').classList.contains('show');
function fechaPainel() { $('overlay').classList.remove('show'); alvoPainel = null; }

$('btn-close').onclick = fechaPainel;
$('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') fechaPainel(); });
$('btn-duelar').onclick = () => {
  if (alvoPainel?.temDeck) location.href = `/web/duel.html?npc=${alvoPainel.npc.id}`;
};

// ---------------------------------------------------------------- movimento
let px = mapa.spawn[0] * TILE + TILE / 2;
let py = mapa.spawn[1] * TILE + TILE;
let dir = 'baixo';
let andado = 0;                       // tempo acumulado andando, pro ciclo de passo
const spriteJogador = makeActor(CORES_JOGADOR);

const teclas = new Set();
const MAPA_TECLAS = {
  ArrowUp: 'cima', KeyW: 'cima',
  ArrowDown: 'baixo', KeyS: 'baixo',
  ArrowLeft: 'esquerda', KeyA: 'esquerda',
  ArrowRight: 'direita', KeyD: 'direita',
};

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const t = MAPA_TECLAS[e.code];
  if (t) { teclas.add(t); e.preventDefault(); }
  if ((e.code === 'Space' || e.code === 'Enter') && !painelAberto()) {
    if (perto) abrePainel(perto);
    e.preventDefault();
  }
  if (e.code === 'Escape') fechaPainel();
});
window.addEventListener('keyup', (e) => {
  const t = MAPA_TECLAS[e.code];
  if (t) teclas.delete(t);
});
// Sair da janela não pode deixar uma tecla "presa" andando sozinha.
window.addEventListener('blur', () => teclas.clear());

/** Livre pra pisar? Testa só os 4 cantos da caixa dos pés. */
function livre(nx, ny) {
  const x0 = Math.floor((nx - PE_W / 2) / TILE), x1 = Math.floor((nx + PE_W / 2 - 1) / TILE);
  const y0 = Math.floor((ny - PE_H) / TILE), y1 = Math.floor((ny - 1) / TILE);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= mapa.w || y >= mapa.h) return false;
      if (mapa.solid[y][x]) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- desenho
let camX = 0, camY = 0;
let perto = null;

function atualizaCamera() {
  camX = Math.max(0, Math.min(mapa.wpx - VIEW_W, Math.round(px - VIEW_W / 2)));
  camY = Math.max(0, Math.min(mapa.hpx - VIEW_H, Math.round(py - VIEW_H / 2 - 8)));
}

/** Brilhos na água — a única parte do chão que não é estática. */
function brilhoAgua(t) {
  const x0 = Math.floor(camX / TILE), x1 = Math.ceil((camX + VIEW_W) / TILE);
  const y0 = Math.floor(camY / TILE), y1 = Math.ceil((camY + VIEW_H) / TILE);
  ctx.fillStyle = '#5aa8cf';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (mapa.tiles[y]?.[x] !== 'agua') continue;
      const fase = rnd(x, y, 3) * Math.PI * 2;
      if (Math.sin(t * 1.7 + fase) < 0.6) continue;
      ctx.fillRect(
        x * TILE - camX + 2 + Math.floor(rnd(x, y, 4) * 9),
        y * TILE - camY + 4 + Math.floor(rnd(x, y, 5) * 8),
        3, 1,
      );
    }
  }
}

function sombraBoneco(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath();
  ctx.ellipse(x - camX, y - camY - 1, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Halo dos postes — desenhado depois de tudo, em modo aditivo. */
function luzes(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of mapa.props) {
    if (!getProp(p.kind, p.tint)?.meta.luz) continue;
    const lx = p.px + TILE / 2 - camX, ly = p.py + 8 - camY;
    if (lx < -40 || lx > VIEW_W + 40 || ly < -40 || ly > VIEW_H + 40) continue;
    const pulso = 0.86 + Math.sin(t * 2.3 + p.px) * 0.14;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 26 * pulso);
    g.addColorStop(0, 'rgba(240,197,107,.30)');
    g.addColorStop(1, 'rgba(240,197,107,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - 28, ly - 28, 56, 56);
  }
  ctx.restore();
}

// Vinheta: escurece os cantos pra dar foco no centro. Estática, então vale a
// pena montar o gradiente uma vez só em vez de a cada quadro.
const vinheta = (() => {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.34)');
  return g;
})();

function desenha(t) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(chao, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  brilhoAgua(t);

  // Ordem de desenho pela linha do pé: quem está mais embaixo tapa quem está
  // mais em cima. É o que faz o jogador passar por trás da casa e na frente
  // dela conforme anda — sem nenhuma lógica de camada explícita.
  const fila = [];

  for (const p of mapa.props) {
    const item = getProp(p.kind, p.tint);
    if (!item) continue;
    if (p.px + item.w < camX || p.px > camX + VIEW_W) continue;
    if (p.py + item.h < camY || p.py > camY + VIEW_H) continue;
    const quadro = item.quadros.length > 1
      ? item.quadros[Math.floor(t * 3) % item.quadros.length]
      : item.quadros[0];
    fila.push({ baseY: p.baseY, img: quadro, x: p.px, y: p.py });
  }

  for (const g of gente) {
    if (g.x < camX - 20 || g.x > camX + VIEW_W + 20) continue;
    if (g.y < camY - 30 || g.y > camY + VIEW_H + 30) continue;
    fila.push({
      baseY: g.y, img: g.sprite[g.dir][0], sombra: true,
      x: Math.round(g.x - ACTOR_W / 2), y: Math.round(g.y - ACTOR_H),
    });
  }

  const quadroPasso = teclas.size && !painelAberto()
    ? Math.floor(andado / 0.13) % QUADROS
    : 0;
  fila.push({
    baseY: py, img: spriteJogador[dir][quadroPasso], sombra: true,
    x: Math.round(px - ACTOR_W / 2), y: Math.round(py - ACTOR_H),
  });

  fila.sort((a, b) => a.baseY - b.baseY);
  for (const it of fila) {
    if (it.sombra) sombraBoneco(it.x + ACTOR_W / 2, it.baseY);
    ctx.drawImage(it.img, it.x - camX, it.y - camY);
  }

  luzes(t);
  ctx.fillStyle = vinheta;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** Posiciona as etiquetas de nome sobre o canvas, em pixel de TELA. */
function sincronizaLabels() {
  const escala = cv.getBoundingClientRect().width / VIEW_W;
  for (const g of gente) {
    const sx = (g.x - camX) * escala;
    const sy = (g.y - ACTOR_H - 3 - camY) * escala;
    const visivel = sx > -60 && sx < VIEW_W * escala + 60 && sy > -30 && sy < VIEW_H * escala + 30;
    g.el.style.display = visivel ? '' : 'none';
    if (!visivel) continue;
    g.el.style.left = `${sx}px`;
    g.el.style.top = `${sy}px`;
    g.el.classList.toggle('near', g === perto);
  }
}

function atualizaProximidade() {
  let melhor = null, menor = Infinity;
  for (const g of gente) {
    const d = Math.hypot(g.x - px, g.y - py);
    if (d <= RAIO_INTERACAO && d < menor) { melhor = g; menor = d; }
    // NPC vira pro jogador quando ele chega perto — dá vida de graça.
    if (d < 48) {
      const dx = px - g.x, dy = py - g.y;
      g.dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'direita' : 'esquerda')
        : (dy > 0 ? 'baixo' : 'cima');
    } else {
      g.dir = 'baixo';
    }
  }
  perto = melhor;
}

// ---------------------------------------------------------------- loop
let anterior = performance.now();
function quadro(agora) {
  const dt = Math.min(0.05, (agora - anterior) / 1000);
  anterior = agora;
  const t = agora / 1000;

  if (!painelAberto()) {
    let dx = 0, dy = 0;
    if (teclas.has('cima')) dy -= 1;
    if (teclas.has('baixo')) dy += 1;
    if (teclas.has('esquerda')) dx -= 1;
    if (teclas.has('direita')) dx += 1;

    if (dx || dy) {
      const norma = Math.hypot(dx, dy);   // diagonal não pode ser mais rápida
      dx = (dx / norma) * VEL * dt;
      dy = (dy / norma) * VEL * dt;
      // Um eixo de cada vez: barrar em X ainda deixa deslizar em Y, que é o
      // que faz o boneco escorregar pela parede em vez de grudar nela.
      if (livre(px + dx, py)) px += dx;
      if (livre(px, py + dy)) py += dy;
      dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'direita' : 'esquerda')
                                        : (dy > 0 ? 'baixo' : 'cima');
      andado += dt;
    } else {
      andado = 0;
    }
  }

  atualizaCamera();
  atualizaProximidade();
  desenha(t);
  sincronizaLabels();
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

// Clicar direto no mundo também interage, pra quem está no mouse/celular.
cv.addEventListener('click', (e) => {
  const r = cv.getBoundingClientRect();
  const wx = (e.clientX - r.left) / (r.width / VIEW_W) + camX;
  const wy = (e.clientY - r.top) / (r.height / VIEW_H) + camY;
  for (const g of gente) {
    if (Math.abs(g.x - wx) < 9 && wy > g.y - ACTOR_H && wy < g.y + 3) { abrePainel(g); return; }
  }
});

$('btn-mundo').onclick = () => (location.href = '/web/mundo.html');
$('btn-lista').onclick = () => (location.href = '/web/adversario.html');
$('btn-home').onclick = () => (location.href = '/web/index.html');
