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
  downloadYdk, importYdk, hydrateDecks,
} from '/web/js/storage.js';
import {
  listCustom, saveCustom, parseCardmaker, buildCard, downscaleDataUrl,
  renderFramedCard, RACES, ATTRIBUTES, MONSTER_KINDS, SUBTYPES, isExtraKind,
} from '/web/js/customcards.js';
import {
  getNpc, getNpcState, getNpcDeckAt, getNpcDecks, saveNpcDeckAt, loadNpcDecks,
  hydrateCustomNpcs,
} from '/web/js/npcs.js';
import { inLista1 } from '/web/js/lista1.js';
import { hydrateCardLists } from '/web/js/cardlists.js';
import { montarAuto } from '/web/js/automontagem.js';
import { hydrateBanlist, getBanlist, validateBanlist } from '/web/js/banlist.js';
import { annotateDb, allBoosterTags, rarityIndex, hydrateBoosters, reprintsOf } from '/web/js/boosters.js';
import {
  carregarDrops, salvarDrops, dropsDoDeck, chancesDe, totalDoPool, poolVazio,
  RARIDADES, MAX_DROPS, planoRapido,
} from '/web/js/drops.js';
import { ownsCard, ownedCount, hydrateWallet } from '/web/js/wallet.js';
import { requireLogin } from '/web/js/auth.js';
import { perfilAtual } from '/web/js/supabase.js';
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
// ---------------------------------------------------------------- pool de drop
// As cartas que ESTE DECK do adversário pode largar ao ser derrotado, por
// raridade, e quantas ele larga por vitória. Não é parte do deck: mora em
// `conteudo/npc-drops`, hoje por DECK (`decks[<nome>]`, com o pool do NPC como
// reserva), e quem sorteia é o servidor.
let dropsCfg = {};              // a configuração de TODOS os NPCs (é uma chave só)
let dropPool = poolVazio();     // a do DECK aberto aqui
let dropQtd = 0;
// Sob qual nome o pool foi CARREGADO. Renomear o deck e salvar precisa mover o
// pool de chave; sem isto ele ficaria órfão na chave antiga e o deck renomeado
// nasceria sem drop.
let nomeDoDropAntigo = null;
// Qual QUADRO de raridade está aberto. O quadro aberto é o alvo do clique nas
// cartas do pool da direita — é o que dá um caminho que não depende de arrastar.
let dropAberto = null;
// Qual aba da coluna da esquerda está à vista: 'deck' ou 'drops'.
let abaAtual = 'deck';

// Modo Coleção (?owned=1): o pool mostra só as cartas que o jogador POSSUI —
// é o Deck Builder "real". Sem a flag (Área de Teste), o pool é o banco inteiro.
let ownedMode = new URLSearchParams(location.search).get('owned') === '1';

// Raridade das cartas (dos boosters). Estável durante a sessão do builder, então
// calculo uma vez no boot.
let rarIdx = new Map();

/**
 * Gravar no banco SEM a conferência de Coleção (`p_livre` de `salvar_deck`).
 * Só liga na Área de Teste (fora do modo Coleção e fora do modo NPC) e só
 * para admin — é a mesma trava do "+ creditar DP" da `teste.html`: quem
 * recusa de verdade é o servidor, isto aqui só evita pedir o que seria
 * negado. Sem ele, o deck montado com o banco inteiro nunca chegava ao
 * banco: ficava só no localStorage, e o alerta era "cartas que você não
 * possui" — num builder que existe justamente para ignorar a Coleção.
 */
