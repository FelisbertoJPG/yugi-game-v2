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
import {
  listCustom, saveCustom, parseCardmaker, buildCard, downscaleDataUrl,
  renderFramedCard, RACES, ATTRIBUTES, MONSTER_KINDS, SUBTYPES, isExtraKind,
} from '/web/js/customcards.js';
import {
  getNpc, getNpcState, getNpcDeckAt, saveNpcDeckAt, loadNpcDecks, hydrateCustomNpcs,
} from '/web/js/npcs.js';
import { saveProjectDeck, playerDeckPath } from '/web/js/projectdecks.js';
import { inLista1 } from '/web/js/lista1.js';
import { hydrateBanlist, getBanlist, validateBanlist } from '/web/js/banlist.js';
import { annotateDb, allBoosterTags, rarityIndex, hydrateBoosters } from '/web/js/boosters.js';
import { ownsCard, ownedCount, hydrateWallet } from '/web/js/wallet.js';
import { wireLongPress, injectHoldStyles, HOLD_MS } from '/web/js/interact.js';
import { configureCardDetail, showCardDetail } from '/web/js/carddetail.js';

const $ = (id) => document.getElementById(id);
const MAX_RENDER = 240;

// Arte e texto das cartas customizadas (fora do banco oficial).
const customArt = new Map();   // id -> data URL (arte reduzida)
const customDesc = new Map();  // id -> texto do efeito

/** URL/arte da carta: data URL para customizadas, ygoprodeck para as oficiais. */
function ART(id, small = true) {
  const a = customArt.get(Number(id));
  if (a) return a;
  return `https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/${id}.jpg`;
}

/** Injeta uma carta customizada no índice em memória e nos caches de arte/texto. */
function injectCustom(card) {
  db.addCustom(card);
  if (card.art) customArt.set(card.id, card.art);
  else customArt.delete(card.id);
  customDesc.set(card.id, card.desc || '');
  briefCache.delete(card.id); // se já havia um brief cacheado, força reler do índice
}

let db = null;         // índice
let fullDb = null;     // cards.json, carregado sob demanda
let banlist = null;    // pontos + grupos de cópias (web/js/banlist.js), só some se Lista 1 estiver ligada
let deck = new Deck();
let deckIndex = null;  // posição no localStorage; null = ainda não salvo
let dirty = false;

// Modo NPC: quando ?npc=<id>&deck=<i|new>, o builder edita UM dos decks daquele
// NPC. `npcMode` guarda o NPC; `npcDeckIndex`, qual deck (null = novo);
// `npcSignature`, a carta que esse deck dropa.
let npcMode = null;
let npcDeckIndex = null;
let npcSignature = null;

// Modo Coleção (?owned=1): o pool mostra só as cartas que o jogador POSSUI —
// é o Deck Builder "real". Sem a flag (Área de Teste), o pool é o banco inteiro.
let ownedMode = new URLSearchParams(location.search).get('owned') === '1';

// Raridade das cartas (dos boosters). Estável durante a sessão do builder, então
// calculo uma vez no boot.
let rarIdx = new Map();

/**
 * Quantas cópias desta carta o jogador pode usar no deck.
 *   • Área de Teste (sem Coleção): a regra normal, 3.
 *   • Coleção, carta Normal (ou sem raridade): sempre 3 — possuir 1 vale por 3.
 *   • Coleção, carta R/SR/UR: as cópias EXATAS que possui (no teto de 3).
 * Assim UR/SR viram colecionáveis de verdade e Normais são fartas.
 */
function availableCopies(id) {
  if (!ownedMode) return RULES.MAX_COPIES;
  const rar = rarIdx.get(Number(id))?.rarity;
  if (!rar || rar === 'N') return RULES.MAX_COPIES;
  return Math.min(RULES.MAX_COPIES, ownedCount(id));
}
let npcCover = null;      // carta que ilustra o deck (só visual)
let pickingCover = false; // aguardando o clique na carta que virará a moldura

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
  const base = npcMode ? 'salvar NPC' : 'salvar';
  $('btn-save').textContent = v ? `${base} *` : base;
}

/**
 * Linha extra pro tooltip da miniatura com a regra de banlist da carta (só
 * quando a Lista 1 está marcada — fora dela a banlist nem se aplica).
 */
function banlistTooltip(id) {
  if (!$('f-lista1').checked || !banlist) return '';
  const pts = banlist.cardPoints[String(id)];
  const lim = banlist.cardLimits[String(id)];
  const grp = banlist.cardGroups[String(id)];
  if (!pts && !lim && !grp) return '';
  const limLabel = lim === 1 ? 'Limitada' : lim === 2 ? 'Semilimitada' : lim ? `máx ${lim}` : '';
  return '\nbanlist:' +
    (pts ? ` ${pts} pontos` : '') +
    (limLabel ? ` · ${limLabel}` : '') +
    (grp ? ` · grupo ${grp}` : '');
}

