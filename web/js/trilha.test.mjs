/**
 * A regra de LIBERAÇÃO da Trilha de Duelos.
 *
 *     node web/js/trilha.test.mjs
 *
 * Cada adversário libera o próximo ao ser vencido. É a regra que decide o que o
 * jogador vê e o que fica atrás do cadeado — e ela mora numa função pura, então
 * dá para prová-la sem navegador.
 *
 * A regra é copiada aqui do `trilha.js` (que importa `localStorage` e `fetch` no
 * topo e não carrega em Node), pelo mesmo motivo do `npcativo.test.mjs`: é
 * pequena o bastante para o espelho valer, e grande o bastante para quebrar em
 * silêncio se alguém mexer.
 */

/** Idêntica à de `trilha.js`. */
function liberados(lista, vencidos) {
  const out = [];
  let podeOProximo = true;
  for (const npc of lista) {
    const aberto = podeOProximo || vencidos.has(npc.id);
    out.push(aberto);
    podeOProximo = aberto && vencidos.has(npc.id);
  }
  return out;
}

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};
const trilha = (...ids) => ids.map((id) => ({ id }));
const venceu = (...ids) => new Set(ids);

const quatro = trilha('a', 'b', 'c', 'd');

t('sem vitória nenhuma, só o primeiro abre',
  String(liberados(quatro, venceu())) === String([true, false, false, false]));

t('vencendo o primeiro, o segundo abre',
  String(liberados(quatro, venceu('a'))) === String([true, true, false, false]));

t('vencendo os dois primeiros, abre até o terceiro',
  String(liberados(quatro, venceu('a', 'b'))) === String([true, true, true, false]));

t('vencendo todos, a trilha inteira fica aberta',
  String(liberados(quatro, venceu('a', 'b', 'c', 'd'))) === String([true, true, true, true]));

// O buraco que a regra fecha: vencer o 3º sem ter vencido o 2º (por um link
// direto, ou porque a ordem da campanha mudou depois) não pode abrir o resto da
// trilha em cascata — mas o próprio vencido continua acessível.
t('vitória fora de ordem abre o vencido e o seguinte, não a trilha toda',
  String(liberados(quatro, venceu('c'))) === String([true, false, true, true]));

t('o vencido fica acessível mesmo com o anterior por vencer',
  liberados(quatro, venceu('d'))[3] === true);

// Casos de borda: a trilha vazia e a de um só.
t('trilha vazia não estoura', liberados([], venceu()).length === 0);
t('trilha de um: sempre aberta', String(liberados(trilha('x'), venceu())) === String([true]));

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
