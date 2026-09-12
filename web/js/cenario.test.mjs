/**
 * Testes do CENÁRIO — a construção modelada dentro do Mundo.
 *
 * As três decisões daqui erram CALADAS, e é por isso que cada uma tem par:
 *
 * - **validar**: um pacote torto não dá erro, ele DESENHA — meia malha na tela
 *   passa por malha inteira. Por isso a recusa é com motivo, e cada motivo tem
 *   o caso que o dispara.
 * - **assentar**: errar o `y` põe o cenário enterrado ou flutuando, e o jogo
 *   roda igual.
 * - **colidir**: faixa de altura errada transforma o CHÃO em parede (não se
 *   entra em lugar nenhum) ou o telhado (idem); raio menor que a meia-diagonal
 *   abre furo e se atravessa a parede na diagonal. Nenhum dos dois acusa.
 *
 *   node web/js/cenario.test.mjs
 */
import assert from 'node:assert';
import {
  validarPacote, assentar, colisoresDoCenario, carregarCenario,
  nomeDoCenario, caminhoDoCenario, CELULA, FAIXA, CENARIO_PADRAO, SEM_CENARIO,
} from './cenario.js';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};
const testeAsync = async (nome, fn) => {
  try { await fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

/** Um triângulo com posição, normal e UV coerentes. */
function tri(pontos, normal = [0, 1, 0]) {
  const pos = [], nor = [], uv = [];
  for (const p of pontos) { pos.push(...p); nor.push(...normal); uv.push(0, 0); }
  return { pos, nor, uv };
}
function pacoteDe(grupos) {
  const todos = grupos.flatMap((g) => g.pos);
  const min = [0, 1, 2].map((e) => Math.min(...todos.filter((_, i) => i % 3 === e)));
  const max = [0, 1, 2].map((e) => Math.max(...todos.filter((_, i) => i % 3 === e)));
  return { caixa: { min, max }, grupos };
}

// chão: normal para cima, na altura 0
const CHAO = tri([[-2, 0, -2], [2, 0, -2], [2, 0, 2]]);
// parede: normal para o lado, de y=0 a y=3
const PAREDE = tri([[-2, 0, 0], [2, 0, 0], [2, 3, 0]], [0, 0, 1]);

console.log('\nCENÁRIO — a construção modelada no Mundo\n');

// ---------------------------------------------------------------- validar
teste('aceita um pacote coerente', () => {
  const v = validarPacote(pacoteDe([CHAO, PAREDE]));
  assert.ok(v.ok, v.motivo);
  assert.equal(v.triangulos, 2);
  assert.equal(v.grupos, 2);
});

teste('RECUSA grupo que não fecha em triângulos', () => {
  const g = { pos: [0, 0, 0, 1, 0, 0], nor: [0, 1, 0, 0, 1, 0], uv: [0, 0, 0, 0] };
  const v = validarPacote({ caixa: { min: [0, 0, 0], max: [1, 0, 0] }, grupos: [g] });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /nao fecha em triangulos/);
});

teste('RECUSA normal que não acompanha a posição', () => {
  const g = { ...tri([[0, 0, 0], [1, 0, 0], [1, 0, 1]]) };
  g.nor = g.nor.slice(0, 6);
  const v = validarPacote(pacoteDe([g]));
  assert.equal(v.ok, false);
  assert.match(v.motivo, /normal nao acompanha/);
});

teste('RECUSA UV que não acompanha a posição', () => {
  const g = { ...tri([[0, 0, 0], [1, 0, 0], [1, 0, 1]]) };
  g.uv = [0, 0];
  const v = validarPacote(pacoteDe([g]));
  assert.equal(v.ok, false);
  assert.match(v.motivo, /UV nao acompanha/);
});

teste('RECUSA vértice fora da caixa declarada (o cenário nasceria fora do lugar)', () => {
  const p = pacoteDe([CHAO]);
  p.caixa.max[1] = -5;                       // caixa herdada de outro arquivo
  const v = validarPacote(p);
  assert.equal(v.ok, false);
  assert.match(v.motivo, /fora da caixa/);
});

teste('RECUSA NaN na posição', () => {
  const g = { ...tri([[0, 0, 0], [1, 0, 0], [1, 0, 1]]) };
  const p = pacoteDe([g]);
  p.grupos[0].pos[0] = NaN;
  const v = validarPacote(p);
  assert.equal(v.ok, false);
  assert.match(v.motivo, /NaN|fora da caixa/);
});

teste('RECUSA pacote vazio e pacote que não é objeto', () => {
  assert.equal(validarPacote(null).ok, false);
  assert.equal(validarPacote({ grupos: [] }).ok, false);
});

// ---------------------------------------------------------------- assentar
teste('assenta o PISO no chão do destino', () => {
  const p = pacoteDe([CHAO, PAREDE]);          // piso em y = 0
  const off = assentar(p, { x: 10, z: -4, chao: 2.5 });
  assert.ok(Math.abs(off.y - 2.5) < 1e-9, 'o piso tem de subir ate o chao');
});

teste('assentar CENTRALIZA em x e z (o cenário não nasce na origem dele)', () => {
  const p = pacoteDe([tri([[10, 0, 10], [14, 0, 10], [14, 0, 14]])]);
  const off = assentar(p, { x: 0, z: 0, chao: 0 });
  assert.ok(Math.abs(off.x + 12) < 1e-9);
  assert.ok(Math.abs(off.z + 12) < 1e-9);
});

teste('cenário modelado abaixo de zero também sobe (o par do de cima)', () => {
  const p = pacoteDe([tri([[-1, -8, -1], [1, -8, -1], [1, -5, 1]], [0, 0, 1])]);
  const off = assentar(p, { chao: 0 });
  assert.ok(Math.abs(off.y - 8) < 1e-9);
});

// ---------------------------------------------------------------- colidir
teste('a parede vira colisores', () => {
  const p = pacoteDe([CHAO, PAREDE]);
  const cs = colisoresDoCenario(p, { x: 0, y: 0, z: 0 });
  assert.ok(cs.length > 0, 'a parede tem de barrar');
  assert.ok(cs.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && c.r > 0));
});

