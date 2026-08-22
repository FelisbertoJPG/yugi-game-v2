/**
 * Testes da conta das chances do pacote — `node web/js/pacote.test.mjs`.
 *
 * O que se prova aqui é uma PROMESSA DE TELA: a Loja mostra "X% de chance" ao
 * lado de cada gaveta, e o sorteio acontece no banco (`abrir_pacote()`). Se as
 * duas contas divergirem ninguém vê erro nenhum — o jogador só abre pacotes
 * achando que a UR vem numa taxa que ela não vem.
 *
 * O ponto que mais erra é a CASCATA: o servidor não renormaliza os pesos entre
 * as raridades presentes; ele rola os 706/252/38/4 fixos e desce (ou sobe) até
 * achar uma gaveta com carta. Um booster sem UR não tem 0% de UR "diluído no
 * resto": os 0,4% dela viram SR.
 */
import { chancesDoPacote, totalDoPacote, PACK_ODDS, RARIDADES, CASCATA } from './pacote.js';

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

const cards = (o = {}) => ({ UR: o.UR ?? [], SR: o.SR ?? [], R: o.R ?? [], N: o.N ?? [] });

console.log('=== os pesos ===');
t(RARIDADES.reduce((s, r) => s + PACK_ODDS[r], 0) === 1000,
  'os pesos somam exatamente 1000 (o servidor rola floor(random()*1000))');
for (const r of RARIDADES)
  t(CASCATA[r][0] === r && CASCATA[r].length === RARIDADES.length,
    `a cascata de ${r} comeca nela mesma e cobre as quatro raridades`);

console.log('\n=== booster completo: os pesos crus, sem redistribuicao ===');
eq(chancesDoPacote(cards({ UR: [1], SR: [2], R: [3], N: [4] })),
   { UR: 0.4, SR: 3.8, R: 25.2, N: 70.6 },
   'com as quatro gavetas cheias, cada uma vale o proprio peso');

console.log('\n=== gaveta vazia: a chance CAI pela cascata, nao se dilui ===');
// Sem UR, os 4 milesimos dela vao para a SR (CASCATA.UR = [UR, SR, R, N]).
eq(chancesDoPacote(cards({ SR: [2], R: [3], N: [4] })),
   { UR: 0, SR: 4.2, R: 25.2, N: 70.6 },
   'sem UR, os 0,4% dela viram SR (4,2%) — o R e o N nao mudam');
// Sem SR, os 38 da SR descem para R (CASCATA.SR = [SR, R, N, UR]).
eq(chancesDoPacote(cards({ UR: [1], R: [3], N: [4] })),
   { UR: 0.4, SR: 0, R: 29, N: 70.6 },
   'sem SR, os 3,8% dela descem para R (29%)');
// Sem N, os 706 da N sobem para R (CASCATA.N = [N, R, SR, UR]).
eq(chancesDoPacote(cards({ UR: [1], SR: [2], R: [3] })),
   { UR: 0.4, SR: 3.8, R: 95.8, N: 0 },
   'sem N, os 70,6% dela sobem para R (95,8%)');

console.log('\n=== a renormalizacao INGENUA seria outra coisa ===');
// Este é o teste que existe para nao "consertar" a conta copiando o drops.js:
// renormalizando, um booster sem UR daria SR = 38/996 = 3,8%. O servidor da 4,2%.
const semUr = chancesDoPacote(cards({ SR: [2], R: [3], N: [4] }));
t(semUr.SR !== 3.8,
  'sem UR, a SR NAO e\' 3,8% — renormalizar (como o drop do NPC faz) mentiria aqui');

console.log('\n=== so uma gaveta: ela leva os 100% ===');
eq(chancesDoPacote(cards({ N: [4, 5, 6] })), { UR: 0, SR: 0, R: 0, N: 100 },
   'booster so de N da 100% de N — nenhum buraco no pacote');
eq(chancesDoPacote(cards({ UR: [1] })), { UR: 100, SR: 0, R: 0, N: 0 },
   'booster so de UR da 100% de UR');

console.log('\n=== borda: booster vazio ===');
eq(chancesDoPacote(cards({})), { UR: 0, SR: 0, R: 0, N: 0 },
   'booster vazio nao divide por zero');
eq(chancesDoPacote(null), { UR: 0, SR: 0, R: 0, N: 0 },
   'sem booster nenhum, tudo zero');

console.log('\n=== soma ===');
for (const c of [cards({ UR: [1], SR: [2], R: [3], N: [4] }),
                 cards({ SR: [2], N: [4] }),
                 cards({ R: [3] })]) {
  const p = chancesDoPacote(c);
  const soma = RARIDADES.reduce((s, r) => s + p[r], 0);
  t(Math.abs(soma - 100) < 0.11,
    `as chances somam ~100% (${soma}) para ${RARIDADES.filter((r) => c[r].length).join('+')}`);
}

console.log('\n=== totalDoPacote ===');
t(totalDoPacote(cards({ UR: [1], SR: [2, 3], N: [4, 5, 6] })) === 6,
  'conta as cartas das quatro gavetas');
t(totalDoPacote(null) === 0, 'sem booster, zero');

console.log(`\n=== ${ok} passaram, ${fail} falharam ===`);
process.exit(fail === 0 ? 0 : 1);
