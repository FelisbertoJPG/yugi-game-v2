/**
 * Testes de `animacao.js` — religar um clipe a um esqueleto que não é o dele.
 *
 * O defeito que tudo aqui existe para evitar: tocar um clipe do Mixamo num
 * corpo do VRoid **não dá erro**. O `AnimationMixer` procura os nós pelos nomes
 * das pistas, não acha nenhum, e o personagem fica parado — sem uma linha no
 * console. Parece uma animação que não foi baixada direito.
 *
 * Os números vêm de uma medição real: um clipe do Mixamo contra o VRM do VRoid
 * — **53 pistas, e hoje as 53 religam**: 23 de corpo e 30 de falange.
 *
 * As 30 eram descartadas, com a justificativa de que *"o nosso boneco não move
 * os dedos"* — verdade sobre o `andar()` e irrelevante sobre um clipe de
 * arquivo, que move. O que sobrava era a mão na pose de bind do VRoid: reta e
 * aberta. O relato foi *"as mãos duras, estáticas, esticando as mesmas"*.
 *
 *   node web/js/animacao.test.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.min.js';
import {
  DO_MIXAMO, DEDOS_DO_MIXAMO, ossosDoMixamo, ossoDaPista, humanoideDoVrm,
  religar, escalaDoQuadril, prenderNoLugar, religarPelaPose, plantarNoChao,
} from './animacao.js';

let pass = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); process.exitCode = 1; }
};

console.log('\n  ---- religar uma animacao ----\n');

/** Uma pista de mentira, com a forma que o three usa. */
const pista = (nome, valores = [0, 0, 0, 1]) => ({
  name: nome,
  values: Float32Array.from(valores),
  clone() { return pista(this.name, Array.from(this.values)); },
});

const clipe = (nomes) => ({
  name: 'teste',
  duration: 2,
  tracks: nomes.map((n) => pista(n)),
  clone() { return clipe(this.tracks.map((x) => x.name)); },
});

/** O humanoide de um VRoid, como ele vem no arquivo. */
const HUMANOIDE = {
  hips: 'J_Bip_C_Hips', spine: 'J_Bip_C_Spine', chest: 'J_Bip_C_Chest',
  head: 'J_Bip_C_Head', neck: 'J_Bip_C_Neck',
  leftUpperArm: 'J_Bip_L_UpperArm', rightUpperArm: 'J_Bip_R_UpperArm',
  leftLowerArm: 'J_Bip_L_LowerArm', rightLowerArm: 'J_Bip_R_LowerArm',
  leftUpperLeg: 'J_Bip_L_UpperLeg', rightUpperLeg: 'J_Bip_R_UpperLeg',
  leftFoot: 'J_Bip_L_Foot', rightFoot: 'J_Bip_R_Foot',
};

/**
 * Os dedos de um VRoid — os quatro comuns mais o polegar nas DUAS grafias.
 *
 * Ficam a' parte do `HUMANOIDE` de cima para os testes de contagem dele nao
 * mudarem de numero a cada dedo acrescentado aqui.
 */
const DEDOS_1_0 = {
  leftIndexProximal: 'J_Bip_L_Index1', leftIndexIntermediate: 'J_Bip_L_Index2',
  leftIndexDistal: 'J_Bip_L_Index3',
  leftLittleProximal: 'J_Bip_L_Little1',
  leftThumbMetacarpal: 'J_Bip_L_Thumb1', leftThumbProximal: 'J_Bip_L_Thumb2',
  leftThumbDistal: 'J_Bip_L_Thumb3',
};
/** O mesmo polegar na grafia ANTIGA: `Proximal` e' a BASE, nao o do meio. */
const DEDOS_0_X = {
  leftIndexProximal: 'J_Bip_L_Index1', leftIndexIntermediate: 'J_Bip_L_Index2',
  leftIndexDistal: 'J_Bip_L_Index3',
  leftLittleProximal: 'J_Bip_L_Little1',
  leftThumbProximal: 'J_Bip_L_Thumb1', leftThumbIntermediate: 'J_Bip_L_Thumb2',
  leftThumbDistal: 'J_Bip_L_Thumb3',
};

// --------------------------------------------------------- o vocabulario
t('o nome do MIXAMO vira osso humanoide', () => {
  // `LeftArm` no Mixamo e' o `leftUpperArm` do VRM — os dois lados so' se
  // entendem por esse terceiro vocabulario
  assert.equal(ossoDaPista('mixamorig:LeftArm'), 'leftUpperArm');
  assert.equal(ossoDaPista('mixamorigLeftArm'), 'leftUpperArm');
  assert.equal(ossoDaPista('LeftUpLeg'), 'leftUpperLeg');
});

