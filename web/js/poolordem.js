/**
 * **A ordenação do pool de cartas** — uma regra, cinco telas.
 *
 * O mesmo `<select id="f-sort">` existe no Deck Builder, no Booster Builder, na
 * Banlist, nas Listas de cartas e no Deck Estrutural, e a função que o
 * obedecia estava escrita **quatro vezes** (duas em módulos, duas soltas dentro
 * do HTML). Três já eram cópias idênticas e a quarta, a do Booster Builder,
 * tinha divergido em silêncio: ela não entendia o sufixo `-asc`, então "menor
 * ATK" ali ordenava do maior para o menor — a tela oferecia a opção e fazia o
 * contrário.
 *
 * Por isso a regra passou a morar aqui, sem DOM e com teste
 * (`node web/js/poolordem.test.mjs`), como `deck.js` e `drops.js`.
 *
 * ORDENAR POR RARIDADE é o motivo de este arquivo ter nascido agora: montar um
 * deck olhando UR → SR → R → N (e escolher o que entra na Lista 1 ou ganha
 * regra na Banlist) é a leitura que faltava. A raridade não vem de uma consulta
 * nova: `annotateDb` (boosters.js) já escreve `rarity` na entrada do índice, e
 * as cinco telas o chamam no boot. Quem sabe mais que isso — o Deck Builder,
 * que também lê a raridade dos Decks Estruturais — passa a própria função.
 */

/**
 * A ordem das raridades, da melhor para a pior. É a MESMA de `RARITIES` em
 * `boosters.js`, e a repetição aqui é proposital: este módulo não importa nada
 * (é a condição de ele ser testável em Node sem tocar em `localStorage`), e um
 * `import` só para ler quatro strings traria a leitura de boosters junto.
 */
export const RARIDADES = ['UR', 'SR', 'R', 'N'];

/** Posição na escala. Carta sem raridade fica DEPOIS de todas — ver abaixo. */
const posto = (r) => {
  const i = RARIDADES.indexOf(String(r ?? '').toUpperCase());
  return i < 0 ? RARIDADES.length : i;
};

/**
 * Ordena o pool.
 *
 * @param lista       as cartas já filtradas.
 * @param chave       o valor do `<select>`: '' | atk | atk-asc | def | def-asc |
 *                    lv | lv-asc | raridade | raridade-asc.
 * @param raridadeDe  opcional: `(carta) => 'UR'|'SR'|'R'|'N'|null`. Sem ela, a
 *                    raridade sai de `carta.rarity`, que é o que `annotateDb`
 *                    escreve. O Deck Builder passa a sua, que consulta também os
 *                    Decks Estruturais — é onde mora a raridade das 36 cartas
 *                    que nunca entraram em booster nenhum.
 *
 * Nunca mexe na lista recebida: as telas guardam `poolResults` e redesenham a
 * partir dele.
 */
export function ordenarPool(lista, chave, raridadeDe = null) {
  const cartas = Array.isArray(lista) ? lista : [];
  if (!chave) return cartas;

  const asc = String(chave).endsWith('-asc');
  const campo = String(chave).replace('-asc', '');

  if (campo === 'raridade') {
    const rar = (c) => posto(raridadeDe ? raridadeDe(c) : c?.rarity);
    // CARTA SEM RARIDADE FICA SEMPRE NO FIM, nas duas direções — e é por isso
    // que ela não entra no `asc`. Ordenando "N → UR", quem não está em booster
    // nenhum viria PRIMEIRO se fosse só o inverso da escala, e a tela abriria
    // com centenas de cartas sem raridade na frente das que se quer ver.
    // "Sem raridade" não é um degrau da escala: é a ausência dela.
    return [...cartas].sort((a, b) => {
      const ra = rar(a), rb = rar(b);
      const semA = ra === RARIDADES.length, semB = rb === RARIDADES.length;
      if (semA !== semB) return semA ? 1 : -1;
      if (semA) return 0;
      return asc ? rb - ra : ra - rb;
    });
  }

  const val = (c) => (campo === 'atk' ? c?.atk : campo === 'def' ? c?.def : c?.lv);
  return [...cartas].sort((a, b) => {
    const va = val(a), vb = val(b);
    // Magia e armadilha não têm ATK/DEF/nível. Elas vão para o fim nas DUAS
    // direções, pelo mesmo motivo da carta sem raridade: `null` não é "zero".
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return asc ? va - vb : vb - va;
  });
}
