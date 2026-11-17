/**
 * Testes dos PRESETS do Card Maker — `node web/js/cardmakerpresets.test.mjs`.
 *
 * O preset é a carta exportada pelo ygocarder com as imagens embutidas trocadas
 * por LINKS, aberta pela URL (`?data=`). Tudo aqui erra CALADO, e por isso tem
 * teste:
 *
 *   • **sobrar uma imagem embutida** — um campo de dado esquecido leva
 *     megabytes para a URL, e o preset simplesmente não abre;
 *   • **a arte de outra carta** — com a fonte da arte em `offline`, o ygocarder
 *     completa com a arte da última carta guardada no navegador, e o modelo
 *     abre com o monstro errado;
 *   • **a URL que estraga o texto** — o lado de lá lê com `URLSearchParams`,
 *     que troca `+` por espaço;
 *   • **o "já existe" do Storage** — a mesma imagem tem o mesmo nome (o hash);
 *     tratar o 409 como erro faria o segundo preset com o mesmo degradê nunca
 *     salvar;
 *   • **a chave fora da CHECK** — o banco recusaria toda gravação e a edição
 *     ficaria presa na fila de pendências, como aconteceu com `cena-*`.
 */
import {
  CHAVE, BUCKET, IMAGENS, LIMITE_URL,
  lerCartaDoCardmaker, imagensEmbutidas, montarPreset, temImagemEmbutida, urlDoPreset,
  normalizarPresets, comPreset, semPreset, bytesDaImagem, hashDosBytes, subirImagem,
} from './cardmakerpresets.js';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// O navegador tem `crypto.subtle` global; o Node 18 só o põe no global com
// flag (no `node -e` ele PARECE global — é o módulo `crypto` exposto pelo
// eval, e isso engana). O teste empresta o mesmo objeto que o Node expõe.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');

let pass = 0, fail = 0;
const fila = [];
const t = (nome, fn) => fila.push([nome, fn]);

// Um PNG de verdade (1x1) e um segundo diferente, para o hash ter o que separar.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

/** Uma carta no formato compacto que o ygocarder exporta ("Yugioh Carder"),
 *  com as três chaves que `checkCompactYgoCarderCard` exige e as imagens no
 *  estado da carta real do usuário: arte, fundo e degradê subidos do computador. */
function cartaExportada() {
  return {
    ve: '3', fr: 'ritual', fo: 'normal', na: 'FULL ARTT PRESET', ife: false, ta: ['Dragon', 'Ritual', 'Effect'], si: '',
    op: { opbl: true, opab: true, opnb: true, opeb: true, opfb: true, optx: 40 },
    ar: 'https://i.imgur.com/msWo4gh.png', ad: PNG, as: 'offline',
    hbg: true, bg: 'https://i.postimg.cc/SK4CtGfY/image.png', bgd: JPG, bgs: 'offline',
    ovg: '', ovgd: PNG2, ovgs: 'offline', ovt: 'border,source-in|frame,none',
    sivg: '', sivgd: '', sivgs: 'online',
    at: 'DARK', atg: '', atgd: '', ats: 'auto',
    ef: 'texto', atk: '4000', def: '0',
  };
}

// ------------------------------------------------------------------ leitura

t('le o formato "Yugioh Carder" (compacto)', () => {
  const r = lerCartaDoCardmaker(JSON.stringify(cartaExportada()));
  assert.equal(r.ok, true);
  assert.equal(r.carta.na, 'FULL ARTT PRESET');
});

// O outro formato do Export leva só arte e números. Aceitá-lo daria um preset
// que abre uma carta PADRÃO, sem erro nenhum — então a recusa diz o que fazer.
t('recusa o formato YGOPro/NeoCardMaker dizendo qual escolher', () => {
  const outro = { version: '1.0.0', name: 'X', layout: 'Ritual', image: PNG, atk: '4000' };
  const r = lerCartaDoCardmaker(JSON.stringify(outro));
  assert.equal(r.ok, false);
  assert.match(r.erro, /Yugioh Carder/);
});

