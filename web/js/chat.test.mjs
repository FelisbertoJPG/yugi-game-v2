/**
 * As regras do CHAT — `node web/js/chat.test.mjs`
 *
 * O chat tem dois caminhos de entrega, como as notificações: o Realtime avisa em
 * menos de um segundo e uma releitura periódica garante a entrega com o socket
 * caído. Isso é bom para a entrega e péssimo para a lista: **a mesma mensagem
 * chega duas vezes**, e as releituras se cruzam e voltam fora de ordem.
 *
 * As três coisas que o `juntar` resolve erram CALADAS — nenhuma dá erro, e todas
 * aparecem como "o chat está estranho":
 *
 *   • repetida → a conversa mostra tudo em dobro;
 *   • fora de ordem → a conversa aparece embaralhada;
 *   • sem teto → a lista cresce para sempre numa tela que fica aberta o dia todo.
 *
 * A REGRA DE QUEM PODE FALAR COM QUEM não está aqui, e é de propósito: ela mora
 * no `enviar_mensagem` (migration 0040), porque um cliente é código na máquina de
 * quem joga. Testá-la aqui daria a impressão de que ela existe deste lado.
 */
import assert from 'node:assert/strict';
import { juntar, ultimoId, valeMandar, MAX_TEXTO } from './chat.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const m = (id, texto = 'oi') => ({ id, texto, de: 'x', usuario: 'fulano' });
const ids = (l) => l.map((x) => x.id);

// ------------------------------------------------------------------ juntar

t('a mesma mensagem chegando duas vezes entra uma vez', () => {
  // O Realtime avisa, a doca relê; 2s depois a reserva relê de novo e traz a
  // mesma linha. Sem o corte, a conversa mostra tudo em dobro.
  assert.deepEqual(ids(juntar([m(1), m(2)], [m(2), m(3)])), [1, 2, 3]);
});

t('e fora de ordem entra na ordem', () => {
  assert.deepEqual(ids(juntar([m(3)], [m(1), m(2)])), [1, 2, 3]);
});

t('o teto corta pelo COMEÇO — o fim da conversa é o que interessa', () => {
  const muitas = Array.from({ length: 250 }, (_, i) => m(i + 1));
  const r = juntar([], muitas, 200);
  assert.equal(r.length, 200);
  assert.equal(r[0].id, 51, 'cortou pelo lado errado: sumiram as mensagens NOVAS');
  assert.equal(r.at(-1).id, 250);
});

t('lista vazia e lixo não derrubam a conversa', () => {
  assert.deepEqual(juntar(null, null), []);
  assert.deepEqual(juntar([], [{ texto: 'sem id' }]), [], 'linha sem id entraria sem poder ser deduplicada');
  assert.deepEqual(ids(juntar([], [m(1), { id: 'abc' }])), [1]);
});

t('não mexe nas listas recebidas', () => {
  const a = [m(2)], b = [m(1)];
  juntar(a, b);
  assert.deepEqual(ids(a), [2]);
  assert.deepEqual(ids(b), [1]);
});

// ---------------------------------------------------------------- ultimoId

// É o `desde` da próxima leitura. Errar para MAIS pula mensagens (elas nunca
// aparecem); errar para MENOS relê o que já se tem — barato, e o `juntar`
// resolve. Por isso o zero é a resposta para lista vazia.
t('ultimoId é o maior, não o último da lista', () => {
  assert.equal(ultimoId([m(3), m(1), m(7), m(2)]), 7);
});

t('ultimoId de lista vazia é 0 (traz o histórico inicial)', () => {
  assert.equal(ultimoId([]), 0);
  assert.equal(ultimoId(null), 0);
});

t('ultimoId ignora id que não é número', () => {
  assert.equal(ultimoId([m(5), { id: 'abc' }]), 5);
});

// -------------------------------------------------------------- valeMandar

t('espaço em branco não é mensagem', () => {
  assert.equal(valeMandar('   '), false);
  assert.equal(valeMandar(''), false);
  assert.equal(valeMandar(null), false);
  assert.equal(valeMandar('oi'), true);
});

t('o texto é medido SEM as bordas, como no banco', () => {
  // O `btrim` do lado de lá é o que decide; medir com o espaço faria a tela
  // recusar uma mensagem que o banco aceitaria.
  assert.equal(valeMandar('  ' + 'a'.repeat(MAX_TEXTO) + '  '), true);
  assert.equal(valeMandar('a'.repeat(MAX_TEXTO + 1)), false);
});

t('o teto é o mesmo do banco', () => assert.equal(MAX_TEXTO, 500));

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
