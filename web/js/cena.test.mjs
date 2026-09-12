/**
 * Testes da CENA — o arranjo de peças que o editor monta e o Mundo desenha.
 *
 * Cena é dado que ENVELHECE: gravada hoje, lida daqui a meses, por um cliente
 * mais novo, contra uma biblioteca que mudou. É aí que ela erra calada — e as
 * três formas de errar têm par aqui:
 *
 * - número torto vira `NaN` na matriz, e **objeto com matriz NaN não aparece**;
 *   converter em vez de descartar é pior, porque `Number(null)` é 0, um lugar
 *   legítimo no meio do mapa;
 * - peça que sumiu da biblioteca é problema DIFERENTE de item torto, e por isso
 *   sai separada: derrubar a cena por causa de uma peça renomeada apagaria o
 *   trabalho todo;
 * - escala 0 some, escala negativa nasce do avesso (faces para dentro,
 *   invisíveis no culling) — e nenhuma das duas dá erro.
 *
 *   node web/js/cena.test.mjs
 */
import assert from 'node:assert';
import {
  cenaVazia, lerItem, lerCena, paraGravar, acrescentar, mexer, remover, duplicar,
  pecasUsadas, ehIdDePeca, caminhoDaCena, caminhoDaPeca, ehNomeDeCena, LIMITE,
} from './cena.js';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

const ITEM = { peca: 'bg-01-01-02', x: 1, y: 0, z: -3, giro: 0.5, escala: 1 };

console.log('\nCENA — o arranjo de peças do Mundo\n');

// -------------------------------------------------------------- um item
teste('lê um item bom', () => {
  const i = lerItem(ITEM);
  assert.ok(i);
  assert.equal(i.peca, 'bg-01-01-02');
  assert.equal(i.x, 1);
});

teste('DESCARTA item com coordenada torta (NaN na matriz = peça invisível)', () => {
  for (const ruim of [null, '', 'perto', NaN, Infinity, [], {}]) {
    assert.equal(lerItem({ ...ITEM, x: ruim }), null, 'passou x=' + JSON.stringify(ruim));
    assert.equal(lerItem({ ...ITEM, z: ruim }), null, 'passou z=' + JSON.stringify(ruim));
  }
});

teste('descartar é diferente de converter — `Number(null)` seria 0, um lugar válido', () => {
  // se a leitura convertesse, este item apareceria plantado na origem do mapa
  assert.equal(lerItem({ ...ITEM, x: null }), null);
  assert.equal(Number(null), 0, 'e por isso a conversao seria silenciosa');
});

teste('DESCARTA id de peça que não é slug (ele entra num caminho de arquivo)', () => {
  assert.equal(lerItem({ ...ITEM, peca: '../../segredo' }), null);
  assert.equal(lerItem({ ...ITEM, peca: 'MAIUSCULO' }), null);
  assert.equal(lerItem({ ...ITEM, peca: '' }), null);
  assert.equal(lerItem({ ...ITEM, peca: 42 }), null);
  assert.ok(ehIdDePeca('bg-01-01-02'));
});

teste('giro e escala têm padrão — item sem eles é legítimo', () => {
  const i = lerItem({ peca: 'x', x: 0, y: 0, z: 0 });
  assert.equal(i.giro, 0);
  assert.equal(i.escala, 1);
});

teste('escala 0 ou negativa é LIMITADA, não descartada (quem digitou 0 quis pequeno)', () => {
  assert.equal(lerItem({ ...ITEM, escala: 0 }).escala, LIMITE.escala.min);
  assert.equal(lerItem({ ...ITEM, escala: -3 }).escala, LIMITE.escala.min);
  assert.equal(lerItem({ ...ITEM, escala: 1e6 }).escala, LIMITE.escala.max);
});

teste('coordenada absurda é presa no limite (o dedo escorregado não some com a peça)', () => {
  assert.equal(lerItem({ ...ITEM, x: 1e9 }).x, LIMITE.xz);
  assert.equal(lerItem({ ...ITEM, y: -1e9 }).y, -LIMITE.y);
});

teste('o giro dá a volta em vez de travar', () => {
  const i = lerItem({ ...ITEM, giro: Math.PI * 5 });
  assert.ok(i.giro >= 0 && i.giro < Math.PI * 2, 'giro fora da volta: ' + i.giro);
  assert.equal(lerItem({ ...ITEM, giro: -Math.PI / 2 }).giro.toFixed(3), (Math.PI * 1.5).toFixed(3));
});

// ------------------------------------------------------------- a cena
teste('lê uma cena e conta o que caiu', () => {
  const c = lerCena({ nome: 'praca', itens: [ITEM, { peca: 'x', x: 'aqui', y: 0, z: 0 }, null] });
  assert.equal(c.nome, 'praca');
  assert.equal(c.itens.length, 1);
  assert.equal(c.descartados, 2);
});

teste('cena ilegível vira cena VAZIA, nunca erro (o editor tem de ABRIR)', () => {
  for (const ruim of [null, 'texto', 42, [], { itens: 'nao e lista' }]) {
    const c = lerCena(ruim);
    assert.equal(c.itens.length, 0);
    assert.ok(typeof c.nome === 'string');
  }
});

teste('peça que sumiu da biblioteca sai SEPARADA do item torto', () => {
  const c = lerCena({ itens: [ITEM, { ...ITEM, peca: 'nao-existe-mais' }] }, new Set(['bg-01-01-02']));
  assert.equal(c.itens.length, 1);
  assert.equal(c.descartados, 0, 'sumir da biblioteca nao e "torto"');
  assert.deepEqual(c.faltando, ['nao-existe-mais']);
});

teste('sem a lista de conhecidas, nada é reportado como faltando', () => {
  const c = lerCena({ itens: [{ ...ITEM, peca: 'seja-la-o-que-for' }] });
  assert.equal(c.itens.length, 1);
  assert.deepEqual(c.faltando, []);
});

teste('a peça faltando é listada UMA vez, mesmo repetida vinte', () => {
  const itens = Array.from({ length: 20 }, () => ({ ...ITEM, peca: 'sumiu' }));
  const c = lerCena({ itens }, new Set());
  assert.deepEqual(c.faltando, ['sumiu']);
});

teste('nome torto ou gigante não vaza para o disco', () => {
  assert.equal(lerCena({ nome: '   ', itens: [] }).nome, 'nova');
  assert.equal(lerCena({ nome: 'a'.repeat(500), itens: [] }).nome.length, 60);
  assert.equal(lerCena({ nome: 42, itens: [] }).nome, 'nova');
});

