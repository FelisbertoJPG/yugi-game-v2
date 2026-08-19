/**
 * Rascunho do Deck Estrutural — a rede de segurança de `web/estrutural.html`.
 *   node web/js/estrutural.test.mjs
 *
 * O rascunho protege contra perder o trabalho, mas NUNCA é carregado de volta:
 * ao abrir a tela ele é ARQUIVADO em `store/bkp/` e sai do navegador. Antes o
 * boot o restaurava por cima de tudo, e era isso que fazia a cópia local vencer
 * a nuvem — um deck publicado numa máquina abria VELHO na outra.
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
if (!bloco.includes('arquivarRascunho')) { console.error('nao achei o bloco'); process.exit(2); }

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
  // O mesmo `slug` do arquivo, copiado aqui porque ele mora FORA do bloco.
  slug: (x) => String(x).normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'estrutural',
  fetch: (url, opts) => { gravou.push({ url, corpo: JSON.parse(opts.body) }); return respostaDoDisco(); },
};

/** O que o `arquivarRascunho` mandou para `/__store/`, e como o disco respondeu. */
let gravou = [];
let respostaDoDisco = async () => ({ ok: true, json: async () => ({ ok: true }) });

const fabrica = new Function('ctx', `
  const { $, total, msg, pintarDeck, pintarPool, slug, fetch } = ctx;
  let idAtual = ctx.idAtual, quantidades = ctx.quantidades, raridades = ctx.raridades;
  ${bloco}
  return {
    salvarRascunho, apagarRascunho, lerRascunho, arquivarRascunho,
    estado: () => ({ idAtual, quantidades, raridades }),
    por: (q, r, id) => { quantidades = q; raridades = r; idAtual = id ?? null;
                         ctx.quantidades = q; ctx.raridades = r; },
  };
`);
const api = fabrica(ctx);

let pass = 0, fail = 0;
// `await fn()`, e não `fn()`: arquivar é assíncrono (fala com `/__store/`), e
// num try/catch síncrono uma promessa rejeitada passaria batido — o caso
// falharia e este arquivo diria OK.
const t = async (nome, fn) => {
  try { await fn(); console.log(`  OK    ${nome}`); pass++; }
  catch (e) { console.log(`  FALHA ${nome}\n        ${e.message}`); fail++; }
};
const ok = (c, o) => { if (!c) throw new Error(o); };

await t('deck vazio nao deixa rascunho', () => {
  api.por({}, {});
  api.salvarRascunho();
  ok(localStorage.getItem('ygo:estrutural:rascunho') === null, 'gravou com deck vazio');
});

await t('deck com cartas grava o rascunho', () => {
  campos.nome.value = 'Deck do Dragao Branco';
  api.por({ 46986414: 3, 89631139: 2 }, { 46986414: 'UR', 89631139: 'SR' });
  api.salvarRascunho();
  const r = JSON.parse(localStorage.getItem('ygo:estrutural:rascunho'));
  ok(r.quantidades['46986414'] === 3, 'copias');
  ok(r.raridades['89631139'] === 'SR', 'raridade');
  ok(r.nome === 'Deck do Dragao Branco', 'nome');
  ok(typeof r.em === 'number', 'carimbo de hora');
});

// --------------------------------------------- o rascunho NAO volta sozinho
//
// O coracao da correcao: a copia local nunca vence a nuvem. Ao abrir a tela o
// rascunho e' ARQUIVADO em store/bkp/ e sai do navegador — nada dele e'
// aplicado no editor.
//
// O sintoma que trouxe isto: um Deck Estrutural editado e publicado numa
// maquina (o colega recebeu na hora, pelo gatilho da 0025) abria VELHO ao
// reabrir o editor noutra, porque ali havia um rascunho pendurado que o boot
// restaurava por cima. Ele so' era apagado ao publicar COM SUCESSO naquela
// maquina — quem publicou de outro lugar nunca o limpava.

