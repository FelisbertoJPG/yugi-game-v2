/**
 * Deck Builder — liga o modelo de deck, a persistência e o pool de cartas.
 *
 * Reaproveita a `YgoDB` do pacote ygo-data em vez de reimplementar busca e
 * filtro. Carrega só o índice (~2 MB); o `cards.json` completo (~14 MB) entra
 * sob demanda, na primeira vez que alguém pede o detalhe de uma carta.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import { Deck, RULES, isExtraDeck } from '/web/js/deck.js';
import {
  listDecks, saveDeck, deleteDeck, getActiveIndex, setActiveIndex,
  downloadYdk, importYdk,
} from '/web/js/storage.js';

const $ = (id) => document.getElementById(id);
const ART = (id, small = true) =>
  `https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/${id}.jpg`;
const MAX_RENDER = 240;

let db = null;         // índice
let fullDb = null;     // cards.json, carregado sob demanda
let deck = new Deck();
let deckIndex = null;  // posição no localStorage; null = ainda não salvo
let dirty = false;

// ---------------------------------------------------------------- utilidades

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function markDirty(v = true) {
  dirty = v;
  $('btn-save').textContent = v ? 'salvar *' : 'salvar';
}

/** O índice traz só id/nome/stats; para nome de carta no deck usamos o cache. */
const briefCache = new Map();
function brief(id) {
  if (!briefCache.has(id)) briefCache.set(id, db.brief(id));
  return briefCache.get(id);
}

// ---------------------------------------------------------------- render deck

function renderDeck() {
  for (const zone of ['main', 'extra']) {
    const grid = $(`${zone}-grid`);
    const groups = deck.grouped(zone);
    const frag = document.createDocumentFragment();

    for (const { id, count } of groups) {
      const c = brief(id);
      const el = document.createElement('div');
      el.className = 'thumb';
      el.draggable = true;
      el.dataset.id = id;
      el.dataset.zone = zone;
      el.title = `${c?.name ?? id}\nclique: remover 1 · arraste: reordenar ou devolver`;
      el.innerHTML = `<img loading="lazy" src="${ART(id)}" alt="" draggable="false">` +
                     (count > 1 ? `<span class="count">×${count}</span>` : '');
      el.onclick = () => {
        deck.remove(id, zone);
        markDirty();
        refresh();
      };
      el.oncontextmenu = (e) => { e.preventDefault(); showDetail(id); };
      el.onmouseenter = () => showDetail(id);
      wireDragSource(el, id, zone);
      frag.append(el);
    }
    grid.replaceChildren(frag);
    $(`${zone}-empty`).hidden = groups.length > 0;
  }

  // contadores + estado das regras
  const m = deck.main.length, x = deck.extra.length;
  const mEl = $('main-count'), xEl = $('extra-count');
  mEl.textContent = m;
  xEl.textContent = x;
  mEl.className = 'n ' + (m >= RULES.MAIN_MIN && m <= RULES.MAIN_MAX ? 'good' : 'bad');
  xEl.className = 'n ' + (x <= RULES.EXTRA_MAX ? 'good' : 'bad');

  const v = deck.validate();
  $('status').textContent = v.valid
    ? `deck válido — Main ${m}, Extra ${x}`
    : v.errors[0];
  $('status').style.color = v.valid ? 'var(--green)' : 'var(--dim)';
}

// ---------------------------------------------------------------- render pool

let poolResults = [];

function renderPool() {
  const frag = document.createDocumentFragment();
  for (const c of poolResults.slice(0, MAX_RENDER)) {
    const copies = deck.copies(c.id);
    const full = copies >= RULES.MAX_COPIES;
    const el = document.createElement('div');
    el.className = 'thumb' + (full ? ' full' : '');
    el.draggable = !full;
    el.dataset.id = c.id;
    el.title = `${c.name}\n${c.tl}` +
      (full ? '\n(já tem 3 cópias)' : '\nclique ou arraste para adicionar');
    el.innerHTML = `<img loading="lazy" src="${ART(c.id)}" alt="" draggable="false">` +
                   (copies ? `<span class="count">${copies}</span>` : '');
    el.onclick = () => addCard(c);
    el.oncontextmenu = (e) => { e.preventDefault(); showDetail(c.id); };
    el.onmouseenter = () => showDetail(c.id);
    if (!full) wireDragSource(el, c.id, 'pool');
    frag.append(el);
  }
  $('pool-grid').replaceChildren(frag);
  $('pool-count').textContent = poolResults.length > MAX_RENDER
    ? `${poolResults.length} cartas (mostrando ${MAX_RENDER})`
    : `${poolResults.length} carta${poolResults.length === 1 ? '' : 's'}`;
}

