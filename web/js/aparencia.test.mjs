/**
 * A APARÊNCIA DO JOGADOR — `node web/js/aparencia.test.mjs`
 *
 * Cabelo, pele e roupa: o que cada um veste no Mundo, e quem decide isso.
 *
 * O visual se julga OLHANDO. O que este arquivo guarda são as decisões que
 * produzem um boneco **plausível e errado**, sem uma linha no console:
 *
 *  - **peça no catálogo sem geometria no `boneco3d`.** É um cosmético que se
 *    compra e não aparece: a pessoa paga DP, escolhe, salva, e continua igual.
 *    E a de trás: geometria órfã é trabalho que ninguém alcança. As duas pontas
 *    são varridas aqui porque nenhum código as cruza em tempo de execução;
 *
 *  - **a peça de porto seguro estando à VENDA.** `normalizar` cai na primeira
 *    peça de cada slot quando não reconhece a escolhida. Se essa primeira for
 *    vendida, o porto seguro é uma peça que a maioria não tem — e o gatilho do
 *    banco recusaria o salvamento inteiro de quem caísse nele, por uma escolha
 *    que a pessoa nem fez;
 *
 *  - **a regra da posse invertida.** "Fora do catálogo é grátis" e "só o que
 *    está no catálogo é permitido" parecem a mesma frase e são opostas: a
 *    segunda deixa todo mundo pelado no dia em que a consulta de itens falhar;
 *
 *  - **os dois números que moram em dois idiomas.** O teto do JSON está aqui e
 *    no `check` da coluna; os tipos de item estão aqui e no `check` de `itens`.
 *    Escritos à mão nos dois lugares, eles se desencontram na primeira mudança,
 *    e o sintoma é a tela deixar montar e o banco recusar. Por isso o teste
 *    **lê o SQL** em vez de copiar o número.
 *
 * Cada recusa tem par CONTROLE: sem a aparência boa passando ao lado da torta,
 * um `normalizar` que devolvesse sempre o padrão passaria em tudo — e ninguém
 * conseguiria se vestir, com os testes verdes.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  SLOTS, PECAS, PALETA, LIMITE_JSON, NOME_DO_SLOT,
  padraoDe, normalizar, disponivel, pecasDoSlot, paraGravar,
} from './aparencia.js';
import { criarBoneco, ALTURA, PECAS_CONSTRUIVEIS, _cacheDeGeometria } from './boneco3d.js';
import { coresPara } from './actors.js';
import * as THREE from '../vendor/three/three.module.min.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const sql = readFileSync(new URL('../../supabase/migrations/0054_aparencia_do_jogador.sql', import.meta.url), 'utf8');
const todasAsPecas = SLOTS.flatMap((s) => PECAS[s].map((p) => p.id));

console.log('\n  ---- o catálogo e a geometria ----\n');

/**
 * O cruzamento que nenhum código faz sozinho. `aparencia.js` diz o que existe;
 * `boneco3d.js` diz qual é a forma. Um sem o outro é um buraco no boneco ou uma
 * peça invisível — e o `normalizar` não pega, porque para ele a peça É válida.
 */
t('toda peça do catálogo tem geometria, e toda geometria está no catálogo', () => {
  const semForma = todasAsPecas.filter((id) => !PECAS_CONSTRUIVEIS.includes(id));
  assert.deepEqual(semForma, [],
    'peça que se compra e não aparece: o jogador paga, escolhe, salva e continua igual');

  const orfas = PECAS_CONSTRUIVEIS.filter((id) => !todasAsPecas.includes(id));
  assert.deepEqual(orfas, [], 'geometria que ninguém alcança — nenhum slot a oferece');
});

t('o id da peça é o id do ITEM: prefixado pelo slot, sem inventar nome', () => {
  // O gatilho do banco procura `value->>'peca'` direto em `itens.id`. Se o id
  // daqui fosse curto e o de lá prefixado, a regra de posse precisaria montar
  // um a partir do outro nos DOIS lados — e no dia em que o JS e o SQL
  // discordassem sobre o hífen, todo mundo passaria a vestir de graça.
  for (const slot of SLOTS) {
    for (const p of PECAS[slot]) {
      assert.ok(p.id.startsWith(`${slot}-`), `"${p.id}" não começa com "${slot}-"`);
      assert.ok(/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.id),
        `"${p.id}" não casa com o check de itens.id (0051)`);
      assert.ok(p.nome && typeof p.nome === 'string', `"${p.id}" sem nome para a tela`);
    }
  }
});

