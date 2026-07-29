/**
 * Booster Builder — mesma ideia do Deck Builder, mas as cartas vão para baldes
 * de RARIDADE (UR/SR/R/N) em vez de Main/Extra. Ao salvar, cada carta ganha as
 * tags do booster (nome + raridade) — ver boosters.js `annotateDb`.
 *
 * Reaproveita YgoDB, o navegador de detalhes, o "segurar para ver" e as cartas
 * customizadas. A lógica de pool/filtro é irmã da do builder.js (deck).
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import {
  RARITIES, RARITY_LABEL, listBoosters, getBoosterAt, saveBooster, deleteBooster,
  boosterSize, emptyBooster, downloadBooster, importBoosterFile, annotateDb,
  allBoosterTags, hydrateBoosters,
} from '/web/js/boosters.js';
import { listCustom } from '/web/js/customcards.js';
import { inLista1 } from '/web/js/lista1.js';
import { wireLongPress, injectHoldStyles, HOLD_MS } from '/web/js/interact.js';
import { configureCardDetail, showCardDetail } from '/web/js/carddetail.js';

const $ = (id) => document.getElementById(id);
const MAX_RENDER = 240;

const customArt = new Map();
const customDesc = new Map();

function ART(id, small = true) {
  const a = customArt.get(Number(id));
  if (a) return a;
  return `https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/${id}.jpg`;
}

let db = null;
let booster = emptyBooster();
let boosterIndex = null;     // posição no localStorage; null = ainda não salvo
let activeRarity = 'UR';     // balde que recebe o clique
let dirty = false;
let pickingCover = false;    // aguardando o clique na carta que vira a capa

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

const briefCache = new Map();
function brief(id) {
  if (!briefCache.has(id)) briefCache.set(id, db.brief(id));
  return briefCache.get(id);
}

function injectCustom(card) {
  db.addCustom(card);
  if (card.art) customArt.set(card.id, card.art);
  customDesc.set(card.id, card.desc || '');
  briefCache.delete(card.id);
}

// ---------------------------------------------------------------- capa

/** A capa é a carta que ilustra/define o booster (na Loja). Só visual. */
function renderCover() {
  const el = $('cover');
  const id = booster.coverId;
  el.style.backgroundImage = id ? `url("${ART(id, false)}")` : '';
  el.classList.toggle('empty', !id);
  el.classList.toggle('picking', pickingCover);
  el.title = pickingCover
    ? 'agora clique numa carta (Esc cancela)'
    : `capa: ${id ? (brief(id)?.name ?? id) : 'nenhuma'} — clique para trocar`;
}
function startPickCover() {
  pickingCover = true;
  document.body.classList.add('picking-cover');
  renderCover();
  toast('escolha a carta que vai ilustrar o booster (Esc cancela)');
}
function cancelPickCover() {
  if (!pickingCover) return;
  pickingCover = false;
  document.body.classList.remove('picking-cover');
  renderCover();
}
/** Consome o clique quando estamos escolhendo a capa. */
function tryPickCover(id) {
  if (!pickingCover) return false;
  booster.coverId = Number(id);
  cancelPickCover();
  markDirty();
  toast(`capa: ${brief(booster.coverId)?.name ?? booster.coverId}`);
  return true;
}

// ---------------------------------------------------------------- modelo

/** Em qual raridade do booster ATUAL a carta está (ou null). */
function currentRarityOf(id) {
  id = Number(id);
  for (const r of RARITIES) if (booster.cards[r].includes(id)) return r;
  return null;
}

/** Coloca a carta numa raridade (removendo de qualquer outra do MESMO booster). */
function setRarity(id, rarity) {
  id = Number(id);
  const cur = currentRarityOf(id);
  if (cur === rarity) return false;            // já está lá
  for (const r of RARITIES) {
    const i = booster.cards[r].indexOf(id);
    if (i >= 0) booster.cards[r].splice(i, 1);
  }
  booster.cards[rarity].push(id);
  return true;
}