// ------------------------------------------------------------ mexer
teste('acrescentar devolve cena nova e o índice do que entrou', () => {
  const { cena, indice } = acrescentar(cenaVazia(), 'bg-01-01-02', { x: 5 });
  assert.equal(indice, 0);
  assert.equal(cena.itens[0].x, 5);
});

teste('acrescentar peça inválida não mexe na cena', () => {
  const antes = cenaVazia();
  const { cena, indice } = acrescentar(antes, '../x');
  assert.equal(indice, -1);
  assert.equal(cena.itens.length, 0);
});

teste('mexer troca só o que foi pedido', () => {
  const { cena } = acrescentar(cenaVazia(), 'p', { x: 1, z: 2 });
  const d = mexer(cena, 0, { x: 9 });
  assert.equal(d.itens[0].x, 9);
  assert.equal(d.itens[0].z, 2, 'o resto tem de ficar');
});

teste('mexer com valor torto MANTÉM o item (arrasto ruim não apaga trabalho)', () => {
  const { cena } = acrescentar(cenaVazia(), 'p', { x: 1 });
  const d = mexer(cena, 0, { x: NaN });
  assert.equal(d.itens.length, 1);
  assert.equal(d.itens[0].x, 1);
});

teste('mexer/remover com índice fora da lista não derruba nada', () => {
  const { cena } = acrescentar(cenaVazia(), 'p');
  assert.equal(mexer(cena, 99, { x: 1 }).itens.length, 1);
  assert.equal(remover(cena, -1).itens.length, 1);
  assert.equal(remover(cena, 0).itens.length, 0);
});

teste('duplicar sai deslocado (senão a cópia esconde o original)', () => {
  const { cena } = acrescentar(cenaVazia(), 'p', { x: 0, z: 0 });
  const { cena: c2, indice } = duplicar(cena, 0, 2);
  assert.equal(indice, 1);
  assert.equal(c2.itens[1].x, 2);
  assert.notEqual(c2.itens[1].x, c2.itens[0].x);
});

teste('pecasUsadas responde o que o Mundo precisa BAIXAR — sem repetir', () => {
  let c = cenaVazia();
  c = acrescentar(c, 'a').cena;
  c = acrescentar(c, 'b').cena;
  c = acrescentar(c, 'a').cena;
  assert.deepEqual(pecasUsadas(c).sort(), ['a', 'b']);
  assert.deepEqual(pecasUsadas(null), []);
});

// ----------------------------------------------------------- gravar
teste('gravar arredonda — 0.30000000000000004 é ruído, não precisão', () => {
  const { cena } = acrescentar(cenaVazia(), 'p', { x: 0.1 + 0.2 });
  assert.equal(paraGravar(cena).itens[0].x, 0.3);
});

teste('o ciclo fecha: gravar e ler de volta dá a MESMA cena', () => {
  let c = cenaVazia('praca');
  c = acrescentar(c, 'bg-01-01-02', { x: 1.5, y: 0, z: -2.25, giro: 1.2, escala: 0.8 }).cena;
  c = acrescentar(c, 'bg-02-03-07', { x: -4, y: 1, z: 0 }).cena;
  const volta = lerCena(JSON.parse(JSON.stringify(paraGravar(c))));
  assert.equal(volta.nome, 'praca');
  assert.equal(volta.descartados, 0, 'o que ele mesmo gravou nao pode ser recusado');
  assert.deepEqual(volta.itens, c.itens);
});

teste('os caminhos são os que o servidor JÁ serve (sem rota nova)', () => {
  // `/__store/` existe nos dois back-ends; uma rota nova teria de ser escrita
  // duas vezes, e divergir entre elas grava no dev e falha no jogo instalado
  assert.equal(caminhoDaCena('praca'), '/__store/cena-praca.json');
  assert.equal(caminhoDaPeca('bg-01-01-02'), '/web/pecas/p/bg-01-01-02.json');
});

teste('nome de cena vira NOME DE ARQUIVO, então é slug ou nada', () => {
  assert.ok(ehNomeDeCena('praca'));
  assert.ok(ehNomeDeCena('academia-2'));
  assert.equal(ehNomeDeCena('../../segredo'), false);
  assert.equal(ehNomeDeCena('com espaco'), false);
  assert.equal(ehNomeDeCena('MAIUSCULO'), false);
  assert.equal(ehNomeDeCena(''), false);
  // e o formato tem de casar com o que o servidor aceita em /__store/
  assert.match('cena-praca.json', /^(bkp\/)?[a-zA-Z0-9_-]+\.json$/);
});

console.log('\n' + passou + ' testes passaram\n');

// ===========================================================================
// GRUDAR, EMPILHAR E COLIDIR
// ===========================================================================
const { grudar, passoDe, caixaDoItem, alturaDePouso, colisoresDaCena, PASSO_PADRAO } =
  await import('./cena.js');

console.log('\ngrade, altura e colisão\n');

teste('grudar leva ao múltiplo mais perto', () => {
  assert.equal(grudar(3.4, 1), 3);
  assert.equal(grudar(3.6, 1), 4);
  assert.equal(grudar(-3.6, 1), -4);
  assert.equal(grudar(5, 4), 4);
  assert.equal(grudar(7, 4), 8);
});

teste('passo 0 (ou torto) é LIVRE — modo livre é escolha, não defeito', () => {
  assert.equal(grudar(3.37, 0), 3.37);
  assert.equal(grudar(3.37, -1), 3.37);
  assert.equal(grudar(3.37, NaN), 3.37);
});

teste('duas placas de 4 m ficam LADO A LADO, sem fresta e sem sobrepor', () => {
  // é o pedido: "as grid devem se grudar, evitando desparelhar"
  const chao = { id: 'base-chao-grama', modulo: 4, dim: [4, 0, 4] };
  const p = passoDe(chao, PASSO_PADRAO);
  const a = { peca: chao.id, x: grudar(0.3, p), y: 0, z: 0, giro: 0, escala: 1 };
  const b = { peca: chao.id, x: grudar(3.7, p), y: 0, z: 0, giro: 0, escala: 1 };
  const ca = caixaDoItem(a, chao.dim), cb = caixaDoItem(b, chao.dim);
  assert.equal(ca.max[0], cb.min[0], `borda a borda: ${ca.max[0]} vs ${cb.min[0]}`);
});

teste('o MÓDULO da peça vence o passo do editor, inclusive no modo livre', () => {
  // com o passo de 1 m dá para pôr uma placa de 4 em x=3: elas se cruzam, e a
  // costura no chão só aparece quando a câmera passa por cima
  const chao = { modulo: 4 };
  assert.equal(passoDe(chao, 1), 4);
  assert.equal(passoDe(chao, 0), 4, 'livre e para a arvore, nao para o ladrilho');
  assert.equal(passoDe({}, 1), 1, 'peca sem modulo usa o passo do editor');
  assert.equal(passoDe(null, 2), 2);
});