t('recusa lixo sem lançar', () => {
  for (const torto of ['', 'nao e json', '[]', '123', 'null', '{"a":1}']) {
    const r = lerCartaDoCardmaker(torto);
    assert.equal(r.ok, false, torto);
    assert.ok(r.erro, torto);
  }
});

// ------------------------------------------------------------------ imagens

t('acha fundo e degradê embutidos; a arte fica de fora por padrão', () => {
  const nomes = imagensEmbutidas(cartaExportada()).map((x) => x.nome);
  assert.deepEqual(nomes, ['fundo', 'borda']);
});

t('com a arte pedida, ela entra', () => {
  const nomes = imagensEmbutidas(cartaExportada(), { comArte: true }).map((x) => x.nome);
  assert.deepEqual(nomes, ['arte', 'fundo', 'borda']);
});

// A carta exportada guarda link E dado; quem diz qual vale é a FONTE. Um dado
// velho com a fonte em `online` não é a imagem da carta.
t('dado com a fonte em online não é subido (o link é que vale)', () => {
  const c = cartaExportada();
  c.bgs = 'online';
  assert.deepEqual(imagensEmbutidas(c).map((x) => x.nome), ['borda']);
});

t('o que não é imagem não é subido', () => {
  const c = cartaExportada();
  c.ovgd = 'data:text/html;base64,PGgxPm9pPC9oMT4=';
  c.bgd = '';
  assert.deepEqual(imagensEmbutidas(c), []);
});

// ------------------------------------------------------------------ o preset

const LINKS = { fundo: 'https://x.supabase.co/storage/v1/object/public/cardmaker/a.jpg',
                borda: 'https://x.supabase.co/storage/v1/object/public/cardmaker/b.png' };

// O teste que vale: sem ele, um campo esquecido levaria megabytes para a URL.
// Par CONTROLE: a carta exportada TEM imagem embutida — senão "não sobrou nada"
// não provaria nada.
t('não sobra imagem embutida em lugar nenhum do preset', () => {
  const c = cartaExportada();
  assert.equal(temImagemEmbutida(c), true, 'controle: a carta exportada tem imagem embutida');
  assert.equal(temImagemEmbutida(montarPreset(c, LINKS)), false);
});

t('cada imagem subida vira link com a fonte online', () => {
  const p = montarPreset(cartaExportada(), LINKS);
  assert.equal(p.bg, LINKS.fundo);  assert.equal(p.bgs, 'online');
  assert.equal(p.ovg, LINKS.borda); assert.equal(p.ovgs, 'online');
  assert.equal(p.ovt, 'border,source-in|frame,none', 'o modo Replace da borda viaja junto');
  assert.deepEqual(p.op, cartaExportada().op, 'as opacidades da full art viajam junto');
});

// Com a fonte em offline, o ygocarder completa a arte com a da ÚLTIMA carta do
// navegador (`retrieveSavedCard`) — o modelo abriria com o monstro errado.
t('sem a arte: link vazio e fonte online (nunca offline)', () => {
  const p = montarPreset(cartaExportada(), LINKS);
  assert.equal(p.ar, '');
  assert.equal(p.ad, '');
  assert.equal(p.as, 'online');
});

t('com a arte: ela vira link como as outras', () => {
  const p = montarPreset(cartaExportada(), { ...LINKS, arte: 'https://x/arte.png' }, { comArte: true });
  assert.equal(p.ar, 'https://x/arte.png');
  assert.equal(p.as, 'online');
  assert.equal(p.ad, '');
});

t('não mexe na carta recebida', () => {
  const c = cartaExportada();
  const antes = JSON.stringify(c);
  montarPreset(c, LINKS);
  assert.equal(JSON.stringify(c), antes);
});

// ------------------------------------------------------------------ a URL

// O lado de lá lê com `URLSearchParams.get('data')`: `+` vira espaço. Um nome
// com "+", um degradê "#ff0000" ou um "&" no texto chegariam trocados.
t('a carta volta IGUAL lendo como o ygocarder lê', () => {
  const p = montarPreset(cartaExportada(), LINKS);
  p.na = 'A+B & C #1 100% "Dragão"';
  p.ef = 'linha 1\nlinha 2 + mais';
  const r = urlDoPreset('https://lauqerm.github.io/ygocarder/', p);
  assert.equal(r.ok, true, r.erro);
  const lido = new URLSearchParams(new URL(r.url).search).get('data');
  assert.deepEqual(JSON.parse(lido), p);
});

