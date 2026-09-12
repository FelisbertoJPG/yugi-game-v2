/**
 * **Repartir um corpo SEM nomes de junta — pela posição.**
 *
 * `repartirPorJunta` (em `modelos.js`) acha a junta de cada malha pelo NOME do
 * nó. Funciona com o Kenney, que exporta `head`, `arm-left`, `leg-right`. Não
 * funciona com quase mais nada: o Sketchfab renomeia tudo para `Object_17` na
 * conversão, e a maioria dos modelos low-poly traz o corpo inteiro numa MALHA
 * SÓ — cabeça, tronco, braços e pernas no mesmo buffer.
 *
 * Sem os nomes, o corpo entrava pendurado no `tronco` e ficava **estático**: o
 * `andar()` gira as juntas, e se tudo está numa junta que não gira, o
 * personagem desliza pelo chão inteiriço. Ele "carregou", ninguém viu erro, e o
 * defeito parece do modelo.
 *
 * Aqui a junta é decidida pela POSIÇÃO do triângulo dentro do corpo, e o corte
 * é por triângulo (não por malha): é o que permite separar um braço que
 * compartilha buffer com o tronco.
 *
 * ---
 *
 * ## A POSE DE T, e por que ela não é detalhe
 *
 * Modelo de repositório vem quase sempre em T: braços na horizontal, abertos.
 * Pendurado assim, o personagem entra no jogo de braços abertos — e o
 * `andar()`, que gira o braço em torno de X, o faria **remar** para frente e
 * para trás sem nunca baixar. Ninguém olha isso e pensa "está em pose de T";
 * pensa "o modelo está quebrado".
 *
 * Então a pose é MEDIDA (a largura na altura do ombro contra a altura total) e
 * os braços são girados para baixo antes de entrar. É uma correção, não um
 * chute: um modelo que já vem com os braços baixos não passa no teste da
 * largura e sai intocado.
 *
 * ## O que erra CALADO aqui
 *
 * - **cortar pelo VÉRTICE em vez do triângulo** rasga a malha: os três vértices
 *   de um triângulo podem cair em juntas diferentes, e o triângulo teria de
 *   existir em duas. Aqui o triângulo inteiro vai para a junta do centro dele.
 * - **o limiar do ombro não pode ser uma fração fixa da altura.** Cabelo longo,
 *   chapéu e orelha de gato mudam a altura total sem mudar o corpo — e o ombro
 *   sairia do lugar. Ele sai da SILHUETA: a faixa mais larga do meio para cima.
 * - **a junta recebe a geometria em coordenadas do MUNDO.** Pendurá-la sem
 *   descontar a âncora soma a posição duas vezes, e o braço nasce a um metro do
 *   ombro. `modelos.js` já faz esse desconto — este arquivo devolve mundo.
 */

/** Onde cada faixa do corpo começa, em fração da altura. Só o palpite inicial. */
const PALPITE = { pescoco: 0.82, quadril: 0.47 };

/**
 * As alturas que separam cabeça, tronco e pernas, e a meia-largura do tronco.
 *
 * `pescoco` e `quadril` são procurados na SILHUETA e não fixados em fração da
 * altura: um cabelo longo ou um chapéu esticam a caixa sem mexer no corpo, e um
 * limiar fixo cortaria o pescoço no meio do peito.
 *
 * `posicoes` é uma lista de `[x, y, z]` em coordenadas de mundo.
 */
