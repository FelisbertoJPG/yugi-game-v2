/**
 * Testes da aba ITENS GERAIS do inventário — `node web/js/inventarioitens.test.mjs`.
 *
 * A regra é pequena e erra de dois jeitos, os dois calados:
 *
 *   • **mostrar o que a pessoa NÃO tem.** As duas consultas devolvem o catálogo
 *     inteiro com um `tenho` (de propósito: a mesma consulta serve a uma
 *     vitrine), e o inventário é justamente a tela onde o que ela não tem não
 *     interessa. Sem o filtro, o jogador abre o inventário e vê o catálogo do
 *     jogo como se fosse dele;
 *   • **sumir com o que ela TEM.** Um tipo novo, cadastrado por um admin com o
 *     servidor mais novo, não pode desaparecer do inventário de quem ainda não
 *     atualizou — aparecer com o nome cru é ruim, sumir é pior.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { itensDoJogador, etiquetaDe, ETIQUETA } from './inventarioitens.js';

let n = 0;
const teste = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log('inventarioitens.js');

const icone = (o) => ({ id: 'i', nome: 'Kuriboh', imagem: 'data:image/png;base64,x', tenho: true, ...o });
const item = (o) => ({ id: 'x', tipo: 'sleeve', nome: 'Sleeve', imagem: null, tenho: true, ...o });

teste('só entra o que a pessoa TEM', () => {
  const r = itensDoJogador(
    [icone({ id: 'a', nome: 'Kuriboh', tenho: true }),
     icone({ id: 'b', nome: 'Não é meu', tenho: false })],
    [item({ id: 'c', nome: 'Minha sleeve', tenho: true }),
     item({ id: 'd', nome: 'Da loja', tenho: false })]);
  assert.deepEqual(r.map((x) => x.id), ['a', 'c']);
});

teste('o ícone GRATUITO conta como item — `meus_icones` já o marca', () => {
  const r = itensDoJogador([icone({ id: 'padrao', tenho: true })], []);
  assert.equal(r.length, 1);
});

teste('a etiqueta é o pedido: "Kuriboh (Ícone)", "… (sleeve)"', () => {
  assert.equal(etiquetaDe('icone'), 'Ícone');
  assert.equal(etiquetaDe('sleeve'), 'Sleeve');
  assert.equal(etiquetaDe('playmat'), 'Playmat');
  assert.equal(etiquetaDe('deckbox'), 'Deck Box');
  assert.equal(etiquetaDe('generico'), 'Item');
  for (const t of Object.keys(ETIQUETA)) assert.ok(ETIQUETA[t], `${t} sem etiqueta`);
});

teste('tipo DESCONHECIDO aparece com o nome cru — sumir seria pior', () => {
  // Um item cadastrado por um admin com o servidor mais novo.
  assert.equal(etiquetaDe('moldura'), 'moldura');
  const r = itensDoJogador([], [item({ tipo: 'moldura', nome: 'Moldura X' })]);
  assert.equal(r.length, 1, 'o item novo sumiu do inventário de quem não atualizou');
  assert.equal(r[0].tipo, 'moldura');
});

teste('o ícone vem primeiro; depois a ordem dos tipos, depois o nome', () => {
  const r = itensDoJogador(
    [icone({ id: 'ic', nome: 'Zebra' })],
    [item({ id: 'p', tipo: 'playmat', nome: 'Ataque de Magia Negra' }),
     item({ id: 's2', tipo: 'sleeve', nome: 'Zzz' }),
     item({ id: 's1', tipo: 'sleeve', nome: 'Inseto Devorador de Homens' })]);
  assert.deepEqual(r.map((x) => x.id), ['ic', 's1', 's2', 'p']);
});

teste('só o ÍCONE é redondo — quem desenha lê isso do TIPO', () => {
  const r = itensDoJogador([icone({ id: 'a' })], [item({ id: 'b', tipo: 'playmat' })]);
  assert.equal(r.find((x) => x.id === 'a').redonda, true);
  assert.equal(r.find((x) => x.id === 'b').redonda, false);
});

teste('lista torta não derruba a aba', () => {
  assert.deepEqual(itensDoJogador(null, undefined), []);
  assert.deepEqual(itensDoJogador([null, 0, 'x'], [null]), []);
});

teste('sem nome, cai no id — a grade não desenha um cartão em branco', () => {
  const r = itensDoJogador([], [item({ id: 'so-id', nome: undefined })]);
  assert.equal(r[0].nome, 'so-id');
});

// -------------------------------------------------- a tela usa mesmo o módulo
const aqui = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(aqui, '..', 'inventario.html'), 'utf8');
const js = readFileSync(join(aqui, 'inventario.js'), 'utf8');

teste('a terceira aba existe no HTML, com painel e contador', () => {
  assert.match(html, /id="tab-itens"/);
  assert.match(html, /id="pane-itens"/);
  assert.match(html, /id="grid-itens"/);
  assert.match(html, /id="n-itens"/);
});

teste('as abas deixaram de ser um booleano', () => {
  // Com duas, "não é cards" bastava; com três ele passa a significar duas
  // coisas. O teste trava a troca por comparação de nome.
  assert.match(js, /const ABAS = \['cards', 'decks', 'itens'\]/);
  assert.ok(!/aria-selected', String\(!cards\)/.test(js),
    'voltou a decidir a aba por booleano — com três, isso quebra em silêncio');
});

teste('o nome do item entra por textContent, nunca innerHTML', () => {
  // Ele vem do banco e é escrito por gente: é a mesma regra do chat.
  assert.match(js, /className: 'nome', textContent: it\.nome/);
});

console.log(`\n${n} testes ok`);
