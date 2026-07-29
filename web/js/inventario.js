/**
 * Inventário — o que o jogador POSSUI, em duas abas.
 *
 * **Cards**: a coleção com a quantidade EXATA de cópias que os pacotes deram.
 * Isso é uma extensão, não uma troca de regra: o Deck Builder continua tratando
 * carta Normal como se você tivesse 3 (ver `availableCopies` em builder.js) —
 * aqui é onde a contagem real aparece, porque é ela que se vende.
 *
 * **Decks**: os decks montados, em quadros com moldura, no mesmo formato dos
 * boosters da Loja.
 *
 * Venda: N 5 · R 10 · SR 20 · UR 100 DP. A raridade vem dos boosters
 * (`rarityIndex`); carta que não está em nenhum booster vale como Normal.
 */

import { YgoDB } from '/ygo-data/src/ygodb.js';
import { rarityIndex, RARITIES, hydrateBoosters } from '/web/js/boosters.js';
import { listCustom } from '/web/js/customcards.js';
import {
  getDP, getCollection, totalCards, distinctCards,
  sellCards, sellPriceOf, SELL_PRICE, hydrateWallet,
} from '/web/js/wallet.js';
import { listDecks, saveDeck, getActiveIndex, setActiveIndex } from '/web/js/storage.js';
import { RULES } from '/web/js/deck.js';
import { showCardDetail, configureCardDetail } from '/web/js/carddetail.js';
import { wireLongPress, injectHoldStyles, HOLD_MS } from '/web/js/interact.js';

const $ = (id) => document.getElementById(id);

const customArt = new Map();
const ART = (id, small = false) =>
  customArt.get(Number(id))
  ?? `https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/${id}.jpg`;

let db = null;
let rarIdx = new Map();

const nameOf = (id) => db?.brief(id)?.name ?? String(id);
/** Raridade para efeito de VENDA: sem booster, vale como Normal. */
const rarOf = (id) => rarIdx.get(Number(id))?.rarity ?? null;

/** Seleção atual: id → quantas cópias daquela carta estão selecionadas. */
const selecao = new Map();

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ abas

function mostrarAba(qual) {
  const cards = qual === 'cards';
  $('tab-cards').setAttribute('aria-selected', String(cards));
  $('tab-decks').setAttribute('aria-selected', String(!cards));
  $('pane-cards').classList.toggle('on', cards);
  $('pane-decks').classList.toggle('on', !cards);
  $('filtros-cards').hidden = !cards;
  if (!cards) renderDecks();
}

// ------------------------------------------------------------------ Cards

/** A coleção como lista, já filtrada e ordenada pelos controles da tela. */
function listaCards() {
  const col = getCollection();
  const termo = $('f-nome').value.trim().toLowerCase();
  const rarFiltro = $('f-rar').value;
  const ordem = $('f-ord').value;

  let itens = Object.entries(col)
    .map(([id, qtd]) => ({ id: Number(id), qtd: Number(qtd) }))
    .filter((c) => c.qtd > 0)
    .map((c) => ({ ...c, rar: rarOf(c.id), nome: nameOf(c.id) }));

  if (termo) itens = itens.filter((c) => c.nome.toLowerCase().includes(termo));
  // O filtro "N" precisa pegar também as cartas sem raridade nenhuma: elas
  // valem como Normal na venda, então esconder-las aqui seria inconsistente.
  if (rarFiltro) {
    itens = itens.filter((c) => (c.rar ?? 'N') === rarFiltro);
  }

  const peso = (c) => RARITIES.indexOf(c.rar ?? 'N');
  const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  if (ordem === 'nome') itens.sort(porNome);
  else if (ordem === 'qtd') itens.sort((a, b) => b.qtd - a.qtd || porNome(a, b));
  else itens.sort((a, b) => peso(a) - peso(b) || porNome(a, b));

  return itens;
}

