/**
 * Testes de DE QUEM É A CARTA na hora de escolher — `node web/js/alvos.test.mjs`.
 *
 * O relato: *"quando eu ativo um card, aparecem todos os cards elegíveis para
 * selecionar, porém não diferencia quais são meus e quais são do oponente"*,
 * com o **Chaos Scepter Blast** de exemplo — a carta que bane 1 do CAMPO, dos
 * dois lados, e cujo pior caso é uma fileira de cartas SETADAS: elas chegam sem
 * código e são todas desenhadas com o mesmo verso.
 *
 * Tudo aqui erra CALADO, e é por isso que a regra saiu de dentro do `duel.html`:
 *
 *   • **cair no quadro** quando dava para clicar na mesa é só chato;
 *   • **cair NA MESA** quando uma das cartas não tem zona à vista deixa a
 *     pergunta sem resposta possível — e o duelo para ali, sem erro nenhum;
 *   • e o CSS da barra sem vidro tem duas armadilhas que nenhum teste de lógica
 *     alcança: um `display` escrito no lugar errado deixa a barra na tela para
 *     sempre, e um `pointer-events` esquecido faz um overlay TRANSPARENTE
 *     engolir todo clique no tabuleiro. As duas estão cobertas no fim.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LOCAL, nomeDoLocal, estaNoCampo, ancoraDe, donoDaCarta,
  agruparEscolhas, eixosQueVariam, seloDaCarta,
  misturaOsDoisLados, escolhaNoCampo, ROTULO,
} from './alvos.js';

let n = 0;
const teste = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

/** Uma carta oferecida, no formato do `Sel` do servidor. */
const carta = (o = {}) => ({
  code: 1234, index: 0, controller: 0, location: LOCAL.MZONE, sequence: 0,
  hidden: false, param: 0, ...o,
});
const pergunta = (o = {}) => ({ kind: 'selectcard', player: 0, selMin: 1, selMax: 1, choices: [], ...o });

console.log('alvos.js');

// ------------------------------------------------------------- classificação
teste('estaNoCampo: só monstro e magia/armadilha são zona do tabuleiro', () => {
  for (const loc of [LOCAL.MZONE, LOCAL.SZONE]) {
    assert.equal(estaNoCampo(carta({ location: loc })), true);
  }
  for (const loc of [LOCAL.MAO, LOCAL.DECK, LOCAL.CEMITERIO, LOCAL.BANIDA, LOCAL.EXTRA]) {
    assert.equal(estaNoCampo(carta({ location: loc })), false);
  }
});

teste('a âncora é a MESMA chave que a zona escreve no data-anchor', () => {
  assert.equal(ancoraDe(carta({ controller: 1, location: LOCAL.SZONE, sequence: 3 })), '1:8:3');
  // A zona de campo é SZONE seq 5 — a única do tabuleiro fora das cinco.
  assert.equal(ancoraDe(carta({ controller: 0, location: LOCAL.SZONE, sequence: 5 })), '0:8:5');
});

teste('controller 0 é SEMPRE quem está lendo (a ponte já virou a mesa)', () => {
  assert.equal(donoDaCarta(carta({ controller: 0 })), 'meu');
  assert.equal(donoDaCarta(carta({ controller: 1 })), 'dele');
});

teste('nomeDoLocal responde em português, e nunca "undefined"', () => {
  assert.equal(nomeDoLocal(LOCAL.MAO), 'mão');
  assert.equal(nomeDoLocal(LOCAL.MZONE), 'campo');
  assert.equal(nomeDoLocal(LOCAL.SZONE), 'campo');
  assert.equal(nomeDoLocal(LOCAL.CEMITERIO), 'cemitério');
  assert.equal(nomeDoLocal(999), 'lugar nenhum');
});

// ------------------------------------------------------------- agrupamento
teste('agrupa por dono, as MINHAS primeiro', () => {
  const cs = [
    carta({ index: 0, controller: 1 }),
    carta({ index: 1, controller: 0 }),
    carta({ index: 2, controller: 1 }),
  ];
  const g = agruparEscolhas(cs);
  assert.deepEqual(g.map((x) => x.dono), ['meu', 'dele']);
  assert.deepEqual(g[0].cartas.map((c) => c.index), [1]);
  assert.deepEqual(g[1].cartas.map((c) => c.index), [0, 2]);
});