function removeFromBooster(id) {
  id = Number(id);
  let removed = false;
  for (const r of RARITIES) {
    const i = booster.cards[r].indexOf(id);
    if (i >= 0) { booster.cards[r].splice(i, 1); removed = true; }
  }
  return removed;
}

function addCard(id, rarity = activeRarity) {
  const nome = brief(id)?.name ?? id;
  const before = currentRarityOf(id);
  if (setRarity(id, rarity)) {
    markDirty();
    refresh();
    toast(before ? `${nome}: ${before} → ${rarity}` : `+ ${nome} → ${rarity}`);
  }
}

// ---------------------------------------------------------------- render booster

function renderBoosterZones() {
  const wrap = $('booster-zones');
  wrap.replaceChildren();
  for (const r of RARITIES) {
    const block = document.createElement('div');
    block.className = 'rar-block';

    const head = document.createElement('div');
    head.className = 'sec-head';
    head.style.cursor = 'pointer';
    head.style.margin = '0 -12px 6px';
    head.innerHTML = `<span class="rar rar-${r}">${r}</span>`
      + `<span style="color:var(--dim)">${RARITY_LABEL[r]}</span>`
      + `<span class="n" id="count-${r}">0</span>`
      + `<span class="spacer"></span>`
      + `<span id="active-${r}" style="font-size:10px"></span>`;
    head.onclick = () => { activeRarity = r; refresh(); };

    const zone = document.createElement('div');
    zone.className = 'dropzone';
    zone.id = `zone-${r}`;
    const grid = document.createElement('div');
    grid.className = 'deck-grid';
    grid.id = `grid-${r}`;
    const empty = document.createElement('div');
    empty.className = 'zone-empty';
    empty.id = `empty-${r}`;
    empty.textContent = `Nenhuma carta em ${r}.`;
    zone.append(grid, empty);

    block.append(head, zone);
    wrap.append(block);
    setupDropZone(zone, r);
  }
}

function renderBooster() {
  if (!$('grid-UR')) renderBoosterZones();   // garante que as zonas existem
  for (const r of RARITIES) {
    const grid = $(`grid-${r}`);
    const frag = document.createDocumentFragment();
    for (const id of booster.cards[r]) {
      const c = brief(id);
      const el = document.createElement('div');
      el.className = 'thumb';
      el.draggable = true;
      el.dataset.id = id;
      el.dataset.zone = r;
      el.title = `${c?.name ?? id}\narraste para outra raridade ou para o pool (remover)`;
      el.innerHTML = `<img loading="lazy" src="${ART(id)}" alt="" draggable="false">`;
      const segurou = wireLongPress(el, HOLD_MS, () => showCardDetail(id));
      el.onclick = () => {
        if (segurou()) return;
        if (tryPickCover(id)) return;   // escolhendo a capa: usa esta carta
        showCardDetail(id);
      };
      el.oncontextmenu = (e) => { e.preventDefault(); showCardDetail(id); };
      wireDragSource(el, id, r);
      frag.append(el);
    }
    grid.replaceChildren(frag);
    $(`count-${r}`).textContent = booster.cards[r].length;
    $(`empty-${r}`).hidden = booster.cards[r].length > 0;
    $(`active-${r}`).textContent = activeRarity === r ? '◀ recebe o clique' : '';
    const head = $(`active-${r}`).closest('.sec-head');
    if (head) head.style.background = activeRarity === r ? '#1c2a3f' : 'var(--panel)';
  }
  $('booster-count').textContent = boosterSize(booster);
}

// ---------------------------------------------------------------- render pool

let poolResults = [];

