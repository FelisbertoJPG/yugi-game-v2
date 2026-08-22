/**
 * **Trilha de Duelos** — a porta de entrada dos adversários.
 *
 * Substitui a grade de cards da antiga tela "Adversário". A campanha é definida
 * pelo ADMIN (o campo `campaign` de cada adversário, editado na Área de Teste) e
 * vira um CAMINHO: os adversários daquela campanha, em ordem, ligados por
 * traços. Cada um **libera o próximo ao ser vencido**.
 *
 * Três decisões que o desenho pediu e valem registro:
 *
 * 1. **O progresso mora no BANCO**, não no navegador (`npcsVencidos`, que lê
 *    `duelos`). Progresso em `localStorage` some ao trocar de máquina ou limpar
 *    o site — e liberaria a trilha inteira para quem abrisse o console.
 * 2. **O painel do adversário só abre em quadro LIBERADO.** Mostrar o deck e a
 *    lista de drops de quem ainda está trancado entregaria a campanha inteira
 *    de graça; o quadro trancado mostra só o cadeado.
 * 3. **A ordem da trilha é a ordem em que os adversários aparecem** na lista
 *    (`NPCS`), respeitando um campo `ordem` quando ele existir. Não há tela para
 *    editar essa ordem ainda — quem manda é a ordem de criação.
 */
import { YgoDB } from '/ygo-data/src/ygodb.js';
import {
  NPCS, loadNpcDecks, getNpcActiveDeck, getNpcDecks, hydrateCustomNpcs,
  listCampaignNames, npcLevel,
} from '/web/js/npcs.js';
import {
  getDP, hydrateWallet, npcsVencidos, decksVencidos,
} from '/web/js/wallet.js';
import {
  carregarDrops, dropsDoDeck, chancesDe, totalDoPool,
} from '/web/js/drops.js';
import { renderGavetas, fraseDaColecao } from '/web/js/gavetas.js';
import { pullFile } from '/web/js/projectstore.js';
import { ordenarCampanha, liberados } from '/web/js/trilhaordem.js';
import { decksLiberados } from '/web/js/decksnpc.js';
import { requireLogin } from '/web/js/auth.js';

const $ = (id) => document.getElementById(id);
const ART = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
const ART_P = (id) => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;

let db = null;
const nameOf = (id) => db?.brief(id)?.name ?? String(id);

let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------ estado
let campanhas = [];        // nomes, na ordem em que aparecem
let iCampanha = 0;
let vencidos = new Set();  // ids que este jogador já derrotou
let drops = {};            // conteudo/npc-drops normalizado
let ordemPublicada = {};   // conteudo/npc-trilha: { campanha: [id, …] }
let deckVencido = {};      // { npcId: Set<nome de deck já derrotado> }
const escolhaDeDeck = {};  // { npcId: nome } — qual deck o jogador selecionou
let listaAberta = false;   // o seletor "▾" do painel está aberto?
let noPainel = null;       // de qual adversário é o painel desenhado agora
let fixado = null;         // o adversário "preso" no painel por clique

/** Os adversários de uma campanha, na ordem da trilha. */
function daCampanha(nome) {
  const dela = NPCS.filter((n) => (n.campaign || 'Sem campanha') === nome);
  return ordenarCampanha(dela, ordemPublicada[nome]);
}

// ------------------------------------------------------------------ painel
function limparPainel() {
  const p = $('painel');
  listaAberta = false;
  p.classList.add('vazio');
  p.innerHTML = '<div class="instrucao">Passe o mouse por um quadro <b>liberado</b> da trilha'
    + '<br>para ver o adversário.</div>';
}

/** Escapa texto de quem edita — a dificuldade é campo livre e vai para innerHTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Os decks do adversário, na ordem da cadeia e com o cadeado resolvido.
 * Um deck só destranca depois que o deck que aponta para ele cai (`#libera`).
 */
function decksDo(npc) {
  return decksLiberados(getNpcDecks(npc.id), deckVencido[npc.id] ?? new Set());
}

/** O deck que o painel mostra: o escolhido no seletor, ou o primeiro liberado. */
function deckAtual(npc) {
  const lista = decksDo(npc);
  if (!lista.length) return null;

  const querido = escolhaDeDeck[npc.id];
  const achado = querido ? lista.find((x) => x.deck.name === querido && x.aberto) : null;
  if (achado) return achado.deck;

  // Sem escolha (ou escolha que trancou de novo): o primeiro ABERTO da cadeia.
  // O deck ativo do NPC entra só como desempate — ele é a preferência do admin
  // para quem chega pelo caminho curto, e não pode furar o cadeado.
  const ativo = getNpcActiveDeck(npc.id);
  const ativoAberto = ativo ? lista.find((x) => x.deck.name === ativo.name && x.aberto) : null;
  return (ativoAberto ?? lista.find((x) => x.aberto) ?? lista[0]).deck;
}

