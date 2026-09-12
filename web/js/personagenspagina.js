/**
 * A **Página de Personagens** — escolher quem é o seu corpo no Mundo.
 *
 * O vestiário do Mundo (tecla **V**) responde *"o que eu visto"*; esta tela
 * responde *"quem eu sou"*. As duas gravam no MESMO lugar
 * (`perfis.aparencia`), pelo mesmo `paraGravar` e pelo mesmo `PATCH` — uma
 * segunda porta de escrita divergiria da primeira no dia em que o gatilho da
 * 0054 ganhasse uma regra.
 *
 * ## O catálogo sai do ELENCO, não de uma lista à mão
 *
 * Os personagens são os adversários que o jogo já tem (`npcs.js`), pintados
 * pela mesma `coresPara(id)` que já os desenha nos dois mundos. Uma terceira
 * lista aqui envelheceria a cada adversário novo, e o sintoma seria o pior
 * tipo: uma tela plausível, faltando gente.
 *
 * ## A prévia é 3D, e não uma foto
 *
 * Personagem se julga OLHANDO, e uma miniatura não mostra o que a escolha faz.
 * O boneco da prévia é o `criarBoneco` de VERDADE, com a MINHA aparência —
 * então o que está na tela é literalmente o que vai para a floresta, e não uma
 * segunda montagem que divergiria da primeira sem ninguém ver.
 *
 * > **Sem WebGL a tela continua funcionando.** A prévia some e a lista fica: a
 * > escolha não depende de desenhar. Uma página que morre inteira porque o 3D
 * > não subiu é pior do que uma sem prévia.
 */
import * as THREE from '/web/vendor/three/three.module.min.js';
import { requireLogin } from '/web/js/auth.js';
import { contaAtual, req } from '/web/js/supabase.js';
import { NPCS, hydrateCustomNpcs } from '/web/js/npcs.js';
import { coresPara } from '/web/js/actors.js';
import { normalizar, paraGravar } from '/web/js/aparencia.js';
import { prepararModelos } from '/web/js/modelos.js';
import { criarBoneco, ALTURA } from '/web/js/boneco3d.js';
import { catalogoDe, acharPersonagem, PERSONAGEM_PADRAO } from '/web/js/personagens.js';
import { prepararPersonagens, estadoDosPersonagens } from '/web/js/personagens3d.js';

const $ = (id) => document.getElementById(id);

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ------------------------------------------------------------------- boot
const usuario = await requireLogin();
if (!usuario) throw new Error('sem sessão');

const conta = await contaAtual().catch(() => null);
const meuId = conta?.id ?? null;

let aparenciaSalva = null;
if (meuId) {
  const r = await req(`perfis?select=aparencia&id=eq.${encodeURIComponent(meuId)}`)
    .catch(() => ({ ok: false }));
  if (r.ok && r.dados?.[0]) aparenciaSalva = r.dados[0].aparencia;
}
let minhaAparencia = normalizar(aparenciaSalva, meuId);

$('btn-home').onclick = () => { location.href = '/web/index.html'; };
$('btn-mundo').onclick = () => { location.href = '/web/mundo3d.html'; };
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('btn-home').click(); });

// A arte modelada. Sem ela não há personagem para escolher — e isso é um
// estado legítimo (o `.glb` pode não ter viajado), então é DITO na tela em vez
// de virar uma grade vazia.
await hydrateCustomNpcs().catch(() => {});
const arte = await prepararModelos();
const catalogo = catalogoDe(NPCS, coresPara);
const pintados = prepararPersonagens(catalogo);

let escolhido = acharPersonagem(catalogo, minhaAparencia.personagem?.peca).id;

if (!pintados.base) {
  // `arte.ok` conta o que carregou; sem corpo, a única escolha honesta é o padrão.
  $('semcorpo').hidden = false;
  $('semcorpo').innerHTML = 'Nenhum <b>corpo modelado</b> foi carregado, então não há '
    + 'personagem para escolher — o Mundo desenha o boneco de sempre.<br><br>'
    + 'Isso é normal quando <code>web/modelos/modelos.json</code> não veio no pacote. '
    + 'Ver <code>web/modelos/README.md</code>.';
  $('catalogo').hidden = true;
}

// ------------------------------------------------------------------ a lista
$('cabecalho').textContent = pintados.base
  ? `${catalogo.length} personagens — o seu é o destacado`
  : 'sem corpo modelado';

