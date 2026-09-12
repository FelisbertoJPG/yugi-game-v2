/**
 * A tela do **EDITOR DE CENA**: login, gaveta, salvar e abrir.
 *
 * A cena, o ponteiro e os dois modos moram em `cenaeditor.js` (`montarEditor`),
 * e a regra do que é uma cena em `cena.js` (com teste). Aqui fica só a volta —
 * é isso que deixa `tools/bancada-cena.mjs` montar o MESMO editor sem login e
 * sem servidor, em vez de ter uma cópia dele que envelhece sozinha.
 *
 * É ferramenta de ADMIN: `requireAdmin` na porta, com a RLS de `conteudo` como
 * fechadura (a cena é publicada por `pushFile`, que exige `eh_admin()`).
 */
import { requireAdmin } from '/web/js/auth.js';
import { pullFileEx, pushFile, aoGravar } from '/web/js/projectstore.js';
import { lerCena, paraGravar, ehNomeDeCena, chaveDaCena, CATALOGO, PASSOS } from '/web/js/cena.js';
import { montarEditor, estadoDaBiblioteca } from '/web/js/cenaeditor.js';
import { catalogoBase } from '/web/js/pecasbase.js';
import { juntarCatalogos, agrupar, desenharGaveta as pintarGaveta } from '/web/js/cenagaveta.js';
import { criarBoneco } from '/web/js/boneco3d.js';
import { prepararModelos } from '/web/js/modelos.js';

const $ = (id) => document.getElementById(id);

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ------------------------------------------------------------------- boot
const perfil = await requireAdmin();
if (!perfil) throw new Error('sem permissão');

/**
 * O jogador do modo **TESTAR** — o boneco de verdade, o mesmo do Mundo.
 *
 * Ele é INJETADO em vez de importado por `cenaeditor.js` porque a cadeia dele
 * (`boneco3d` → `modelos` → `GLTFLoader` + `fetch`) não existe em `file://`, e
 * `tools/bancada-cena.mjs` monta o MESMO editor a partir de um HTML solto. Sem
 * a injeção, ou a bancada quebrava ou o editor ganhava um segundo boneco só
 * dela — que envelheceria calado e provaria o corpo errado.
 *
 * `prepararModelos` é chamado na primeira vez e só nela: sem
 * `web/modelos/modelos.json` ele é UMA requisição que dá 404 e cai no
 * procedural, então quem nunca clica em Testar não paga nada.
 */
let modelosProntos = null;
async function criarJogador() {
  modelosProntos ??= prepararModelos().catch(() => null);
  await modelosProntos;
  return criarBoneco({ id: perfil.id ?? perfil.usuario ?? 'admin' });
}

$('btn-teste').onclick = () => { location.href = '/web/teste.html'; };
$('btn-mundo').onclick = () => { location.href = '/web/mundo3d.html'; };

// A biblioteca. Sem ela não há o que colocar — e isso é um estado LEGÍTIMO (as
// peças são geradas por uma ferramenta que só quem tem o ISO roda), então é
// dito na tela em vez de virar uma gaveta vazia sem explicação.
let doTagForce = [];
try {
  const r = await fetch(CATALOGO);
  if (r.ok) doTagForce = (await r.json())?.pecas ?? [];
} catch { /* sem a biblioteca importada: as peças BASE bastam, ver abaixo */ }

// As peças base são geradas em código e existem sempre. É o que faz o editor
// abrir com o que colocar mesmo sem a biblioteca do Tag Force — que é gerada
// por uma ferramenta que só roda em quem tem o ISO.
const catalogo = juntarCatalogos(catalogoBase(), doTagForce);

if (!doTagForce.length) {
  $('semlib').hidden = false;
  $('semlib').innerHTML = 'Sem os modelos do <b>Tag Force</b> — só as peças base.<br>'
    + 'Gere-os com <code>node tools/tagforce/pecas.mjs &lt;pasta do PSP_GAME&gt;</code>.';
}