t('o FBXLoader TIRA os dois-pontos, e o prefixo tem de casar assim mesmo', () => {
  // `mixamorig:LeftArm` chega como `mixamorigLeftArm`. Exigir o `:` faria
  // NENHUM nome casar, e o sintoma seria o personagem parado — sem erro
  assert.equal(ossoDaPista('mixamorigHips'), 'hips');
  assert.equal(ossoDaPista('mixamorig:Hips'), 'hips');
});

t('nome que nao e osso nenhum devolve null', () => {
  assert.equal(ossoDaPista('Object_17'), null);
  assert.equal(ossoDaPista(''), null);
  assert.equal(ossoDaPista(null), null);
});

t('o mapa do Mixamo cobre o corpo inteiro', () => {
  for (const osso of ['hips', 'spine', 'head', 'leftUpperArm', 'rightUpperArm',
    'leftUpperLeg', 'rightUpperLeg', 'leftFoot', 'rightFoot']) {
    assert.ok(Object.values(DO_MIXAMO).includes(osso), 'falta ' + osso);
  }
  // o POLEGAR nao mora aqui: ele depende do humanoide para ser resolvido, e
  // uma grafia fixa poria a rotacao no osso errado em metade dos arquivos
  assert.ok(!Object.keys(DO_MIXAMO).some((k) => /Thumb/.test(k)));
});

t('os DEDOS sao 24 (fora o polegar), e o Pinky vira little', () => {
  // Eles eram descartados — 30 das 53 pistas —, e a mao ficava na pose de bind
  // do VRoid: reta e aberta, uma espatula na ponta de um braco que se move bem.
  // O relato foi "as maos duras, estaticas, esticando as mesmas".
  assert.equal(Object.keys(DEDOS_DO_MIXAMO).length, 24);
  // o unico dedo que os dois vocabularios chamam por nomes diferentes: traduzir
  // errado da um mindinho girando com a rotacao do anelar
  assert.equal(DEDOS_DO_MIXAMO.LeftHandPinky2, 'leftLittleIntermediate');
  assert.equal(DEDOS_DO_MIXAMO.RightHandPinky3, 'rightLittleDistal');
  assert.equal(ossoDaPista('mixamorig:LeftHandIndex1'), 'leftIndexProximal');
});

t('o POLEGAR do VRM 1.0: Metacarpal e a BASE, Proximal e o do MEIO', () => {
  const p = ossosDoMixamo({ ...HUMANOIDE, ...DEDOS_1_0 });
  assert.equal(p.get('mixamorigLeftHandThumb1'), 'J_Bip_L_Thumb1');
  assert.equal(p.get('mixamorigLeftHandThumb2'), 'J_Bip_L_Thumb2');
  assert.equal(p.get('mixamorigLeftHandThumb3'), 'J_Bip_L_Thumb3');
});

t('o POLEGAR do VRM 0.x: Proximal e a BASE — o MESMO nome, outro osso', () => {
  // e' a armadilha do arquivo: `leftThumbProximal` existe nas duas versoes e
  // significa ossos DIFERENTES. Resolver osso a osso pelo "primeiro nome
  // declarado" acertaria o 1.0 e erraria o 0.x justo no do meio, onde os dois
  // se cruzam — e o sintoma seria um polegar torto, que parece decisao de quem
  // modelou. Por isso a escolha e' do CONJUNTO.
  const p = ossosDoMixamo({ ...HUMANOIDE, ...DEDOS_0_X });
  assert.equal(p.get('mixamorigLeftHandThumb1'), 'J_Bip_L_Thumb1');
  assert.equal(p.get('mixamorigLeftHandThumb2'), 'J_Bip_L_Thumb2');
  assert.equal(p.get('mixamorigLeftHandThumb3'), 'J_Bip_L_Thumb3');
});

t('o osso que o humanoide NAO declara fica de fora, sem inventar par', () => {
  const p = ossosDoMixamo(HUMANOIDE);          // sem dedo nenhum
  assert.ok(!p.has('mixamorigLeftHandIndex1'));
  assert.ok(!p.has('mixamorigLeftHandThumb1'));
  assert.ok(p.has('mixamorigHips'));
  assert.equal(ossosDoMixamo(null).size, 0);
});

