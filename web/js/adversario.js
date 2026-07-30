/**
 * Adversário — escolher um NPC e disparar o duelo (a IA do NPC vem do
 * duel-server, NpcBrain). O duelo em si roda em duel.html?npc=<id>, que aplica a
 * recompensa (+100 DP e a carta-assinatura) ao vencer.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import { NPCS, loadNpcDecks, getNpcActiveDeck, hydrateCustomNpcs } from '/web/js/npcs.js';
import { getDP, hydrateWallet } from '/web/js/wallet.js';

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

function render() {
  $('dp').textContent = `${getDP()} DP`;
  const frag = document.createDocumentFragment();
  for (const npc of NPCS) {
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
        `<span class="reward">recompensa: ${sig ? nameOf(sig) : '—'}</span>` +
        `<button class="go btn-primary" ${temDeck ? '' : 'disabled'}>` +
          (temDeck ? 'duelar' : 'sem deck (monte na Área de Teste)') +
        `</button>` +
      `</div>`;
    el.querySelector('.go').onclick = () => {
      if (!temDeck) return;
      location.href = `/web/duel.html?npc=${npc.id}`;
    };
    frag.append(el);
  }
  $('npcs').replaceChildren(frag);
}

$('btn-home').onclick = () => (location.href = '/web/index.html');

// ---------------------------------------------------------------- boot
await hydrateWallet();
try {
  db = await YgoDB.load('/ygo-data/data', { full: false });
} catch { /* segue sem nomes */ }
await hydrateCustomNpcs();
await loadNpcDecks();
render();
