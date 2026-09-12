/**
 * O **EDITOR DE CENA** — a cena 3D, o ponteiro e os dois modos.
 *
 * `cena.js` decide (o que é um item válido, o que é uma cena legível) e tem
 * teste; isto aqui desenha e responde ao mouse. `cenapagina.js` põe a volta
 * (login, gaveta, salvar) e `tools/bancada-cena.mjs` põe outra — as duas
 * chamam `montarEditor`, e **nenhuma tem cópia da interação**.
 *
 * > Isso não é organização por gosto: a primeira versão da bancada tinha a
 * > interação copiada, e o primeiro pedido de mudança (o fantasma que segue o
 * > mouse) teria sido feito num lugar e não no outro. Duas cópias divergem
 * > caladas — a bancada continuaria "funcionando", provando o editor de ontem.
 *
 * ---
 *
 * ## OS DOIS MODOS, que são a interface inteira
 *
 * | modo | quando | o clique |
 * |---|---|---|
 * | **por** | há uma peça escolhida na gaveta | põe uma cópia dela |
 * | **escolher** | não há | seleciona / arrasta o que já está na cena |
 *
 * Sem essa separação, o clique tem de adivinhar a intenção — e adivinhava
 * errado: com uma peça escolhida, clicar num objeto para apagá-lo punha outro
 * em cima dele. `Esc` (ou clicar de novo na peça da gaveta) larga a peça e
 * devolve o ponteiro.
 *
 * ## O FANTASMA
 *
 * No modo "por", a peça segue o ponteiro pelo chão, translúcida. Ele responde à
 * pergunta que o clique respondia tarde demais: *onde isto vai cair, e de que
 * tamanho é?* — antes, descobria-se pondo, e corrigia-se arrastando.
 *
 * Ele **não entra na cena** e **não é alvo de raycast**: é decoração de
 * ponteiro. Fosse um item, apareceria no contador, entraria no arquivo salvo e
 * o raio bateria nele em vez de no chão — o arrasto começaria mirando o próprio
 * cursor.
 *
 * ## O que erra CALADO aqui
 *
 * - **arrastar é raycast contra um PLANO, não contra a peça.** Mirando na
 *   malha, a peça foge do cursor assim que sai de baixo dele (o raio deixa de
 *   acertá-la) e o arrasto morre no meio. O plano é infinito e está sempre lá.
 * - **a peça é baixada UMA vez e a geometria é COMPARTILHADA** entre as cópias.
 *   Uma fileira de vinte cercas seriam vinte malhas na GPU; e descartar a de
 *   uma apagaria a das outras — o mesmo defeito que o cache de `boneco3d.js` já
 *   documenta.
 * - **a textura precisa de `colorSpace` e `RepeatWrapping`.** Sem o primeiro
 *   ela sai lavada (não quebra, só fica errado); sem o segundo, um UV que passa
 *   de 0..1 estica a última fileira de pixels pela peça inteira.
 */
import * as THREE from '/web/vendor/three/three.module.min.js';
import {
  cenaVazia, acrescentar, mexer, remover, duplicar, caminhoDaPeca, caminhoDaTextura,
  grudar, passoDe, caixaDoItem, alturaDePouso, PASSO_PADRAO, LIMITE,
  relevoVazio, alturaDoRelevo, esculpir, aplainar, relevoNaArea, temRelevo, PASSO_RELEVO,
  terrenoCoberto, criarHistorico, colisoresDaCena, caixaDeColisao,
  segueRelevo, colide, porRegra, regrasVazias, colisorNeutro, lerColisor,
} from '/web/js/cena.js';
// A COLISÃO do teste é a do Mundo, e não uma segunda: `mover`/`livre` são as
// mesmas funções que movem o jogador na floresta. Uma cópia aqui divergiria
// calada, e o sintoma seria o pior que este editor pode produzir — um ambiente
// aprovado no teste e intransitável no jogo.
import { MUNDO, mover, livre } from '/web/js/floresta.js';
import { ehPecaBase, geometriaBase, ladoDoTerreno } from '/web/js/pecasbase.js';
import { subdividir, deformarPeloRelevo } from '/web/js/malha.js';

/** Peças já baixadas: id → `{ geo, mat }`, compartilhados por todas as cópias. */
const _pecas = new Map();
/** Texturas por slug, compartilhadas entre peças (dezenas usam a mesma madeira). */
const _texturas = new Map();

const SEM_TEXTURA = 0xb9bcc2;

/**
 * De onde vem a malha de uma peça. Trocável para a bancada, que embute tudo no
 * HTML — `file://` não faz `fetch` de arquivo local, então um editor que só
 * soubesse buscar por rede abriria vazio lá e não provaria nada.
 */
async function buscarPadrao(id) {
  const r = await fetch(caminhoDaPeca(id));
  return r.ok ? r.json() : null;
}

function texturaDe(slug, urlDaTextura) {
  if (!slug) return null;
  const pronta = _texturas.get(slug);
  if (pronta) return pronta;
  const t = new THREE.TextureLoader().load(urlDaTextura(slug));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _texturas.set(slug, t);
  return t;
}

/**
 * Baixa uma peça (ou devolve a que já está em memória). **Nunca levanta**:
 * peça que não carrega devolve `null`, e quem chama decide — o editor avisa, o
 * Mundo pula. Derrubar a cena por causa de uma peça seria perder o resto.
 */
export async function carregarPeca(id, { buscar = buscarPadrao, urlDaTextura = caminhoDaTextura } = {}) {
  const pronta = _pecas.get(id);
  if (pronta) return pronta;

  // As peças BASE são geradas em código (`pecasbase.js`) e não têm arquivo:
  // custam zero byte no `game.zip` e existem mesmo sem a biblioteca do Tag
  // Force, que é gerada por uma ferramenta que só roda em quem tem o ISO.
  //
  // A cor delas vem no VÉRTICE (é assim que a floresta pinta tronco e copa numa
  // malha só), então o material precisa de `vertexColors`. Sem isso a peça sai
  // BRANCA — não quebra nada, e é indistinguível de arte ruim.
  if (ehPecaBase(id)) {
    const geo = geometriaBase(id);
    if (!geo) return null;
    geo.computeBoundingSphere();
    const feita = { geo, mat: new THREE.MeshLambertMaterial({ vertexColors: true }), id };
    _pecas.set(id, feita);
    return feita;
  }

  try {
    const d = await buscar(id);
    if (!Array.isArray(d?.pos) || !d.pos.length) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    if (Array.isArray(d.nor) && d.nor.length === d.pos.length) {
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    }
    if (Array.isArray(d.uv) && d.uv.length === (d.pos.length / 3) * 2) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    }
    if (Array.isArray(d.idx) && d.idx.length) geo.setIndex(d.idx);
    // sem normal no arquivo a peça fica preta sob luz direcional, sem erro
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const tex = texturaDe(d.tex, urlDaTextura);
    const mat = tex
      ? new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.35 })
      : new THREE.MeshLambertMaterial({ color: SEM_TEXTURA, side: THREE.DoubleSide });

    const feita = { geo, mat, id };
    _pecas.set(id, feita);
    return feita;
  } catch {
    return null;
  }
}

/** Põe posição, giro e escala do item no objeto. */
export function aplicar(obj, item) {
  obj.position.set(item.x, item.y, item.z);
  obj.rotation.set(0, item.giro, 0);
  obj.scale.setScalar(item.escala);
}

/**
 * Onde no CHÃO o ponteiro está mirando.
 *
 * A resposta é `null` quando o raio é paralelo ao plano (câmera no nível do
 * horizonte) — devolver um ponto ali jogaria a peça no infinito, o `LIMITE` de
 * `cena.js` a prenderia na borda do mapa, e ela "escaparia" do cursor sem
 * explicação nenhuma.
 */
export function miraNoChao(raycaster, altura = 0) {
  const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -altura);
  const onde = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plano, onde) ? { x: onde.x, y: altura, z: onde.z } : null;
}

/** Diagnóstico — "faltou" é normal, "faltou e ninguém viu" não é. */
export const estadoDaBiblioteca = () => ({ pecas: _pecas.size, texturas: _texturas.size });

/** Devolve tudo à GPU. Só no fim da página: a geometria é compartilhada. */
export function descartarBiblioteca() {
  for (const p of _pecas.values()) { p.geo.dispose(); p.mat.dispose(); }
  for (const t of _texturas.values()) t.dispose();
  _pecas.clear(); _texturas.clear();
}