/**
 * Selos visuais da banlist na miniatura (mesma linguagem visual de
 * `web/banlist.html`): [L1]/[L2] em vermelho pro teto individual, pontos em
 * azul, e o número do grupo em AMARELO quando a carta está numa lista
 * compartilhada. Só aparece com a Lista 1 marcada — fora dela a banlist nem
 * se aplica.
 *
 * As miniaturas já têm CST (topo-esquerda) e raridade (topo-direita) — em
 * vez de arriscar sobrepor, `hasTopLeft`/`hasTopRight` empurram o selo da
 * banlist pra uma segunda linha quando o canto já está ocupado.
 */
function banlistBadges(id, { hasTopLeft = false, hasTopRight = false } = {}) {
  if (!$('f-lista1').checked || !banlist) return '';
  const pts = banlist.cardPoints[String(id)];
  const lim = banlist.cardLimits[String(id)];
  const grp = banlist.cardGroups[String(id)];
  if (!pts && !lim && !grp) return '';

  let html = '';
  let leftRow = hasTopLeft ? 1 : 0;   // canto esquerdo: limite, depois grupo (empilhados se os dois existirem)
  if (lim) {
    html += `<span class="bl-badge bl-limit" style="top:${2 + leftRow * 11}px">L${lim}</span>`;
    leftRow++;
  }
  if (grp) {
    html += `<span class="bl-badge bl-group" style="top:${2 + leftRow * 11}px">${grp}</span>`;
  }
  if (pts) {
    const rightRow = hasTopRight ? 1 : 0;
    html += `<span class="bl-badge bl-points" style="top:${2 + rightRow * 11}px">${pts}p</span>`;
  }
  return html;
}

/** O índice traz só id/nome/stats; para nome de carta no deck usamos o cache. */
const briefCache = new Map();
function brief(id) {
  if (!briefCache.has(id)) briefCache.set(id, db.brief(id));
  return briefCache.get(id);
}

/**
 * Estado de validade do deck: regras oficiais (`deck.js`, sempre) + banlist
 * (`web/js/banlist.js`, só quando a Lista 1 está marcada). Uma função só,
 * reaproveitada tanto pelo status visual (`renderDeck`) quanto pelo bloqueio
 * de salvar (`podeSalvar`) — o mesmo texto que aparece na tela é o motivo
 * que impede o "salvar", nunca dois cálculos divergentes.
 *
 * `ignoreBanlist` é a liberdade do modo NPC (checkbox "ignorar banlist") —
 * as regras de CONSTRUÇÃO (min/max, 3 cópias) nunca são puladas, nem lá.
 */
function deckStatus({ ignoreBanlist = false } = {}) {
  const v = deck.validate();
  const bl = ($('f-lista1').checked && !ignoreBanlist)
    ? validateBanlist(deck, banlist) : { ok: true, problems: [] };

  if (!v.valid) {
    return { ok: false, message: v.errors[0], color: 'var(--dim)' };
  }
  if (!bl.ok) {
    const p = bl.problems[0];
    const message = p.type === 'points'
      ? `banlist: ${p.spent}/${p.budget} pontos — estourou o orçamento`
      : p.type === 'limit'
      ? `banlist: ${brief(p.card)?.name ?? p.card} tem ${p.count} cópias (máximo ${p.limit})`
      : `banlist: grupo ${p.group} com ${p.count} cópias (máximo ${p.group})`;
    return { ok: false, message, color: 'var(--red)' };
  }
  return {
    ok: true,
    message: `deck válido — Main ${deck.main.length}, Extra ${deck.extra.length}`,
    color: 'var(--green)',
  };
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
      el.title = `${c?.name ?? id}` + banlistTooltip(id) +
               `\nclique: +1 cópia · segurar: detalhes · arraste para o pool: remover`;
      el.innerHTML = banlistBadges(id) +
                     `<img loading="lazy" src="${ART(id)}" alt="" draggable="false">` +
                     (count > 1 ? `<span class="count">×${count}</span>` : '');

      // Segurar abre a janela de detalhes, igual ao pool.
      const segurou = wireLongPress(el, HOLD_MS, () => showDetail(id));

      // Clique ADICIONA. Remover é só arrastando de volta para o pool — assim
      // não dá para perder uma carta por engano num clique perdido.
      el.onclick = () => {
        if (segurou()) return;          // acabou de abrir o detalhe: não adiciona
        if (tryPickCover(id)) return;   // escolhendo moldura: não mexe no deck
        const cc = brief(id);
        if (cc) addCard(cc);
      };
      el.oncontextmenu = (e) => { e.preventDefault(); showDetail(id); };
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

  const st = deckStatus({ ignoreBanlist: npcMode && $('npc-ignore-banlist').checked });
  $('status').textContent = st.message;
  $('status').style.color = st.color;

  // Desabilita os botões de salvar em vez de só recusar no clique — o
  // usuário vê ANTES de tentar que o deck não bate com as regras.
  const motivo = st.ok ? '' : `não é possível salvar: ${st.message}`;
  $('btn-save').disabled = !st.ok;
  $('btn-save').title = motivo;
  $('btn-project').disabled = !st.ok;
  $('btn-project').title = motivo;
  if (npcMode) {
    // "salvar p/ mim" vira deck do JOGADOR — checa sem a liberdade de ignorar banlist do NPC.
    const stStrict = deckStatus({ ignoreBanlist: false });
    $('npc-copy').disabled = !stStrict.ok;
    $('npc-copy').title = stStrict.ok ? '' : `não é possível salvar: ${stStrict.message}`;
  }
}

