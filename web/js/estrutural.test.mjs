/**
 * Rascunho do Deck Estrutural — a rede de segurança de `web/estrutural.html`.
 *   node web/js/estrutural.test.mjs
 *
 * Existe por um prejuízo real: publicar chamava `validar_deck_estrutural`, que
 * não era SECURITY DEFINER e batia em "permission denied for function
 * ydk_por_secao" (migration 0021). O deck só vivia na memória da aba, então a
 * recusa levava junto o trabalho inteiro — e levou.
 *
 * O código testado é EXTRAÍDO do próprio `estrutural.html`, não copiado: o
 * teste lê o arquivo a cada execução, então não existe uma segunda versão para
 * envelhecer em silêncio. Se o bloco for renomeado, isto falha alto em vez de
 * passar testando nada.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(import.meta.url), '..', '..', '..');
const html = readFileSync(join(RAIZ, 'web', 'estrutural.html'), 'utf8');
const src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

// Só o bloco do rascunho, tal como está no arquivo.
const bloco = src.slice(src.indexOf('const RASCUNHO ='), src.indexOf('/** "Deck do Dragão Branco"'));
if (!bloco.includes('restaurarRascunho')) { console.error('nao achei o bloco'); process.exit(2); }

// ---- ambiente de mentira
const loja = new Map();
globalThis.localStorage = {
  getItem: (k) => (loja.has(k) ? loja.get(k) : null),
  setItem: (k, v) => loja.set(k, String(v)),
  removeItem: (k) => loja.delete(k),
};
const campos = { nome: { value: '' }, preco: { value: 300 }, 'na-loja': { checked: true } };
let quantidades = {}, raridades = {}, idAtual = null, ultimaMsg = null;

const ctx = {
  $: (id) => campos[id],
  total: () => Object.values(quantidades).reduce((a, b) => a + b, 0),
  msg: (t, tipo) => { ultimaMsg = { t, tipo }; },
  pintarDeck: () => {}, pintarPool: () => {},
  get idAtual() { return idAtual; }, set idAtual(v) { idAtual = v; },
  get quantidades() { return quantidades; }, set quantidades(v) { quantidades = v; },
  get raridades() { return raridades; }, set raridades(v) { raridades = v; },
};

const fabrica = new Function('ctx', `
  const { $, total, msg, pintarDeck, pintarPool } = ctx;
  let idAtual = ctx.idAtual, quantidades = ctx.quantidades, raridades = ctx.raridades;
  ${bloco}
  return {
    salvarRascunho, apagarRascunho, restaurarRascunho,
    estado: () => ({ idAtual, quantidades, raridades }),
    por: (q, r, id) => { quantidades = q; raridades = r; idAtual = id ?? null;
                         ctx.quantidades = q; ctx.raridades = r; },
  };
`);
const api = fabrica(ctx);

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  OK    ${nome}`); pass++; }
  catch (e) { console.log(`  FALHA ${nome}\n        ${e.message}`); fail++; }
};
const ok = (c, o) => { if (!c) throw new Error(o); };

t('deck vazio nao deixa rascunho', () => {
  api.por({}, {});
  api.salvarRascunho();
  ok(localStorage.getItem('ygo:estrutural:rascunho') === null, 'gravou com deck vazio');
});

t('deck com cartas grava o rascunho', () => {
  campos.nome.value = 'Deck do Dragao Branco';
  api.por({ 46986414: 3, 89631139: 2 }, { 46986414: 'UR', 89631139: 'SR' });
  api.salvarRascunho();
  const r = JSON.parse(localStorage.getItem('ygo:estrutural:rascunho'));
  ok(r.quantidades['46986414'] === 3, 'copias');
  ok(r.raridades['89631139'] === 'SR', 'raridade');
  ok(r.nome === 'Deck do Dragao Branco', 'nome');
  ok(typeof r.em === 'number', 'carimbo de hora');
});

t('restaurar traz cartas, raridades e nome de volta', () => {
  campos.nome.value = ''; api.por({}, {});
  ok(api.restaurarRascunho() === true, 'nao restaurou');
  const e = api.estado();
  ok(e.quantidades['46986414'] === 3, 'copias perdidas');
  ok(e.raridades['46986414'] === 'UR', 'raridade perdida');
  ok(campos.nome.value === 'Deck do Dragao Branco', 'nome perdido');
  ok(ultimaMsg.tipo === 'ok' && /rascunho recuperado/.test(ultimaMsg.t), 'nao avisou');
});

t('apagar tira o rascunho e restaurar passa a devolver false', () => {
  api.apagarRascunho();
  ok(localStorage.getItem('ygo:estrutural:rascunho') === null, 'sobrou');
  ok(api.restaurarRascunho() === false, 'restaurou do nada');
});

t('rascunho corrompido nao explode, so devolve false', () => {
  localStorage.setItem('ygo:estrutural:rascunho', '{isso nao e json');
  ok(api.restaurarRascunho() === false, 'devia recusar');
});

t('rascunho sem cartas e ignorado', () => {
  localStorage.setItem('ygo:estrutural:rascunho', JSON.stringify({ quantidades: {} }));
  ok(api.restaurarRascunho() === false, 'restaurou um deck vazio');
});

t('sem localStorage nenhum, nada lanca', () => {
  const guardado = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('bloqueado'); },
                              setItem() { throw new Error('bloqueado'); },
                              removeItem() { throw new Error('bloqueado'); } };
  api.por({ 1: 1 }, {});
  api.salvarRascunho();      // não pode lançar
  api.apagarRascunho();      // idem
  ok(api.restaurarRascunho() === false, 'devia devolver false');
  globalThis.localStorage = guardado;
});

console.log(`\n  ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