t('base que já tem query recebe "&"', () => {
  const r = urlDoPreset('https://x/?lang=pt', montarPreset(cartaExportada(), LINKS));
  assert.match(r.url, /\?lang=pt&data=/);
});

t('recusa o preset que ainda tem imagem embutida', () => {
  const r = urlDoPreset('https://x/', cartaExportada());
  assert.equal(r.ok, false);
  assert.match(r.erro, /embutida/);
});

t('recusa acima do teto que o próprio ygocarder usa', () => {
  const p = montarPreset(cartaExportada(), LINKS);
  p.ef = 'x'.repeat(LIMITE_URL);
  const r = urlDoPreset('https://x/', p);
  assert.equal(r.ok, false);
  assert.match(r.erro, /8192/);
});

// ------------------------------------------------------------------ a lista

t('salvar com o mesmo nome SUBSTITUI, no mesmo lugar e com o mesmo id', () => {
  const a = { id: '1', nome: 'Full Art', carta: { v: 1 } };
  const b = { id: '2', nome: 'Normal', carta: { v: 1 } };
  const lista = comPreset([a, b], { id: '9', nome: 'full art ', carta: { v: 2 } });
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, '1');
  assert.deepEqual(lista[0].carta, { v: 2 });
  assert.equal(lista[1].id, '2');
});

t('nome novo entra no fim', () => {
  const lista = comPreset([{ id: '1', nome: 'A', carta: {} }], { id: '2', nome: 'B', carta: {} });
  assert.deepEqual(lista.map((p) => p.id), ['1', '2']);
});

t('apagar tira só o escolhido', () => {
  const lista = [{ id: '1', nome: 'A', carta: {} }, { id: '2', nome: 'B', carta: {} }];
  assert.deepEqual(semPreset(lista, '1').map((p) => p.id), ['2']);
});

t('ler a lista tolera qualquer forma e descarta o torto', () => {
  for (const nada of [null, undefined, {}, { presets: null }, { presets: 'x' }, []]) {
    assert.deepEqual(normalizarPresets(nada), []);
  }
  const lido = normalizarPresets({ presets: [
    { id: '1', nome: 'ok', carta: {} },
    { id: '', nome: 'sem id', carta: {} },
    { id: '2', nome: '  ', carta: {} },
    { id: '3', nome: 'sem carta' },
    null,
  ] });
  assert.deepEqual(lido.map((p) => p.id), ['1']);
});

// ------------------------------------------------------------------ upload

t('a data URL vira bytes e tipo', () => {
  const b = bytesDaImagem(PNG);
  assert.equal(b.mime, 'image/png');
  assert.deepEqual([...b.bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(bytesDaImagem('data:text/html;base64,YQ=='), null);
  assert.equal(bytesDaImagem('nada'), null);
});

t('o nome é o hash do conteúdo: igual para igual, diferente para diferente', async () => {
  const h1 = await hashDosBytes(bytesDaImagem(PNG).bytes);
  const h1b = await hashDosBytes(bytesDaImagem(PNG).bytes);
  const h2 = await hashDosBytes(bytesDaImagem(PNG2).bytes);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h1b);
  assert.notEqual(h1, h2);
});

/** Um `fetch` de mentira que responde o que cada caso pede e guarda a chamada. */
function falsoFetch(status, corpo = '') {
  const chamadas = [];
  const f = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return { ok: status >= 200 && status < 300, status, text: async () => corpo };
  };
  f.chamadas = chamadas;
  return f;
}
const OPC = { supabaseUrl: 'https://proj.supabase.co', chave: 'pub', token: 'tok' };