// ---------------------------------------------------------------- render pool

let poolResults = [];

function renderPool() {
  const frag = document.createDocumentFragment();
  for (const c of poolResults.slice(0, MAX_RENDER)) {
    const copies = deck.copies(c.id);
    const avail = availableCopies(c.id);       // quantas o jogador pode usar
    const full = copies >= avail;
    const rar = rarIdx.get(c.id)?.rarity;
    const el = document.createElement('div');
    el.className = 'thumb' + (full ? ' full' : '') + (c.custom ? ' custom' : '');
    el.draggable = !full;
    el.dataset.id = c.id;
    el.title = `${c.name}\n${c.tl}` +
      (rar ? `\nraridade: ${rar}` : '') +
      (ownedMode ? `\nvocê pode usar: ${avail}` : '') +
      (c.custom ? '\n(carta customizada — sem efeito em duelo)' : '') +
      banlistTooltip(c.id) +
      (full ? `\n(no limite: ${avail})` : '\nclique ou arraste para adicionar') +
      '\nsegurar: ver detalhes';
    el.innerHTML = (c.custom ? '<span class="badge">CST</span>' : '') +
                   (rar ? `<span class="rarity ${rar}">${rar}</span>` : '') +
                   // no modo Coleção, mostra QUANTAS o jogador tem disponíveis (×N)
                   (ownedMode ? `<span class="avail">×${avail}</span>` : '') +
                   banlistBadges(c.id, { hasTopLeft: c.custom, hasTopRight: !!rar }) +
                   `<img loading="lazy" src="${ART(c.id)}" alt="" draggable="false">` +
                   (copies ? `<span class="count">${copies}</span>` : '');

    // Segurar abre os detalhes. Antes isso era no passar do mouse, o que fazia o
    // painel aparecer sozinho enquanto se procurava carta — mais atrapalhava.
    const segurou = wireLongPress(el, HOLD_MS, () => showDetail(c.id));

    el.onclick = () => {
      if (segurou()) return;            // acabou de abrir o detalhe: não adiciona
      if (tryPickCover(c.id)) return;   // escolhendo moldura: não adiciona
      addCard(c);
    };
    el.oncontextmenu = (e) => { e.preventDefault(); showDetail(c.id); };
    if (!full) wireDragSource(el, c.id, 'pool');
    frag.append(el);
  }
  $('pool-grid').replaceChildren(frag);
  $('pool-count').textContent = poolResults.length > MAX_RENDER
    ? `${poolResults.length} cartas (mostrando ${MAX_RENDER})`
    : `${poolResults.length} carta${poolResults.length === 1 ? '' : 's'}`;
}

function addCard(c) {
  // Na Coleção, o teto por carta vem da raridade × cópias possuídas.
  const lim = availableCopies(c.id);
  if (deck.copies(c.id) >= lim) {
    return void toast(ownedMode && lim === 0
      ? `você não possui "${c.name}"`
      : `limite: ${lim} cópia${lim === 1 ? '' : 's'} de "${c.name}"`);
  }
  const r = deck.add(c);
  if (!r.ok) return void toast(r.reason);
  markDirty();
  refresh();
  toast(`+ ${c.name} → ${r.zone === 'extra' ? 'Extra' : 'Main'}`);
}

function refresh() {
  renderDeck();
  renderPool();   // recalcula os contadores nas miniaturas do pool
  if (npcMode) { updateNpcDrop(); renderCover(); }
}

// ---------------------------------------------------------------- modo NPC