let gravarLivre = false;

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
    const paraDrop = abaAtual === 'drops' && !!dropAberto;   // clique alimenta o pool de drop
    const el = document.createElement('div');
    el.className = 'thumb' + (full ? ' full' : '') + (c.custom ? ' custom' : '');
    // No modo NPC a carta arrasta MESMO no limite de cópias: o destino pode ser
    // um quadro do pool de drop, que não tem nada a ver com quantas cópias o
    // deck já tem. Era exatamente isto que travava o gesto — as cartas de que o
    // adversário joga 3, as que mais se quer dar de prêmio, nasciam sem
    // `draggable` e nenhum aviso dizia por quê.
    el.draggable = !full || !!npcMode;
    el.dataset.id = c.id;
    el.title = `${c.name}\n${c.tl}` +
      (rar ? `\nraridade: ${rar}` : '') +
      (ownedMode ? `\nvocê pode usar: ${avail}` : '') +
      (c.custom ? '\n(carta customizada — sem efeito em duelo)' : '') +
      banlistTooltip(c.id) +
      (paraDrop
        ? `\nclique: mandar para o quadro ${dropAberto} do pool de drop`
        : (full ? `\n(no limite: ${avail})` : '\nclique ou arraste para adicionar')) +
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
      // Com a aba DROPS aberta, o clique alimenta o quadro aberto. É o caminho
      // que não depende de arrastar — e o arrasto continua valendo do mesmo jeito.
      if (paraDrop) return void porNoQuadro(c.id, dropAberto);
      addCard(c);
    };
    el.oncontextmenu = (e) => { e.preventDefault(); showDetail(c.id); };
    if (el.draggable) wireDragSource(el, c.id, 'pool');
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
  if (npcMode) { renderDropPool(); renderCover(); }
}

// ---------------------------------------------------------------- modo NPC

/** Ajusta a UI para editar um deck de um NPC. */
function enterNpcModeUI() {
  $('npc-bar').hidden = false;
  $('deck-tabs').hidden = false;
  $('tab-deck').onclick = () => mostrarAba('deck');
  $('tab-drops').onclick = () => mostrarAba('drops');
  $('drop-rapido').onclick = definirRapido;
  // Abre o quadro que já tem carta; sem nenhuma, o primeiro. Um quadro aberto
  // desde o começo é o que faz o clique no pool da direita ter para onde ir.
  dropAberto = RARIDADES.find((r) => dropPool[r].length) ?? RARIDADES[0];
  $('npc-name').textContent = npcMode.name;
  // o campo de nome passa a ser o nome DESTE deck do NPC (editável).
  for (const id of ['deck-select', 'btn-new', 'btn-delete']) $(id).hidden = true;
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
    // Copiar o deck de um NPC costuma trazer cartas que você NÃO possui — é o
    // caso mais provável de o servidor recusar, e o mais confuso se calar.
    saveDeck(new Deck({ name, main: deck.main, extra: deck.extra }), null, (erro) =>
      alert(`"${name}" ficou salvo só neste navegador.\n\n${erro}\n\n`
          + 'Decks de NPC costumam ter cartas que você ainda não abriu.'));
    toast(`salvo nos seus decks como "${name}"`);
  };
}

/** Troca a aba da coluna da esquerda ('deck' | 'drops'). */
function mostrarAba(qual) {
  abaAtual = qual;
  $('aba-deck').hidden = qual !== 'deck';
  $('aba-drops').hidden = qual !== 'drops';
  $('tab-deck').classList.toggle('is-on', qual === 'deck');
  $('tab-drops').classList.toggle('is-on', qual === 'drops');
  // O clique numa carta do pool da direita muda de significado com a aba, então
  // as miniaturas precisam ser redesenhadas (título e cursor).
  renderPool();
  atualizaAlvoDeClique();
}

/** Liga/desliga o cursor que avisa que o clique alimenta o pool de drop. */
function atualizaAlvoDeClique() {
  document.body.classList.toggle('drop-alvo', abaAtual === 'drops' && !!dropAberto);
}

/**
 * A raridade que os BOOSTERS dão para esta carta — a mesma fonte que a Loja usa
 * (`rarityIndex`, e no servidor `raridade_da_carta`). Carta que não está em
 * booster nenhum é N.
 *
 * Aqui ela é só uma SUGESTÃO: ao arrastar, o quadro correspondente se destaca.
 * Quem manda é o quadro em que a carta foi solta, porque é a gaveta gravada que
 * o servidor lê no sorteio (`premiar_vitoria`) — o mesmo adversário pode querer
 * largar uma Normal como prêmio raro, e o contrário também.
 */
