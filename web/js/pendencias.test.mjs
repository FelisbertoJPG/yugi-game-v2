/**
 * A fila do que ainda não chegou à nuvem.
 *
 *     node web/js/pendencias.test.mjs
 *
 * O que se prova aqui é o contrato de que o `projectstore` depende: uma
 * pendência por chave (sempre a mais nova), some quando o banco aceita, e
 * aguenta ser editada por gente — inclusive um `localStorage` corrompido ou
 * cheio, que é o que acontece em modo privativo.
 */
import {
  memoriaFalsa, enfileirar, desenfileirar, listar, quantas, temPendencia,
  limpar, resumo, CHAVE_FILA,
} from './pendencias.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

// ------------------------------------------------------------------- o básico
{
  const s = memoriaFalsa();
  t('fila nova esta vazia', quantas(s) === 0);
  t('fila vazia nao tem resumo (a tela esconde o aviso)', resumo(s) === null);

  enfileirar(s, 'banlist', { a: 1 }, 'sem sessão');
  t('o que nao subiu fica guardado', quantas(s) === 1);
  t('...com o dado inteiro', listar(s)[0].data.a === 1);
  t('...e com o motivo, para o aviso poder explicar', listar(s)[0].motivo === 'sem sessão');
  t('temPendencia acha pelo nome', temPendencia(s, 'banlist'));
  t('...e nao inventa o que nao esta la', !temPendencia(s, 'boosters'));

  desenfileirar(s, 'banlist');
  t('o banco aceitou: sai da fila', quantas(s) === 0);
}

// ----------------------------------------------- uma pendência por chave
//
// Cada envio carrega o documento INTEIRO, então só a última versão importa.
// Guardar histórico criaria a chance de republicar um estado velho por cima do
// bom — exatamente o que a fila existe para evitar.
{
  const s = memoriaFalsa();
  enfileirar(s, 'npcs', { v: 1 });
  enfileirar(s, 'npcs', { v: 2 });
  enfileirar(s, 'npcs', { v: 3 });
  t('tres gravacoes da mesma chave viram UMA pendencia', quantas(s) === 1);
  t('...e a que fica e a MAIS NOVA', listar(s)[0].data.v === 3);
}

// Chaves diferentes não se atropelam: publicar a banlist não pode levar junto
// (nem apagar) o pool de drop que também estava esperando.
{
  const s = memoriaFalsa();
  enfileirar(s, 'banlist', { b: 1 });
  enfileirar(s, 'npc-drops', { d: 1 });
  desenfileirar(s, 'banlist');
  t('desenfileirar uma chave nao mexe na outra',
    quantas(s) === 1 && temPendencia(s, 'npc-drops'));
}

// ------------------------------------------------------------------ o resumo
{
  const s = memoriaFalsa();
  enfileirar(s, 'banlist', {});
  t('resumo no singular com uma so', resumo(s) === '1 alteração ainda não publicada (banlist)');
  enfileirar(s, 'npcs', {});
  t('resumo no plural com duas', /^2 alterações/.test(resumo(s)));
  t('...e nomeia as duas', /banlist/.test(resumo(s)) && /npcs/.test(resumo(s)));
  limpar(s);
  t('limpar zera', resumo(s) === null);
}

// ---------------------------------------------------------- entrada torta
//
// Nada aqui pode derrubar o editor: a fila roda DENTRO da gravação, e uma
// exceção aqui faria perder a edição que ela existe para salvar.
{
  const s = memoriaFalsa({ [CHAVE_FILA]: 'isto nao e json' });
  t('fila corrompida vira fila vazia, sem estourar', quantas(s) === 0);
  enfileirar(s, 'x', { ok: true });
  t('...e volta a funcionar por cima', quantas(s) === 1);

  const arr = memoriaFalsa({ [CHAVE_FILA]: '[1,2,3]' });
  t('array no lugar do objeto tambem vira vazio', quantas(arr) === 0);

  t('enfileirar sem nome nao entra', enfileirar(memoriaFalsa(), '', { a: 1 }) === false);
  t('desenfileirar o que nao existe devolve false',
    desenfileirar(memoriaFalsa(), 'nao-existe') === false);
}

// `localStorage` cheio (modo privativo, cota estourada): a gravação falha e
// precisa DIZER que falhou, em vez de fingir que guardou.
{
  const cheio = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  t('storage que recusa devolve false, sem estourar',
    enfileirar(cheio, 'banlist', { a: 1 }) === false);
}

// Sem storage nenhum (Node puro, antes de qualquer polyfill).
{
  t('sem storage nao estoura ao ler', quantas(undefined) === 0);
  t('sem storage nao estoura ao gravar', enfileirar(undefined, 'x', {}) === false);
}

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
