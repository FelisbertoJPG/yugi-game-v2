/**
 * A **BANCADA DE MODELOS** — arraste um `.glb` e veja se ele serve.
 *
 * Ela existe porque *"esse modelo serve?"* tem duas metades, e só uma delas se
 * responde lendo o arquivo:
 *
 * - **o tipo** — tem esqueleto? tem nó de junta? que escala? Isso é
 *   `conferirmodelo.js`, e o CLI (`tools/conferir-modelos.mjs`) faz a MESMA
 *   pergunta com o MESMO código. Duas cópias divergiriam caladas.
 * - **o lugar** — está de frente? do tamanho de gente? o braço mexe quando ele
 *   anda? Isso ninguém responde por leitura: tem de ver.
 *
 * Daí a régua e o boneco cinza ao lado. Um personagem sozinho na tela parece
 * sempre do tamanho certo — é só com um corpo de **1,72 m** encostado nele que
 * "o dobro do tamanho" vira óbvio. Foi o que aconteceu com o Kenney: ele entrava
 * com 4,27 m e os pés a 80 cm do chão, e o mundo inteiro passava a mentir junto.
 *
 * ## Nada sai daqui
 *
 * O arquivo é lido com `FileReader` e entregue ao `GLTFLoader.parse` em
 * memória. Não há upload, não há servidor, e a bancada funciona com o jogo
 * fechado — é só uma página. Isso importa porque experimentar um pacote é
 * justamente a hora em que ainda não se decidiu adotá-lo.
 *
 * ## O que erra CALADO aqui
 *
 * - **soltar o arquivo fora do alvo faz o navegador ABRIR o `.glb` numa aba** e
 *   a página vai embora com o trabalho junto. Por isso `dragover` é cancelado na
 *   janela inteira, e não só no palco.
 * - **a textura é um arquivo à parte** na maioria dos pacotes (o Kenney aponta
 *   para `Textures/texture-a.png`). Sem servidor não há de onde buscá-la, então
 *   ela é resolvida a partir do que foi arrastado junto — e, faltando, o
 *   personagem entra **branco**, que é indistinguível de uma escolha de arte.
 * - **`URL.createObjectURL` vaza** se não for revogado: uma tarde trocando
 *   modelos seguraria dezenas de arquivos na memória do navegador.
 */
import * as THREE from '/web/vendor/three/three.module.min.js';
import { GLTFLoader } from '/web/vendor/three/addons/GLTFLoader.js';
import {
  lerCabecalhoGlb, conferir, trechoDoManifesto, juntasReconhecidas, ALTURA_BONECO,
} from '/web/js/conferirmodelo.js';
import { ANCORAS } from '/web/js/modelos.js';

const $ = (id) => document.getElementById(id);

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

$('btn-teste').onclick = () => { location.href = '/web/teste.html'; };
$('btn-mundo').onclick = () => { location.href = '/web/mundo3d.html'; };

// ---------------------------------------------------------------- a cena
let renderer, scene, camera;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: true });
} catch (e) {
  $('semwebgl').hidden = false;
  console.error('[modelos] o 3D nao abriu:', e);
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1119');
scene.add(new THREE.HemisphereLight('#9fc0e0', '#3a4a2c', 1.6));
const sol = new THREE.DirectionalLight('#fff6e0', 2.0);
sol.position.set(3, 6, 4);
scene.add(sol);
scene.add(new THREE.GridHelper(10, 20, 0x3a4a6a, 0x223047));

camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
const orbita = { ang: 0.6, alt: 0.25, dist: 4.2 };
const alvoCam = new THREE.Vector3(0, 0.9, 0);

/**
 * A RÉGUA: um traço a cada metro, até 3 m, e um corpo cinza de 1,72 m.
 *
 * Sem referência, todo modelo parece do tamanho certo — é a comparação que
 * denuncia o dobro e a metade. Ela fica à ESQUERDA e o modelo no centro, para
 * que a silhueta de um encoste na do outro sem sobrepor.
 */
function referencia() {
  const g = new THREE.Group();
  const linha = new THREE.LineBasicMaterial({ color: 0x3f5878 });
  for (let m = 1; m <= 3; m++) {
    const p = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.9, m, 0), new THREE.Vector3(-1.4, m, 0),
    ]);
    g.add(new THREE.Line(p, linha));
  }
  // o corpo de referência: cápsula + cabeça, com a MESMA altura e as MESMAS
  // âncoras do boneco de verdade (`ANCORAS`, em modelos.js) — inventar números
  // aqui faria a bancada aprovar um modelo que o jogo mostra torto
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a5a70, transparent: true, opacity: 0.55 });
  const tronco = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.86, 4, 10), mat);
  tronco.position.set(-1.05, 0.86, 0);
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat);
  cabeca.position.set(-1.05, ANCORAS.cabeca[1], 0);
  g.add(tronco, cabeca);

  // o traço de 1,72 m é o número que importa, e ele é o do projeto
  const alvo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.9, ALTURA_BONECO, 0), new THREE.Vector3(0.9, ALTURA_BONECO, 0),
  ]);
  g.add(new THREE.Line(alvo, new THREE.LineBasicMaterial({ color: 0xe8c46a })));
  return g;
}
scene.add(referencia());