t('todo slot tem peça, cor e um nome para a tela', () => {
  for (const slot of SLOTS) {
    assert.ok(PECAS[slot]?.length >= 2, `slot "${slot}" com menos de duas peças não é escolha`);
    assert.ok(PALETA[slot]?.length >= 4, `slot "${slot}" sem paleta`);
    assert.ok(NOME_DO_SLOT[slot], `slot "${slot}" sem nome — a aba sairia em branco`);
  }
  assert.ok(PALETA.pele?.length >= 4, 'a pele é só cor, e precisa de paleta');
});

console.log('\n  ---- o que sempre vale ----\n');

t('aparência torta vira a do padrão, nunca erro e nunca nada', () => {
  const padrao = padraoDe('alguem');
  for (const lixo of [null, undefined, 42, 'texto', [], true, { pele: [] }]) {
    const a = normalizar(lixo, 'alguem');
    assert.equal(a.pele, padrao.pele, `não caiu no padrão: ${JSON.stringify(lixo)}`);
    for (const slot of SLOTS) assert.equal(a[slot].peca, padrao[slot].peca);
  }
});

/**
 * O caso comum e o mais importante: um admin cadastra um cabelo novo hoje, e
 * quem ainda não atualizou o jogo não tem a geometria dele. Cair no padrão
 * mostra a pessoa de cabelo curto; deixar passar manda um id sem construtor
 * para o `boneco3d`, e ali vira uma cabeça vazia sem aviso nenhum.
 */
t('peça desconhecida cai no padrão do slot — o cliente velho contra o item novo', () => {
  const a = normalizar({ cabelo: { peca: 'cabelo-que-ainda-nao-existe', cor: '#123456' } }, 'x');
  assert.equal(a.cabelo.peca, PECAS.cabelo[0].id, 'passou uma peça que o boneco não sabe montar');
  // A COR escolhida sobrevive: ela é válida, e só a forma é que não era.
  assert.equal(a.cabelo.cor, '#123456');

  // CONTROLE: a peça conhecida passa. Sem isto, um `normalizar` que devolvesse
  // sempre o padrão passaria em tudo e ninguém conseguiria se vestir.
  const b = normalizar({ cabelo: { peca: 'cabelo-moicano', cor: '#123456' } }, 'x');
  assert.equal(b.cabelo.peca, 'cabelo-moicano', 'a peça boa foi recusada');
});

t('cor torta vira a do padrão — senão a peça sai BRANCA', () => {
  const padrao = padraoDe('x');
  // Cada um destes chega em `new THREE.Color()`, que resmunga no console e
  // deixa a peça branca. Branco no meio de um boneco parece escolha ruim.
  for (const ruim of ['', 'vermelho', '#abc', '#12345', 'rgb(1,2,3)', 123, null, {}]) {
    const a = normalizar({ pele: ruim, roupa: { peca: 'roupa-jaqueta', cor: ruim } }, 'x');
    assert.equal(a.pele, padrao.pele, `passou pele "${JSON.stringify(ruim)}"`);
    assert.equal(a.roupa.cor, padrao.roupa.cor, `passou cor "${JSON.stringify(ruim)}"`);
  }
  // CONTROLE: hexa de verdade passa, com maiúscula inclusive.
  assert.equal(normalizar({ pele: '#AABBCC' }, 'x').pele, '#AABBCC');
});

t('chave a mais é descartada — é o que segura o tamanho do JSON', () => {
  const a = normalizar({ pele: '#aabbcc', chapeu: { peca: 'x' }, lixo: 'y'.repeat(5000) }, 'x');
  assert.deepEqual(Object.keys(a).sort(),
    ['calca', 'cabelo', 'pele', 'personagem', 'roupa', 'sapato'].sort());
});

t('o PERSONAGEM sobrevive ao normalizar (senão o salvamento o descarta calado)', () => {
  // `paraGravar` chama `normalizar`, e `normalizar` monta a saída do ZERO: uma
  // chave que ele não conheça some entre escolher e salvar, sem erro nenhum.
  const a = normalizar({ personagem: { peca: 'kaiba' } }, 'x');
  assert.equal(a.personagem.peca, 'kaiba');
  assert.equal(paraGravar({ personagem: { peca: 'kaiba' } }, 'x').personagem.peca, 'kaiba');
});