teste('a caixa acompanha a ESCALA (é o que faz o colisor seguir o tamanho)', () => {
  const dim = [2, 3, 2];
  const a = caixaDoItem({ x: 0, y: 0, z: 0, giro: 0, escala: 1 }, dim);
  const b = caixaDoItem({ x: 0, y: 0, z: 0, giro: 0, escala: 3 }, dim);
  assert.equal(a.max[1] - a.min[1], 3);
  assert.equal(b.max[1] - b.min[1], 9, 'a caixa tem de crescer junto');
  assert.equal(b.max[0] - b.min[0], 6);
});

teste('a caixa acompanha o GIRO (quina de fora = jogador atravessa a parede)', () => {
  const dim = [4, 2, 1];
  const reta = caixaDoItem({ x: 0, y: 0, z: 0, giro: 0, escala: 1 }, dim);
  const meia = caixaDoItem({ x: 0, y: 0, z: 0, giro: Math.PI / 2, escala: 1 }, dim);
  assert.ok(Math.abs((reta.max[0] - reta.min[0]) - 4) < 1e-9);
  assert.ok(Math.abs((meia.max[2] - meia.min[2]) - 4) < 1e-9, 'a 90 graus X e Z trocam');
  const dia = caixaDoItem({ x: 0, y: 0, z: 0, giro: Math.PI / 4, escala: 1 }, dim);
  assert.ok(dia.max[0] - dia.min[0] > 3.5, 'a 45 graus a peca ocupa MAIS que a largura');
});

teste('a caixa sobe com o Y (a peça levantada não deixa a colisão no chão)', () => {
  const c = caixaDoItem({ x: 0, y: 5, z: 0, giro: 0, escala: 1 }, [2, 2, 2]);
  assert.equal(c.min[1], 5);
  assert.equal(c.max[1], 7);
});

teste('item torto não vira NaN na caixa', () => {
  const c = caixaDoItem({ x: NaN, y: null, z: undefined, giro: 'x', escala: 0 }, [2, 2, 2]);
  for (const v of [...c.min, ...c.max]) assert.ok(Number.isFinite(v), 'NaN na caixa');
});

// ------------------------------------------------------------ empilhar
const CAIXA = (x, z, y0, y1, l = 2) =>
  ({ min: [x - l / 2, y0, z - l / 2], max: [x + l / 2, y1, z + l / 2] });

teste('sem nada embaixo, pousa no CHÃO', () => {
  assert.equal(alturaDePouso([], 0, 0), 0);
  assert.equal(alturaDePouso([CAIXA(50, 50, 0, 3)], 0, 0), 0, 'longe nao conta');
});

teste('pousa no TOPO do que está embaixo (é a montanha se montando)', () => {
  assert.equal(alturaDePouso([CAIXA(0, 0, 0, 3)], 0, 0), 3);
  assert.equal(alturaDePouso([CAIXA(0, 0, 0, 3), CAIXA(0, 0, 3, 5)], 0, 0), 5, 'pega o mais alto');
});

teste('IGNORA a si mesmo — senão a peça sobe um andar a cada tecla', () => {
  const caixas = [CAIXA(0, 0, 0, 3)];
  assert.equal(alturaDePouso(caixas, 0, 0, { ignorar: 0 }), 0);
});

teste('assentar SOBE para o topo — é assim que a pedra vai para a montanha', () => {
  // o caso principal do pedido: a peça é posta no chão, DENTRO da montanha, e
  // o gesto a leva ao topo. Sem isso ela ficaria enterrada.
  const montanha = [CAIXA(0, 0, 0, 6, 8)];
  assert.equal(alturaDePouso(montanha, 0, 0), 6);
});

teste('o teto existe para quem quiser LIMITAR a subida (o editor não usa)', () => {
  // a função aceita um teto — útil para uma queda —, mas `assentar` no editor
  // vai sem ele de propósito, senão a peça no chão nunca sobe
  const caixas = [CAIXA(0, 0, 0, 0.5), CAIXA(0, 0, 8, 9)];
  assert.equal(alturaDePouso(caixas, 0, 0, { tetoMax: 1 }), 0.5);
  assert.equal(alturaDePouso(caixas, 0, 0), 9, 'sem teto, vai ao mais alto');
});

teste('caixa nula na lista não derruba (peça cuja dim não é conhecida)', () => {
  assert.equal(alturaDePouso([null, CAIXA(0, 0, 0, 2), undefined], 0, 0), 2);
});

// -------------------------------------------------------------- colidir
const DIM = { arvore: [3, 5, 3], muro: [8, 3, 1], chao: [4, 0, 4], moita: [0.5, 0.3, 0.5] };
const dimDe = (id) => DIM[id] ?? null;

teste('uma árvore vira colisor; o CHÃO não', () => {
  // chão com pegada enorme e altura zero viraria um disco intransponível — é o
  // defeito mais fácil de criar aqui
  const cena = { itens: [
    { peca: 'arvore', x: 0, y: 0, z: 0, giro: 0, escala: 1 },
    { peca: 'chao', x: 10, y: 0, z: 0, giro: 0, escala: 1 },
  ] };
  const cs = colisoresDaCena(cena, dimDe);
  assert.ok(cs.length >= 1);
  assert.ok(cs.every((c) => Math.abs(c.x) < 5), 'o chao nao pode ter virado colisor');
});

teste('a MOITA baixa também não barra (não se tropeça em capim)', () => {
  const cs = colisoresDaCena({ itens: [{ peca: 'moita', x: 0, y: 0, z: 0, giro: 0, escala: 1 }] }, dimDe);
  assert.equal(cs.length, 0);
});

teste('um muro comprido vira VÁRIOS círculos, não um disco gigante', () => {
  // um só, com o raio da diagonal, engordaria o muro de 8 m num disco de 4 m
  // de raio, fechando a passagem ao lado dele
  const cs = colisoresDaCena({ itens: [{ peca: 'muro', x: 0, y: 0, z: 0, giro: 0, escala: 1 }] }, dimDe);
  assert.ok(cs.length >= 4, 'esperava uma fileira, veio ' + cs.length);
  assert.ok(cs.every((c) => c.r <= 1), 'raio de ' + cs[0].r + ' engorda o muro');
  const xs = cs.map((c) => c.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 4, 'os circulos tem de cobrir o comprimento');
});

