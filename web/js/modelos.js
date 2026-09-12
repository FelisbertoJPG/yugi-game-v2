/**
 * **A PONTE para modelos de verdade** (`.glb`).
 *
 * O boneco do Mundo é montado de cápsulas e esferas escritas em código
 * (`boneco3d.js`). Isto aqui é o caminho para trocá-las por arte modelada, uma
 * peça de cada vez, **sem que nada acima saiba a diferença**: o vestiário, a
 * posse, o gatilho do banco, a `rpc/aparencias` e a rede continuam idênticos.
 *
 * ---
 *
 * ## A regra que sustenta tudo: FALTAR ARQUIVO É NORMAL
 *
 * Hoje não existe nenhum `.glb` no projeto, e o Mundo funciona. Amanhã existirá
 * um cabelo, e só ele será modelado. É por isso que este módulo **nunca**
 * levanta por falta de arquivo: sem modelo, `geometriaDe` devolve `null` e o
 * construtor procedural de sempre assume.
 *
 * A consequência é a que importa: **a troca é gradual e reversível**. Apagar um
 * `.glb` devolve a peça procedural, e nada quebra.
 *
 * > Mas "faltar é normal" não pode virar "faltou e ninguém viu". Um erro de
 * > nome no manifesto, um arquivo no lugar errado, um GLB que o loader recusa —
 * > tudo isso daria exatamente a mesma tela de "ainda não modelei essa peça".
 * > Por isso existe `estadoDosModelos()` e a linha única no console: quem
 * > acabou de largar oito arquivos na pasta precisa saber que oito entraram.
 *
 * ## O MANIFESTO, e por que ele existe
 *
 * `web/modelos/modelos.json` diz o que existe. Sem ele, o boot faz **uma**
 * requisição, recebe 404 e segue procedural.
 *
 * A alternativa seria tentar baixar as ~21 chaves e deixar o 404 responder — e
 * isso custaria 21 requisições em todo boot, no caso comum em que não há modelo
 * nenhum, só para descobrir que não há. Pior: o console do jogador ficaria com
 * vinte e uma linhas vermelhas de 404, que é como um erro de verdade deixa de
 * ser notado.
 *
 * ## Material: depende de QUEM está sendo carregado
 *
 * São duas leis, e a diferença não é capricho — é a diferença entre um
 * cosmético e um personagem:
 *
 * | o que | material | por quê |
 * |---|---|---|
 * | **peça** (cabelo, blusa…) | o nosso, tingido | um cabelo serve para doze cores; se ele viesse pintado, a customização morria |
 * | **corpo inteiro** (`corpo`) | **o do arquivo** | é um personagem pronto, e o visual dele MORA na textura — descartá-la deixa um boneco branco |
 *
 * A segunda lei entrou em 31/08/2026, com o pacote *Blocky Characters* do
 * Kenney (CC0): os dezoito personagens dele têm **geometria idêntica** e
 * diferem só pela textura. Descartar o material ali não era "perder um
 * detalhe" — era perder o personagem inteiro e ficar com um vulto branco.
 *
 * > **A textura pode ser um arquivo à parte** (o Kenney referencia
 * > `Textures/texture-a.png` de dentro do `.glb`). Por isso o caminho que vai
 * > ao loader é o da PASTA DO ARQUIVO, e não o da raiz de `web/modelos`: com a
 * > raiz, a textura dá 404, o modelo carrega assim mesmo e aparece **branco** —
 * > sem erro que aponte para o caminho.
 *
 * ## Como uma peça vira várias juntas
 *
 * Uma jaqueta cobre o tronco E os braços, e braço se mexe. Uma malha só,
 * pendurada no tronco, ficaria rígida enquanto o braço anda por dentro dela.
 *
 * Então o `.glb` de uma peça pode ter os nós nomeados como as JUNTAS
 * (`tronco`, `bracoE`, `bracoD`, `cabeca`, `pernaE`, `pernaD`) — e cada nó vai
 * para a sua. Um `.glb` simples, sem nó nomeado, vai inteiro para a junta
 * padrão do slot. Cabelo é um caso do primeiro tipo; um chapéu, do segundo.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/addons/GLTFLoader.js';
import { mergeGeometries } from '../vendor/three/addons/BufferGeometryUtils.js';
import { SLOTS, PECAS } from './aparencia.js';
import { perfilDoCorpo, ehPoseT, repartirTriangulos, baixarBracos } from './repartir.js';
import { acharOssos, frenteDoModelo, ehVrm } from './corpovivo.js';
import { religarPelaPose, humanoideDoVrm, ossosDoMixamo } from './animacao.js';

/** Onde os arquivos moram, e onde o manifesto é procurado. */
export const PASTA = '/web/modelos';
export const MANIFESTO = 'modelos.json';

