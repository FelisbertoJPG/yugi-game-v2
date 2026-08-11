/**
 * Loja — compra de boosters com DP. Cada pacote custa 100 DP e revela 5 cartas
 * aleatórias (raridade pesa), que entram na Coleção do jogador. Os boosters aqui
 * são os que foram marcados com "inserir na Loja" no Booster Builder.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import {
  listShopBoosters, boosterSize, hydrateBoosters,
  DEFAULT_PRICE, PITY_EVERY, UR_PITY_DP,
} from '/web/js/boosters.js';
import { listCustom } from '/web/js/customcards.js';
import {
  getDP, getPity, hydrateWallet, abrirPacote, getUrSpend,
} from '/web/js/wallet.js';
import { requireLogin } from '/web/js/auth.js';
import { listarEstruturais, jaComprados, comprarEstrutural } from '/web/js/estruturais.js';

const priceOf = (b) => (Number.isFinite(b.price) ? b.price : DEFAULT_PRICE);
const pityKey = (b) => b.name;   // identidade do booster para o contador "a cada 10"

const $ = (id) => document.getElementById(id);

const customArt = new Map();
function ART(id, small = false) {
  const a = customArt.get(Number(id));
  if (a) return a;
  return `https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/${id}.jpg`;
}

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

function renderDP() {
  $('dp').textContent = `${getDP()} DP`;
}

let lastBought = null;   // último booster aberto (para "abrir outro")

function renderShop() {
  const list = listShopBoosters();
  $('empty').hidden = list.length > 0;
  const dp = getDP();
  const frag = document.createDocumentFragment();

  for (const b of list) {
    const el = document.createElement('div');
    el.className = 'pack';
    const price = priceOf(b);
    const canBuy = dp >= price;
    const temSR = (b.cards?.SR?.length ?? 0) > 0;
    const opens = getPity(pityKey(b));
    const faltam = PITY_EVERY - (opens % PITY_EVERY);   // pacotes até a SR garantida
    const proxSR = temSR && (opens % PITY_EVERY) === PITY_EVERY - 1;
    const pityLinha = temSR
      ? (proxSR
          ? `<span class="meta" style="color:var(--gold)">★ próximo pacote: SR garantida!</span>`
          : `<span class="meta">a cada ${PITY_EVERY} pacotes: 1 SR garantida deste booster (faltam ${faltam})</span>`)
      : '';

    // Progresso da UR garantida: é global (vale para todos os boosters), então
    // a linha mostra o mesmo número em todos os cards — de propósito.
    const temUR = (b.cards?.UR?.length ?? 0) > 0;
    const faltamDP = Math.max(0, UR_PITY_DP - getUrSpend());
    const urLinha = temUR
      ? (faltamDP === 0
          ? `<span class="meta" style="color:var(--gold)">★★ próximo pacote: UR garantida!</span>`
          : `<span class="meta">a cada ${UR_PITY_DP} DP gastos: 1 UR garantida (faltam ${faltamDP} DP)</span>`)
      : '';
    el.innerHTML =
      `<div class="art" style="background-image:${b.coverId ? `url('${ART(b.coverId)}')` : 'none'}"></div>` +
      `<div class="body">` +
        `<span class="name">${escapeHtml(b.name)}</span>` +
        `<span class="meta">${boosterSize(b)} cartas · ${price} DP</span>` +
        pityLinha +
        urLinha +
        `<button class="buy btn-primary" ${canBuy ? '' : 'disabled'}>abrir pacote (${price} DP)</button>` +
      `</div>`;
    el.querySelector('.buy').onclick = (e) => { e.currentTarget.disabled = true; buy(b); };
    frag.append(el);
  }
  $('packs').replaceChildren(frag);
}

/**
 * Compra um pacote.
 *
 * Todo o miolo saiu daqui: cobrar o preço, sortear as cartas e resolver as
 * garantias (SR a cada N pacotes, UR por DP acumulado) agora acontece no banco,
 * em `abrir_pacote()`. O que sobrou é pedir e mostrar.
 *
 * Isso não é reorganização: enquanto o sorteio rodava neste arquivo, quem
 * chamasse a API na mão podia pular o `spendDP` e creditar as cartas do mesmo
 * jeito — o cliente era a única autoridade sobre o próprio saldo.
 */
