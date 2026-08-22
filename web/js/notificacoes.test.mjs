/**
 * Testes das NOTIFICACOES da home — `node web/js/notificacoes.test.mjs`.
 *
 * Duas metades, e as duas erram CALADAS:
 *
 *   • **a montagem da lista.** A chave e' o que identifica uma notificacao
 *     entre duas consultas: repetida, a mesma coisa aparece duas vezes;
 *     instavel, o cartao aberto se fecha sozinho a cada 15 segundos, e quem
 *     estava lendo o convite perde ele na cara. Nenhuma das duas da' erro;
 *   • **o parse do protocolo do Realtime.** Um campo lido do lugar errado
 *     devolve `undefined`, a notificacao nao aparece e nao ha' erro nenhum —
 *     nem no console. E' a mesma razao de o protocolo binario do ocgcore ter
 *     teste: o sintoma e' silencio.
 *
 * Nada aqui toca a rede. Os dois modulos foram escritos com as funcoes puras
 * separadas justamente para isto ser possivel.
 */
import { montarNotificacoes, novidades } from './notificacoes.js';
import { interpretar } from './realtime.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const desafio = (partida, quando, usuario = 'Fulano') => ({
  partida, de: `id-${usuario}`, usuario, etiqueta: 22502, criado_em: quando,
});
const pedido = (id, quando, usuario = 'Ciclano') => ({
  id, usuario, etiqueta: 11337, direcao: 'recebido', desde: quando, online: true,
});

// ------------------------------------------------------------ a lista

t('junta desafio e pedido de amizade numa lista so', () => {
  const l = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')],
                               [pedido('a1', '2026-08-22T09:00:00Z')]);
  assert.equal(l.length, 2);
  assert.deepEqual(l.map((n) => n.tipo), ['duelo', 'amizade']);
});

// O desafio expira em 10 minutos (`meus_desafios`); o pedido de amizade espera
// para sempre. O que tem prazo vem primeiro, mesmo sendo mais novo.
t('duelo vem antes de amizade, mesmo sendo o mais recente', () => {
  const l = montarNotificacoes([desafio('p1', '2026-08-22T08:00:00Z')],
                               [pedido('a1', '2026-08-22T23:00:00Z')]);
  assert.equal(l[0].tipo, 'duelo');
});

t('dentro do tipo, o mais novo primeiro', () => {
  const l = montarNotificacoes(
    [desafio('velho', '2026-08-22T08:00:00Z'), desafio('novo', '2026-08-22T12:00:00Z')], []);
  assert.deepEqual(l.map((n) => n.partida), ['novo', 'velho']);
});

// Sem isto, a mesma notificacao aparece duas vezes e o contador mente.
t('a mesma partida duas vezes vira UMA notificacao', () => {
  const l = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z'),
                                desafio('p1', '2026-08-22T10:00:00Z')], []);
  assert.equal(l.length, 1);
});

// A chave e' o que liga a notificacao ao cartao aberto na tela. Se mudasse a
// cada consulta, o cartao se fecharia sozinho a cada 15 segundos.
t('a chave e estavel entre duas montagens da mesma coisa', () => {
  const a = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')], []);
  const b = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')], []);
  assert.equal(a[0].chave, b[0].chave);
  assert.equal(a[0].chave, 'duelo:p1');
});

t('duelo e amizade nunca colidem de chave', () => {
  const l = montarNotificacoes([desafio('x', '2026-08-22T10:00:00Z')],
                               [pedido('x', '2026-08-22T10:00:00Z')]);
  assert.equal(l.length, 2);
  assert.notEqual(l[0].chave, l[1].chave);
});

// 'enviado' e' o MEU pedido esperando o outro responder: notificar-me dele
// seria me avisar de algo que eu mesmo fiz.
t('so o pedido RECEBIDO notifica — amigo e enviado ficam de fora', () => {
  const lista = [
    { ...pedido('a1', '2026-08-22T10:00:00Z'), direcao: 'amigo' },
    { ...pedido('a2', '2026-08-22T10:00:00Z'), direcao: 'enviado' },
    pedido('a3', '2026-08-22T10:00:00Z'),
  ];
  const l = montarNotificacoes([], lista);
  assert.equal(l.length, 1);
  assert.equal(l[0].quem.id, 'a3');
});

t('lixo nas duas listas nao derruba nada', () => {
  for (const [d, a] of [[null, null], [undefined, undefined], ['x', 42],
                        [[null, {}], [null, {}]], [[{ partida: '' }], [{ direcao: 'recebido' }]]]) {
    assert.equal(montarNotificacoes(d, a).length, 0);
  }
});

// Data invalida indo para o TOPO faria a ordem depender de quem chegou antes
// na consulta — instavel entre duas leituras da mesma coisa.
t('sem data valida, a notificacao vai para o fim do grupo', () => {
  const l = montarNotificacoes(
    [desafio('sem-data', null), desafio('com-data', '2026-08-22T10:00:00Z')], []);
  assert.deepEqual(l.map((n) => n.partida), ['com-data', 'sem-data']);
});

