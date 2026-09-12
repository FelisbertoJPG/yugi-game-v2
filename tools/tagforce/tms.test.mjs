/**
 * Testes do decodificador de TGMS.
 *
 * **Não dependem do ISO**, de propósito: o jogo da Konami não está no
 * repositório e não vai estar, então um teste que precisasse dele só rodaria
 * nesta máquina — e teste que não roda deixa de ser teste. Aqui o TGMS é
 * MONTADO em memória, o que tem um segundo efeito bom: o construtor abaixo é a
 * documentação executável do formato.
 *
 * O que se prova é o que erra CALADO: uma malha lida errado **desenha alguma
 * coisa**, e alguma coisa na tela é indistinguível de acerto. Por isso o
 * `lerTgms` recusa em vez de devolver "mais ou menos", e por isso cada recusa
 * tem aqui o par que a dispara.
 *
 *   node tools/tagforce/tms.test.mjs
 */
import assert from 'node:assert';
import { lerTgms, soldar, STRIDE_MAPA, TRIANGULOS, TIRA } from './tms.mjs';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

/**
 * Monta um TGMS de mentira. `vertices` são posições em espaço de MODELO; a
 * matriz e a caixa saem daí, que é o que o arquivo de verdade faz.
 */
function montarTgms({ vertices, tipo = TRIANGULOS, objetos = null, caixaErrada = null,
                      nomeTextura = 'chao.tga', semTextura = false }) {
  const n = vertices.length;
  const eixos = [0, 1, 2].map((e) => vertices.map((v) => v[e]));
  const min = eixos.map((a) => Math.min(...a));
  const max = eixos.map((a) => Math.max(...a));
  // a normalização do PSP: escala = metade da maior aresta, translação = centro
  const esc = [0, 1, 2].map((e) => Math.max((max[e] - min[e]) / 2, 1e-6));
  const tra = [0, 1, 2].map((e) => (max[e] + min[e]) / 2);

  const CAB = 0x60, TABELA = 12;               // 1 chamada
  const INI = CAB + TABELA;
  const bloco = n * STRIDE_MAPA;
  const FIM = INI + bloco;
  const S1 = FIM;                               // 1 material de 164 B
  const S2 = S1 + 164;                          // 1 textura de 40 B
  const S3 = S2 + 40;                           // 4 + 24 por objeto
  const listaObj = objetos ?? [{ n: 1, primeira: 0 }];
  const MAT = S3 + 4 + 24 * listaObj.length;
  const NOM = MAT + 64;
  const nomeBuf = Buffer.from(nomeTextura + '\0', 'latin1');
  const b = Buffer.alloc(NOM + nomeBuf.length);

  b.write('TGMS', 0, 'latin1');
  b.writeUInt32LE(CAB, 0x04);
  b.writeUInt32LE(INI, 0x08); b.writeUInt32LE(FIM, 0x0c);
  b.writeUInt32LE(S2, 0x10);  b.writeUInt32LE(S3, 0x14);
  b.writeUInt32LE(MAT, 0x20); b.writeUInt32LE(NOM, 0x24);
  b.writeUInt32LE(1, 0x28);   b.writeUInt32LE(1, 0x34);
  const cx = caixaErrada ?? { min, max };
  [0, 1, 2].forEach((e) => { b.writeFloatLE(cx.min[e], 0x44 + e * 4); b.writeFloatLE(cx.max[e], 0x50 + e * 4); });

  b.writeUInt32LE(tipo, CAB); b.writeUInt32LE(n, CAB + 4); b.writeUInt32LE(INI, CAB + 8);

  vertices.forEach((v, i) => {
    const p = INI + i * STRIDE_MAPA;
    b.writeFloatLE(i / n, p); b.writeFloatLE(1 - i / n, p + 4);   // UV
    b.writeUInt32LE(0xffffffff, p + 8);                            // cor
    b.writeInt16LE(0, p + 12); b.writeInt16LE(32767, p + 14); b.writeInt16LE(0, p + 16); // normal +Y
    [0, 1, 2].forEach((e) => b.writeInt16LE(Math.round(((v[e] - tra[e]) / esc[e]) * 32767), p + 18 + e * 2));
  });

  b.writeUInt16LE(1, S1 + 156);                        // material valendo
  b.writeUInt16LE(0, S1 + 158);                        // ... do objeto 0
  b.writeInt32LE(semTextura ? -1 : 0, S1 + 28);        // ... com a textura 0
  b.writeUInt32LE(0, S2);                              // textura 0 -> nome no offset 0
  listaObj.forEach((o, i) => {
    b.writeUInt16LE(o.n, S3 + 4 + i * 24 + 16);
    b.writeUInt16LE(o.primeira, S3 + 4 + i * 24 + 18);
  });
  [0, 1, 2].forEach((e) => { b.writeFloatLE(esc[e], MAT + e * 5 * 4); b.writeFloatLE(tra[e], MAT + 48 + e * 4); });
  b.writeFloatLE(1, MAT + 60);
  nomeBuf.copy(b, NOM);
  return b;
}