/**
 * As juntas do boneco. **Este é o contrato com quem modela**: um nó de `.glb`
 * chamado com um destes nomes vai para a junta correspondente.
 *
 * Tem de bater com as juntas que `boneco3d.js` cria. Um nome a mais aqui é uma
 * parte que some (a junta não existe do outro lado); um a menos é uma parte que
 * cai na junta padrão sem ninguém entender por quê.
 */
export const JUNTAS = ['raiz', 'tronco', 'cabeca', 'bracoE', 'bracoD', 'pernaE', 'pernaD'];

/**
 * ONDE cada junta fica, e quanto mede o boneco. **Isto mora aqui, e não no
 * `boneco3d`, porque os dois precisam do mesmo número** — ele para pendurar as
 * partes, este para descontá-las.
 *
 * Um modelo é autorado com a própria origem: cada parte já vem no lugar certo
 * DENTRO do arquivo. Pendurá-la na minha junta somaria a posição duas vezes —
 * foi o que aconteceu na primeira tentativa, e o resultado foi um personagem
 * de 4,27 m com os pés a 80 cm do chão. Então a parte é assada em coordenada
 * de mundo e a âncora da junta é SUBTRAÍDA: ela volta exatamente para onde o
 * autor a pôs, e passa a girar em torno da minha junta — que é o que faz o
 * `andar()` continuar movendo braço e perna de um modelo importado.
 *
 * Duas contas para o mesmo número dariam um boneco remendado, e é a mesma
 * família do `alturaDoChao` com dois leitores (ver MUNDO-3D-HANDOFF §6).
 */
export const ALTURA_BONECO = 1.72;

export const ANCORAS = {
  raiz: [0, 0, 0],
  tronco: [0, 1.06, 0],
  cabeca: [0, 1.565, 0],
  bracoE: [-0.25, 1.30, 0],
  bracoD: [0.25, 1.30, 0],
  pernaE: [-0.105, 0.80, 0],
  pernaD: [0.105, 0.80, 0],
};

/**
 * Onde cai um `.glb` que não nomeia nenhuma junta.
 *
 * Calça e calçado caem nas DUAS pernas: um modelo de sapato é um sapato, e
 * pedir dois arquivos iguais a quem modela seria cobrar pelo simétrico.
 */
export const JUNTA_PADRAO = {
  cabelo: ['cabeca'],
  roupa: ['tronco'],
  calca: ['pernaE', 'pernaD'],
  sapato: ['pernaE', 'pernaD'],
};

/**
 * A chave do PERSONAGEM INTEIRO: um `.glb` só, com o corpo todo, repartido
 * pelas juntas.
 *
 * É como os pacotes de verdade vêm — ninguém distribui uma cabeça por arquivo.
 * Quando ela está carregada, ela manda: o corpo procedural e as peças de roupa
 * saem de cena, porque um personagem pronto já vem vestido e pôr uma cápsula de
 * blusa por cima dele seria empilhar duas roupas.
 */
export const CORPO_INTEIRO = 'corpo';

/**
 * A chave do corpo COM ESQUELETO. Separada de `corpo` de proposito: os dois sao
 * personagens inteiros, mas entram por caminhos diferentes (um fatiado e
 * pendurado nas juntas, o outro clonado com o esqueleto), e um `if` sobre a
 * mesma chave faria quem le ter de adivinhar qual e' qual.
 */
export const VIVO = 'corpo-vivo';

/** Este corpo tem esqueleto? (Um `SkinnedMesh` em qualquer lugar da cena.) */
function temEsqueleto(cena) {
  let sim = false;
  cena.traverse((n) => { if (n.isSkinnedMesh) sim = true; });
  return sim;
}

/** O corpo com esqueleto, se houver: `{ cena, animacoes, ossos, frente }`. */
export const corpoVivo = () => _carregados.get(VIVO) ?? null;

/** As partes do CORPO que também podem ser modeladas, e a junta de cada uma. */
export const PARTES_DO_CORPO = {
  'corpo-cabeca': 'cabeca',
  'corpo-tronco': 'tronco',
  'corpo-braco': 'bracoE',      // espelhado em bracoD pelo `boneco3d`
  'corpo-perna': 'pernaE',      // idem, em pernaD
};