function mostrarPainel(npc) {
  const p = $('painel');
  noPainel = npc;
  const lista = decksDo(npc);
  const deck = deckAtual(npc);
  const cover = deck?.coverId ?? deck?.signatureId ?? npc.signatureId;
  const temDeck = deck && deck.deck && deck.deck.main.length > 0;
  const cfg = dropsDoDeck(drops, npc.id, deck?.name);
  const venceu = vencidos.has(npc.id);
  const venceuEste = (deckVencido[npc.id] ?? new Set()).has(deck?.name);
  // O "▾" só faz sentido com mais de um deck: com um só ele abriria uma lista
  // de um item e prometeria uma escolha que não existe.
  const temEscolha = lista.length > 1;

  p.classList.remove('vazio');
  p.innerHTML =
    `<div class="titulo${temEscolha ? ' com-seletor' : ''}" ${temEscolha ? 'id="pn-titulo" tabindex="0" role="button"' : ''}>`
      + `<span class="nm">${esc(deck?.name ?? '(sem deck)')}</span>`
      + (temEscolha ? `<span class="seta">${listaAberta ? '▴' : '▾'}</span>` : '')
      + `<span class="adv">${esc(npc.name)}</span>`
      + (deck?.dificuldade ? `<span class="dif">${esc(deck.dificuldade)}</span>` : '')
    + '</div>'
    + (listaAberta && temEscolha ? listaDeDecks(npc, lista, deck) : '')
    + `<div class="arte" style="${cover ? `background-image:url('${ART(cover)}')` : ''}"></div>`
    + '<div class="info">'
      + `<span>tema: <b>${esc(npc.theme ?? '—')}</b></span>`
      + `<span>cartas no deck: <b>${temDeck ? deck.deck.main.length : 0}</b></span>`
      + `<span>recompensa: <b>${npc.rewardDp ?? deck?.rewardDp ?? 100} DP</b></span>`
      + (cfg
          ? `<span>drop: <b>${cfg.quantidade} carta(s)</b> de um pool de ${totalDoPool(cfg.pool)}</span>`
          : '<span>drop: a carta de assinatura</span>')
      + (npcLevel(npc) === 'avancado'
          ? '<span class="aviso">▲ avançado — lê a sua mão</span>' : '')
      + (venceuEste ? '<span style="color:var(--green,#3fd68a)">✔ este deck já foi vencido</span>'
         : venceu ? '<span style="color:var(--green,#3fd68a)">✔ adversário já vencido</span>' : '')
    + '</div>'
    + '<div class="acoes">'
      + `<button class="btn-primary" id="pn-duelar" ${temDeck ? '' : 'disabled'}>`
        + (temDeck ? 'duelar' : 'sem deck (monte na Área de Teste)')
      + '</button>'
      + `<button id="pn-drops" ${cfg ? '' : 'disabled'}>visualizar lista de drops</button>`
    + '</div>';

  if (temEscolha) {
    const abre = () => { listaAberta = !listaAberta; mostrarPainel(npc); };
    $('pn-titulo').onclick = abre;
    $('pn-titulo').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abre(); }
    };
    for (const b of p.querySelectorAll('[data-deck]')) {
      b.onclick = () => {
        if (b.dataset.trancado === '1') return void toast('vença o deck anterior para liberar este');
        escolhaDeDeck[npc.id] = b.dataset.deck;
        listaAberta = false;
        mostrarPainel(npc);
      };
    }
  }

  $('pn-duelar').onclick = () => {
    if (!temDeck) return;
    // O nome do deck viaja na URL e daí para o banco: é ele que decide de que
    // pool o drop sai e qual deck a vitória destranca.
    location.href = `/web/duel.html?npc=${encodeURIComponent(npc.id)}`
      + `&deck=${encodeURIComponent(deck.name)}`;
  };
  $('pn-drops').onclick = () => abrirDrops(npc, cfg, deck?.name);
}

/**
 * A lista do seletor. Cada deck mostra o rótulo de dificuldade e, quando
 * trancado, o cadeado — sem revelar o pool nem o tamanho, pela mesma razão do
 * quadro trancado na trilha: entregaria de graça o que ainda não foi ganho.
 */