t('o prefixo mixamorig e posto num lugar SO', () => {
  // ele ja' foi montado em `modelos.js`, a mesma string em dois arquivos: no
  // dia em que divergisse, o personagem ficaria parado sem uma linha no console
  for (const k of ossosDoMixamo({ ...HUMANOIDE, ...DEDOS_1_0 }).keys()) {
    assert.ok(k.startsWith('mixamorig'), k);
  }
});

// ------------------------------------------------------------ o humanoide
t('humanoideDoVrm le os 0.x (array) e os 1.0 (objeto)', () => {
  const nodes = [{ name: 'A' }, { name: 'B' }];
  const a = humanoideDoVrm({ extensions: { VRM: { humanoid: { humanBones: [
    { bone: 'hips', node: 0 }, { bone: 'head', node: 1 }] } } }, nodes });
  const b = humanoideDoVrm({ extensions: { VRMC_vrm: { humanoid: { humanBones: {
    hips: { node: 0 }, head: { node: 1 } } } } }, nodes });
  assert.deepEqual(a, b);
  assert.equal(a.hips, 'A');
});

t('sem VRM devolve null', () => {
  assert.equal(humanoideDoVrm({ nodes: [] }), null);
  assert.equal(humanoideDoVrm(null), null);
});

// -------------------------------------------------------------- religar
t('as pistas do corpo e as de DEDO religam', () => {
  const c = clipe([
    'mixamorigHips.quaternion', 'mixamorigSpine.quaternion',
    'mixamorigLeftArm.quaternion', 'mixamorigRightUpLeg.quaternion',
    'mixamorigLeftHandIndex2.quaternion',
  ]);
  const r = religar(c, { ...HUMANOIDE, ...DEDOS_1_0 });
  assert.equal(r.religadas, 5);
  assert.equal(r.descartadas, 0);
  assert.deepEqual(r.clipe.tracks.map((x) => x.name), [
    'J_Bip_C_Hips.quaternion', 'J_Bip_C_Spine.quaternion',
    'J_Bip_L_UpperArm.quaternion', 'J_Bip_R_UpperLeg.quaternion',
    'J_Bip_L_Index2.quaternion',
  ]);
});

t('o dedo que o corpo de destino NAO tem continua saindo', () => {
  // um rig sem dedos e' legitimo, e a pista sem destino tem de sair do clipe:
  // deixa-la faz o mixer avisar uma vez por pista, e trinta avisos afogam
  // qualquer erro de verdade
  const c = clipe(['mixamorigHips.quaternion', 'mixamorigLeftHandIndex2.quaternion']);
  const r = religar(c, HUMANOIDE);
  assert.equal(r.religadas, 1);
  assert.equal(r.descartadas, 1);
});

t('pista sem destino SAI do clipe, em vez de ficar quieta', () => {
  // deixa-la faz o mixer avisar uma vez por pista no console, e trinta avisos
  // afogam qualquer erro de verdade
  const r = religar(clipe(['Object_17.quaternion', 'Cube.position']), HUMANOIDE);
  assert.equal(r.clipe, null);
  assert.equal(r.religadas, 0);
});

t('o clipe ORIGINAL nao e tocado — ele pode tocar noutro personagem', () => {
  // renomear as pistas no lugar ligaria o segundo boneco ao esqueleto do
  // primeiro, e os dois andariam com o corpo de um so'
  const c = clipe(['mixamorigHips.quaternion']);
  religar(c, HUMANOIDE);
  assert.equal(c.tracks[0].name, 'mixamorigHips.quaternion');
});

t('a POSICAO so passa no QUADRIL', () => {
  // nos outros ossos ela ESTICA o esqueleto do destino para as proporcoes do
  // clipe: o braco sai do ombro, a perna descola do quadril
  const c = clipe(['mixamorigHips.position', 'mixamorigLeftArm.position']);
  c.tracks[0].values = Float32Array.from([0, 100, 0, 0, 100, 0]);
  const r = religar(c, HUMANOIDE, { alturaDoQuadril: 0.8 });
  assert.equal(r.religadas, 1);
  assert.equal(r.clipe.tracks[0].name, 'J_Bip_C_Hips.position');
});

t('a posicao do quadril e ESCALADA — o Mixamo trabalha em centimetros', () => {
  // cru, o personagem sobe cem vezes; e como o `y` do grupo e somado ao chao,
  // ele some da tela sem erro nenhum
  const c = clipe(['mixamorigHips.position']);
  c.tracks[0].values = Float32Array.from([0, 100, 0, 0, 100, 0]);
  const r = religar(c, HUMANOIDE, { alturaDoQuadril: 0.8 });
  const v = r.clipe.tracks[0].values;
  assert.ok(Math.abs(v[1] - 0.8) < 1e-6, 'y ficou em ' + v[1]);
});