function desenharLista() {
  const lista = $('catalogo');
  lista.textContent = '';
  for (const p of catalogo) {
    const b = document.createElement('button');
    b.className = 'cartao' + (p.id === escolhido ? ' escolhido' : '');
    b.type = 'button';

    // A "cara" do cartão é a COR do personagem, e não um recorte da textura:
    // o rosto mora numa região do atlas que ninguém declara em lugar nenhum, e
    // um retângulo escrito à mão aqui apontaria para o lugar errado no dia em
    // que a arte mudasse — mostrando um pedaço de calça como se fosse rosto.
    const rosto = document.createElement('div');
    rosto.className = 'rosto';
    if (p.cor) rosto.style.background = p.cor;
    b.appendChild(rosto);

    const nome = document.createElement('div');
    nome.className = 'nome';
    // Nome de adversário é conteúdo editável por admin: `textContent`, nunca `innerHTML`.
    nome.textContent = p.nome;
    b.appendChild(nome);

    b.onclick = () => { escolhido = p.id; desenharLista(); mostrar(); };
    lista.appendChild(b);
  }
  $('btn-usar').disabled = !pintados.base
    || escolhido === (minhaAparencia.personagem?.peca ?? PERSONAGEM_PADRAO);
}

// ------------------------------------------------------------------ o 3D
let renderer = null, cena = null, camera = null, boneco = null;
let giro = -0.35, arrastando = false, ultimoX = 0;

function iniciar3d() {
  const cv = $('cv');
  try {
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  } catch (e) {
    // Sem tratamento isto é uma tela preta: o construtor levanta quando não há
    // contexto, e a exceção morre dentro do módulo.
    console.error('[personagens] WebGL recusado:', e);
    $('semwebgl').hidden = false;
    $('girar').hidden = true;
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  cena = new THREE.Scene();
  cena.background = new THREE.Color('#0e1119');
  cena.add(new THREE.HemisphereLight('#9fc0e0', '#3a4a2c', 1.6));
  const sol = new THREE.DirectionalLight('#fff6e0', 2.2);
  sol.position.set(2.5, 4, 3);
  cena.add(sol);

  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);

  cv.addEventListener('pointerdown', (e) => { arrastando = true; ultimoX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointerup', () => { arrastando = false; });
  cv.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    giro -= (e.clientX - ultimoX) * 0.01;
    ultimoX = e.clientX;
  });
  return true;
}

function mostrar() {
  const p = acharPersonagem(catalogo, escolhido);
  $('nome-atual').textContent = p.nome;
  if (!cena) return;
  if (boneco) { cena.remove(boneco.grupo); boneco.descartar?.(); boneco = null; }
  boneco = criarBoneco({
    id: meuId,
    aparencia: { ...minhaAparencia, personagem: { peca: escolhido } },
  });
  boneco.grupo.position.y = 0;
  cena.add(boneco.grupo);
}

function quadro() {
  requestAnimationFrame(quadro);
  if (!renderer) return;
  const cv = $('cv');
  // O tamanho é reconferido no LAÇO, e não num `ResizeObserver`: mexer no
  // layout dentro da entrega de um observer deixa notificação pendente, o
  // navegador dispara "ResizeObserver loop…", isso chega como ErrorEvent na
  // window e o `bootguard` cobre a tela com a faixa de erro. Já aconteceu aqui.
  const l = Math.floor(cv.clientWidth * renderer.getPixelRatio());
  const a = Math.floor(cv.clientHeight * renderer.getPixelRatio());
  if (l && a && (cv.width !== l || cv.height !== a)) {
    renderer.setSize(cv.clientWidth, cv.clientHeight, false);
    camera.aspect = cv.clientWidth / Math.max(1, cv.clientHeight);
    camera.updateProjectionMatrix();
  }
  if (boneco) boneco.grupo.rotation.y = giro;
  const alvo = ALTURA * 0.55;
  camera.position.set(0, alvo + 0.15, 2.6);
  camera.lookAt(0, alvo, 0);
  renderer.render(cena, camera);
}

// ---------------------------------------------------------------- salvar
$('btn-usar').onclick = async () => {
  const botao = $('btn-usar');
  botao.disabled = true;
  try {
    const corpo = paraGravar({ ...minhaAparencia, personagem: { peca: escolhido } }, meuId);
    const r = await req(`perfis?id=eq.${encodeURIComponent(meuId)}`, {
      method: 'PATCH', body: { aparencia: corpo },
    });
    // Quem tem a palavra é o gatilho `perfis_aparencia_valida` (0054): no dia em
    // que um personagem for vendido em `itens`, é ele que recusa quem não o tem.
    if (!r.ok) { toast(r.erro || 'não consegui salvar'); return; }
    minhaAparencia = corpo;
    toast('personagem salvo');
  } catch (e) {
    // Roda num `onclick`: uma rejeição solta viraria a faixa do `bootguard` por
    // cima de uma tela que abriu inteira.
    console.error('[personagens] falhou ao salvar:', e);
    toast('não consegui salvar');
  } finally {
    desenharLista();
  }
};

// "Faltou" é normal; "faltou e ninguém viu" não é.
console.info('[personagens] modelos:', arte.ok + '/' + arte.pedidos,
  '| variantes pintadas:', estadoDosPersonagens().variantes, 'de', catalogo.length - 1);

if (iniciar3d()) quadro();
desenharLista();
mostrar();