function renderCards() {
  const itens = listaCards();
  const frag = document.createDocumentFragment();

  for (const c of itens) {
    const rar = c.rar ?? 'N';
    const sel = selecao.get(c.id) ?? 0;
    const valor = sellPriceOf(c.rar);

    const el = document.createElement('div');
    el.className = 'ic' + (sel > 0 ? ' sel' : '') + (sel >= c.qtd ? ' zerando' : '');
    el.innerHTML =
      `<div class="art">` +
        `<img loading="lazy" src="${ART(c.id, true)}" alt="">` +
        `<span class="rar ${rar}${c.rar ? '' : ' desconhecida'}"` +
          `${c.rar ? '' : ' title="fora de qualquer booster — vale como Normal"'}>${rar}</span>` +
        `<span class="own">×${c.qtd}</span>` +
      `</div>` +
      `<div class="sel-row">` +
        `<span class="n" title="cópias selecionadas">${sel}</span>` +
        `<button class="minus" title="tirar da seleção" ${sel ? '' : 'disabled'}>−</button>` +
      `</div>` +
      `<div class="nm">${escapeHtml(c.nome)}</div>` +
      `<div class="vale">${valor} DP cada</div>`;

    const art = el.querySelector('.art');
    const foiSegurado = wireLongPress(art, HOLD_MS, () => showCardDetail(c.id));
    art.onclick = () => {
      if (foiSegurado()) return;      // segurar abre o detalhe; não seleciona
      selecionar(c.id, +1, c.qtd);
    };
    el.querySelector('.minus').onclick = (e) => {
      e.stopPropagation();
      selecionar(c.id, -1, c.qtd);
    };
    frag.append(el);
  }

  $('grid-cards').replaceChildren(frag);
  $('cards-vazio').hidden = itens.length > 0 || totalCards() > 0;
  if (!itens.length && totalCards() > 0) {
    $('grid-cards').innerHTML = `<div class="empty">Nenhuma carta com esse filtro.</div>`;
  }
  $('n-cards').textContent = `${distinctCards()}`;
  renderResumo();
}

/** Muta a seleção de uma carta, presa entre 0 e o que o jogador possui. */
function selecionar(id, delta, maximo) {
  const atual = selecao.get(id) ?? 0;
  const novo = Math.min(Math.max(0, atual + delta), maximo);
  if (novo === atual) {
    if (delta > 0) toast(`você só tem ${maximo} cópia${maximo > 1 ? 's' : ''} desta carta`);
    return;
  }
  if (novo === 0) selecao.delete(id); else selecao.set(id, novo);
  renderCards();
}

/** Total selecionado e quanto vale. */
function somaSelecao() {
  let copias = 0;
  let dp = 0;
  for (const [id, n] of selecao) {
    copias += n;
    dp += n * sellPriceOf(rarOf(id));
  }
  return { copias, dp };
}

function renderResumo() {
  const { copias, dp } = somaSelecao();
  $('resumo').innerHTML = copias
    ? `<b>${copias}</b> carta${copias > 1 ? 's' : ''} selecionada${copias > 1 ? 's' : ''} · vale <b>${dp} DP</b>`
    : 'nenhuma carta selecionada';
  $('btn-vender').disabled = copias === 0;
  $('btn-vender').textContent = copias ? `vender selecionadas (${dp} DP)` : 'vender selecionadas';
}

/**
 * Quais cartas da seleção ficariam com ZERO cópias — e portanto sumiriam do
 * Deck Builder — estando dentro de algum deck salvo. Vale o aviso: o deck
 * continuaria existindo, mas sem poder ser remontado.
 */
function alertasDeDeck() {
  const col = getCollection();
  const zerando = [...selecao.entries()]
    .filter(([id, n]) => n >= (col[id] ?? 0))
    .map(([id]) => Number(id));
  if (!zerando.length) return [];

  const avisos = [];
  for (const deck of listDecks()) {
    const usadas = zerando.filter((id) => deck.copies(id) > 0);
    if (usadas.length) avisos.push({ deck: deck.name, cartas: usadas });
  }
  return avisos;
}