// ------------------------------------------------------------- o modelo
const grupo = new THREE.Group();
scene.add(grupo);

/** Os arquivos arrastados: nome → `{ url, tipo }`. As URLs SÃO revogadas. */
let anexos = new Map();
let atual = null;         // { nome, gltf, juntas: Map<junta, Object3D> }
let andando = true;

function limparCena() {
  for (const o of [...grupo.children]) {
    grupo.remove(o);
    o.traverse?.((n) => {
      n.geometry?.dispose?.();
      if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
      else n.material?.dispose?.();
    });
  }
  atual = null;
}

function soltarAnexos() {
  for (const a of anexos.values()) URL.revokeObjectURL(a.url);
  anexos.clear();
}

/**
 * Normaliza como o jogo normaliza — a MESMA conta de `modelos.js`.
 *
 * Ela é reescrita aqui (e não importada) porque lá é `function` privada; o
 * comentário existe para o próximo saber que são duas e têm de bater. Se uma
 * mudar sozinha, a bancada aprova um tamanho que o jogo não usa.
 */
function normalizar(raiz) {
  raiz.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(raiz);
  const alto = caixa.max.y - caixa.min.y;
  if (!(alto > 0.001)) return 1;
  const k = ALTURA_BONECO / alto;
  raiz.scale.multiplyScalar(k);
  raiz.updateMatrixWorld(true);
  const depois = new THREE.Box3().setFromObject(raiz);
  const meio = depois.getCenter(new THREE.Vector3());
  raiz.position.x -= meio.x;
  raiz.position.z -= meio.z;
  raiz.position.y -= depois.min.y;
  return k;
}

const loader = new GLTFLoader();

/**
 * Põe um `.glb` na cena e escreve o laudo.
 *
 * A conferência roda ANTES de carregar: um arquivo que não é `.glb` tem de dar
 * uma frase legível, e não um erro do loader lá dentro.
 */
async function usarArquivo(nome, buffer) {
  let cabecalho;
  try {
    cabecalho = lerCabecalhoGlb(buffer);
  } catch (e) {
    escreverLaudo({ nome, veredito: 'nao', notas: [['nao', e.message]], resumo: null });
    toast(e.message);
    return;
  }

  const comoPeca = $('como').value === 'peca';
  const laudo = conferir(nome, cabecalho, { comoPeca });

  // A pasta que o loader usa para procurar a textura externa. Sem servidor não
  // há de onde buscá-la, então quem resolve é `URL.createObjectURL` sobre o que
  // foi arrastado junto — e o `manager` abaixo é o gancho para isso.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const base = String(url).split('/').pop().split('?')[0];
    const a = anexos.get(base) ?? anexos.get(decodeURIComponent(base));
    return a ? a.url : url;
  });
  loader.manager = manager;

  let gltf;
  try {
    gltf = await new Promise((ok, erro) => loader.parse(buffer, '', ok, erro));
  } catch (e) {
    laudo.veredito = 'nao';
    laudo.notas.push(['nao', 'o three recusou o arquivo: ' + (e?.message ?? e)]);
    escreverLaudo(laudo);
    return;
  }

  limparCena();
  const raiz = gltf.scene;
  if (!comoPeca) normalizar(raiz);
  grupo.add(raiz);

  // as juntas, para o `andar()` da bancada girar as mesmas que o jogo gira
  const juntas = new Map();
  for (const { no, junta } of juntasReconhecidas(laudo.resumo.nos)) {
    const alvo = raiz.getObjectByName(no);
    if (alvo) juntas.set(junta, { obj: alvo, base: alvo.rotation.x });
  }
  atual = { nome, gltf, juntas, comoPeca };

  // MEDIDO depois de entrar na cena: é o número que a pessoa vê, e ele pode
  // diferir do do cabeçalho quando o exportador aninha nós com escala própria
  raiz.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(raiz);
  laudo.medido = {
    alt: caixa.max.y - caixa.min.y,
    piso: caixa.min.y,
    larg: caixa.max.x - caixa.min.x,
  };

  escreverLaudo(laudo);
  $('vazio').hidden = true;
  $('sub').textContent = nome;
}