teste('a ordem DENTRO do grupo é a do motor — o index é a resposta', () => {
  const cs = [carta({ index: 5, controller: 0 }), carta({ index: 2, controller: 0 })];
  assert.deepEqual(agruparEscolhas(cs)[0].cartas.map((c) => c.index), [5, 2]);
});

teste('grupo vazio não aparece — mas o grupo único ainda é rotulado', () => {
  const so_minhas = agruparEscolhas([carta({ controller: 0 }), carta({ controller: 0 })]);
  assert.equal(so_minhas.length, 1);
  assert.match(so_minhas[0].titulo, new RegExp(ROTULO.meu.titulo));

  const so_dele = agruparEscolhas([carta({ controller: 1 })]);
  assert.equal(so_dele.length, 1);
  assert.match(so_dele[0].titulo, new RegExp(ROTULO.dele.titulo));

  assert.deepEqual(agruparEscolhas([]), []);
  assert.deepEqual(agruparEscolhas(null), []);
});

// ------------------------------------------- o LUSTRO NEGRO tributado errado
//
// O relato: *"tributei meu Lustro Negro errado porque eu tinha 1 na mão e 1 no
// campo, e na hora de escolher os dois apareceram iguais, sem dizer de onde era
// cada um"*. As duas eram MINHAS — o selo de dono estava certo e era inútil — e
// o que separava as duas cartas, o LUGAR, só existia no `title`, atrás de um
// hover. Numa escolha que não dá para desfazer, ou está desenhado, ou não existe.

teste('a MESMA carta minha na mão e no campo cai em grupos DIFERENTES', () => {
  const cs = [
    carta({ index: 0, controller: 0, location: LOCAL.MAO, code: 5405694 }),
    carta({ index: 1, controller: 0, location: LOCAL.MZONE, sequence: 2, code: 5405694 }),
  ];
  const g = agruparEscolhas(cs);
  assert.equal(g.length, 2, 'duas cartas iguais em lugares diferentes = dois grupos');
  // O campo vem antes da mão: é a ordem em que se lê a mesa.
  assert.deepEqual(g.map((x) => x.local), [LOCAL.MZONE, LOCAL.MAO]);
  for (const x of g) assert.match(x.titulo, /SUAS CARTAS · (CAMPO|MÃO)/);
});

teste('o selo diz só o que VARIA — dono, lugar, ou os dois', () => {
  const naMao = carta({ controller: 0, location: LOCAL.MAO });
  const noCampo = carta({ controller: 0, location: LOCAL.MZONE });
  const dele = carta({ controller: 1, location: LOCAL.MZONE });

  // Só o lugar varia: o selo é o lugar (dizer "sua" em todas seria ruído).
  const soLugar = eixosQueVariam([naMao, noCampo]);
  assert.deepEqual(soLugar, { dono: false, local: true });
  assert.equal(seloDaCarta(naMao, soLugar), 'mão');
  assert.equal(seloDaCarta(noCampo, soLugar), 'campo');

  // Só o dono varia: o selo é o dono — é o caso do relato original.
  const soDono = eixosQueVariam([noCampo, dele]);
  assert.deepEqual(soDono, { dono: true, local: false });
  assert.equal(seloDaCarta(noCampo, soDono), 'sua');
  assert.equal(seloDaCarta(dele, soDono), 'dele');

  // Os dois variam: os dois aparecem.
  const ambos = eixosQueVariam([naMao, dele]);
  assert.deepEqual(ambos, { dono: true, local: true });
  assert.equal(seloDaCarta(naMao, ambos), 'sua · mão');
  assert.equal(seloDaCarta(dele, ambos), 'dele · campo');
});

teste('nada varia: sem selo — o título do grupo já disse tudo', () => {
  const cs = [carta({ index: 0, controller: 0, location: LOCAL.MZONE }),
              carta({ index: 1, controller: 0, location: LOCAL.MZONE })];
  const eixos = eixosQueVariam(cs);
  assert.deepEqual(eixos, { dono: false, local: false });
  assert.equal(seloDaCarta(cs[0], eixos), '');
});

