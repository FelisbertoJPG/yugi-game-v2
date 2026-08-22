/**
 * A regra do rótulo de "mudar posição".
 *
 *     node web/js/posicao.test.mjs
 *
 * O menu da carta (`duel.html`) promete ao jogador o que vai acontecer quando
 * ele mandar mudar a posição. Como o motor tem UM comando só e decide o
 * resultado sozinho, um rótulo errado é uma mentira que ninguém acusa: o
 * duelo continua funcionando, só que a carta faz outra coisa.
 *
 * A regra é IMPORTADA de `posicao.js`, nunca copiada — é a mesma função que o
 * duelo chama.
 */
import { rotuloReposicao, estaVirada, VIRADA } from './posicao.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

// As quatro posições do motor (POS_*).
const ATAQUE = 0x1, VIRADA_ATK = 0x2, DEFESA = 0x4, VIRADA_DEF = 0x8;

t('face-up em ATAQUE deita em defesa',
  rotuloReposicao(ATAQUE).texto === 'Mudar para Defesa');

t('face-up em DEFESA levanta em ataque',
  rotuloReposicao(DEFESA).texto === 'Mudar para Ataque');

// O caso comum do "setar": a carta baixada vira para cima em ataque.
t('virada em defesa vira para cima em ATAQUE (Invocação-Virar)',
  rotuloReposicao(VIRADA_DEF).texto === 'Virar para Ataque');

// E a armadilha da ordem dos testes: 0x8 tem o bit "defesa" no nome, mas o que
// manda é estar virada. Testar 0x4 antes prometeria "Mudar para Ataque" e o
// motor faria uma Invocação-Virar.
t('virada em defesa NAO cai no ramo de defesa face-up',
  rotuloReposicao(VIRADA_DEF).texto !== 'Mudar para Ataque');

t('virada em ataque também vira para cima',
  rotuloReposicao(VIRADA_ATK).texto === 'Virar para Ataque');

// Cada rótulo tem um ícone próprio: no menu eles são a leitura rápida, e dois
// iguais fariam "virar" e "mudar" parecerem a mesma jogada.
{
  const icones = [ATAQUE, DEFESA, VIRADA_DEF].map((p) => rotuloReposicao(p).icone);
  t('os três rótulos têm ícones distintos', new Set(icones).size === 3);
}

t('todo rótulo tem texto e ícone',
  [ATAQUE, VIRADA_ATK, DEFESA, VIRADA_DEF]
    .every((p) => rotuloReposicao(p).texto && rotuloReposicao(p).icone));

// estaVirada é o mesmo teste que o `zoneEl` usa para decidir se deita a arte e
// se oferece "Detalhes" — as duas leituras precisam concordar.
t('estaVirada cobre os DOIS bits de virada',
  estaVirada(VIRADA_ATK) && estaVirada(VIRADA_DEF));

t('estaVirada é falsa para as duas posições face-up',
  !estaVirada(ATAQUE) && !estaVirada(DEFESA));

t('VIRADA é exatamente 0x2|0x8', VIRADA === (0x2 | 0x8));

// Posição desconhecida (o motor mandou algo que não conhecemos, ou 0): o menu
// tem de dizer alguma coisa em vez de quebrar — o pior desfecho é o duelo
// morrer com a carta na mesa.
t('posição 0 devolve um rótulo válido',
  !!rotuloReposicao(0).texto && !!rotuloReposicao(undefined).texto);

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
