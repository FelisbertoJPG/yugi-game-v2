/**
 * O deck ATIVO de cada NPC — a resolução, sem navegador.
 *
 *     node web/js/npcativo.test.mjs
 *
 * Qual deck o adversário joga é CONTEÚDO do jogo, e morava no `localStorage` de
 * quem escolheu: duas pessoas com o mesmo jogo, lendo a mesma lista do banco,
 * viam adversários diferentes. O relato que originou isto foi "na máquina do meu
 * amigo o Para & Dox está com o deck de labirinto em vez do Gate Guardian".
 *
 * A escolha passou a ser publicada, e é resolvida pelo NOME do deck — não pelo
 * índice. O índice sozinho não serve para conteúdo publicado: a lista é ordenada
 * por nome, então um deck novo entrando antes na ordem alfabética muda o
 * significado do número e troca o deck de todo mundo sem ninguém mexer em nada.
 *
 * Este arquivo testa a REGRA, copiada aqui do `npcs.js` — o módulo de lá toca
 * `localStorage` e `fetch` no topo, e não carrega em Node. É a mesma escolha do
 * `ponte.test.mjs`: a regra é pequena o suficiente para valer o espelho, e o
 * teste morreria calado se ela mudasse de forma.
 */

/** A resolução, idêntica à de `getNpcState`. */
function resolver(guardado, decks) {
  let active = 0;
  if (typeof guardado === 'number') active = guardado;
  else if (guardado && typeof guardado === 'object') {
    const porNome = decks.findIndex((d) => d.name === guardado.nome);
    active = porNome >= 0 ? porNome : Number(guardado.i) || 0;
  }
  return Math.min(active, Math.max(0, decks.length - 1));
}

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

const d = (...nomes) => nomes.map((name) => ({ name }));

// O caso do relato: a lista tem dois decks e a escolha publicada é o Gate
// Guardian. Sem nada publicado, cai no primeiro da ordem — o labirinto.
const paraDox = d('Bem vindo ao Labirinto!', 'Guardião do Portão');
t('sem escolha nenhuma, cai no primeiro da lista',
  resolver(undefined, paraDox) === 0);
t('com a escolha publicada, todo mundo joga o mesmo deck',
  resolver({ i: 1, nome: 'Guardião do Portão' }, paraDox) === 1);

// A armadilha que o nome resolve: um deck novo entra ANTES na ordem alfabética.
const comDeckNovo = d('A Fúria do Muro', 'Bem vindo ao Labirinto!', 'Guardião do Portão');
t('deck novo entrando antes na ordem NAO troca o adversario (resolve pelo nome)',
  resolver({ i: 1, nome: 'Guardião do Portão' }, comDeckNovo) === 2);
t('...e o indice sozinho trocaria (e por isso ele nao manda)',
  resolver(1, comDeckNovo) === 1);

// O deck escolhido sumiu (renomeado/apagado): cai no indice guardado.
t('deck escolhido sumiu: usa o indice como reserva',
  resolver({ i: 1, nome: 'Um Deck Que Nao Existe Mais' }, paraDox) === 1);

// Formato ANTIGO (so' o numero), que e' o que esta' no localStorage de quem ja'
// jogava — continua valendo.
t('formato antigo (so o numero) continua funcionando', resolver(1, paraDox) === 1);

// Nunca aponta para fora da lista.
t('indice maior que a lista nao estoura', resolver(9, paraDox) === 1);
t('lista vazia devolve 0', resolver({ i: 3, nome: 'x' }, []) === 0);

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
