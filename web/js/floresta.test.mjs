/**
 * A FLORESTA 3D — `node web/js/floresta.test.mjs`
 *
 * Mundo é a coisa mais difícil de provar por teste: quase tudo nele se julga
 * OLHANDO. Então este arquivo não tenta julgar aparência — ele guarda o punhado
 * de decisões que erram **caladas**, isto é, que produzem uma floresta bonita e
 * errada, sem uma linha no console:
 *
 *  - **duas contas de altura.** O terreno desloca cada vértice por
 *    `alturaDoChao`, e o loop põe os pés do jogador pela mesma função. Uma
 *    segunda conta em qualquer um dos dois lados dá um boneco flutuando ou
 *    enterrado — e o jogo roda igual;
 *  - **o duelista dentro do tronco.** Vaga em cima de um colisor é um
 *    adversário impossível de alcançar. É a armadilha que `buildMap()` já
 *    documenta no mundo 2D ("não dá erro nenhum, só é impossível de
 *    alcançar"), lá sem teste e aqui com;
 *  - **a floresta sorteada.** Ruído não determinístico faz cada máquina ver um
 *    mapa diferente, e todo relato de bug deixa de ser reproduzível;
 *  - **o colisor do tamanho errado.** Copa inteira vira uma parede invisível a
 *    três metros da árvore; zero deixa atravessar o tronco. Os dois parecem
 *    "quase certo" na tela;
 *  - **a parede do mundo.** Sem ela dá para sair andando para o vazio: o chão
 *    acaba, a névoa esconde que acabou, e nada acusa.
 *
 * A segunda metade prova o que o teste de lógica normalmente não alcança: que
 * o **three.js vendorizado carrega** e que a cena monta inteira. `three` roda
 * em Node menos o `WebGLRenderer` (que precisa de canvas), e é exatamente por
 * isso que `floresta3d.js` e `boneco3d.js` não encostam em DOM — a renderização
 * fica em `mundo3d.js`, sozinha.
 */
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  MUNDO, construirFloresta, alturaDoChao, terraBatida, manchaDeChao,
  livre, mover, vagasDeNpc,
} from './floresta.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};
const ta = async (nome, fn) => {
  try { await fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const mapa = construirFloresta();
const finito = (n) => Number.isFinite(n);

// ------------------------------------------------------------------ relevo

t('a altura do chão é finita em todo o mundo', () => {
  for (let x = -MUNDO.raio; x <= MUNDO.raio; x += 3.7) {
    for (let z = -MUNDO.raio; z <= MUNDO.raio; z += 3.7) {
      assert.ok(finito(alturaDoChao(x, z)), `altura não-finita em ${x},${z}`);
    }
  }
});

t('a mesma coordenada devolve sempre a mesma altura', () => {
  for (const [x, z] of [[0, 0], [17.5, -3.25], [-61, 44], [88, 12]]) {
    assert.equal(alturaDoChao(x, z), alturaDoChao(x, z));
  }
});

// Plana com TOLERÂNCIA, e não `=== 0`: no raio exato da clareira o `hypot`
// devolve 13.000000000000002 e a rampa entra com peso ~1e-31. É erro de ponto
// flutuante, não degrau — exigir zero cravado seria um teste que reprova a
// aritmética do computador em vez do desenho do mundo.
t('a clareira é plana — nenhum duelista fica em degrau', () => {
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    for (let r = 0; r <= MUNDO.clareira; r += 1) {
      const y = alturaDoChao(Math.cos(a) * r, Math.sin(a) * r);
      assert.ok(Math.abs(y) < 1e-9, `degrau de ${y} a ${r}m do centro`);
    }
  }
});

// Um degrau vertical não dá erro: dá uma parede que o jogador sobe andando,
// porque a colisão é só horizontal. A rampa da clareira é o lugar clássico.
t('o relevo não tem paredão — a inclinação fica andável', () => {
  let pior = 0, onde = null;
  for (let x = -MUNDO.raio; x <= MUNDO.raio; x += 1.1) {
    for (let z = -MUNDO.raio; z <= MUNDO.raio; z += 1.1) {
      const d = Math.abs(alturaDoChao(x + 1.1, z) - alturaDoChao(x, z)) / 1.1;
      if (d > pior) { pior = d; onde = [x, z]; }
    }
  }
  assert.ok(pior < 0.75, `inclinação de ${pior.toFixed(2)} em ${onde} — isso é escalada, não caminhada`);
});

t('a terra batida cobre a clareira e some no mato', () => {
  assert.equal(terraBatida(0, 0), 1);
  assert.equal(terraBatida(MUNDO.raio - 1, 0), 0);
  const meio = terraBatida(MUNDO.clareira, 0);
  assert.ok(meio > 0 && meio < 1, `a borda tem de ser um degradê, veio ${meio}`);
});

t('a mancha do chão fica entre 0 e 1', () => {
  for (let i = 0; i < 400; i++) {
    const v = manchaDeChao(i * 1.7 - 90, i * -2.3 + 40);
    assert.ok(v >= 0 && v <= 1, `mancha fora da faixa: ${v}`);
  }
});

// ------------------------------------------------------------- povoamento

t('a floresta é a MESMA em toda construção', () => {
  const outro = construirFloresta();
  assert.equal(outro.arvores.length, mapa.arvores.length);
  assert.deepEqual(outro.arvores[0], mapa.arvores[0]);
  assert.deepEqual(outro.arvores.at(-1), mapa.arvores.at(-1));
  assert.deepEqual(outro.vagas, mapa.vagas);
});

t('nasceu floresta de verdade (e não meia dúzia de árvores)', () => {
  assert.ok(mapa.arvores.length > 180, `só ${mapa.arvores.length} árvore(s)`);
  assert.ok(mapa.pedras.length > 10, `só ${mapa.pedras.length} pedra(s)`);
  assert.ok(mapa.moitas.length > 80, `só ${mapa.moitas.length} samambaia(s)`);
  assert.ok(mapa.grama.length > 400, `só ${mapa.grama.length} tufo(s) de capim`);
  // As duas espécies têm de aparecer: um bosque de clones passaria em tudo
  // acima e ainda assim seria o defeito.
  assert.ok(mapa.arvores.some((a) => a.conifera), 'nenhuma conífera');
  assert.ok(mapa.arvores.some((a) => !a.conifera), 'nenhuma copada');
});

// ESTE é o teste da "conta única de altura": tudo que o cenário planta guarda
// o `y` que veio de `alturaDoChao`. Quem desenha copia esse valor e não
// recalcula nada — e quem recalcular vai divergir aqui.
t('tudo que foi plantado está NO chão, pela mesma função', () => {
  for (const familia of ['arvores', 'pedras', 'moitas', 'grama']) {
    for (const p of mapa[familia]) {
      assert.equal(p.y, alturaDoChao(p.x, p.z), `${familia}: ${p.x},${p.z} fora do chão`);
      assert.ok(finito(p.escala) && p.escala > 0, `${familia}: escala inválida`);
    }
  }
});

t('nada nasceu fora do mundo', () => {
  for (const familia of ['arvores', 'pedras', 'moitas', 'grama']) {
    for (const p of mapa[familia]) {
      assert.ok(Math.hypot(p.x, p.z) <= MUNDO.raio, `${familia} fora da parede em ${p.x},${p.z}`);
    }
  }
});

t('nenhuma árvore ou pedra invadiu a clareira', () => {
  for (const a of mapa.arvores) {
    assert.ok(Math.hypot(a.x, a.z) > MUNDO.clareira,
      `árvore dentro do descampado em ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
  }
  for (const p of mapa.pedras) {
    assert.ok(Math.hypot(p.x, p.z) > MUNDO.clareira - 1, 'pedra dentro do descampado');
  }
});

t('a mata rareia perto da clareira em vez de virar parede', () => {
  const perto = mapa.arvores.filter((a) => a.distancia < MUNDO.clareira + 12).length;
  const longe = mapa.arvores.filter((a) => a.distancia >= MUNDO.clareira + 12 && a.distancia < MUNDO.clareira + 24).length;
  assert.ok(longe > perto, `${perto} perto x ${longe} longe — a borda não está rareando`);
});

t('o capim rareia sobre a terra batida', () => {
  const naTerra = mapa.grama.filter((g) => terraBatida(g.x, g.z) > 0.8).length;
  const noMato = mapa.grama.filter((g) => terraBatida(g.x, g.z) === 0).length;
  const areaTerra = Math.PI * (MUNDO.clareira - 2.5) ** 2;
  const areaMato = Math.PI * 54 ** 2 - Math.PI * (MUNDO.clareira + 4) ** 2;
  assert.ok((naTerra / areaTerra) < (noMato / areaMato) / 3,
    `densidade na terra ${(naTerra / areaTerra).toFixed(3)} x no mato ${(noMato / areaMato).toFixed(3)}`);
});

// --------------------------------------------------------------- colisão

t('o colisor é do TRONCO, não da copa', () => {
  for (const c of mapa.colisores) {
    assert.ok(c.r > 0.2, `colisor de raio ${c.r} — dá pra atravessar o tronco`);
    assert.ok(c.r < 1.9, `colisor de raio ${c.r} — isso é a copa, vira parede invisível`);
  }
  // Samambaia e capim NÃO bloqueiam: um mato que empurra o jogador é pior que
  // um mato atravessável.
  assert.equal(mapa.colisores.length, mapa.arvores.length
    + mapa.pedras.filter((p) => p.escala > 0.8).length);
});

t('a parede do mundo existe — não dá pra sair andando pro vazio', () => {
  assert.ok(!livre([], MUNDO.raio + 1, 0), 'passou pela borda leste');
  assert.ok(!livre([], 0, -MUNDO.raio - 5), 'passou pela borda norte');
  assert.ok(livre([], 0, 0), 'travou no meio da clareira');
});

t('a PAREDE e parametro — o Editor de Cena anda alem dos 92 m da floresta', () => {
  // uma cena vai a 400 m (`LIMITE.xz`), e o modo Testar do editor usa ESTA
  // mesma funcao. Sem o parametro, andar la baria numa parede invisivel a 92 m
  // que nao existe na cena — e a colisao teria de ser reescrita, que e' pior.
  assert.ok(!livre([], 150, 0), 'o padrao continua sendo a parede da floresta');
  assert.ok(livre([], 150, 0, MUNDO.raioJogador, 400), 'a parede maior tinha de deixar passar');
  assert.ok(!livre([], 401, 0, MUNDO.raioJogador, 400), 'e ainda tem de existir uma parede');
});

t('mover LEVA a parede junto — senao o deslize atravessa a borda', () => {
  // `mover` chama `livre` duas vezes; se ele nao repassasse a parede, o passo
  // seria julgado pela borda da floresta e o jogador travaria a 92 m no editor
  const r = mover([], 150, 0, 2, 0, MUNDO.raioJogador, 400);
  assert.equal(r.x, 152, 'nao andou: a parede nao foi repassada');
});

t('o tronco barra e a distância certa deixa passar', () => {
  const col = [{ x: 10, z: 0, r: 0.6 }];
  assert.ok(!livre(col, 10.3, 0, 0.42), 'entrou no tronco');
  assert.ok(livre(col, 11.2, 0, 0.42), 'travou longe do tronco');
});

// Sem o deslize, encostar num tronco em diagonal PRENDE o jogador: os dois
// eixos são recusados juntos e ele fica colado, sem entender por quê.
t('esbarrar num eixo ainda deixa deslizar no outro', () => {
  const col = [{ x: 1, z: 0, r: 0.6 }];
  const r = mover(col, 0, 0, 0.5, 0.5, 0.42);
  assert.equal(r.x, 0, 'X devia ter sido barrado pelo tronco');
  assert.ok(r.z > 0.4, 'Z devia ter deslizado');
});

t('mover nunca devolve NaN', () => {
  const r = mover(mapa.colisores, mapa.entrada.x, mapa.entrada.z, 0, 0);
  assert.ok(finito(r.x) && finito(r.z));
});

// ----------------------------------------------------------- os duelistas

t('as vagas existem, estão livres e olham para o centro', () => {
  assert.ok(mapa.vagas.length >= 8, `só ${mapa.vagas.length} vaga(s) de duelista`);
  for (const v of mapa.vagas) {
    assert.ok(livre(mapa.colisores, v.x, v.z, 0.9),
      `vaga presa em ${v.x.toFixed(1)},${v.z.toFixed(1)} — o duelista seria inalcançável`);
    assert.ok(Math.hypot(v.x, v.z) < MUNDO.clareira, 'vaga fora da clareira');
    assert.equal(v.y, alturaDoChao(v.x, v.z));
    // `atan2(-x, -z)` é o giro em Y de um modelo que olha para +Z (ver
    // `boneco3d.js`): girado assim, a frente dele é `(sin giro, cos giro)`, e
    // isso tem de bater com a direção da vaga até a origem. Trocar o sinal (ou
    // os argumentos do `atan2`) põe todo duelista de costas para quem chega,
    // e nada acusa — é só uma floresta de gente mal-educada.
    const h = Math.hypot(v.x, v.z);
    assert.ok(Math.abs(Math.sin(v.giro) - (-v.x / h)) < 1e-9, `vaga ${v.x},${v.z} olha para o lado errado (x)`);
    assert.ok(Math.abs(Math.cos(v.giro) - (-v.z / h)) < 1e-9, `vaga ${v.x},${v.z} olha para o lado errado (z)`);
  }
});

// E que a varredura RECONHECE o caso ruim — senão "nenhuma vaga presa" não
// prova nada, e a regra poderia ter sumido sem ninguém notar.
t('a vaga em cima de um obstáculo é descartada', () => {
  const anel = MUNDO.clareira - 4.2;
  const semNada = vagasDeNpc([], 12);
  assert.equal(semNada.length, 12);
  // Um paredão cobrindo o anel inteiro não pode deixar vaga nenhuma de pé.
  const entulho = semNada.map((v) => ({ x: v.x, z: v.z, r: 2 }));
  assert.equal(vagasDeNpc(entulho, 12).length, 0, 'vaga bloqueada passou como boa');
  // E um obstáculo só tira uma.
  assert.equal(vagasDeNpc([{ x: semNada[0].x, z: semNada[0].z, r: 2 }], 12).length, 11);
  assert.ok(anel > 0);
});

t('a entrada do jogador está livre', () => {
  assert.ok(livre(mapa.colisores, mapa.entrada.x, mapa.entrada.z),
    'o jogador nasceria dentro de um obstáculo');
});

t('dá pra atravessar a clareira a pé de ponta a ponta', () => {
  let presos = 0, total = 0;
  for (let x = -MUNDO.clareira; x <= MUNDO.clareira; x += 0.8) {
    for (let z = -MUNDO.clareira; z <= MUNDO.clareira; z += 0.8) {
      if (Math.hypot(x, z) > MUNDO.clareira - 0.5) continue;
      total++;
      if (!livre(mapa.colisores, x, z)) presos++;
    }
  }
  assert.equal(presos, 0, `${presos} de ${total} pontos da clareira estão bloqueados`);
});

// ------------------------------------------------- o three.js vendorizado

t('o three está vendorizado no repositório (e não vem de CDN)', () => {
  const base = new URL('../vendor/three/', import.meta.url);
  for (const f of ['three.module.min.js', 'three.core.min.js', 'LICENSE']) {
    assert.ok(existsSync(new URL(f, base)), `falta web/vendor/three/${f}`);
  }
  // O jogo instalado serve `%LOCALAPPDATA%` e roda offline em rede ruim; um
  // `import` de CDN deixaria o mundo 3D sem abrir exatamente quando a conexão
  // está pior. A varredura é literal: nenhum módulo nosso pode importar de
  // fora.
  for (const m of ['floresta3d.js', 'boneco3d.js', 'mundo3d.js']) {
    const src = readFileSync(new URL(m, import.meta.url), 'utf8');
    const externo = [...src.matchAll(/from\s+['"](https?:)?\/\/[^'"]+['"]/g)];
    assert.deepEqual(externo.map((x) => x[0]), [], `${m} importa de fora`);
    assert.ok(/three\.module\.min\.js/.test(src), `${m} não importa o three vendorizado`);
  }
});

await ta('o three carrega e a cena monta inteira', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  assert.ok(Number(THREE.REVISION) >= 150, `revisão inesperada: ${THREE.REVISION}`);

  const { montarCena } = await import('./floresta3d.js');
  const { scene, atualizar, seguirSol } = montarCena(mapa);

  const instancias = [];
  scene.traverse((o) => { if (o.isInstancedMesh) instancias.push(o); });
  const plantado = instancias.reduce((s, im) => s + im.count, 0);
  const esperado = mapa.arvores.length + mapa.pedras.length + mapa.moitas.length + mapa.grama.length;
  assert.equal(plantado, esperado, 'sumiu (ou dobrou) coisa entre o mapa e a cena');

  // Céu, chão e as luzes: sem a névoa vê-se a borda do mundo acabar no ar.
  assert.ok(scene.getObjectByName('ceu'), 'a cena está sem céu');
  assert.ok(scene.fog, 'a cena está sem névoa — a borda do mundo apareceria');

  // O INVARIANTE da borda: o chão tem de passar da parede do mundo por, no
  // mínimo, o alcance da névoa. Com o plano curto, quem chega ao muro vê o
  // chão terminar no ar, nítido, a poucos metros — e nada acusa. São três
  // números em dois arquivos (o raio do mundo, o tamanho do plano e o `far` da
  // névoa), e mexer em qualquer um quebra o que os outros dois garantiam.
  const chao = scene.getObjectByName('chao');
  assert.ok(chao, 'a cena está sem chão');
  chao.geometry.computeBoundingBox();
  const caixa = chao.geometry.boundingBox;
  const metade = Math.min(caixa.max.x, caixa.max.z);
  assert.ok(metade - MUNDO.raio >= scene.fog.far,
    `o chão passa só ${(metade - MUNDO.raio).toFixed(0)}m da parede e a névoa `
    + `alcança ${scene.fog.far}m — dá pra ver o mundo acabar`);
  // E a névoa não pode apagar a própria clareira: o tree line fica a ~15-25m.
  assert.ok(scene.fog.near > MUNDO.clareira,
    'a névoa começa dentro da clareira — os duelistas ficariam embaçados');

  // O capim é plantado só até um raio; a névoa tem de apagar essa borda, senão
  // vê-se o gramado terminar numa circunferência perfeita em volta do jogador.
  const raioCapim = Math.max(...mapa.grama.map((g) => Math.hypot(g.x, g.z)));
  const apagado = (raioCapim - scene.fog.near) / (scene.fog.far - scene.fog.near);
  assert.ok(apagado > 0.7,
    `a borda do capim (${raioCapim.toFixed(0)}m) está só ${(apagado * 100).toFixed(0)}% apagada`);
  assert.ok(scene.children.some((o) => o.isDirectionalLight && o.castShadow), 'sem sol com sombra');

  // Recorte de frustum ligado num InstancedMesh espalhado faz a floresta
  // inteira sumir conforme a câmera aponta — sem erro nenhum.
  for (const im of instancias) {
    assert.equal(im.frustumCulled, false, 'InstancedMesh com recorte ligado');
  }

  // Toda matriz de instância tem de ser um número. Um NaN aqui não levanta:
  // a árvore simplesmente não aparece.
  const m = new THREE.Matrix4();
  for (const im of instancias) {
    for (let i = 0; i < im.count; i += 7) {
      im.getMatrixAt(i, m);
      assert.ok(m.elements.every(finito), 'matriz de instância com NaN');
    }
  }

  // O vento e o sol têm de rodar sem quebrar nada.
  atualizar(1.5);
  atualizar(9.25);
  seguirSol(12, -30);
  for (const im of instancias) {
    im.getMatrixAt(0, m);
    assert.ok(m.elements.every(finito), 'o vento produziu NaN');
  }
});

await ta('o boneco tem altura de gente e o rosto para +Z', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  const { criarBoneco, ALTURA } = await import('./boneco3d.js');
  const { coresPara } = await import('./actors.js');

  const { grupo, andar } = criarBoneco(coresPara('kaiba'));
  const caixa = new THREE.Box3().setFromObject(grupo);
  assert.ok(Math.abs(caixa.min.y) < 0.06, `os pés estão em y=${caixa.min.y.toFixed(2)}, não no chão`);
  assert.ok(Math.abs(caixa.max.y - ALTURA) < 0.12,
    `a cabeça está em ${caixa.max.y.toFixed(2)} e ALTURA diz ${ALTURA} — a etiqueta de nome flutuaria`);

  // O contrato do giro: `atan2(dx, dz)` só aponta o boneco para o alvo se o
  // rosto dele olhar para +Z. Os olhos são a prova — montado ao contrário,
  // todo duelista ficaria de costas para quem chega, sem nada acusar.
  const olhos = [];
  grupo.traverse((o) => {
    if (!o.isMesh) return;
    const p = new THREE.Vector3();
    o.getWorldPosition(p);
    if (p.z > 0.1 && p.y > 1.4) olhos.push(p);
  });
  assert.ok(olhos.length >= 2, 'não achei os olhos na frente da cabeça (+Z)');

  // O passo: parado é parado. Uma perna balançando com o boneco imóvel é o
  // sintoma de o loop passar o relógio no lugar do tempo andando.
  andar(0.4, false);
  const paradas = [];
  grupo.traverse((o) => { if (o.isGroup && o !== grupo) paradas.push(o.rotation.x); });
  assert.ok(paradas.every((r) => r === 0), 'o boneco parado está mexendo as pernas');
  andar(0.4, true);
  const andando = [];
  grupo.traverse((o) => { if (o.isGroup && o !== grupo) andando.push(o.rotation.x); });
  assert.ok(andando.some((r) => Math.abs(r) > 0.05), 'o boneco andando está de pernas duras');
});

// ------------------------------------------------------------- a tela nova

/**
 * O Mundo **SAIU do menu da home** (08/09/2026), e a porta dele voltou a ser a
 * Área de Teste. O construtor de cenas que nasceu dele virou projeto à parte
 * (`three_js_scene_editor`), e um mundo sem interação nenhuma não se sustenta
 * como opção do menu enquanto isso amadurece.
 *
 * O teste guarda as duas metades, porque as duas erram caladas e em direções
 * opostas:
 *
 *   • **o botão não pode voltar sozinho** — quem reabrir a home e "consertar"
 *     um menu com quatro opções recoloca no caminho do jogador uma tela que
 *     saiu dele de propósito;
 *   • **a Área de Teste é a única porta que sobrou** — perdê-la deixa a
 *     feature escrita no disco e inalcançável por qualquer caminho.
 *
 * `requireAdmin` continua **fora** de `mundo3d.js`: a tela seguiu pedindo só
 * sessão. Não é descuido — quem guarda a porta é o `teste.html`, que é de
 * admin, e devolver o `requireAdmin` para cá faria a tela abrir, piscar e
 * mandar de volta quem chegasse por um link salvo.
 *
 * E os atalhos de Área de Teste na barra têm de NASCER escondidos. Revelar
 * depois de perguntar ao servidor é o guarda de sempre; nascer visíveis os faz
 * piscar na tela de quem chegar sem ser admin, entre o boot e a resposta.
 */
t('o Mundo saiu do menu da home, e a porta dele é a Área de Teste', () => {
  const html = readFileSync(new URL('../mundo3d.html', import.meta.url), 'utf8');
  assert.ok(/\/web\/js\/mundo3d\.js/.test(html), 'a página não carrega o módulo');
  assert.ok(/\/web\/js\/bootguard\.js/.test(html), 'sem bootguard, um erro de boot é uma tela em branco');
  // O guarda geral do `hidden` (ver `esconder.test.mjs`): sem ele o aviso de
  // "sem WebGL" fica na tela por cima do mundo que abriu normalmente.
  assert.ok(/\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(html), 'falta o guarda [hidden]');

  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  assert.ok(/requireLogin/.test(modulo), 'o Mundo não pede sessão');
  // A âncora é o IMPORT, e não a palavra solta: ela aparece em comentário aqui
  // (explicando por que as telas de admin continuam se guardando sozinhas), e
  // uma varredura que gritasse por causa disso deixaria de ser lida. Chamar o
  // que não se importou é que não dá.
  const deAuth = modulo.match(/import \{([^}]*)\} from '\/web\/js\/auth\.js'/);
  assert.ok(deAuth, 'o Mundo não importa mais nada de auth.js — a porta ficou aberta');
  assert.ok(!/requireAdmin/.test(deAuth[1]),
    'o Mundo ainda pede admin — nenhum jogador comum passaria pela porta que a home abriu');

  // Os dois atalhos de Área de Teste da barra, escondidos no markup.
  for (const id of ['btn-2d', 'btn-teste']) {
    const m = html.match(new RegExp(`<button id="${id}"([^>]*)>`));
    assert.ok(m, `não achei o #${id} na barra`);
    assert.ok(/\bhidden\b/.test(m[1]),
      `#${id} nasce visível — pisca na tela de todo jogador antes da resposta do perfil`);
  }

  // O menu da home é uma LISTA DE BOTÕES, e é neles que a porta mora — a
  // âncora tem de ser o `location.href`, e não a palavra solta: `mundo3d.html`
  // aparece no comentário que explica por que ele saiu, e uma varredura que
  // gritasse por causa disso deixaria de ser lida.
  const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!/location\.href = '\/web\/mundo3d\.html'/.test(home),
    'o Mundo voltou ao menu da home — ele saiu de lá de propósito');

  const teste = readFileSync(new URL('../teste.html', import.meta.url), 'utf8');
  assert.ok(/mundo3d\.html/.test(teste),
    'a tela saiu da Área de Teste — era a última porta, e agora não há nenhuma');
});

/**
 * `Esc` volta para a home — foi por isso que o Mundo virou uma tela de menu.
 *
 * A ordem é que importa e é o que erra calado: com um painel aberto, `Esc`
 * tem de fechar o painel ANTES de sair da tela. Sem essa camada, quem só
 * queria fechar uma caixa perde o lugar onde estava e volta ao começo da
 * floresta — e não há nada para acusar, porque sair da tela é exatamente o
 * que a tecla promete fazer.
 */
t('Esc volta para a home, e o painel aberto vem primeiro', () => {
  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  const bloco = modulo.match(/if \(e\.code === .Escape.\) \{([\s\S]*?)\n  \}/);
  assert.ok(bloco, 'o Escape deixou de ser tratado');
  assert.ok(/painelAberto\(\)/.test(bloco[1]), 'o Escape sai da tela mesmo com o painel aberto');
  assert.ok(/sairDoMundo|index\.html/.test(bloco[1]), 'o Escape não volta mais para a home');
});

/**
 * O aviso de "sem WebGL" tem de SOBREVIVER ao bootguard.
 *
 * A página mostra o aviso e então dá `throw` para parar a corrente de `await`
 * — que é como toda tela daqui para. Só que o bootguard escuta a rejeição e
 * cobre o jogo com a faixa genérica, a não ser que a frase case com o
 * `DE_PROPOSITO` dele. O regex é LIDO do bootguard, e não copiado: duas cópias
 * se desencontram na primeira mexida, e o desencontro aqui é justamente a
 * faixa voltando a tapar a única linha que explica o que aconteceu.
 */
t('a parada por falta de WebGL não vira faixa do bootguard', () => {
  const guard = readFileSync(new URL('bootguard.js', import.meta.url), 'utf8');
  const m = guard.match(/const DE_PROPOSITO = \/([^/]+)\/([a-z]*)/);
  assert.ok(m, 'não achei DE_PROPOSITO em bootguard.js');
  const deProposito = new RegExp(m[1], m[2]);

  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  const paradas = [...modulo.matchAll(/throw new Error\('([^']+)'\)/g)].map((x) => x[1]);
  const semWebgl = paradas.find((f) => /webgl/i.test(f));
  assert.ok(semWebgl, 'a página não para mais quando o WebGL falha');
  assert.ok(deProposito.test(semWebgl),
    `"${semWebgl}" não casa com o DE_PROPOSITO do bootguard — a faixa taparia o aviso`);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