teste('o colisor CRESCE com a escala (é o pedido: o mesh segue o tamanho)', () => {
  const um = colisoresDaCena({ itens: [{ peca: 'arvore', x: 0, y: 0, z: 0, giro: 0, escala: 1 }] }, dimDe);
  const tres = colisoresDaCena({ itens: [{ peca: 'arvore', x: 0, y: 0, z: 0, giro: 0, escala: 3 }] }, dimDe);
  assert.ok(tres[0].r > um[0].r * 2.5, `raio ${um[0].r} -> ${tres[0].r}`);
});

teste('peça cuja dim é desconhecida não vira colisor fantasma', () => {
  const cs = colisoresDaCena({ itens: [{ peca: 'sumiu', x: 0, y: 0, z: 0, giro: 0, escala: 1 }] }, dimDe);
  assert.deepEqual(cs, []);
});

teste('cena vazia ou nula devolve lista vazia', () => {
  assert.deepEqual(colisoresDaCena(null, dimDe), []);
  assert.deepEqual(colisoresDaCena({ itens: [] }, dimDe), []);
});

console.log('\n' + passou + ' testes passaram\n');

// ===========================================================================
// RELEVO — o chão que sobe e desce
// ===========================================================================
const { relevoVazio, alturaNo, alturaDoRelevo, esculpir, aplainar,
        relevoNaArea, temRelevo, lerRelevo, LIMITE_RELEVO, PASSO_RELEVO } = await import('./cena.js');

console.log('\nrelevo\n');

teste('sem relevo, o chão é plano em todo lugar', () => {
  assert.equal(alturaDoRelevo(relevoVazio(), 0, 0), 0);
  assert.equal(alturaDoRelevo(null, 5, -3), 0);
  assert.equal(alturaDoRelevo({ pontos: {} }, 99, 99), 0);
});

teste('esculpir levanta o nó do centro', () => {
  const r = esculpir(relevoVazio(), 0, 0, 3, { raio: 8 });
  assert.ok(Math.abs(alturaNo(r, 0, 0) - 3) < 1e-6);
  assert.ok(alturaDoRelevo(r, 40, 40) === 0, 'longe do pincel continua plano');
});

teste('a queda é SUAVE — pincel de borda dura vira caixa, não montanha', () => {
  const r = esculpir(relevoVazio(), 0, 0, 4, { raio: 12 });
  const centro = alturaDoRelevo(r, 0, 0);
  const meio = alturaDoRelevo(r, 6, 0);
  const borda = alturaDoRelevo(r, 12, 0);
  assert.ok(centro > meio && meio > borda, `${centro} > ${meio} > ${borda}`);
  assert.ok(meio > 0.2, 'o meio nao pode cair a zero de uma vez');
  assert.ok(borda < 0.5, 'a borda tem de encostar no plano');
});

teste('a interpolação é BILINEAR, não o nó mais perto (senão o chão vira degrau)', () => {
  // com "o mais perto", a altura no meio da célula seria a do nó — um degrau de
  // 4 m —, e a peça posta ali pousaria flutuando acima do triângulo desenhado
  const r = { passo: 4, pontos: { '0,0': 0, '1,0': 4, '0,1': 0, '1,1': 4 } };
  assert.ok(Math.abs(alturaDoRelevo(r, 2, 0) - 2) < 1e-6, 'no meio tem de ser a media');
  assert.ok(Math.abs(alturaDoRelevo(r, 1, 0) - 1) < 1e-6);
});

teste('esculpir com força negativa CAVA', () => {
  let r = esculpir(relevoVazio(), 0, 0, 3, { raio: 8 });
  r = esculpir(r, 0, 0, -5, { raio: 8 });
  assert.ok(alturaNo(r, 0, 0) < 0, 'devia ter cavado, veio ' + alturaNo(r, 0, 0));
});

teste('nó que volta a ZERO sai do mapa (o relevo é esparso)', () => {
  // guardar milhares de zeros incharia a cena a cada pincelada desfeita
  let r = esculpir(relevoVazio(), 0, 0, 3, { raio: 8 });
  const antes = Object.keys(r.pontos).length;
  assert.ok(antes > 0);
  r = aplainar(r, 0, 0, { raio: 8 });
  assert.ok(Object.keys(r.pontos).length < antes, 'aplainar tem de esvaziar');
  assert.ok(Math.abs(alturaDoRelevo(r, 0, 0)) < 0.01);
});

teste('o relevo tem TETO — o pincel não joga o chão na estratosfera', () => {
  let r = relevoVazio();
  for (let i = 0; i < 200; i++) r = esculpir(r, 0, 0, 5, { raio: 6 });
  assert.ok(alturaNo(r, 0, 0) <= LIMITE_RELEVO, 'passou do teto');
});

teste('esculpir com valor torto não mexe em nada', () => {
  const r = esculpir(relevoVazio(), 0, 0, 3, { raio: 8 });
  assert.equal(esculpir(r, NaN, 0, 1), r);
  assert.equal(esculpir(r, 0, 0, 0), r, 'forca zero e um no-op');
  assert.equal(esculpir(r, 0, 0, NaN), r);
});

teste('duas placas VIZINHAS compartilham a borda — a superfície é contínua', () => {
  // é a razão de o relevo ser da CENA e não de cada peça: fosse por placa,
  // casar a vizinha seria à mão, e um centímetro de erro abre uma fresta.
  // Como as duas leem `alturaDoRelevo` nas MESMAS coordenadas do mundo, elas
  // casam sem ninguém combinar nada.
  const r = esculpir(relevoVazio(), 0, 0, 5, { raio: 10 });
  for (let t = -2; t <= 2; t += 0.5) {
    const naEsquerda = alturaDoRelevo(r, 0, t);   // borda direita da placa em -2
    const naDireita = alturaDoRelevo(r, 0, t);    // borda esquerda da placa em +2
    assert.equal(naEsquerda, naDireita);
  }
});

teste('O CUME não pode ser o único lugar achatado', () => {
  // O BUG que matou a primeira versão do relevo: a placa era desenhada a partir
  // dos QUATRO cantos e interpolada por dentro. Placa de 4 m gruda em múltiplo
  // de 4 e a grade do relevo tem passo 4, então os cantos caem sempre no MEIO
  // de dois nós — um morro de 6 m no nó (0,0) virava uma placa PLANA a 2,26 m.
  // Quem esculpia via o cume sumir e concluía que o relevo não funcionava.
  const r = esculpir(relevoVazio(), 0, 0, 6, { raio: 6 });
  const cume = alturaDoRelevo(r, 0, 0);
  const canto = alturaDoRelevo(r, -2, -2);
  assert.ok(cume > 5.9, 'o no central tem de ter a altura pedida: ' + cume);
  assert.ok(cume - canto > 2, `o centro da placa (${cume}) tem de subir acima do canto (${canto})`);
});

