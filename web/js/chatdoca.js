/**
 * **A DOCA DE CHATS** — as janelinhas que ficam no rodapé da home.
 *
 * O desenho pedido: mais de uma conversa aberta ao mesmo tempo, lado a lado; ao
 * minimizar uma, as outras **se grudam mais na lateral**. É isso que este
 * arquivo faz e é só isso: ele não sabe o que é chat global nem o que é amigo —
 * recebe uma `chave`, um título e quem manda/lê, e cuida de janela.
 *
 * POR QUE UM MÓDULO, e não mais um pedaço do `index.html`: a home já tem 1000
 * linhas de script, e a doca é a única parte dela com estado próprio (quais
 * janelas existem, quais estão minimizadas, quantas mensagens cada uma tem). O
 * `index.html` passa a só dizer "abra a conversa X" — que é a decisão dele.
 *
 * O QUE ELE NÃO FAZ, de propósito: não guarda mensagem em `localStorage`. A
 * conversa mora no banco e é lida de lá; um espelho local seria uma segunda
 * fonte para a mesma coisa, e as duas se desencontrariam no primeiro reload.
 */
import { enviar, ler, juntar, ultimoId, valeMandar, MAX_TEXTO, RESERVA_MS } from './chat.js';

/** As janelas vivas, por chave. Ordem = ordem de abertura (a doca é `row`). */
const janelas = new Map();

let raiz = null;
let aoTerMensagemNova = () => {};

/**
 * Prepara a doca. `aviso` é chamado quando chega mensagem numa janela
 * MINIMIZADA — é o que acende o contador do botão sem abrir nada na cara de
 * quem está jogando.
 */
export function montarDoca(elemento, aviso = () => {}) {
  raiz = elemento;
  aoTerMensagemNova = aviso;
}

/** Quantas mensagens não lidas há na conversa (0 quando ela está aberta). */
export const naoLidas = (chave) => janelas.get(chave)?.naoLidas ?? 0;

/** A conversa está aberta (não minimizada)? */
export const estaAberta = (chave) => !!janelas.get(chave) && !janelas.get(chave).minimizada;

/**
 * Abre (ou traz de volta) uma conversa.
 *
 * @param chave   identidade da conversa: 'global' ou o id do amigo.
 * @param titulo  o que aparece na barra.
 * @param para    o `p_para` do banco: null no global, o id do amigo na conversa.
 * @param icone   um caractere para a barra (o globo do chat global, por exemplo).
 * @param euSou   o id do usuário atual — é o que separa "minha mensagem" das outras.
 */
export function abrirConversa({ chave, titulo, para, icone = '💬', euSou = null }) {
  if (!raiz) return;

  const existente = janelas.get(chave);
  if (existente) {
    // Já existe: o clique no botão é um interruptor. Minimizada, volta; aberta,
    // minimiza. Reabrir do zero perderia o que já estava carregado e a rolagem.
    existente.minimizada = !existente.minimizada;
    if (!existente.minimizada) { existente.naoLidas = 0; existente.relerAgora(); }
    pintar(existente);
    reordenar();
    return;
  }

  const j = {
    chave, titulo, para, icone, euSou,
    minimizada: false,
    mensagens: [],
    naoLidas: 0,
    erro: null,
    el: document.createElement('div'),
    timer: null,
    relerAgora: () => {},
  };
  j.el.className = 'chatjanela';
  janelas.set(chave, j);
  construir(j);
  raiz.append(j.el);
  reordenar();

  // A releitura é por JANELA e só enquanto ela está aberta: uma minimizada não
  // consulta nada. Com quatro conversas abertas isso é uma consulta a cada 8s
  // cada, e não uma a cada 8s vezes o histórico inteiro — o `desde` faz cada
  // releitura trazer só o que chegou depois da última.
  const reler = async () => {
    if (j.minimizada) return;
    const r = await ler(j.para, ultimoId(j.mensagens));
    if (!janelas.has(chave)) return;              // fecharam no meio da viagem
    if (!r.ok) { j.erro = r.erro; pintar(j); return; }
    j.erro = null;
    if (r.mensagens.length) {
      j.mensagens = juntar(j.mensagens, r.mensagens);
      pintar(j);
    }
  };
  j.relerAgora = reler;
  reler();
  j.timer = setInterval(reler, RESERVA_MS);
}

/**
 * Avisa a doca de que chegou mensagem (o Realtime). Ela não recebe a linha: só
 * o aviso de "leia de novo", como as notificações — quem monta a conversa é o
 * RPC, que traz o nome de quem falou junto.
 *
 * A janela MINIMIZADA também relê, e é de propósito: é assim que o contador de
 * não lidas dela sobe. O que ela não faz é abrir sozinha.
 */
export function chegouAlgo() {
  for (const j of janelas.values()) {
    if (!j.minimizada) { j.relerAgora(); continue; }
    lerMinimizada(j);
  }
}

async function lerMinimizada(j) {
  const r = await ler(j.para, ultimoId(j.mensagens));
  if (!janelas.has(j.chave) || !r.ok || !r.mensagens.length) return;
  const antes = j.mensagens.length;
  j.mensagens = juntar(j.mensagens, r.mensagens);
  j.naoLidas += j.mensagens.length - antes;
  aoTerMensagemNova(j.chave, j.naoLidas);
  pintar(j);
}

