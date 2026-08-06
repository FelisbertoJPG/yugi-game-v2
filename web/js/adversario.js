/**
 * Adversário — escolher um NPC e disparar o duelo (a IA do NPC vem do
 * duel-server, NpcBrain). O duelo em si roda em duel.html?npc=<id>, que aplica a
 * recompensa (+100 DP e a carta-assinatura) ao vencer.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import { NPCS, loadNpcDecks, getNpcActiveDeck, hydrateCustomNpcs, listCampaignNames, npcLevel } from '/web/js/npcs.js';
import { getDP, hydrateWallet } from '/web/js/wallet.js';
import { requireLogin } from '/web/js/auth.js';

const $ = (id) => document.getElementById(id);
const ART = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;

let db = null;
const nameOf = (id) => db?.brief(id)?.name ?? String(id);

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function npcCard(npc) {
  const active = getNpcActiveDeck(npc.id);      // deck ativo do NPC (pode ser null)
  const cover = active?.coverId ?? active?.signatureId ?? npc.signatureId;
  const sig = active?.signatureId ?? npc.signatureId;
  const temDeck = active && active.deck && active.deck.main.length > 0;

  const el = document.createElement('div');
  el.className = 'npc';
  el.innerHTML =
    `<div class="art" style="${cover ? `background-image:url('${ART(cover)}')` : ''}"></div>` +
    `<div class="body">` +
      `<span class="name">${npc.name}</span>` +
      `<span class="theme">${npc.theme}</span>` +
      // Nível: só aparece quando é AVANÇADO. O jogador precisa saber, antes de
      // entrar, que este adversário lê a mão e as cartas baixadas dele — é a
      // diferença entre "perdi" e "esse cara trapaceia".
      (npcLevel(npc) === 'avancado'
        ? `<span class="theme" style="color:var(--gold)">▲ avançado — lê sua mão</span>` : '') +
      `<span class="reward">recompensa: ${sig ? nameOf(sig) : '—'}</span>` +
      `<button class="go btn-primary" ${temDeck ? '' : 'disabled'}>` +
        (temDeck ? 'duelar' : 'sem deck (monte na Área de Teste)') +
      `</button>` +
    `</div>`;
  el.querySelector('.go').onclick = () => {
    if (!temDeck) return;
    location.href = `/web/duel.html?npc=${npc.id}`;
  };
  return el;
}

function campaignSection(nome, npcs) {
  const sec = document.createElement('div');
  sec.className = 'campaign';
  const h = document.createElement('h2');
  h.textContent = nome;
  sec.append(h);
  const grid = document.createElement('div');
  grid.className = 'npcs';
  for (const npc of npcs) grid.append(npcCard(npc));
  sec.append(grid);
  return sec;
}

// A página é organizada só por campanha (sem lista "todos" solta) — cada
// adversário mora numa seção; quem ainda não tem `campaign` definida cai
// numa seção "Sem campanha" pra não sumir da tela.
function render() {
  $('dp').textContent = `${getDP()} DP`;
  const wrap = $('campaigns');

  const campanhas = listCampaignNames();
  const soltos = NPCS.filter((n) => !n.campaign);
  if (!campanhas.length && !soltos.length) {
    wrap.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  for (const nome of campanhas) {
    frag.append(campaignSection(nome, NPCS.filter((n) => n.campaign === nome)));
  }
  if (soltos.length) frag.append(campaignSection('Sem campanha', soltos));
  wrap.replaceChildren(frag);
}

$('btn-home').onclick = () => (location.href = '/web/index.html');

// ---------------------------------------------------------------- boot
const username = await requireLogin();
if (!username) throw new Error('redirecionando para login');

await hydrateWallet();
try {
  db = await YgoDB.load('/ygo-data/data', { full: false });
} catch { /* segue sem nomes */ }
await hydrateCustomNpcs();
await loadNpcDecks();
render();