/** chave → `{ juntas: {j: geo}, materiais: {j: mat|null} }`. Vazio = procedural. */
const _carregados = new Map();
let _estado = { manifesto: false, pedidos: 0, ok: 0, falhas: [] };

/** Toda chave que pode ter modelo. Sai do CATÁLOGO, e não de uma terceira lista. */
export function chavesConhecidas() {
  return [CORPO_INTEIRO, VIVO, ...Object.keys(PARTES_DO_CORPO),
          ...SLOTS.flatMap((s) => PECAS[s].map((p) => p.id))];
}

/**
 * A geometria de uma chave, por junta — ou `null` se não há modelo.
 *
 * **Síncrona de propósito.** `criarBoneco` é chamado no meio do laço, a cada
 * pessoa que entra na floresta; se a busca fosse assíncrona, ou o boneco
 * apareceria pelado por um instante, ou a montagem teria de virar `async` e
 * contaminar tudo acima. Quem paga a espera é o boot, uma vez
 * (`prepararModelos`), e é por isso que ele existe.
 */
export function geometriaDe(chave, junta = null) {
  const m = _carregados.get(chave);
  if (!m) return null;
  if (junta) return m.juntas[junta] ?? null;
  return m.juntas;
}

/**
 * O material que veio NO ARQUIVO, ou `null` quando quem pinta somos nós.
 * Ver as duas leis no cabeçalho.
 */
export function materialDe(chave, junta) {
  return _carregados.get(chave)?.materiais?.[junta] ?? null;
}

/** Há um personagem inteiro carregado? Se há, ele manda. */
export const temCorpoModelado = () => _carregados.has(CORPO_INTEIRO) || _carregados.has(VIVO);

/**
 * A parte do corpo de uma junta: do personagem inteiro, ou do arquivo avulso
 * daquela parte. Devolve `{ geo, mat }` — `mat` nulo quer dizer "pinte você".
 *
 * A ordem importa: o personagem inteiro vence o avulso. Sem isso, quem tem os
 * dois teria metade de um e metade do outro, e o boneco sairia remendado.
 */
export function parteDoCorpo(junta) {
  const doInteiro = geometriaDe(CORPO_INTEIRO, junta);
  if (doInteiro) return { geo: doInteiro, mat: materialDe(CORPO_INTEIRO, junta) };

  const chave = Object.keys(PARTES_DO_CORPO).find((k) => PARTES_DO_CORPO[k] === junta
    || (PARTES_DO_CORPO[k] === 'bracoE' && junta === 'bracoD')
    || (PARTES_DO_CORPO[k] === 'pernaE' && junta === 'pernaD'));
  if (!chave) return null;
  const lado = PARTES_DO_CORPO[chave];
  const geo = geometriaDe(chave, lado);
  return geo ? { geo, mat: materialDe(chave, lado) } : null;
}

/** O que entrou e o que faltou. É o que impede "faltou" de virar "faltou calado". */
export function estadoDosModelos() {
  return { ..._estado, carregadas: [..._carregados.keys()] };
}

/**
 * Achata um `.glb` em `{ junta: BufferGeometry }`.
 *
 * Exportada porque é a parte que erra CALADA e por isso tem teste: ela desiste
 * do material, aplica a matriz de mundo de cada malha (senão a peça monta na
 * origem, e não onde foi modelada) e funde tudo por junta — uma chamada de
 * desenho por junta, e não uma por triângulo que o exportador resolveu separar.
 */