t('personagem torto ou ausente cai no padrão, nunca em undefined', () => {
  assert.equal(normalizar({}, 'x').personagem.peca, 'padrao');
  assert.equal(normalizar({ personagem: 'kaiba' }, 'x').personagem.peca, 'padrao');
  assert.equal(normalizar({ personagem: { peca: 'MAIÚSCULO' } }, 'x').personagem.peca, 'padrao');
  assert.equal(normalizar({ personagem: [] }, 'x').personagem.peca, 'padrao');
});

/**
 * A aparência de fábrica sai do ID, e não é fixa. É a mesma `coresPara` que já
 * pinta os adversários e o mundo 2D — então quem nunca abriu o vestiário fica
 * com exatamente a cara que já tinha, e o Mundo não vira uma fileira de clones
 * no dia em que a customização entrar.
 */
t('quem nunca se vestiu mantém a cara que já tinha', () => {
  const c = coresPara('kaiba');
  const a = padraoDe('kaiba');
  assert.equal(a.pele, c.s, 'a pele deixou de sair do id');
  assert.equal(a.cabelo.cor, c.h);
  assert.equal(a.roupa.cor, c.c);

  assert.deepEqual(padraoDe('kaiba'), a, 'o padrão mudou entre duas chamadas');
  assert.notDeepEqual(padraoDe('joey'), a, 'dois jogadores diferentes com a mesma cara');
});

console.log('\n  ---- a posse ----\n');

/**
 * A regra, em uma frase: *"se a peça está no catálogo de venda, você precisa
 * tê-la; se não está, é de graça"*. Ela é escrita duas vezes de propósito —
 * aqui, para saber o que OFERECER, e no gatilho da 0054, para saber o que
 * ACEITAR. A segunda é a que vale.
 */
t('fora do catálogo é grátis; dentro dele, só com posse', () => {
  const catalogo = new Map([
    ['cabelo-moicano', { preco: 500, tenho: false }],
    ['cabelo-longo', { preco: 500, tenho: true }],
  ]);
  assert.equal(disponivel('cabelo-curto', catalogo), true, 'peça básica ficou presa');
  assert.equal(disponivel('cabelo-moicano', catalogo), false, 'peça paga liberada sem posse');
  assert.equal(disponivel('cabelo-longo', catalogo), true, 'peça comprada continuou presa');
});

t('catálogo vazio não deixa ninguém pelado', () => {
  // A consulta de itens falhou, ou não há nada à venda. Inverter a regra ("só
  // o que está no catálogo é permitido") recusaria justamente as peças básicas,
  // que são as que ninguém cadastra em `itens`.
  for (const nada of [new Map(), null, undefined]) {
    for (const id of todasAsPecas) {
      assert.equal(disponivel(id, nada), true, `"${id}" ficou preso com catálogo ${nada}`);
    }
  }
});

/**
 * `normalizar` cai na PRIMEIRA peça de cada slot quando não reconhece a
 * escolhida. Se essa primeira estivesse à venda, o porto seguro seria uma peça
 * que a maioria não tem — e o gatilho recusaria o salvamento inteiro de quem
 * caísse nele, por uma escolha que a pessoa nem fez.
 */
t('a peça de porto seguro de cada slot é a que o padrão usa', () => {
  const padrao = padraoDe('x');
  for (const slot of SLOTS) {
    assert.equal(padrao[slot].peca, PECAS[slot][0].id,
      `o padrão de "${slot}" não é a primeira peça — o porto seguro e o padrão divergiram`);
  }
});

t('a tela mostra a peça presa, com o preço, em vez de escondê-la', () => {
  const catalogo = new Map([['cabelo-moicano', { preco: 500, tenho: false }]]);
  const lista = pecasDoSlot('cabelo', catalogo);
  assert.equal(lista.length, PECAS.cabelo.length, 'o vestiário escondeu peça');

  const presa = lista.find((p) => p.id === 'cabelo-moicano');
  assert.equal(presa.liberada, false);
  assert.equal(presa.preco, 500, 'sem o preço, o cadeado não diz o que fazer a respeito');
  assert.equal(lista.find((p) => p.id === 'cabelo-curto').aVenda, false);
});