teste('os dois rótulos são DIFERENTES — é a única coisa que o selo precisa ser', () => {
  assert.notEqual(ROTULO.meu.titulo, ROTULO.dele.titulo);
  assert.notEqual(ROTULO.meu.selo, ROTULO.dele.selo);
});

teste('misturaOsDoisLados é o caso do relato (Chaos Scepter Blast)', () => {
  assert.equal(misturaOsDoisLados([carta({ controller: 0 }), carta({ controller: 1 })]), true);
  assert.equal(misturaOsDoisLados([carta({ controller: 0 })]), false);
});

// --------------------------------------------------- a escolha NA MESA
teste('tudo no campo: devolve as zonas, indexadas pela âncora', () => {
  const q = pergunta({ choices: [
    carta({ index: 0, controller: 0, location: LOCAL.MZONE, sequence: 1 }),
    carta({ index: 1, controller: 1, location: LOCAL.SZONE, sequence: 2, hidden: true, code: 0 }),
  ] });
  const zonas = escolhaNoCampo(q);
  assert.ok(zonas);
  assert.deepEqual([...zonas.keys()], ['0:4:1', '1:8:2']);
  assert.equal(zonas.get('1:8:2').index, 1);
});

teste('a carta SETADA do oponente não é exceção — é justamente o caso', () => {
  const q = pergunta({ choices: [
    carta({ index: 0, controller: 1, location: LOCAL.SZONE, sequence: 0, hidden: true, code: 0 }),
    carta({ index: 1, controller: 1, location: LOCAL.SZONE, sequence: 1, hidden: true, code: 0 }),
  ] });
  assert.equal(escolhaNoCampo(q).size, 2);
});

teste('UMA carta fora do campo derruba tudo para o quadro', () => {
  const q = pergunta({ choices: [
    carta({ index: 0, location: LOCAL.MZONE, sequence: 0 }),
    carta({ index: 1, location: LOCAL.MAO, sequence: 0 }),
  ] });
  assert.equal(escolhaNoCampo(q), null);
});

teste('zona que não está na TELA derruba para o quadro (material de Xyz)', () => {
  const q = pergunta({ choices: [
    carta({ index: 0, controller: 0, location: LOCAL.MZONE, sequence: 0 }),
    carta({ index: 1, controller: 0, location: LOCAL.MZONE, sequence: 7 }),
  ] });
  const naTela = (a) => a !== '0:4:7';
  assert.equal(escolhaNoCampo(q, naTela), null);
  // …e o par CONTROLE: com a zona à vista, a MESMA pergunta vai para a mesa.
  assert.ok(escolhaNoCampo(q, () => true));
});

teste('duas cartas na MESMA zona: o clique seria ambíguo, então vai o quadro', () => {
  const q = pergunta({ choices: [
    carta({ index: 0, controller: 0, location: LOCAL.MZONE, sequence: 2 }),
    carta({ index: 1, controller: 0, location: LOCAL.MZONE, sequence: 2 }),
  ] });
  assert.equal(escolhaNoCampo(q), null);
});

teste('o ritual (selectsum) fica no quadro: o que decide é o NÍVEL, que a zona não mostra', () => {
  const q = pergunta({ kind: 'selectsum', selMax: 3, choices: [
    carta({ index: 0, controller: 0, location: LOCAL.MZONE, sequence: 0, param: 4 }),
    carta({ index: 1, controller: 0, location: LOCAL.MZONE, sequence: 1, param: 4 }),
  ] });
  assert.equal(escolhaNoCampo(q), null);
});

teste('selecttribute e selectunselect também vão para a mesa', () => {
  for (const kind of ['selecttribute', 'selectunselect']) {
    const q = pergunta({ kind, choices: [
      carta({ index: 0, controller: 0, location: LOCAL.MZONE, sequence: 0 }),
    ] });
    assert.ok(escolhaNoCampo(q), kind);
  }
});