function addCard(c) {
  const r = deck.add(c);
  if (!r.ok) return void toast(r.reason);
  markDirty();
  refresh();
  toast(`+ ${c.name} → ${r.zone === 'extra' ? 'Extra' : 'Main'}`);
}

function refresh() {
  renderDeck();
  renderPool();   // recalcula os contadores nas miniaturas do pool
}

// ---------------------------------------------------------------- arrastar

/**
 * Estado do arrasto em memória. O `dataTransfer` só é legível no `drop` na
 * maioria dos navegadores, mas precisamos saber a origem já no `dragover`
 * para decidir se o alvo aceita ou recusa.
 */
let drag = null;

function wireDragSource(el, id, from) {
  el.addEventListener('dragstart', (e) => {
    drag = { id: Number(id), from };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = from === 'pool' ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', String(id));   // exigido pelo Firefox
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    drag = null;
    document.querySelectorAll('.dropzone.over, .dropzone.reject')
      .forEach((z) => z.classList.remove('over', 'reject'));
    document.querySelectorAll('.thumb.drop-before')
      .forEach((t) => t.classList.remove('drop-before'));
  });
}

/** O alvo aceita o que está sendo arrastado? */
function accepts(zone) {
  if (!drag) return false;
  if (zone === 'pool') return drag.from !== 'pool';          // devolver ao pool
  return drag.from === 'pool' || drag.from === zone;          // adicionar ou reordenar
}

function setupDropZone(el, zone) {
  el.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    const ok = accepts(zone);
    e.dataTransfer.dropEffect = ok ? (zone === 'pool' ? 'move' : 'copy') : 'none';
    el.classList.add('over');
    el.classList.toggle('reject', !ok);

    // marca a posição de inserção ao reordenar dentro da mesma zona
    document.querySelectorAll('.thumb.drop-before')
      .forEach((t) => t.classList.remove('drop-before'));
    if (ok && drag.from === zone && zone !== 'pool') {
      const t = e.target.closest?.('.thumb');
      if (t && Number(t.dataset.id) !== drag.id) t.classList.add('drop-before');
    }
  });

  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('over', 'reject');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('over', 'reject');
    document.querySelectorAll('.thumb.drop-before')
      .forEach((t) => t.classList.remove('drop-before'));
    if (!drag || !accepts(zone)) return;

    const { id, from } = drag;

    if (zone === 'pool') {
      // devolver ao pool = remover uma cópia
      if (deck.remove(id, from)) {
        markDirty();
        refresh();
        toast(`− ${brief(id)?.name ?? id}`);
      }
      return;
    }

    if (from === 'pool') {
      const c = brief(id);
      if (c) addCard(c);
      return;
    }

    // reordenar dentro da mesma zona
    const target = e.target.closest?.('.thumb');
    const toId = target ? Number(target.dataset.id) : null;
    if (toId !== null && toId !== id) {
      reorder(zone, id, toId);
      markDirty();
      refresh();
    }
  });
}

/** Move todas as cópias de `fromId` para a posição ocupada por `toId`. */
function reorder(zone, fromId, toId) {
  const groups = deck.grouped(zone);
  const from = groups.findIndex((g) => g.id === fromId);
  const to = groups.findIndex((g) => g.id === toId);
  if (from === -1 || to === -1) return;
  const [moved] = groups.splice(from, 1);
  groups.splice(to, 0, moved);
  deck[zone] = groups.flatMap((g) => Array(g.count).fill(g.id));
}

// ---------------------------------------------------------------- detalhe

async function showDetail(id) {
  const c = brief(id);
  if (!c) return;
  $('detail').classList.add('show');
  $('d-img').src = ART(id, false);
  $('d-name').textContent = c.name;
  $('d-type').textContent = c.tl;
  $('d-stats').textContent = c.t === 'M'
    ? `${c.at ?? '?'} · ${c.r ?? '?'} · nv ${c.lv ?? '?'} · ATK ${c.atk ?? '?'} / DEF ${c.def ?? '—'}`
    : '';

  // O texto do efeito só existe no cards.json completo.
  if (!fullDb) {
    $('d-desc').textContent = '(carregando texto…)';
    fullDb = await YgoDB.load('/ygo-data/data', { full: true });
  }
  const fc = fullDb.get(id);
  if (fc && $('d-name').textContent === fc.name) $('d-desc').textContent = fc.desc;
}

// ---------------------------------------------------------------- filtros

function applyFilters() {
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  poolResults = db.filter({
    name: $('f-name').value || undefined,
    cardType: $('f-type').value || undefined,
    attribute: $('f-attr').value || undefined,
    race: $('f-race').value || undefined,
    archetype: $('f-arch').value || undefined,
    levelMin: num('f-lvmin'),
    levelMax: num('f-lvmax'),
    atkMin: num('f-atk'),
  });
  renderPool();
}