/** Fecha e para de reler. */
export function fecharConversa(chave) {
  const j = janelas.get(chave);
  if (!j) return;
  clearInterval(j.timer);
  j.el.remove();
  janelas.delete(chave);
  reordenar();
}

/** Fecha tudo (troca de tela, logout). */
export function fecharTudo() {
  for (const chave of [...janelas.keys()]) fecharConversa(chave);
}

// ------------------------------------------------------------------ desenho

function construir(j) {
  j.el.innerHTML =
      '<div class="cj-barra">'
    +   '<span class="cj-ic"></span><span class="cj-tit"></span>'
    +   '<span class="cj-n"></span>'
    +   '<button class="cj-min" title="minimizar">—</button>'
    +   '<button class="cj-x" title="fechar">×</button>'
    + '</div>'
    + '<div class="cj-corpo"></div>'
    + '<div class="cj-erro"></div>'
    + '<form class="cj-pe"><input type="text" maxlength="' + MAX_TEXTO
    +   '" placeholder="escreva…" autocomplete="off"></form>';

  j.el.querySelector('.cj-ic').textContent = j.icone;
  j.el.querySelector('.cj-tit').textContent = j.titulo;

  // A BARRA INTEIRA minimiza. Com a janela minimizada só ela sobra na tela, e
  // exigir o alvo de 12px do "—" para trazê-la de volta seria uma armadilha.
  j.el.querySelector('.cj-barra').onclick = (e) => {
    if (e.target.closest('.cj-x')) return;
    j.minimizada = !j.minimizada;
    if (!j.minimizada) { j.naoLidas = 0; j.relerAgora(); }
    pintar(j);
    reordenar();
  };
  j.el.querySelector('.cj-x').onclick = (e) => { e.stopPropagation(); fecharConversa(j.chave); };

  const form = j.el.querySelector('.cj-pe');
  const campo = form.querySelector('input');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const texto = campo.value;
    if (!valeMandar(texto)) { campo.value = ''; return; }

    // O campo é limpo ANTES da resposta, e o texto guardado: quem escreveu já
    // seguiu para a próxima frase. Falhando, ele volta para o campo — perder o
    // que foi digitado por causa de uma falha de rede é o pior desfecho aqui.
    campo.value = '';
    campo.disabled = true;
    const r = await enviar(j.para, texto);
    campo.disabled = false;
    campo.focus();
    if (!r.ok) {
      j.erro = r.erro;
      campo.value = texto;
      pintar(j);
      return;
    }
    j.erro = null;
    // Relê na hora em vez de escrever a própria mensagem na lista: a que vem do
    // banco tem id, horário e nome — os mesmos de todas as outras. Uma cópia
    // local ficaria diferente das demais e duplicaria quando a de verdade
    // chegasse.
    j.relerAgora();
  };
}

function pintar(j) {
  j.el.classList.toggle('min', j.minimizada);

  const n = j.el.querySelector('.cj-n');
  n.textContent = j.naoLidas > 0 ? String(j.naoLidas) : '';
  n.classList.toggle('tem', j.naoLidas > 0);

  const erro = j.el.querySelector('.cj-erro');
  erro.textContent = j.erro ?? '';
  erro.classList.toggle('tem', !!j.erro);

  if (j.minimizada) return;   // o corpo está escondido; redesenhá-lo é trabalho à toa

  const corpo = j.el.querySelector('.cj-corpo');
  // "Estava no fim" é medido ANTES de redesenhar: quem subiu para reler algo
  // não pode ser arrastado de volta para baixo a cada mensagem que chega.
  const noFim = corpo.scrollHeight - corpo.scrollTop - corpo.clientHeight < 24;

  const frag = document.createDocumentFragment();
  if (!j.mensagens.length) {
    frag.append(Object.assign(document.createElement('div'),
      { className: 'cj-vazio', textContent: 'ninguém falou nada ainda.' }));
  }
  for (const m of j.mensagens) {
    const linha = document.createElement('div');
    const meu = j.euSou && m.de === j.euSou;
    linha.className = 'cj-msg' + (meu ? ' meu' : '');
    // `textContent` nos DOIS pedaços: isto é texto escrito por outra pessoa, e
    // é a única entrada do jogo em que alguém digita algo que APARECE na tela
    // de terceiros. Montar com `innerHTML` seria pôr um `<script>` de um jogador
    // na home de todos os outros.
    const quem = document.createElement('b');
    quem.textContent = meu ? 'você' : (m.usuario ?? '?');
    const txt = document.createElement('span');
    txt.textContent = m.texto ?? '';
    linha.append(quem, txt);
    frag.append(linha);
  }
  corpo.replaceChildren(frag);
  if (noFim) corpo.scrollTop = corpo.scrollHeight;
}

/**
 * As minimizadas ficam encostadas na lateral e as abertas à direita delas — é o
 * "quando o outro minimizar, este se gruda mais a lateral" do desenho.
 *
 * A doca é um `flex-direction: row`, então a ordem é a do DOM: basta reinserir
 * na ordem certa. Nada de posição absoluta e conta de largura, que teria de ser
 * refeita a cada abrir, fechar e minimizar.
 */
function reordenar() {
  if (!raiz) return;
  const ordenadas = [...janelas.values()]
    .sort((a, b) => Number(b.minimizada) - Number(a.minimizada));
  for (const j of ordenadas) raiz.append(j.el);
}