export function repartirPorJunta(raiz, juntasPadrao, apelidos = {},
                                 { ancorar = false, manterUV = false, porPosicao = false } = {}) {
  const balde = new Map();
  const materiais = {};

  raiz.updateMatrixWorld(true);
  const partes = [];
  raiz.traverse((no) => {
    if (!no.isMesh || !no.geometry) return;

    // De qual junta é esta malha? Sobe pelos pais até achar um nome conhecido;
    // não achando, cai na padrão do slot.
    // O nome do nó, direto ou pelo APELIDO do manifesto. Nenhum pacote de
    // terceiro nomeia os nós com as nossas juntas (o Kenney usa `head`,
    // `arm-left`…), e exigir isso obrigaria a reexportar todo `.glb` que
    // chegasse. O apelido é por arquivo, no manifesto, e explícito.
    let junta = null;
    for (let p = no; p && !junta; p = p.parent) {
      const nome = apelidos[p.name] ?? p.name;
      if (JUNTAS.includes(nome)) junta = nome;
    }

    const g = no.geometry.clone();
    // Só posição e normal — quando o material é NOSSO.
    //
    // Uma PEÇA é tingida pelo vestiário, então `uv` e `color` não servem para
    // nada e atrapalham a fusão (ela exige atributos iguais). Um CORPO INTEIRO
    // é o oposto: ele entra com o material do arquivo, e o visual dele mora na
    // TEXTURA — apagar o `uv` ali faz cada vértice amostrar o mesmo pixel, e o
    // personagem inteiro sai de uma cor chapada só. Não dá erro; parece um
    // modelo mal-feito.
    for (const nome of Object.keys(g.attributes)) {
      if (nome === 'position' || nome === 'normal') continue;
      if (manterUV && nome === 'uv') continue;
      g.deleteAttribute(nome);
    }
    // Os MORPH TARGETS vão fora sempre.
    //
    // São as expressões faciais (um VRM do VRoid traz dezenas: piscar, sorrir,
    // as vogais da boca), e nada aqui as usa — o rosto não anima. Guardá-las
    // custaria uma cópia inteira da malha por expressão, e, pior, `mergeGeometries`
    // **LEVANTA** quando duas malhas do mesmo material têm conjuntos de morphs
    // diferentes. O erro sobe lá de dentro do addon como
    // `Cannot read properties of undefined (reading 'array')` e chega em
    // `estadoDosModelos().falhas` sem dizer uma palavra sobre expressão facial:
    // o personagem simplesmente não carrega e cai no boneco procedural.
    g.morphAttributes = {};
    g.morphTargetsRelative = false;
    if (!g.attributes.normal) g.computeVertexNormals();
    // A matriz de MUNDO, e não a local: o exportador aninha nós, e ignorar isso
    // empilha todas as partes na origem — plausível e errado.
    g.applyMatrix4(no.matrixWorld);
    partes.push({ g, no, junta });
  });

  // NINGUÉM nomeou junta nenhuma? Então reparte pela POSIÇÃO.
  //
  // É o caso da maioria: o Sketchfab renomeia tudo para `Object_17` ao
  // converter, e o modelo low-poly típico traz o corpo inteiro numa malha só.
  // Sem isto, tudo caía na junta padrão do slot — o personagem entrava
  // inteiriço e DESLIZAVA pelo chão, porque o `andar()` gira juntas e não havia
  // nada em junta nenhuma. Carregava, aparecia, e o defeito parecia do modelo.
  //
  // Ver `repartir.js`: o corte é por triângulo, o ombro sai da silhueta (e não
  // de uma fração fixa da altura, que o cabelo longo estragaria), e a pose de T
  // é medida e corrigida — braços abertos no jogo não são "pose de T" para quem
  // olha, são "quebrado".
  if (porPosicao && !partes.some((p) => p.junta)) {
    repartirPelaPosicao(partes);
  }

  // A ÂNCORA é descontada depois, porque só agora se sabe em que junta cada
  // parte caiu. Ver `ANCORAS`: sem isto a posição entra duas vezes.
  for (const { g, no, junta } of partes) {

    // A partir da segunda junta, cada uma recebe a SUA cópia: fundir a mesma
    // instância em duas juntas ligaria as duas ao mesmo buffer, e mexer numa
    // (o `mergeGeometries` consome os atributos) estragaria a outra.
    const destinos = junta ? [junta] : juntasPadrao;
    destinos.forEach((destino, i) => {
      if (!balde.has(destino)) balde.set(destino, []);
      const peca = i === 0 ? g : g.clone();
      if (ancorar) {
        const a = ANCORAS[destino] ?? [0, 0, 0];
        peca.translate(-a[0], -a[1], -a[2]);
      }
      balde.get(destino).push({ g: peca, mat: no.material ?? null });
    });
  }

  const juntas = {};
  for (const [junta, lista] of balde) {
    const { geo, mat } = fundirComMateriais(lista);
    juntas[junta] = geo;
    materiais[junta] = mat;
  }
  return { juntas, materiais };
}

/**
 * Funde as geometrias de uma junta, PRESERVANDO os materiais.
 *
 * `mergeGeometries(lista, false)` gruda tudo num buffer só, e aí só cabe UM
 * material — o primeiro. Num modelo de 11 materiais (pele, cabelo, blusa,
 * saia, sapato…) isso pinta o personagem inteiro com a textura da pele. Não dá
 * erro: ele aparece, monocromático, e parece arte ruim.
 *
 * Com `useGroups` a malha guarda um GRUPO por material e o `Mesh` aceita o
 * array — é assim que o three desenha um objeto multimaterial. Quando há um
 * material só, devolve o material solto: um array de um elemento funciona, mas
 * complica quem lê do outro lado sem ganhar nada.
 */