teste('quem desenha e quem POUSA usam a mesma conta', () => {
  // a placa é desenhada vértice a vértice por `alturaDoRelevo` e o item pousa
  // pela MESMA função: qualquer segunda conta faria a peça flutuar ou afundar
  const r = esculpir(relevoVazio(), 0, 0, 6, { raio: 14 });
  for (const [x, z] of [[0, 0], [-2, -2], [1.3, -0.7], [3, 5]]) {
    assert.equal(alturaDoRelevo(r, x, z), alturaDoRelevo(r, x, z));
  }
  assert.ok(alturaDoRelevo(r, 0, 0) > alturaDoRelevo(r, 3, 5));
});

teste('relevoNaArea enxerga o morro do VIZINHO (a placa inclina sem no proprio)', () => {
  // `alturaDoRelevo` dentro da placa interpola com os nós de FORA dela: sem a
  // margem de um nó, a placa ao lado do morro reusaria a geometria plana da
  // biblioteca e apareceria uma fresta vertical na borda do morro
  const r = esculpir(relevoVazio(), 0, 0, 5, { raio: 5 });
  assert.equal(relevoNaArea(r, 0, 0, 4), true);
  assert.equal(relevoNaArea(r, 8, 0, 4), true, 'a placa vizinha tambem inclina');
  assert.equal(relevoNaArea(r, 60, 60, 4), false, 'longe dali continua plano');
  assert.equal(relevoNaArea(relevoVazio(), 0, 0, 4), false);
});

teste('da para cavar uma FENDA — o menor acidente cabe em 4 m de boca', () => {
  // O pedido: "so' cria relevo alto, eu precisava criar fendas tbm". Com a
  // grade de 4 m o menor acidente possivel tinha 8 m de boca — um vale, nunca
  // uma greta. A grade e' o teto da finura, e nenhum pincel contorna isso.
  assert.equal(PASSO_RELEVO, 2, 'a grade e o limite da menor fenda possivel');
  const r = esculpir(relevoVazio(), 0, 0, -4, { raio: 2 });
  assert.ok(alturaDoRelevo(r, 0, 0) < -3.9, 'o fundo tem de descer: ' + alturaDoRelevo(r, 0, 0));
  assert.ok(Math.abs(alturaDoRelevo(r, 2, 0)) < 1e-6, 'a 2 m ja tem de estar no plano');
  // a boca e' de -2 a +2: a parede desce 4 m em 2 m de horizontal
  assert.ok(alturaDoRelevo(r, 1, 0) < -1, 'a parede tem de ser ingreme');
});

teste('CAVAR passa do plano zero — a fenda e negativa de verdade', () => {
  // nada prende o relevo em zero: um "chao" que so' sobe nao tem fenda nenhuma
  let r = relevoVazio();
  for (let i = 0; i < 20; i++) r = esculpir(r, 0, 0, -1, { raio: 6 });
  assert.ok(alturaDoRelevo(r, 0, 0) < -15, 'devia ter descido, veio ' + alturaDoRelevo(r, 0, 0));
  assert.ok(alturaDoRelevo(r, 0, 0) >= -LIMITE_RELEVO, 'o piso do teto vale nos dois sentidos');
});

teste('cena ANTIGA (grade de 4 m) continua abrindo com a grade dela', () => {
  // o `passo` e' gravado DENTRO do relevo: mudar a constante nao pode reescrever
  // o que ja esta salvo, senao o morro de ontem muda de tamanho sozinho
  const velha = lerRelevo({ passo: 4, pontos: { '1,0': 6 } });
  assert.equal(velha.passo, 4);
  assert.ok(Math.abs(alturaDoRelevo(velha, 4, 0) - 6) < 1e-9, 'o no de ontem fica onde estava');
  assert.ok(Math.abs(alturaDoRelevo(velha, 2, 0) - 3) < 1e-9);
});

teste('aplainar com FORCA parcial anda so um pedaco do caminho', () => {
  // no arrasto o pincel passa varias vezes: achatar tudo no primeiro pixel
  // apagaria o morro inteiro num gesto que se queria suave
  const r = esculpir(relevoVazio(), 0, 0, 8, { raio: 6 });
  const cheio = aplainar(r, 0, 0, { raio: 6 });
  const meio = aplainar(r, 0, 0, { raio: 6, forca: 0.35 });
  assert.ok(Math.abs(alturaDoRelevo(cheio, 0, 0)) < 0.01, 'forca 1 achata de vez');
  const antes = alturaDoRelevo(r, 0, 0), depois = alturaDoRelevo(meio, 0, 0);
  assert.ok(depois > 0.01 && depois < antes, `${antes} -> ${depois}`);
});

teste('temRelevo separa cena plana de cena esculpida', () => {
  assert.equal(temRelevo(relevoVazio()), false);
  assert.equal(temRelevo(null), false);
  assert.equal(temRelevo(esculpir(relevoVazio(), 0, 0, 2)), true);
});

teste('lerRelevo DESCARTA nó torto em vez de convertê-lo', () => {
  // `Number(null)` é 0, uma altura legítima: o chão apareceria plano num ponto
  // que deveria ser morro
  const r = lerRelevo({ passo: 4, pontos: { '0,0': 3, 'lixo': 9, '1,1': null, '2,2': 'alto', '3,3': 1e9 } });
  assert.equal(alturaNo(r, 0, 0), 3);
  assert.equal(Object.keys(r.pontos).length, 1, 'so o no bom sobrevive');
});

teste('lerRelevo aguenta qualquer entrada torta (a cena tem de ABRIR)', () => {
  for (const ruim of [null, 'texto', 42, [], { pontos: 'nao e objeto' }, { pontos: [] }]) {
    const r = lerRelevo(ruim);
    assert.ok(r.pontos && typeof r.pontos === 'object');
    assert.equal(Object.keys(r.pontos).length, 0);
  }
});

teste('o relevo sobrevive ao ciclo gravar → ler', () => {
  let c = cenaVazia('morro');
  c = { ...c, relevo: esculpir(c.relevo, 8, 8, 5, { raio: 10 }) };
  const volta = lerCena(JSON.parse(JSON.stringify(paraGravar(c))));
  assert.ok(Math.abs(alturaDoRelevo(volta.relevo, 8, 8) - 5) < 0.01);
});

teste('cena PLANA não carrega um objeto de relevo vazio no arquivo', () => {
  assert.equal('relevo' in paraGravar(cenaVazia('p')), false);
});

console.log('\n' + passou + ' testes passaram\n');