/** Ajusta a UI para editar um deck de um NPC. */
function enterNpcModeUI() {
  $('npc-bar').hidden = false;
  $('npc-name').textContent = npcMode.name;
  // o campo de nome passa a ser o nome DESTE deck do NPC (editável).
  // 'btn-project' sai porque no modo NPC o próprio salvar já grava em decks/npc/.
  for (const id of ['deck-select', 'btn-new', 'btn-delete', 'btn-project']) $(id).hidden = true;
  const cover = $('npc-cover');
  cover.onclick = () => (pickingCover ? cancelPickCover() : startPickCover());
  cover.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cover.onclick(); }
  };
  renderCover();

  $('npc-back').onclick = () => {
    if (confirmDiscard()) location.href = '/web/npcs.html';
  };
  // salva o deck atual do NPC como um deck SEU (ex.: "joey 1"). Vira deck do
  // JOGADOR — o "ignorar banlist" do NPC não viaja junto, checa sem essa liberdade.
  $('npc-copy').onclick = () => {
    const st = deckStatus({ ignoreBanlist: false });
    if (!st.ok) return void toast(`não é possível salvar: ${st.message}`);
    const n = (npcDeckIndex ?? 0) + 1;
    const name = `${npcMode.id} ${n}`;
    saveDeck(new Deck({ name, main: deck.main, extra: deck.extra }), null);
    toast(`salvo nos seus decks como "${name}"`);
  };
}

/** Popula o select "carta que dropa" com as cartas do deck montado. */
function updateNpcDrop() {
  const sel = $('npc-drop');
  const prev = Number(sel.value) || npcSignature;
  const uniq = [...new Set([...deck.main, ...deck.extra])];
  if (!uniq.length) {
    sel.replaceChildren(new Option('(deck vazio)', ''));
    return;
  }
  sel.replaceChildren(...uniq.map((id) => new Option(brief(id)?.name ?? String(id), String(id))));
  sel.value = uniq.includes(prev) ? String(prev) : String(uniq[0]);
}

/* ---------------------------------------------------------------- moldura
 * A "moldura" é a carta que ilustra o deck na lista de NPCs. É só visual —
 * quem define a recompensa continua sendo a "carta que dropa".
 */

/** Desenha o quadrinho da moldura com a arte atual. */
function renderCover() {
  const el = $('npc-cover');
  if (!el) return;
  const id = npcCover || npcSignature;
  el.style.backgroundImage = id ? `url("${ART(id, false)}")` : '';
  el.classList.toggle('empty', !id);
  el.classList.toggle('picking', pickingCover);
  const nome = id ? (brief(id)?.name ?? id) : 'nenhuma';
  el.title = pickingCover
    ? 'agora clique numa carta (Esc cancela)'
    : `moldura: ${nome} — clique para trocar`;
}

function startPickCover() {
  pickingCover = true;
  document.body.classList.add('picking-cover');
  renderCover();
  toast('escolha a carta que vai ilustrar o deck (Esc cancela)');
}

function cancelPickCover() {
  if (!pickingCover) return;
  pickingCover = false;
  document.body.classList.remove('picking-cover');
  renderCover();
}

/** Consome o clique quando estamos escolhendo a moldura. */
function tryPickCover(id) {
  if (!pickingCover) return false;
  npcCover = Number(id);
  cancelPickCover();
  markDirty();
  toast(`moldura: ${brief(npcCover)?.name ?? npcCover}`);
  return true;
}

