/**
 * O "visto por último" da lista de amigos — a frase, sem navegador.
 *
 *     node web/js/vistoem.test.mjs
 *
 * O módulo é pequeno de propósito, e cada uma das três decisões dele erra
 * CALADA: o carimbo que não veio vira "Invalid Date" na tela (frase que parece
 * uma data), a virada do dia contada por milissegundos diz "hoje" às 00:30
 * sobre algo que foi ontem, e o horário de verão faz um dia ter 23 ou 25 horas.
 * Nada disso dá erro em lugar nenhum — a linha aparece, só que mentindo.
 *
 * Toda data de teste é construída com o construtor LOCAL (`new Date(a, m, d,
 * …)`), nunca com uma string ISO em UTC: a função responde no fuso de quem lê,
 * e uma string fixa faria o teste passar aqui e falhar em outra máquina.
 */
import { textoVistoEm } from './vistoem.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

const D = (a, m, d, h = 0, min = 0) => new Date(a, m - 1, d, h, min);

// ------------------------------------------------------- o carimbo que não veio
// O caso do cliente novo contra servidor sem a 0049: o campo simplesmente não
// existe na resposta. `new Date(undefined)` seria um Date INVÁLIDO, e a tela
// mostraria "Invalid Date" como se fosse uma data.
t('sem carimbo nenhum (undefined) devolve null', textoVistoEm(undefined) === null);
t('carimbo nulo devolve null', textoVistoEm(null) === null);
t('carimbo vazio devolve null', textoVistoEm('') === null);
t('carimbo que nao e data devolve null', textoVistoEm('ontem de tarde') === null);
t('Date invalido devolve null', textoVistoEm(new Date('x')) === null);

// ...e o par CONTROLE: sem ele, uma função que devolvesse `null` sempre passaria
// nas cinco de cima e a linha nunca apareceria na tela.
t('carimbo bom NAO devolve null', textoVistoEm(D(2026, 8, 27, 14, 32), D(2026, 8, 27, 15, 0)) !== null);

// -------------------------------------------------------------------- hoje
const agora = D(2026, 8, 27, 15, 0);
t('hoje mais cedo: "hoje as HH:MM"',
  textoVistoEm(D(2026, 8, 27, 14, 32), agora) === 'hoje às 14:32');
t('hoje de madrugada ainda e hoje',
  textoVistoEm(D(2026, 8, 27, 0, 5), agora) === 'hoje às 00:05');
t('a hora vem com dois digitos nos dois campos',
  textoVistoEm(D(2026, 8, 27, 9, 5), agora) === 'hoje às 09:05');

// ------------------------------------------------------------------- ontem
t('ontem a noite: "ontem as HH:MM"',
  textoVistoEm(D(2026, 8, 26, 23, 50), agora) === 'ontem às 23:50');

// A VIRADA DO DIA, que é onde a conta por milissegundos erra: às 00:30, 23:50 de
// ontem está a 40 minutos de distância — menos de um dia inteiro — e mesmo assim
// é ONTEM. Uma conta por diferença bruta diria "hoje".
t('as 00:30, 23:50 da vespera e ONTEM (dia de calendario, nao 24h)',
  textoVistoEm(D(2026, 8, 26, 23, 50), D(2026, 8, 27, 0, 30)) === 'ontem às 23:50');
// E o avesso, que é o mesmo erro pelo outro lado: 26 horas atrás pode ser
// ANTEONTEM. Uma conta por diferença bruta ("menos de 48h é ontem") diria
// "ontem às 23:00" sobre algo que aconteceu dois dias antes.
t('as 01:00, 26 horas atras e ANTEONTEM: data cheia',
  textoVistoEm(D(2026, 8, 25, 23, 0), D(2026, 8, 27, 1, 0)) === '25/08/2026 às 23:00');

// -------------------------------------------------------------- data cheia
t('tres dias atras: dia/mes/ano e hora',
  textoVistoEm(D(2026, 8, 24, 21, 40), agora) === '24/08/2026 às 21:40');
t('mes e dia com dois digitos',
  textoVistoEm(D(2026, 7, 3, 8, 7), agora) === '03/07/2026 às 08:07');
t('ano anterior tambem e data cheia',
  textoVistoEm(D(2025, 12, 31, 23, 59), agora) === '31/12/2025 às 23:59');

// A virada do MÊS e a do ANO não podem virar "ontem" errado nem pular um dia.
t('primeiro do mes: o dia anterior e "ontem"',
  textoVistoEm(D(2026, 7, 31, 22, 0), D(2026, 8, 1, 10, 0)) === 'ontem às 22:00');
t('primeiro de janeiro: 31/12 e "ontem"',
  textoVistoEm(D(2025, 12, 31, 22, 0), D(2026, 1, 1, 10, 0)) === 'ontem às 22:00');

// ------------------------------------------------------------------ futuro
// Relógios discordam (o carimbo é do servidor, o "agora" é da máquina de quem
// lê). Alguns minutos à frente ainda são HOJE, e isso é o que se quer ver; um
// dia à frente cai na data cheia, em vez de uma frase inventada tipo "amanhã".
t('alguns minutos no futuro continuam sendo hoje',
  textoVistoEm(D(2026, 8, 27, 15, 2), agora) === 'hoje às 15:02');
t('um dia no futuro vira data cheia (nunca "amanha")',
  textoVistoEm(D(2026, 8, 28, 9, 0), agora) === '28/08/2026 às 09:00');

// ---------------------------------------------------------------- formatos
// O que chega do PostgREST é uma string ISO com fuso; o módulo aceita os três
// (string, número e Date) porque a origem muda conforme quem chama.
const alvo = D(2026, 8, 27, 14, 32);
t('string ISO da o mesmo que o Date', textoVistoEm(alvo.toISOString(), agora) === 'hoje às 14:32');
t('numero (ms) da o mesmo que o Date', textoVistoEm(alvo.getTime(), agora) === 'hoje às 14:32');

// ------------------------------------------------------- horario de verao
// Um dia de 23h ou de 25h não pode deslocar a conta: como ela é entre as
// meias-noites LOCAIS, o arredondamento devolve 1 nos dois casos. O teste só
// vale onde o fuso tem DST — onde não tem, ele confere o caso normal, que
// também precisa passar.
const dstIda = D(2026, 3, 15, 12, 0);      // um dia qualquer
t('dia anterior e sempre "ontem", com ou sem horario de verao',
  textoVistoEm(D(2026, 3, 14, 12, 0), dstIda) === 'ontem às 12:00');

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