function renderPool() {
  const frag = document.createDocumentFragment();
  for (const c of poolResults.slice(0, MAX_RENDER)) {
    const rar = currentRarityOf(c.id);
    const el = document.createElement('div');
    el.className = 'thumb' + (c.custom ? ' custom' : '') + (rar ? ' in-booster' : '');
    el.draggable = true;
    el.dataset.id = c.id;
    el.title = `${c.name}\n${c.tl}`
      + (rar ? `\n(no booster: ${rar})` : '')
      + `\nclique = adicionar em ${activeRarity} · segurar = detalhes`;
    el.innerHTML =
      (c.custom ? '<span class="badge">CST</span>' : '') +
      (rar ? `<span class="rarity ${rar}">${rar}</span>` : '') +
      `<img loading="lazy" src="${ART(c.id)}" alt="" draggable="false">`;

    const segurou = wireLongPress(el, HOLD_MS, () => showCardDetail(c.id));
    el.onclick = () => {
      if (segurou()) return;
      if (tryPickCover(c.id)) return;   // escolhendo a capa: não adiciona
      addCard(c.id);
    };
    el.oncontextmenu = (e) => { e.preventDefault(); showCardDetail(c.id); };
    wireDragSource(el, c.id, 'pool');
    frag.append(el);
  }
  $('pool-grid').replaceChildren(frag);
  $('pool-count').textContent = poolResults.length > MAX_RENDER
    ? `${poolResults.length} cartas (mostrando ${MAX_RENDER})`
    : `${poolResults.length} carta${poolResults.length === 1 ? '' : 's'}`;
}

function updateShopButton() {
  const btn = $('btn-shop');
  btn.classList.toggle('in-shop-on', !!booster.inShop);
  btn.textContent = booster.inShop ? 'na Loja ✓' : 'inserir na Loja';
}

function refresh() {
  renderBooster();
  renderPool();
  renderCover();
  updateShopButton();
  // reflete o preço do booster atual (sem mexer enquanto o usuário digita nele)
  if (document.activeElement !== $('booster-price')) $('booster-price').value = booster.price;
}

// ---------------------------------------------------------------- arrastar

let drag = null;

function wireDragSource(el, id, from) {
  el.addEventListener('dragstart', (e) => {
    drag = { id: Number(id), from };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    drag = null;
    document.querySelectorAll('.dropzone.over, .dropzone.reject')
      .forEach((z) => z.classList.remove('over', 'reject'));
  });
}

/** zone = 'pool' ou uma raridade ('UR'...). */
function accepts(zone) {
  if (!drag) return false;
  if (zone === 'pool') return drag.from !== 'pool';   // devolver = remover
  return drag.from !== zone;                          // mover para outra raridade / do pool
}

function setupDropZone(el, zone) {
  el.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    const ok = accepts(zone);
    e.dataTransfer.dropEffect = ok ? 'move' : 'none';
    el.classList.add('over');
    el.classList.toggle('reject', !ok);
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('over', 'reject');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('over', 'reject');
    if (!drag || !accepts(zone)) return;
    const { id } = drag;
    if (zone === 'pool') {
      if (removeFromBooster(id)) { markDirty(); refresh(); toast(`− ${brief(id)?.name ?? id}`); }
    } else {
      addCard(id, zone);
    }
  });
}

// ---------------------------------------------------------------- filtros

function activeTypeFilter() {
  const mon = $('f-mon').value, sp = $('f-spell').value, tr = $('f-trap').value;
  if (mon) return { cardType: 'Monster', sub: mon === '*' ? null : mon };
  if (sp) return { cardType: 'Spell', sub: sp === '*' ? null : sp };
  if (tr) return { cardType: 'Trap', sub: tr === '*' ? null : tr };
  return { cardType: undefined, sub: null };
}

function matchesSub(c, cardType, sub) {
  const tl = c.tl || '';
  if (cardType === 'Monster') {
    if (sub === 'Normal') return /Normal/.test(tl);
    if (sub === 'Effect') return /Effect/.test(tl) && !/Ritual|Fusion|Synchro|Xyz|Link/.test(tl);
    return new RegExp(sub).test(tl);
  }
  return tl.startsWith(sub);
}

/** Ordena por maior ATK/DEF/nível (desc.); nulos por último. */
function sortPool(list, key) {
  if (!key) return list;
  const val = (c) => (key === 'atk' ? c.atk : key === 'def' ? c.def : c.lv);
  return [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va;
  });
}