function fundirComMateriais(lista) {
  if (lista.length === 1) return { geo: lista[0].g, mat: lista[0].mat };

  // agrupa por material para não criar um grupo por malha: um personagem com
  // 72 malhas e 11 materiais viraria 72 chamadas de desenho em vez de 11
  const porMat = new Map();
  for (const { g, mat } of lista) {
    if (!porMat.has(mat)) porMat.set(mat, []);
    porMat.get(mat).push(g);
  }

  const geos = [];
  const mats = [];
  for (const [mat, lote] of porMat) {
    const um = lote.length === 1 ? lote[0] : mergeGeometries(igualarAtributos(lote), false);
    if (!um) continue;              // atributos incompatíveis: pula, não derruba
    geos.push(um);
    mats.push(mat);
  }
  if (!geos.length) return { geo: lista[0].g, mat: lista[0].mat };
  if (geos.length === 1) return { geo: geos[0], mat: mats[0] };

  const fundida = mergeGeometries(igualarAtributos(geos), true);
  return fundida ? { geo: fundida, mat: mats } : { geo: geos[0], mat: mats[0] };
}

/**
 * Dá a todas as geometrias o MESMO conjunto de atributos, preenchendo com zero
 * o que faltar.
 *
 * `mergeGeometries` exige conjuntos idênticos e, na versão vendorizada, **não
 * devolve `null` quando eles diferem: ela LEVANTA** (`Cannot read properties of
 * undefined (reading 'array')`, lá dentro do addon). O erro sobe como falha do
 * MODELO — a mensagem que chega em `estadoDosModelos().falhas` não diz nada
 * sobre atributo nenhum, e o personagem some para o boneco procedural.
 *
 * O caso real é um VRM do VRoid: parte das malhas tem `uv` (as texturizadas) e
 * parte não (a que usa só cor). Um `uv` de zeros numa malha que não tem textura
 * não muda nada do que se vê — ela já não amostrava imagem nenhuma.
 */
function igualarAtributos(lista) {
  const nomes = new Map();
  for (const g of lista) {
    for (const [nome, a] of Object.entries(g.attributes)) {
      if (!nomes.has(nome)) nomes.set(nome, a.itemSize);
    }
  }
  for (const g of lista) {
    const n = g.attributes.position?.count ?? 0;
    for (const [nome, itemSize] of nomes) {
      if (g.attributes[nome]) continue;
      g.setAttribute(nome, new THREE.BufferAttribute(new Float32Array(n * itemSize), itemSize));
    }
  }
  return lista;
}

/**
 * Decide a junta de cada parte pela POSIÇÃO, e corrige a pose de T.
 *
 * Muda `partes` no lugar: cada entrada ganha a `junta`, e uma malha que cruza
 * duas juntas é FATIADA em várias entradas — é o que separa um braço que
 * compartilha buffer com o tronco.
 */
function repartirPelaPosicao(partes) {
  const todas = [];
  for (const { g } of partes) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) todas.push([p[i], p[i + 1], p[i + 2]]);
  }
  const perfil = perfilDoCorpo(todas);
  if (!perfil) return;

  const emT = ehPoseT(perfil);
  // "Faltou" e' normal; "faltou e ninguem viu" nao e'. Quem largou um modelo
  // novo na pasta precisa poder conferir num relance se ele foi entendido — e a
  // POSE e' o numero que decide se ele entra em pe ou de bracos abertos.
  console.info(`[modelos] corpo repartido por posicao: ${perfil.alt.toFixed(2)} m,`
    + ` ombro em ${perfil.ombro.toFixed(2)}, ${emT ? 'pose de T CORRIGIDA' : 'bracos ja baixos'}`);
  const novas = [];
  for (const parte of partes) {
    const g = parte.g.index ? parte.g.toNonIndexed() : parte.g;
    const pos = g.attributes.position.array;
    if (emT) baixarBracos(pos, perfil);
    const grupos = repartirTriangulos(pos, perfil);
    const nomes = Object.keys(grupos);

    if (nomes.length === 1) {
      parte.g = g;
      parte.junta = nomes[0];
      novas.push(parte);
      continue;
    }
    // A malha cruza juntas: uma fatia por junta. É o corte que torna possível
    // animar um corpo que veio inteiro num buffer só.
    for (const nome of nomes) {
      novas.push({ g: fatiar(g, grupos[nome]), no: parte.no, junta: nome });
    }
  }
  partes.length = 0;
  partes.push(...novas);

  // as normais mudaram com a rotação dos braços; sem refazê-las o braço baixado
  // fica iluminado como se ainda estivesse na horizontal
  if (emT) for (const p of partes) p.g.computeVertexNormals();
}