function listaDeDecks(npc, lista, atual) {
  const linhas = lista.map(({ deck, aberto }) => {
    const eu = deck.name === atual?.name;
    const ganho = (deckVencido[npc.id] ?? new Set()).has(deck.name);
    return `<button class="deck-op${eu ? ' atual' : ''}${aberto ? '' : ' trancado'}"`
      + ` data-deck="${esc(deck.name)}" data-trancado="${aberto ? '0' : '1'}">`
      + `<span class="nm">${aberto ? esc(deck.name) : '🔒 ' + esc(deck.name)}</span>`
      + (deck.dificuldade ? `<span class="dif">${esc(deck.dificuldade)}</span>` : '')
      + (ganho ? '<span class="ok">✔</span>' : '')
      + '</button>';
  }).join('');
  return `<div class="deck-lista">${linhas}</div>`;
}

// ------------------------------------------------------------- lista de drops
/**
 * A lista de drops com a CHANCE de cada raridade e o que já caiu.
 *
 * A chance sai de `chancesDe`, a mesma conta que o servidor usa para sortear —
 * renormalizada entre as gavetas que têm carta. Repetir o número aqui à mão
 * seria prometer na tela o que o sorteio não cumpre.
 *
 * "Já dropamos" é lido da COLEÇÃO: uma carta que você tem pode ter vindo de um
 * booster, e ainda assim marcá-la é o que o jogador quer saber ("falta esta").
 */
function abrirDrops(npc, cfg, nomeDoDeck) {
  if (!cfg) return;
  // O pool e' do DECK, entao o titulo diz de qual — dois decks do mesmo
  // adversario largam coisas diferentes, e so' "Drops — Para & Dox" mentiria
  // sobre qual lista esta' na tela.
  $('drops-titulo').textContent = nomeDoDeck
    ? `Drops — ${npc.name} · ${nomeDoDeck}` : `Drops — ${npc.name}`;

  // As gavetas sao as MESMAS da Loja (`gavetas.js`): a pergunta do jogador e'
  // a mesma nos dois lugares, e duas copias da caixa divergiriam calado.
  const resumo = renderGavetas($('drops-corpo'), cfg.pool, {
    nomeDe: nameOf,
    arte: ART_P,
    chances: chancesDe(cfg.pool),
  });

  $('drops-sub').innerHTML =
    `${cfg.quantidade} carta(s) por vitória, sorteadas de um pool de ${totalDoPool(cfg.pool)}. `
    + 'A raridade é sorteada primeiro (pelas chances abaixo), a carta depois. '
    + '<b style="color:var(--green,#3fd68a)">✔</b> = já está na sua Coleção — '
    + fraseDaColecao(resumo);

  $('drops-back').classList.add('show');
}

// ------------------------------------------------------------------ trilha
const POR_LINHA = 4;

function render() {
  const nome = campanhas[iCampanha] ?? '—';
  $('camp-nome').textContent = nome;
  $('camp-conta').textContent = campanhas.length > 1
    ? `${iCampanha + 1}/${campanhas.length}` : '';
  $('camp-ant').disabled = campanhas.length < 2;
  $('camp-prox').disabled = campanhas.length < 2;

  const lista = daCampanha(nome);
  const abertos = liberados(lista, vencidos);
  const trilha = $('trilha');
  trilha.replaceChildren();
  fixado = null;
  limparPainel();

  if (!lista.length) {
    trilha.innerHTML = '<div style="color:var(--dim);font-size:12px">'
      + 'Esta campanha ainda não tem adversário. Crie um na Área de Teste e dê a ele esta campanha.</div>';
    return;
  }

  for (let inicio = 0; inicio < lista.length; inicio += POR_LINHA) {
    const fatia = lista.slice(inicio, inicio + POR_LINHA);
    const linha = document.createElement('div');
    // Serpentina: as linhas ímpares correm ao contrário, e o caminho fecha.
    linha.className = 'linha' + ((inicio / POR_LINHA) % 2 ? ' invertida' : '');

    fatia.forEach((npc, k) => {
      const i = inicio + k;
      const aberto = abertos[i];
      const venceu = vencidos.has(npc.id);
      const deck = aberto ? getNpcActiveDeck(npc.id) : null;
      const cover = deck?.coverId ?? deck?.signatureId ?? npc.signatureId;

      const no = document.createElement('div');
      no.className = 'no ' + (aberto ? (venceu ? 'aberto vencido' : 'aberto') : 'trancado');
      // O conector: para o lado enquanto houver próximo NA LINHA, para baixo no
      // último de cada linha que ainda tem trilha embaixo.
      if (i < lista.length - 1) no.classList.add(k < fatia.length - 1 ? 'liga-lado' : 'liga-baixo');
      if (aberto && cover) no.style.backgroundImage = `url('${ART(cover)}')`;
      no.innerHTML = (aberto ? '' : '<span class="cadeado">🔒</span>')
        + (venceu ? '<span class="selo">✔</span>' : '')
        + `<span class="rotulo">${aberto ? npc.name : '???'}</span>`;

      if (aberto) {
        no.onmouseenter = () => {
          if (fixado) return;
          if (noPainel !== npc) listaAberta = false;
          mostrarPainel(npc);
        };
        no.onmouseleave = () => { if (!fixado) limparPainel(); };
        // Clique FIXA o painel: sem isso, andar com o mouse até o botão
        // "duelar" passa por fora do quadro e o painel se fecha no caminho.
        no.onclick = () => {
          if (noPainel !== npc) listaAberta = false;
          fixado = npc;
          mostrarPainel(npc);
        };
      } else {
        no.onclick = () => toast('vença o adversário anterior para liberar este');
      }
      linha.append(no);
    });
    trilha.append(linha);
  }
}

