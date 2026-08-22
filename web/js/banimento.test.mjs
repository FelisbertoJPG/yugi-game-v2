/**
 * A pilha de cartas BANIDAS.
 *
 *     node web/js/banimento.test.mjs
 *
 * O que se prova aqui é o que não dá para ver na tela sem jogar por horas: uma
 * carta que volta do banimento e some da pilha certa, três cópias banidas que
 * não se apagam juntas, e a carta banida VIRADA — que entra sem código e volta
 * com ele, e por isso é a única que consegue ficar encalhada para sempre.
 *
 * A regra é IMPORTADA de `banimento.js`, nunca copiada.
 */
import { banir, desbanir, topoBanido, contarAbertas, LOCATION_BANIDO } from './banimento.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

const ATAQUE = 0x1, DEFESA_VIRADA = 0x8;
const mov = (code, pos = ATAQUE) => ({ code, pos });

t('LOCATION_REMOVED é 0x20', LOCATION_BANIDO === 0x20);

// ------------------------------------------------------------- entrada ----
{
  const p = [];
  banir(p, mov(1001));
  banir(p, mov(1002));
  t('a pilha guarda na ordem em que as cartas saem do jogo',
    p.length === 2 && p[0].code === 1001 && p[1].code === 1002);
  t('o topo é a ÚLTIMA carta banida', topoBanido(p).code === 1002);
}

t('pilha vazia não tem topo', topoBanido([]) === null);

// A carta banida com a face para baixo: o servidor manda code 0 (Projetar), e
// a pilha tem de guardar a entrada assim mesmo — saber que TEM carta ali é
// metade da informação, e é a metade que hoje não existe na tela.
{
  const p = [];
  banir(p, { code: 0, pos: DEFESA_VIRADA });
  t('carta banida virada entra na pilha mesmo sem código',
    p.length === 1 && p[0].virada === true && p[0].code === 0);
}

// E a carta do PRÓPRIO jogador banida virada: o código chega (é dele), mas a
// posição diz que está com a face para baixo — a tela não pode mostrar a arte.
{
  const p = [];
  banir(p, mov(1003, DEFESA_VIRADA));
  t('a posição virada manda mais que o código presente', p[0].virada === true);
  t('mas o código é guardado (é carta do próprio dono)', p[0].code === 1003);
}

t('carta banida aberta não é virada', banir([], mov(1004)).virada === false);

// ------------------------------------------------------------- retorno ----
{
  const p = [];
  banir(p, mov(2001));
  t('voltar do banimento tira a carta da pilha',
    desbanir(p, 2001) === true && p.length === 0);
}

// A armadilha que o cemitério já tinha: tirar UMA ocorrência, não todas.
{
  const p = [];
  banir(p, mov(3001));
  banir(p, mov(3001));
  banir(p, mov(3001));
  desbanir(p, 3001);
  t('três cópias banidas: volta UMA, ficam DUAS', p.length === 2);
}

// A carta virada volta com o código real — e não casa com nenhuma entrada por
// código, porque entrou como 0. Sem o segundo passo ela nunca sairia.
{
  const p = [];
  banir(p, { code: 0, pos: DEFESA_VIRADA });
  t('a virada volta pelo código real e SAI da pilha',
    desbanir(p, 4001) === true && p.length === 0);
}

// E o segundo passo não pode roubar a vez do primeiro: com uma aberta que casa
// e uma virada na pilha, quem sai é a que casa.
{
  const p = [];
  banir(p, { code: 0, pos: DEFESA_VIRADA });
  banir(p, mov(5001));
  desbanir(p, 5001);
  t('com a aberta casando, a virada FICA',
    p.length === 1 && p[0].virada === true);
}

// Duas viradas: sai a mais recente (a de cima da pilha), que é a única escolha
// defensável quando não dá para saber qual delas é.
{
  const p = [];
  banir(p, { code: 0, pos: DEFESA_VIRADA });
  banir(p, { code: 0, pos: DEFESA_VIRADA });
  desbanir(p, 6001);
  t('duas viradas: sai a do topo', p.length === 1);
}

// Retorno de uma carta que não está aqui: não pode inventar remoção nenhuma.
{
  const p = [];
  banir(p, mov(7001));
  t('código que não está na pilha (e nada virado) não tira nada',
    desbanir(p, 9999) === false && p.length === 1);
}

t('desbanir numa pilha vazia devolve false', desbanir([], 1) === false);

// ------------------------------------------------------------ contagem ----
{
  const p = [];
  banir(p, mov(8001));
  banir(p, { code: 0, pos: DEFESA_VIRADA });
  banir(p, mov(8002));
  t('contarAbertas conta só o que dá para identificar', contarAbertas(p) === 2);
  t('o total continua sendo o tamanho da pilha', p.length === 3);
}

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