/**
 * Os botões da gaveta, por id. **Declarado ANTES de montar o editor**, e isso
 * não é arrumação: `montarEditor` chama `aoMudar` uma vez antes de devolver
 * (para a tela pintar o estado inicial), e `pintar` chega até aqui. Com o
 * `let` embaixo, essa primeira chamada caía na ZONA MORTA TEMPORAL — um
 * `ReferenceError: Cannot access 'botoes' before initialization` que o `catch`
 * do editor engolia e reportava como *"este navegador não abriu o 3D"*.
 *
 * A tela acusava o navegador de um defeito que era meu, e a mensagem era
 * convincente: quem a lê troca de navegador em vez de abrir o console.
 */
let botoes = new Map();

// -------------------------------------------------------------- o editor
let editor;
try {
  editor = montarEditor($('cv'), { aoMudar: pintar, criarJogador });
} catch (e) {
  // Sem tratamento isto é uma tela preta: o `WebGLRenderer` levanta quando não
  // consegue contexto, e a exceção morre dentro do módulo.
  //
  // Mas o `catch` pega TUDO, e um erro meu aqui dentro viraria uma acusação ao
  // navegador — foi o que aconteceu: um `ReferenceError` de zona morta saiu na
  // tela como "este navegador não abriu o 3D". Culpa mal atribuída é pior que
  // erro nenhum: quem lê aquilo troca de navegador em vez de abrir o console.
  const ehWebGL = /webgl|context/i.test(String(e?.message ?? e));
  console.error('[cena] o editor não montou:', e);
  if (ehWebGL) {
    $('semwebgl').hidden = false;
  } else {
    // O `bootguard` já desenha a faixa de "esta tela não terminou de abrir" a
    // partir do erro que sobe daqui — e ela diz a verdade, que é "quebrou",
    // sem inventar a causa.
    $('semwebgl').hidden = false;
    $('semwebgl').textContent = 'O editor não abriu: ' + (e?.message ?? e);
  }
  throw e;   // sobe o erro ORIGINAL: a pilha é o que diz onde foi
}

// Sem o catálogo o editor não sabe a `dim` nem o `modulo` de cada peça — e sem
// isso não há grade que gruda por módulo nem caixa de colisão do tamanho certo.
editor.usarCatalogo(catalogo);

/** O que o pincel faz, em palavra — o seletor e a faixa dizem a MESMA coisa. */
const DIZER = { levantar: 'levantar', cavar: 'cavar', aplainar: 'aplainar' };

/** Redesenha tudo o que depende do estado — chamado pelo editor a cada mudança. */
function pintar({ cena, selecionado, modo, peca, item, passo, verColisoes, escalaDoProximo,
                 pincel, modoApagar, testando, pode, aviso }) {
  if (aviso) toast(aviso);
  $('btn-testar').classList.toggle('ligado', !!testando);
  $('btn-testar').textContent = testando ? '■ sair do teste' : '▶ testar';
  $('modo').classList.toggle('testando', !!testando);
  // Testando, a lateral inteira sai do caminho: ela edita a cena, e editar por
  // baixo do boneco mudaria justamente os colisores que se está provando.
  $('lateral-edicao').hidden = !!testando;
  $('btn-relevo').classList.toggle('ligado', !!pincel);
  $('btn-apagar-modo').classList.toggle('ligado', !!modoApagar);
  $('modo').classList.toggle('relevo', modo === 'relevo');
  $('modo').classList.toggle('apagando', modo === 'apagar');
  // Os botões de desfazer/refazer dizem se HÁ o que desfazer. Um botão que
  // parece clicável e não faz nada é indistinguível de um editor quebrado.
  $('btn-desfazer').disabled = !pode?.desfazer;
  $('btn-refazer').disabled = !pode?.refazer;
  $('passo').value = String(passo ?? 1);
  $('btn-colisoes').classList.toggle('ligado', !!verColisoes);
  $('proximo').hidden = modo !== 'por';
  if (modo === 'por') $('proximo').textContent = `tamanho: ${(escalaDoProximo ?? 1).toFixed(2)}×`;
  // o MODO é a informação mais importante da tela: é ele que explica por que o
  // clique põe em vez de selecionar, e sem ele o editor parece quebrado
  $('modo').textContent = modo === 'testar'
    ? 'testando — WASD anda, Shift corre, Esc sai'
    : modo === 'relevo'
    ? `relevo: ${DIZER[pincel?.modo] ?? 'levantar'} — arraste no chão`
    : modo === 'apagar' ? 'apagando — cada clique apaga (Esc sai)'
    : modo === 'por' ? `pondo: ${peca}`
    : (selecionado >= 0 ? 'peça selecionada' : 'clique numa peça da cena');
  $('modo').classList.toggle('pondo', modo === 'por');
  $('btn-largar').hidden = modo !== 'por';

  $('selecao').hidden = !item;
  if (item) {
    $('sel-nome').textContent = item.peca;
    $('sel-giro').value = Math.round((item.giro * 180) / Math.PI);
    $('sel-escala').value = Math.round(item.escala * 100);
    $('sel-altura').value = Math.round(item.y * 100);
    mostrarNumeros();
    pintarColisor(item);
  }

  const b = estadoDaBiblioteca();
  $('medidor').textContent =
    `${cena.itens.length} peças · ${editor?.triangulos().toLocaleString('pt-BR') ?? 0} triângulos`;
  $('sub').textContent = `${catalogo.length} na gaveta · ${b.pecas} carregadas`;
  marcarGaveta(peca);
}