console.log('\n  ---- os números que moram em dois idiomas ----\n');

t('o teto do JSON é o mesmo aqui e no check da coluna', () => {
  const m = sql.match(/length\(aparencia::text\)\s*<=\s*(\d+)/);
  assert.ok(m, 'a migration deixou de limitar o tamanho da aparência');
  assert.equal(Number(m[1]), LIMITE_JSON,
    'a tela e o banco discordam do teto — um deixa montar e o outro recusa');
});

t('a aparência mais gorda possível cabe no teto', () => {
  const gorda = { pele: '#aabbcc' };
  for (const slot of SLOTS) {
    // a peça de id mais longo do slot, para medir o pior caso
    const maior = [...PECAS[slot]].sort((a, b) => b.id.length - a.id.length)[0];
    gorda[slot] = { peca: maior.id, cor: '#aabbcc' };
  }
  const txt = JSON.stringify(paraGravar(gorda, 'x'));
  assert.ok(txt.length <= LIMITE_JSON, `${txt.length} bytes passa do teto de ${LIMITE_JSON}`);
});

t('todo slot é um tipo de item que o banco aceita', () => {
  const m = sql.match(/check \(tipo in \(([^)]*)\)\)/);
  assert.ok(m, 'a migration deixou de mexer no check de itens.tipo');
  const aceitos = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  for (const slot of SLOTS) {
    assert.ok(aceitos.includes(slot),
      `"${slot}" não é tipo aceito em itens — o admin não conseguiria cadastrar a peça`);
  }
  // CONTROLE: os tipos que já existiam continuam lá. Um `drop constraint` que
  // esquecesse os antigos derrubaria sleeve, playmat e deckbox de uma vez.
  for (const velho of ['generico', 'sleeve', 'playmat', 'deckbox']) {
    assert.ok(aceitos.includes(velho), `o check novo perdeu o tipo "${velho}"`);
  }
});