export function perfilDoCorpo(posicoes) {
  if (!posicoes?.length) return null;
  let ymin = Infinity, ymax = -Infinity;
  for (const p of posicoes) {
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  const alt = ymax - ymin;
  if (!(alt > 0)) return null;

  // A largura por faixa. 24 faixas dão ~7 cm num corpo de 1,7 m: fino o
  // bastante para achar o ombro, grosso o bastante para não depender de um
  // vértice solto.
  const FAIXAS = 24;
  const larg = new Array(FAIXAS).fill(0);
  const min = new Array(FAIXAS).fill(Infinity);
  const max = new Array(FAIXAS).fill(-Infinity);
  for (const p of posicoes) {
    const k = Math.min(FAIXAS - 1, Math.floor(((p[1] - ymin) / alt) * FAIXAS));
    if (p[0] < min[k]) min[k] = p[0];
    if (p[0] > max[k]) max[k] = p[0];
  }
  for (let k = 0; k < FAIXAS; k++) larg[k] = max[k] > min[k] ? max[k] - min[k] : 0;

  // O OMBRO é a faixa mais larga da metade de cima — com os braços abertos ela
  // é gritante (a envergadura), e com os braços baixos ainda é o ponto onde o
  // corpo para de afinar em direção à cabeça.
  let ombroK = Math.floor(FAIXAS * PALPITE.pescoco);
  let maior = 0;
  for (let k = Math.floor(FAIXAS * 0.5); k < FAIXAS; k++) {
    if (larg[k] > maior) { maior = larg[k]; ombroK = k; }
  }

  const meia = larguraDoTronco(larg, ombroK, FAIXAS);
  return {
    ymin, ymax, alt,
    // o pescoço fica logo ACIMA da faixa do ombro
    pescoco: ymin + ((ombroK + 1) / FAIXAS) * alt,
    ombro: ymin + ((ombroK + 0.5) / FAIXAS) * alt,
    quadril: ymin + PALPITE.quadril * alt,
    meiaLarguraDoTronco: meia,
    envergadura: maior,
    faixas: larg,
  };
}

/**
 * A meia-largura do TRONCO — o que separa braço de tronco no eixo X.
 *
 * Ela não pode sair da faixa do ombro (ali a largura é a envergadura, com os
 * braços). Sai da faixa logo abaixo do quadril do peito, onde só há tronco.
 */
function larguraDoTronco(larg, ombroK, FAIXAS) {
  const alvo = Math.max(0, Math.min(FAIXAS - 1, Math.floor(FAIXAS * 0.55)));
  // desce até achar uma faixa com largura plausível (a caixa do tronco pode não
  // ter vértice no meio: em low-poly ela tem vértice só no topo e na base)
  for (let k = alvo; k >= 0; k--) {
    if (larg[k] > 0) return larg[k] / 2;
  }
  return 0.15;
}

/**
 * Este corpo está em POSE DE T?
 *
 * A conta é a envergadura contra a altura. Em T ela chega perto de 1 (é a
 * proporção do corpo humano, e por isso o Vitruviano); com os braços ao longo
 * do corpo ela fica na casa de 0,3. O limiar de **0,62** fica no meio do vazio
 * entre os dois casos, longe de qualquer um — e é o que impede uma pose em A
 * (braços ligeiramente abertos) de ser "corrigida" para dentro do corpo.
 */
export function ehPoseT(perfil) {
  if (!perfil) return false;
  return perfil.envergadura / perfil.alt > 0.62;
}

/**
 * A junta de um ponto. `[x, y, z]` em mundo, mais o perfil.
 *
 * A ordem das perguntas é a que evita o erro comum: **braço antes de cabeça**.
 * Em pose de T a mão fica na altura do ombro, e uma regra que perguntasse "está
 * acima do pescoço?" primeiro mandaria as mãos para a cabeça — só se descobre
 * isso vendo o personagem andar de mãos na testa.
 */
export function juntaDoPonto([x, y], perfil) {
  const foraDoTronco = Math.abs(x) > perfil.meiaLarguraDoTronco;
  // o braço nasce no ombro e desce; acima do quadril e fora da largura do
  // tronco só pode ser braço
  if (foraDoTronco && y > perfil.quadril) return x < 0 ? 'bracoE' : 'bracoD';
  if (y >= perfil.pescoco) return 'cabeca';
  if (y < perfil.quadril) return x < 0 ? 'pernaE' : 'pernaD';
  return 'tronco';
}

/**
 * Reparte os triângulos de uma malha por junta.
 *
 * `pos` é um `Float32Array` de posições em MUNDO (3 por vértice, triângulos
 * consecutivos). Devolve `{ junta: [índices de triângulo] }`.
 *
 * O corte é por TRIÂNGULO, pelo centro dele: cortar por vértice rasgaria a
 * malha, porque os três vértices de um triângulo do ombro caem em juntas
 * diferentes e o triângulo teria de existir nas duas.
 */
export function repartirTriangulos(pos, perfil) {
  const fora = {};
  const n = Math.floor(pos.length / 9);
  for (let t = 0; t < n; t++) {
    const i = t * 9;
    const c = [
      (pos[i] + pos[i + 3] + pos[i + 6]) / 3,
      (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3,
      (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3,
    ];
    const j = juntaDoPonto(c, perfil);
    (fora[j] ??= []).push(t);
  }
  return fora;
}

/**
 * Baixa os braços de um corpo em pose de T. Muda `pos` NO LUGAR.
 *
 * Cada vértice de braço gira em torno do OMBRO daquele lado, no plano X-Y. O
 * pivô é o ponto onde o braço encontra o tronco — usar a origem do modelo
 * jogaria a mão para dentro da barriga.
 *
 * `angulo` é quanto baixar, em radianos. `1.15` (~66°) deixa o braço quase ao
 * longo do corpo, com a folga que uma pessoa em repouso tem.
 */
export function baixarBracos(pos, perfil, angulo = 1.35) {
  const n = Math.floor(pos.length / 9);
  for (let t = 0; t < n; t++) {
    const i = t * 9;
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
    const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const j = juntaDoPonto([cx, cy], perfil);
    if (j !== 'bracoE' && j !== 'bracoD') continue;

    const lado = j === 'bracoE' ? -1 : 1;
    const px = lado * perfil.meiaLarguraDoTronco;
    const py = perfil.ombro;
    // O SINAL, que já custou uma medição.
    //
    // Girar por `+angulo * lado` sobe os DOIS braços: para o braço direito
    // (`dx > 0`) o termo `dx·sen(a)` some em `y`, e para o esquerdo (`dx < 0`)
    // o `dx` negativo cancela o `a` negativo — os dois acabam positivos. O
    // resultado foi um personagem de 1,95 m com as mãos acima da cabeça, e a
    // medida o pegou: a altura devia ser 1,72.
    //
    // Descer é `−angulo` no lado direito e `+angulo` no esquerdo.
    const a = -angulo * lado;
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < 3; k++) {
      const dx = pos[i + k * 3] - px;
      const dy = pos[i + k * 3 + 1] - py;
      pos[i + k * 3] = px + dx * c - dy * s;
      pos[i + k * 3 + 1] = py + dx * s + dy * c;
    }
  }
  return pos;
}
