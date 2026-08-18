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
  NPCS, loadNpcDecks, getNpcActiveDeck, hydrateCustomNpcs, listCampaignNames, npcLevel,
} from '/web/js/npcs.js';
import { getDP, hydrateWallet, npcsVencidos, ownsCard, ownedCount } from '/web/js/wallet.js';
import { carregarDrops, dropsDoNpc, chancesDe, RARIDADES, totalDoPool } from '/web/js/drops.js';
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
let fixado = null;         // o adversário "preso" no painel por clique

/** Os adversários de uma campanha, na ordem da trilha. */
function daCampanha(nome) {
  const dela = NPCS.filter((n) => (n.campaign || 'Sem campanha') === nome);
  // `ordem` quando existir; senão a ordem da lista, que é a de criação. O
  // `?? Infinity` mantém quem não tem `ordem` DEPOIS de quem tem, em vez de
  // jogá-lo para o começo com um zero implícito.
  return dela
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (a.n.ordem ?? Infinity) - (b.n.ordem ?? Infinity) || a.i - b.i)
    .map((x) => x.n);
}

/**
 * Um adversário está LIBERADO quando é o primeiro da trilha ou quando o
 * anterior já foi vencido. Vencer fora de ordem (num link direto, por exemplo)
 * também libera: o que abre o próximo é a vitória, não o caminho até ela.
 */
function liberados(lista) {
  const out = [];
  let podeOProximo = true;
  for (const npc of lista) {
    const aberto = podeOProximo || vencidos.has(npc.id);
    out.push(aberto);
    podeOProximo = aberto && vencidos.has(npc.id);
  }
  return out;
}

// ------------------------------------------------------------------ painel
function limparPainel() {
  const p = $('painel');
  p.classList.add('vazio');
  p.innerHTML = '<div class="instrucao">Passe o mouse por um quadro <b>liberado</b> da trilha'
    + '<br>para ver o adversário.</div>';
}

function mostrarPainel(npc) {
  const p = $('painel');
  const deck = getNpcActiveDeck(npc.id);
  const cover = deck?.coverId ?? deck?.signatureId ?? npc.signatureId;
  const temDeck = deck && deck.deck && deck.deck.main.length > 0;
  const cfg = dropsDoNpc(drops, npc.id);
  const venceu = vencidos.has(npc.id);

  p.classList.remove('vazio');
  p.innerHTML =
    `<div class="titulo">${deck?.name ?? '(sem deck)'}<span class="adv">${npc.name}</span></div>`
    + `<div class="arte" style="${cover ? `background-image:url('${ART(cover)}')` : ''}"></div>`
    + '<div class="info">'
      + `<span>tema: <b>${npc.theme ?? '—'}</b></span>`
      + `<span>cartas no deck: <b>${temDeck ? deck.deck.main.length : 0}</b></span>`
      + `<span>recompensa: <b>${npc.rewardDp ?? deck?.rewardDp ?? 100} DP</b></span>`
      + (cfg
          ? `<span>drop: <b>${cfg.quantidade} carta(s)</b> de um pool de ${totalDoPool(cfg.pool)}</span>`
          : '<span>drop: a carta de assinatura</span>')
      + (npcLevel(npc) === 'avancado'
          ? '<span class="aviso">▲ avançado — lê a sua mão</span>' : '')
      + (venceu ? '<span style="color:var(--green,#3fd68a)">✔ já vencido</span>' : '')
    + '</div>'
    + '<div class="acoes">'
      + `<button class="btn-primary" id="pn-duelar" ${temDeck ? '' : 'disabled'}>`
        + (temDeck ? 'duelar' : 'sem deck (monte na Área de Teste)')
      + '</button>'
      + `<button id="pn-drops" ${cfg ? '' : 'disabled'}>visualizar lista de drops</button>`
    + '</div>';

  $('pn-duelar').onclick = () => { if (temDeck) location.href = `/web/duel.html?npc=${npc.id}`; };
  $('pn-drops').onclick = () => abrirDrops(npc, cfg);
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
function abrirDrops(npc, cfg) {
  if (!cfg) return;
  const pct = chancesDe(cfg.pool);
  $('drops-titulo').textContent = `Drops — ${npc.name}`;
  $('drops-sub').innerHTML =
    `${cfg.quantidade} carta(s) por vitória, sorteadas de um pool de ${totalDoPool(cfg.pool)}. `
    + 'A raridade é sorteada primeiro (pelas chances abaixo), a carta depois. '
    + '<b style="color:var(--green,#3fd68a)">✔</b> = já está na sua Coleção.';

  const corpo = $('drops-corpo');
  corpo.replaceChildren();
  for (const r of RARIDADES) {
    const ids = cfg.pool[r] ?? [];
    if (!ids.length) continue;
    const g = document.createElement('div');
    g.className = `gaveta ${r}`;
    g.innerHTML = `<h3>${r} <span class="pct">${pct[r]}% de chance · ${ids.length} carta(s)</span></h3>`;
    const cartas = document.createElement('div');
    cartas.className = 'cartas';
    for (const id of ids) {
      const tem = ownsCard(id);
      const c = document.createElement('div');
      c.className = `carta${tem ? ' tenho' : ''}`;
      c.title = nameOf(id) + (tem ? ` — você tem ${ownedCount(id)}` : ' — ainda não caiu');
      c.innerHTML = `<img src="${ART_P(id)}" alt="" loading="lazy">`
        + (tem ? '<span class="marca">✔</span>' : '')
        + `<div class="nm">${nameOf(id)}</div>`;
      cartas.append(c);
    }
    g.append(cartas);
    corpo.append(g);
  }
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
  const abertos = liberados(lista);
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
        no.onmouseenter = () => { if (!fixado) mostrarPainel(npc); };
        no.onmouseleave = () => { if (!fixado) limparPainel(); };
        // Clique FIXA o painel: sem isso, andar com o mouse até o botão
        // "duelar" passa por fora do quadro e o painel se fecha no caminho.
        no.onclick = () => { fixado = npc; mostrarPainel(npc); };
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

await hydrateWallet();
$('dp').textContent = `${getDP()} DP`;

await hydrateCustomNpcs();
await loadNpcDecks();
[vencidos, drops] = await Promise.all([npcsVencidos(), carregarDrops()]);

// "Sem campanha" entra como uma trilha própria — quem ainda não organizou os
// adversários continua conseguindo jogar.
campanhas = listCampaignNames();
if (NPCS.some((n) => !n.campaign)) campanhas.push('Sem campanha');
if (!campanhas.length) campanhas = ['Sem campanha'];

render();