t('sem saber a altura, a posicao e DESCARTADA em vez de chutada', () => {
  // sem o quique o passo fica chapado; com o quique na escala errada o
  // personagem afunda no chao ou flutua meio metro
  const c = clipe(['mixamorigHips.position']);
  c.tracks[0].values = Float32Array.from([0, 100, 0]);
  const r = religar(c, HUMANOIDE);
  assert.equal(r.religadas, 0);
  assert.equal(r.descartadas, 1);
});

t('propriedade desconhecida nao entra', () => {
  const r = religar(clipe(['mixamorigHips.morphTargetInfluences']), HUMANOIDE);
  assert.equal(r.religadas, 0);
});

t('entrada torta nao derruba', () => {
  for (const [c, h] of [[null, HUMANOIDE], [clipe(['a.b']), null], [null, null], [{}, {}]]) {
    const r = religar(c, h);
    assert.ok(r && typeof r.religadas === 'number', 'quebrou');
  }
});

// -------------------------------------------------------------- a escala
t('a escala do quadril sai da altura MEDIA, e nao do pico', () => {
  // o pico e o vale sao o passo: usar qualquer um deixaria o personagem na
  // ponta do pe ou enterrado durante metade da caminhada
  const p = pista('x', [0, 90, 0, 0, 110, 0]);       // media 100
  assert.ok(Math.abs(escalaDoQuadril(p, 0.8, null) - 0.008) < 1e-9);
});

t('escala explicita vence a medida', () => {
  assert.equal(escalaDoQuadril(pista('x', [0, 100, 0]), 0.8, 0.01), 0.01);
});

t('quadril na altura zero nao vira divisao por zero', () => {
  assert.equal(escalaDoQuadril(pista('x', [0, 0, 0]), 0.8, null), null);
  assert.equal(escalaDoQuadril(pista('x', []), 0.8, null), null);
});

// ------------------------------------------------------------ no lugar
t('o AVANCO do quadril e tirado, e o quique FICA', () => {
  // Medido no "Walking" do Mixamo: o quadril anda 1,62 m em 1 s. Mas quem move
  // o personagem pelo mundo e' o jogo — com os dois empurrando, o corpo desliza
  // para fora de onde o jogo o pos: anda em diagonal, atravessa arvore (o
  // colisor ficou para tras) e volta num salto no fim do ciclo. Parece bug de
  // colisao, de rede ou de camera; nao de animacao.
  const p = pista('h', [0.1, 0.80, 0.0, 0.1, 0.84, 0.5, 0.1, 0.80, 1.6]);
  prenderNoLugar(p);
  const eixo = (k) => Array.from(p.values).filter((_, i) => i % 3 === k);
  assert.deepEqual(eixo(2), [0, 0, 0], 'o Z andou');
  assert.deepEqual(eixo(0).map((v) => Math.round(v * 100)), [10, 10, 10], 'o X andou');
  assert.deepEqual(eixo(1).map((v) => Math.round(v * 100)), [80, 84, 80], 'perdeu o quique');
});