const raridadeDe = (id) => reprintsOf(Number(id))?.rarity ?? 'N';

/** Em qual quadro esta carta está, ou `null`. */
function raridadeNoPool(id) {
  id = Number(id);
  return RARIDADES.find((r) => dropPool[r].includes(id)) ?? null;
}

/**
 * Põe a carta no quadro `rar`. Já estando em OUTRO quadro, é uma troca de
 * raridade (arrastar de um quadro para o outro), não uma segunda cópia: a mesma
 * carta em duas gavetas viciaria a chance dela.
 */
function porNoQuadro(id, rar) {
  id = Number(id);
  if (!id || !RARIDADES.includes(rar)) return;
  const nome = brief(id)?.name ?? id;
  const atual = raridadeNoPool(id);
  if (atual === rar) return void toast(`"${nome}" ja' esta' no quadro ${rar}`);
  if (atual) tiraDoDropPool(id);
  const eraVazio = !totalDoPool(dropPool);
  dropPool[rar].push(id);
  dropAberto = rar;

  // A PRIMEIRA carta liga a quantidade. Sem isto, montar o pool inteiro e
  // salvar não guardava NADA: a configuração de um NPC com quantidade 0 é
  // descartada de propósito (é o mesmo que "não tem drop"), e a tela nem
  // avisava. Um pool com carta e nenhuma vitória dando carta é sempre engano.
  if (eraVazio && dropQtd <= 0) {
    dropQtd = 1;
    $('npc-drop-qtd').value = '1';
    toast('quantidade por vitoria: 1 (mude no campo acima se quiser mais)');
  }

  markDirty();
  renderDropPool();
  toast(atual ? `${nome}: ${atual} -> ${rar}` : `+ ${nome} -> ${rar}`);
}

/**
 * **[definir rápido]** — enche o pool com as cartas DESTE deck que já têm
 * raridade, cada uma na gaveta dela.
 *
 * O pool de drop quase sempre quer as cartas do próprio deck: é o prêmio que
 * faz sentido para quem acabou de enfrentá-lo. Montar isso à mão é clicar carta
 * por carta num deck de 40 a 60.
 *
 * A regra mora em `planoRapido` (drops.js), com teste, porque cada uma das
 * decisões dela erra em silêncio — carta sem raridade ficando de fora, a carta
 * já posta à mão numa gaveta diferente não sendo mexida, e a cópia repetida
 * contando uma vez só. Aqui fica só o que é da TELA: a raridade vem dos
 * boosters e o relato diz o que entrou E o que ficou de fora, que é a metade
 * que ninguém confere carta por carta depois.
 */
function definirRapido() {
  // O índice UMA vez: `rarityOf` reconstrói o mapa de todos os boosters a cada
  // chamada, e aqui são dezenas de cartas.
  const idx = rarityIndex();
  const plano = planoRapido(
    [...deck.main, ...deck.extra], dropPool,
    (id) => idx.get(Number(id))?.rarity ?? null,
  );

  if (!plano.total) {
    return void toast(plano.semRaridade.length
      ? `nenhuma carta nova: as ${plano.semRaridade.length} de fora nao estao em booster nenhum`
      : 'nenhuma carta nova para o pool — o deck ja esta todo nos quadros');
  }

  for (const r of RARIDADES) dropPool[r].push(...plano.novas[r]);

  // A MESMA regra da carta posta à mão (`porNoQuadro`): pool com carta e
  // quantidade 0 é descartado na hora de salvar, e a tela não avisava.
  if (dropQtd <= 0) {
    dropQtd = 1;
    $('npc-drop-qtd').value = '1';
  }

  // Abre a gaveta mais alta que ganhou carta: é onde estão as que o admin mais
  // provavelmente quer conferir.
  dropAberto = RARIDADES.find((r) => plano.novas[r].length) ?? dropAberto;

  markDirty();
  renderDropPool();

  const porGaveta = RARIDADES
    .filter((r) => plano.novas[r].length)
    .map((r) => `${plano.novas[r].length} ${r}`)
    .join(', ');
  const sobras = [];
  if (plano.jaNoPool.length) sobras.push(`${plano.jaNoPool.length} ja estava(m) no pool`);
  if (plano.semRaridade.length) sobras.push(`${plano.semRaridade.length} sem raridade`);
  toast(`+ ${plano.total} carta(s): ${porGaveta}`
      + (sobras.length ? ` — de fora: ${sobras.join(', ')}` : ''));
}