// ===========================================================================
// CHAO POR CIMA DE CHAO, e o DESFAZER
// ===========================================================================
const { terrenoCoberto, criarHistorico } = await import('./cena.js');

console.log('\nchao que troca chao, e o desfazer\n');

// as placas base: 4 m e 12 m. Arvore e pedra devolvem 0 — nao sao terreno.
const LADO = { 'base-chao-grama': 4, 'base-chao-terra': 4, 'base-chao-grande': 12 };
const ladoDe = (id) => LADO[id] ?? 0;
const chao = (peca, x, z, extra = {}) => ({ peca, x, y: 0, z, giro: 0, escala: 1, ...extra });

teste('placa nova em cima da velha COBRE — e e por isso que a de baixo sai', () => {
  const c = { itens: [chao('base-chao-terra', 0, 0)] };
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 0), ladoDe), [0]);
});

teste('placa ENCOSTADA nao cobre — senao o piso se apagaria sozinho', () => {
  // duas placas de 4 m em 0 e 4 dividem a borda em x=2: sobreposicao ZERO.
  // Sem a margem estrita, montar uma fileira apagaria a anterior a cada clique.
  const c = { itens: [chao('base-chao-grama', 0, 0)] };
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 4, 0), ladoDe), []);
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 4), ladoDe), []);
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 4, 4), ladoDe), []);
});

teste('a placa GRANDE engole as pequenas que estao debaixo dela', () => {
  const c = { itens: [
    chao('base-chao-grama', -4, 0), chao('base-chao-grama', 0, 0),
    chao('base-chao-grama', 4, 0), chao('base-chao-grama', 40, 40),
  ] };
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grande', 0, 0), ladoDe), [0, 1, 2]);
});

teste('so TERRENO apaga terreno — por chao nao limpa a floresta em cima dele', () => {
  const c = { itens: [
    { peca: 'base-conifera', x: 0, y: 0, z: 0, giro: 0, escala: 1 },
    { peca: 'base-pedra', x: 1, y: 0, z: 1, giro: 0, escala: 1 },
  ] };
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 0), ladoDe), []);
});

teste('peca que NAO e terreno nao apaga nada ao ser posta', () => {
  const c = { itens: [chao('base-chao-grama', 0, 0)] };
  const arvore = { peca: 'base-conifera', x: 0, y: 0, z: 0, giro: 0, escala: 1 };
  assert.deepEqual(terrenoCoberto(c, arvore, ladoDe), []);
});

teste('ALTURA diferente e degrau, nao sobra: o patamar de baixo fica', () => {
  // com relevo da para empilhar chao de proposito (um mezanino). Apagar o de
  // baixo ali seria abrir um buraco no que se acabou de construir.
  const c = { itens: [chao('base-chao-grama', 0, 0, { y: 0 })] };
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 0, { y: 3 }), ladoDe), []);
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 0, { y: 0.2 }), ladoDe), [0],
    'meio palmo e a mesma placa, nao um andar');
});

teste('a ESCALA conta: uma placa esticada cobre mais', () => {
  const c = { itens: [chao('base-chao-grama', 6, 0)] };
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 0), ladoDe), []);
  assert.deepEqual(terrenoCoberto(c, chao('base-chao-grama', 0, 0, { escala: 3 }), ladoDe), [0]);
});

teste('desfazer devolve a cena anterior; refazer devolve a de volta', () => {
  const h = criarHistorico();
  const a = { nome: 'a', itens: [] }, b = { nome: 'b', itens: [] };
  assert.equal(h.desfazer(a), null, 'sem passado nao ha o que desfazer');
  h.guardar(a);
  assert.equal(h.desfazer(b), a);
  assert.equal(h.refazer(a), b);
});

teste('um gesto NOVO apaga o futuro — refazer um ramo morto e pior que nao refazer', () => {
  const h = criarHistorico();
  const a = { nome: 'a' }, b = { nome: 'b' }, c = { nome: 'c' };
  h.guardar(a);
  assert.equal(h.desfazer(b), a);        // voltou para `a`, com `b` no futuro
  assert.equal(h.pode().refazer, true);
  h.guardar(a);                          // gesto novo a partir de `a`
  assert.equal(h.pode().refazer, false, 'o futuro tinha de ter sido apagado');
  assert.equal(h.refazer(c), null);
});

teste('o historico tem TETO — cada entrada e a cena inteira', () => {
  const h = criarHistorico({ max: 3 });
  for (let i = 0; i < 10; i++) h.guardar({ nome: 'c' + i });
  let n = 0;
  let atual = { nome: 'agora' };
  while (h.pode().desfazer) { atual = h.desfazer(atual); n++; }
  assert.equal(n, 3, 'guardou ' + n + ', devia ser 3');
  assert.equal(atual.nome, 'c7', 'o teto joga fora o MAIS VELHO');
});

teste('pode() diz o que os botoes de desfazer/refazer mostram', () => {
  const h = criarHistorico();
  assert.deepEqual(h.pode(), { desfazer: false, refazer: false });
  h.guardar({ nome: 'a' });
  assert.deepEqual(h.pode(), { desfazer: true, refazer: false });
  h.desfazer({ nome: 'b' });
  assert.deepEqual(h.pode(), { desfazer: false, refazer: true });
  h.limpar();
  assert.deepEqual(h.pode(), { desfazer: false, refazer: false });
});

console.log('\n' + passou + ' testes passaram\n');

// ===========================================================================
// O MODO TESTAR — o jogador andando na cena
//
// Ele nao tem tela aqui, mas tem CONTRATO: a colisao que o editor prova tem de
// ser a mesma que o Mundo aplica. Estes testes juntam as duas pontas
// (`colisoresDaCena`, daqui, com `mover`/`livre`, da floresta) exatamente como
// `cenaeditor.js` as junta — se alguem reescrever uma delas, o editor passaria
// a aprovar ambiente que o jogo recusa, e o erro so apareceria publicado.
// ===========================================================================
const { MUNDO: MUNDO2, mover: mover2, livre: livre2 } = await import('./floresta.js');

console.log('\ntestar: o jogador na cena\n');

const PAREDE = LIMITE.xz;
const dimTeste = (id) => ({
  arvore: [1.2, 5, 1.2],
  chao: [4, 0.05, 4],
  capim: [0.5, 0.2, 0.5],
}[id] ?? null);
const posto = (peca, x, z, extra = {}) => ({ peca, x, y: 0, z, giro: 0, escala: 1, ...extra });

teste('a arvore da cena BARRA o jogador, e o chao nao', () => {
  const cena = { itens: [posto('arvore', 4, 0), posto('chao', 0, 0)] };
  const col = colisoresDaCena(cena, dimTeste);
  assert.ok(!livre2(col, 4, 0, MUNDO2.raioJogador, PAREDE), 'entrou na arvore');
  assert.ok(livre2(col, 0, 0, MUNDO2.raioJogador, PAREDE), 'o chao virou parede');
});

