/**
 * **A batida que mantém o jogo aberto.**
 *
 * O `ClassicDuels.exe` deixou de abrir uma janela de terminal (23/08/2026) — para
 * quem não é técnico, um console aparecendo por cima do jogo e tendo de ser
 * minimizado é ruído, não informação. Só que era ELA o botão de fechar: a janela
 * dizia "DEIXE ESTA JANELA ABERTA — fechar aqui encerra o jogo", e fechá-la
 * encerrava o servidor.
 *
 * Sem terminal, alguém precisa dizer ao servidor que o jogo ainda está na tela.
 * Quem diz é esta batida: toda página do jogo pinga `/__vivo` a cada
 * {@link INTERVALO_MS}, e o servidor se encerra depois de uma janela sem
 * nenhuma batida (ver `WebServer`). Fechou a janela do navegador, as batidas
 * param, o jogo fecha — que é o que um aplicativo faz.
 *
 * POR QUE NÃO ESPERAR O PROCESSO DO NAVEGADOR MORRER, que seria menos código:
 * com `--app=URL` e sem `--user-data-dir`, um Chrome já aberto repassa a janela
 * para a instância existente e o processo que nós lançamos **morre na hora** — o
 * servidor cairia com o jogo aberto na tela, e só para quem já estava com o
 * navegador aberto. Consertar isso exigiria um perfil de navegador dedicado, o
 * que muda o `localStorage` de lugar e desloga todo mundo uma vez.
 *
 * O modo de falha DESTE caminho é o oposto, e é o que dá para blindar: uma
 * página que esqueça a batida faz o servidor fechar debaixo de quem está
 * jogando. Por isso existe a varredura em `web/js/vivo.test.mjs`, que reprova
 * qualquer página de `web/` sem esta linha.
 *
 * NÃO faz nada fora do jogo empacotado: em `npm run dev` quem serve o front é o
 * Node e o servidor de duelo é outro processo — o `/__vivo` não existe ali, o
 * `fetch` falha, e o `catch` engole. O relógio do lado do servidor também só é
 * armado no modo `--app`.
 */

/** De quanto em quanto tempo a página avisa que está viva. */
export const INTERVALO_MS = 5000;

let relogio = null;

async function bater() {
  try {
    // A VISIBILIDADE viaja junto, e ela e' o que impede o pior bug deste
    // mecanismo: navegador ESTRANGULA `setInterval` em janela minimizada — o
    // Chrome derruba para cerca de uma batida por minuto quando a pagina esta'
    // oculta. Com uma janela de 15s no servidor, minimizar o jogo por um minuto
    // o fecharia. Sabendo que a pagina esta' oculta, o servidor usa uma janela
    // folgada (ver `JANELA_VIVO_OCULTO`), que cabe de sobra na batida
    // estrangulada.
    const oculto = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    await fetch(`/__vivo${oculto ? '?oculto=1' : ''}`,
                { method: 'POST', cache: 'no-store', keepalive: true });
  } catch {
    // Servidor fora do ar (npm run dev, ou ele já encerrou): não há o que
    // manter vivo, e insistir com erro no console só assustaria quem abrisse o
    // F12 por outro motivo.
  }
}

/**
 * Liga a batida. Idempotente: uma página que chame duas vezes (um módulo e o
 * script inline, por exemplo) não bate em dobro.
 *
 * A primeira batida é IMEDIATA, e não depois do primeiro intervalo: é ela que
 * ARMA o relógio do servidor. Enquanto ninguém bateu, ele não conta o tempo —
 * senão o jogo se encerraria durante o próprio boot, no intervalo entre subir o
 * servidor e o navegador terminar de abrir.
 */
export function manterVivo() {
  if (relogio !== null) return;
  bater();
  relogio = setInterval(bater, INTERVALO_MS);

  // Bate na TROCA de visibilidade, nos dois sentidos. Minimizou: o servidor
  // precisa saber disso AGORA, e nao na proxima batida estrangulada, que pode
  // demorar um minuto. Voltou: a janela curta volta a valer no ato, e nao
  // depois de o navegador se lembrar de rodar o `setInterval`.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', bater);
  }

  // Sair da página não para o relógio de propósito: navegar da home para o Deck
  // Builder é uma troca de documento, e o `clearInterval` viria junto. Quem
  // decide que acabou é a AUSÊNCIA de batidas na janela do servidor, que é
  // folgada o bastante para cobrir uma navegação.
}
