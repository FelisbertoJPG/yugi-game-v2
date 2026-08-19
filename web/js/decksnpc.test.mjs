/**
 * A trilha de DECKS de um adversário: qual deck está liberado, em que ordem.
 *
 *     node web/js/decksnpc.test.mjs
 *
 * A regra é IMPORTADA de `decksnpc.js` — não copiada. O painel da trilha, o
 * Deck Builder do NPC e este teste usam a MESMA função; um espelho divergiria
 * em silêncio.
 *
 * O caso do pedido é o Para & Dox: dois decks, o "Guardião do Portão" trancado
 * atrás do "Bem-vindo ao Labirinto".
 */
import {
  decksLiberados, deckPadrao, normalizarDificuldade, normalizarLibera,
} from './decksnpc.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

const venceu = (...nomes) => new Set(nomes);
/** `d('a>b')` = deck "a" que libera "b"; `d('c')` = deck "c" que não libera nada. */
const d = (spec) => {
  const [name, libera] = spec.split('>');
  return { name, libera: libera ?? null };
};
const nomes = (l) => l.map((x) => x.deck.name).join(',');
const abertos = (l) => l.map((x) => (x.aberto ? '1' : '0')).join('');

// ------------------------------------------------------------ o caso do pedido
{
  const paradox = [d('Bem-vindo ao Labirinto>Guardião do Portão'), d('Guardião do Portão')];

  t('sem vitoria, so o deck 1 esta aberto',
    abertos(decksLiberados(paradox, venceu())) === '10');

  t('vencido o deck 1, o deck 2 abre',
    abertos(decksLiberados(paradox, venceu('Bem-vindo ao Labirinto'))) === '11');

  t('a ordem segue a cadeia, nao a ordem alfabetica',
    nomes(decksLiberados(paradox, venceu())) === 'Bem-vindo ao Labirinto,Guardião do Portão');

  t('vencer o deck 2 nao tranca o deck 1',
    abertos(decksLiberados(paradox, venceu('Guardião do Portão'))) === '10');
}

// O deck 2 na PRIMEIRA posição do array continua sendo o segundo da cadeia: a
// ordem vem do `#libera`, não de quem foi salvo antes.
t('a cadeia manda, mesmo com o array invertido',
  nomes(decksLiberados([d('b'), d('a>b')], venceu())) === 'a,b');

// ------------------------------------------------------------------ um deck só
t('deck unico esta sempre aberto', abertos(decksLiberados([d('so')], venceu())) === '1');
t('lista vazia devolve vazio', decksLiberados([], venceu()).length === 0);
t('lista vazia nao estoura o padrao', deckPadrao([], venceu()) === null);

// --------------------------------------------------------------- cadeia longa
{
  const tres = [d('a>b'), d('b>c'), d('c')];
  t('cadeia de tres: so a raiz abre', abertos(decksLiberados(tres, venceu())) === '100');
  t('cadeia de tres: vencer a abre b, nao c',
    abertos(decksLiberados(tres, venceu('a'))) === '110');
  t('cadeia de tres: vencer a e b abre tudo',
    abertos(decksLiberados(tres, venceu('a', 'b'))) === '111');
  // Vencer o do meio sem ter vencido a raiz (por um caminho antigo, ou porque a
  // cadeia mudou depois) abre o seguinte — mas não a cadeia inteira em cascata.
  t('vencer o do meio abre o seguinte, sem cascata',
    abertos(decksLiberados(tres, venceu('b'))) === '101');
}

// -------------------------------------------------------- dois ramos irmãos
{
  // Dois decks apontam para o MESMO terceiro: vencer qualquer um dos dois abre.
  const irmaos = [d('a>final'), d('b>final'), d('final')];
  t('dois ramos: ambas as raizes abrem', abertos(decksLiberados(irmaos, venceu())) === '110');
  t('dois ramos: vencer so um ja abre o final',
    abertos(decksLiberados(irmaos, venceu('b'))) === '111');
}

// ------------------------------------------------------- configuração torta
//
// Nada aqui pode deixar um adversário INJOGÁVEL. Um erro de digitação do admin
// não pode custar o acesso ao deck.
{
  t('libera para um deck que nao existe nao tranca ninguem',
    abertos(decksLiberados([d('a>sumiu'), d('b')], venceu())) === '11');

  t('deck que libera a si mesmo continua sendo raiz',
    abertos(decksLiberados([d('a>a')], venceu())) === '1');

  // Ciclo fechado: sem salvaguarda, NENHUM deck seria raiz e o NPC ficaria
  // inalcançável para sempre.
  const ciclo = decksLiberados([d('a>b'), d('b>a')], venceu());
  t('ciclo fechado ainda abre uma porta de entrada',
    ciclo.length === 2 && ciclo.some((x) => x.aberto));

  t('ciclo fechado nao perde nenhum deck da lista', nomes(ciclo).split(',').length === 2);
}

// ------------------------------------------------------------- o deck padrão
{
  const paradox = [d('Bem-vindo ao Labirinto>Guardião do Portão'), d('Guardião do Portão')];
  t('o padrao e o primeiro ABERTO',
    deckPadrao(paradox, venceu())?.name === 'Bem-vindo ao Labirinto');
  t('o padrao continua sendo a raiz mesmo com tudo liberado',
    deckPadrao(paradox, venceu('Bem-vindo ao Labirinto'))?.name === 'Bem-vindo ao Labirinto');
}

// ------------------------------------------------------------- normalizações
t('dificuldade aceita texto livre', normalizarDificuldade(' iniciante ') === 'iniciante');
t('dificuldade numerica vira texto', normalizarDificuldade(1) === '1');
t('dificuldade nao quebra linha', normalizarDificuldade('a\nb') === 'a b');
t('dificuldade ausente vira vazio', normalizarDificuldade(undefined) === '');
t('libera vazio vira null', normalizarLibera('  ', 'a') === null);
t('libera a si mesmo vira null', normalizarLibera('a', 'a') === null);
t('libera outro deck e preservado', normalizarLibera('b', 'a') === 'b');

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
