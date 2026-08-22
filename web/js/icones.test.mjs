/**
 * Testes dos ICONES de perfil — `node web/js/icones.test.mjs`.
 *
 * A posse e a escolha sao decididas no SERVIDOR (`escolher_icone` mais o
 * gatilho `perfis_icone_valido`), entao nao ha' regra de jogo para provar
 * aqui. O que se prova e' o que erra CALADO no cliente:
 *
 *   • **o caminho da imagem.** Um nome de arquivo torto vira uma URL que o
 *     navegador busca, nao acha, e desenha como quadrado vazio — sem erro
 *     nenhum. Cair no padrao e' sempre melhor que apontar para o nada;
 *   • **o cruzamento catalogo x repositorio.** A imagem viaja no `game.zip` e o
 *     banco so' guarda o nome: um icone cadastrado cuja arte nao foi publicada
 *     e' invisivel para os dois lados. E' esta conta que o `icones:check` e o
 *     painel do admin usam para avisar antes;
 *   • **o slug.** Ele existe para o admin nao esbarrar no `check constraint` do
 *     Postgres, cuja mensagem nao diz o que fazer.
 */
import { caminhoDoIcone, mapaDeArquivos, slug, semImagem, PADRAO, PASTA } from './icones.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// --------------------------------------------------------- caminho da arte

t('a linha do catalogo vira o caminho do arquivo', () => {
  assert.equal(caminhoDoIcone({ id: 'ouro', arquivo: 'ouro.png' }), `${PASTA}/ouro.png`);
});

t('so o nome do arquivo tambem serve', () => {
  assert.equal(caminhoDoIcone('verso.png'), `${PASTA}/verso.png`);
});

// Sem icone escolhido é o caso NORMAL (todo jogador novo), nao um erro.
t('sem icone nenhum, o padrao do jogo', () => {
  for (const nada of [null, undefined, '', {}, { arquivo: null }, { arquivo: '' }]) {
    assert.equal(caminhoDoIcone(nada), PADRAO);
  }
});

// Um nome torto vira uma URL que o navegador busca, nao acha e desenha como
// quadrado vazio — sem erro nenhum. E `../` sairia da pasta.
t('nome de arquivo torto cai no padrao, nunca numa URL quebrada', () => {
  for (const torto of ['../../etc/passwd', 'a/b.png', 'com espaco.png', 'x'.repeat(65),
                       'aspas".png', '<script>.png']) {
    assert.equal(caminhoDoIcone(torto), PADRAO, `deveria recusar: ${torto}`);
  }
});

// -------------------------------------------------------------- o mapa

t('o mapa liga o id do amigo ao arquivo', () => {
  const m = mapaDeArquivos([{ id: 'ouro', arquivo: 'ouro.png' }, { id: 'azul', arquivo: 'azul.png' }]);
  assert.equal(m.get('ouro'), 'ouro.png');
  assert.equal(m.size, 2);
});

t('id sem arquivo (e lixo) nao entra no mapa', () => {
  const m = mapaDeArquivos([{ id: 'x' }, { arquivo: 'y.png' }, null, 'z', 42]);
  assert.equal(m.size, 0);
});

// O amigo que nunca escolheu tem `icone_id` null: o mapa nao acha, e o caminho
// cai no padrao. As duas metades juntas sao o que faz a lateral nunca quebrar.
t('amigo sem icone: o mapa nao acha e o caminho vira o padrao', () => {
  const m = mapaDeArquivos([{ id: 'ouro', arquivo: 'ouro.png' }]);
  assert.equal(caminhoDoIcone(m.get(null)), PADRAO);
  assert.equal(caminhoDoIcone(m.get('apagado')), PADRAO);
});

// ------------------------------------------------ catalogo x repositorio

t('acusa o icone cadastrado cuja imagem nao foi publicada', () => {
  const catalogo = [{ id: 'ouro', arquivo: 'ouro.png' }, { id: 'dragao', arquivo: 'dragao.png' }];
  const faltando = semImagem(catalogo, ['ouro.png', 'verso.png']);
  assert.equal(faltando.length, 1);
  assert.equal(faltando[0].id, 'dragao');
});

t('com tudo publicado, nao acusa nada', () => {
  const catalogo = [{ id: 'ouro', arquivo: 'ouro.png' }];
  assert.deepEqual(semImagem(catalogo, ['ouro.png', 'sobrando.png']), []);
});

// Arte no repositorio que ninguem cadastrou NAO e' problema: e' arte esperando
// virar icone. So' o contrario quebra a tela de quem joga.
t('arquivo no repo sem icone no catalogo nao e acusado', () => {
  assert.deepEqual(semImagem([], ['orfao.png']), []);
});

t('sem manifesto, TUDO e acusado (e nao o contrario)', () => {
  // Se a lista de arquivos nao chegou, o certo e' avisar de tudo em vez de
  // dizer "esta tudo bem" — um manifesto ausente nao prova imagem nenhuma.
  const catalogo = [{ id: 'ouro', arquivo: 'ouro.png' }];
  assert.equal(semImagem(catalogo, []).length, 1);
  assert.equal(semImagem(catalogo, null).length, 1);
});

t('lixo no catalogo nao derruba a conta', () => {
  assert.deepEqual(semImagem([null, {}, 'x', { id: 'sem-arquivo' }], ['a.png']), []);
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