function abrirVenda() {
  const { copias, dp } = somaSelecao();
  if (!copias) return;

  $('venda-sub').textContent =
    `${copias} cópia${copias > 1 ? 's' : ''} · você receberá ${dp} DP · saldo depois: ${getDP() + dp} DP`;

  const frag = document.createDocumentFragment();
  for (const [id, n] of [...selecao].sort((a, b) => sellPriceOf(rarOf(b[0])) - sellPriceOf(rarOf(a[0])))) {
    const linha = document.createElement('div');
    linha.className = 'linha';
    const rar = rarOf(id) ?? 'N';
    linha.innerHTML = `<span class="q">${n}×</span>`
      + `<span>${escapeHtml(nameOf(id))} <span class="muted">(${rar})</span></span>`
      + `<span class="v">${n * sellPriceOf(rarOf(id))} DP</span>`;
    frag.append(linha);
  }
  $('venda-lista').replaceChildren(frag);

  const avisos = alertasDeDeck();
  const box = $('venda-aviso');
  box.hidden = avisos.length === 0;
  if (avisos.length) {
    box.innerHTML = '⚠ Você ficará sem nenhuma cópia de cartas usadas em: '
      + avisos.map((a) => `<b>${escapeHtml(a.deck)}</b>`).join(', ')
      + '. O deck continua salvo, mas não dá para remontá-lo sem essas cartas.';
  }

  $('venda-back').classList.add('show');
}

function confirmarVenda() {
  const lotes = [...selecao.entries()].map(([id, qty]) => ({ id, qty, rarity: rarOf(id) }));
  const r = sellCards(lotes);
  $('venda-back').classList.remove('show');
  if (!r.ok) return void toast('nada foi vendido');
  selecao.clear();
  renderDP();
  renderCards();
  toast(`+${r.total} DP · ${r.vendidas} carta${r.vendidas > 1 ? 's' : ''} vendida${r.vendidas > 1 ? 's' : ''}`);
}

/** Seleciona tudo o que passa de 1 cópia — a limpeza de duplicatas óbvia. */
function selecionarDuplicatas() {
  selecao.clear();
  for (const c of listaCards()) if (c.qtd > 1) selecao.set(c.id, c.qtd - 1);
  renderCards();
  const { copias } = somaSelecao();
  toast(copias ? `${copias} duplicata${copias > 1 ? 's' : ''} selecionada${copias > 1 ? 's' : ''}` : 'nenhuma duplicata');
}

// ------------------------------------------------------------------ Decks

function renderDecks() {
  const decks = listDecks();
  const ativo = getActiveIndex() ?? 0;
  $('n-decks').textContent = `${decks.length}`;
  $('decks-vazio').hidden = decks.length > 0;

  const frag = document.createDocumentFragment();
  decks.forEach((deck, i) => {
    const v = deck.validate();
    const capa = deck.cover;
    const el = document.createElement('div');
    el.className = 'dk' + (i === ativo ? ' ativo' : '');
    el.innerHTML =
      `<div class="art" style="background-image:${capa ? `url('${ART(capa)}')` : 'none'}">` +
        (i === ativo ? `<span class="badge">ATIVO</span>` : '') +
        (capa ? '' : `<span class="semarte">deck vazio — sem moldura</span>`) +
      `</div>` +
      `<div class="body">` +
        `<span class="name"></span>` +
        `<span class="meta">Main <b>${deck.main.length}</b>/${RULES.MAIN_MIN}–${RULES.MAIN_MAX}` +
          ` · Extra <b>${deck.extra.length}</b>/${RULES.EXTRA_MAX}</span>` +
        `<span class="pill ${v.valid ? 'ok' : 'err'}">${v.valid ? 'VÁLIDO' : 'INCOMPLETO'}</span>` +
        `<div class="acoes">` +
          `<button class="abrir">abrir</button>` +
          `<button class="moldura">moldura</button>` +
          (i === ativo ? '' : `<button class="ativar">usar</button>`) +
        `</div>` +
      `</div>`;

    // textContent, não innerHTML: nome de deck é texto do jogador.
    el.querySelector('.name').textContent = deck.name;
    el.querySelector('.abrir').onclick = () => (location.href = `/web/deck.html?owned=1&deck=${i}`);
    el.querySelector('.moldura').onclick = () => abrirMoldura(i);
    el.querySelector('.ativar')?.addEventListener('click', () => {
      setActiveIndex(i);
      renderDecks();
      toast(`"${deck.name}" agora é o deck ativo`);
    });
    frag.append(el);
  });
  $('grid-decks').replaceChildren(frag);
}

