/**
 * Testes do `.ydk` e das gavetas de um deck — `node web/js/ydk.test.mjs`.
 *
 * Duas coisas que erram CALADAS:
 *
 *   • **a leitura do `.ydk`.** Um marcador tratado errado (`#extra`, `!side`,
 *     o `#created by` do topo) não gera erro: devolve um deck com cartas a
 *     menos, ou com o Extra Deck misturado no main. A Loja mostra a lista
 *     incompleta com a maior naturalidade;
 *   • **a ORDEM em que a raridade é procurada.** É a mesma do servidor
 *     (`raridade_da_carta`, migration 0019): o booster vence, o mapa do
 *     estrutural entra depois, e o resto é N. Invertê-la faria a carta
 *     aparecer UR na Loja e ser vendida como N no Inventário, cada tela
 *     "certa" pela sua conta.
 */
import { paraYdk, deYdk, gavetasDoDeck, totalDoDeck, gavetasVazias, RARIDADES } from './ydk.js';

let ok = 0, fail = 0;
const eq = (o, e, what) => {
  const a = JSON.stringify(o), b = JSON.stringify(e);
  if (a === b) { ok++; console.log(`  OK    ${what}`); }
  else { fail++; console.error(`  FALHA ${what}\n        veio ${a}\n        esperado ${b}`); }
};
const t = (cond, what) => {
  if (cond) { ok++; console.log(`  OK    ${what}`); }
  else { fail++; console.error(`  FALHA ${what}`); }
};

console.log('=== leitura do .ydk ===');
eq(deYdk('#created by x\n#main\n100\n100\n200\n#extra\n!side\n'),
   { 100: 2, 200: 1 },
   'conta as copias do main');
eq(deYdk('#created by x\n#main\n100\n#extra\n999\n!side\n888\n'),
   { 100: 1 },
   'o EXTRA e o SIDE ficam de fora — misturar inflaria a lista da Loja');
eq(deYdk('100\n100\n'), { 100: 2 },
   'sem cabecalho nenhum, assume main (e o que um .ydk cru tem)');
eq(deYdk('#main\r\n100\r\n100\r\n'), { 100: 2 },
   'aceita fim de linha do Windows (CRLF)');
eq(deYdk('#main\n\n  100  \n\n'), { 100: 1 },
   'ignora linha vazia e espaco em volta do numero');
eq(deYdk('#main\nabc\n-5\n1.5\n'), {},
   'linha que nao e um id inteiro e descartada');
eq(deYdk(''), {}, 'texto vazio da um deck vazio');
eq(deYdk(null), {}, 'sem texto nenhum, deck vazio (nao estoura)');

console.log('\n=== ida e volta ===');
const q = { 100: 3, 200: 2, 300: 1 };
eq(deYdk(paraYdk(q)), q, 'paraYdk -> deYdk devolve as mesmas quantidades');
t(paraYdk(q).includes('#main') && paraYdk(q).includes('!side'),
  'o texto gerado tem os marcadores que qualquer parser de ydk espera');

console.log('\n=== total ===');
t(totalDoDeck(q) === 6, 'totalDoDeck soma as copias, nao as cartas distintas');
t(totalDoDeck(null) === 0, 'sem deck, zero');

console.log('\n=== gavetas: a ordem da raridade ===');
const raridades = { 100: 'N', 200: 'SR' };
const doBooster = (id) => (String(id) === '100' ? 'UR' : null);

eq(gavetasDoDeck({ 100: 1 }, raridades, doBooster),
   { UR: [100], SR: [], R: [], N: [] },
   'o BOOSTER vence o mapa do estrutural (UR, nao N)');
eq(gavetasDoDeck({ 200: 1 }, raridades, doBooster),
   { UR: [], SR: [200], R: [], N: [] },
   'sem booster, vale o mapa do proprio estrutural');
eq(gavetasDoDeck({ 300: 1 }, raridades, doBooster),
   { UR: [], SR: [], R: [], N: [300] },
   'carta que nao esta em lugar nenhum e N — o mesmo default do servidor');
eq(gavetasDoDeck({ 400: 1 }, { 400: 'LENDARIA' }),
   { UR: [], SR: [], R: [], N: [400] },
   'raridade desconhecida cai em N em vez de sumir da lista');
eq(gavetasDoDeck({}, raridades, doBooster), gavetasVazias(),
   'deck vazio devolve as quatro gavetas vazias');
eq(gavetasDoDeck(null), gavetasVazias(),
   'sem deck nenhum, gavetas vazias (nao estoura)');

console.log('\n=== nenhuma carta se perde entre o .ydk e as gavetas ===');
const grande = deYdk(paraYdk({ 100: 3, 200: 3, 300: 2, 400: 1 }));
const pool = gavetasDoDeck(grande, { 300: 'R' }, (id) => (String(id) === '100' ? 'UR' : null));
t(RARIDADES.reduce((n, r) => n + pool[r].length, 0) === Object.keys(grande).length,
  'toda carta distinta do deck aparece em exatamente uma gaveta');

console.log(`\n=== ${ok} passaram, ${fail} falharam ===`);
process.exit(fail === 0 ? 0 : 1);