/** O painel do COLISOR, a partir do item selecionado. */
function pintarColisor(item) {
  const col = item?.col;
  const ligado = col !== false;
  $('col-liga').checked = ligado;
  // o resto do painel não some quando o colisor está desligado, fica INERTE:
  // sumir move os controles de lugar e a caixa marcada muda de posição embaixo
  // do dedo de quem acabou de clicar nela
  for (const id of ['col-ex', 'col-ey', 'col-ez', 'col-dy', 'col-zerar']) $(id).disabled = !ligado;

  const a = (col && col !== false) ? col : { ex: 1, ey: 1, ez: 1, dy: 0 };
  $('col-ex').value = Math.round(a.ex * 100);
  $('col-ey').value = Math.round(a.ey * 100);
  $('col-ez').value = Math.round(a.ez * 100);
  $('col-dy').value = Math.round(a.dy * 100);
  for (const [id, sufixo, div] of [
    ['col-ex', '×', 100], ['col-ey', '×', 100], ['col-ez', '×', 100], ['col-dy', ' m', 100],
  ]) {
    $(id + '-v').textContent = ($(id).value / div).toFixed(2) + sufixo;
  }

  const r = editor.resolvido(item.peca);
  $('col-estado').textContent = col === false ? '— desligado neste item'
    : col ? '— ajustado'
    : r.colide ? '— padrão (barra)' : '— padrão (não barra)';
}

function mostrarNumeros() {
  $('sel-giro-v').textContent = $('sel-giro').value + '°';
  $('sel-escala-v').textContent = ($('sel-escala').value / 100).toFixed(2) + '×';
  $('sel-altura-v').textContent = ($('sel-altura').value / 100).toFixed(2) + ' m';
}

// ------------------------------------------------------------- a gaveta
function desenharGaveta() {
  // clicar de novo na mesma peça LARGA — é a saída mais perto da mão de quem
  // acabou de pegá-la, e não exige descobrir o Esc
  botoes = pintarGaveta($('gaveta'), agrupar(catalogo, $('busca').value), (id) => editor.pegarPeca(id), {
    regras: editor?.regras?.(),
    // trocar uma regra REDESENHA a gaveta: o seletor da exceção só aparece
    // depois que a classe foi mexida, e sem o redesenho ele não surgiria até a
    // próxima busca — a exceção pareceria não existir
    aoMudarRegra: (onde, chave, campo, valor) => {
      editor.mudarRegra(onde, chave, campo, valor);
      desenharGaveta();
    },
  });
  marcarGaveta(editor?.pecaNaMao?.() ?? null);
}

function marcarGaveta(ativa) {
  for (const [id, b] of botoes) b.classList.toggle('ativa', id === ativa);
}

$('busca').oninput = desenharGaveta;
$('btn-largar').onclick = () => editor.largarPeca();