// ---------------------------------------------------------------- decks salvos

function refreshDeckSelect() {
  const decks = listDecks();
  const sel = $('deck-select');
  sel.replaceChildren();
  decks.forEach((d, i) => {
    const o = new Option(`${d.name} (${d.main.length}/${d.extra.length})`, String(i));
    sel.append(o);
  });
  if (!decks.length) sel.append(new Option('(nenhum salvo)', ''));
  sel.value = deckIndex === null ? '' : String(deckIndex);
  $('btn-delete').disabled = deckIndex === null;
}

function loadDeck(i) {
  const decks = listDecks();
  if (!decks[i]) return;
  deck = decks[i];
  deckIndex = i;
  setActiveIndex(i);
  $('deck-name').value = deck.name;
  markDirty(false);
  refreshDeckSelect();
  refresh();
}

function confirmDiscard() {
  return !dirty || confirm('Há alterações não salvas neste deck. Descartar?');
}

// ---------------------------------------------------------------- eventos

$('btn-save').onclick = () => {
  deck.name = $('deck-name').value.trim() || 'Novo Deck';
  deckIndex = saveDeck(deck, deckIndex);
  setActiveIndex(deckIndex);
  markDirty(false);
  refreshDeckSelect();
  const v = deck.validate();
  toast(v.valid ? 'deck salvo' : `salvo (incompleto: ${v.errors[0]})`);
};

$('btn-new').onclick = () => {
  if (!confirmDiscard()) return;
  deck = new Deck();
  deckIndex = null;
  $('deck-name').value = deck.name;
  markDirty(false);
  refreshDeckSelect();
  refresh();
};

$('btn-delete').onclick = () => {
  if (deckIndex === null) return;
  if (!confirm(`Excluir "${deck.name}"? Isso não pode ser desfeito.`)) return;
  deleteDeck(deckIndex);
  const decks = listDecks();
  if (decks.length) loadDeck(Math.min(deckIndex, decks.length - 1));
  else { deck = new Deck(); deckIndex = null; $('deck-name').value = deck.name;
         markDirty(false); refreshDeckSelect(); refresh(); }
  toast('deck excluído');
};

$('btn-export').onclick = () => {
  deck.name = $('deck-name').value.trim() || 'deck';
  downloadYdk(deck);
  toast('.ydk exportado');
};

$('btn-import').onclick = async () => {
  if (!confirmDiscard()) return;
  const d = await importYdk();
  if (!d) return;
  deck = d;
  deckIndex = null;
  $('deck-name').value = deck.name;
  markDirty();
  refresh();
  toast(`importado: Main ${deck.main.length}, Extra ${deck.extra.length}`);
};

$('btn-home').onclick = () => {
  if (!confirmDiscard()) return;
  location.href = '/web/index.html';
};

$('deck-select').onchange = (e) => {
  if (e.target.value === '') return;
  if (!confirmDiscard()) return void refreshDeckSelect();
  loadDeck(Number(e.target.value));
};

$('deck-name').oninput = () => markDirty();

for (const id of ['f-name', 'f-type', 'f-attr', 'f-race', 'f-arch',
                  'f-lvmin', 'f-lvmax', 'f-atk']) {
  $(id).addEventListener('input', applyFilters);
}
$('f-clear').onclick = () => {
  for (const id of ['f-name', 'f-type', 'f-attr', 'f-race', 'f-arch',
                    'f-lvmin', 'f-lvmax', 'f-atk']) $(id).value = '';
  applyFilters();
};

$('detail').onmouseleave = () => $('detail').classList.remove('show');

setupDropZone($('main-zone'), 'main');
setupDropZone($('extra-zone'), 'extra');
setupDropZone($('pool-zone'), 'pool');

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------- boot

try {
  db = await YgoDB.load('/ygo-data/data', { full: false });
} catch (e) {
  $('status').textContent =
    'Não consegui carregar o banco. Rode `npm run dev` a partir da raiz do projeto.';
  $('status').style.color = 'var(--red)';
  throw e;
}

// popula os selects a partir dos dados reais
const all = db.filter({});
const uniq = (fn) => [...new Set(all.map(fn).filter(Boolean))].sort();
$('f-attr').append(...uniq((c) => c.at).map((v) => new Option(v, v)));
$('f-race').append(...uniq((c) => c.r).map((v) => new Option(v, v)));
$('f-arch').append(...uniq((c) => c.a[0]).map((v) => new Option(v, v)));

// carrega o deck ativo, se houver
const active = getActiveIndex();
const saved = listDecks();
if (saved.length) loadDeck(active !== null && saved[active] ? active : 0);
else { $('deck-name').value = deck.name; refreshDeckSelect(); }

applyFilters();
refresh();