t('a migration traz a fechadura e a porta, não só a coluna', () => {
  assert.ok(/create trigger perfis_aparencia_valida/.test(sql),
    'sem o gatilho, um PATCH direto veste o cosmético mais caro da loja de graça');
  assert.ok(/create or replace function public\.aparencias\(/.test(sql),
    'sem a rpc, ninguém lê a aparência de ninguém — a policy de perfis é id = auth.uid()');
  assert.ok(/grant execute on function public\.aparencias/.test(sql),
    'a função existe e ninguém pode chamá-la');
  // Ela devolve nome e roupa, e NADA do resto do perfil.
  const corpo = sql.match(/create or replace function public\.aparencias\([\s\S]*?\$\$;/)[0];
  for (const proibido of ['dp', 'etiqueta', 'visto_em', 'admin', 'email']) {
    assert.ok(!new RegExp(`p\\.${proibido}\\b`).test(corpo),
      `a rpc/aparencias vazou "${proibido}" — ela é uma porta estreita, não o perfil inteiro`);
  }
});

console.log('\n  ---- o boneco montado ----\n');

const caixaDe = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

t('toda peça monta, com os pés no chão e sem NaN', () => {
  for (const slot of SLOTS) {
    for (const p of PECAS[slot]) {
      const b = criarBoneco({ id: 'x', aparencia: { [slot]: { peca: p.id, cor: '#c94f4f' } } });
      const c = caixaDe(b.grupo);

      let nan = 0;
      b.grupo.traverse((o) => { if (o.isMesh && Number.isNaN(o.matrixWorld.elements[13])) nan++; });
      assert.equal(nan, 0, `"${p.id}" produziu matriz NaN — a peça não aparece e não reclama`);

      // Pés no chão: o boneco é posto em `alturaDoChao`, então uma peça que
      // desce abaixo de zero afunda no terreno e uma que sobra o faz flutuar.
      assert.ok(Math.abs(c.min.y) < 0.02, `"${p.id}" com os pés em y=${c.min.y.toFixed(3)}`);
      // Cabelo alto é legítimo (um moicano passa da cabeça); o que não pode é
      // encostar na etiqueta de nome, desenhada em ALTURA + 0.3.
      assert.ok(c.max.y < ALTURA + 0.28, `"${p.id}" bate na etiqueta (topo ${c.max.y.toFixed(3)})`);
      b.descartar();
    }
  }
});

/**
 * O pior defeito possível desta feature, e o motivo de o cache existir: a
 * geometria é COMPARTILHADA entre todos os bonecos. Descartá-la junto com o
 * corpo de quem sai apagaria a peça do PRÓXIMO boneco, muito depois, com a
 * causa a dez minutos de distância.
 */
t('descartar um boneco não come a geometria do próximo', () => {
  const a = criarBoneco({ id: 'a' });
  const quantas = _cacheDeGeometria.size;
  assert.ok(quantas > 0, 'o cache de geometria está vazio — ninguém o está usando');
  a.descartar();

  assert.equal(_cacheDeGeometria.size, quantas, 'o descarte mexeu no cache');
  for (const g of _cacheDeGeometria.values()) {
    assert.ok(g.attributes?.position, 'geometria compartilhada foi descartada junto com um boneco');
  }

  // CONTROLE: o próximo boneco monta inteiro depois do descarte do anterior.
  const b = criarBoneco({ id: 'b' });
  let malhas = 0;
  b.grupo.traverse((o) => { if (o.isMesh) malhas++; });
  assert.ok(malhas >= 15, `o boneco seguinte saiu com ${malhas} malhas`);
  b.descartar();
});

t('trocar de roupa não deixa material órfão para trás', () => {
  const b = criarBoneco({ id: 'x' });
  const conta = () => { let n = 0; b.grupo.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const antes = conta();
  // O vestiário chama isto a cada clique: vinte trocas não podem virar vinte
  // conjuntos de malhas empilhados no mesmo boneco.
  for (const peca of PECAS.cabelo) b.vestir({ cabelo: { peca: peca.id, cor: '#aabbcc' } });
  b.vestir(null);
  assert.equal(conta(), antes, 'trocar de roupa empilhou malhas em vez de trocá-las');
  b.descartar();
});

console.log('\n  ---- a GEOMETRIA de cada peca ----\n');

/**
 * Toda combinacao possivel, montada e MEDIDA.
 *
 * Geometria escrita a mao erra CALADA: um numero trocado poe a gravata dentro
 * do peito, a saia no joelho ou o cabelo flutuando meio metro acima da cabeca —
 * e nada levanta, porque a peca esta exatamente onde foi mandada. O unico jeito
 * de pegar isso sem olhar a tela e' medir.
 *
 * Sao 9 x 8 x 4 x 3 = 864 combinacoes; montar todas custa menos de um segundo e
 * cobre o cruzamento que nenhuma combinacao escolhida a dedo cobriria.
 */
const cor = { pele: '#e8c9a8' };
const vestir = (cabelo, roupa, calca, sapato) => criarBoneco({
  id: 'medida',
  aparencia: {
    ...cor,
    cabelo: { peca: cabelo, cor: '#3b2a1e' },
    roupa: { peca: roupa, cor: '#3f6fd8' },
    calca: { peca: calca, cor: '#2b3550' },
    sapato: { peca: sapato, cor: '#20242e' },
  },
});

// `caixaDe` ja existe acima, no bloco do vestiario — reusa
t('nenhuma combinacao produz NaN — vertice NaN faz o boneco SUMIR inteiro', () => {
  // e sem erro nenhum: o objeto simplesmente nao e desenhado
  for (const c of PECAS.cabelo) for (const r of PECAS.roupa) {
    const eu = vestir(c.id, r.id, 'calca-saia-pregueada', 'sapato-colegial');
    const caixa = caixaDe(eu.grupo);
    assert.ok(Number.isFinite(caixa.min.y) && Number.isFinite(caixa.max.y),
      `${c.id} + ${r.id} deu NaN`);
    eu.descartar();
  }
});

t('toda combinacao fica de PE no chao e com altura de gente', () => {
  // o boneco e' posto na cena somando a altura do chao aos PES: um modelo cujos
  // pes nao ficam em y=0 flutua ou afunda o mundo inteiro junto (foi o que o
  // Kenney fez, entrando com 4,27 m e os pes a 80 cm)
  for (const c of PECAS.cabelo) for (const r of PECAS.roupa) {
    for (const p2 of PECAS.calca) for (const s2 of PECAS.sapato) {
      const eu = vestir(c.id, r.id, p2.id, s2.id);
      const caixa = caixaDe(eu.grupo);
      const alt = caixa.max.y - caixa.min.y;
      const quem = `${c.id}/${r.id}/${p2.id}/${s2.id}`;
      assert.ok(Math.abs(caixa.min.y) < 0.05, `${quem}: pes em y=${caixa.min.y.toFixed(3)}`);
      assert.ok(alt > ALTURA * 0.92 && alt < ALTURA * 1.12, `${quem}: ${alt.toFixed(2)} m`);
      assert.ok(caixa.max.x - caixa.min.x < 1.1, `${quem}: largura ${(caixa.max.x - caixa.min.x).toFixed(2)} m`);
      eu.descartar();
    }
  }
});

/**
 * O UNIFORME escolar, peca a peca.
 *
 * A gravata, o laco e a camisa no V sao o desenho inteiro do uniforme, e todos
 * moram no PEITO — o lugar mais facil de errar, porque o tronco vestido e' uma
 * capsula achatada e a superficie dele nao esta onde o raio diz. Uma gravata
 * pousada 6 mm a frente do pano parece solta de perto, e nada acusa.
 */
t('peca de PEITO cruza a superficie do tronco, em vez de flutuar na frente', () => {
  const doPeito = ['roupa-uniforme', 'roupa-uniforme-laco', 'roupa-sueter', 'roupa-blazer'];
  for (const id of doPeito) {
    const eu = vestir('cabelo-curto', id, 'calca-comprida', 'sapato-colegial');

    // o tronco NU (a capsula do corpo) e a fronteira: tudo o que se pendura no
    // peito tem de comecar atras da frente do que ja esta vestido
    // O PANO e' a malha larga que ATRAVESSA a altura do peito; ela comeca la
    // embaixo (o torso vai de 0,69 a 1,44), entao filtrar por "esta entre 1,0 e
    // 1,55" a descarta — foi o que este teste fez na primeira versao, e ele
    // "passou" por nao achar o que media.
    const PEITO = 1.20;
    let frenteDoPano = 0;
    const salientes = [];
    // A RAIZ primeiro. `updateMatrixWorld` num filho atualiza ele e os
    // DESCENDENTES dele — nunca os pais. Medir uma peca sem atualizar a arvore
    // inteira devolve a caixa dela na pose de montagem, e todas voltam para
    // perto da origem: o teste nao acha o torso, e "nao achei" e' facil de
    // confundir com "nao existe".
    eu.grupo.updateMatrixWorld(true);
    eu.grupo.traverse((n) => {
      if (!n.isMesh) return;
      const b = new THREE.Box3().setFromObject(n);
      if (b.min.y > PEITO || b.max.y < PEITO) return;
      if (b.max.x - b.min.x > 0.3) { frenteDoPano = Math.max(frenteDoPano, b.max.z); return; }
      // SO o que esta inteiro a frente do centro. Os bracos tambem cruzam a
      // altura do peito e sao estreitos, mas vao de -0,06 a +0,06: incluidos,
      // eles passariam sempre (estao muito atras do pano) e diluiriam a
      // varredura com casos que nao respondem nada.
      if (b.min.z > 0) salientes.push({ nome: n.name || '?', min: b.min.z, max: b.max.z });
    });

    assert.ok(frenteDoPano > 0.1, `${id}: nao achei o torso (frente em ${frenteDoPano})`);
    for (const s2 of salientes) {
      assert.ok(s2.min <= frenteDoPano + 0.001,
        `${id}: uma peca comeca em z=${s2.min.toFixed(3)} e o pano acaba em `
        + `${frenteDoPano.toFixed(3)} — ela flutuaria ${((s2.min - frenteDoPano) * 1000).toFixed(0)} mm a frente`);
    }
    eu.descartar();
  }
});

t('par CONTROLE: a varredura RECONHECE uma gravata flutuando', () => {
  // Sem isto o teste acima passa por nao medir nada — foi exatamente o que ele
  // fez em duas versoes seguidas: uma vez porque o filtro de altura descartava
  // o proprio torso, outra porque `updateMatrixWorld` num filho nao atualiza os
  // pais e todas as caixas voltavam para a origem. Um teste que nao acha o que
  // mede e' verde e inutil.
  const eu = vestir('cabelo-curto', 'roupa-uniforme', 'calca-comprida', 'sapato-colegial');
  eu.grupo.updateMatrixWorld(true);
  const PEITO = 1.20;
  let pano = 0;
  const estreitas = [];
  eu.grupo.traverse((n) => {
    if (!n.isMesh) return;
    const b = new THREE.Box3().setFromObject(n);
    if (b.min.y > PEITO || b.max.y < PEITO) return;
    if (b.max.x - b.min.x > 0.3) { pano = Math.max(pano, b.max.z); return; }
    if (b.min.z > 0) estreitas.push(b);
  });
  assert.ok(pano > 0.1, 'a varredura nao achou o torso: ela nao mede nada');
  assert.ok(estreitas.length > 0, 'a varredura nao achou peca de peito nenhuma');
  // empurra uma delas 2 cm para a frente e confere que a conta acusaria
  const solta = estreitas[0].clone().translate(new THREE.Vector3(0, 0, 0.05));
  assert.ok(solta.min.z > pano + 0.001, 'a conta nao acusaria uma peca deslocada 5 cm');
  eu.descartar();
});

t('o uniforme cabe no orcamento de triangulos de um NPC', () => {
  // varias pessoas na tela ao mesmo tempo: e' o numero que decide se a cidade
  // roda. Um VRoid gratis tem ~32 mil por pessoa; o nosso tem de ficar na casa
  // dos milhares, senao dez NPCs sao mais caros que a floresta inteira.
  const eu = vestir('cabelo-chanel', 'roupa-uniforme-laco', 'calca-saia-pregueada', 'sapato-colegial');
  let tri = 0;
  eu.grupo.traverse((n) => {
    if (!n.isMesh) return;
    const g = n.geometry;
    tri += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  assert.ok(tri < 8000, `o uniforme completo custa ${Math.round(tri)} triangulos`);
  eu.descartar();
});

t('as pecas do UNIFORME existem nos quatro slots', () => {
  // a campanha precisa das quatro: sem a saia pregueada ou o sapato com meia,
  // "uniforme" vira "blazer com tenis"
  const ids = SLOTS.flatMap((s2) => PECAS[s2].map((p2) => p2.id));
  for (const id of ['roupa-uniforme', 'roupa-uniforme-laco', 'roupa-blazer', 'roupa-sueter',
                    'calca-saia-pregueada', 'sapato-colegial',
                    'cabelo-chanel', 'cabelo-chiquinhas', 'cabelo-reparticao']) {
    assert.ok(ids.includes(id), `falta ${id} no catalogo`);
  }
});

console.log('\n  ---- o vestiário ----\n');

t('o Mundo tem a gaveta, e ela nasce escondida', () => {
  const html = readFileSync(new URL('../mundo3d.html', import.meta.url), 'utf8');
  const m = html.match(/<aside id="vestiario"([^>]*)>/);
  assert.ok(m, 'não achei a gaveta do vestiário');
  assert.ok(/\bhidden\b/.test(m[1]),
    'a gaveta nasce aberta — ela cobriria o mundo até alguém fechá-la');
  assert.ok(/id="btn-vestiario"/.test(html), 'não há botão para abrir o vestiário');

  const js = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  // Salvar é um PATCH na própria linha; quem confere a posse é o gatilho.
  assert.ok(/paraGravar\(/.test(js), 'o vestiário grava sem passar pela normalização');
  assert.ok(/avisarQueTrocouDeRoupa/.test(js),
    'ninguém na clareira fica sabendo da roupa nova — eles veriam a antiga até eu reentrar');
});

/**
 * `Esc` em CAMADAS. Sem isso, quem só queria fechar o vestiário sai do Mundo
 * inteiro — perde o lugar onde estava E descarta a roupa que estava montando.
 */
t('Esc fecha o vestiário antes de sair do Mundo', () => {
  const js = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  const bloco = js.match(/if \(e\.code === 'Escape'\) \{([\s\S]*?)\n  \}/);
  assert.ok(bloco, 'o Escape deixou de ser tratado');
  const ordem = bloco[1];
  const iVest = ordem.indexOf('vestiarioAberto');
  const iSair = ordem.indexOf('sairDoMundo');
  assert.ok(iVest >= 0, 'o Escape ignora o vestiário aberto');
  assert.ok(iSair > iVest, 'sair do Mundo vem antes de fechar o vestiário');
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