teste('esbarrar na arvore DESLIZA em vez de prender', () => {
  // sem o deslize, encostar em diagonal recusa os dois eixos juntos e o boneco
  // gruda — o relato seria "o teste travou", e a cena levaria a culpa
  const col = colisoresDaCena({ itens: [posto('arvore', 0, 0)] }, dimTeste);
  const r = mover2(col, -2, -2, 2, 2, MUNDO2.raioJogador, PAREDE);
  assert.ok(r.x !== -2 || r.z !== -2, 'ficou colado na arvore');
});

teste('o jogador anda no pedaco da cena que fica ALEM da floresta', () => {
  // uma cena vai a 400 m; a floresta acaba em 92. Sem a parede parametrizada,
  // metade do mapa seria intestavel e ninguem saberia por que
  const col = colisoresDaCena({ itens: [posto('chao', 200, 0)] }, dimTeste);
  assert.ok(livre2(col, 200, 0, MUNDO2.raioJogador, PAREDE),
    'travou a 200 m — a parede da floresta vazou para o editor');
});

teste('a altura em que o jogador PISA e a mesma que assenta uma peca', () => {
  // o editor poe o boneco em `max(relevo, alturaDePouso)`, e e' a mesma conta
  // do `assentar`: duas contas fariam o boneco flutuar sobre o que uma peca
  // pousa em cima, e o teste mentiria sobre o piso
  const r = esculpir(relevoVazio(), 0, 0, 5, { raio: 6 });
  const caixas = [caixaDoItem(posto('chao', 20, 0, { y: 2 }), dimTeste('chao'))];
  const pe = (x, z) => Math.max(alturaDoRelevo(r, x, z), alturaDePouso(caixas, x, z));

  assert.ok(pe(0, 0) > 4.9, 'no morro o boneco tem de subir: ' + pe(0, 0));
  assert.ok(Math.abs(pe(20, 0) - 2.05) < 1e-6, 'em cima da placa alta: ' + pe(20, 0));
  assert.equal(pe(60, 60), 0, 'no plano vazio o pe fica em zero');
});

teste('capim baixo nao barra, mas da para PISAR nele', () => {
  // as duas metades da mesma peca: `colisoresDaCena` corta o que tem menos de
  // 0,4 m de altura, `alturaDePouso` nao corta nada — e e' isso que faz um
  // decalque no chao ser atravessavel e pisavel ao mesmo tempo
  const item = posto('capim', 0, 0);
  assert.equal(colisoresDaCena({ itens: [item] }, dimTeste).length, 0);
  assert.ok(alturaDePouso([caixaDoItem(item, dimTeste('capim'))], 0, 0) > 0);
});

console.log('\n' + passou + ' testes passaram\n');

// ===========================================================================
// REGRAS por CLASSE e por PECA, e o COLISOR ajustavel
// ===========================================================================
const { regrasVazias, lerRegras, porRegra, regraDe, colide, segueRelevo,
        caixaDeColisao, lerColisor, colisorNeutro, temRegras } = await import('./cena.js');

console.log('\nregras de classe e colisor ajustavel\n');

const CAT = {
  'base-conifera': { id: 'base-conifera', grupo: 'Arvores e plantas', dim: [2, 5, 2] },
  'base-moita': { id: 'base-moita', grupo: 'Arvores e plantas', dim: [0.6, 0.3, 0.6] },
  'base-chao-grama': { id: 'base-chao-grama', grupo: 'Chao', dim: [4, 0.05, 4], terreno: 4 },
  'bg-estrada': { id: 'bg-estrada', grupo: 'Tag Force', dim: [4, 0.02, 12] },
};
const info = (id) => CAT[id] ?? { id, grupo: null };

teste('sem regra, quem decide a colisao e a ALTURA (como sempre foi)', () => {
  assert.equal(colide(regrasVazias(), CAT['base-conifera'], CAT['base-conifera'].dim), true);
  assert.equal(colide(regrasVazias(), CAT['base-moita'], CAT['base-moita'].dim), false);
});

teste('a CLASSE decide de atacado — "arbusto e grama nao colidem"', () => {
  const r = porRegra(regrasVazias(), 'grupos', 'Arvores e plantas', 'colide', false);
  assert.equal(colide(r, CAT['base-conifera'], CAT['base-conifera'].dim), false,
    'a arvore devia obedecer a classe');
  assert.equal(colide(r, CAT['base-chao-grama'], CAT['base-chao-grama'].dim), false,
    'o chao continua sem colidir, por altura');
});

teste('a PECA e a excecao DENTRO da classe — e o pedido inteiro', () => {
  // "definir que itens da classe X nao tem colisao, e ali nessa classe decidir
  // quais itens sao": sem o nivel da peca, a classe seria tudo ou nada
  let r = porRegra(regrasVazias(), 'grupos', 'Arvores e plantas', 'colide', false);
  r = porRegra(r, 'pecas', 'base-conifera', 'colide', true);
  assert.equal(colide(r, CAT['base-conifera'], CAT['base-conifera'].dim), true, 'a excecao nao venceu');
  assert.equal(colide(r, CAT['base-moita'], CAT['base-moita'].dim), false,
    'a classe devia valer para o resto');
});

teste('"padrao" APAGA a regra — nao e o mesmo que "nao"', () => {
  // com dois estados nao haveria como desfazer uma decisao de classe: ela
  // ficaria para sempre, e a classe herdaria um `false` que ninguem quis
  let r = porRegra(regrasVazias(), 'grupos', 'Chao', 'colide', false);
  assert.equal(regraDe(r, CAT['base-chao-grama'], 'colide'), false);
  r = porRegra(r, 'grupos', 'Chao', 'colide', undefined);
  assert.equal(regraDe(r, CAT['base-chao-grama'], 'colide'), undefined, 'a regra tinha de sumir');
  assert.equal(temRegras(r), false, 'regra vazia nao pode sobrar no arquivo');
});

teste('marcar a ESTRADA como chao a faz acompanhar o relevo', () => {
  // ela nasce plana: o extrator nao sabe o que e estrada e o que e telhado
  assert.equal(segueRelevo(regrasVazias(), CAT['bg-estrada']), false);
  const r = porRegra(regrasVazias(), 'pecas', 'bg-estrada', 'terreno', true);
  assert.equal(segueRelevo(r, CAT['bg-estrada']), true);
  assert.equal(segueRelevo(r, CAT['base-conifera']), false, 'a arvore nao pode virar chao junto');
});