t('sobe no bucket certo, com sessão, e devolve o link público', async () => {
  const f = falsoFetch(200, '{}');
  const r = await subirImagem(PNG, { ...OPC, fetch: f });
  assert.equal(r.ok, true);
  const hash = await hashDosBytes(bytesDaImagem(PNG).bytes);
  assert.equal(r.url, `https://proj.supabase.co/storage/v1/object/public/${BUCKET}/${hash}.png`);
  const [c] = f.chamadas;
  assert.equal(c.url, `https://proj.supabase.co/storage/v1/object/${BUCKET}/${hash}.png`);
  assert.equal(c.opcoes.method, 'POST');
  assert.equal(c.opcoes.headers.authorization, 'Bearer tok');
  assert.equal(c.opcoes.headers.apikey, 'pub');
  assert.equal(c.opcoes.headers['content-type'], 'image/png');
});

// A mesma imagem tem o mesmo nome. "Já existe" é SUCESSO — o link é o mesmo.
// Par CONTROLE: um 403 de verdade continua sendo erro.
t('"já existe" (409, ou 400 com Duplicate) é sucesso; 403 não', async () => {
  for (const [status, corpo] of [[409, ''], [400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}']]) {
    const r = await subirImagem(PNG, { ...OPC, fetch: falsoFetch(status, corpo) });
    assert.equal(r.ok, true, `${status} ${corpo}`);
    assert.match(r.url, /\/object\/public\/cardmaker\//);
  }
  const negado = await subirImagem(PNG, { ...OPC, fetch: falsoFetch(403, '{"message":"new row violates row-level security policy"}') });
  assert.equal(negado.ok, false);
  assert.match(negado.erro, /admin/);
});

t('sem o bucket, a mensagem aponta a migration', async () => {
  const r = await subirImagem(PNG, { ...OPC, fetch: falsoFetch(400, '{"error":"Bucket not found"}') });
  assert.equal(r.ok, false);
  assert.match(r.erro, /0061/);
});

t('sem sessão nem rede: erro, nunca exceção', async () => {
  const semToken = await subirImagem(PNG, { ...OPC, token: '', fetch: falsoFetch(200) });
  assert.equal(semToken.ok, false);
  const caiu = await subirImagem(PNG, { ...OPC, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(caiu.ok, false);
  assert.match(caiu.erro, /conexão/);
});

// ------------------------------------------------------------------ o par com o banco

// A chave tem de estar na lista branca do banco. Fora dela, toda gravação leva
// 400 e a edição fica presa na fila de pendências — foi o que aconteceu com
// `cena-*` (migration 0057). Lido da ÚLTIMA migration que redefine a CHECK.
t('a chave está na conteudo_chave_check mais recente', () => {
  const dir = join(RAIZ, 'supabase', 'migrations');
  const comCheck = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()
    .filter((n) => /add constraint conteudo_chave_check/i.test(readFileSync(join(dir, n), 'utf8')));
  assert.ok(comCheck.length, 'nenhuma migration define a conteudo_chave_check');
  const sql = readFileSync(join(dir, comCheck.at(-1)), 'utf8');
  assert.ok(sql.includes(`'${CHAVE}'`), `a chave '${CHAVE}' não está na CHECK de ${comCheck.at(-1)}`);
  assert.ok(sql.includes(`'${BUCKET}'`), `o bucket '${BUCKET}' não é criado em ${comCheck.at(-1)}`);
});

// A tela é quem junta as peças. Uma tela que não usasse `urlDoPreset` (montando
// a URL à mão) perderia a proteção do `+` e do teto em silêncio.
t('a tela usa o módulo para montar a URL e salvar na chave certa', () => {
  const html = readFileSync(join(RAIZ, 'web', 'cardmaker.html'), 'utf8');
  assert.match(html, /from '\/web\/js\/cardmakerpresets\.js'/);
  assert.match(html, /urlDoPreset\(/);
  assert.match(html, /montarPreset\(/);
  assert.match(html, /pushFileGuardado\(CHAVE/);
  assert.doesNotMatch(html, /\?data=/, 'a URL do preset é montada só pelo módulo');
});

t('as cinco imagens que o ygocarder embute estão mapeadas', () => {
  assert.deepEqual(IMAGENS.map((i) => i.dado), ['ad', 'bgd', 'ovgd', 'sivgd', 'atgd']);
});

// ------------------------------------------------------------------ roda

for (const [nome, fn] of fila) {
  try { await fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
}
console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
