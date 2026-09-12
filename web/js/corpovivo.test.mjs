/**
 * Testes de `corpovivo.js` — achar os ossos de um humanoide qualquer.
 *
 * O que erra calado aqui: **girar o osso errado não dá erro**. Se o
 * `leftUpperArm` cair na perna, o personagem anda chutando com o braço, e nada
 * no console diz nada. Por isso o mapa vem, em ordem, da extensão VRM (verdade
 * declarada pelo exportador) e só depois dos nomes.
 *
 * Conferido contra um VRM de verdade (VRoid): os sete ossos, com nomes
 * `J_Bip_C_Hips`, `J_Bip_L_UpperArm`… — nenhum deles parecido com os nossos.
 *
 *   node web/js/corpovivo.test.mjs
 */
import assert from 'node:assert/strict';
import {
  OSSO_DA_JUNTA, NOMES, normalizarNome, ossosDoVrm, ossosPorNome,
  acharOssos, frenteDoModelo, poseDeRepouso, ehVrm,
} from './corpovivo.js';

let pass = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); process.exitCode = 1; }
};

console.log('\n  ---- achar os ossos de um humanoide ----\n');

/** Um VRM 0.x: `humanBones` é um ARRAY de `{ bone, node }`. */
const vrm0 = () => ({
  extensions: { VRM: { humanoid: { humanBones: [
    { bone: 'hips', node: 0 }, { bone: 'spine', node: 1 }, { bone: 'head', node: 2 },
    { bone: 'leftUpperArm', node: 3 }, { bone: 'rightUpperArm', node: 4 },
    { bone: 'leftUpperLeg', node: 5 }, { bone: 'rightUpperLeg', node: 6 },
  ] } } },
  nodes: [
    { name: 'J_Bip_C_Hips' }, { name: 'J_Bip_C_Spine' }, { name: 'J_Bip_C_Head' },
    { name: 'J_Bip_L_UpperArm' }, { name: 'J_Bip_R_UpperArm' },
    { name: 'J_Bip_L_UpperLeg' }, { name: 'J_Bip_R_UpperLeg' },
  ],
});

/** Um VRM 1.0: `humanBones` é um OBJETO `{ hips: { node } }`. */
const vrm1 = () => ({
  extensions: { VRMC_vrm: { humanoid: { humanBones: {
    hips: { node: 0 }, spine: { node: 1 }, head: { node: 2 },
    leftUpperArm: { node: 3 }, rightUpperArm: { node: 4 },
    leftUpperLeg: { node: 5 }, rightUpperLeg: { node: 6 },
  } } } },
  nodes: vrm0().nodes,
});

t('as sete juntas do boneco tem um osso humanoide cada', () => {
  // uma junta sem osso nao anima, e ninguem ve: o membro fica parado enquanto
  // o resto do corpo caminha
  assert.deepEqual(Object.keys(OSSO_DA_JUNTA).sort(),
    ['bracoD', 'bracoE', 'cabeca', 'pernaD', 'pernaE', 'raiz', 'tronco']);
  for (const osso of Object.values(OSSO_DA_JUNTA)) {
    assert.ok(NOMES[osso]?.length, `${osso} nao tem nome de fallback`);
  }
});

t('VRM 0.x (array) e VRM 1.0 (objeto) dao o MESMO mapa', () => {
  // ler so um dos dois deixa metade dos arquivos cair no caminho dos nomes,
  // sem ninguem saber por que
  const a = ossosDoVrm(vrm0());
  const b = ossosDoVrm(vrm1());
  assert.deepEqual(a, b);
  assert.equal(a.bracoE, 'J_Bip_L_UpperArm');
  assert.equal(a.pernaD, 'J_Bip_R_UpperLeg');
  assert.equal(Object.keys(a).length, 7);
});

t('sem extensao VRM devolve null, e nao um mapa vazio', () => {
  // "nao e VRM" e "e VRM e nao achei nada" pedem respostas diferentes de quem
  // chama; um objeto vazio confunde os dois
  assert.equal(ossosDoVrm({ nodes: [{ name: 'x' }] }), null);
  assert.equal(ossosDoVrm(null), null);
  assert.equal(ossosDoVrm({ extensions: { VRM: {} } }), null);
});