teste('escolher MAIS DE UMA na mesa é permitido — quem confirma é a barra', () => {
  const q = pergunta({ selMin: 2, selMax: 2, choices: [
    carta({ index: 0, controller: 1, location: LOCAL.MZONE, sequence: 0 }),
    carta({ index: 1, controller: 1, location: LOCAL.MZONE, sequence: 1 }),
  ] });
  assert.equal(escolhaNoCampo(q).size, 2);
});

teste('pergunta que não é minha, sem escolhas, ou de outro tipo: null', () => {
  const noCampo = [carta({ controller: 0, location: LOCAL.MZONE, sequence: 0 })];
  assert.equal(escolhaNoCampo(pergunta({ player: 1, choices: noCampo })), null);
  assert.equal(escolhaNoCampo(pergunta({ choices: [] })), null);
  assert.equal(escolhaNoCampo(pergunta({ kind: 'battle', choices: noCampo })), null);
  assert.equal(escolhaNoCampo(null), null);
});

// ------------------------------------------------- o CSS que erra calado
const aqui = dirname(fileURLToPath(import.meta.url));
const duel = readFileSync(join(aqui, '..', 'duel.html'), 'utf8');

/**
 * As declarações da regra com ESTE seletor exato, ou null.
 *
 * Os comentários saem antes: o que vem entre um `}` e o `{` seguinte é o
 * seletor MAIS o comentário que o explica, e neste arquivo toda regra tem um.
 */
function regra(css, seletor) {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of limpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() === seletor) return m[2];
  }
  return null;
}