const QUADRADO = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, -1], [1, 0, 1], [-1, 0, 1]];

console.log('\nTGMS — o decodificador\n');

teste('lê um quadrado de dois triângulos e a caixa fecha', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO }));
  assert.ok(r.ok, r.motivo);
  assert.equal(r.triangulos, 2);
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].pos.length, 6 * 3);
  assert.ok(r.erro < 1e-3, 'erro contra a caixa: ' + r.erro);
});

teste('a posição volta ao lugar depois da matriz', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO }));
  const xs = [], zs = [];
  for (let i = 0; i < r.grupos[0].pos.length; i += 3) { xs.push(r.grupos[0].pos[i]); zs.push(r.grupos[0].pos[i + 2]); }
  assert.ok(Math.abs(Math.min(...xs) - (-1)) < 1e-3);
  assert.ok(Math.abs(Math.max(...zs) - 1) < 1e-3);
});

teste('a tira vira triângulos e alterna a ordem', () => {
  // 5 vértices em tira = 3 triângulos
  const tira = [[-1, 0, -1], [1, 0, -1], [-1, 0, 0], [1, 0, 0], [-1, 0, 1]];
  const r = lerTgms(montarTgms({ vertices: tira, tipo: TIRA }));
  assert.ok(r.ok, r.motivo);
  assert.equal(r.triangulos, 3);
  // o segundo triângulo nasce invertido; sem isso metade some no culling
  const p = r.grupos[0].pos;
  const t1 = [p.slice(3, 6), p.slice(6, 9)];   // 2º vértice do 1º triângulo
  assert.notDeepStrictEqual(t1[0], t1[1]);
});

teste('o UV é invertido no V (o PSP conta de cima, o three de baixo)', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO }));
  // o vértice 0 foi gravado com v = 1 - 0/6 = 1, então volta como 1 - 1 = 0
  assert.ok(Math.abs(r.grupos[0].uv[1] - 0) < 1e-5);
});

teste('material sem textura vira grupo sem textura', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO, semTextura: true }));
  assert.ok(r.ok, r.motivo);
  assert.equal(r.grupos[0].textura, null);
});

teste('o nome da textura sai do blob', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO, nomeTextura: 'pg_01_01_ground01.tga' }));
  assert.equal(r.grupos[0].textura, 'pg_01_01_ground01.tga');
});

// ---- os casos RUINS. Sem eles, "passou" não prova nada ----

teste('RECUSA quando a caixa do header não fecha com os vértices', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO, caixaErrada: { min: [-9, -9, -9], max: [9, 9, 9] } }));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /caixa nao fecha/);
});

teste('RECUSA quando duas faixas de objeto pegam a mesma chamada', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO, objetos: [{ n: 1, primeira: 0 }, { n: 1, primeira: 0 }] }));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /mesma chamada/);
});

teste('RECUSA quando as faixas de objeto não cobrem todas as chamadas', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO, objetos: [] }));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /cobrem 0 de 1/);
});

teste('RECUSA quem não é TGMS', () => {
  const r = lerTgms(Buffer.alloc(0x80));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /nao e TGMS/);
});

// ---- as PEÇAS e o filtro que as deixa leves ----

teste('cada objeto vira uma peça, recentrada na BASE', () => {
  // um objeto longe da origem: a peça tem de vir centrada, senão nasceria a
  // vinte metros de onde foi solta no editor
  const longe = QUADRADO.map((v) => [v[0] + 20, v[1] + 5, v[2] - 8]);
  const r = lerTgms(montarTgms({ vertices: longe }));
  assert.ok(r.ok, r.motivo);
  assert.equal(r.pecas.length, 1);
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < r.pecas[0].pos.length; i += 3) {
    xs.push(r.pecas[0].pos[i]); ys.push(r.pecas[0].pos[i + 1]); zs.push(r.pecas[0].pos[i + 2]);
  }
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 1e-3, 'X tem de ficar centrado');
  assert.ok(Math.abs((Math.min(...zs) + Math.max(...zs)) / 2) < 1e-3, 'Z tem de ficar centrado');
  assert.ok(Math.abs(Math.min(...ys)) < 1e-3, 'o PISO da peca tem de ficar em y=0');
});