// ------------------------------------------------------------- o laudo
const SELO = { ok: '✔', nao: '✕', '!': '!', '..': '·' };
const CLASSE = { ok: 'ok', nao: 'nao', '!': 'aviso', '..': 'info' };
const TITULO = {
  serve: ['serve', 'Pode entrar em web/modelos/ como está.'],
  ajusta: ['precisa de ajuste', 'O arquivo é do tipo certo, mas tem de ser reexportado.'],
  nao: ['não serve hoje', 'Procure outro pacote — este não é o formato que o boneco usa.'],
};

function escreverLaudo(laudo) {
  const el = $('laudo');
  el.textContent = '';

  const [titulo, explica] = TITULO[laudo.veredito];
  const cabeca = document.createElement('div');
  cabeca.className = 'veredito ' + laudo.veredito;
  const b = document.createElement('b');
  b.textContent = titulo;
  const p = document.createElement('span');
  p.textContent = explica;
  cabeca.append(b, p);
  el.appendChild(cabeca);

  for (const [nivel, texto] of laudo.notas) {
    const linha = document.createElement('div');
    linha.className = 'nota ' + (CLASSE[nivel] ?? 'info');
    const s = document.createElement('span');
    s.className = 'selo';
    s.textContent = SELO[nivel] ?? '·';
    const t = document.createElement('span');
    t.textContent = texto;
    linha.append(s, t);
    el.appendChild(linha);
  }

  if (laudo.medido) {
    const h = document.createElement('h3');
    h.textContent = 'medido na cena';
    el.appendChild(h);
    const d = document.createElement('div');
    d.className = 'nota info';
    const s = document.createElement('span');
    s.className = 'selo';
    s.textContent = '·';
    const t = document.createElement('span');
    t.textContent = `${laudo.medido.alt.toFixed(2)} m de altura · `
      + `${laudo.medido.larg.toFixed(2)} m de largura · `
      + `pés em y = ${laudo.medido.piso.toFixed(3)}`
      + (Math.abs(laudo.medido.piso) > 0.02 ? '  ← devia ser 0' : '');
    d.append(s, t);
    el.appendChild(d);
  }

  // O trecho de manifesto, pronto. Digitar seis pares `no: junta` à mão erra
  // calado: um erro de digitação não dá erro nenhum, o braço só não mexe.
  if (laudo.resumo?.nos?.length && laudo.veredito !== 'nao') {
    const h = document.createElement('h3');
    h.textContent = 'para o web/modelos/modelos.json';
    el.appendChild(h);
    const pre = document.createElement('pre');
    const caminho = 'pacote/' + laudo.nome.split(/[\\/]/).pop();
    pre.textContent = JSON.stringify(trechoDoManifesto(caminho, laudo.resumo.nos), null, 2);
    el.appendChild(pre);
  }
}

// ------------------------------------------------------- arrastar e soltar
/**
 * Ler os arquivos soltos. Aceita `.glb` e imagens no mesmo gesto: a textura
 * quase sempre é um arquivo à parte, e pedir dois arrastos faria o primeiro
 * mostrar um personagem branco — que parece o modelo, e não a falta dele.
 */
async function receber(lista) {
  const arquivos = [...lista];
  if (!arquivos.length) return;

  // as imagens primeiro: o `.glb` só resolve a textura se ela já estiver aqui
  for (const f of arquivos.filter((f2) => /\.(png|jpe?g|webp)$/i.test(f2.name))) {
    anexos.set(f.name, { url: URL.createObjectURL(f), tipo: 'textura' });
  }

  const glbs = arquivos.filter((f) => /\.(glb|vrm|gltf|vroid)$/i.test(f.name));
  if (!glbs.length) {
    toast(anexos.size ? `${anexos.size} textura(s) guardada(s) — agora arraste o modelo` : 'arraste um .glb ou .vrm');
    return;
  }

  listarArquivos(glbs);
  await usarArquivo(glbs[0].name, await glbs[0].arrayBuffer());
}

let ultimos = [];
function listarArquivos(glbs) {
  ultimos = glbs;
  const h = document.createElement('h3');
  h.textContent = `${glbs.length} arquivo(s) — clique para ver`;
  const ul = document.createElement('ul');
  ul.id = 'arquivos';
  for (const f of glbs) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.textContent = f.name;
    const m = document.createElement('span');
    m.className = 'medida';
    m.textContent = Math.round(f.size / 1024) + ' KB';
    li.append(n, m);
    li.onclick = async () => {
      for (const o of ul.children) o.classList.remove('ativo');
      li.classList.add('ativo');
      await usarArquivo(f.name, await f.arrayBuffer());
      // o laudo se reescreve inteiro, então a lista volta depois dele
      $('laudo').append(h, ul);
      li.classList.add('ativo');
    };
    ul.appendChild(li);
  }
  if (glbs.length > 1) queueMicrotask(() => $('laudo').append(h, ul));
}

