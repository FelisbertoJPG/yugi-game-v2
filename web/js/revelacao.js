/**
 * **A revelação: cartas viradas, uma a uma, com o [revelar rápido] para quem
 * não quer a cerimônia.**
 *
 * Nasceu no fim de duelo (`renderDrops`, em `web/duel.html`) e hoje serve
 * também a abertura de pacote na Loja. Mora num módulo porque as duas telas
 * fazem a MESMA promessa ao jogador — *vire para descobrir o que veio* — e duas
 * cópias de uma cerimônia divergem sem ninguém perceber: a da Loja despejava as
 * cartas já abertas, sem virada e sem o selo de novidade, e o mesmo prêmio
 * parecia valer menos vindo do pacote.
 *
 * O que este módulo NÃO faz, de propósito:
 *
 *   • **não sorteia e não credita.** Quando esta tela aparece as cartas já são
 *     do jogador — quem sorteia é o servidor (`premiar_vitoria`,
 *     `abrir_pacote`). A virada é teatro, e por isso o [revelar rápido] pode
 *     abrir tudo de uma vez sem consequência nenhuma;
 *   • **não decide o que é NOVO.** Isso depende de olhar a coleção ANTES do
 *     crédito, e cada tela tem a sua fonte (o campo `nova` do servidor, no
 *     drop; a coleção de antes da compra, na Loja). Aqui chega pronto.
 *
 * O CSS segue junto, em `web/css/revelacao.css`, pela mesma razão.
 */

/** Quanto dura a aproximação da carta revelada — o mesmo valor da animação
 *  `rev-aproxima` em `web/css/revelacao.css`. Aqui ele é só o prazo do relógio
 *  de segurança, então uma diferença de alguns milissegundos não muda nada. */
const ZOOM_MS = 900;

/** As quatro de sempre — qualquer outra coisa vira "sem raridade". */
const RARIDADES = ['UR', 'SR', 'R', 'N'];

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Desenha a grade de cartas viradas dentro de `alvo`.
 *
 * `itens` é uma lista de `{ id, raridade, nova, selo, sufixo }`:
 *   • `raridade` — 'UR'|'SR'|'R'|'N' ou nada. Ela pinta a moldura e o selo;
 *   • `nova` — mostra o "NEW!!";
 *   • `selo` — um prefixo no selo da raridade (a Loja usa '★' na garantida);
 *   • `sufixo` — texto colado no nome (a Loja usa ' (garantida)').
 *
 * Opções:
 *   • `nomeDe(id)` / `arte(id)` — cada tela tem a sua (a Loja resolve arte de
 *     carta customizada, o duelo não);
 *   • `colunas` — quantas cartas por linha, no máximo. O padrão são 7: com 50
 *     cartas de um [abrir 10] numa fileira que só quebra quando não cabe mais,
 *     elas encolhem até virar selo;
 *   • `aoAmpliar(id, i)` — o que fazer numa carta JÁ aberta (o duelo abre o
 *     detalhe da carta; a Loja não faz nada). Quando não vem, a carta aberta
 *     não responde mais a clique;
 *   • `aoTerminar()` — chamado quando a ÚLTIMA carta abre, e é o que religa os
 *     botões de saída de quem chamou;
 *   • `aoAbrir(i)` — cada abertura, para quem quiser som/log.
 *
 * Devolve `{ revelarTudo, todasAbertas, quantasAbertas, ordenar,
 * agrupadoPorRaridade }`. `revelarTudo` é o que o botão [revelar rápido] chama
 * — e ele NÃO é um atalho para `aoTerminar`: as cartas abrem de verdade, uma
 * por uma, para a tela ficar no mesmo estado dos cliques. `ordenar(true)` é o
 * [organizar por raridade] da Loja (ver o comentário dele lá embaixo).
 */