/** Uma geometria nova com só os triângulos pedidos (índices de triângulo). */
function fatiar(g, triangulos) {
  const fora = new THREE.BufferGeometry();
  for (const nome of Object.keys(g.attributes)) {
    const a = g.attributes[nome];
    const n = a.itemSize;
    const arr = new Float32Array(triangulos.length * 3 * n);
    let w = 0;
    for (const t of triangulos) {
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < n; c++) arr[w++] = a.array[(t * 3 + k) * n + c];
      }
    }
    fora.setAttribute(nome, new THREE.BufferAttribute(arr, n));
  }
  return fora;
}

/**
 * Põe um personagem importado na escala e na origem do jogo: **1,72 m de
 * altura, os pés em `y = 0`, centrado em x e z**.
 *
 * É medida, e não um número escrito à mão por arquivo: cada pacote vem numa
 * unidade (o Kenney em ~2,5; outros em centímetros), e pedir a escala no
 * manifesto seria pedir a quem larga o arquivo que descubra um fator com
 * tentativa e erro — e um fator errado não dá erro, dá um gigante.
 *
 * Não mexe em ROTAÇÃO. Se o pacote olhar para -Z, o personagem fica de costas
 * para quem chega, e o conserto é reexportar: adivinhar a frente de um modelo
 * a partir da caixa envolvente acerta em uns e erra calado noutros.
 */
function normalizar(cena) {
  cena.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(cena);
  const alto = caixa.max.y - caixa.min.y;
  if (!(alto > 0.001)) return;

  const k = ALTURA_BONECO / alto;
  cena.scale.multiplyScalar(k);
  cena.updateMatrixWorld(true);

  const depois = new THREE.Box3().setFromObject(cena);
  const meio = depois.getCenter(new THREE.Vector3());
  cena.position.x -= meio.x;
  cena.position.z -= meio.z;
  cena.position.y -= depois.min.y;
  cena.updateMatrixWorld(true);
}

/**
 * Carrega o que houver. Chame UMA vez, no boot, antes do primeiro boneco.
 *
 * `buscar` é injetável para o teste poder rodar sem rede e sem servidor — o
 * mesmo padrão de `planoRapido(…, raridadeDe)` e `ouvirTransmissoes(conf, …)`.
 *
 * **Nunca levanta.** Falha de rede, manifesto torto, GLB recusado: tudo vira
 * uma entrada em `estadoDosModelos().falhas` e o boneco procedural de sempre. O
 * Mundo abrir sem arte é um Mundo abrindo; o Mundo não abrir é o pior desfecho
 * possível, e este módulo não tem nada tão importante a dizer.
 */