async function buy(booster) {
  const r = await abrirPacote(booster.name);
  if (!r.ok) {
    return void toast(r.error === 'DP insuficiente'
      ? 'DP insuficiente — vença Adversários para ganhar mais'
      : r.error);
  }

  // O servidor devolve `{id, rarity}`; a tela também quer saber o que veio por
  // garantia, e isso é dedutível: a primeira carta com raridade acima do comum
  // num pacote que bateu o contador é a garantida.
  const pulls = r.cartas.map((c, i) => ({
    id: Number(c.id),
    rarity: c.rarity,
    guaranteed: i === 0 && (c.rarity === 'SR' || c.rarity === 'UR'),
  }));

  lastBought = booster;
  renderDP();
  renderShop();          // atualiza os botões (DP e o progresso do pity)
  showReveal(booster, pulls);
}

/**
 * Vitrine dos Decks Estruturais.
 *
 * Ao contrário do booster, aqui não há revelação: o servidor cobra, credita as
 * cartas na coleção, monta o deck e devolve o nome dele. O jogador sai da Loja
 * com o deck escolhível no PvP e no PvE, sem passar pelo Deck Builder.
 */
async function renderEstruturais() {
  const [lista, comprados] = await Promise.all([
    listarEstruturais({ soLoja: true }),
    jaComprados(),
  ]);

  $('titulo-estruturais').hidden = lista.length === 0;
  const dp = getDP();
  const frag = document.createDocumentFragment();

  for (const d of lista) {
    const tem = comprados.has(d.id);
    const podeComprar = !tem && dp >= d.preco;

    const el = document.createElement('div');
    el.className = 'pack';
    el.innerHTML =
      `<div class="art" style="background-image:${d.capa ? `url('${ART(d.capa)}')` : 'none'}"></div>` +
      `<div class="body">` +
        `<span class="name">${escapeHtml(d.nome)}</span>` +
        `<span class="meta">deck pronto · ${d.preco} DP</span>` +
        `<span class="meta">${tem ? 'você já tem este deck' : 'entra montado nos seus decks'}</span>` +
        `<button class="comprar btn-primary" ${podeComprar ? '' : 'disabled'}>` +
          (tem ? 'adquirido' : `comprar (${d.preco} DP)`) +
        `</button>` +
      `</div>`;

    if (podeComprar) {
      el.querySelector('.comprar').onclick = async (e) => {
        e.currentTarget.disabled = true;
        const r = await comprarEstrutural(d.id);
        if (!r.ok) { toast(r.error); e.target.disabled = false; return; }
        toast(`"${r.deck}" foi para os seus decks — já dá para jogar com ele`);
        renderDP();
        renderShop();            // o DP mudou: os botões de booster acompanham
        await renderEstruturais();
      };
    }
    frag.append(el);
  }
  $('estruturais').replaceChildren(frag);
}

function showReveal(booster, pulls) {
  $('reveal-title').textContent = `${booster.name} — pacote aberto!`;
  $('reveal-sub').textContent = `${pulls.length} cartas foram para a sua Coleção · saldo: ${getDP()} DP`;
  const frag = document.createDocumentFragment();
  for (const p of pulls) {
    const rc = document.createElement('div');
    rc.className = 'rc';
    rc.innerHTML = `<img src="${ART(p.id)}" alt="">`
      + `<span class="r ${p.rarity}">${p.guaranteed ? '★' : ''}${p.rarity}</span>`
      + `<div class="nm">${escapeHtml(nameOf(p.id))}${p.guaranteed ? ' (garantida)' : ''}</div>`;
    frag.append(rc);
  }
  $('reveal-cards').replaceChildren(frag);
  const price = priceOf(booster);
  $('reveal-again').textContent = `abrir outro (${price} DP)`;
  $('reveal-again').disabled = getDP() < price;
  $('reveal-back').classList.add('show');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

$('btn-home').onclick = () => (location.href = '/web/index.html');
$('reveal-close').onclick = () => $('reveal-back').classList.remove('show');
$('reveal-back').addEventListener('click', (e) => {
  if (e.target === $('reveal-back')) $('reveal-back').classList.remove('show');
});
$('reveal-again').onclick = (e) => { if (!lastBought) return; e.currentTarget.disabled = true; buy(lastBought).finally(() => { e.target.disabled = false; }); };

// ---------------------------------------------------------------- boot
const username = await requireLogin();
if (!username) throw new Error('redirecionando para login');

// Traz boosters + carteira do projeto (store/*.json) antes de desenhar.
await hydrateBoosters();
await hydrateWallet();

try {
  db = await YgoDB.load('/ygo-data/data', { full: false });
} catch { /* segue sem nomes; a arte ainda vem por id */ }

for (const c of listCustom()) if (c.art) customArt.set(c.id, c.art);

renderDP();
renderShop();
await renderEstruturais();