async function saveNpcDeckFromUI() {
  const st = deckStatus({ ignoreBanlist: $('npc-ignore-banlist').checked });
  if (!st.ok) return void toast(`não é possível salvar: ${st.message}`);

  const sig = Number($('npc-drop').value) || npcSignature;
  const name = $('deck-name').value.trim() || `Deck ${npcMode.name}`;
  // Prêmio em DP por vencer este deck. Campo vazio = padrão; 0 é válido.
  const rw = $('npc-reward').value;
  const rewardDp = rw === '' ? undefined : Math.max(0, Number(rw) || 0);

  const r = await saveNpcDeckAt(npcMode.id, npcDeckIndex, {
    name, deck, signatureId: sig, coverId: npcCover || sig, rewardDp,
  });
  if (r.index < 0) return void toast(r.error ?? 'falha ao salvar');
  npcDeckIndex = r.index;
  npcSignature = sig;
  markDirty(false);

  if (r.path) {
    toast(`salvo em decks/${r.path}`);
  } else if (r.downloaded) {
    // Sem servidor de desenvolvimento não dá para escrever no projeto; o .ydk
    // foi baixado e precisa ser colocado em decks/ na mão.
    toast('servidor fora do ar — .ydk baixado, mova para decks/npc/');
  } else {
    toast('salvo');
  }
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

// Passou a ser a mesma janela do navegador de cartas (web/js/carddetail.js).
// O painelzinho flutuante que existia aqui mostrava menos e abria sozinho no
// passar do mouse.
const showDetail = (id) => showCardDetail(id);

// ---------------------------------------------------------------- filtros

/**
 * Resolve o filtro de tipo dos 3 selects (só 1 fica ativo por vez).
 * `sub` null = a categoria inteira (opção "todos"); string = uma variação.
 */
function activeTypeFilter() {
  const mon = $('f-mon').value, sp = $('f-spell').value, tr = $('f-trap').value;
  if (mon) return { cardType: 'Monster', sub: mon === '*' ? null : mon };
  if (sp) return { cardType: 'Spell', sub: sp === '*' ? null : sp };
  if (tr) return { cardType: 'Trap', sub: tr === '*' ? null : tr };
  return { cardType: undefined, sub: null };
}

/** A carta bate com a variação escolhida? (deriva do typeLabel). */
function matchesSub(c, cardType, sub) {
  const tl = c.tl || '';
  if (cardType === 'Monster') {
    if (sub === 'Normal') return /Normal/.test(tl);
    // "Efeito" = monstro de efeito do Main (exclui Ritual/Extra Deck)
    if (sub === 'Effect') return /Effect/.test(tl) && !/Ritual|Fusion|Synchro|Xyz|Link/.test(tl);
    return new RegExp(sub).test(tl); // Ritual/Fusion/Synchro/Xyz/Link/Pendulum
  }
  return tl.startsWith(sub); // "Continuous Spell", "Counter Trap", "Field Spell"...
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
  });
  if (sub) poolResults = poolResults.filter((c) => matchesSub(c, cardType, sub));
  // ATK/DEF EXATOS (cada um opcional): combina entre si e com o nível. Ex.: nível
  // 4 + DEF 2000 traz todos os 4 com 2000 de defesa; + ATK 800 afunila p/ 800/2000.
  const atk = num('f-atk');
  if (atk != null) poolResults = poolResults.filter((c) => c.atk === atk);
  const def = num('f-def');
  if (def != null) poolResults = poolResults.filter((c) => c.def === def);
  // Filtro por tag: customizadas trazem tags próprias; boosters injetam
  // nome+raridade nas entradas do índice (annotateDb).
  const tag = $('f-tag').value;
  if (tag) poolResults = poolResults.filter((c) => (c.tags ?? []).includes(tag));
  // Raridade (dos boosters): filtra pela raridade explícita atribuída num booster.
  // Carta fora de qualquer booster não tem raridade e some com qualquer filtro aqui.
  const rar = $('f-rar').value;
  if (rar) poolResults = poolResults.filter((c) => rarIdx.get(c.id)?.rarity === rar);
  // Banlist (web/banlist.html): acha as cartas que já têm regra atribuída.
  const bl = $('f-banlist').value;
  if (bl === 'limit1') poolResults = poolResults.filter((c) => banlist.cardLimits[String(c.id)] === 1);
  else if (bl === 'limit2') poolResults = poolResults.filter((c) => banlist.cardLimits[String(c.id)] === 2);
  else if (bl === 'points') poolResults = poolResults.filter((c) => (banlist.cardPoints[String(c.id)] ?? 0) > 0);
  else if (bl === 'group') poolResults = poolResults.filter((c) => (banlist.cardGroups[String(c.id)] ?? 0) > 0);
  // Lista 1: restringe ao pool jogável desta fase.
  if ($('f-lista1').checked) poolResults = poolResults.filter(inLista1);
  // Coleção: no Deck Builder "real", só o que o jogador possui.
  if (ownedMode) poolResults = poolResults.filter((c) => ownsCard(c.id));
  poolResults = sortPool(poolResults, $('f-sort').value);
  renderPool();
}

/**
 * Ordena por ATK/DEF/nível. O sufixo `-asc` é crescente (menor primeiro); sem
 * ele, decrescente (maior primeiro). Cartas sem o valor vão sempre para o fim,
 * independente da direção.
 */
function sortPool(list, key) {
  if (!key) return list;
  const asc = key.endsWith('-asc');
  const field = key.replace('-asc', '');
  const val = (c) => (field === 'atk' ? c.atk : field === 'def' ? c.def : c.lv);
  return [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return asc ? va - vb : vb - va;
  });
}

