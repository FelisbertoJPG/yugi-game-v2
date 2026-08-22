/**
 * **Quem está online.**
 *
 * O mecanismo é um BATIMENTO: enquanto uma tela do jogo está aberta, ela chama
 * `bater_ponto()` de tempos em tempos; o banco carimba `perfis.visto_em` e
 * devolve quantas pessoas bateram dentro da janela (`janela_online()`, hoje 2
 * minutos). Ver a migration 0034.
 *
 * **Por que carimbo de tempo e não um booleano `online`.** Um booleano ligado
 * no login fica preso em `true` para sempre quando o navegador é fechado, a
 * máquina cai ou a rede some — não existe evento de "saiu" em que se possa
 * confiar. Um carimbo expira sozinho, sem ninguém precisar avisar nada.
 *
 * **Quem decide o que é estar online é o BANCO.** A janela está numa função SQL
 * e o cálculo do `online` de cada amigo sai de `meus_amigos`. Se o cliente
 * decidisse, duas máquinas com relógios diferentes discordariam sobre quem está
 * online — cada uma certa pela sua conta.
 */
import { req, sessao } from '/web/js/supabase.js';

/**
 * De quanto em quanto tempo se bate o ponto.
 *
 * Tem de ser confortavelmente MENOR que a janela do banco (2 min), senão o
 * jogador pisca entre online e offline por um atraso de rede qualquer. 45s dá
 * duas batidas dentro de cada janela: uma pode se perder inteira sem que
 * ninguém veja diferença.
 */
export const BATIDA_MS = 45_000;

/**
 * Começa a bater o ponto. Chame uma vez por tela que "conta como estar jogando"
 * — a home, o Multiplayer e o duelo.
 *
 * `aoContar(n)` recebe quantos estão online, a cada batida.
 *
 * Falha de rede é ignorada de propósito: quem está sem internet simplesmente
 * deixa de aparecer como online depois de dois minutos, que é exatamente a
 * verdade. Um erro na tela por causa disso não ajudaria ninguém.
 *
 * @returns {() => void} chame para parar.
 */
export function baterPonto(aoContar = () => {}) {
  let vivo = true;

  async function bater() {
    if (!vivo || !sessao()) return;
    try {
      const r = await req('rpc/bater_ponto', { method: 'POST', body: {} });
      if (vivo && r.ok && Number.isFinite(Number(r.dados))) aoContar(Number(r.dados));
    } catch { /* ver o cabeçalho: offline já é a resposta certa */ }
  }

  bater();
  const t = setInterval(bater, BATIDA_MS);

  // A aba escondida tem os `setInterval` estrangulados pelo navegador (podem
  // cair para um por minuto), e voltar para a aba é justamente quando se quer
  // o número certo na tela. Uma batida na volta resolve as duas coisas.
  const aoVoltar = () => { if (!document.hidden) bater(); };
  document.addEventListener('visibilitychange', aoVoltar);

  return () => {
    vivo = false;
    clearInterval(t);
    document.removeEventListener('visibilitychange', aoVoltar);
  };
}