teste('o CHÃO não vira parede (senão não se entra em lugar nenhum)', () => {
  const cs = colisoresDoCenario(pacoteDe([CHAO]), { x: 0, y: 0, z: 0 });
  assert.equal(cs.length, 0);
});

teste('o TELHADO não vira parede (está acima da cabeça)', () => {
  // parede de verdade, mas toda ela acima da faixa de quem anda
  const alto = tri([[-2, 6, 0], [2, 6, 0], [2, 9, 0]], [0, 0, 1]);
  const cs = colisoresDoCenario(pacoteDe([alto]), { x: 0, y: 0, z: 0 });
  assert.equal(cs.length, 0);
});

teste('o offset entra na colisão (parede desenhada num lugar, bloqueio no mesmo)', () => {
  const p = pacoteDe([PAREDE]);
  const a = colisoresDoCenario(p, { x: 0, y: 0, z: 0 });
  const b = colisoresDoCenario(p, { x: 50, y: 0, z: 0 });
  // a contagem pode variar em um: 50 nao e' multiplo da celula, entao a grade
  // cai em outro alinhamento. O que tem de valer e' o bloqueio ANDAR JUNTO com
  // o desenho — se ficasse para tras, a parede estaria num lugar e o bloqueio
  // no outro, e o jogador atravessaria a casa parando no nada ao lado dela.
  assert.ok(Math.abs(a.length - b.length) <= 1, `contagem mudou demais: ${a.length} -> ${b.length}`);
  const meio = (cs) => cs.reduce((s, c) => s + c.x, 0) / cs.length;
  assert.ok(Math.abs((meio(b) - meio(a)) - 50) < CELULA, 'os circulos tem de andar junto');
});

teste('o raio é a meia-diagonal da célula (menos que isso deixa passar na diagonal)', () => {
  const cs = colisoresDoCenario(pacoteDe([PAREDE]), { x: 0, y: 0, z: 0 });
  const esperado = (CELULA * Math.SQRT2) / 2;
  assert.ok(Math.abs(cs[0].r - esperado) < 1e-9);
  assert.ok(cs[0].r >= CELULA / 2, 'nunca menor que a meia-celula');
});

teste('uma parede longa não vira um colisor por triângulo', () => {
  // 40 triângulos empilhados no MESMO lugar: a grade tem de colapsá-los
  const muitos = [];
  for (let i = 0; i < 40; i++) muitos.push(tri([[-0.1, 0.5, 0], [0.1, 0.5, 0], [0, 1.5, 0]], [0, 0, 1]));
  const cs = colisoresDoCenario(pacoteDe(muitos), { x: 0, y: 0, z: 0 });
  assert.ok(cs.length <= 4, 'esperava a grade colapsar, veio ' + cs.length);
});

