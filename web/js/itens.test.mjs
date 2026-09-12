/**
 * Testes do cadastro de ITENS — `node web/js/itens.test.mjs`.
 *
 * O que se prova aqui é o que erra CALADO no caminho entre a tela e o banco:
 * uma imagem que não é imagem vira um `src` que o navegador busca, não acha e
 * desenha como quadrado vazio; um id fora do formato é recusado pelo Postgres
 * com o nome de uma constraint em inglês; e um tipo `icone` gravado NESTA
 * tabela seria um cosmético que a tela de perfil nunca oferece — cadastrado,
 * pago, e inútil.
 *
 * A validação é a MESMA do banco de propósito. O banco continua sendo a
 * fechadura; isto é a porta, e é ela que fala português.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  prepararItem, slug, TIPOS, TIPO_ICONE, OPCOES_DE_TIPO, ROTULO_DO_TIPO, ehIcone,
} from './itens.js';

let n = 0;
const teste = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log('itens.js');

teste('os quatro tipos graváveis, e o ícone FORA deles', () => {
  assert.deepEqual(TIPOS, ['generico', 'sleeve', 'playmat', 'deckbox']);
  assert.equal(TIPO_ICONE, 'icone');
  assert.ok(!TIPOS.includes(TIPO_ICONE), 'o ícone não pode ser gravável nesta tabela');
  // Mas ele É uma opção da TELA — é o pedido: um seletor só, com o ícone dentro.
  assert.deepEqual(OPCOES_DE_TIPO, [...TIPOS, TIPO_ICONE]);
  assert.ok(ehIcone(TIPO_ICONE) && !ehIcone('sleeve'));
  for (const t of OPCOES_DE_TIPO) assert.ok(ROTULO_DO_TIPO[t], `${t} sem rótulo na tela`);
});

teste('o id sai do nome quando ninguém o escreve', () => {
  const r = prepararItem({ nome: 'Playmat do Labirinto', tipo: 'playmat' });
  assert.ok(r.ok, r.erro);
  assert.equal(r.item.id, 'playmat-do-labirinto');
});

teste('acento e maiúscula viram slug — o mesmo do ícone', () => {
  assert.equal(slug('Ícone Dourado'), 'icone-dourado');
});

teste('sem nome não grava: o nome é a única coisa que a tela não inventa', () => {
  assert.equal(prepararItem({ tipo: 'sleeve' }).ok, false);
  assert.equal(prepararItem({ nome: '   ' }).ok, false);
});

teste('tipo `icone` é RECUSADO nesta tabela', () => {
  // Ele é uma opção da tela, e a tela manda para o editor de ícones. Gravá-lo
  // aqui criaria um cosmético que a tela de perfil nunca vai oferecer.
  const r = prepararItem({ nome: 'x', tipo: 'icone' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /icone/);
});

teste('tipo desconhecido também', () => {
  assert.equal(prepararItem({ nome: 'x', tipo: 'nave' }).ok, false);
});

teste('preço torto vira 0, e nunca negativo', () => {
  assert.equal(prepararItem({ nome: 'a', preco: 'muito' }).item.preco, 0);
  assert.equal(prepararItem({ nome: 'a', preco: -50 }).item.preco, 0);
  assert.equal(prepararItem({ nome: 'a', preco: 12.9 }).item.preco, 12);
});

teste('`na_loja` é sempre booleano — o banco não aceita "sim"', () => {
  assert.equal(prepararItem({ nome: 'a', na_loja: 'sim' }).item.na_loja, true);
  assert.equal(prepararItem({ nome: 'a' }).item.na_loja, false);
});

teste('imagem que não é imagem não passa', () => {
  const r = prepararItem({ nome: 'a', imagem: 'https://exemplo/x.png' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /imagem/);
  // `data:text/html` é o caso perigoso: casa com "data:" e não é imagem.
  assert.equal(prepararItem({ nome: 'a', imagem: 'data:text/html,<b>x' }).ok, false);
});

teste('imagem grande demais é barrada ANTES de subir 512 KB à toa', () => {
  const gigante = 'data:image/png;base64,' + 'A'.repeat(512 * 1024);
  const r = prepararItem({ nome: 'a', imagem: gigante });
  assert.equal(r.ok, false);
  assert.match(r.erro, /grande demais/);
});

teste('SEM imagem nova, a chave nem vai — mandar null apagaria a arte', () => {
  // É a mesma regra do ícone, e ela existe porque o estrago é invisível até
  // alguém abrir a Loja: editar o preço apagaria a arte do item à venda.
  const r = prepararItem({ nome: 'a', preco: 10 });
  assert.ok(r.ok);
  assert.ok(!('imagem' in r.item), 'a chave `imagem` não pode ir quando não há arte nova');
});

// ------------------------------------------------ a tela usa mesmo o módulo
const aqui = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(aqui, '..', 'itens.html'), 'utf8');

teste('a tela de item NÃO tem uma segunda cópia do editor de ícones', () => {
  // O pedido era um seletor só; a resposta é delegar. Duas telas que gravam a
  // mesma coisa divergem na primeira mudança.
  assert.match(html, /icones\.html/);
  assert.ok(!/recorte\.js/.test(html),
    'a tela de itens importou o recorte circular — isso é o editor de ícones, e ele já existe');
});

teste('o menu da Área de Teste leva ao cadastro', () => {
  const teste_html = readFileSync(join(aqui, '..', 'teste.html'), 'utf8');
  assert.match(teste_html, /itens\.html/);
  assert.match(teste_html, /Criar item/i);
});

console.log(`\n${n} testes ok`);