t('os nomes do MIXAMO sao reconhecidos', () => {
  // e o formato que sai do Mixamo, e o prefixo `mixamorig:` nao pode reprovar
  const m = ossosPorNome([
    'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head',
    'mixamorig:LeftArm', 'mixamorig:RightArm',
    'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg',
  ]);
  assert.equal(Object.keys(m).length, 7, JSON.stringify(m));
  assert.equal(m.bracoE, 'mixamorig:LeftArm');
  assert.equal(m.pernaD, 'mixamorig:RightUpLeg');
});

t('o separador nao decide nada: Left_Arm, LeftArm e left arm sao o mesmo', () => {
  // exigir a grafia exata reprovaria pacotes identicos por causa de um sublinhado
  for (const n of ['LeftArm', 'Left_Arm', 'left arm', 'LEFT.ARM', 'mixamorig:LeftArm']) {
    assert.equal(normalizarNome(n), 'leftarm', n);
  }
});

t('nome que nao e osso nenhum simplesmente nao entra', () => {
  const m = ossosPorNome(['Object_17', 'Cube.001', 'Sketchfab_model']);
  assert.deepEqual(m, {});
});

t('o VRM VENCE os nomes — ele e verdade declarada, nao adivinhacao', () => {
  // se o arquivo diz qual no e o braco esquerdo, nenhum palpite por nome pode
  // passar na frente: e' assim que o braco vira perna sem ninguem ver
  const g = vrm0();
  g.nodes.push({ name: 'LeftArm' });          // um isca com nome "certo"
  const m = acharOssos(g, g.nodes.map((n) => n.name));
  assert.equal(m.bracoE, 'J_Bip_L_UpperArm', 'o palpite venceu o mapa declarado');
});

t('sem VRM, acharOssos cai nos nomes', () => {
  const m = acharOssos({ nodes: [] }, ['Hips', 'Spine', 'Head', 'LeftArm', 'RightArm',
    'LeftUpLeg', 'RightUpLeg']);
  assert.equal(Object.keys(m).length, 7);
});

t('osso faltando NAO invalida o resto', () => {
  // nem todo rig tem `spine`; desistir por causa de um osso devolveria o corpo
  // ao corte seco do fatiamento, que e' o que se veio evitar
  const m = ossosPorNome(['Hips', 'Head', 'LeftArm', 'RightArm']);
  assert.equal(m.tronco, undefined);
  assert.equal(m.cabeca, 'Head');
  assert.ok(Object.keys(m).length >= 3);
});

/** Uma cena de mentira com pe e dedo: `dz` diz para onde o corpo olha. */
function cenaComPe(dz, nomes = ['J_Bip_L_Foot', 'J_Bip_L_ToeBase']) {
  const no = (name, z) => ({
    name, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1] },
  });
  const filhos = [no(nomes[0], 0), no(nomes[1], dz)];
  return { traverse: (f) => filhos.forEach(f), updateMatrixWorld: () => {} };
}

t('a FRENTE e medida no pe, e nao deduzida do formato', () => {
  // O bug: eu li na especificacao que o VRM encara -Z e devolvia -1 para todo
  // VRM. O modelo entrou virado e o relato foi "esta se movimentando de tras
  // pra frente" — ele andava de costas, com a caminhada certa. Nada da erro; um
  // personagem de costas parece defeito de camera, de modelo ou de animacao.
  // Qualquer coisa menos uma constante trocada.
  //
  // Medido no VRM de verdade: o dedo do pe fica em dz=+0,137 do calcanhar, ou
  // seja +Z — o MESMO lado do nosso boneco. Nao se vira nada.
  assert.equal(frenteDoModelo(vrm0(), cenaComPe(+0.137)), 1, 'virou um modelo que ja olhava para +Z');
  assert.equal(frenteDoModelo(vrm0(), cenaComPe(-0.137)), -1, 'nao virou um que olha para -Z');
});