export async function prepararModelos({ base = PASTA, buscar = fetch } = {}) {
  _carregados.clear();
  _estado = { manifesto: false, pedidos: 0, ok: 0, falhas: [] };

  let mapa;
  try {
    const r = await buscar(`${base}/${MANIFESTO}`);
    // 404 é a resposta NORMAL enquanto não há arte. Não é falha, e não entra
    // na lista de falhas — senão o diagnóstico nasceria gritando.
    if (!r.ok) return estadoDosModelos();
    mapa = await r.json();
  } catch {
    return estadoDosModelos();
  }

  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) {
    _estado.falhas.push({ chave: MANIFESTO, porque: 'o manifesto nao e um objeto' });
    return estadoDosModelos();
  }

  _estado.manifesto = true;

  // As ANIMAÇÕES vêm numa chave à parte, e são carregadas DEPOIS do corpo: elas
  // precisam do mapa humanoide dele para religar, e o `Promise.all` abaixo não
  // garante ordem nenhuma. Ver `carregarAnimacoes`, no fim.
  const animacoes = (mapa.animacoes && typeof mapa.animacoes === 'object'
    && !Array.isArray(mapa.animacoes)) ? mapa.animacoes : null;
  delete mapa.animacoes;
  const conhecidas = new Set(chavesConhecidas());
  const loader = new GLTFLoader();

  await Promise.all(Object.entries(mapa).map(async ([chave, arquivo]) => {
    // Chave que não existe no catálogo é o erro de digitação clássico, e sem
    // isto ele seria idêntico a "ainda não modelei": o arquivo carrega, ocupa
    // memória e nunca é pedido por ninguém.
    if (!conhecidas.has(chave)) {
      _estado.falhas.push({ chave, porque: 'nao e uma peca nem uma parte do corpo' });
      return;
    }
    // A entrada do manifesto é um caminho, ou `{ arquivo, juntas }` quando os
    // nós do `.glb` precisam de apelido. Ver `repartirPorJunta`.
    const caminho = typeof arquivo === 'string' ? arquivo : arquivo?.arquivo;
    const apelidos = (typeof arquivo === 'object' && arquivo?.juntas) || {};
    if (typeof caminho !== 'string' || !caminho) {
      _estado.falhas.push({ chave, porque: 'entrada sem caminho no manifesto' });
      return;
    }

    _estado.pedidos++;
    try {
      const r = await buscar(`${base}/${caminho}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = await r.arrayBuffer();

      // O caminho que vai ao loader é o da PASTA DO ARQUIVO: é dele que saem
      // as texturas referenciadas de dentro do `.glb`. Passando a raiz, elas
      // dão 404, o modelo carrega assim mesmo e aparece BRANCO.
      const pasta = `${base}/${caminho}`.replace(/[^/]+$/, '');
      const gltf = await new Promise((resolve, reject) => {
        loader.parse(bytes, pasta, resolve, reject);
      });

      const slot = SLOTS.find((s) => PECAS[s].some((p) => p.id === chave));
      const padrao = slot ? JUNTA_PADRAO[slot]
        : chave === CORPO_INTEIRO ? ['tronco'] : [PARTES_DO_CORPO[chave]];

      // Um personagem pronto vem na escala e na origem de QUEM O FEZ — o do
      // Kenney tem 2,5 unidades e a origem no meio do corpo. Sem normalizar,
      // ele entra gigante e flutuando, e o mundo inteiro (câmera, etiqueta de
      // nome, altura do chão) passa a mentir junto.
      if (chave === CORPO_INTEIRO) normalizar(gltf.scene);

      // ------------------------------------------------ O CORPO COM ESQUELETO
      //
      // Se o arquivo tem esqueleto, ele NAO e' fatiado: a cena entra inteira e
      // quem anda e' o OSSO, com o skinning deformando a malha. E a diferenca
      // entre uma dobra lisa no ombro e um corte seco de boneco de blocos — que
      // e' o que o fatiamento deixa, e se ve de perto.
      //
      // O fatiamento (`repartir.js`) continua valendo para o corpo rigido, que
      // e' a maioria do que se baixa do Sketchfab. Os dois caminhos convivem
      // porque resolvem casos diferentes; escolher um so' perderia metade.
      if (chave === CORPO_INTEIRO && temEsqueleto(gltf.scene)) {
        const nomes = [];
        gltf.scene.traverse((n) => { if (n.name) nomes.push(n.name); });
        const ossos = acharOssos(gltf.parser?.json ?? null, nomes);
        _carregados.set(VIVO, {
          cena: gltf.scene,
          animacoes: gltf.animations ?? [],
          ossos,
          // MEDIDA na malha, não deduzida do formato — ver `frenteDoModelo`
          frente: frenteDoModelo(gltf.parser?.json ?? null, gltf.scene),
          vrm: ehVrm(gltf.parser?.json ?? null),
          // o mapa dos 54 ossos, para RELIGAR um clipe de fora (`animacao.js`).
          // É diferente de `ossos` acima, que traz só as sete juntas do nosso
          // boneco: um clipe move antebraço, mão e pé, que o `andar()` não
          // conhece e o skinning usa.
          humanoide: humanoideDoVrm(gltf.parser?.json ?? null),
        });
        console.info(`[modelos] corpo com ESQUELETO: ${Object.keys(ossos).length}/7 ossos`
          + `, ${(gltf.animations ?? []).length} animacao(oes)`);
        _estado.ok++;
        return;
      }

      const { juntas, materiais } = repartirPorJunta(gltf.scene, padrao, apelidos, {
        ancorar: chave === CORPO_INTEIRO,
        // as duas valem só para o CORPO: uma peça é tingida (não usa `uv`) e
        // vem nomeada ou vai inteira para a junta padrão do slot
        manterUV: chave === CORPO_INTEIRO,
        porPosicao: chave === CORPO_INTEIRO,
      });

      if (!Object.keys(juntas).length) throw new Error('o arquivo nao tem malha nenhuma');
      _carregados.set(chave, { juntas, materiais, arquivo: caminho });
      _estado.ok++;
    } catch (e) {
      _estado.falhas.push({ chave, porque: e?.message ?? String(e) });
    }
  }));

  if (animacoes) await carregarAnimacoes(animacoes, base, buscar);
  return estadoDosModelos();
}

/**
 * Baixa os clipes do manifesto e os RELIGA ao esqueleto do corpo.
 *
 * **Nunca levanta**, como o resto: animação que não carrega vira uma falha na
 * lista e o `andar()` escrito em código continua valendo. Um Mundo sem
 * animação de arquivo é um Mundo; um Mundo que não abre não é.
 *
 * O `.fbx` é lido pelo `FBXLoader` **importado sob demanda**: ele e as
 * dependências dele somam 50 KB no `game.zip`, e quem nunca põe uma animação
 * não paga o download nem o parse.
 */
async function carregarAnimacoes(mapa, base, buscar) {
  const corpo = _carregados.get(VIVO);
  if (!corpo?.humanoide) {
    _estado.falhas.push({ chave: 'animacoes', porque: 'nao ha corpo com esqueleto para religar' });
    return;
  }

  let FBXLoader = null;
  const clipes = new Map();

  for (const [nome, arquivo] of Object.entries(mapa)) {
    if (typeof arquivo !== 'string' || !arquivo) {
      _estado.falhas.push({ chave: `animacao:${nome}`, porque: 'entrada sem caminho' });
      continue;
    }
    _estado.pedidos++;
    try {
      const r = await buscar(`${base}/${arquivo}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = await r.arrayBuffer();

      let brutos;
      if (/\.fbx$/i.test(arquivo)) {
        FBXLoader ??= (await import('../vendor/three/addons/FBXLoader.js')).FBXLoader;
        brutos = new FBXLoader().parse(bytes, `${base}/`);
      } else {
        brutos = await new Promise((ok, erro) => {
          new GLTFLoader().parse(bytes, `${base}/`, ok, erro);
        });
      }

      const cru = (brutos.animations ?? []).find((a) => a.tracks?.length);
      if (!cru) throw new Error('o arquivo nao tem animacao');

      // O par `nome na origem -> nome no destino`, montado pelo osso humanoide,
      // que é o único vocabulário que os dois lados conhecem. Inclui os DEDOS —
      // sem eles a mão fica na pose de bind (reta e aberta) na ponta de um braço
      // que se move bem, e o relato foi exatamente esse: "as mãos duras,
      // estáticas". O polegar é resolvido lá dentro, porque as duas versões da
      // especificação do VRM discordam sobre o nome dele.
      const pares = ossosDoMixamo(corpo.humanoide);

      // Pela POSE, e não só pelo nome. Trocar o nome da pista só funciona quando
      // os dois esqueletos nascem com os ossos apontando para o mesmo lado —
      // Mixamo e VRoid não nascem, e o resultado foi um corpo com as pernas
      // para cima e os braços atravessando o tronco, com a animação
      // perfeitamente fluida. Ver `religarPelaPose`.
      //
      // **Sem `alturaDoQuadril`, de propósito.** Ela era `ANCORAS.pernaE[1]`
      // (0,80 m) — a junta da coxa do boneco de CÁPSULAS, que não tem nada a
      // ver com o quadril de um modelo importado (o deste está em 1,0127 m). A
      // pista do quadril entrava escalada para a altura errada e o corpo inteiro
      // descia 21 cm: os pés enterrados no chão. Hoje quem mede é
      // `religarPelaPose`, no esqueleto que vai receber o clipe.
      const { clipe, religadas, descartadas, deslocou } = religarPelaPose(THREE, {
        clipe: cru,
        fonte: brutos.scene ?? brutos,
        alvo: corpo.cena,
        pares,
      });
      if (!clipe) throw new Error('nenhuma pista casou com o esqueleto');

      clipe.name = nome;
      clipes.set(nome, clipe);
      _estado.ok++;
      console.info(`[modelos] animacao "${nome}": ${religadas} pistas religadas`
        + `, ${descartadas} descartadas, ${clipe.duration.toFixed(1)}s`
        + `, pes plantados ${(deslocou * 100).toFixed(1)} cm`);
    } catch (e) {
      _estado.falhas.push({ chave: `animacao:${nome}`, porque: e?.message ?? String(e) });
    }
  }

  corpo.clipes = clipes;
}