// ------------------------------------------------------------------ boot
if (!(await requireLogin())) throw new Error('sem sessão');

$('btn-home').onclick = () => { location.href = '/web/index.html'; };
$('drops-fechar').onclick = () => $('drops-back').classList.remove('show');
$('drops-back').onclick = (e) => { if (e.target === $('drops-back')) $('drops-back').classList.remove('show'); };
$('camp-ant').onclick = () => { iCampanha = (iCampanha - 1 + campanhas.length) % campanhas.length; render(); };
$('camp-prox').onclick = () => { iCampanha = (iCampanha + 1) % campanhas.length; render(); };
// Clicar fora da trilha solta o painel fixado.
$('palco').onclick = (e) => { if (e.target === $('palco')) { fixado = null; limparPainel(); } };

try { db = await YgoDB.load('/ygo-data/data', { full: false }); } catch { /* sem arte/nome */ }

/**
 * O carregamento morria CALADO. Este bloco é `await`-atrás-de-`await` num
 * módulo com top-level await: qualquer rejeição aborta o módulo inteiro, e o
 * `render()` no fim nunca roda. O que o jogador vê é a moldura estática da
 * página — barra de campanha em "—", trilha vazia — que é indistinguível de
 * "esta campanha não tem adversário". Nenhum aviso, nenhum toast: a mesma
 * classe de falha silenciosa que o `pushFile` tinha ao publicar.
 *
 * Agora a falha aparece NA TELA, com a etapa em que caiu — sem isso, quem
 * relata "não aparece nada" não tem o que contar, e quem investiga não tem
 * onde olhar.
 */
async function carregar() {
  await hydrateWallet();
  $('dp').textContent = `${getDP()} DP`;

  await hydrateCustomNpcs();
  await loadNpcDecks();
  let ordem;
  [vencidos, drops, ordem, deckVencido] = await Promise.all([
    npcsVencidos(), carregarDrops(), pullFile('npc-trilha'), decksVencidos(),
  ]);
  ordemPublicada = (ordem && typeof ordem === 'object') ? ordem : {};

  // "Sem campanha" entra como uma trilha própria — quem ainda não organizou os
  // adversários continua conseguindo jogar.
  campanhas = listCampaignNames();
  if (NPCS.some((n) => !n.campaign)) campanhas.push('Sem campanha');
  if (!campanhas.length) campanhas = ['Sem campanha'];

  render();
}

try {
  await carregar();
} catch (e) {
  console.error('[trilha] o carregamento falhou:', e);
  $('trilha').innerHTML =
    '<div style="color:var(--gold);font-size:12px;line-height:1.7;max-width:52ch">'
    + '<b>Não consegui carregar a trilha.</b><br>'
    + 'Isto não é "campanha vazia" — o carregamento parou no meio, então nenhum '
    + 'adversário chegou a ser desenhado.<br><br>'
    + `<span style="color:var(--dim)">${String(e?.message || e).replace(/[<>]/g, '')}</span><br><br>`
    + '<span style="color:var(--dim)">Quase sempre é a conexão com o servidor de '
    + 'conteúdo. Tente de novo; se insistir, veja o console (F12).</span>'
    + '</div>';
  toast('não consegui carregar a trilha');
}
