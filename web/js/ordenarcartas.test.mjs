/**
 * A ORDEM das cartas que o jogador devolve ao Deck (a Card Advance).
 *
 *     node web/js/ordenarcartas.test.mjs
 *
 * A tela junta os cliques numa fila; o motor quer o lugar de CADA carta. As
 * duas coisas são permutações, então mandar uma no lugar da outra é aceito
 * pelo motor e deixa o deck numa ordem que ninguém pediu — sem erro nenhum.
 *
 * A regra é IMPORTADA de `ordenarcartas.js`, nunca copiada, e a última parte
 * confere que o `duel.html` usa a mesma função.
 */
import { readFileSync } from 'node:fs';
import { alternarNaOrdem, lugarNaOrdem, respostaDaOrdem, ordemDoMotor } from './ordenarcartas.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- a conversão: fila de cliques -> lugar de cada carta ----

// O caso que separa as duas leituras. Clicou a carta 1, depois a 2, depois a 0:
// a 1 fica em cima (lugar 0), a 2 em segundo, a 0 por último.
t('fila [1,2,0] vira lugares [2,0,1]', igual(respostaDaOrdem([1, 2, 0], 3), [2, 0, 1]));
// E o PAR CONTROLE do erro calado: a fila crua é outra permutação.
t('e NAO e\' a propria fila (o erro que o motor aceitaria)', !igual(respostaDaOrdem([1, 2, 0], 3), [1, 2, 0]));

// Inverter é a própria inversa — por isso ele sozinho não prova nada.
t('inverter tres cartas: lugares [2,1,0]', igual(respostaDaOrdem([2, 1, 0], 3), [2, 1, 0]));

t('manter a ordem do motor devolve a identidade',
  igual(respostaDaOrdem(ordemDoMotor(5), 5), [0, 1, 2, 3, 4]));

t('cinco cartas: a ultima do motor para cima, o resto na ordem',
  igual(respostaDaOrdem([4, 0, 1, 2, 3], 5), [1, 2, 3, 4, 0]));

// ---- fila incompleta ou torta nunca vira resposta ----
t('fila incompleta devolve null', respostaDaOrdem([0, 1], 3) === null);
t('carta repetida devolve null', respostaDaOrdem([0, 0, 1], 3) === null);
t('indice fora da lista devolve null', respostaDaOrdem([0, 1, 3], 3) === null);
t('indice que nao e\' inteiro devolve null', respostaDaOrdem([0, '1', 2], 3) === null);
t('total zero ou torto devolve null',
  respostaDaOrdem([], 0) === null && respostaDaOrdem([0], NaN) === null);
t('fila que nao e\' lista devolve null', respostaDaOrdem(null, 2) === null);

// ---- marcar e desmarcar ----
t('clicar entra no fim da fila', igual(alternarNaOrdem([2], 0), [2, 0]));
t('clicar de novo tira, e as de tras sobem', igual(alternarNaOrdem([0, 2, 1], 2), [0, 1]));
{
  const antes = [1];
  alternarNaOrdem(antes, 0);
  t('alternar nao muda a lista de entrada', igual(antes, [1]));
}
t('lugarNaOrdem conta a partir de 1, e 0 e\' "ainda nao escolhida"',
  lugarNaOrdem([2, 0], 2) === 1 && lugarNaOrdem([2, 0], 0) === 2 && lugarNaOrdem([2, 0], 1) === 0);
t('ordemDoMotor(3) e\' [0,1,2]', igual(ordemDoMotor(3), [0, 1, 2]));

// ---- a tela usa ESTA regra ----
{
  const html = readFileSync(new URL('../duel.html', import.meta.url), 'utf8');
  t('duel.html importa a regra de /web/js/ordenarcartas.js',
    /import\s*\{[^}]*respostaDaOrdem[^}]*\}\s*from\s*'\/web\/js\/ordenarcartas\.js'/.test(html));
  t('duel.html manda a resposta pela regra (nao pela fila crua)',
    /const\s+lugares\s*=\s*respostaDaOrdem\(/.test(html) && /act\('sort',[^\n]*lugares\)/.test(html));
  t('o quadro de ordenar tem guarda de [hidden]', /#sort-overlay\[hidden\]\s*\{\s*display:\s*none/.test(html));
}

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
