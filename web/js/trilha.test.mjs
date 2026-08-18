/**
 * A regra de LIBERAÇÃO da Trilha de Duelos.
 *
 *     node web/js/trilha.test.mjs
 *
 * Cada adversário libera o próximo ao ser vencido. É a regra que decide o que o
 * jogador vê e o que fica atrás do cadeado — e ela mora numa função pura, então
 * dá para prová-la sem navegador.
 *
 * A regra é IMPORTADA de `trilhaordem.js` — não copiada. Aquele módulo existe
 * exatamente para isto: é função pura, sem DOM e sem `fetch`, então carrega em
 * Node, e a trilha, a tela de ordenação e este teste usam a MESMA. Um espelho
 * divergiria em silêncio.
 */
import { ordenarCampanha, liberados } from './trilhaordem.js';

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

// ---------------------------------------------------------------------------
// A ORDEM PUBLICADA (Area de Teste -> "Ordenar Trilha")
//
// Guardada por ID em `conteudo/npc-trilha`, e nao por indice: e' o que faz um
// adversario novo entrar na campanha sem trocar a trilha de todo mundo.
const ids = (lista) => lista.map((n) => n.id).join(',');

t('sem ordem publicada, vale a ordem de criacao',
  ids(ordenarCampanha(trilha('a', 'b', 'c'), undefined)) === 'a,b,c');

t('a ordem publicada manda',
  ids(ordenarCampanha(trilha('a', 'b', 'c'), ['c', 'a', 'b'])) === 'c,a,b');

// O caso do pedido: [wevil -> rex_raptor] [rex_raptor -> mako]
t('o exemplo do pedido: wevil, rex_raptor, mako',
  ids(ordenarCampanha(trilha('mako', 'wevil', 'rex_raptor'),
                      ['wevil', 'rex_raptor', 'mako'])) === 'wevil,rex_raptor,mako');

// A armadilha que o ID fecha: um adversario NOVO entra na campanha e nao esta'
// na lista publicada. Ele vai para o fim; a ordem dos outros nao muda.
t('adversario fora da lista publicada vai para o FIM, sem mexer nos outros',
  ids(ordenarCampanha(trilha('novo', 'a', 'b'), ['b', 'a'])) === 'b,a,novo');

t('dois fora da lista mantem entre si a ordem de criacao',
  ids(ordenarCampanha(trilha('n1', 'a', 'n2'), ['a'])) === 'a,n1,n2');

// Id publicado que nao existe mais (adversario apagado) nao pode furar nada.
t('id publicado que nao existe mais e ignorado',
  ids(ordenarCampanha(trilha('a', 'b'), ['sumiu', 'b', 'a'])) === 'b,a');

t('campanha vazia devolve vazio', ordenarCampanha([], ['a']).length === 0);

// E a ponta que liga as duas regras: ordenar E liberar, na mesma trilha.
{
  const ordenada = ordenarCampanha(trilha('mako', 'wevil', 'rex_raptor'),
                                   ['wevil', 'rex_raptor', 'mako']);
  t('ordenada e com o 1o vencido, abre ate o 2o',
    String(liberados(ordenada, venceu('wevil'))) === String([true, true, false]));
}

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