teste('a barra sem vidro NÃO declara `display` — senão ela nunca mais some', () => {
  // `#sel-overlay[hidden] { display:none }` e `#sel-overlay.no-campo` têm a
  // MESMA especificidade, e a segunda é escrita depois: um `display` ali
  // venceria o `[hidden]` e a barra ficaria na tela para sempre, vazia, por
  // cima do duelo. É a armadilha de `esconder.test.mjs`, de dentro para fora.
  const r = regra(duel, '#sel-overlay.no-campo');
  assert.ok(r, 'a regra #sel-overlay.no-campo sumiu do duel.html');
  assert.ok(!/(^|;)\s*display\s*:/.test(r), 'a regra voltou a declarar display');
  assert.ok(/#sel-overlay\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(duel));
});

teste('o overlay transparente solta o clique, e a caixa o recupera', () => {
  // Sem isto, o overlay continua sendo `inset: 0` e engole TODO clique no
  // tabuleiro — a mesa fica desenhada, piscando as candidatas, e nada responde.
  const r = regra(duel, '#sel-overlay.no-campo');
  assert.match(r, /pointer-events\s*:\s*none/);
  const box = regra(duel, '#sel-overlay.no-campo .sel-box');
  assert.ok(box, 'a caixa da barra sumiu do duel.html');
  assert.match(box, /pointer-events\s*:\s*auto/);
});

teste('o duel.html usa mesmo o módulo (a regra não voltou a morar lá dentro)', () => {
  assert.match(duel, /from '\/web\/js\/alvos\.js'/);
  assert.match(duel, /escolhaNoCampo\(q, zonaClicavel\)/);
  assert.match(duel, /agruparEscolhas\(q\.choices/);
  // O selo é montado pelo módulo, e não por um `if` solto na tela: é ele que
  // decide o que varia, e uma segunda decisão aqui divergiria em silêncio.
  assert.match(duel, /seloDaCarta\(c, eixos\)/);
  assert.match(duel, /eixosQueVariam\(q\.choices/);
});

// -------------------------------------------- o duelo que PAROU (30/08/2026)
//
// O log de uma sessão de verdade: a pergunta do alvo do Dust Tornado chega, a
// escolha vai para a mesa, e por 39 segundos NENHUM `/respond` sai — o jogador
// clicou, nada respondeu, e ele saiu do duelo. A escolha na mesa tinha virado um
// beco sem saída. As duas metades da correção estão aqui.

teste('"clicável" é lido do MESMO elemento que recebe o clique', () => {
  // `zoneEl` só instala o `onclick` quando a zona tem CARTA (`if (cell &&
  // selKey)`), e é aí que ele põe a classe `selectable`. Perguntar "a âncora
  // existe?" era uma SEGUNDA condição — e ela discorda da primeira justamente
  // na zona que o motor oferece e a tela desenha vazia: a âncora existe, o
  // clique não. Uma condição só, no elemento que responde.
  assert.match(duel, /const zonaClicavel = \(a\) =>[^\n]*classList\.contains\('selectable'\)/);
  assert.match(duel, /z\.classList\.add\('selectable'\)/);
});

teste('a escolha na mesa TEM saída — o [ver a lista] devolve o quadro', () => {
  // Qualquer que seja o motivo de a carta não ser alcançável na mesa, o quadro
  // volta com um clique. Sem isto a única porta é o "desistir".
  assert.match(duel, /<button id="sel-lista"/);
  assert.match(duel, /btLista\.onclick = \(\) => \{ listaForcada = true;/);
  assert.match(duel, /listaForcada \? null : escolhaNoCampo/);
});

teste('o [ver a lista] vale por ESCOLHA, e não vira preferência', () => {
  // Zera junto do `picked`, na troca de pergunta: deixá-lo ligado faria a
  // pergunta seguinte abrir no quadro sem ninguém ter pedido.
  assert.match(duel, /listaForcada = false;\s*\/\/ o \[ver a lista\]/);
});

teste('NENHUMA saída de zoneEl escapa do applyZonePosition', () => {
  // **O defeito que o print mostrou**: *"na hora de selecionar, os cards saem
  // de suas posições originais"*. Com um tabuleiro ativo cada zona é
  // posicionada em pixel, e `applyZonePosition` era a ÚLTIMA linha de
  // `zoneEl` — enquanto o ramo da seleção devolvia a zona 90 linhas antes.
  // A zona candidata perdia a posição e caía no FLUXO do flexbox: o tabuleiro
  // se desmontava no exato momento em que se pede para clicar nele.
  //
  // Ficou invisível por muito tempo porque o quadro de seleção era um modal
  // com vidro por cima — a mesa se desmontava atrás dele. Este teste existe
  // porque o próximo `return` cedo esqueceria a linha do mesmo jeito, e o
  // sintoma não é erro nenhum: é a mesa mudando de forma.
  const i = duel.indexOf('function zoneEl(');
  assert.ok(i > 0, 'zoneEl sumiu do duel.html');
  const corpo = duel.slice(i, duel.indexOf('\nfunction ', i + 20));
  // A própria `pronta()` é a única que pode devolver `z` — ela É a saída.
  const semPronta = corpo.replace(/const pronta = .*\n/, '');
  assert.ok(!/\breturn z;/.test(semPronta),
    'zoneEl voltou a devolver a zona sem posicioná-la (use `return pronta()`)');
  assert.ok((corpo.match(/return pronta\(\)/g) || []).length >= 2,
    'as saídas de zoneEl têm de passar pela `pronta()`');
  // Uma chamada só, dentro da `pronta()`: duas se desencontram no primeiro
  // `return` novo, que é exatamente como isto começou.
  assert.equal((corpo.match(/applyZonePosition\(/g) || []).length, 1);

  // E a varredura RECONHECE o caso ruim — senão "nenhum culpado" não provaria
  // nada. Este é, literalmente, o código que estava no jogo.
  const ruim = `function zoneEl(a) {\n  if (sel) { return z; }\n  applyZonePosition(z, x);\n  return z;\n}`;
  assert.ok(/\breturn z;/.test(ruim.replace(/const pronta = .*\n/, '')));
});

teste('a barra não diz mais "aguarde…" durante uma escolha', () => {
  // Com o quadro modal isso não custava nada — ele explicava tudo e não havia
  // mais o que fazer. Com a escolha na MESA, o tabuleiro é a interface, e o
  // jogo pedir uma resposta enquanto anuncia que está esperando outra coisa foi
  // a segunda metade do duelo que travou.
  assert.match(duel, /suaSelecao \? 'Sua vez: escolha a\(s\) carta\(s\) destacada\(s\)\.'/);
  assert.match(duel, /const suaSelecao = !!selectionQuestion\(\)/);
});

console.log(`\n${n} testes ok`);