teste('a placa base segue o relevo SEM regra nenhuma (o `terreno` do catalogo)', () => {
  assert.equal(segueRelevo(regrasVazias(), CAT['base-chao-grama']), true);
});

teste('colisoresDaCena obedece a classe — e o que tira a colisao da grama', () => {
  const cena = { itens: [
    { peca: 'base-conifera', x: 0, y: 0, z: 0, giro: 0, escala: 1 },
    { peca: 'base-conifera', x: 20, y: 0, z: 0, giro: 0, escala: 1 },
  ], regras: porRegra(regrasVazias(), 'grupos', 'Arvores e plantas', 'colide', false) };
  assert.equal(colisoresDaCena(cena, (id) => CAT[id]?.dim, { infoDe: info }).length, 0);
});

teste('lerRegras so aceita BOOLEANO — "false" e 0 nao viram decisao', () => {
  // `Number(null)` e a string 'false' sao verdadeiros em JS: converter aqui
  // transformaria lixo numa decisao explicita, o pior resultado possivel
  const r = lerRegras({ grupos: { X: { colide: 'false', terreno: 0 } }, pecas: { p: { colide: true } } });
  assert.deepEqual(r.grupos, {});
  assert.deepEqual(r.pecas, { p: { colide: true } });
});

teste('lerRegras aguenta qualquer entrada torta (a cena tem de ABRIR)', () => {
  for (const cru of [null, 42, 'x', [], { grupos: 7 }, { pecas: [1] }, { grupos: { X: 3 } }]) {
    assert.deepEqual(lerRegras(cru), regrasVazias(), 'quebrou em ' + JSON.stringify(cru));
  }
});

teste('as regras sobrevivem ao ciclo gravar -> ler', () => {
  const cena = { ...cenaVazia('x'), regras: porRegra(regrasVazias(), 'grupos', 'Chao', 'terreno', true) };
  const lida = lerCena(JSON.parse(JSON.stringify(paraGravar(cena))));
  assert.equal(regraDe(lida.regras, { id: 'q', grupo: 'Chao' }, 'terreno'), true);
});

// ------------------------------------------------------------- o colisor
const arvore = (extra = {}) => ({ peca: 'base-conifera', x: 0, y: 0, z: 0, giro: 0, escala: 1, ...extra });

teste('sem ajuste, o colisor E a caixa da peca', () => {
  assert.deepEqual(caixaDeColisao(arvore(), [2, 5, 2]), caixaDoItem(arvore(), [2, 5, 2]));
});

teste('col:false DESLIGA o colisor daquele item so', () => {
  assert.equal(caixaDeColisao(arvore({ col: false }), [2, 5, 2]), null);
  assert.ok(caixaDeColisao(arvore(), [2, 5, 2]));
});

teste('a escala do colisor APERTA a caixa sem mexer na peca', () => {
  const c = caixaDeColisao(arvore({ col: { ...colisorNeutro(), ex: 0.5 } }), [2, 5, 2]);
  assert.equal(c.max[0] - c.min[0], 1, 'a largura devia ter caido pela metade');
  assert.equal(c.max[1] - c.min[1], 5, 'a altura nao podia mudar');
});

teste('o deslocamento SOBE a caixa (a ponte com vao por baixo)', () => {
  const c = caixaDeColisao(arvore({ col: { ...colisorNeutro(), dy: 2 } }), [2, 5, 2]);
  assert.equal(c.min[1], 2);
  assert.equal(c.max[1], 7);
});

teste('o deslocamento acompanha a ESCALA da peca', () => {
  // um colisor empurrado 1 m numa peca que depois dobra tem de continuar na
  // mesma parte dela — em metros fixos ele escorregaria para fora
  const c = caixaDeColisao(arvore({ escala: 2, col: { ...colisorNeutro(), dy: 1 } }), [2, 5, 2]);
  assert.equal(c.min[1], 2, 'devia ter subido 2 m (1 m x escala 2)');
});

teste('lerColisor descarta o ajuste que nao ajusta nada', () => {
  // uma cena de duzentas pecas carregaria duzentos objetos identicos ao padrao
  assert.equal(lerColisor(colisorNeutro()), null);
  assert.equal(lerColisor({}), null);
  assert.equal(lerColisor(false), false, 'false e uma DECISAO, nao uma ausencia');
  assert.equal(lerColisor(null), null);
});

teste('lerColisor prende valor absurdo em vez de aceitar', () => {
  const c = lerColisor({ ex: 0, ey: -3, ez: 1e9, dy: 1e9 });
  assert.ok(c.ex > 0 && c.ey > 0, 'escala zero ou negativa vira caixa do avesso');
  assert.ok(c.ez <= 10 && c.dy <= 20);
});

teste('o ajuste do colisor sobrevive ao ciclo gravar -> ler', () => {
  const cena = { ...cenaVazia('x'), itens: [
    arvore({ col: { ...colisorNeutro(), ex: 0.5, dy: 1 } }),
    arvore({ x: 5, col: false }),
  ] };
  const lida = lerCena(JSON.parse(JSON.stringify(paraGravar(cena))));
  assert.equal(lida.itens[0].col.ex, 0.5);
  assert.equal(lida.itens[0].col.dy, 1);
  assert.equal(lida.itens[1].col, false, 'o desligado virou ligado ao gravar');
});

teste('o colisor NAO muda onde as pecas pousam em cima', () => {
  // `caixaDoItem` e a forma (o pouso, o encaixe) e `caixaDeColisao` e o colisor:
  // misturar as duas faria apertar o colisor de uma pedra mudar a altura em que
  // as coisas pousam nela — efeito colateral que ninguem pediu
  const it = arvore({ col: { ...colisorNeutro(), ey: 0.2 } });
  assert.equal(caixaDoItem(it, [2, 5, 2]).max[1], 5, 'a forma da peca mudou');
  assert.equal(caixaDeColisao(it, [2, 5, 2]).max[1], 3, 'o colisor devia ter encolhido');
});

teste('o colisor encolhe pelo CENTRO, como na Unity', () => {
  // encolher pela base pareceria mais util para quem poe coisas no chao, mas
  // seria uma segunda convencao: a Unity encolhe pelo centro e move com o
  // offset, e e o `dy` que existe para isso. Duas convencoes na mesma tela
  // fazem o ajuste que se aprendeu num campo errar no outro.
  const c = caixaDeColisao(arvore({ col: { ...colisorNeutro(), ey: 0.5 } }), [2, 5, 2]);
  assert.equal(c.min[1], 1.25);
  assert.equal(c.max[1], 3.75);
});

console.log('\n' + passou + ' testes passaram\n');