t('o nome de quem chamou chega inteiro na notificacao', () => {
  const l = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z', 'Kaiba')], []);
  assert.deepEqual(l[0].quem, { id: 'id-Kaiba', usuario: 'Kaiba', etiqueta: 22502 });
});

// ------------------------------------------------------------ novidades

t('novidade e o que ainda nao estava la', () => {
  const antes = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')], []);
  const agora = montarNotificacoes(
    [desafio('p1', '2026-08-22T10:00:00Z'), desafio('p2', '2026-08-22T11:00:00Z')], []);
  const n = novidades(antes, agora);
  assert.equal(n.length, 1);
  assert.equal(n[0].partida, 'p2');
});

// Comparar o TAMANHO nao serve: um desafio expirando e outro chegando entre
// duas consultas deixa a contagem igual, e o novo passaria despercebido.
t('um sai e outro entra: o tamanho nao muda, a novidade existe', () => {
  const antes = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')], []);
  const agora = montarNotificacoes([desafio('p2', '2026-08-22T11:00:00Z')], []);
  assert.equal(antes.length, agora.length);
  assert.equal(novidades(antes, agora).length, 1);
});

t('a mesma lista nao tem novidade nenhuma', () => {
  const l = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')],
                               [pedido('a1', '2026-08-22T09:00:00Z')]);
  assert.equal(novidades(l, l).length, 0);
});

t('sem lista anterior, tudo e novidade', () => {
  const l = montarNotificacoes([desafio('p1', '2026-08-22T10:00:00Z')], []);
  assert.equal(novidades(null, l).length, 1);
  assert.equal(novidades([], l).length, 1);
});

// ------------------------------------------- o protocolo do Realtime

t('um INSERT vira evento com a linha nova', () => {
  const e = interpretar({
    event: 'postgres_changes',
    payload: { data: { type: 'INSERT', schema: 'public', table: 'partidas',
                       record: { id: 'p1', convidado: 'eu' }, old_record: {} } },
  });
  assert.deepEqual(e, { tabela: 'partidas', tipo: 'INSERT',
                        novo: { id: 'p1', convidado: 'eu' }, antigo: null });
});

// `old_record` so' vem preenchido com `replica identity full` — e' por isso que
// a migration 0034 liga isso em `amizades`. Sem a linha antiga, "o pedido foi
// aceito" chega sem dizer de quem era.
t('um UPDATE traz a linha antiga junto', () => {
  const e = interpretar({
    event: 'postgres_changes',
    payload: { data: { type: 'UPDATE', schema: 'public', table: 'amizades',
                       record: { de: 'x', estado: 'aceito' },
                       old_record: { de: 'x', estado: 'pendente' } } },
  });
  assert.equal(e.antigo.estado, 'pendente');
  assert.equal(e.novo.estado, 'aceito');
});

// `{}` (e nao null) e' o que o servidor manda quando nao se aplica, e um `?.`
// sobre isso devolve undefined em silencio. Normalizar uma vez, aqui.
t('record vazio vira null, nao um objeto vazio', () => {
  const e = interpretar({
    event: 'postgres_changes',
    payload: { data: { type: 'DELETE', schema: 'public', table: 'amizades',
                       record: {}, old_record: { de: 'x' } } },
  });
  assert.equal(e.novo, null);
  assert.deepEqual(e.antigo, { de: 'x' });
});

t('o phx_reply do JOIN e reconhecido', () => {
  const e = interpretar({
    event: 'phx_reply', topic: 'realtime:classic-duels',
    payload: { status: 'ok', response: { postgres_changes: [{ id: 1 }] } },
  });
  assert.equal(e.tipo, '__join_ok');
});

// Um "ok" SEM postgres_changes e' a resposta do `access_token`, mandado a cada
// heartbeat. Trata-lo como join faria a tela desligar a reserva por engano.
t('o ok do access_token NAO passa por join', () => {
  const e = interpretar({
    event: 'phx_reply', topic: 'realtime:classic-duels',
    payload: { status: 'ok', response: {} },
  });
  assert.equal(e, null);
});

t('join recusado vira erro, para o canal poder reconectar', () => {
  const e = interpretar({
    event: 'phx_reply', topic: 'realtime:classic-duels',
    payload: { status: 'error', response: { reason: 'token invalido' } },
  });
  assert.equal(e.tipo, '__join_erro');
});

t('o que nao interessa devolve null em vez de evento vazio', () => {
  for (const m of [null, undefined, 'x', 42, {},
                   { event: 'phx_reply', topic: 'phoenix', payload: { status: 'ok' } },
                   { event: 'presence_state', payload: {} },
                   { event: 'postgres_changes', payload: {} },
                   { event: 'postgres_changes', payload: { data: { type: 'INSERT' } } },
                   { event: 'postgres_changes', payload: { data: { table: 'partidas' } } }]) {
    assert.equal(interpretar(m), null, `deveria ser null: ${JSON.stringify(m)}`);
  }
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