let moldurando = null;   // índice do deck cuja moldura está sendo escolhida

/** Escolha da moldura entre as cartas do PRÓPRIO deck — é ele que ela ilustra. */
function abrirMoldura(i) {
  const deck = listDecks()[i];
  if (!deck) return;
  moldurando = i;

  const ids = [...new Set([...deck.main, ...deck.extra])];
  $('cover-sub').textContent = ids.length
    ? `${deck.name} — clique na carta que vai ilustrar o deck`
    : `${deck.name} — o deck está vazio`;

  const frag = document.createDocumentFragment();
  for (const id of ids) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = ART(id, true);
    img.alt = nameOf(id);
    img.title = nameOf(id);
    if (id === deck.coverId) img.className = 'atual';
    img.onclick = () => definirMoldura(id);
    frag.append(img);
  }
  $('cover-grid').replaceChildren(frag);
  $('cover-back').classList.add('show');
}

function definirMoldura(id) {
  const deck = listDecks()[moldurando];
  if (!deck) return;
  deck.coverId = id ? Number(id) : null;
  saveDeck(deck, moldurando);
  $('cover-back').classList.remove('show');
  renderDecks();
  toast(id ? `moldura: ${nameOf(id)}` : 'moldura: a primeira carta do Main');
}

// ------------------------------------------------------------------ topo

function renderDP() {
  $('dp').textContent = `${getDP()} DP`;
}

$('btn-home').onclick = () => (location.href = '/web/index.html');
$('tab-cards').onclick = () => mostrarAba('cards');
$('tab-decks').onclick = () => mostrarAba('decks');

for (const id of ['f-nome', 'f-rar', 'f-ord']) {
  $(id).addEventListener('input', renderCards);
}
$('btn-limpar').onclick = () => { selecao.clear(); renderCards(); };
$('btn-tudo').onclick = selecionarDuplicatas;
$('btn-vender').onclick = abrirVenda;
$('venda-cancelar').onclick = () => $('venda-back').classList.remove('show');
$('venda-ok').onclick = confirmarVenda;
$('cover-fechar').onclick = () => $('cover-back').classList.remove('show');
$('cover-limpar').onclick = () => definirMoldura(null);
for (const id of ['venda-back', 'cover-back']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === $(id)) $(id).classList.remove('show');
  });
}

// ---------------------------------------------------------------- boot
await hydrateBoosters();   // raridades (store/boosters.json)
await hydrateWallet();     // DP + coleção (store/wallet.json)

try {
  db = await YgoDB.load('/ygo-data/data', { full: false });
} catch { /* segue sem nomes; a arte ainda vem por id */ }

for (const c of listCustom()) if (c.art) customArt.set(c.id, c.art);
rarIdx = rarityIndex();

configureCardDetail({ db, artOf: (id) => customArt.get(Number(id)) ?? null });
injectHoldStyles(HOLD_MS);

$('f-rar').title = Object.entries(SELL_PRICE).map(([r, v]) => `${r} ${v} DP`).join(' · ');

renderDP();
renderCards();
renderDecks();