t('o X e o Z vao para o PRIMEIRO quadro, e nao para zero', () => {
  // zero seria a origem do rig: um quadril que nao nasce em x=0 ganharia um
  // deslocamento lateral constante, e o corpo andaria de lado do proprio grupo
  const p = pista('h', [0.25, 0.8, -0.1, 0.25, 0.8, 2.0]);
  prenderNoLugar(p);
  assert.ok(Math.abs(p.values[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(p.values[2] + 0.1) < 1e-6);
  assert.ok(Math.abs(p.values[5] + 0.1) < 1e-6, 'o segundo quadro nao foi preso');
});

t('religar prende no lugar por PADRAO', () => {
  const c = clipe(['mixamorigHips.position']);
  c.tracks[0].values = Float32Array.from([0, 100, 0, 0, 100, 160]);
  const r = religar(c, HUMANOIDE, { alturaDoQuadril: 0.8 });
  const v = r.clipe.tracks[0].values;
  assert.equal(v[2], v[5], 'o avanco sobreviveu');
});

t('noLugar:false deixa o avanco passar (para quem quiser root motion)', () => {
  const c = clipe(['mixamorigHips.position']);
  c.tracks[0].values = Float32Array.from([0, 100, 0, 0, 100, 160]);
  const r = religar(c, HUMANOIDE, { alturaDoQuadril: 0.8, noLugar: false });
  const v = r.clipe.tracks[0].values;
  assert.ok(v[5] > v[2], 'o avanco foi tirado mesmo com noLugar:false');
});

t('prenderNoLugar aguenta pista vazia', () => {
  assert.doesNotThrow(() => prenderNoLugar(pista('h', [])));
  assert.doesNotThrow(() => prenderNoLugar(null));
});

// ==================================================== RELIGAR PELA POSE
//
// O bug que este bloco guarda: com o religamento so' por NOME, o corpo saiu
// "com as pernas pra cima, os bracos pra tras, atravessando o tronco" — e a
// animacao perfeitamente FLUIDA, porque o movimento estava certo e o
// referencial nao. Uma rotacao local so' quer dizer a mesma coisa em dois
// esqueletos se o osso nasce apontando para o mesmo lado nos dois.

/**
 * Dois esqueletos com a MESMA forma e poses de descanso DIFERENTES.
 *
 * A fonte tem o braco apontando para +X (como o Mixamo); o alvo, para -Z. Um
 * religamento so' por nome copiaria a rotacao crua e mandaria o braco para o
 * lugar errado — e' exatamente o caso real, em miniatura.
 */
function esqueleto(THREE2, giroDoBraco) {
  const raiz = new THREE2.Object3D();
  raiz.name = 'raiz';
  const quadril = new THREE2.Bone(); quadril.name = 'Hips';
  const braco = new THREE2.Bone(); braco.name = 'Arm';
  const mao = new THREE2.Bone(); mao.name = 'Hand';
  quadril.position.set(0, 1, 0);
  braco.position.set(0, 0.4, 0);
  braco.rotation.z = giroDoBraco;
  mao.position.set(0, 0.5, 0);
  braco.add(mao); quadril.add(braco); raiz.add(quadril);
  raiz.updateMatrixWorld(true);
  return raiz;
}

/**
 * Um clipe que sai da pose de descanso da FONTE e gira o braco 90 graus.
 *
 * O quadro 0 tem de ser a pose de descanso dela, e nao a identidade: o desvio e'
 * medido contra o descanso, e um clipe que comeca fora dele ja' nasce com um
 * desvio — o que e' legitimo (uma corrida comeca com o corpo inclinado) mas
 * nao serve para provar "sem desvio, sem mudanca".
 */
function clipeDeBraco(THREE2, descansoDaFonte, giro = Math.PI / 2) {
  const eixo = new THREE2.Vector3(0, 0, 1);
  const q0 = new THREE2.Quaternion().setFromAxisAngle(eixo, descansoDaFonte);
  const q1 = new THREE2.Quaternion().setFromAxisAngle(eixo, descansoDaFonte + giro);
  return new THREE2.AnimationClip('t', 1, [
    new THREE2.QuaternionKeyframeTrack('Arm.quaternion', [0, 1],
      [q0.x, q0.y, q0.z, q0.w, q1.x, q1.y, q1.z, q1.w]),
  ]);
}

t('a pose de DESCANSO e corrigida: o mesmo gesto, no referencial do destino', () => {
  // A fonte tem o braco a -60 graus e o alvo a +20: um religamento so' por nome
  // poria o braco do alvo onde o da fonte esta, ignorando de onde cada um
  // partiu. O que viaja entre corpos e' o DESVIO da pose de descanso.
  const fonte = esqueleto(THREE, -1.05);
  const alvo = esqueleto(THREE, 0.35);
  const pares = new Map([['Arm', 'Arm'], ['Hips', 'Hips']]);
  const r = religarPelaPose(THREE, { clipe: clipeDeBraco(THREE, -1.05), fonte, alvo, pares });
  assert.ok(r.clipe, 'nao produziu clipe');

  const mixer = new THREE.AnimationMixer(alvo);
  mixer.clipAction(r.clipe).play();

  // no quadro 0 o alvo tem de estar na PROPRIA pose de descanso, e nao na da
  // fonte: o clipe comeca sem desvio nenhum
  mixer.setTime(0);
  alvo.updateMatrixWorld(true);
  const braco = alvo.getObjectByName('Arm');
  assert.ok(Math.abs(braco.rotation.z - 0.35) < 0.02,
    `no quadro 0 o braco esta em ${braco.rotation.z.toFixed(3)}, devia estar em 0.35 (o descanso DELE)`);

  // no fim, o desvio de 90 graus da fonte tem de ter sido aplicado a partir
  // dali — e nao substituido pela pose absoluta da fonte.
  //
  // `0.999` e nao `1`: um clipe DA A VOLTA no proprio fim, e `setTime(duracao)`
  // devolve o quadro zero. Foi o que este teste pegou primeiro.
  mixer.setTime(0.999);
  alvo.updateMatrixWorld(true);
  assert.ok(Math.abs(braco.rotation.z - (0.35 + Math.PI / 2)) < 0.02,
    `no fim o braco esta em ${braco.rotation.z.toFixed(3)}, devia estar em ${(0.35 + Math.PI / 2).toFixed(3)}`);
});

t('poses de descanso IGUAIS dao a copia direta (os termos se cancelam)', () => {
  // e' o caso facil, e e' por isso que o religamento so' por nome funcionava
  // as vezes — o que escondia o defeito ate aparecer um par que nao casava
  const fonte = esqueleto(THREE, 0.35);
  const alvo = esqueleto(THREE, 0.35);
  const r = religarPelaPose(THREE, {
    clipe: clipeDeBraco(THREE, 0.35), fonte, alvo, pares: new Map([['Arm', 'Arm']]),
  });
  const mixer = new THREE.AnimationMixer(alvo);
  mixer.clipAction(r.clipe).play();
  mixer.setTime(0.999);
  alvo.updateMatrixWorld(true);
  assert.ok(Math.abs(alvo.getObjectByName('Arm').rotation.z - (0.35 + Math.PI / 2)) < 0.03);
});

t('osso SEM par fica na pose de descanso, e nao a deriva', () => {
  // um VRoid tem 124 ossos (cabelo, saia, seios) e o Mixamo manda 65: os que
  // sobram, soltos, dariam cabelo voando para dentro da cabeca
  const fonte = esqueleto(THREE, -1.05);
  const alvo = esqueleto(THREE, 0.35);
  const r = religarPelaPose(THREE, {
    clipe: clipeDeBraco(THREE, -1.05), fonte, alvo, pares: new Map([['Arm', 'Arm']]),
  });
  // a mao nao esta nos pares: nao pode haver pista para ela
  assert.ok(!r.clipe.tracks.some((x) => x.name.startsWith('Hand')), 'criou pista para um osso sem par');
});

t('a POSICAO nao viaja, exceto o quadril', () => {
  // copiar posicao impoe as proporcoes do outro corpo: braco saindo do ombro,
  // perna descolando do quadril
  const fonte = esqueleto(THREE, -1.05);
  const alvo = esqueleto(THREE, 0.35);
  const r = religarPelaPose(THREE, {
    clipe: clipeDeBraco(THREE, -1.05), fonte, alvo, pares: new Map([['Arm', 'Arm']]),
  });
  assert.ok(!r.clipe.tracks.some((x) => x.name.endsWith('.position')));
});

// =============================== A ESCALA DA RAIZ, E OS DOIS BUGS QUE ELA DEU
//
// O relato foi *"o modelo esta com os pes enterrados, e as maos flickando"*, em
// 07/09/2026. Sao DOIS defeitos, e os dois moram na escala que `normalizar()`
// (em `modelos.js`) poe na raiz do corpo para o modelo ter 1,72 m.
//
// Um corpo com escala na raiz e' o caso NORMAL — todo pacote vem na unidade de
// quem o fez —, e por isso os esqueletos daqui em diante tem escala.

/**
 * O mesmo esqueleto de cima, mas com PE, DEDO e a escala na raiz — que e' a
 * forma real de um corpo importado.
 *
 * Na pose de descanso a sola encosta em `y = 0`: e' o que `normalizar()`
 * garante, e e' a referencia de que `plantarNoChao` depende.
 */
function corpo(THREE2, { escala = 1, giroDoBraco = 0, prefixo = '' } = {}) {
  const raiz = new THREE2.Object3D();
  raiz.name = 'raiz';
  raiz.scale.setScalar(escala);
  // O `prefixo` existe porque a FONTE e' um rig do Mixamo de verdade
  // (`mixamorigHips`). Sem ele o mixer da amostragem nao acha o no' e imprime
  // "No target node found" — e um teste que imprime aviso ensina a ignorar aviso.
  const n = (x) => `${prefixo}${x}`;
  const quadril = new THREE2.Bone(); quadril.name = n('Hips'); quadril.position.set(0, 1, 0);
  const braco = new THREE2.Bone(); braco.name = n('Arm');
  braco.position.set(0, 0.4, 0); braco.rotation.z = giroDoBraco;
  const mao = new THREE2.Bone(); mao.name = n('Hand'); mao.position.set(0, 0.5, 0);
  const perna = new THREE2.Bone(); perna.name = n('LeftUpLeg'); perna.position.set(0, -0.05, 0);
  const pe = new THREE2.Bone(); pe.name = n('LeftFoot'); pe.position.set(0, -0.85, 0);
  const dedo = new THREE2.Bone(); dedo.name = n('LeftToeBase'); dedo.position.set(0, -0.06, 0.1);
  pe.add(dedo); perna.add(pe); braco.add(mao);
  quadril.add(braco); quadril.add(perna); raiz.add(quadril);
  raiz.updateMatrixWorld(true);
  return raiz;
}

t('com escala na raiz, o quaternio religado continua UNITARIO', () => {
  // O BUG DAS MAOS. `setFromRotationMatrix` supoe uma matriz de rotacao PURA;
  // com a escala de `normalizar()` junto, ele devolvia |q| = 0,975. Um |q| != 1
  // faz `Matrix4.compose` montar uma base torta, e o osso filho passa a nascer
  // a uma distancia que MUDA conforme o pai gira — a ponta da corrente (a mao,
  // quatro niveis abaixo do ombro) tremendo a cada quadro. Nada da erro.
  const fonte = corpo(THREE, { giroDoBraco: -1.05 });
  const alvo = corpo(THREE, { escala: 0.9669, giroDoBraco: 0.35 });
  const r = religarPelaPose(THREE, {
    clipe: clipeDeBraco(THREE, -1.05), fonte, alvo, pares: new Map([['Arm', 'Arm']]),
  });
  for (const p of r.clipe.tracks) {
    for (let i = 0; i < p.values.length; i += 4) {
      const n = Math.hypot(p.values[i], p.values[i + 1], p.values[i + 2], p.values[i + 3]);
      assert.ok(Math.abs(n - 1) < 1e-4, `${p.name} tem |q| = ${n.toFixed(5)}, devia ser 1`);
    }
  }
});

t('com escala na raiz, o OSSO nao muda de comprimento entre quadros', () => {
  // e' o mesmo bug pelo sintoma que se ve: medido no modelo de verdade, o
  // antebraco encolhia e crescia 1,8% de um quadro para o outro
  const fonte = corpo(THREE, { giroDoBraco: -1.05 });
  const alvo = corpo(THREE, { escala: 0.9669, giroDoBraco: 0.35 });
  const r = religarPelaPose(THREE, {
    clipe: clipeDeBraco(THREE, -1.05), fonte, alvo, pares: new Map([['Arm', 'Arm']]),
  });
  const mixer = new THREE.AnimationMixer(alvo);
  mixer.clipAction(r.clipe).play();
  const braco = alvo.getObjectByName('Arm'), mao = alvo.getObjectByName('Hand');
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const medidas = [];
  for (let i = 0; i <= 20; i++) {
    mixer.setTime(i / 21);
    alvo.updateMatrixWorld(true);
    a.setFromMatrixPosition(braco.matrixWorld);
    b.setFromMatrixPosition(mao.matrixWorld);
    medidas.push(a.distanceTo(b));
  }
  const min = Math.min(...medidas), max = Math.max(...medidas);
  assert.ok(max - min < 1e-4, `o osso variou de ${min.toFixed(5)} a ${max.toFixed(5)}`);
});

/** Um clipe que agacha o corpo: so' a pista de posicao do quadril, em cm. */
function clipeDeAgachar(THREE2, cmAlto = 100, cmBaixo = 80) {
  return new THREE2.AnimationClip('agachar', 1, [
    new THREE2.VectorKeyframeTrack('mixamorigHips.position', [0, 0.5, 1],
      [0, cmAlto, 0, 0, cmBaixo, 0, 0, cmAlto, 0]),
  ]);
}

t('a altura do quadril sai do ESQUELETO do destino, e nao de uma constante', () => {
  // O BUG DOS PES. Quem chamava passava `ANCORAS.pernaE[1]` (0,80 m) — a junta
  // da coxa do boneco de CAPSULAS. O quadril do modelo esta em 1,0127 m, entao
  // a pista entrava escalada para a altura errada, o corpo descia 21 cm e o
  // dedo do pe ia parar a −15 cm do chao.
  const fonte = corpo(THREE, { prefixo: 'mixamorig' });
  const alvo = corpo(THREE);
  const r = religarPelaPose(THREE, {
    clipe: clipeDeAgachar(THREE), fonte, alvo,
    pares: new Map([['mixamorigHips', 'Hips']]),
    noLugar: false,
  });
  const p = r.clipe.tracks.find((x) => x.name === 'Hips.position');
  assert.ok(p, 'a pista do quadril sumiu');
  // a media do clipe (93,3 cm) tem de virar a altura do quadril DELE (1,0 m),
  // e nao os 0,80 da constante antiga
  const media = (p.values[1] + p.values[4] + p.values[7]) / 3;
  assert.ok(Math.abs(media - 1) < 0.02,
    `a media do quadril ficou em ${media.toFixed(4)}, devia ser ~1 (a altura do alvo)`);
});

t('os PES pousam em y = 0 — o ponto mais baixo do passo encosta no chao', () => {
  // A escala e' MULTIPLICATIVA (unidade e proporcao); onde o corpo pousa e'
  // ADITIVO. Fazer as duas com o mesmo numero so' acerta quando a pose media do
  // clipe e' a de descanso — e numa caminhada nunca e': o joelho fica dobrado e
  // o quadril tem de descer para o pe continuar no chao.
  const fonte = corpo(THREE, { prefixo: 'mixamorig' });
  const alvo = corpo(THREE);
  const r = religarPelaPose(THREE, {
    clipe: clipeDeAgachar(THREE, 100, 80), fonte, alvo,
    pares: new Map([['mixamorigHips', 'Hips'], ['mixamorigLeftFoot', 'LeftFoot']]),
    noLugar: false,
  });
  assert.ok(r.deslocou > 0, `nao levantou o corpo (deslocou = ${r.deslocou})`);

  const mixer = new THREE.AnimationMixer(alvo);
  const acao = mixer.clipAction(r.clipe);
  acao.setLoop(THREE.LoopOnce, 1); acao.clampWhenFinished = true; acao.play();
  const pe = alvo.getObjectByName('LeftFoot');
  const v = new THREE.Vector3();
  let maisBaixo = Infinity;
  for (let i = 0; i <= 30; i++) {
    mixer.setTime(i / 31);
    alvo.updateMatrixWorld(true);
    maisBaixo = Math.min(maisBaixo, v.setFromMatrixPosition(pe.matrixWorld).y);
  }
  // a referencia e' o DESCANSO do osso (o pe deste corpo nasce a 0,10 m), e nao
  // zero: plantar o OSSO em zero enterraria o modelo pela espessura do sapato
  assert.ok(Math.abs(maisBaixo - 0.10) < 0.01,
    `o pe mais baixo ficou em ${maisBaixo.toFixed(4)}, devia encostar no descanso (0,10)`);
});

t('plantar devolve o alvo na POSE DE DESCANSO', () => {
  // medir exige POSAR o alvo. Sair daqui com ele no ultimo quadro medido faria
  // o clipe seguinte ser religado contra uma pose que nao e' o descanso de nada
  const alvo = corpo(THREE, { escala: 0.9669 });
  const quadril = alvo.getObjectByName('Hips');
  const antes = quadril.position.clone();
  const clipe = new THREE.AnimationClip('x', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 0.6, 0]),
  ]);
  plantarNoChao(THREE, { clipe, alvo, quadril, pes: [alvo.getObjectByName('LeftFoot')] });
  assert.ok(quadril.position.distanceTo(antes) < 1e-6,
    `o quadril ficou em ${quadril.position.y.toFixed(4)}, devia voltar para ${antes.y}`);
});