function tiraDoDropPool(id) {
  id = Number(id);
  for (const r of RARIDADES) dropPool[r] = dropPool[r].filter((c) => c !== id);
}

/**
 * Desenha os quatro QUADROS de raridade. Cada um é o seu próprio alvo de
 * arrasto (aberto ou fechado) e, quando aberto, o alvo do clique nas cartas do
 * pool da direita. A % ao lado é a chance real daquele quadro.
 */
function renderDropPool() {
  const caixa = $('drop-buckets');
  if (!caixa) return;
  const chances = chancesDe(dropPool);
  const total = totalDoPool(dropPool);
  const frag = document.createDocumentFragment();

  for (const r of RARIDADES) {
    const ids = dropPool[r];
    const aberto = dropAberto === r;

    const quadro = document.createElement('section');
    quadro.className = 'quadro' + (aberto ? ' aberto' : '');
    quadro.dataset.rar = r;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'quadro-head';
    head.title = aberto
      ? `quadro ${r} aberto — clicar numa carta da direita manda ela para ca'`
      : `abrir o quadro ${r}`;
    head.innerHTML = `<span class="seta">${aberto ? '▾' : '▸'}</span>`
      + `<b class="${r}">${r}</b>`
      + `<span class="qtd">${ids.length} carta${ids.length === 1 ? '' : 's'}</span>`
      + `<span class="chance${chances[r] ? '' : ' zero'}">${chances[r]}% de chance</span>`;
    // Um aberto por vez: é o que faz "o quadro aberto" ser um alvo sem dúvida.
    head.onclick = () => {
      dropAberto = aberto ? null : r;
      renderDropPool();
      renderPool();
    };
    quadro.append(head);

    const corpo = document.createElement('div');
    corpo.className = 'quadro-corpo';
    if (!ids.length) {
      corpo.append(Object.assign(document.createElement('div'), {
        className: 'quadro-vazio',
        textContent: 'nenhuma carta aqui — arraste uma para este quadro, '
                   + 'ou clique numa do pool da direita com ele aberto.',
      }));
    } else {
      const grid = document.createElement('div');
      grid.className = 'deck-grid';
      for (const id of ids) {
        const c = brief(id);
        const el = document.createElement('div');
        el.className = 'thumb';
        el.draggable = true;
        el.dataset.id = id;
        el.title = `${c?.name ?? id}\nclique: tirar do pool`
                 + '\narraste para outro quadro: trocar a raridade';
        el.innerHTML = `<img loading="lazy" src="${ART(id)}" alt="" draggable="false">`;
        el.onclick = () => {
          tiraDoDropPool(id);
          markDirty();
          renderDropPool();
          toast(`− ${c?.name ?? id} (pool de drop)`);
        };
        el.oncontextmenu = (e) => { e.preventDefault(); showDetail(id); };
        wireDragSource(el, id, 'drop', r);
        grid.append(el);
      }
      corpo.append(grid);
    }
    quadro.append(corpo);
    setupQuadroZone(quadro, r);
    frag.append(quadro);
  }

  caixa.replaceChildren(frag);
  $('drop-count').textContent = String(total);
  $('tab-drops-n').textContent = String(total);
  $('drop-resumo').innerHTML = total === 0
    ? 'Sem carta nenhuma nos quadros, a vitória entrega a <b>carta de assinatura</b> '
      + 'deste adversário, como era antes de existir pool.'
    : dropQtd > 0
      ? `Cada vitória entrega <b>${dropQtd} carta(s)</b>, sorteadas entre as <b>${total}</b> `
        + 'destes quadros: primeiro a raridade, pela % de cada quadro, depois uma carta dentro dela.'
      : 'Quantidade <b>0</b> — nada é sorteado. Ajuste "por vitória" aí em cima.';
  atualizaAlvoDeClique();
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

/**
 * Preenche o select "libera" com os OUTROS decks deste adversário.
 *
 * O próprio deck fica de fora: um deck que se libera seria um nó que só abre
 * depois de já estar aberto. Quando o valor gravado aponta para um deck que não
 * existe mais (apagado, ou renomeado noutra máquina), ele entra na lista como
 * uma opção "(ausente)" em vez de sumir calado — sumindo, salvar de novo
 * apagaria a cadeia sem ninguém pedir.
 */
function preencherLibera(npcId, nomeDoProprio, atual) {
  const sel = $('npc-libera');
  const nomes = getNpcDecks(npcId)
    .map((d) => d.name)
    .filter((n) => n && n !== nomeDoProprio);

  sel.replaceChildren(new Option('— nenhum —', ''));
  for (const n of nomes) sel.append(new Option(n, n));
  if (atual && !nomes.includes(atual)) sel.append(new Option(`${atual} (ausente)`, atual));
  sel.value = atual || '';
}

async function saveNpcDeckFromUI() {
  const st = deckStatus({ ignoreBanlist: $('npc-ignore-banlist').checked });
  if (!st.ok) return void toast(`não é possível salvar: ${st.message}`);

  // A carta de assinatura continua sendo a que ILUSTRA o deck e o premio de
  // quem nao tem pool configurado; ela deixou de ser escolhida num select e
  // passou a ser a moldura, que e' a mesma decisao visual.
  const sig = npcCover || npcSignature;
  const name = $('deck-name').value.trim() || `Deck ${npcMode.name}`;
  // Prêmio em DP por vencer este deck. Campo vazio = padrão; 0 é válido.
  const rw = $('npc-reward').value;
  const rewardDp = rw === '' ? undefined : Math.max(0, Number(rw) || 0);

  const r = await saveNpcDeckAt(npcMode.id, npcDeckIndex, {
    name, deck, signatureId: sig, coverId: npcCover || sig, rewardDp,
    dificuldade: $('npc-dificuldade').value,
    libera: $('npc-libera').value,
  });
  if (r.index < 0) return void toast(r.error ?? 'falha ao salvar');
  // Salvou no disco mas NAO publicou: o adversario continua so' nesta maquina.
  // O aviso e' separado do "salvo em decks/..." de proposito — sao dois fatos
  // diferentes, e juntar os dois foi o que escondeu o problema ate' agora.
  if (r.publicado === false) {
    toast(`deck NAO publicado: ${r.erroRemoto || 'sem sessao de admin'} — vale so nesta maquina`);
  }
  npcDeckIndex = r.index;
  npcSignature = sig;
  markDirty(false);

  // O pool de drop vai junto, mas para OUTRO lugar: `conteudo/npc-drops`. Ele
  // e' por DECK — e' o que faz destrancar o deck dificil valer a pena, ja' que
  // o premio de cada um e' diferente. O pool do NPC continua existindo debaixo
  // dele, como reserva de quem ainda nao tem pool proprio.
  //
  // A chave e' o nome do deck RECEM-SALVO (`name`), nao o que estava carregado:
  // renomear e salvar na mesma acao gravaria o pool na chave velha, e o deck
  // novo nasceria sem drop nenhum.
  dropQtd = Math.max(0, Math.min(MAX_DROPS, Number($('npc-drop-qtd').value) || 0));
  const temCarta = totalDoPool(dropPool) > 0;
  const doNpc = { ...(dropsCfg[npcMode.id] ?? {}) };
  const porDeck = { ...(doNpc.decks ?? {}) };
  if (nomeDoDropAntigo && nomeDoDropAntigo !== name) delete porDeck[nomeDoDropAntigo];
  if (temCarta && dropQtd > 0) porDeck[name] = { quantidade: dropQtd, pool: dropPool };
  else delete porDeck[name];

  if (Object.keys(porDeck).length) doNpc.decks = porDeck; else delete doNpc.decks;
  if (Object.keys(doNpc).length) dropsCfg[npcMode.id] = doNpc;
  else delete dropsCfg[npcMode.id];
  nomeDoDropAntigo = name;
  const pub = await salvarDrops(dropsCfg);

  // O caso que passava em SILÊNCIO: pool montado, quantidade em zero. A
  // configuração é descartada (por regra, e a regra está certa: 0 por vitória é
  // o mesmo que não ter drop), só que a tela não dizia nada — o pool sumia e
  // quem montou continuava achando que tinha salvado.
  if (pub?.banco && !pub.banco.ok) {
    toast(`pool de drop NAO publicado: ${pub.banco.erro}`);
  } else if (temCarta && dropQtd <= 0) {
    toast('pool de drop NAO salvo: falta a quantidade por vitoria (esta zerada)');
    $('npc-drop-qtd').focus();
  } else if (dropQtd > 0) {
    toast(`pool de drop publicado: ${dropQtd} carta(s) de ${totalDoPool(dropPool)}`);
  }

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

/**
 * `rar` só existe para as cartas que já estão num quadro do pool de drop: é de
 * qual quadro ela saiu, para arrastar de um quadro para o outro poder trocar a
 * raridade em vez de duplicar.
 */
function wireDragSource(el, id, from, rar = null) {
  el.addEventListener('dragstart', (e) => {
    drag = { id: Number(id), from, rar };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = from === 'pool' ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', String(id));   // exigido pelo Firefox
    // Destaca o quadro que os boosters SUGEREM para esta carta. É só sugestão:
    // quem manda é onde ela for solta.
    if (npcMode && from !== 'drop') {
      document.querySelector(`.quadro[data-rar="${raridadeDe(id)}"]`)
        ?.classList.add('sugerido');
    }
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    drag = null;
    document.querySelectorAll('.dropzone.over, .dropzone.reject, .quadro.over, .quadro.reject')
      .forEach((z) => z.classList.remove('over', 'reject'));
    document.querySelectorAll('.quadro.sugerido')
      .forEach((q) => q.classList.remove('sugerido'));
    document.querySelectorAll('.thumb.drop-before')
      .forEach((t) => t.classList.remove('drop-before'));
  });
}

/** O alvo aceita o que está sendo arrastado? */
function accepts(zone) {
  if (!drag) return false;
  // Devolver ao pool = remover: uma cópia do deck, ou a carta do pool de drop.
  if (zone === 'pool') return drag.from !== 'pool';
  return drag.from === 'pool' || drag.from === zone;          // adicionar ou reordenar
}

/**
 * Cada QUADRO de raridade é um alvo por si — aberto ou fechado, porque um
 * quadro fechado precisa aceitar a carta também. Ele aceita de qualquer origem
 * (pool da direita, deck, outro quadro): o pool de drop não é parte do deck,
 * então arrastar uma carta do Main para cá NÃO a tira do deck — a carta que o
 * adversário joga costuma ser a mesma que ele larga.
 */
function setupQuadroZone(el, rar) {
  const ok = () => !!drag && !(drag.from === 'drop' && drag.rar === rar);

  el.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = ok() ? 'copy' : 'none';
    el.classList.add('over');
    el.classList.toggle('reject', !ok());
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('over', 'reject');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('over', 'reject');
    if (!ok()) return;
    porNoQuadro(drag.id, rar);
  });
}

