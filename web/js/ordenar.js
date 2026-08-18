/**
 * **Ordenar Trilha** (Área de Teste) — quem libera quem.
 *
 * A Trilha de Duelos põe os adversários de uma campanha em fila, e cada um abre
 * o seguinte ao ser vencido. Até aqui essa fila era a ordem de CRIAÇÃO, que
 * ninguém controla depois: criar um adversário novo o jogava para o fim, e
 * mudar de ideia sobre a sequência era impossível sem recriar tudo.
 *
 * Aqui o admin arrasta e publica. A ordem vai para `conteudo/npc-trilha`
 * (migration 0032), na forma `{ campanha: [id, id, …] }` — **por id**, nunca
 * por índice: índice muda de significado quando um adversário novo entra na
 * campanha, e trocaria a trilha de todo mundo sem ninguém mexer em nada. Foi
 * exatamente a armadilha do deck ativo (migration 0030).
 *
 * A ordenação em si é a `ordenarCampanha` de `trilhaordem.js` — a MESMA função
 * que a trilha usa para desenhar. Duas cópias divergiriam em silêncio, e o
 * sintoma seria "ordenei e no jogo está diferente".
 */
import { NPCS, hydrateCustomNpcs, loadNpcDecks, getNpcActiveDeck, listCampaignNames } from '/web/js/npcs.js';
import { ordenarCampanha } from '/web/js/trilhaordem.js';
import { pullFile, pushFile, aoGravar } from '/web/js/projectstore.js';
import { requireLogin } from '/web/js/auth.js';

const $ = (id) => document.getElementById(id);
const ART = (id) => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;
const CHAVE = 'npc-trilha';

let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3000);
}

let campanhas = [];
let iCampanha = 0;
let ordem = {};        // { campanha: [id, …] } — o que será publicado
let atual = [];        // os NPCs da campanha aberta, na ordem da tela
let arrastando = null;

const nomeCampanhaAtual = () => campanhas[iCampanha] ?? 'Sem campanha';

/** A cadeia em texto, do jeito que o pedido descreve: [a -> b] [b -> c]. */
function renderCadeia() {
  const c = $('cadeia');
  if (atual.length < 2) {
    c.textContent = atual.length ? 'um adversário só — não há trilha a ordenar.' : '—';
    return;
  }
  c.innerHTML = atual.slice(0, -1).map((n, i) =>
    `<span>[<b>${n.name}</b><span class="seta">→</span><b>${atual[i + 1].name}</b>]</span>`).join(' ');
}

function renderLista() {
  const alvo = $('lista');
  alvo.replaceChildren();

  if (!atual.length) {
    alvo.innerHTML = '<div class="vazio">Nenhum adversário nesta campanha. '
      + 'Crie um em "Adversários (NPCs)" e dê a ele esta campanha.</div>';
    renderCadeia();
    return;
  }

  atual.forEach((npc, i) => {
    const deck = getNpcActiveDeck(npc.id);
    const cover = deck?.coverId ?? deck?.signatureId ?? npc.signatureId;
    const el = document.createElement('div');
    el.className = 'item';
    el.draggable = true;
    el.dataset.i = String(i);
    el.innerHTML =
      `<span class="pos">${i + 1}</span>`
      + `<span class="art" style="${cover ? `background-image:url('${ART(cover)}')` : ''}"></span>`
      + '<span class="quem">'
        + `<span class="nome">${npc.name}</span>`
        + `<span class="sub">${deck?.name ?? '(sem deck)'} · ${npc.theme ?? '—'}</span>`
      + '</span>'
      + '<span class="mover">'
        + `<button data-sobe ${i === 0 ? 'disabled' : ''} title="subir">▲</button>`
        + `<button data-desce ${i === atual.length - 1 ? 'disabled' : ''} title="descer">▼</button>`
      + '</span>';

    // ▲▼ além do arrasto: arrastar é bom com o mouse e péssimo com o teclado —
    // e é o único caminho quando a lista não cabe na tela.
    el.querySelector('[data-sobe]').onclick = () => trocar(i, i - 1);
    el.querySelector('[data-desce]').onclick = () => trocar(i, i + 1);

    el.ondragstart = (e) => {
      arrastando = i; el.classList.add('arrastando');
      e.dataTransfer.effectAllowed = 'move';
      // O Firefox só começa o arrasto se houver dado no evento.
      e.dataTransfer.setData('text/plain', String(i));
    };
    el.ondragend = () => { arrastando = null; renderLista(); };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('alvo'); };
    el.ondragleave = () => el.classList.remove('alvo');
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove('alvo');
      const de = arrastando ?? Number(e.dataTransfer.getData('text/plain'));
      mover(de, i);
    };
    alvo.append(el);
  });
  renderCadeia();
}