function applyFilters() {
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  const { cardType, sub } = activeTypeFilter();
  poolResults = db.filter({
    name: $('f-name').value || undefined,
    cardType,
    attribute: $('f-attr').value || undefined,
    race: $('f-race').value || undefined,
    archetype: $('f-arch').value || undefined,
    levelMin: num('f-lvmin'),
    levelMax: num('f-lvmax'),
    atkMin: num('f-atk'),
  });
  if (sub) poolResults = poolResults.filter((c) => matchesSub(c, cardType, sub));
  const tag = $('f-tag').value;
  if (tag) poolResults = poolResults.filter((c) => (c.tags ?? []).includes(tag));
  if ($('f-lista1').checked) poolResults = poolResults.filter(inLista1);
  poolResults = sortPool(poolResults, $('f-sort').value);
  renderPool();
}

function refreshTagSelect() {
  const tags = new Set(allBoosterTags());
  for (const c of listCustom()) for (const t of (c.tags ?? [])) tags.add(t);
  const sel = $('f-tag');
  const current = sel.value;
  sel.replaceChildren(new Option('tag: todas', ''));
  for (const t of [...tags].sort()) sel.append(new Option(t, t));
  sel.value = [...sel.options].some((o) => o.value === current) ? current : '';
}

// ---------------------------------------------------------------- boosters salvos

function refreshBoosterSelect() {
  const list = listBoosters();
  const sel = $('booster-select');
  sel.replaceChildren();
  list.forEach((b, i) => sel.append(new Option(`${b.name} (${boosterSize(b)})`, String(i))));
  if (!list.length) sel.append(new Option('(nenhum salvo)', ''));
  sel.value = boosterIndex === null ? '' : String(boosterIndex);
  $('btn-delete').disabled = boosterIndex === null;
}

function loadBooster(i) {
  const b = getBoosterAt(i);
  if (!b) return;
  booster = b;
  boosterIndex = i;
  $('booster-name').value = booster.name;
  markDirty(false);
  refreshBoosterSelect();
  refresh();
}

function confirmDiscard() {
  return !dirty || confirm('Há alterações não salvas neste booster. Descartar?');
}

// ---------------------------------------------------------------- eventos

$('btn-save').onclick = () => {
  booster.name = $('booster-name').value.trim() || 'Novo Booster';
  boosterIndex = saveBooster(booster, boosterIndex);
  markDirty(false);
  // as tags de raridade/booster passam a valer no db e no filtro
  annotateDb(db);
  briefCache.clear();
  refreshTagSelect();
  refreshBoosterSelect();
  applyFilters();
  refresh();
  toast(`booster "${booster.name}" salvo — cartas marcadas com a raridade`);
};

$('btn-new').onclick = () => {
  if (!confirmDiscard()) return;
  booster = emptyBooster();
  boosterIndex = null;
  $('booster-name').value = booster.name;
  markDirty(false);
  refreshBoosterSelect();
  refresh();
};

$('btn-delete').onclick = () => {
  if (boosterIndex === null) return;
  if (!confirm(`Excluir "${booster.name}"? Isso não pode ser desfeito.`)) return;
  deleteBooster(boosterIndex);
  annotateDb(db);
  briefCache.clear();
  const list = listBoosters();
  if (list.length) loadBooster(Math.min(boosterIndex, list.length - 1));
  else {
    booster = emptyBooster(); boosterIndex = null;
    $('booster-name').value = booster.name; markDirty(false);
    refreshBoosterSelect(); refresh();
  }
  refreshTagSelect();
  applyFilters();
  toast('booster excluído');
};

$('btn-export').onclick = () => {
  booster.name = $('booster-name').value.trim() || 'booster';
  downloadBooster(booster);
  toast('.json exportado');
};

$('btn-import').onclick = async () => {
  if (!confirmDiscard()) return;
  const b = await importBoosterFile();
  if (!b) return void toast('arquivo inválido');
  booster = b;
  boosterIndex = null;
  $('booster-name').value = booster.name;
  markDirty();
  refresh();
  toast(`importado: ${booster.name} (${boosterSize(booster)} cartas)`);
};