await t('arquivar grava em store/bkp/ e limpa o navegador', async () => {
  gravou = [];
  campos.nome.value = 'Deck do Dragao Branco';
  api.por({ 46986414: 3 }, { 46986414: 'UR' });
  api.salvarRascunho();

  const arquivo = await api.arquivarRascunho();
  ok(/^bkp\/estrutural-deck-do-dragao-branco-\d/.test(arquivo), 'nome do arquivo: ' + arquivo);
  ok(gravou.length === 1, 'devia gravar uma vez');
  ok(gravou[0].url === '/__store/' + arquivo, 'url errada: ' + gravou[0].url);
  ok(gravou[0].corpo.quantidades['46986414'] === 3, 'o backup perdeu as cartas');
  ok(typeof gravou[0].corpo.arquivadoEm === 'string', 'sem carimbo de arquivamento');
  ok(localStorage.getItem('ygo:estrutural:rascunho') === null, 'nao limpou o navegador');
});

await t('arquivar NAO aplica nada na tela (a nuvem e que manda)', async () => {
  campos.nome.value = 'Deck do Dragao Branco';
  api.por({ 46986414: 3 }, { 46986414: 'UR' });
  api.salvarRascunho();

  // Como se a tela ja' tivesse carregado o deck publicado.
  campos.nome.value = 'vindo da nuvem';
  api.por({ 99: 1 }, {});
  await api.arquivarRascunho();

  ok(campos.nome.value === 'vindo da nuvem', 'sobrescreveu o nome com o rascunho');
  ok(api.estado().quantidades['99'] === 1, 'sobrescreveu as cartas com o rascunho');
  ok(api.estado().quantidades['46986414'] === undefined, 'trouxe carta do rascunho');
});

await t('sem rascunho, arquivar nao grava nada e devolve null', async () => {
  gravou = [];
  api.apagarRascunho();
  ok((await api.arquivarRascunho()) === null, 'devia devolver null');
  ok(gravou.length === 0, 'gravou sem ter o que arquivar');
});

// Sem servidor no ar o rascunho FICA no navegador para a proxima tentativa.
// Joga-lo fora aqui seria destruir o backup por falta de servidor — o oposto do
// que este arquivo existe para garantir.
await t('servidor fora do ar NAO perde o rascunho', async () => {
  campos.nome.value = 'Deck do Dragao Branco';
  api.por({ 46986414: 3 }, {});
  api.salvarRascunho();

  respostaDoDisco = async () => { throw new Error('sem servidor'); };
  const r = await api.arquivarRascunho();
  respostaDoDisco = async () => ({ ok: true, json: async () => ({ ok: true }) });

  ok(r === null, 'devia dizer que nao arquivou');
  ok(localStorage.getItem('ygo:estrutural:rascunho') !== null, 'APAGOU o rascunho sem ter arquivado');
});

await t('disco recusando (ok:false) tambem preserva o rascunho', async () => {
  respostaDoDisco = async () => ({ ok: false, json: async () => ({ ok: false, error: 'nome invalido' }) });
  const r = await api.arquivarRascunho();
  respostaDoDisco = async () => ({ ok: true, json: async () => ({ ok: true }) });
  ok(r === null, 'devia dizer que nao arquivou');
  ok(localStorage.getItem('ygo:estrutural:rascunho') !== null, 'perdeu o rascunho numa recusa');
});

await t('rascunho corrompido nao explode, so devolve null', () => {
  localStorage.setItem('ygo:estrutural:rascunho', '{isso nao e json');
  ok(api.lerRascunho() === null, 'devia recusar');
});

await t('rascunho sem cartas e ignorado', () => {
  localStorage.setItem('ygo:estrutural:rascunho', JSON.stringify({ quantidades: {} }));
  ok(api.lerRascunho() === null, 'aceitou um deck vazio');
});

await t('sem localStorage nenhum, nada lanca', () => {
  const guardado = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('bloqueado'); },
                              setItem() { throw new Error('bloqueado'); },
                              removeItem() { throw new Error('bloqueado'); } };
  api.por({ 1: 1 }, {});
  api.salvarRascunho();      // não pode lançar
  api.apagarRascunho();      // idem
  ok(api.lerRascunho() === null, 'devia devolver null');
  globalThis.localStorage = guardado;
});

console.log(`\n  ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