function trocar(a, b) {
  if (b < 0 || b >= atual.length) return;
  [atual[a], atual[b]] = [atual[b], atual[a]];
  marcarSujo();
  renderLista();
}

/** Tira de `de` e põe em `para` — arrastar é mover, não trocar de lugar. */
function mover(de, para) {
  if (de == null || de === para || de < 0 || de >= atual.length) return;
  const [x] = atual.splice(de, 1);
  atual.splice(para, 0, x);
  marcarSujo();
  renderLista();
}

let sujo = false;
function marcarSujo() {
  sujo = true;
  $('estado').textContent = 'ordem mudada — publique para valer no jogo';
  $('estado').style.color = 'var(--gold)';
}

function abrirCampanha() {
  const nome = nomeCampanhaAtual();
  $('camp-nome').textContent = nome;
  $('camp-conta').textContent = campanhas.length > 1 ? `${iCampanha + 1}/${campanhas.length}` : '';
  $('camp-ant').disabled = campanhas.length < 2;
  $('camp-prox').disabled = campanhas.length < 2;

  const dela = NPCS.filter((n) => (n.campaign || 'Sem campanha') === nome);
  atual = ordenarCampanha(dela, ordem[nome]);
  sujo = false;
  $('estado').textContent = '';
  renderLista();
}

async function publicar() {
  const nome = nomeCampanhaAtual();
  ordem[nome] = atual.map((n) => n.id);

  $('estado').textContent = 'publicando…';
  $('estado').style.color = 'var(--dim)';

  const r = await new Promise((resolve) => {
    aoGravar(CHAVE, (res) => { aoGravar(CHAVE, null); resolve(res); });
    pushFile(CHAVE, ordem);
  });

  if (r?.banco && !r.banco.ok) {
    $('estado').textContent = `NÃO publicado: ${r.banco.erro}`;
    $('estado').style.color = 'var(--red)';
    toast(`a ordem NÃO foi publicada: ${r.banco.erro}`);
    return;
  }
  sujo = false;
  $('estado').textContent = `publicado — ${atual.length} adversário(s) em "${nome}"`;
  $('estado').style.color = 'var(--green, #3fd68a)';
  toast('ordem publicada: já vale para todo mundo');
}

function trocarCampanha(passo) {
  if (sujo && !confirm('A ordem desta campanha mudou e não foi publicada. Sair mesmo assim?')) return;
  iCampanha = (iCampanha + passo + campanhas.length) % campanhas.length;
  abrirCampanha();
}

// ------------------------------------------------------------------ boot
if (!(await requireLogin())) throw new Error('sem sessão');

$('btn-voltar').onclick = () => { location.href = '/web/teste.html'; };
$('camp-ant').onclick = () => trocarCampanha(-1);
$('camp-prox').onclick = () => trocarCampanha(1);
$('btn-publicar').onclick = publicar;
// Fechar a aba com ordem não publicada é perder o trabalho em silêncio.
window.addEventListener('beforeunload', (e) => { if (sujo) { e.preventDefault(); e.returnValue = ''; } });

await hydrateCustomNpcs();
await loadNpcDecks();
const publicada = await pullFile(CHAVE);
ordem = (publicada && typeof publicada === 'object') ? publicada : {};

campanhas = listCampaignNames();
if (NPCS.some((n) => !n.campaign)) campanhas.push('Sem campanha');
if (!campanhas.length) campanhas = ['Sem campanha'];

abrirCampanha();
