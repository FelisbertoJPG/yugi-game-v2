/**
 * Testes dos ICONES de perfil — `node web/js/icones.test.mjs`.
 *
 * A posse e a escolha sao decididas no SERVIDOR (`escolher_icone` mais o
 * gatilho `perfis_icone_valido`), entao nao ha' regra de jogo para provar
 * aqui. O que se prova e' o que erra CALADO no cliente:
 *
 *   • **o `src` da imagem.** A arte vem do banco como data URL. Um valor torto
 *     — vazio, texto, `data:text/html` — vira um `src` que o navegador busca,
 *     nao acha, e desenha como quadrado vazio. Sem erro nenhum;
 *   • **o cruzamento id → arte.** A lista de amigos recebe so' o `icone_id` (a
 *     policy de `perfis` nao deixaria mais), entao quem nao estiver no mapa
 *     precisa cair no padrao em vez de sumir;
 *   • **o slug.** Ele existe para o admin nao esbarrar no `check constraint` do
 *     Postgres, cuja mensagem nao diz o que fazer.
 */
import { caminhoDoIcone, mapaDeArquivos, slug, semImagem, PADRAO } from './icones.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// Um PNG minusculo de verdade (1x1 transparente), para nao inventar formato.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// --------------------------------------------------------- src da imagem

t('a linha do catalogo vira o src da arte', () => {
  assert.equal(caminhoDoIcone({ id: 'ouro', imagem: PNG }), PNG);
});

t('a data URL solta tambem serve', () => {
  assert.equal(caminhoDoIcone(PNG), PNG);
});

// Sem icone escolhido e' o caso NORMAL (todo jogador novo), nao um erro.
t('sem arte nenhuma, o padrao do jogo', () => {
  for (const nada of [null, undefined, '', {}, { imagem: null }, { imagem: '' }]) {
    assert.equal(caminhoDoIcone(nada), PADRAO);
  }
});

// O que nao e' imagem vira um `src` que o navegador busca e nao desenha —
// calado. Um `data:text/html` no meio disso seria pior que so' feio.
t('o que nao e imagem cai no padrao, nunca num src quebrado', () => {
  for (const torto of ['data:text/html;base64,YWJj', 'http://exemplo/x.png',
                       'javascript:alert(1)', 'data:image/png;base64,', 'nada disso',
                       'data:image/svg+xml;base64,YWJj']) {
    assert.equal(caminhoDoIcone(torto), PADRAO, `deveria recusar: ${torto}`);
  }
});

t('os formatos de imagem aceitos passam', () => {
  for (const tipo of ['png', 'jpeg', 'webp', 'gif']) {
    const url = `data:image/${tipo};base64,YWJjZA==`;
    assert.equal(caminhoDoIcone(url), url, tipo);
  }
});

// -------------------------------------------------------------- o mapa

t('o mapa liga o id do amigo a arte', () => {
  const m = mapaDeArquivos([{ id: 'ouro', imagem: PNG }, { id: 'azul', imagem: PNG }]);
  assert.equal(m.get('ouro'), PNG);
  assert.equal(m.size, 2);
});

t('id sem arte (e lixo) nao entra no mapa', () => {
  const m = mapaDeArquivos([{ id: 'x' }, { imagem: PNG }, null, 'z', 42]);
  assert.equal(m.size, 0);
});

// O amigo que nunca escolheu tem `icone_id` null: o mapa nao acha, e o src cai
// no padrao. As duas metades juntas sao o que faz a lateral nunca quebrar.
t('amigo sem icone: o mapa nao acha e o src vira o padrao', () => {
  const m = mapaDeArquivos([{ id: 'ouro', imagem: PNG }]);
  assert.equal(caminhoDoIcone(m.get(null)), PADRAO);
  assert.equal(caminhoDoIcone(m.get('apagado')), PADRAO);
});

// ------------------------------------------------ catalogo sem arte

t('acusa o icone cadastrado sem arte', () => {
  const faltando = semImagem([{ id: 'ouro', imagem: PNG }, { id: 'dragao', imagem: null }]);
  assert.equal(faltando.length, 1);
  assert.equal(faltando[0].id, 'dragao');
});

t('com todos com arte, nao acusa nada', () => {
  assert.deepEqual(semImagem([{ id: 'ouro', imagem: PNG }]), []);
});

// Uma arte que nao e' imagem e' o mesmo que nao ter arte: o navegador desenha
// nada nos dois casos.
t('arte que nao e imagem conta como sem arte', () => {
  assert.equal(semImagem([{ id: 'x', imagem: 'data:text/html;base64,YWJj' }]).length, 1);
});

t('catalogo vazio ou torto nao derruba a conta', () => {
  for (const nada of [[], null, undefined, 'x', 42]) {
    assert.deepEqual(semImagem(nada), []);
  }
  assert.equal(semImagem([null, 'x', 42]).length, 0);
});

// ---------------------------------------------------------------- o slug

t('o slug bate com o check da coluna', () => {
  const regra = /^[a-z0-9][a-z0-9-]{0,31}$/;
  for (const [entrada, esperado] of [
    ['Enigma Dourado', 'enigma-dourado'],
    ['Dragão Branco', 'dragao-branco'],
    ['  espaços  ', 'espacos'],
    ['UPPER', 'upper'],
    ['com_underline', 'com-underline'],
    ['pontuação!!! e (parênteses)', 'pontuacao-e-parenteses'],
  ]) {
    assert.equal(slug(entrada), esperado);
    assert.match(slug(entrada), regra, `${entrada} -> ${slug(entrada)} nao casa com o check`);
  }
});

t('o slug nunca passa de 32 e nunca termina em traco', () => {
  const s = slug('a'.repeat(40));
  assert.equal(s.length, 32);
  // O corte em 32 pode cair em cima de um traço — e aí o `check` recusaria.
  const cortado = slug(`${'ab '.repeat(11)}`);
  assert.ok(!cortado.endsWith('-'), `terminou em traco: ${cortado}`);
  assert.match(cortado, /^[a-z0-9][a-z0-9-]{0,31}$/);
});

t('entrada que nao vira slug nenhum devolve vazio, e nao lixo', () => {
  for (const nada of ['', '   ', '!!!', '---', null, undefined]) {
    assert.equal(slug(nada), '');
  }
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