// O `dragover` é cancelado na JANELA inteira: soltar fora do alvo faz o
// navegador ABRIR o .glb numa aba, e a página vai embora com o trabalho junto.
addEventListener('dragover', (e) => { e.preventDefault(); $('largar').hidden = false; });
addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('largar').hidden = true; });
addEventListener('drop', async (e) => {
  e.preventDefault();
  $('largar').hidden = true;
  await receber(e.dataTransfer?.files ?? []);
});

$('btn-abrir').onclick = () => $('entrada').click();
$('entrada').onchange = async () => { await receber($('entrada').files); $('entrada').value = ''; };
$('btn-limpar').onclick = () => {
  limparCena();
  soltarAnexos();
  $('laudo').textContent = '';
  $('vazio').hidden = false;
  $('sub').textContent = 'arraste um .glb para a tela';
};
$('como').onchange = async () => {
  if (ultimos.length) await usarArquivo(ultimos[0].name, await ultimos[0].arrayBuffer());
};
$('andar').onchange = () => { andando = $('andar').checked; };

// ----------------------------------------------------------- a órbita
let arrastando = false, ultimo = { x: 0, y: 0 };
$('cv').addEventListener('pointerdown', (e) => {
  arrastando = true; ultimo = { x: e.clientX, y: e.clientY };
  $('cv').setPointerCapture(e.pointerId);
});
addEventListener('pointerup', () => { arrastando = false; });
$('cv').addEventListener('pointermove', (e) => {
  if (!arrastando) return;
  // o mesmo referencial do Editor de Cena: arrastar para a direita OLHA para a
  // direita. Duas telas do mesmo projeto com o mouse invertido entre elas é o
  // tipo de incoerência que se sente e não se sabe nomear.
  orbita.ang += (e.clientX - ultimo.x) * 0.008;
  orbita.alt = Math.max(-0.4, Math.min(1.2, orbita.alt - (e.clientY - ultimo.y) * 0.005));
  ultimo = { x: e.clientX, y: e.clientY };
});
$('cv').addEventListener('wheel', (e) => {
  e.preventDefault();
  orbita.dist = Math.max(0.6, Math.min(20, orbita.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
    andando = !andando;
    $('andar').checked = andando;
    e.preventDefault();
  }
});

// ------------------------------------------------------------- o laço
let t0 = 0;
function quadro(agora) {
  requestAnimationFrame(quadro);
  const dt = t0 ? Math.min(0.1, (agora - t0) / 1000) : 0;
  t0 = agora;

  const l = Math.floor($('cv').clientWidth * renderer.getPixelRatio());
  const a = Math.floor($('cv').clientHeight * renderer.getPixelRatio());
  if (l && a && ($('cv').width !== l || $('cv').height !== a)) {
    renderer.setSize($('cv').clientWidth, $('cv').clientHeight, false);
    camera.aspect = $('cv').clientWidth / Math.max(1, $('cv').clientHeight);
    camera.updateProjectionMatrix();
  }

  // O ANDAR é o teste que nenhuma leitura substitui: um `.glb` com esqueleto
  // fica PARADO aqui enquanto as juntas giram, e é assim que se vê o que o
  // laudo já disse — a mesma conta do `andar()` de boneco3d.js.
  if (atual && andando) {
    const fase = agora / 1000 * 6;
    for (const [junta, { obj, base }] of atual.juntas) {
      const sinal = junta.endsWith('E') ? 1 : -1;
      if (junta.startsWith('perna') || junta.startsWith('braco')) {
        obj.rotation.x = base + Math.sin(fase) * 0.55 * sinal;
      }
    }
  } else if (atual) {
    for (const { obj, base } of atual.juntas.values()) obj.rotation.x = base;
  }
  if (atual) grupo.rotation.y += dt * 0.25;

  const h = Math.cos(orbita.alt) * orbita.dist;
  camera.position.set(
    alvoCam.x + Math.cos(orbita.ang) * h,
    alvoCam.y + Math.sin(orbita.alt) * orbita.dist,
    alvoCam.z + Math.sin(orbita.ang) * h,
  );
  camera.lookAt(alvoCam);
  renderer.render(scene, camera);

  $('medidor').textContent = atual
    ? `${atual.juntas.size} junta(s) reconhecida(s)\n${atual.comoPeca ? 'como peça' : 'como corpo'}`
    : '';
}
quadro(0);

addEventListener('beforeunload', soltarAnexos);