/** Reconstrói o select de tags a partir das cartas customizadas em memória. */
function refreshTagSelect() {
  const tags = new Set(allBoosterTags());   // nomes de boosters + raridades
  for (const c of listCustom()) for (const t of (c.tags ?? [])) tags.add(t);
  const sel = $('f-tag');
  const current = sel.value;
  sel.replaceChildren(new Option('tag: todas', ''));
  for (const t of [...tags].sort()) sel.append(new Option(t, t));
  sel.value = [...sel.options].some((o) => o.value === current) ? current : '';
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
  if (npcMode) return void saveNpcDeckFromUI();
  const st = deckStatus();   // fora do modo NPC, ignoreBanlist é sempre false
  if (!st.ok) return void toast(`não é possível salvar: ${st.message}`);
  deck.name = $('deck-name').value.trim() || 'Novo Deck';
  deckIndex = saveDeck(deck, deckIndex);
  setActiveIndex(deckIndex);
  markDirty(false);
  refreshDeckSelect();
  toast('deck salvo');
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

// Grava o deck em decks/player/ — diferente de "salvar", que é localStorage e
// fica preso a este navegador. O que vai para o projeto viaja no git.
$('btn-project').onclick = async () => {
  const st = deckStatus();   // este botão só existe fora do modo NPC
  if (!st.ok) return void toast(`não é possível salvar: ${st.message}`);
  deck.name = $('deck-name').value.trim() || 'deck';
  const path = playerDeckPath(deck.name);
  const r = await saveProjectDeck(path, deck, { updated: new Date().toISOString() });
  if (r.ok) {
    toast(`salvo em decks/${r.path} — dê commit para levar para outra máquina`);
  } else if (r.downloaded) {
    toast('servidor fora do ar — .ydk baixado, mova para decks/player/');
  } else {
    toast(`falhou: ${r.error}`);
  }
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

// Limpar deck: tira todas as cartas (Main + Extra), mas mantém o deck aberto.
$('btn-clear').onclick = () => {
  if (deck.size === 0) return void toast('o deck já está vazio');
  if (!confirm(`Remover todas as ${deck.size} cartas de "${deck.name}"?`)) return;
  deck.main = [];
  deck.extra = [];
  markDirty();
  refresh();
  toast('deck limpo');
};

$('deck-select').onchange = (e) => {
  if (e.target.value === '') return;
  if (!confirmDiscard()) return void refreshDeckSelect();
  loadDeck(Number(e.target.value));
};

$('deck-name').oninput = () => markDirty();
$('npc-reward').oninput = () => markDirty();

const TYPE_IDS = ['f-mon', 'f-spell', 'f-trap'];
const FILTER_IDS = ['f-name', 'f-attr', 'f-race', 'f-arch', 'f-tag', 'f-rar', 'f-banlist', 'f-sort',
                    'f-lvmin', 'f-lvmax', 'f-atk', 'f-def'];
for (const id of [...FILTER_IDS, 'f-lista1']) $(id).addEventListener('input', applyFilters);
// A banlist só vale com a Lista 1 ligada — ligar/desligar o filtro muda o
// status de validade do deck sem tocar em nenhuma carta, então precisa
// recalcular o status mesmo sem passar por `refresh()`. O mesmo vale pro
// "ignorar banlist" do modo NPC.
$('f-lista1').addEventListener('input', renderDeck);
$('npc-ignore-banlist').addEventListener('input', renderDeck);

// os 3 selects de tipo são mutuamente exclusivos: ativar um zera os outros
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

// ---------------------------------------------------------------- importar carta

// Estado do import. `importRawArt` = o desenho cru (para a moldura automática);
// `importFrame` = imagem renderizada que o usuário subiu (tem prioridade).
let importRawArt = null;
let importFrame = null;
let previewTimer = null;

const fillSelect = (sel, values) =>
  sel.replaceChildren(...values.map((v) => new Option(v, v)));

// selects estáticos do formulário, populados uma vez
fillSelect($('im-kind'), MONSTER_KINDS);
fillSelect($('im-sub'), SUBTYPES);
fillSelect($('im-attr'), ATTRIBUTES);
$('race-list').replaceChildren(...RACES.map((r) => new Option(r)));

/** Mostra/esconde os campos conforme a categoria (monstro × magia/armadilha). */
function syncImportFields() {
  const monster = $('im-cat').value === 'Monster';
  for (const id of ['wrap-kind', 'wrap-attr', 'wrap-race', 'wrap-level', 'wrap-atk', 'wrap-def'])
    $(id).hidden = !monster;
  $('wrap-sub').hidden = monster;
  if (monster) $('wrap-def').hidden = $('im-kind').value === 'Link'; // Link não tem DEF
}
$('im-cat').addEventListener('change', syncImportFields);
$('im-kind').addEventListener('change', syncImportFields);

function openImportModal(draft, missing) {
  $('im-name').value = draft.name || '';
  $('im-cat').value = draft.cat;
  $('im-kind').value = draft.kind || 'Effect';
  $('im-sub').value = draft.subtype || 'Normal';
  $('im-attr').value = draft.attribute || 'DARK';
  $('im-race').value = draft.race || '';
  $('im-level').value = draft.level == null ? '' : draft.level;
  $('im-atk').value = draft.atk == null ? '' : draft.atk;
  $('im-def').value = draft.def == null ? '' : draft.def;
  $('im-desc').value = draft.desc || '';
  $('im-tags').value = (draft.tags || ['custom', 'sem-efeito']).join(', ');
  $('im-level').classList.toggle('miss', missing.includes('level'));
  $('im-err').textContent = missing.includes('level')
    ? 'O card maker não guarda o nível — preencha antes de salvar.'
    : '';
  syncImportFields();
  updateFrameStatus();
  updateArtPreview();
  $('import-back').classList.add('show');
}

function closeImportModal() {
  $('import-back').classList.remove('show');
  importArt = null;
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

const pickFile = (accept) => new Promise((resolve) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => resolve(input.files?.[0] ?? null);
  input.click();
});

/** Lê os campos atuais do formulário (para desenhar a moldura automática). */
function readImportFields() {
  return {
    name: $('im-name').value.trim(),
    cat: $('im-cat').value,
    kind: $('im-kind').value,
    subtype: $('im-sub').value,
    attribute: $('im-attr').value,
    race: $('im-race').value.trim(),
    level: $('im-level').value,
    atk: Number($('im-atk').value || 0),
    def: Number($('im-def').value || 0),
    desc: $('im-desc').value.trim(),
  };
}

function updateFrameStatus() {
  $('im-frame-auto').hidden = !importFrame;
  $('im-frame-status').textContent = importFrame
    ? 'usando a imagem enviada'
    : 'moldura automática (pelo tipo)';
}

/** Atualiza a prévia: imagem enviada, ou a moldura automática desenhada. */
async function updateArtPreview() {
  const box = $('im-art');
  const src = importFrame || await renderFramedCard(readImportFields(), importRawArt);
  box.replaceChildren(Object.assign(new Image(), { src, alt: '' }));
}

/** Re-renderiza a moldura automática (com debounce) enquanto se edita o form. */
const schedulePreview = () => {
  if (importFrame) return;   // imagem enviada não depende dos campos
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updateArtPreview, 180);
};

async function setFrameFromFile(file) {
  $('im-art').textContent = 'reduzindo imagem…';
  try {
    importFrame = await downscaleDataUrl(await fileToDataUrl(file));
  } catch {
    importFrame = null;
    toast('não consegui processar essa imagem');
  }
  updateFrameStatus();
  updateArtPreview();
}

/** Rascunho em branco para quando se importa só uma imagem, sem .json. */
function blankDraft() {
  return {
    name: '', cat: 'Monster', kind: 'Effect', subtype: 'Normal',
    attribute: 'DARK', race: '', level: null, atk: 0, def: 0,
    desc: '', tags: ['custom', 'sem-efeito'],
  };
}

async function handleImportFile(file) {
  const isJson = /\.json$/i.test(file.name) || file.type.includes('json');
  importRawArt = null;
  importFrame = null;

  if (isJson) {
    let json;
    try { json = JSON.parse(await file.text()); }
    catch { return void toast('arquivo .json inválido'); }
    const { draft, missing, art } = parseCardmaker(json);
    importRawArt = art;   // o desenho cru alimenta a moldura automática
    openImportModal(draft, missing);
    return;
  }

  if (file.type.startsWith('image/')) {   // imagem renderizada, já com moldura
    importFrame = await downscaleDataUrl(await fileToDataUrl(file));
    openImportModal(blankDraft(), ['name', 'level', 'race']);
    return;
  }

  toast('formato não reconhecido (use .json ou uma imagem)');
}

$('f-import').onclick = async () => {
  const f = await pickFile('.json,application/json,image/*');
  if (f) handleImportFile(f);
};

$('im-frame-pick').onclick = async () => {
  const f = await pickFile('image/*');
  if (f) setFrameFromFile(f);
};
$('im-art').onclick = $('im-frame-pick').onclick;   // clicar na prévia = subir moldura

$('im-frame-auto').onclick = () => {
  importFrame = null;
  updateFrameStatus();
  updateArtPreview();
};

for (const id of ['im-name', 'im-cat', 'im-kind', 'im-sub', 'im-attr', 'im-race',
                  'im-level', 'im-atk', 'im-def', 'im-desc']) {
  $(id).addEventListener('input', schedulePreview);
}

$('im-cancel').onclick = closeImportModal;
$('import-back').addEventListener('click', (e) => {
  if (e.target === $('import-back')) closeImportModal();
});

$('im-save').onclick = async () => {
  const cat = $('im-cat').value;
  const err = $('im-err');
  const fields = { ...readImportFields(), tags: $('im-tags').value };

  if (!fields.name) return void (err.textContent = 'Dê um nome à carta.');
  if (cat === 'Monster') {
    if (fields.level === '') {
      $('im-level').classList.add('miss');
      return void (err.textContent = 'Informe o nível do monstro (falta no .json).');
    }
    if (!fields.race) return void (err.textContent = 'Informe a raça do monstro.');
  }

  // Moldura: a imagem enviada tem prioridade; senão, desenha a automática.
  const finalArt = importFrame || await renderFramedCard(fields, importRawArt);
  const saved = saveCustom(buildCard(fields, finalArt));
  injectCustom(saved);
  refreshTagSelect();
  applyFilters();
  refresh();
  closeImportModal();
  const zone = cat === 'Monster' && isExtraKind(fields.kind) ? 'Extra' : 'pool';
  toast(`carta "${saved.name}" adicionada${zone === 'Extra' ? ' (Extra)' : ' ao pool'}`);
};

// A janela de detalhes é um <dialog>: fecha sozinha no Esc e no clique fora.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancelPickCover();   // sai do modo de escolher moldura
});

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