t('sem pe, sem pista de quadril ou sem alvo, plantar nao mexe em nada', () => {
  const alvo = corpo(THREE);
  const quadril = alvo.getObjectByName('Hips');
  const clipe = new THREE.AnimationClip('x', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 0.6, 0]),
  ]);
  for (const arg of [
    { clipe, alvo, quadril, pes: [] },
    { clipe, alvo, quadril: null, pes: [alvo.getObjectByName('LeftFoot')] },
    { clipe: null, alvo, quadril, pes: [alvo.getObjectByName('LeftFoot')] },
    { clipe, alvo: null, quadril, pes: [alvo.getObjectByName('LeftFoot')] },
  ]) {
    assert.equal(plantarNoChao(THREE, arg).deslocou, 0);
  }
});

t('entrada torta devolve clipe null em vez de derrubar', () => {
  const fonte = esqueleto(THREE, 0);
  for (const arg of [
    { clipe: null, fonte, alvo: fonte, pares: new Map([['a', 'a']]) },
    { clipe: clipeDeBraco(THREE, 0), fonte: null, alvo: fonte, pares: new Map([['a', 'a']]) },
    { clipe: clipeDeBraco(THREE, 0), fonte, alvo: fonte, pares: new Map() },
  ]) {
    const r = religarPelaPose(THREE, arg);
    assert.equal(r.clipe, null);
  }
});

console.log(`\n  ${pass} passaram\n`);