$('btn-home').onclick = () => {
  if (!confirmDiscard()) return;
  location.href = '/web/index.html';
};

$('booster-select').onchange = (e) => {
  if (e.target.value === '') return;
  if (!confirmDiscard()) return void refreshBoosterSelect();
  loadBooster(Number(e.target.value));
};

$('booster-name').oninput = () => markDirty();
$('booster-price').oninput = () => {
  const v = Number($('booster-price').value);
  booster.price = Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  markDirty();
};

// capa (mesma ideia do deck de NPC): clica no slot, depois numa carta
$('cover').onclick = () => (pickingCover ? cancelPickCover() : startPickCover());
$('cover').onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('cover').onclick(); }
};

// "inserir na Loja": salva o booster já marcado como exposto — automatiza a
// entrada na Loja, sem precisar mexer em código a cada booster novo.
$('btn-shop').onclick = () => {
  if (!booster.inShop && boosterSize(booster) === 0) {
    return void toast('adicione cartas antes de pôr na Loja');
  }
  booster.name = $('booster-name').value.trim() || 'Novo Booster';
  booster.inShop = !booster.inShop;
  boosterIndex = saveBooster(booster, boosterIndex);
  annotateDb(db); briefCache.clear();
  refreshTagSelect(); refreshBoosterSelect(); applyFilters(); refresh();
  markDirty(false);
  toast(booster.inShop
    ? `"${booster.name}" está na Loja (custa 100 DP)`
    : `"${booster.name}" saiu da Loja`);
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancelPickCover();
});

const TYPE_IDS = ['f-mon', 'f-spell', 'f-trap'];
const FILTER_IDS = ['f-name', 'f-attr', 'f-race', 'f-arch', 'f-tag', 'f-sort',
                    'f-lvmin', 'f-lvmax', 'f-atk'];
for (const id of [...FILTER_IDS, 'f-lista1']) $(id).addEventListener('input', applyFilters);
for (const id of TYPE_IDS) {
  $(id).addEventListener('change', () => {
    if ($(id).value) for (const other of TYPE_IDS) if (other !== id) $(other).value = '';
    applyFilters();
  });
}
$('f-clear').onclick = () => {
  for (const id of [...FILTER_IDS, ...TYPE_IDS]) $(id).value = '';
  $('f-lista1').checked = false;
  applyFilters();
};

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

setupDropZone($('pool-zone'), 'pool');

// ---------------------------------------------------------------- boot

try {
  db = await YgoDB.load('/ygo-data/data', { full: false });
} catch (e) {
  $('status').textContent =
    'Não consegui carregar o banco. Rode `npm run dev` a partir da raiz do projeto.';
  $('status').style.color = 'var(--red)';
  throw e;
}

injectHoldStyles(HOLD_MS);
configureCardDetail({
  db,
  artOf: (id) => customArt.get(Number(id)),
  descOf: (id) => customDesc.get(Number(id)),
});

// Traz os boosters do projeto (store/boosters.json) antes de qualquer leitura.
await hydrateBoosters();

for (const c of listCustom()) injectCustom(c);
annotateDb(db);
briefCache.clear();

const all = db.filter({});
const uniq = (fn) => [...new Set(all.map(fn).filter(Boolean))].sort();
$('f-attr').append(...uniq((c) => c.at).map((v) => new Option(v, v)));
$('f-race').append(...uniq((c) => c.r).map((v) => new Option(v, v)));
$('f-arch').append(...uniq((c) => c.a[0]).map((v) => new Option(v, v)));
refreshTagSelect();

$('status').textContent = 'Monte o booster: escolha uma raridade (clique no cabeçalho) e clique nas cartas.';
renderBoosterZones();

const list = listBoosters();
if (list.length) loadBooster(0);
else { $('booster-name').value = booster.name; refreshBoosterSelect(); refresh(); }

applyFilters();
refresh();