// A janela de detalhes usa o índice já carregado e sabe pedir a arte/texto das
// cartas customizadas, que não existem no cards.json.
injectHoldStyles(HOLD_MS);
configureCardDetail({
  db,
  artOf: (id) => customArt.get(Number(id)),
  descOf: (id) => customDesc.get(Number(id)),
});

// injeta as cartas customizadas salvas (localStorage) antes de tudo que usa
// o índice — assim elas aparecem no pool e nos decks que já as referenciam.
// Boosters + carteira do projeto (store/*.json) antes de ler raridade/coleção.
await hydrateBoosters();
await hydrateWallet();
await hydrateCustomNpcs();   // adversários criados na Área de Teste (outra máquina inclusive)
await hydrateBanlist();
banlist = getBanlist();

for (const c of listCustom()) injectCustom(c);
// Marca as cartas com a raridade/booster salvos (tags + selo).
annotateDb(db);
rarIdx = rarityIndex();
briefCache.clear();
refreshTagSelect();

// popula os selects a partir dos dados reais
const all = db.filter({});
const uniq = (fn) => [...new Set(all.map(fn).filter(Boolean))].sort();
$('f-attr').append(...uniq((c) => c.at).map((v) => new Option(v, v)));
$('f-race').append(...uniq((c) => c.r).map((v) => new Option(v, v)));
$('f-arch').append(...uniq((c) => c.a[0]).map((v) => new Option(v, v)));