/**
 * Monta o editor inteiro sobre um `<canvas>`. Devolve a API que a tela usa —
 * a tela cuida de login, gaveta e salvar; daqui para dentro é a cena.
 *
 * `aoMudar({ cena, selecionado, modo, peca })` é chamado a cada mudança de
 * estado, e é por ele que a tela redesenha a gaveta e os controles.
 */
export function montarEditor(canvas, { aoMudar = () => {}, carregar = {}, criarJogador = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e1119');
  scene.add(new THREE.HemisphereLight('#9fc0e0', '#3a4a2c', 1.5));
  const sol = new THREE.DirectionalLight('#fff6e0', 2.0);
  sol.position.set(30, 50, 20);
  scene.add(sol);
  // a grade é a referência de escala: sem ela, "parece certo" vira o único
  // critério para o tamanho de uma peça
  scene.add(new THREE.GridHelper(120, 60, 0x3a4a6a, 0x223047));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
  const alvoCam = new THREE.Vector3(0, 0, 0);
  const orbita = { ang: 0.9, alt: 0.85, dist: 34 };
  /**
   * Radianos por pixel do botão direito. Declarada AQUI, com a órbita, e não
   * junto do ouvinte que a usa: `const` lida antes da declaração é
   * `ReferenceError`, e um erro assim num ouvinte de mouse só aparece no
   * primeiro arrasto — depois de a tela já ter aberto dizendo que está tudo bem.
   *
   * O vertical é mais lento de propósito: ele percorre um arco preso (`0,08` a
   * `1,5` rad, do rasante ao quase de cima), e na mesma sensibilidade do
   * horizontal o gesto bate na trava nos dois sentidos antes de a mão terminar
   * o movimento.
   */
  const GIRO = { horizontal: 0.006, vertical: 0.004 };

  /**
   * A velocidade do jogador no modo TESTAR, em m/s. São os números do Mundo
   * (`VEL`/`VEL_CORRIDA` em `mundo3d.js`) — testar com outra velocidade daria
   * um vão que "dá para passar correndo" aqui e não lá.
   */
  const VEL = 4.4, VEL_CORRIDA = 8.2;

  const grupo = new THREE.Group();
  scene.add(grupo);

  const contorno = new THREE.BoxHelper(new THREE.Object3D(), 0xe8c46a);
  contorno.visible = false;
  scene.add(contorno);

  let cena = cenaVazia('nova');
  const objetos = [];          // paralelo a cena.itens; `null` = peça não carregou
  let selecionado = -1;
  let pecaNaMao = null;        // a peça escolhida na gaveta — o "pincel"
  let fantasma = null;         // a prévia que segue o ponteiro

  // Giro e tamanho do PRÓXIMO a ser posto: quem monta uma fileira gira uma vez
  // e põe dez. Sem isso, cada peça nasceria reta e teria de ser girada de novo.
  // Declarados ANTES dos ouvintes que os leem — com `let`, uma leitura antes da
  // declaração é ReferenceError, e ele só apareceria no primeiro movimento do
  // mouse, num caminho que nenhum teste de carga alcança.
  let giroDoProximo = 0, escalaDoProximo = 1;

  /** O passo da grade. `0` = livre. Peça com `modulo` usa o dela (ver `passoDe`). */
  let passo = PASSO_PADRAO;
  /** O catálogo, para saber `dim` e `modulo` de cada peça. Vem da tela. */
  let catalogo = new Map();
  /** As caixas de colisão desenhadas (a camada que se liga e desliga). */
  let verColisoes = false;
  /**
   * O modo APAGAR (`Del`): o clique apaga o que acertar, sem selecionar antes.
   * Limpar uma área era selecionar–apagar–selecionar–apagar, e a metade do
   * trabalho era clicar em nada para largar a seleção anterior.
   */
  let modoApagar = false;
  /** `Ctrl+Z` / `Ctrl+Y`. Guarda cenas inteiras — ver `criarHistorico`. */
  const historico = criarHistorico();
  /**
   * Um gesto ABERTO é um arrasto (ou um segurar de tecla) que ainda está
   * acontecendo. Sem ele, arrastar uma peça por dois segundos empilharia
   * sessenta estados no histórico e o `Ctrl+Z` andaria um pixel por vez —
   * "desfazer" que não desfaz nada visível é pior que não ter.
   */
  let gestoAberto = false;
  /** As teclas de câmera seguradas agora (WASD). O laço é quem move. */
  const teclasDaCamera = new Set();
  let instanteDoQuadro = 0;

  /**
   * O modo **TESTAR**: `null` = desligado; senão, o jogador está na cena.
   *
   * Ele é o único modo que responde a uma pergunta que o editor sozinho não
   * responde: *dá para ANDAR aqui?* O contorno de colisão (`C`) mostra as
   * caixas, mas caixa desenhada não diz se sobrou passagem entre duas árvores,
   * se a rampa do morro é subível, ou se o piso que se acabou de montar tem uma
   * fresta que prende os pés. Isso só se sabe andando.
   */
  let teste = null;   // { boneco, altura, x, z, giro, andado, colisores, camera:{...} }
  /** O pincel de relevo: `null` = desligado. */
  let pincel = null;   // { raio, forca, modo: 'levantar'|'cavar'|'aplainar' }
  /**
   * A ALTURA em que a pincelada começou. Durante o arrasto o pincel mira num
   * plano horizontal nessa altura, e não na malha viva.
   *
   * Mirar na malha viva parece mais certo e é instável: a cada pincelada a
   * superfície sob o cursor muda, o raio passa a encontrá-la noutro ponto, e o
   * pincel ANDA sozinho. Cavando, o ponto foge para longe da câmera (o raio
   * atravessa mais fundo antes de bater) e o buraco vira um risco comprido e
   * raso, indo embora do cursor; levantando, o ponto vem para perto e o efeito
   * se contém sozinho. É por isso que o relevo parecia "só criar morro": o
   * modo de cavar existia e fugia da mão.
   */
  let planoDoPincel = 0;
  const caixas = new THREE.Group();
  caixas.visible = false;
  scene.add(caixas);

  const infoDaPeca = (id) => catalogo.get(id) ?? null;
  const dimDe = (id) => infoDaPeca(id)?.dim ?? null;

  /**
   * A PEGADA de uma peça, para saber que pedaço de relevo ela cobre.
   *
   * As placas base declaram o lado (`terreno`); as importadas só têm a `dim`
   * medida. Uma conta só aqui, porque três lugares perguntam isso e divergir
   * faria a peça ser redesenhada num e não no outro — o morro apareceria
   * debaixo dela ao mexer e sumiria ao pincelar.
   */
  const ladoDaPeca = (id) => {
    const dim = dimDe(id);
    return Math.max(
      ehPecaBase(id) ? ladoDoTerreno(id) : 0,
      Array.isArray(dim) ? Math.max(dim[0], dim[2]) : 0,
    );
  };

  /** A caixa de cada item, na ordem da cena — é o que responde "o que há embaixo". */
  const caixasDaCena = (menos = -1) => cena.itens.map((it, i) =>
    (i === menos ? null : (dimDe(it.peca) ? caixaDoItem(it, dimDe(it.peca)) : null)));

  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  let arrastando = false, girandoCamera = false;
  let ultimo = { x: 0, y: 0 }, alturaDoArrasto = 0;

  const estado = () => ({
    cena, selecionado, peca: pecaNaMao,
    modo: teste ? 'testar'
      : pincel ? 'relevo' : modoApagar ? 'apagar' : (pecaNaMao ? 'por' : 'escolher'),
    testando: !!teste,
    item: selecionado >= 0 ? cena.itens[selecionado] : null,
    passo, verColisoes, escalaDoProximo, pincel, modoApagar,
    pode: historico.pode(),
  });

  // ------------------------------------------------------- desfazer/refazer
  /** Chame ANTES de mudar a cena. */
  const guardar = () => historico.guardar(cena);
  /** Guarda uma vez só por gesto (um arrasto inteiro é UM `Ctrl+Z`). */
  function abrirGesto() { if (!gestoAberto) { guardar(); gestoAberto = true; } }
  function fecharGesto() { gestoAberto = false; }

  async function andarNoTempo(qual) {
    // o gesto em curso fecha antes: desfazer no meio de um arrasto deixaria o
    // próximo movimento gravando por cima do estado que se acabou de recuperar
    fecharGesto();
    const alvo = qual === 'refazer' ? historico.refazer(cena) : historico.desfazer(cena);
    if (!alvo) return false;
    await montarCena(alvo);
    return true;
  }
  const avisar = () => aoMudar(estado());

  // ------------------------------------------------------------- seleção
  function marcar() {
    const o = selecionado >= 0 ? objetos[selecionado] : null;
    contorno.visible = !!o;
    if (o) contorno.setFromObject(o);
    if (verColisoes) redesenharCaixas();
    avisar();
  }

  function trocar(mudanca) {
    if (selecionado < 0) return;
    abrirGesto();
    cena = mexer(cena, selecionado, mudanca);
    const o = objetos[selecionado];
    if (o) {
      aplicar(o, cena.itens[selecionado]);
      // a placa é amostrada no lugar onde ela está: sem refazer, arrastá-la
      // levaria junto o relevo do lugar de onde saiu
      refazerPlaca(selecionado);
      contorno.setFromObject(o);
    }
    if (verColisoes) redesenharCaixas();
    avisar();
  }

  // ------------------------------------------------------------ fantasma
  async function trocarFantasma() {
    if (fantasma) { scene.remove(fantasma); fantasma = null; }
    if (!pecaNaMao) return;
    const p = await carregarPeca(pecaNaMao, carregar);
    if (!p || pecaNaMao !== p.id) return;      // largou a peça enquanto baixava
    // material PRÓPRIO, clonado: mexer na opacidade do material da biblioteca
    // deixaria translúcida toda cópia já colocada
    const mat = p.mat.clone();
    mat.transparent = true;
    mat.opacity = 0.55;
    mat.depthWrite = false;
    fantasma = new THREE.Mesh(p.geo, mat);
    // fora do raycast: fosse alvo, o raio bateria nele em vez do chão e o
    // clique miraria o próprio cursor
    fantasma.raycast = () => {};
    fantasma.visible = false;                  // até o ponteiro dizer onde
    scene.add(fantasma);
  }

  /** Escolhe (ou larga) a peça da gaveta. Passar a mesma de novo LARGA. */
  function pegarPeca(id) {
    if (teste) return;   // testando nao se edita — ver `entrarNoTeste`
    // escolher uma peça desliga o pincel e o apagar: modos exclusivos, nos dois
    // sentidos — senão o clique volta a ter de adivinhar a intenção
    if (id && pincel) pincel = null;
    if (id) modoApagar = false;
    pecaNaMao = (id && id !== pecaNaMao) ? id : null;
    if (!pecaNaMao && fantasma) { scene.remove(fantasma); fantasma = null; }
    if (pecaNaMao) trocarFantasma();
    avisar();
  }

  // ------------------------------------------------------------ ponteiro
  function mirar(e) {
    const r = canvas.getBoundingClientRect();
    ponteiro.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ponteiro.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ponteiro, camera);
  }

  const alvosDoRaio = () => objetos.filter(Boolean);

  /** Gruda um ponto do chão na grade daquela peça. */
  function naGrade(onde, pecaId) {
    const p = passoDe(infoDaPeca(pecaId), passo);
    return { ...onde, x: grudar(onde.x, p), z: grudar(onde.z, p) };
  }

  /**
   * A geometria de UM item. Terreno com relevo ganha malha PRÓPRIA, e é isso que
   * o torna diferente do resto: a geometria da biblioteca é COMPARTILHADA entre
   * todas as cópias, então deformá-la deformaria todas as placas do mapa de uma
   * vez — e descartar a de uma apagaria a das outras.
   */
  function geoDoItem(item, base) {
    const info = infoDaPeca(item.peca);
    if (!segueRelevo(cena.regras, info ?? { id: item.peca })) {
      return { geo: base.geo, propria: false };
    }
    const escala = item.escala || 1;
    // a área é a pegada da peça: sem `dim` (peça fora do catálogo) usa-se o
    // lado declarado, e sem nenhum dos dois não há como saber o que ela cobre
    const dim = info?.dim;
    const lado = Math.max(
      ehPecaBase(item.peca) ? ladoDoTerreno(item.peca) : 0,
      Array.isArray(dim) ? Math.max(dim[0], dim[2]) : 0,
    );
    if (!lado || !relevoNaArea(cena.relevo, item.x, item.z, lado * escala)) {
      return { geo: base.geo, propria: false };
    }

    // A altura é lida em CADA vértice, no lugar do mundo onde ele vai parar —
    // é o que faz uma placa casar com a vizinha sem ninguém combinar nada: as
    // duas leem a mesma função nas mesmas coordenadas, na borda que dividem.
    //
    // O giro e a escala entram aqui porque a malha é girada e escalada DEPOIS
    // (`aplicar`): sem desfazer os dois, uma placa girada 90° leria o morro de
    // lado, e uma placa dobrada de tamanho o leria com o dobro da altura.
    const c = Math.cos(item.giro || 0), s = Math.sin(item.giro || 0);
    const altura = (lx, lz) => alturaDoRelevo(
      cena.relevo,
      item.x + escala * (lx * c + lz * s),
      item.z + escala * (-lx * s + lz * c),
    ) / escala;

    // As peças BASE nascem subdivididas (`geoPlaca` gera a grade), então elas
    // se refazem inteiras a partir da função de altura. Uma peça IMPORTADA
    // chega pronta e com 3 a 8 triângulos: a única saída é acrescentar vértices
    // antes de deslocar, senão a superfície entre os quatro cantos é um plano e
    // a fenda cavada no meio dela não tem onde existir. Ver `malha.js`.
    let g = ehPecaBase(item.peca) ? geometriaBase(item.peca, altura) : null;
    if (!g) {
      const fino = subdividir(base.geo, Math.max(0.5, PASSO_RELEVO / 2) / escala);
      // `subdividir` devolve a MESMA geometria quando não há o que cortar, e
      // deformá-la ali seria deformar a da biblioteca — todas as cópias de uma
      // vez, e sem volta.
      g = deformarPeloRelevo(fino === base.geo ? base.geo.clone() : fino, altura);
    }
    if (!g) return { geo: base.geo, propria: false };
    g.computeBoundingSphere();
    return { geo: g, propria: true };
  }

  /** Monta a malha de um item (com o terreno já deformado). */
  function malhaDoItem(item, base) {
    const { geo, propria } = geoDoItem(item, base);
    const m = new THREE.Mesh(geo, base.mat);
    m.userData.propria = propria;   // quem tem geometria própria a descarta ao sair
    aplicar(m, item);
    return m;
  }

  /**
   * Refaz as placas de terreno depois de uma pincelada.
   *
   * `area` ({x, z, raio}) limita o trabalho às placas que a pincelada alcança.
   * Sem ela, cada movimento do mouse reconstruía o mapa INTEIRO — com cem
   * placas isso é meio segundo por quadro, e um editor que engasga a cada
   * pincelada é, na tela, a mesma coisa que um editor que não funciona.
   */
  function redesenharTerreno(area = null) {
    for (let i = 0; i < cena.itens.length; i++) {
      const it = cena.itens[i];
      if (!segueRelevo(cena.regras, infoDaPeca(it.peca) ?? { id: it.peca })) continue;
      const lado = ladoDaPeca(it.peca);
      if (!lado) continue;
      if (area) {
        // a margem soma o meio-lado da placa com o raio do pincel: a placa
        // entra se a pincelada encosta em QUALQUER ponto dela
        const m = (lado * (it.escala || 1)) / 2 + area.raio + PASSO_RELEVO;
        if (Math.abs(it.x - area.x) > m || Math.abs(it.z - area.z) > m) continue;
      }
      refazerPlaca(i);
    }
    if (verColisoes) redesenharCaixas();
  }

  /**
   * Refaz a geometria de UMA placa. Não é só ajuda para o laço acima: a placa
   * é amostrada no lugar onde ela ESTÁ, então mover, girar ou redimensionar uma
   * placa sem refazê-la a faz carregar o morro do lugar antigo — o chão viaja
   * com a peça, e a fresta que sobra não acusa nada.
   */
  function refazerPlaca(i) {
    const it = cena.itens[i];
    if (!it || !segueRelevo(cena.regras, infoDaPeca(it.peca) ?? { id: it.peca })) return;
    const base = _pecas.get(it.peca);
    const antigo = objetos[i];
    if (!base || !antigo) return;
    if (antigo.userData.propria) antigo.geometry.dispose();
    const { geo, propria } = geoDoItem(it, base);
    antigo.geometry = geo;
    antigo.userData.propria = propria;
  }

  /**
   * Onde o ponteiro toca o CHÃO JÁ DEFORMADO — e não o plano zero.
   *
   * Enquanto o terreno é plano os dois dão o mesmo ponto. Depois da primeira
   * pincelada, não: com a câmera baixa, um morro de 6 m põe o encontro com o
   * plano zero metros ATRÁS do que se está vendo, e o pincel passa a cavar
   * longe do cursor. O sintoma é o morro "andar" enquanto se pinta.
   */
  function miraNoTerreno() {
    const alvos = [];
    for (let i = 0; i < cena.itens.length; i++) {
      if (objetos[i] && ehPecaBase(cena.itens[i].peca) && ladoDoTerreno(cena.itens[i].peca)) {
        alvos.push(objetos[i]);
      }
    }
    const t = alvos.length ? raycaster.intersectObjects(alvos, false)[0] : null;
    return t ? { x: t.point.x, y: t.point.y, z: t.point.z } : miraNoChao(raycaster, 0);
  }

  /**
   * Uma pincelada. **Só age onde há placa de TERRENO** — é o pedido: não se dá
   * relevo a uma árvore. Sem essa condição o pincel levantaria a grade num
   * lugar sem chão nenhum, e nada apareceria na tela: o trabalho sumiria em
   * silêncio, e a conclusão seria que o relevo não funciona.
   */
  function pincelar(onde, escala, inverter = false) {
    if (!onde) return false;
    const temChao = cena.itens.some((it, i) => {
      if (!objetos[i]) return false;
      if (!segueRelevo(cena.regras, infoDaPeca(it.peca) ?? { id: it.peca })) return false;
      const lado = ladoDaPeca(it.peca);
      if (!lado) return false;
      const m = (lado * (it.escala || 1)) / 2;
      return Math.abs(onde.x - it.x) <= m && Math.abs(onde.z - it.z) <= m;
    });
    if (!temChao) return false;

    abrirGesto();
    const antes = cena.relevo ?? relevoVazio();
    const opcoes = { raio: pincel.raio };
    let novo;
    if (pincel.modo === 'aplainar') {
      novo = aplainar(antes, onde.x, onde.z, { ...opcoes, forca: escala });
    } else {
      // O MODO manda; o Shift inverte. Os dois juntos porque são gestos
      // diferentes: quem vai cavar um vale inteiro escolhe "cavar" e esquece
      // a tecla; quem está levantando um morro e quer tirar uma sobra usa o
      // Shift sem sair do modo.
      const cava = (pincel.modo === 'cavar') !== !!inverter;
      novo = esculpir(antes, onde.x, onde.z, (cava ? -1 : 1) * pincel.forca * escala, opcoes);
    }

    cena = { ...cena, relevo: novo };
    redesenharTerreno({ x: onde.x, z: onde.z, raio: pincel.raio });
    avisar();
    return true;
  }

  async function por(onde) {
    // com o giro e o tamanho do FANTASMA: a prévia mostrou uma coisa, o clique
    // não pode produzir outra
    const g = naGrade(onde, pecaNaMao);
    // a peça pousa NO TERRENO, e não no plano zero: com relevo, pôr uma árvore
    // no morro a deixaria enterrada até a copa, e o gesto pareceria não ter
    // funcionado. O terreno é a única peça que fica em y=0 — ela É o chão.
    const ehTerreno = segueRelevo(cena.regras, infoDaPeca(pecaNaMao) ?? { id: pecaNaMao });
    const noChao = ehTerreno ? 0 : alturaDoRelevo(cena.relevo, g.x, g.z);

    // A peça precisa CARREGAR antes de a cena mudar: falhar depois de já ter
    // apagado o chão de baixo deixaria um buraco onde havia piso.
    const p = await carregarPeca(pecaNaMao, carregar);
    if (!p) return false;

    // CHÃO POR CIMA DE CHÃO: o de baixo sai. Duas placas coplanares brigam pelo
    // pixel, e tirá-las à mão era metade do trabalho de montar um piso. Só vale
    // entre terrenos e só na mesma altura — ver `terrenoCoberto`.
    //
    // Os índices são apurados AQUI mas a remoção só acontece depois de a peça
    // nova estar na cena: apagar primeiro e falhar em seguida deixaria um
    // buraco onde havia piso, e o gesto teria destruído em vez de trocar.
    const novo = { peca: pecaNaMao, x: g.x, z: g.z, y: noChao, escala: escalaDoProximo };
    // só entre placas BASE: duas estradas importadas que se cruzam são um
    // cruzamento, não uma sobra — apagar uma delas destruiria a cena de quem
    // está montando a malha viária
    const cobertos = terrenoCoberto(cena, novo, (id) => (ehPecaBase(id) ? ladoDoTerreno(id) : 0));

    const r = acrescentar(cena, pecaNaMao,
      { ...g, y: noChao, giro: giroDoProximo, escala: escalaDoProximo });
    if (r.indice < 0) return false;

    guardar();
    cena = r.cena;
    const malha = malhaDoItem(cena.itens[r.indice], p);
    grupo.add(malha);
    objetos.push(malha);
    selecionado = r.indice;
    // a peça nova entrou no FIM, então os índices apurados acima continuam
    // valendo; `removerItens` puxa o `selecionado` junto ao encurtar a lista
    if (cobertos.length) removerItens(cobertos);
    marcar();
    // substituir chão em silêncio seria apagar trabalho sem dizer: quem pôs a
    // placa maior por cima precisa saber que as menores saíram
    if (cobertos.length) {
      aoMudar({ ...estado(), aviso: `${cobertos.length} placa(s) de chão embaixo foram trocadas` });
    }
    return true;
  }

  /**
   * Tira vários itens de uma vez, do maior índice para o menor.
   *
   * A ordem não é estilo: `objetos` é paralelo a `cena.itens`, e remover de
   * frente para trás desloca os índices seguintes — a segunda remoção tiraria a
   * peça errada, e o par malha↔item ficaria trocado sem nada acusar.
   */
  function removerItens(indices) {
    for (const i of [...indices].sort((a2, b2) => b2 - a2)) {
      const o = objetos[i];
      if (o) {
        grupo.remove(o);
        if (o.userData.propria) o.geometry.dispose();
      }
      objetos.splice(i, 1);
      cena = remover(cena, i);
      if (selecionado === i) selecionado = -1;
      else if (selecionado > i) selecionado--;
    }
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', async (e) => {
    canvas.setPointerCapture(e.pointerId);
    ultimo = { x: e.clientX, y: e.clientY };
    if (e.button === 2) { girandoCamera = true; return; }

    // NO TESTE o clique não edita nada: só o botão direito, que gira a câmera,
    // e ele já saiu acima. Editar andando faria o gesto de olhar em volta
    // largar peças pelo caminho.
    if (teste) return;

    mirar(e);

    // MODO RELEVO: o clique esculpe o chão. Vem ANTES de tudo porque é um modo
    // exclusivo — com o pincel na mão não se põe nem se seleciona, senão o
    // gesto de levantar o morro largaria uma árvore no meio dele.
    if (pincel) {
      arrastando = true;
      canvas.classList.add('arrastando');
      // o COMEÇO lê o terreno de verdade (senão a pincelada num morro de 6 m
      // cairia metros atrás do que se está vendo); daí em diante o arrasto se
      // prende a esta altura, ver `planoDoPincel`
      const onde = miraNoTerreno();
      planoDoPincel = onde ? onde.y : 0;
      if (!pincelar(onde, 1, e.shiftKey)) {
        aoMudar({ ...estado(), aviso: 'ponha uma placa de chão aqui primeiro' });
      }
      return;
    }

    // MODO APAGAR: o clique tira o que acertar, e nada mais. Antes disto,
    // limpar uma área era selecionar–apagar–selecionar–apagar, e metade dos
    // cliques era em cima do vazio, só para largar a seleção anterior.
    if (modoApagar) {
      const alvo = raycaster.intersectObjects(alvosDoRaio(), false)[0];
      if (alvo) {
        guardar();
        removerItens([objetos.indexOf(alvo.object)]);
        marcar();
      }
      return;
    }

    // MODO POR: o clique põe, e nada mais. Sem essa separação, clicar num
    // objeto para apagá-lo punha outro em cima dele.
    if (pecaNaMao) {
      const onde = miraNoChao(raycaster, 0);
      if (onde) await por(onde);
      return;
    }

    // MODO ESCOLHER: clique na peça seleciona e começa a arrastar
    const bate = raycaster.intersectObjects(alvosDoRaio(), false);
    if (bate.length) {
      selecionado = objetos.indexOf(bate[0].object);
      alturaDoArrasto = cena.itens[selecionado].y;
      arrastando = true;
      canvas.classList.add('arrastando');
      marcar();
      return;
    }
    selecionado = -1;
    marcar();
  });

  addEventListener('pointerup', () => {
    arrastando = false; girandoCamera = false;
    canvas.classList.remove('arrastando');
    // o gesto acabou: o próximo `Ctrl+Z` desfaz o arrasto INTEIRO, e não o
    // último pixel dele. Vale também para os sliders da tela, que soltam o
    // ponteiro aqui — por isso o ouvinte é da janela e não do canvas.
    fecharGesto();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (teste) {
      // só girar a câmera; o resto deste ouvinte é edição
      if (girandoCamera) {
        orbita.ang += (e.clientX - ultimo.x) * GIRO.horizontal;
        orbita.alt = Math.max(0.08, Math.min(1.5, orbita.alt - (e.clientY - ultimo.y) * GIRO.vertical));
        ultimo = { x: e.clientX, y: e.clientY };
      }
      return;
    }
    // Shift + arrastar = ALTURA. É como se levanta uma peça para fazer uma
    // montanha, e fica no mesmo gesto do arrasto: sair para o slider a cada
    // pedra quebraria o ritmo de empilhar.
    if (arrastando && selecionado >= 0 && e.shiftKey) {
      const dy = (ultimo.y - e.clientY) * 0.02 * Math.max(1, orbita.dist / 20);
      ultimo = { x: e.clientX, y: e.clientY };
      trocar({ y: cena.itens[selecionado].y + dy });
      return;
    }
    if (pincel && arrastando) {
      mirar(e);
      pincelar(miraNoChao(raycaster, planoDoPincel), 0.35, e.shiftKey);
      return;
    }
    if (girandoCamera) {
      // O mouse vira a CÂMERA, não arrasta o mundo.
      //
      // São dois modelos opostos, e os dois são defensáveis sozinhos: "agarrar
      // e puxar" (o mundo segue o cursor, como num mapa) e "olhar" (a câmera
      // gira, o mundo corre para o outro lado, como em qualquer jogo em
      // primeira pessoa). O que não é defensável é ter um em cada controle — e
      // era o que havia: o botão direito puxava o mundo e o `WASD` andava com a
      // câmera. A mão faz as duas coisas no mesmo gesto de enquadrar uma peça, e
      // trocar de referencial no meio é o que deixa a câmera "ruim de
      // controlar" sem que se saiba dizer por quê.
      //
      // Como o `WASD` é do teclado e é câmera por natureza, é o mouse que se
      // alinha a ele: arrastar para a direita olha para a direita, arrastar
      // para baixo olha para baixo.
      orbita.ang += (e.clientX - ultimo.x) * GIRO.horizontal;
      orbita.alt = Math.max(0.08, Math.min(1.5, orbita.alt - (e.clientY - ultimo.y) * GIRO.vertical));
      ultimo = { x: e.clientX, y: e.clientY };
      return;
    }
    mirar(e);

    if (fantasma) {
      const cru = miraNoChao(raycaster, 0);
      const onde = cru ? naGrade(cru, pecaNaMao) : null;
      fantasma.visible = !!onde;
      if (onde) {
        // a prévia GRUDA junto: sem isso ela desliza livre e o clique produz
        // uma peça noutro lugar — a prévia mentiria sobre o próprio clique
        fantasma.position.set(onde.x, onde.y, onde.z);
        // o fantasma nasce com o giro e o tamanho que a peça VAI ter, senão a
        // prévia mente sobre o que o clique produz
        fantasma.rotation.y = giroDoProximo;
        fantasma.scale.setScalar(escalaDoProximo);
      }
      return;
    }

    if (!arrastando || selecionado < 0) return;
    const onde = miraNoChao(raycaster, alturaDoArrasto);
    if (!onde) return;
    const g = naGrade(onde, cena.itens[selecionado].peca);
    trocar({ x: g.x, z: g.z });
  });

  canvas.addEventListener('pointerleave', () => { if (fantasma) fantasma.visible = false; });

  canvas.addEventListener('wheel', (e) => {
    // `preventDefault` sempre, e ANTES de qualquer ramo: com Ctrl, a roda é o
    // zoom do NAVEGADOR, e deixá-lo passar aumentaria a página inteira em vez
    // da peça — com o canvas esticando junto, que é pior que não fazer nada.
    e.preventDefault();

    // Ctrl + roda = tamanho, como na Unity. Vale para a peça selecionada e,
    // no modo "pondo", para o fantasma — ajustar o tamanho ANTES de pôr é o
    // gesto de quem vai deixar dez cópias iguais.
    if (e.ctrlKey || e.metaKey) {
      const k = e.deltaY > 0 ? 1 / 1.08 : 1.08;
      if (pecaNaMao) {
        escalaDoProximo = Math.max(LIMITE.escala.min, Math.min(LIMITE.escala.max, escalaDoProximo * k));
        if (fantasma) fantasma.scale.setScalar(escalaDoProximo);
        avisar();
      } else if (selecionado >= 0) {
        trocar({ escala: cena.itens[selecionado].escala * k });
      }
      return;
    }
    orbita.dist = Math.max(3, Math.min(300, orbita.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
  }, { passive: false });

  // ------------------------------------------------------------- teclado
  /** WASD: [para onde, no plano da câmera]. `1` é para frente/direita. */
  const CAMERA = { w: [1, 0], s: [-1, 0], a: [0, -1], d: [0, 1] };


  async function tecla(e) {
    // não sequestrar o teclado de quem está digitando na gaveta ou no nome
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // ------------------------------------------------------------- CÂMERA
    // WASD anda com a câmera, como em qualquer editor 3D. Elas ficam num
    // conjunto e quem move é o LAÇO: mover no `keydown` faria a câmera andar no
    // ritmo da repetição do teclado do sistema — trancos, e diferente em cada
    // máquina.
    // o Shift entra no conjunto junto com as outras: quem decide a velocidade é
    // o LAÇO, e lá não existe evento para perguntar `e.shiftKey`
    if (e.key === 'Shift') teclasDaCamera.add('shift');
    if (CAMERA[e.key?.toLowerCase?.()] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      teclasDaCamera.add(e.key.toLowerCase());
      e.preventDefault();
      return;
    }

    // ------------------------------------------------------------- TESTAR
    // `T` entra e sai; `Esc` sai. E enquanto se testa, NENHUM outro atalho
    // responde: apagar ou desfazer com o boneco na cena mudaria por baixo dele
    // justamente os colisores que se está experimentando.
    if (e.key === 't' || e.key === 'T') { await testar(); e.preventDefault(); return; }
    if (teste) {
      if (e.key === 'Escape') { sairDoTeste(); avisar(); e.preventDefault(); return; }
      // `C` é o único que sobrevive: ele mostra a caixa, não muda a cena — e
      // ver a caixa no instante em que se esbarra nela é metade do diagnóstico
      // de "por que travei aqui?".
      if (e.key === 'c' || e.key === 'C') { mostrarColisoes(); e.preventDefault(); }
      return;
    }

    // ------------------------------------------------- desfazer e refazer
    // Vêm ANTES de tudo: `Ctrl+Z` num editor não é negociável, e deixá-los
    // depois faria qualquer atalho de uma letra só roubá-los.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key?.toLowerCase?.();
      if (k === 'z' && !e.shiftKey) { await andarNoTempo('desfazer'); e.preventDefault(); return; }
      // `Ctrl+Y` e `Ctrl+Shift+Z` são o mesmo refazer: o primeiro é o do
      // Windows, o segundo o de quem vem do Mac/Photoshop
      if (k === 'y' || (k === 'z' && e.shiftKey)) { await andarNoTempo('refazer'); e.preventDefault(); return; }
      if (k === 'd') { await duplicarSelecionado(); e.preventDefault(); return; }
    }

    if (e.key === 'r' || e.key === 'R') { usarPincel(pincel ? null : {}); e.preventDefault(); return; }

    // Del liga o modo APAGAR (o clique passa a apagar). Quem quer tirar só a
    // peça selecionada usa `Backspace`, o botão da lateral, ou um clique já
    // dentro do modo — uma tecla, um significado.
    if (e.key === 'Delete') { usarModoApagar(); e.preventDefault(); return; }

    if (e.key === 'Escape') {
      // larga o pincel, depois o apagar, depois a peça, depois a seleção — uma
      // coisa por Esc: juntá-las faria "parar de esculpir" apagar a seleção
      if (pincel) { usarPincel(null); e.preventDefault(); return; }
      if (modoApagar) { usarModoApagar(false); e.preventDefault(); return; }
      if (pecaNaMao) { pegarPeca(null); e.preventDefault(); return; }
      if (selecionado >= 0) { selecionado = -1; marcar(); e.preventDefault(); }
      return;
    }

    const passoGiro = e.shiftKey ? Math.PI / 4 : Math.PI / 12;

    // com peça na mão, Q/E e +/− ajustam o que VAI ser posto
    if (pecaNaMao && ['q', 'Q', 'e', 'E', '+', '=', '-', '_'].includes(e.key)) {
      if (e.key === 'q' || e.key === 'Q') giroDoProximo -= passoGiro;
      else if (e.key === 'e' || e.key === 'E') giroDoProximo += passoGiro;
      else if (e.key === '+' || e.key === '=') escalaDoProximo = Math.min(20, escalaDoProximo * 1.1);
      else escalaDoProximo = Math.max(0.05, escalaDoProximo / 1.1);
      if (fantasma) { fantasma.rotation.y = giroDoProximo; fantasma.scale.setScalar(escalaDoProximo); }
      e.preventDefault();
      return;
    }

    // vale SEM seleção: é uma camada da cena, não uma propriedade da peça
    if (e.key === 'c' || e.key === 'C') { mostrarColisoes(); e.preventDefault(); return; }

    if (selecionado < 0) return;
    const item = cena.itens[selecionado];

    if (e.key === 'q' || e.key === 'Q') trocar({ giro: item.giro - passoGiro });
    else if (e.key === 'e' || e.key === 'E') trocar({ giro: item.giro + passoGiro });
    else if (e.key === '+' || e.key === '=') trocar({ escala: item.escala * 1.1 });
    else if (e.key === '-' || e.key === '_') trocar({ escala: item.escala / 1.1 });
    else if (e.key === 'Backspace') apagar();
    else if (e.key === 'f' || e.key === 'F') assentar();
    // a ALTURA saiu de W/S quando WASD virou câmera. Ela continua em três
    // lugares (o slider, `Shift`+arraste e estas duas), e nenhum deles some.
    else if (e.key === 'PageUp') trocar({ y: item.y + (e.shiftKey ? 1 : 0.25) });
    else if (e.key === 'PageDown') trocar({ y: item.y - (e.shiftKey ? 1 : 0.25) });
    else return;
    e.preventDefault();
  }
  addEventListener('keydown', tecla);

  /**
   * Soltar a tecla para a câmera parar — e FECHAR o gesto.
   *
   * Sem o `blur`, trocar de janela com o `W` apertado deixa a tecla presa no
   * conjunto: o `keyup` acontece na outra janela e não chega aqui, e a câmera
   * volta voando sozinha, sem nada acusar.
   */
  addEventListener('keyup', (e) => { teclasDaCamera.delete(e.key?.toLowerCase?.()); fecharGesto(); });
  addEventListener('blur', () => { teclasDaCamera.clear(); fecharGesto(); });

  /**
   * Assenta o item no que estiver EMBAIXO dele — o topo da peça de baixo, ou o
   * chão. É o "cai no lugar" da Unity, e o que evita a pedra afundar dentro da
   * montanha que se acabou de montar.
   *
   * A conta é de CAIXA e não de raycast (`alturaDePouso`, em `cena.js`): o raio
   * atravessa o vão entre as bolhas da copa de uma árvore, e a peça afundaria
   * até o tronco — com a malha inteira paga para errar.
   */
  function assentar() {
    if (selecionado < 0) return;
    const it = cena.itens[selecionado];
    // SEM teto: assentar é "pousa em cima do que está aí", e o caso principal é
    // justamente SUBIR — a pedra é posta no chão, dentro da montanha, e o gesto
    // a leva ao topo. Um teto aqui a deixaria enterrada, que é o que o pedido
    // ("se ajusta sozinho ao objeto") existe para resolver.
    // o TERRENO conta junto: sem ele, `F` num morro devolveria a peça ao plano
    // zero — e "assentar" enterraria justamente o que se acabou de levantar
    const doRelevo = segueRelevo(cena.regras, infoDaPeca(it.peca) ?? { id: it.peca })
      ? 0 : alturaDoRelevo(cena.relevo, it.x, it.z);
    const y = Math.max(doRelevo, alturaDePouso(caixasDaCena(selecionado), it.x, it.z));
    trocar({ y });
  }

  /**
   * Liga o pincel de relevo (ou desliga, com `null`).
   *
   * Ligá-lo LARGA a peça da mão: são modos exclusivos, e ficar com os dois
   * ativos faria o clique ter de adivinhar a intenção — o defeito que os dois
   * modos originais existem para não repetir.
   */
  function usarPincel(cfg) {
    if (teste) return pincel;
    pincel = cfg ? { raio: 6, forca: 0.6, modo: 'levantar', ...(pincel ?? {}), ...cfg } : null;
    if (pincel && pecaNaMao) pegarPeca(null);
    if (pincel) modoApagar = false;
    if (pincel && selecionado >= 0) { selecionado = -1; marcar(); }
    avisar();
    return pincel;
  }

  /**
   * Liga/desliga o modo APAGAR. Exclusivo com pôr e com o relevo, pela mesma
   * lei dos outros: com dois modos ligados o clique teria de adivinhar, e
   * adivinhava errado — era como uma peça na mão punha outra em cima da que se
   * queria remover.
   */
  function usarModoApagar(v) {
    if (teste) return modoApagar;
    modoApagar = v ?? !modoApagar;
    if (modoApagar) {
      if (pecaNaMao) pegarPeca(null);
      if (pincel) pincel = null;
      if (selecionado >= 0) { selecionado = -1; marcar(); }
    }
    avisar();
    return modoApagar;
  }

  // ============================================================== TESTAR
  //
  // O jogador entra na cena e anda. As três contas que ele usa são as MESMAS de
  // quem já está no jogo — e é isso que faz o teste valer alguma coisa:
  //
  //   • quem barra  → `colisoresDaCena` (cena.js), o que o Mundo lê ao montar;
  //   • quem move   → `mover`/`livre` (floresta.js), o laço do jogador de lá;
  //   • qual altura → `alturaDoRelevo` + `alturaDePouso`, o mesmo par que o
  //                   `assentar` do editor usa para pousar uma peça.
  //
  // Reescrever qualquer uma aqui daria um editor que aprova o que o jogo
  // recusa, e o erro só apareceria com o ambiente publicado.

  /**
   * Um boneco de reserva, para quando ninguém injetou `criarJogador`.
   *
   * A bancada é o caso: o boneco de verdade (`boneco3d.js`) puxa `GLTFLoader` e
   * `fetch`, e `file://` não faz nem um nem outro. Um teste que só existisse na
   * tela com servidor deixaria a bancada provando um editor incompleto.
   *
   * Ele tem o tamanho de gente (1,72 m, como `ALTURA_BONECO`) porque o tamanho
   * é a metade da pergunta: um marcador menor passaria por vãos onde a pessoa
   * não passa, e o teste diria que está bom.
   */
  function bonecoDeReserva() {
    const g = new THREE.Group();
    const corpo = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.9, 4, 12),
      new THREE.MeshLambertMaterial({ color: 0xe8c46a }),
    );
    corpo.position.y = 0.73;
    const cabeca = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xf0d9a8 }),
    );
    cabeca.position.y = 1.52;
    // o NARIZ: sem ele não dá para ver para que lado o boneco está virado, e
    // metade do que se testa andando é justamente a direção
    const nariz = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.14),
      new THREE.MeshLambertMaterial({ color: 0x12151d }),
    );
    nariz.position.set(0, 1.52, 0.18);
    g.add(corpo, cabeca, nariz);
    return { grupo: g, andar: () => {}, descartar: () => {
      for (const m of [corpo, cabeca, nariz]) { m.geometry.dispose(); m.material.dispose(); }
    } };
  }

  /**
   * A altura do chão para o jogador — relevo mais o topo do que houver embaixo.
   *
   * As caixas vêm PRONTAS (apuradas ao entrar no teste) e não de
   * `caixasDaCena()`: aquela função constrói uma caixa por item, e chamá-la a
   * cada quadro seriam duzentas alocações por quadro numa cena grande. A cena
   * não muda enquanto se anda — é justamente o que o modo garante.
   */
  function chaoDoTeste(x, z) {
    return Math.max(
      alturaDoRelevo(cena.relevo, x, z),
      alturaDePouso(teste.caixas, x, z),
    );
  }

  /**
   * Põe o jogador na cena.
   *
   * Ele nasce onde a CÂMERA está olhando, e não na origem: testa-se o pedaço
   * que se acabou de construir, e um boneco que aparece a cinquenta metros dali
   * faz a pessoa procurá-lo antes de testar qualquer coisa.
   *
   * Nascer DENTRO de um colisor não é "difícil de sair": `livre` é falso na
   * volta inteira e não se anda para lado nenhum — o teste abriria com o boneco
   * imóvel, que é indistinguível de um editor travado. É a armadilha que o
   * Mundo já documenta na entrada da clareira, e a resposta é a mesma: passar
   * por `mover`, que desliza para fora, e AVISAR se ainda assim ficou preso.
   */
  async function entrarNoTeste() {
    if (teste) return teste;

    // modos exclusivos: com o boneco na cena o clique não põe, não seleciona e
    // não esculpe — senão andar largaria árvores pelo caminho
    if (pecaNaMao) pegarPeca(null);
    pincel = null;
    modoApagar = false;
    selecionado = -1;

    const colisores = colisoresDaCena(cena, dimDe, { infoDe: infoDaPeca });
    const caixas = caixasDaCena();

    let x = alvoCam.x, z = alvoCam.z;
    if (!livre(colisores, x, z, MUNDO.raioJogador, LIMITE.xz)) {
      // empurra para fora do que estiver em cima dele, em espiral: o deslize de
      // `mover` resolve o caso comum de graça
      for (let i = 1; i <= 24 && !livre(colisores, x, z, MUNDO.raioJogador, LIMITE.xz); i++) {
        const a2 = i * 2.4, r2 = i * 0.5;
        const t = mover(colisores, alvoCam.x, alvoCam.z,
          Math.cos(a2) * r2, Math.sin(a2) * r2, MUNDO.raioJogador, LIMITE.xz);
        x = t.x; z = t.z;
      }
    }

    const boneco = (criarJogador ? await criarJogador() : null) ?? bonecoDeReserva();
    // a ALTURA é MEDIDA do boneco que veio, nunca escrita: ela decide onde a
    // câmera mira, e escrevê-la aqui envelheceria calada se o modelo mudasse
    const caixa = new THREE.Box3().setFromObject(boneco.grupo);
    const altura = Math.max(0.6, caixa.max.y - Math.min(0, caixa.min.y));

    scene.add(boneco.grupo);
    contorno.visible = false;
    if (fantasma) { scene.remove(fantasma); fantasma = null; }

    teste = {
      boneco, altura, colisores, caixas, x, z, giro: 0, andado: 0,
      // a câmera guarda de onde veio, para devolver o enquadramento ao sair —
      // voltar do teste com a cena noutro lugar faz perder o pedaço em que se
      // estava trabalhando
      volta: { x: alvoCam.x, y: alvoCam.y, z: alvoCam.z, ...orbita },
    };
    orbita.dist = Math.min(orbita.dist, 9);
    orbita.alt = Math.min(orbita.alt, 0.45);

    const preso = !livre(colisores, x, z, MUNDO.raioJogador, LIMITE.xz);
    aoMudar({
      ...estado(),
      aviso: preso
        ? 'o jogador nasceu preso — abra espaço aqui e teste de novo'
        : `testando: ${colisores.length} colisor(es) na cena`,
    });
    return teste;
  }

  /** Tira o jogador e devolve o enquadramento que havia antes. */
  function sairDoTeste() {
    if (!teste) return false;
    scene.remove(teste.boneco.grupo);
    teste.boneco.descartar?.();
    const v = teste.volta;
    if (v) {
      alvoCam.set(v.x, v.y, v.z);
      orbita.ang = v.ang; orbita.alt = v.alt; orbita.dist = v.dist;
    }
    teste = null;
    teclasDaCamera.clear();
    marcar();
    return true;
  }

  /** Liga ou desliga o teste. */
  async function testar(v) {
    if (v ?? !teste) return !!(await entrarNoTeste());
    return !sairDoTeste();
  }

  /** Um quadro do teste: anda, pousa e leva a câmera junto. */
  function andarNoTeste(dt) {
    let frente = 0, lado = 0;
    for (const k of teclasDaCamera) {
      const d = CAMERA[k];
      if (d) { frente += d[0]; lado += d[1]; }
    }
    const n = Math.hypot(frente, lado);
    let andando = false;

    if (n > 0.001) {
      const v = (teclasDaCamera.has('shift') ? VEL_CORRIDA : VEL) * dt;
      const fx = -Math.cos(orbita.ang), fz = -Math.sin(orbita.ang);
      const dx = ((frente / n) * fx + (lado / n) * -fz) * v;
      const dz = ((frente / n) * fz + (lado / n) * fx) * v;
      const passo = mover(teste.colisores, teste.x, teste.z, dx, dz, MUNDO.raioJogador, LIMITE.xz);
      teste.x = passo.x; teste.z = passo.z;
      teste.giro = Math.atan2(dx, dz);
      teste.andado += dt;
      andando = true;
    } else {
      teste.andado = 0;
    }

    const chao = chaoDoTeste(teste.x, teste.z);
    teste.boneco.grupo.position.set(teste.x, chao, teste.z);
    teste.boneco.grupo.rotation.y = teste.giro;
    teste.boneco.andar?.(teste.andado, andando);
    // a câmera mira no PEITO, não nos pés: mirando nos pés o boneco fica na
    // borda de baixo da tela e não se vê o chão à frente, que é o que se testa
    alvoCam.set(teste.x, chao + teste.altura * 0.6, teste.z);
  }

  // ------------------------------------------------- as REGRAS e o COLISOR

  /**
   * Muda uma regra de classe ou de peça, e redesenha o que ela afeta.
   *
   * Mexer em `terreno` refaz o TERRENO INTEIRO: marcar uma estrada como chão
   * tem de deformá-la na hora, senão o efeito só apareceria na pincelada
   * seguinte e a decisão pareceria não ter pegado.
   */
  function mudarRegra(onde, chave, campo, valor) {
    guardar();
    fecharGesto();
    cena = { ...cena, regras: porRegra(cena.regras ?? regrasVazias(), onde, chave, campo, valor) };
    if (campo === 'terreno') redesenharTerreno();
    if (verColisoes) redesenharCaixas();
    avisar();
    return cena.regras;
  }

  /**
   * Ajusta o colisor do item selecionado — as alças verdes da Unity.
   *
   * `false` desliga; um objeto ajusta; `null` volta ao padrão. Os três são
   * estados distintos e é por isso que existem três valores: "não colide" não
   * é o mesmo que "colide com a caixa padrão", e perder essa diferença
   * transformaria desligar num ajuste que a primeira gravação apagaria.
   */
  function ajustarColisor(mudanca) {
    if (selecionado < 0) return null;
    abrirGesto();
    const atual = cena.itens[selecionado].col;
    let col;
    if (mudanca === false || mudanca === null) col = mudanca;
    else col = lerColisor({ ...(atual && atual !== false ? atual : colisorNeutro()), ...mudanca });

    const itens = [...cena.itens];
    const item = { ...itens[selecionado] };
    if (col === false) item.col = false;
    else if (col) item.col = col;
    else delete item.col;
    itens[selecionado] = item;
    cena = { ...cena, itens };

    if (verColisoes) redesenharCaixas();
    avisar();
    return item.col ?? null;
  }

  /** Liga/desliga as caixas de colisão. Devolve o estado novo. */
  function mostrarColisoes(ligado) {
    verColisoes = ligado ?? !verColisoes;
    caixas.visible = verColisoes;
    if (verColisoes) redesenharCaixas();
    avisar();
    return verColisoes;
  }

  /**
   * As caixas de colisão, redesenhadas. Elas SEGUEM o tamanho porque saem da
   * mesma `caixaDoItem` que o Mundo usa para gerar o colisor — desenhar uma
   * caixa por um caminho e colidir por outro daria uma tela que promete o que
   * o jogo não cumpre, sem nada acusar.
   */
  function redesenharCaixas() {
    for (const o of [...caixas.children]) {
      caixas.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
    if (!verColisoes) return;
    for (const it of cena.itens) {
      const dim = dimDe(it.peca);
      if (!dim) continue;
      // O desenho é o COLISOR, não a forma da peça: mostrar a caixa geométrica
      // e colidir pela ajustada daria uma tela que promete o que o jogo não
      // cumpre — e as alças que a pessoa arrasta não teriam o que arrastar.
      const c = caixaDeColisao(it, dim);
      if (!c) continue;                       // colisor desligado: nada a desenhar
      const cx = new THREE.Box3(
        new THREE.Vector3(c.min[0], c.min[1], c.min[2]),
        new THREE.Vector3(c.max[0], c.max[1], c.max[2]),
      );
      // verde barra; azul está na cena e NÃO barra — a regra e a altura já
      // decidiram isso, e a cor é a única coisa que conta ao olhar
      const barra = colide(cena.regras, infoDaPeca(it.peca) ?? { id: it.peca }, dim);
      caixas.add(new THREE.Box3Helper(cx, barra ? 0x51d88a : 0x51708a));
    }
  }

  function apagar() {
    if (selecionado < 0) return;
    guardar();
    removerItens([selecionado]);
    marcar();
  }

  async function duplicarSelecionado() {
    if (selecionado < 0) return;
    const r = duplicar(cena, selecionado, 1.5);
    if (r.indice < 0) return;
    guardar();
    const p = await carregarPeca(cena.itens[selecionado].peca, carregar);
    if (!p) return;
    cena = r.cena;
    const malha = malhaDoItem(cena.itens[r.indice], p);
    grupo.add(malha);
    objetos.push(malha);
    selecionado = r.indice;
    marcar();
  }

  /**
   * Monta a cena inteira do zero. **Não mexe no histórico** — é o caminho que o
   * `Ctrl+Z` usa para recuperar um estado, e guardá-lo aqui faria o desfazer
   * empilhar o que ele mesmo acabou de tirar.
   */
  async function montarCena(nova) {
    for (const o of objetos) {
      if (!o) continue;
      grupo.remove(o);
      // a geometria PRÓPRIA (placa com relevo) é desta malha e de mais ninguém:
      // sem devolvê-la, cada desfazer numa cena com morro vaza uma malha na GPU
      if (o.userData.propria) o.geometry.dispose();
    }
    objetos.length = 0;
    cena = nova;
    let faltaram = 0;
    for (const item of cena.itens) {
      const p = await carregarPeca(item.peca, carregar);
      if (!p) { faltaram++; objetos.push(null); continue; }
      const malha = malhaDoItem(item, p);
      grupo.add(malha);
      objetos.push(malha);
    }
    selecionado = -1;
    marcar();
    return faltaram;
  }

  /**
   * Troca a cena inteira (abrir um arquivo). Devolve quantas peças faltaram.
   *
   * Guarda a cena atual antes: abrir um arquivo por engano com uma tarde de
   * trabalho na tela é justamente o caso em que se quer `Ctrl+Z`.
   */
  async function usarCena(nova) {
    guardar();
    fecharGesto();
    return montarCena(nova);
  }

  function triangulos() {
    let t = 0;
    for (const o of objetos) {
      if (!o) continue;
      const g = o.geometry;
      t += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
    return Math.round(t);
  }

  /**
   * Anda com a câmera no plano do chão, a partir das teclas seguradas.
   *
   * A direção sai do ÂNGULO da órbita, não de um eixo do mundo: com a câmera
   * girada, um `W` que empurrasse sempre para `-Z` mandaria a câmera de lado, e
   * quem está olhando para o sul andaria para trás.
   *
   * A velocidade cresce com a distância porque a mesma tecla serve para ajustar
   * uma pedra de perto e para atravessar o mapa de longe — passo fixo é lento
   * demais num caso e incontrolável no outro.
   */
  function andarComACamera(dt) {
    if (!teclasDaCamera.size) return;
    let frente = 0, lado = 0;
    for (const k of teclasDaCamera) {
      const d = CAMERA[k];
      if (d) { frente += d[0]; lado += d[1]; }
    }
    if (!frente && !lado) return;
    const n = Math.hypot(frente, lado) || 1;   // na diagonal não se anda mais rápido
    const v = (dt * Math.max(6, orbita.dist)) * 0.55 * (teclasDaCamera.has('shift') ? 3 : 1);

    // f = para onde a câmera OLHA, no plano; o lado é `f × cima`
    const fx = -Math.cos(orbita.ang), fz = -Math.sin(orbita.ang);
    alvoCam.x += ((frente / n) * fx + (lado / n) * -fz) * v;
    alvoCam.z += ((frente / n) * fz + (lado / n) * fx) * v;
    alvoCam.x = Math.max(-LIMITE.xz, Math.min(LIMITE.xz, alvoCam.x));
    alvoCam.z = Math.max(-LIMITE.xz, Math.min(LIMITE.xz, alvoCam.z));
  }

  function quadro(agora = 0) {
    requestAnimationFrame(quadro);
    // dt em SEGUNDOS, preso a 0,1: uma aba que ficou em segundo plano volta com
    // um salto de vários segundos, e a câmera daria um pulo para o outro lado
    // do mapa no primeiro quadro.
    const dt = instanteDoQuadro ? Math.min(0.1, (agora - instanteDoQuadro) / 1000) : 0;
    instanteDoQuadro = agora;
    // no teste o WASD é do JOGADOR; fora dele, da câmera. A câmera segue o
    // boneco em vez de andar sozinha — dois donos do mesmo controle fariam a
    // cena deslizar por baixo dos pés enquanto se anda.
    if (teste) andarNoTeste(dt);
    else andarComACamera(dt);
    // O tamanho é conferido no LAÇO, e não num `ResizeObserver`: mexer no
    // layout dentro da entrega de um observer deixa notificação pendente, o
    // navegador dispara "ResizeObserver loop…", isso chega como ErrorEvent na
    // window e o `bootguard` cobre a tela com a faixa de erro.
    const l = Math.floor(canvas.clientWidth * renderer.getPixelRatio());
    const a = Math.floor(canvas.clientHeight * renderer.getPixelRatio());
    if (l && a && (canvas.width !== l || canvas.height !== a)) {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      camera.updateProjectionMatrix();
    }
    const h = Math.cos(orbita.alt) * orbita.dist;
    camera.position.set(
      alvoCam.x + Math.cos(orbita.ang) * h,
      alvoCam.y + Math.sin(orbita.alt) * orbita.dist,
      alvoCam.z + Math.sin(orbita.ang) * h,
    );
    camera.lookAt(alvoCam);
    renderer.render(scene, camera);
  }
  quadro();

  // O primeiro aviso sai NO MICROTASK, e não aqui.
  //
  // `aoMudar` é código de quem chamou, e chamá-lo antes de `montarEditor`
  // devolver significa executá-lo com o módulo do chamador ainda no meio da
  // avaliação: toda `const`/`let` declarada abaixo da chamada está na ZONA
  // MORTA TEMPORAL, e tocá-la é `ReferenceError`. Aconteceu — `cenapagina.js`
  // tinha o mapa de botões da gaveta declarado depois, e o erro saiu na tela
  // como *"este navegador não abriu o 3D"*, acusando o navegador de um defeito
  // que era nosso.
  //
  // Adiar um microtask deixa o módulo do chamador terminar de avaliar. Não é
  // conserto de um caso: é a ordem que impede o próximo de existir.
  queueMicrotask(avisar);

  return {
    pegarPeca,
    largarPeca: () => pegarPeca(null),
    trocar,
    apagar,
    assentar,
    duplicar: duplicarSelecionado,
    usarCena,
    cenaAtual: () => cena,
    selecao: () => selecionado,
    pecaNaMao: () => pecaNaMao,
    triangulos,
    /** O catálogo (dim e módulo por peça). Sem ele não há snap nem colisão. */
    usarCatalogo: (lista) => {
      catalogo = new Map((lista ?? []).map((p) => [p.id, p]));
      if (verColisoes) redesenharCaixas();
    },
    passo: (v) => { if (v !== undefined) { passo = v; avisar(); } return passo; },
    usarPincel,
    pincel: () => pincel,
    usarModoApagar,
    modoApagar: () => modoApagar,
    /** As regras de classe/peça (colisão e terreno). */
    mudarRegra,
    regras: () => cena.regras ?? regrasVazias(),
    /** O que vale para uma peça HOJE, já resolvido — é o que a tela mostra. */
    resolvido: (id) => {
      const info = infoDaPeca(id) ?? { id };
      return {
        colide: colide(cena.regras, info, dimDe(id)),
        terreno: segueRelevo(cena.regras, info),
        grupo: info.grupo ?? null,
      };
    },
    ajustarColisor,
    /** Liga/desliga o modo TESTAR (o jogador na cena). */
    testar,
    testando: () => !!teste,
    desfazer: () => andarNoTempo('desfazer'),
    refazer: () => andarNoTempo('refazer'),
    /** A altura do terreno num ponto — é o que faz uma peça pousar no morro. */
    alturaAqui: (x, z) => alturaDoRelevo(cena.relevo, x, z),
    mostrarColisoes,
    verColisoes: () => verColisoes,
    scene,
  };
}
