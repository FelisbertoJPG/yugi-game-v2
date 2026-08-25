/**
 * Loja — compra de boosters com DP. Cada pacote custa 100 DP e revela 5 cartas
 * aleatórias (raridade pesa), que entram na Coleção do jogador. Os boosters aqui
 * são os que foram marcados com "inserir na Loja" no Booster Builder.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import {
  listShopBoosters, boosterSize, hydrateBoosters, rarityIndex,
  chancesDoPacote, DEFAULT_PRICE, PACK_SIZE, PITY_EVERY, UR_PITY_PACKS,
} from '/web/js/boosters.js';
import { renderGavetas, fraseDaColecao } from '/web/js/gavetas.js';
import { montarRevelacao } from '/web/js/revelacao.js';
import { listCustom } from '/web/js/customcards.js';
import {
  getDP, getPity, hydrateWallet, abrirPacote, getUrPity, ownedIds,
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
    // Quantos pacotes deste booster já contam para a próxima garantia. É o
    // RESTO, e não o total: o contador nunca zera na carteira (ele só cresce),
    // e o que interessa na tela é a volta atual.
    const passos = opens % PITY_EVERY;
    const faltam = PITY_EVERY - passos;
    const proxSR = temSR && faltam === 1;

    // A BARRA existe porque o texto sozinho parecia um bug. Com 0, 20 ou 40
    // pacotes abertos a frase era a MESMA ("faltam 20"), numa linha `.meta`
    // igual à do preço — então abrir pacote não mudava nada visível e a
    // sensação era a de um contador que esquece. O relato foi exatamente
    // esse: "não lembra quantos pacotes pro pool das garantidas".
    //
    // O dado sempre esteve certo no banco (`carteira.pity`, por booster); o
    // que faltava era ele APARECER progredindo.
    const pityLinha = temSR
      ? `<div class="pity ${proxSR ? 'pronta' : ''}">`
        +   `<div class="pity-topo">`
        +     `<span class="pity-rot">${proxSR ? '★ SR GARANTIDA NO PRÓXIMO!' : 'SR garantida'}</span>`
        +     `<span class="pity-n">${passos}<i>/${PITY_EVERY}</i></span>`
        +   `</div>`
        +   `<div class="pity-trilho"><div class="pity-fill" style="width:${(passos / PITY_EVERY) * 100}%"></div></div>`
        + `</div>`
      : '';

    // Progresso da UR garantida: é global (vale para todos os boosters), então
    // a linha mostra o mesmo número em todos os cards — de propósito.
    const temUR = (b.cards?.UR?.length ?? 0) > 0;
    // Pacotes deste booster desde a última UR. O teto é o piso da garantia: o
    // contador do banco pode passar de 20 (ele só zera quando uma UR sai), e
    // sem o `min` a barra passaria de 100% de largura.
    const semUr = Math.min(UR_PITY_PACKS, getUrPity(pityKey(b)));
    const urPronta = temUR && semUr >= UR_PITY_PACKS - 1;
    const urLinha = temUR
      ? `<div class="pity ur ${urPronta ? 'pronta' : ''}">`
        +   `<div class="pity-topo">`
        +     `<span class="pity-rot">${urPronta ? '★★ UR GARANTIDA NO PRÓXIMO!' : 'UR garantida'}</span>`
        +     `<span class="pity-n">${semUr}<i>/${UR_PITY_PACKS}</i></span>`
        +   `</div>`
        +   `<div class="pity-trilho"><div class="pity-fill" style="width:${(semUr / UR_PITY_PACKS) * 100}%"></div></div>`
        + `</div>`
      : '';
    el.innerHTML =
      `<div class="art" style="background-image:${b.coverId ? `url('${ART(b.coverId)}')` : 'none'}"></div>` +
      `<div class="body">` +
        `<span class="name">${escapeHtml(b.name)}</span>` +
        `<span class="meta">${boosterSize(b)} cartas · ${price} DP</span>` +
        pityLinha +
        urLinha +
        `<div class="compra">` +
          `<button class="buy btn-primary" ${canBuy ? '' : 'disabled'}>abrir (${price} DP)</button>` +
          `<button class="buy10" ${dp >= price * 10 ? '' : 'disabled'}>abrir 10 <b>(${price * 10} DP)</b></button>` +
        `</div>` +
        `<button class="ver">ver as cartas</button>` +
      `</div>`;
    el.querySelector('.buy').onclick = (e) => { e.currentTarget.disabled = true; buy(b, 1); };
    // O [abrir 10] desliga os DOIS botões: são 10 pacotes numa transação só, e
    // um segundo clique enquanto ela roda cobraria outro lote.
    el.querySelector('.buy10').onclick = (e) => {
      e.currentTarget.disabled = true;
      el.querySelector('.buy').disabled = true;
      buy(b, 10);
    };
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
async function buy(booster, quantos = 1) {
  // **O que era NOVO tem de ser lido ANTES da compra.** `abrirPacote` já grava
  // a carteira de volta no cache, então depois dela toda carta do lote "já está
  // na Coleção" — a pergunta deixa de ter resposta. É a mesma razão pela qual o
  // drop do NPC responde isso no SERVIDOR, antes de creditar (migration 0029).
  //
  // O `?? ` mais abaixo mantém a preferência pelo servidor: no dia em que
  // `abrir_pacote()` devolver o campo `nova`, ele vence este palpite — que erra
  // só quando o cache local está atrás do banco (a compra feita em outra
  // máquina desde o boot desta tela), e erra para o lado inofensivo de um selo
  // a mais.
  const tinha = new Set(ownedIds().map(Number));
  const r = await abrirPacote(booster.name, quantos);
  if (!r.ok) {
    return void toast(r.error === 'DP insuficiente'
      ? 'DP insuficiente — vença Adversários para ganhar mais'
      : r.error);
  }

  // QUEM DIZ o que veio por garantia é o SERVIDOR (campo `guaranteed`,
  // migration 0044). A tela ADIVINHAVA — "a primeira carta acima de comum" —,
  // e isso errava sempre que a primeira saía rara por sorte: a carta ganhava um
  // ★ que ela não merecia. Com 50 cartas de um [abrir 10] na tela, o palpite
  // erraria em quase todo lote.
  //
  // O `??` mantém o palpite antigo para um servidor sem a 0044 — ali ele é a
  // melhor resposta disponível, e some sozinho quando o campo chega.
  // As cartas do PRÓPRIO lote também contam: a segunda cópia da mesma carta
  // dentro dos dez pacotes não é nova, mesmo que a primeira tenha sido.
  const vistas = new Set();
  const pulls = r.cartas.map((c, i) => {
    const id = Number(c.id);
    const inedita = !tinha.has(id) && !vistas.has(id);
    vistas.add(id);
    return {
      id,
      rarity: c.rarity,
      pacote: c.pacote ?? 1,
      guaranteed: c.guaranteed ?? (i === 0 && (c.rarity === 'SR' || c.rarity === 'UR')),
      nova: c.nova ?? inedita,
    };
  });

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

/**
 * **O pacote aberto: as cartas viradas, para virar uma a uma.**
 *
 * A cerimônia é a MESMA do drop de NPC no fim de duelo, e literalmente o mesmo
 * código (`montarRevelacao`): antes disto a Loja despejava as cartas já
 * abertas, sem virada e sem dizer quais eram inéditas, e o mesmo prêmio parecia
 * valer menos vindo do pacote.
 *
 * **[abrir outro] fica desligado enquanto sobrar carta virada**, pelo mesmo
 * motivo dos botões de saída do fim de duelo: ele redesenha esta caixa por
 * cima, e um clique apressado apagaria o pacote antes de alguém ter visto o que
 * veio nele. O [fechar] NÃO é desligado — com 50 cartas de um [abrir 10] isso
 * prenderia o jogador numa tela até ele clicar 50 vezes, e o [revelar rápido]
 * está bem ali para quem não quer a cerimônia.
 */