// modo NPC (?npc=<id>&deck=<i|new>) tem prioridade sobre os decks do jogador
const params = new URLSearchParams(location.search);
const npcId = params.get('npc');
const npc = npcId ? getNpc(npcId) : null;
if (npc) {
  npcMode = npc;
  // Os decks dos NPCs vivem em arquivos (decks/npc/), então precisam ser
  // carregados do disco antes de qualquer leitura do estado.
  await loadNpcDecks();
  const st = getNpcState(npcId);
  const deckParam = params.get('deck');
  // qual deck: índice explícito, 'new', ou o ativo (novo se o NPC não tem nenhum)
  if (deckParam === 'new') npcDeckIndex = null;
  else if (deckParam !== null && deckParam !== '') npcDeckIndex = Number(deckParam);
  else npcDeckIndex = st.decks.length ? st.activeIndex : null;

  const slot = npcDeckIndex == null ? null : getNpcDeckAt(npcId, npcDeckIndex);
  deck = slot ? slot.deck : new Deck({ name: `Deck ${st.decks.length + 1}` });
  deckIndex = null;
  npcSignature = slot ? slot.signatureId : npc.signatureId;
  npcCover = slot ? (slot.coverId ?? slot.signatureId) : npc.signatureId;
  $('deck-name').value = deck.name;
  // prêmio em DP do deck (deixa em branco = usa o padrão ao salvar)
  $('npc-reward').value = slot && Number.isFinite(Number(slot.rewardDp)) ? slot.rewardDp : '';
  enterNpcModeUI();
  markDirty(false);
} else {
  // carrega o deck pedido em `?deck=<i>` (o Inventário abre por aqui) ou o ativo
  const active = getActiveIndex();
  const saved = listDecks();
  const pedido = params.get('deck');
  const escolhido = pedido !== null && pedido !== '' && saved[Number(pedido)]
    ? Number(pedido)
    : (active !== null && saved[active] ? active : 0);
  if (saved.length) loadDeck(escolhido);
  else { $('deck-name').value = deck.name; refreshDeckSelect(); }
}

// No Deck Builder "real" (Coleção), deixa claro o modo e some com o "＋ carta"
// (criar carta é coisa da Área de Teste, não do fluxo do jogador).
if (ownedMode && !npcMode) {
  const h1 = document.querySelector('.topbar h1');
  if (h1) h1.textContent = '▚ DECK BUILDER — COLEÇÃO';
  const imp = $('f-import'); if (imp) imp.hidden = true;
}

applyFilters();
refresh();