t('o PREFIXO do rig nao pode reprovar a medida', () => {
  // `J_Bip_L_Foot` (VRoid) e `mixamorig:LeftFoot` (Mixamo). Ancorar o regex no
  // comeco do nome reprovava o VRoid inteiro — e o efeito foi PIOR que reprovar:
  // a funcao caia no `return 1` do fim e o modelo real funcionava pelo motivo
  // errado, sem ninguem saber que a medida nunca tinha rodado.
  for (const par of [
    ['J_Bip_L_Foot', 'J_Bip_L_ToeBase'],
    ['mixamorig:LeftFoot', 'mixamorig:LeftToeBase'],
    ['LeftFoot', 'LeftToe'],
    ['Armature_L_foot', 'Armature_L_toe_base'],
  ]) {
    assert.equal(frenteDoModelo(null, cenaComPe(-0.1, par)), -1, par.join(' / '));
    assert.equal(frenteDoModelo(null, cenaComPe(+0.1, par)), 1, par.join(' / '));
  }
});

t('TOE nao e confundido com FOOT — "LeftToeBase" contem as duas palavras', () => {
  // procurando `foot` primeiro, o dedo viraria o pe e `dz` daria zero: a
  // funcao devolveria +1 sempre, sem medir nada
  assert.equal(frenteDoModelo(null, cenaComPe(-0.1, ['LeftFoot', 'LeftToeBase'])), -1);
});

t('sem pe e dedo, NAO vira — errar virando e' + " pior que errar parado", () => {
  // um personagem de frente com o modelo torto ainda e jogavel; de costas nao
  assert.equal(frenteDoModelo(vrm0(), cenaComPe(0.1, ['Cube', 'Sphere'])), 1);
  assert.equal(frenteDoModelo(vrm0(), null), 1);
  assert.equal(frenteDoModelo(null, null), 1);
});

t('pe e dedo no mesmo Z nao decidem nada — devolve +1 em vez de chutar', () => {
  assert.equal(frenteDoModelo(vrm0(), cenaComPe(0)), 1);
});

t('ehVrm separa o formato da frente — sao perguntas diferentes', () => {
  // enquanto a frente era deduzida do formato, as duas eram a mesma pergunta.
  // A pose de repouso depende de SER VRM (a pose de bind dele e T); a
  // meia-volta depende de para ONDE ele olha, que agora se mede.
  assert.equal(ehVrm(vrm0()), true);
  assert.equal(ehVrm(vrm1()), true);
  assert.equal(ehVrm({ nodes: [] }), false);
  assert.equal(ehVrm(null), false);
});

t('a pose de repouso BAIXA os dois bracos, cada um para o seu lado', () => {
  // Com o mesmo sinal os dois vao para o mesmo lado: um desce e o outro sobe
  // por cima da cabeca. Nao da erro — o personagem so fica fazendo continencia.
  // Medido no modelo: os dois a 74 graus abaixo da horizontal, e a envergadura
  // das maos caindo de 1,20 m (pose de T) para 0,53 m.
  const r = poseDeRepouso(true);
  assert.equal(r.bracoE.eixo, 'z');
  assert.equal(r.bracoD.eixo, 'z');
  assert.ok(r.bracoE.valor * r.bracoD.valor < 0, 'os dois bracos giram para o MESMO lado');
  assert.ok(Math.abs(r.bracoE.valor) > 1 && Math.abs(r.bracoE.valor) < 1.6,
    'fora do plausivel: ' + r.bracoE.valor);
});

t('so o VRM leva a pose de repouso — um glTF comum ja vem posado', () => {
  // baixar bracos que ja estao baixos os enfia dentro do corpo
  assert.deepEqual(poseDeRepouso(false), {});
});

t('a pose de repouso nao mexe em perna nem tronco', () => {
  // a pose de T so abre os BRACOS; girar a perna desmontaria o modelo
  assert.deepEqual(Object.keys(poseDeRepouso(true)).sort(), ['bracoD', 'bracoE']);
});

console.log(`\n  ${pass} passaram\n`);