export function montarRevelacao(alvo, itens, {
  nomeDe = (id) => String(id),
  arte = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
  colunas = 7,
  aoAmpliar = null,
  aoAbrir = null,
  aoTerminar = null,
  ligarGesto = null,
} = {}) {
  alvo.replaceChildren();

  const grade = document.createElement('div');
  grade.className = 'rev-grade';
  // Menos cartas que colunas: a grade se fecha no tamanho delas em vez de
  // deixar buracos à direita, e o `justify-content:center` centraliza o
  // conjunto. Sem isto, três cartas ficavam encostadas na esquerda de uma
  // fileira de sete.
  grade.style.setProperty('--rev-cols', String(Math.max(1, Math.min(colunas, itens.length || 1))));
  alvo.append(grade);

  const abertas = new Set();
  const celulas = [];

  const abrir = (i) => {
    if (abertas.has(i)) return;
    abertas.add(i);
    const { botao, nome, item } = celulas[i];
    botao.classList.add('aberta');
    // A aproximação: a classe sai sozinha no fim da animação, senão a segunda
    // revelação da mesma carta (o [revelar rápido] depois de um clique) não
    // reanimaria — uma animação já aplicada não recomeça.
    //
    // O relógio é a rede de segurança, e não redundância: com
    // `prefers-reduced-motion` a animação é `none` e o `animationend` NUNCA
    // dispara, então a classe (com o `z-index` que ela carrega) ficaria na
    // carta para sempre. É o silêncio de sempre — nada quebra, e a pilha da
    // grade fica errada.
    botao.classList.add('rev-zoom');
    const limpar = () => botao.classList.remove('rev-zoom');
    botao.addEventListener('animationend', limpar, { once: true });
    setTimeout(limpar, ZOOM_MS);
    // O título muda junto: de "clique para revelar" para o gesto que a carta
    // aceita depois de aberta.
    botao.title = aoAmpliar
      ? `${nomeDe(item.id)}\nsegurar: ver detalhes`
      : nomeDe(item.id);
    nome.textContent = nomeDe(item.id) + (item.sufixo ?? '');
    aoAbrir?.(i);
    if (abertas.size === itens.length) aoTerminar?.();
  };

  itens.forEach((item, i) => {
    const cel = document.createElement('div');
    cel.className = 'rev-cel';

    // A raridade vira classe da FACE da frente: pinta a moldura e o selo de uma
    // vez só, e some sozinha quando ela não veio.
    const rar = RARIDADES.includes(item.raridade) ? item.raridade : null;

    const botao = document.createElement('button');
    botao.className = 'rev-carta';
    botao.title = 'clique para revelar';
    botao.innerHTML = '<span class="rev-giro">'
      + '<span class="rev-face rev-verso"><span class="rev-back"></span></span>'
      + `<span class="rev-face rev-frente${rar ? ' ' + rar : ''}">`
      +   `<img src="${arte(item.id)}" alt="">`
      +   (rar ? `<span class="rev-rar">${escapeHtml(item.selo ?? '')}${rar}</span>` : '')
      +   (item.nova ? '<span class="rev-nova">NEW!!</span>' : '')
      + '</span></span>';

    const nome = document.createElement('div');
    nome.className = 'rev-nome';

    celulas.push({ cel, botao, nome, item });

    // **Segurar amplia** — o mesmo gesto da mão, do campo e do cemitério, com o
    // mesmo anel de progresso. Só DEPOIS de revelada: segurar uma carta ainda
    // virada abriria o detalhe dela e mataria a virada, que é a única coisa que
    // esta tela tem para oferecer — então ali o gesto REVELA, como o clique, em
    // vez de não fazer nada e ainda engolir o clique seguinte.
    const gesto = () => { if (abertas.has(i)) aoAmpliar?.(item.id, i); else abrir(i); };
    // `ligarGesto` devolve um "consumiu?" — sem ele, soltar depois de ampliar
    // dispararia o clique logo atrás, e numa carta ainda virada o "segurar
    // revela" seria seguido de um `abrir` redundante.
    const segurou = aoAmpliar && ligarGesto ? ligarGesto(botao, gesto) : null;
    if (aoAmpliar) botao.oncontextmenu = (e) => { e.preventDefault(); gesto(); };
    botao.onclick = () => { if (segurou?.()) return; gesto(); };

    cel.append(botao, nome);
    grade.append(cel);
  });

  // Lista vazia nunca chama `abrir`, e quem espera o `aoTerminar` para religar
  // os botões ficaria esperando para sempre. Não acontece hoje (nem o drop nem
  // o pacote chegam aqui vazios), e é exatamente por isso que passaria
  // despercebido no dia em que acontecesse.
  if (!itens.length) aoTerminar?.();

  /**
   * **Agrupar por raridade** (UR → SR → R → N), ou voltar à ordem em que o
   * servidor sorteou. Com 50 cartas de um [abrir 10] espalhadas, é isto que
   * responde a pergunta que se faz depois de abrir: *tirei alguma coisa boa?*
   *
   * Três decisões que erram caladas:
   *
   *   • **ordenar REVELA o que ainda estiver virado.** Agrupar por raridade com
   *     cartas viradas diria onde estão as boas antes de alguém as virar — a
   *     cerimônia inteira morre, e sem nenhum aviso. Quem organiza está pedindo
   *     para ver o resultado, então ver é o que acontece;
   *   • **quem se move é a CÉLULA, e o estado é por ITEM.** `append` de um nó
   *     que já está no pai o MOVE (não copia), e `abertas` é indexado pelo item
   *     — então reordenar não desfaz revelação nenhuma e os cliques continuam
   *     valendo para a carta certa;
   *   • **sem raridade vai para o fim**, nas duas direções, porque não é um
   *     degrau da escala e sim a ausência dela. É a mesma regra de
   *     `poolordem.js`, e por isso a comparação usa o índice de `RARIDADES`.
   */
  const peso = (item) => {
    const i = RARIDADES.indexOf(item.raridade);
    return i < 0 ? RARIDADES.length : i;
  };

  let agrupado = false;
  const ordenar = (porRaridade) => {
    agrupado = !!porRaridade;
    if (agrupado) itens.forEach((_, i) => abrir(i));
    const ordem = celulas.map((_, i) => i);
    // `sort` é estável: dentro da mesma raridade a ordem do sorteio se mantém,
    // e voltar para "ordem do pacote" devolve exatamente o que era.
    if (agrupado) ordem.sort((a, b) => peso(celulas[a].item) - peso(celulas[b].item));
    grade.append(...ordem.map((i) => celulas[i].cel));
  };

  return {
    revelarTudo: () => itens.forEach((_, i) => abrir(i)),
    todasAbertas: () => abertas.size === itens.length,
    quantasAbertas: () => abertas.size,
    ordenar,
    agrupadoPorRaridade: () => agrupado,
  };
}