/**
 * Soltar DENTRO da aba de drops mas FORA de um quadro: a carta cai no quadro que
 * os boosters sugerem. Sem isto o espaço em volta dos quadros seria um alvo
 * morto que engole o gesto sem dizer nada — que é a versão pequena do bug que
 * esta tela toda veio consertar. Os quadros param a propagação, então um gesto
 * que acertou um quadro nunca chega aqui.
 *
 * Carta que já está num quadro é EXCEÇÃO: um solto desleixado no vão não pode
 * mudar a raridade que alguém escolheu a dedo.
 */
function setupAutoDropZone(el) {
  el.addEventListener('dragover', (e) => {
    if (!drag || drag.from === 'drop') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('drop', (e) => {
    if (!drag || drag.from === 'drop') return;
    e.preventDefault();
    porNoQuadro(drag.id, raridadeDe(drag.id));
  });
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
      // Veio de um quadro de raridade: devolver ao pool é tirar do pool de drop.
      if (from === 'drop') {
        tiraDoDropPool(id);
        markDirty();
        renderDropPool();
        toast(`− ${brief(id)?.name ?? id} (pool de drop)`);
        return;
      }
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
  // O 3º argumento é o que faz a recusa do servidor CHEGAR ao jogador. Sem ele,
  // "deck salvo" aparecia mesmo quando o banco tinha recusado — e o deck existia
  // só neste navegador, sumindo na hora de entrar num duelo online.
  deckIndex = saveDeck(deck, deckIndex, (erro) => {
    markDirty();                       // não salvou de verdade: o `*` volta
    alert(`O deck ficou salvo só neste navegador.\n\n${erro}\n\n`
        + 'Ajuste o deck e salve de novo — assim ele vale em qualquer máquina '
        + 'e nos duelos online.');
  }, { livre: gravarLivre });
  setActiveIndex(deckIndex);
  markDirty(false);
  refreshDeckSelect();
  // O texto diferente não é enfeite: é como se sabe, olhando a tela, se o
  // deck foi pelo caminho normal ou pelo de admin.
  toast(gravarLivre ? 'deck salvo no banco (admin — sem conferir a Coleção)' : 'deck salvo');
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

/**
 * ⚡ AUTO MONTAGEM.
 *
 * Monta um deck de 40 com o que o jogador tem. A lógica mora em
 * `automontagem.js` (sem DOM, testada em Node); aqui só se junta o POOL — que é
 * o único lugar que sabe quantas cópias cada carta vale, se a Lista 1 está
 * ligada e o que a banlist limita.
 *
 * O texto das cartas (`cards.json`, ~14 MB) é carregado SÓ AQUI, no clique. Sem
 * ele não há como saber qual magia invoca qual Ritual nem quais são os materiais
 * de uma Fusão — e sem isso o botão entregaria cartas mortas. Pagar 14 MB uma
 * vez, quando o jogador pediu, é melhor que carregar sempre "por via das
 * dúvidas".
 */
$('btn-auto').onclick = async () => {
  if (!confirmDiscard()) return;

  const antes = $('btn-auto').textContent;
  $('btn-auto').disabled = true;
  $('btn-auto').textContent = 'montando…';
  try {
    const textos = await carregarTextos();

    // O pool respeita TUDO que a tela já respeita: Lista 1 marcada, o teto da
    // banlist e as cópias que a Coleção realmente tem.
    const usarLista1 = $('f-lista1').checked;
    const pool = [];
    // `db.filter({})` é a porta pública para o índice inteiro — e já descarta
    // arte alternativa, que contaria como cópia da mesma carta.
    for (const c of db.filter({})) {
      if (usarLista1 && !inLista1(c)) continue;
      if (ownedMode && !ownsCard(c.id)) continue;
      let copias = availableCopies(c.id);
      if (usarLista1 && banlist) {
        const lim = banlist.cardLimits[String(c.id)];
        if (Number.isFinite(lim)) copias = Math.min(copias, lim);
      }
      if (copias > 0) pool.push({ card: c, copias });
    }

    const { main, extra, relatorio } = montarAuto(pool, { descOf: (id) => textos.get(Number(id)) ?? '' });
    if (!main.length) return void toast('sua Coleção ainda não dá para montar um deck');

    deck = new Deck({ name: deck.name || 'Auto', main, extra, coverId: main[0] ?? null });
    markDirty();
    refresh();

    // O relatório vai para o console porque é longo e detalhado: quem quer saber
    // POR QUE tal carta entrou abre o F12; quem só queria o deck já o tem.
    console.groupCollapsed(`⚡ auto montagem — ${main.length} no main, ${extra.length} no extra`);
    for (const l of relatorio) console.log(l);
    console.groupEnd();

    const problemas = relatorio.filter((l) => l.startsWith('✗') || l.startsWith('⚠'));
    toast(problemas.length
      ? `deck montado — ${problemas.length} ressalva(s), veja o console (F12)`
      : `deck montado: ${main.length} cartas`);
  } catch (e) {
    toast(`não consegui montar: ${e.message}`);
  } finally {
    $('btn-auto').disabled = false;
    $('btn-auto').textContent = antes;
  }
};

/** `id -> desc`, carregado uma vez e guardado. */
let textosCache = null;
async function carregarTextos() {
  if (textosCache) return textosCache;
  const r = await fetch('/ygo-data/data/cards.json');
  if (!r.ok) throw new Error('não achei o texto das cartas');
  textosCache = new Map((await r.json()).map((c) => [Number(c.id), c.desc ?? '']));
  return textosCache;
}

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
$('npc-drop-qtd').oninput = () => {
  dropQtd = Math.max(0, Math.min(MAX_DROPS, Number($('npc-drop-qtd').value) || 0));
  markDirty();
  renderDropPool();
};

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
// Os quadros de raridade do pool de drop são ligados em `renderDropPool`: eles
// nascem e morrem a cada desenho, e cada um é o seu próprio alvo. O que sobra
// da aba (o vão em volta dos quadros) cai na raridade sugerida pelos boosters.
setupAutoDropZone($('drop-scroll'));

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

// modo NPC (?npc=<id>) é ferramenta da Área de Teste, não tela de progresso
// do jogador — não exige login, e por isso também não toca wallet/decks DO
// JOGADOR (que agora são dado de conta). Lido cedo, antes do gate.
const params = new URLSearchParams(location.search);
const npcId = params.get('npc');

if (!npcId) {
  const username = await requireLogin();
  if (!username) throw new Error('redirecionando para login');
}

// Admin na Área de Teste grava direto no banco (ver `gravarLivre`). Falha de
// rede aqui não é erro: sem perfil, salva pelo caminho normal de sempre.
if (!npcId && !ownedMode) {
  const perfil = await perfilAtual().catch(() => null);
  gravarLivre = !!perfil?.admin;
}

// injeta as cartas customizadas salvas (localStorage) antes de tudo que usa
// o índice — assim elas aparecem no pool e nos decks que já as referenciam.
// Boosters + carteira do projeto (store/*.json) antes de ler raridade/coleção.
await hydrateBoosters();
if (!npcId) {
  await hydrateWallet();
  await hydrateDecks();        // decks/users/<u>/player/*.ydk ANTES de qualquer gravação
}
await hydrateCustomNpcs();   // adversários criados na Área de Teste (outra máquina inclusive)
await hydrateCardLists();    // o pool permitido publicado (Lista 1 e as que vierem)
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
// (params/npcId já foram lidos lá em cima, antes do gate de login)
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

  // A cadeia e' por NOME, entao a lista de "libera" so' pode ser montada com os
  // decks que ja' existem — e nunca com o proprio, que seria um no' que so' abre
  // depois de ja' estar aberto.
  $('npc-dificuldade').value = slot?.dificuldade ?? '';
  preencherLibera(npcId, slot?.name ?? null, slot?.libera ?? '');

  // O POOL DE DROP e' do DECK (`conteudo/npc-drops`, em `decks[<nome>]`), com o
  // pool do NPC como reserva para o deck que ainda nao tem o seu. Falha de rede
  // nao derruba o builder — so' deixa o pool vazio, e o aviso aparece ao salvar.
  try { dropsCfg = await carregarDrops(); } catch { dropsCfg = {}; }
  nomeDoDropAntigo = slot?.name ?? null;
  const meuDrop = dropsDoDeck(dropsCfg, npcId, nomeDoDropAntigo);
  dropPool = meuDrop ? meuDrop.pool : poolVazio();
  dropQtd = meuDrop ? meuDrop.quantidade : 0;
  $('npc-drop-qtd').value = dropQtd ? String(dropQtd) : '';

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
