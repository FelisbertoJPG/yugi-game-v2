/**
 * **Onde está o motor de duelo.**
 *
 * O endereço era fixo (`http://localhost:8770`), e isso quebrava sempre que a
 * porta estava ocupada por outro programa. A 8080 e a 8770 são portas
 * disputadas em máquina de desenvolvedor — Tomcat, Jenkins, outro servidor de
 * dev, Docker —, e o jogo simplesmente não abria.
 *
 * O servidor passou a ANDAR para a próxima porta livre quando a dele está
 * tomada (`WebServer.Run`), em vez de brigar por ela: matar o processo que a
 * ocupa poderia derrubar o trabalho de outra pessoa. O preço é que o front não
 * pode mais assumir o número — ele precisa procurar.
 *
 * A ordem da procura não é arbitrária:
 *
 *   1. **o próprio origin.** No modo `--app` (o `.exe`) o front e o motor são o
 *      MESMO servidor, no mesmo processo e na mesma porta. Se a página veio
 *      dele, ele é o motor — e essa é a resposta certa em 99% dos casos, sem
 *      nenhuma tentativa perdida.
 *   2. **a faixa a partir da 8770.** É o `npm run dev`, onde o front é servido
 *      pelo Node (8080) e o motor é um processo à parte. Se ele também andou de
 *      porta, está logo ali do lado.
 *
 * Falhar em achar não é erro fatal: devolve o endereço padrão, e a primeira
 * chamada dá a mensagem de "sem conexão" que já existia.
 */

/** Porta onde o motor começa a procurar — a mesma do `WebServer`. */
export const PORTA_PADRAO = 8770;

/** Quantas portas seguintes o servidor pode ter usado. */
const QUANTAS = 10;

async function responde(base) {
  try {
    const r = await fetch(`${base}/health`, { cache: 'no-store' });
    return r.ok;
  } catch { return false; }
}

/**
 * Procura o motor e devolve a base da URL (sem barra no fim).
 *
 * `cache` guarda o resultado por página: a procura acontece uma vez, no boot,
 * e todo mundo que importar este módulo depois pega o mesmo endereço.
 */
let cache = null;

export async function acharServidor() {
  if (cache) return cache;

  // 1. o próprio origin (o `.exe`: front e motor no mesmo processo)
  const origem = typeof location !== 'undefined' ? location.origin : null;
  if (origem && origem.startsWith('http') && await responde(origem)) {
    cache = origem;
    return cache;
  }

  // 2. a faixa do modo dev
  for (let p = PORTA_PADRAO; p < PORTA_PADRAO + QUANTAS; p++) {
    const base = `http://localhost:${p}`;
    if (await responde(base)) { cache = base; return cache; }
  }

  // Não achei. Devolve o padrão para a mensagem de erro ser a de sempre —
  // "sem conexão com o duel-server" diz mais que um endereço em branco.
  return `http://localhost:${PORTA_PADRAO}`;
}