function showReveal(booster, pulls) {
  $('reveal-title').textContent = `${booster.name} — pacote aberto!`;
  const lotes = new Set(pulls.map((p) => p.pacote ?? 1)).size;
  const novas = pulls.filter((p) => p.nova).length;
  $('reveal-sub').innerHTML =
    `${pulls.length} cartas`
    + (lotes > 1 ? ` em ${lotes} pacotes` : '')
    // Quantas são inéditas é o que decide se valeu a pena abrir de novo — vale
    // mais que o total, e por isso vem na mesma linha.
    + (novas ? ` <b style="color:#ff8a7a">(${novas} nova(s))</b>` : '')
    + ` foram para a sua Coleção · saldo: ${getDP()} DP`
    + ' — clique para virar:';

  const price = priceOf(booster);
  const pular = $('reveal-pular');
  const liberar = () => {
    pular.hidden = true;
    $('reveal-again').disabled = getDP() < price;
  };

  const rev = montarRevelacao($('reveal-cards'), pulls.map((p) => ({
    id: p.id,
    raridade: p.rarity,
    nova: p.nova,
    selo: p.guaranteed ? '★' : '',
    sufixo: p.guaranteed ? ' (garantida)' : '',
  })), {
    nomeDe: nameOf,
    arte: (id) => ART(id),
    // SETE por linha. Um [abrir 10] traz 50 cartas: numa fileira que só quebra
    // quando não cabe mais, elas ficavam do tamanho de um selo.
    colunas: 7,
    aoTerminar: liberar,
  });

  $('reveal-again').textContent = `abrir outro (${price} DP)`;
  $('reveal-again').disabled = true;
  pular.hidden = false;
  pular.onclick = () => rev.revelarTudo();

  // **[organizar por raridade]** — com 50 cartas de um [abrir 10] espalhadas na
  // ordem do sorteio, é este botão que responde a pergunta que se faz depois de
  // abrir: *tirei alguma coisa boa?*
  //
  // Ele REVELA o que ainda estiver virado (quem organiza está pedindo para ver o
  // resultado), e é um vai-e-volta: a ordem do pacote é a única que mostra em
  // qual dos dez pacotes cada carta veio, então perdê-la para sempre num clique
  // seria uma troca ruim.
  const ordem = $('reveal-ordem');
  const pintarOrdem = () => {
    const agrupado = rev.agrupadoPorRaridade();
    ordem.textContent = agrupado ? 'ordem do pacote' : 'organizar por raridade';
    ordem.title = agrupado
      ? 'volta à ordem em que as cartas saíram'
      : 'agrupa UR → N (revela as que ainda estiverem viradas)';
  };
  ordem.onclick = () => { rev.ordenar(!rev.agrupadoPorRaridade()); pintarOrdem(); };
  pintarOrdem();

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
