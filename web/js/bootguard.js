/**
 * **A REDE DE SEGURANÇA DO BOOT.**
 *
 * Toda página deste jogo é um `<script type="module">` que começa com uma
 * corrente de `await` no TOPO: sessão, carteira, decks, perfil. Um `throw` em
 * qualquer elo para o módulo ali mesmo — e essa é a parte cara:
 *
 *   • o que já foi desenhado FICA na tela, então a página parece viva;
 *   • o que não foi nunca vem, então os "carregando…" que o HTML traz de fábrica
 *     ficam ali para sempre;
 *   • não há erro em lugar nenhum que o jogador ou o dono do jogo veja — o
 *     `duel-server.log` é do servidor, e isto acontece no navegador.
 *
 * Do lado de quem abriu, o resultado é *"o jogo trava numa home eternamente
 * carregando"*, que foi literalmente como o problema chegou em 23/08/2026. Duas
 * pessoas presas, nada nos logs do Supabase (todas as respostas 200) e nada para
 * perguntar a elas além de "e aí, o que aparece?" — nada aparecia.
 *
 * **Isto não conserta causa nenhuma**, e é de propósito: cada causa se guarda no
 * lugar dela (o `req` que não deixa mais exceção escapar, as hidratações que são
 * cache e falham como cache, os decks que são lidos um a um). Isto conserta o
 * SILÊNCIO — inclusive o das falhas que ainda não aconteceram.
 *
 * **Por que um módulo e não um `try` em cada página.** São nove páginas com
 * `await` de topo. Nove cópias divergiriam na primeira correção, e a que ficasse
 * para trás voltaria a falhar calada — que é o erro que este projeto já pagou
 * caro (`chancesDe` × `chancesDoPacote`). Uma linha por página, como o
 * `vivo.js`.
 *
 * **Precisa vir ANTES do módulo da página.** Os `<script type="module">` rodam
 * na ordem do documento, então a tag que importa isto tem de estar acima da tag
 * que boota a tela — senão a falha que ele existe para mostrar acontece antes
 * de ele existir.
 */

/** Já mostrei alguma coisa? O primeiro erro é a causa; os seguintes são efeito. */
let mostrado = false;

/**
 * Paradas de PROPÓSITO. Várias páginas terminam o boot com um `throw` depois de
 * mandar o navegador para outro lugar (`requireLogin`, `requireAdmin`, o link de
 * recuperação) — é assim que elas param a corrente de `await` sem executar o
 * resto. Elas chegam aqui como qualquer outra rejeição, e anunciar "falhou" por
 * cima de um redirect em andamento seria transformar o caminho normal em erro na
 * cara de quem está só sendo levado para o login.
 */
const DE_PROPOSITO = /redirecionando|recuperacao|indo para/i;

function mostrar(motivo) {
  if (mostrado) return;
  mostrado = true;

  const faixa = document.createElement('div');
  faixa.id = 'bootguard';
  faixa.setAttribute('role', 'alert');
  // Estilo inline: uma folha nova é mais um arquivo para chegar, e este aviso
  // precisa funcionar justamente quando algo não chegou.
  faixa.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:99999',
    'background:#3a0d0d', 'color:#ffd7d7', 'border-bottom:1px solid #a33',
    'font:12px/1.5 monospace', 'padding:10px 14px', 'white-space:pre-wrap',
  ].join(';');

  const titulo = document.createElement('b');
  titulo.textContent = 'esta tela nao terminou de abrir';
  const corpo = document.createElement('div');
  // `textContent`: a mensagem vem de uma exceção, e uma delas pode carregar
  // texto vindo do servidor.
  corpo.textContent = motivo;
  const ajuda = document.createElement('div');
  ajuda.style.cssText = 'margin-top:6px;opacity:.75';
  ajuda.textContent = 'feche e abra o jogo. Se continuar, mande esta mensagem — '
                    + 'ela diz onde parou.';

  faixa.append(titulo, corpo, ajuda);
  (document.body ?? document.documentElement).prepend(faixa);

  // No console também: quem tem o F12 aberto quer a pilha, não a faixa.
  console.error('[boot] a pagina parou antes de terminar:', motivo);
}

function motivoDe(x) {
  if (x instanceof Error) return `${x.name}: ${x.message}`;
  const s = String(x ?? '');
  return s || 'erro desconhecido';
}

window.addEventListener('unhandledrejection', (e) => {
  const motivo = motivoDe(e?.reason);
  if (DE_PROPOSITO.test(motivo)) return;
  mostrar(motivo);
});

// Erro SÍNCRONO — inclusive o `import` que não resolveu, que é como uma página
// morre quando um módulo novo não viajou no `game.zip`. Nesse caso não há sequer
// a primeira linha do script da página: sem isto, tela parada e console vazio
// para quem não sabe abrir o F12.
window.addEventListener('error', (e) => {
  // Imagem/arte que não carregou dispara `error` com `target` sendo o elemento,
  // e não é uma falha de boot: as artes vêm da internet e faltam o tempo todo.
  if (e?.target && e.target !== window) return;
  mostrar(motivoDe(e?.error ?? e?.message));
});
