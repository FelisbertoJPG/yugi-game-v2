/**
 * Loja — compra de boosters com DP. Cada pacote custa 100 DP e revela 5 cartas
 * aleatórias (raridade pesa), que entram na Coleção do jogador. Os boosters aqui
 * são os que foram marcados com "inserir na Loja" no Booster Builder.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import {
  listShopBoosters, boosterSize, hydrateBoosters, rarityIndex,
  chancesDoPacote, DEFAULT_PRICE, PACK_SIZE, PITY_EVERY, UR_PITY_DP,
} from '/web/js/boosters.js';
import { renderGavetas, fraseDaColecao } from '/web/js/gavetas.js';
import { listCustom } from '/web/js/customcards.js';
import {
  getDP, getPity, hydrateWallet, abrirPacote, getUrSpend,
} from '/web/js/wallet.js';
import { requireLogin } from '/web/js/auth.js';
import {
  listarEstruturais, jaComprados, comprarEstrutural,
} from '/web/js/estruturais.js';
import { deYdk, gavetasDoDeck, totalDoDeck } from '/web/js/ydk.js';

const priceOf = (b) => (Number.isFinite(b.price) ? b.price : DEFAULT_PRICE);
// O tamanho do pacote vem do modulo, nao de um "5" escrito na frase.
const PACK_SIZE_TXT = String(PACK_SIZE);
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
        `<button class="ver">ver as cartas</button>` +
      `</div>`;
    el.querySelector('.buy').onclick = (e) => { e.currentTarget.disabled = true; buy(b); };
    el.querySelector('.ver').onclick = () => verBooster(b);
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
        `<button class="ver">ver as cartas</button>` +
      `</div>`;
    el.querySelector('.ver').onclick = () => verEstrutural(d);

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

// --------------------------------------------------- o que vem no conteúdo
/**
 * **A lista de cartas de um conteúdo da Loja, por raridade.**
 *
 * É a mesma caixa da lista de drops da Trilha de Duelos — literalmente a mesma
 * (`gavetas.js` + `web/css/gavetas.css`). A pergunta do jogador é idêntica nos
 * dois lugares: *o que vem aqui dentro, e o que disso ainda me falta?* Comprar
 * às cegas um pacote de 60 cartas das quais já se tem 55 é o tipo de coisa que
 * só dá para descobrir depois de gastar.
 *
 * A caixa não desliga por falta de DP: quem está sem saldo é justamente quem
 * mais precisa escolher onde gastar o próximo.
 */
function abrirConteudo(titulo, sub, pool, { chances = null, copias = null } = {}) {
  $('conteudo-titulo').textContent = titulo;
  const resumo = renderGavetas($('conteudo-corpo'), pool, {
    nomeDe: nameOf, arte: (id) => ART(id, true), chances, copias,
  });
  $('conteudo-sub').innerHTML = `${sub} `
    + '<b style="color:var(--green,#3fd68a)">✔</b> = já está na sua Coleção — '
    + fraseDaColecao(resumo);
  $('conteudo-back').classList.add('show');
}

/**
 * Booster: as gavetas já vêm prontas (`b.cards`), e a CHANCE sai de
 * `chancesDoPacote` — a conta que reproduz o sorteio do banco, cascata e tudo.
 * Escrever a porcentagem à mão aqui seria prometer o que `abrir_pacote()` não
 * cumpre.
 */
function verBooster(b) {
  abrirConteudo(
    `${b.name} — o que vem no pacote`,
    `${boosterSize(b)} cartas diferentes · cada pacote sorteia ${PACK_SIZE_TXT} delas, `
      + 'a raridade primeiro (pelas chances abaixo) e a carta depois. '
      + 'As garantias (SR e UR) entram por cima disto.',
    b.cards,
    { chances: chancesDoPacote(b.cards) },
  );
}

/**
 * Deck Estrutural: aqui não há sorteio — vem tudo, e vem repetido. As gavetas
 * são montadas do `.ydk`, e a raridade segue a MESMA ordem do servidor
 * (`raridade_da_carta`, migration 0019): **o booster vence**, o mapa do próprio
 * estrutural entra depois, e o que não está em lugar nenhum é N. Inverter essa
 * ordem faria a mesma carta aparecer UR na Loja e N no Inventário, onde ela é
 * vendida pela raridade.
 */
function verEstrutural(d) {
  const quantidades = deYdk(d.ydk);
  // O indice sai UMA vez: `rarityOf` reconstroi a varredura de todos os
  // boosters a cada chamada, e um deck de 40 cartas a chamaria 40 vezes.
  const idx = rarityIndex();
  const pool = gavetasDoDeck(quantidades, d.raridades,
                             (id) => idx.get(Number(id))?.rarity ?? null);
  abrirConteudo(
    `${d.nome} — o deck inteiro`,
    `${totalDoDeck(quantidades)} cartas no deck `
      + `(${Object.keys(quantidades).length} diferentes), `
      + 'todas creditadas na sua Coleção na compra — sem sorteio.',
    pool,
    { copias: (id) => quantidades[String(id)] ?? 1 },
  );
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
$('conteudo-fechar').onclick = () => $('conteudo-back').classList.remove('show');
$('conteudo-back').addEventListener('click', (e) => {
  if (e.target === $('conteudo-back')) $('conteudo-back').classList.remove('show');
});
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