teste('a faixa de altura é usada de verdade (par controle do telhado)', () => {
  const alto = tri([[-2, 6, 0], [2, 6, 0], [2, 9, 0]], [0, 0, 1]);
  const cs = colisoresDoCenario(pacoteDe([alto]), { x: 0, y: 0, z: 0 }, { faixa: { de: 0, ate: 99 } });
  assert.ok(cs.length > 0, 'com a faixa aberta, a mesma parede TEM de barrar');
});

// ---------------------------------------------------------------- carregar
teste('DESLIGADO por padrão — sem chave nenhuma, a floresta de sempre', () => {
  // Ele já nasceu ligado (07/09/2026 reverteu isso): o Mundo é a floresta que
  // funciona, e o cenário entra por escolha de quem o está desenvolvendo.
  assert.equal(CENARIO_PADRAO, null, 'o padrao tem de ser NULL, nao um nome');
  assert.equal(nomeDoCenario(null), null);
  assert.equal(nomeDoCenario({ getItem: () => null }), null);
});

teste('desligado não paga nem o 404 (responde antes de qualquer requisição)', async () => {
  let bateu = false;
  const r = await carregarCenario({ nome: nomeDoCenario(null), buscar: async () => { bateu = true; } });
  assert.equal(r, null);
  assert.equal(bateu, false, 'com o cenario desligado nao pode haver requisicao');
});

teste('armazém que LEVANTA não derruba o boot', () => {
  // navegador com dados de site bloqueados: `getItem` lança
  assert.equal(nomeDoCenario({ getItem() { throw new Error('bloqueado'); } }), CENARIO_PADRAO);
});

teste('a chave LIGA um cenário — é assim que se desenvolve um', () => {
  assert.equal(nomeDoCenario({ getItem: () => 'dormitorio' }), 'dormitorio');
  assert.equal(nomeDoCenario({ getItem: () => 'arena' }), 'arena');
  assert.equal(nomeDoCenario({ getItem: () => SEM_CENARIO }), null);
  assert.equal(nomeDoCenario({ getItem: () => '' }), CENARIO_PADRAO);
});

teste('nome torto não vira caminho (ele entra numa URL)', () => {
  assert.equal(nomeDoCenario({ getItem: () => '../../etc/senha' }), null);
  assert.equal(nomeDoCenario({ getItem: () => 'MAIÚSCULO' }), null);
  assert.equal(nomeDoCenario({ getItem: () => 'a'.repeat(80) }), null);
});

teste('o caminho vai para web/cenarios/, que VIAJA no game.zip', () => {
  assert.equal(caminhoDoCenario('dormitorio'), '/web/cenarios/dormitorio.json');
});

await testeAsync('sem nome, não busca nada (faltar é normal)', async () => {
  let chamou = false;
  const r = await carregarCenario({ nome: null, buscar: async () => { chamou = true; } });
  assert.equal(r, null);
  assert.equal(chamou, false);
});

await testeAsync('404 devolve null, não erro (o caso comum)', async () => {
  const r = await carregarCenario({ nome: 'x', buscar: async () => ({ ok: false }) });
  assert.equal(r, null);
});

await testeAsync('rede que levanta devolve null e não derruba o boot', async () => {
  const r = await carregarCenario({ nome: 'x', buscar: async () => { throw new Error('offline'); } });
  assert.equal(r, null);
});

await testeAsync('pacote presente e TORTO devolve erro (faltou e ninguém viu é pior)', async () => {
  const r = await carregarCenario({
    nome: 'x',
    buscar: async () => ({ ok: true, json: async () => ({ grupos: [] }) }),
  });
  assert.ok(r && r.erro, 'esperava erro, veio ' + JSON.stringify(r));
});

await testeAsync('pacote bom volta validado', async () => {
  const p = pacoteDe([CHAO, PAREDE]);
  const r = await carregarCenario({ nome: 'x', buscar: async () => ({ ok: true, json: async () => p }) });
  assert.ok(r && r.pacote, r && r.erro);
  assert.equal(r.triangulos, 2);
});

console.log('\n' + passou + ' testes passaram\n');