teste('a peça leva a dimensão e a textura do objeto', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO, nomeTextura: 'madeira.tga' }));
  assert.equal(r.pecas[0].textura, 'madeira.tga');
  assert.deepEqual(r.pecas[0].dim.map((v) => Math.round(v)), [2, 0, 2]);
  assert.equal(r.pecas[0].triangulos, 2);
});

teste('dois objetos dão duas peças (é a biblioteca do editor)', () => {
  // 6 vértices em duas chamadas de 3 seria outro arranjo; aqui basta provar
  // que a lista de peças acompanha a de objetos
  const r = lerTgms(montarTgms({ vertices: QUADRADO }));
  assert.equal(r.pecas.length, r.objetos);
});

/**
 * Um quadrado como a malha REAL vem: dois triângulos que dividem dois cantos,
 * com o mesmo UV e a mesma normal nos vértices repetidos. É essa repetição que
 * a solda existe para tirar — e ela é a regra no material do jogo, onde a
 * leitura expande TRIANGLE_STRIP e cada vértice interno aparece de três a seis
 * vezes. (O `QUADRADO` das outras asserções dá UV diferente a cada vértice, de
 * propósito, para o teste do UV — ali não há nada a soldar.)
 */
const QUADRADO_REAL = {
  pos: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1],
  nor: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  uv: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
};

teste('SOLDAR junta o vértice repetido e devolve malha indexada', () => {
  const s = soldar(QUADRADO_REAL);
  // seis vértices soltos, quatro cantos de verdade
  assert.equal(s.antes, 6);
  assert.equal(s.depois, 4, `soldou ${s.antes} -> ${s.depois}`);
  assert.equal(s.idx.length, 6, 'os dois triangulos continuam la');
  assert.equal(s.pos.length / 3, s.depois);
  assert.equal(s.nor.length, s.pos.length);
  assert.equal(s.uv.length / 2, s.depois);
});

teste('NÃO solda o que só parece igual: mesma posição, UV diferente', () => {
  // dois lados de uma quina com texturas diferentes compartilham a posição e
  // NÃO podem virar um vértice só — a costura da textura apareceria na tela
  const p = {
    pos: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    nor: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    uv: [0, 0, 1, 0, 0, 1, 0.5, 0.5, 1, 0, 0, 1],   // o vértice 0 e o 3 diferem no UV
  };
  const s = soldar(p);
  assert.equal(s.depois, 5, 'esperava 5 vertices distintos, veio ' + s.depois);
});

teste('a solda não muda a FORMA (todo índice aponta um vértice que existia)', () => {
  const r = lerTgms(montarTgms({ vertices: QUADRADO }));
  const p = r.pecas[0], s = soldar(p);
  const tinha = new Set();
  for (let i = 0; i < p.pos.length; i += 3)
    tinha.add([p.pos[i], p.pos[i + 1], p.pos[i + 2]].map((v) => v.toFixed(3)).join(','));
  for (const i of s.idx) {
    const k = [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]].map((v) => v.toFixed(3)).join(',');
    assert.ok(tinha.has(k), 'a solda inventou o vertice ' + k);
  }
});

teste('SOLDAR joga fora o triângulo degenerado (a tira vira a esquina com ele)', () => {
  const p = { pos: [0, 0, 0, 1, 0, 0, 1, 0, 0], nor: [0, 1, 0, 0, 1, 0, 0, 1, 0], uv: [0, 0, 0, 0, 0, 0] };
  const s = soldar(p);
  assert.equal(s.degenerados, 1);
  assert.equal(s.idx.length, 0, 'triangulo sem area nao pode sobrar');
});

teste('a tolerância é frouxa o bastante para o arredondamento de 16 bits', () => {
  // um mapa de verdade erra ~4e-4 por causa do int16; a tolerância é 1e-2
  const r = lerTgms(montarTgms({ vertices: QUADRADO.map((v) => v.map((x) => x * 100)) }));
  assert.ok(r.ok, r.motivo);
  assert.ok(r.erro < 1e-2);
});

console.log('\n' + passou + ' testes passaram\n');