for (const [id, campo, conta] of [
  ['sel-giro', 'giro', (v) => (v * Math.PI) / 180],
  ['sel-escala', 'escala', (v) => v / 100],
  ['sel-altura', 'y', (v) => v / 100],
]) {
  $(id).oninput = () => { editor.trocar({ [campo]: conta(Number($(id).value)) }); mostrarNumeros(); };
}
$('btn-apagar').onclick = () => editor.apagar();
$('btn-assentar').onclick = () => editor.assentar();
$('btn-colisoes').onclick = () => editor.mostrarColisoes();
$('passo').onchange = () => editor.passo(Number($('passo').value));
const ajustesDoPincel = () => ({
  raio: Number($('pincel-raio').value),
  modo: $('pincel-modo').value,
});
$('btn-relevo').onclick = () => editor.usarPincel(editor.pincel() ? null : ajustesDoPincel());
// Trocar o raio ou o modo com o pincel DESLIGADO não o liga: quem mexe no
// seletor está se preparando, não pedindo para esculpir agora.
for (const id of ['pincel-raio', 'pincel-modo']) {
  $(id).onchange = () => { if (editor.pincel()) editor.usarPincel(ajustesDoPincel()); };
}
$('btn-duplicar').onclick = () => editor.duplicar();
$('btn-apagar-modo').onclick = () => editor.usarModoApagar();
$('btn-desfazer').onclick = () => editor.desfazer();
$('btn-testar').onclick = () => editor.testar();

// ------------------------------------------------------------- o colisor
$('col-liga').onchange = () => editor.ajustarColisor($('col-liga').checked ? null : false);
$('col-zerar').onclick = () => editor.ajustarColisor(null);
for (const [id, campo] of [['col-ex', 'ex'], ['col-ey', 'ey'], ['col-ez', 'ez'], ['col-dy', 'dy']]) {
  $(id).oninput = () => editor.ajustarColisor({ [campo]: Number($(id).value) / 100 });
}
$('btn-refazer').onclick = () => editor.refazer();

// -------------------------------------------------------- abrir e salvar
const conhecidas = () => new Set(catalogo.map((p) => p.id));

$('btn-abrir').onclick = async () => {
  const nome = $('nome-cena').value.trim();
  if (!ehNomeDeCena(nome)) { toast('o nome tem de ser tipo "praca" ou "academia-2"'); return; }
  const r = await pullFileEx(chaveDaCena(nome));
  if (!r.alcancou && r.data == null) { toast('não achei essa cena'); return; }

  const cena = lerCena(r.data, conhecidas());
  const faltaram = await editor.usarCena(cena);
  $('nome-cena').value = cena.nome === 'nova' ? nome : cena.nome;

  // "faltou" é normal; "faltou e ninguém viu" não é
  if (cena.faltando.length) toast(`${cena.faltando.length} peça(s) não existem mais na biblioteca`);
  else if (faltaram) toast(`${faltaram} peça(s) não carregaram`);
  else if (cena.descartados) toast(`${cena.descartados} item(ns) da cena estavam tortos`);
  else toast(`cena "${cena.nome}" aberta`);
};

$('btn-salvar').onclick = () => {
  const nome = $('nome-cena').value.trim();
  if (!ehNomeDeCena(nome)) { toast('o nome tem de ser tipo "praca" ou "academia-2"'); return; }
  const cena = { ...editor.cenaAtual(), nome };
  // `pushFile` é fire-and-forget de propósito (a tela não pode esperar a rede),
  // e é `aoGravar` que diz o que aconteceu — sem ele, um 403 de sessão vencida
  // gravaria o disco, a tela diria "salvo" e a cena não existiria para mais
  // ninguém. É a armadilha que o `projectstore.js` documenta.
  aoGravar(chaveDaCena(nome), ({ banco, disco }) => {
    if (banco?.ok) toast(`cena "${nome}" publicada`);
    else if (disco?.ok) toast(`salva em disco — a nuvem recusou: ${banco?.erro ?? 'sem conexão'}`);
    else toast('não consegui salvar');
  });
  pushFile(chaveDaCena(nome), paraGravar(cena));
};

desenharGaveta();
