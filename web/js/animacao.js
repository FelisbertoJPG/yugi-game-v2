/**
 * **RELIGAR uma animação a um esqueleto que não é o dela.**
 *
 * Uma `AnimationClip` guarda pistas endereçadas por NOME de nó
 * (`mixamorigLeftArm.quaternion`). O clipe do Mixamo fala dos ossos do Mixamo;
 * o nosso personagem tem os ossos do VRoid (`J_Bip_L_UpperArm`). Tocar um no
 * outro **não dá erro**: o `AnimationMixer` procura os nós, não acha nenhum, e
 * o personagem fica parado. Nada no console, nada na tela — só um boneco imóvel
 * que parece uma animação que não foi baixada direito.
 *
 * Religar é traduzir os nomes, e a tradução passa por um terceiro vocabulário:
 * o **osso humanoide** (`leftUpperArm`), que é o único que os dois lados
 * conhecem. Do Mixamo vem por convenção de nome (`LeftArm` → `leftUpperArm`);
 * do VRM vem DECLARADO no arquivo (`extensions.VRM.humanoid.humanBones`).
 *
 * Medido com o "Samba Dancing" do Mixamo contra um VRoid: **23 das 53 pistas
 * religam, e são o corpo inteiro** — quadril, coluna, pescoço, cabeça, os dois
 * braços com antebraço e mão, as duas pernas com pé e dedo. As 30 que sobram
 * são falanges de dedo, que o VRM tem e o nosso boneco não precisa.
 *
 * ---
 *
 * ## O que erra CALADO aqui
 *
 * - **pista sem destino tem de SAIR do clipe.** Deixá-la faz o mixer avisar uma
 *   vez por pista no console (`.quaternion não é uma propriedade de`), e trinta
 *   avisos afogam qualquer erro de verdade.
 * - **a POSIÇÃO só vale no quadril.** Um clipe traz `position` em vários ossos,
 *   e aplicá-las num corpo de proporção diferente estica o esqueleto — braço
 *   saindo do ombro, perna descolando do quadril. Só a do quadril interessa (é
 *   ela que dá o quique do passo), e mesmo essa vai ESCALADA: o Mixamo trabalha
 *   em centímetros e o nosso mundo em metros.
 * - **o clipe não sabe a escala do corpo.** Um personagem de 1,72 m com um
 *   clipe feito para 1,60 m anda flutuando ou afundando se a translação do
 *   quadril entrar crua.
 */

/**
 * Os nomes do Mixamo, e o osso humanoide de cada um.
 *
 * É a convenção que o Mixamo usa em TODA animação que ele exporta — não é
 * palpite, é o esqueleto padrão dele.
 *
 * Os DEDOS ficam à parte, em `DEDOS_DO_MIXAMO` — não por serem menos
 * importantes, mas porque o polegar precisa do humanoide na mão para ser
 * resolvido (ver `POLEGAR`). Quem quer o mapa inteiro chama `ossosDoMixamo`.
 */
export const DO_MIXAMO = {
  Hips: 'hips',
  Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest',
  Neck: 'neck', Head: 'head',
  LeftShoulder: 'leftShoulder', LeftArm: 'leftUpperArm',
  LeftForeArm: 'leftLowerArm', LeftHand: 'leftHand',
  RightShoulder: 'rightShoulder', RightArm: 'rightUpperArm',
  RightForeArm: 'rightLowerArm', RightHand: 'rightHand',
  LeftUpLeg: 'leftUpperLeg', LeftLeg: 'leftLowerLeg',
  LeftFoot: 'leftFoot', LeftToeBase: 'leftToes',
  RightUpLeg: 'rightUpperLeg', RightLeg: 'rightLowerLeg',
  RightFoot: 'rightFoot', RightToeBase: 'rightToes',
};

/**
 * Os DEDOS, menos o polegar. Aqui as duas convenções concordam.
 *
 * ## Por que eles passaram a viajar
 *
 * Eles eram descartados, e a justificativa escrita aqui era *"o nosso boneco
 * não os move"* — o que é verdade sobre o `andar()` e irrelevante sobre um
 * clipe de arquivo, que move. O que sobrava era a mão na **pose de bind** do
 * VRoid: dedos retos e abertos, uma placa na ponta de um braço que se move
 * bem. O relato foi *"as mãos duras, estáticas, esticando as mesmas — perde a
 * naturalidade do restante da movimentação"*.
 *
 * O que estava sendo jogado fora, medido nos dois FBX do repositório: os dedos
 * chegam **desviados do descanso em até 29,8° (parado) e 49,2° (andar)** — é a
 * mão relaxada, a curva que separa "mão" de "espátula" —, e ainda **variam até
 * 10,9° e 18,9° ao longo do clipe**, que é a vida que se vê de perto.
 *
 * Elas custam 30 das 53 pistas. Não é caro: 30 quatérnios por quadro amostrado,
 * ~150 KB por clipe, e nenhum desenho a mais — o *skinning* já paga a malha da
 * mão inteira, dobrada ou reta.
 *
 * O Mixamo escreve `Pinky`; a especificação do VRM escreve `little`. É o único
 * lugar em que os dois vocabulários chamam o mesmo dedo por nomes diferentes, e
 * traduzir errado dá um mindinho girando com a rotação do anelar.
 */
export const DEDOS_DO_MIXAMO = {
  LeftHandIndex1: 'leftIndexProximal',
  LeftHandIndex2: 'leftIndexIntermediate',
  LeftHandIndex3: 'leftIndexDistal',
  LeftHandMiddle1: 'leftMiddleProximal',
  LeftHandMiddle2: 'leftMiddleIntermediate',
  LeftHandMiddle3: 'leftMiddleDistal',
  LeftHandRing1: 'leftRingProximal',
  LeftHandRing2: 'leftRingIntermediate',
  LeftHandRing3: 'leftRingDistal',
  LeftHandPinky1: 'leftLittleProximal',
  LeftHandPinky2: 'leftLittleIntermediate',
  LeftHandPinky3: 'leftLittleDistal',
  RightHandIndex1: 'rightIndexProximal',
  RightHandIndex2: 'rightIndexIntermediate',
  RightHandIndex3: 'rightIndexDistal',
  RightHandMiddle1: 'rightMiddleProximal',
  RightHandMiddle2: 'rightMiddleIntermediate',
  RightHandMiddle3: 'rightMiddleDistal',
  RightHandRing1: 'rightRingProximal',
  RightHandRing2: 'rightRingIntermediate',
  RightHandRing3: 'rightRingDistal',
  RightHandPinky1: 'rightLittleProximal',
  RightHandPinky2: 'rightLittleIntermediate',
  RightHandPinky3: 'rightLittleDistal',
};

/**
 * O POLEGAR, nas duas grafias que a especificação já teve — e o único osso do
 * corpo em que o mesmo nome quer dizer coisas diferentes conforme a versão.
 *
 * O VRM 0.x nomeia os três `Proximal → Intermediate → Distal`. O 1.0 renomeou o
 * primeiro para `Metacarpal` e **empurrou os outros dois um degrau**, então
 * `leftThumbProximal` é o osso da BASE num arquivo e o do MEIO no outro.
 *
 * Isso erra CALADO, e erra bonito: com a grafia errada o polegar inteiro anda
 * uma articulação, recebendo no nó da base a rotação que era do meio. A mão não
 * quebra — ela fica com um polegar torto que parece decisão de quem modelou.
 *
 * Por isso a escolha é do CONJUNTO e não osso a osso: quem declara
 * `thumbMetacarpal` é 1.0, e ponto. Resolver cada um pelo "primeiro nome que o
 * humanoide declara" acertaria o 1.0 e erraria o 0.x justamente no do meio, que
 * é onde os dois nomes se cruzam.
 */
export const POLEGAR = {
  novo: ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'],
  antigo: ['ThumbProximal', 'ThumbIntermediate', 'ThumbDistal'],
};

/**
 * O mapa `nome do nó do Mixamo -> nome do nó do destino`, pronto para
 * `religarPelaPose`. Corpo, dedos e o polegar já resolvido.
 *
 * O prefixo `mixamorig` é posto AQUI, num lugar só: montá-lo em quem chama era
 * a mesma string escrita em dois arquivos, e o dia em que ela divergisse
 * deixaria o personagem parado sem uma linha no console.
 */
export function ossosDoMixamo(humanoide) {
  const pares = new Map();
  if (!humanoide) return pares;

  const por = (mix, osso) => {
    const destino = humanoide[osso];
    if (destino) pares.set(`mixamorig${mix}`, destino);
  };

  for (const [mix, osso] of Object.entries(DO_MIXAMO)) por(mix, osso);
  for (const [mix, osso] of Object.entries(DEDOS_DO_MIXAMO)) por(mix, osso);

  for (const [lado, Lado] of [['left', 'Left'], ['right', 'Right']]) {
    const grafia = humanoide[`${lado}ThumbMetacarpal`] ? POLEGAR.novo : POLEGAR.antigo;
    grafia.forEach((osso, i) => por(`${Lado}HandThumb${i + 1}`, `${lado}${osso}`));
  }
  return pares;
}

/**
 * O osso humanoide de um nó de clipe, ou `null`.
 *
 * O `FBXLoader` **tira os dois-pontos** do nome (`mixamorig:LeftArm` vira
 * `mixamorigLeftArm`), então o prefixo é removido com o `:` opcional — exigir
 * o `:` faria nenhum nome casar, e o sintoma seria o personagem parado.
 *
 * O POLEGAR não sai daqui: sem o humanoide na mão não há como saber qual das
 * duas grafias vale (ver `POLEGAR`), e chutar uma põe a rotação no osso errado
 * em metade dos arquivos. Quem precisa do polegar chama `ossosDoMixamo`.
 */
export function ossoDaPista(nomeDoNo) {
  const limpo = String(nomeDoNo ?? '').replace(/^mixamorig:?/i, '');
  if (DO_MIXAMO[limpo]) return DO_MIXAMO[limpo];
  if (DEDOS_DO_MIXAMO[limpo]) return DEDOS_DO_MIXAMO[limpo];
  // um clipe já feito para VRM traz o nome humanoide direto
  const todos = [...Object.values(DO_MIXAMO), ...Object.values(DEDOS_DO_MIXAMO)];
  const humanoide = todos.find((o) => o.toLowerCase() === limpo.toLowerCase());
  return humanoide ?? null;
}

/**
 * O mapa COMPLETO `osso humanoide -> nome do nó`, da extensão VRM.
 *
 * Diferente de `ossosDoVrm` (em `corpovivo.js`), que devolve só as sete juntas
 * do nosso boneco: aqui interessam todos os 54, porque o clipe move antebraço,
 * mão e pé — ossos que o nosso `andar()` não conhece e o skinning usa.
 */
export function humanoideDoVrm(gltfJson) {
  const vrm = gltfJson?.extensions?.VRM ?? gltfJson?.extensions?.VRMC_vrm;
  const lista = vrm?.humanoid?.humanBones;
  if (!lista) return null;

  const fora = {};
  const por = (osso, no) => {
    const nome = gltfJson?.nodes?.[no]?.name;
    if (nome) fora[osso] = nome;
  };
  // VRM 0.x é um array de `{bone, node}`; 1.0 é um objeto `{hips: {node}}`
  if (Array.isArray(lista)) for (const b of lista) por(b?.bone, b?.node);
  else for (const [osso, v] of Object.entries(lista)) por(osso, v?.node);

  return Object.keys(fora).length ? fora : null;
}

/**
 * Religa um clipe a um esqueleto. Devolve `{ clipe, religadas, descartadas }`.
 *
 * O clipe ORIGINAL não é tocado: ele pode ser tocado noutro personagem, e
 * renomear as pistas no lugar ligaria o segundo ao esqueleto do primeiro.
 *
 * `alturaDoQuadril` é o `y` do quadril no corpo de destino, em metros. Com ele
 * a translação do quadril é reescalada; sem ele, ela é DESCARTADA — que é o
 * comportamento seguro: sem o quique o passo fica chapado, e com o quique na
 * escala errada o personagem afunda no chão ou flutua meio metro.
 *
 * `noLugar` (ligado por padrão) tira o AVANÇO horizontal — ver `prenderNoLugar`.
 */
export function religar(clipe, humanoide,
                        { alturaDoQuadril = null, escalaDoClipe = null, noLugar = true } = {}) {
  if (!clipe?.tracks || !humanoide) return { clipe: null, religadas: 0, descartadas: 0 };

  const pistas = [];
  let descartadas = 0;

  for (const t of clipe.tracks) {
    const corte = String(t.name).lastIndexOf('.');
    if (corte < 0) { descartadas++; continue; }
    const no = t.name.slice(0, corte);
    const prop = t.name.slice(corte + 1);

    const osso = ossoDaPista(no);
    const destino = osso ? humanoide[osso] : null;
    if (!destino) { descartadas++; continue; }

    // A POSIÇÃO só vale no quadril. Nos outros ossos ela ESTICA o esqueleto do
    // destino para as proporções do clipe: o braço sai do ombro, a perna
    // descola do quadril. Só a rotação viaja entre corpos diferentes.
    if (prop === 'position') {
      if (osso !== 'hips') { descartadas++; continue; }
      const k = escalaDoQuadril(t, alturaDoQuadril, escalaDoClipe);
      if (k === null) { descartadas++; continue; }
      const novo = t.clone();
      novo.name = `${destino}.${prop}`;
      for (let i = 0; i < novo.values.length; i++) novo.values[i] *= k;
      if (noLugar) prenderNoLugar(novo);
      pistas.push(novo);
      continue;
    }

    if (prop !== 'quaternion' && prop !== 'rotation' && prop !== 'scale') { descartadas++; continue; }
    const novo = t.clone();
    novo.name = `${destino}.${prop}`;
    pistas.push(novo);
  }

  if (!pistas.length) return { clipe: null, religadas: 0, descartadas };

  const fora = clipe.clone();
  fora.tracks = pistas;
  fora.name = clipe.name || 'clipe';
  return { clipe: fora, religadas: pistas.length, descartadas };
}

/**
 * O fator que põe a translação do quadril na escala do corpo de destino.
 *
 * O Mixamo trabalha em CENTÍMETROS (o quadril fica perto de 100) e o nosso
 * mundo em metros (perto de 0,8). Aplicar cru joga o personagem cem vezes para
 * cima — e como o `y` do grupo é somado ao chão, ele some da tela sem erro.
 *
 * `null` quando não há como saber: descartar a pista é melhor que chutar.
 */
export function escalaDoQuadril(pista, alturaDoQuadril, escalaDoClipe) {
  if (Number.isFinite(escalaDoClipe) && escalaDoClipe > 0) return escalaDoClipe;
  if (!Number.isFinite(alturaDoQuadril) || alturaDoQuadril <= 0) return null;

  // a altura MÉDIA do quadril no clipe é a referência: o pico e o vale são o
  // passo, e usar qualquer um dos dois deixaria o personagem na ponta do pé ou
  // enterrado durante metade da caminhada
  let soma = 0, n = 0;
  for (let i = 1; i < pista.values.length; i += 3) { soma += pista.values[i]; n++; }
  if (!n) return null;
  const media = soma / n;
  if (Math.abs(media) < 1e-6) return null;
  return alturaDoQuadril / media;
}

/**
 * Tira o AVANÇO horizontal do quadril, mantendo o quique. Muda a pista no lugar.
 *
 * Uma caminhada do Mixamo tem *root motion*: o quadril anda para a frente
 * durante o clipe — medido no "Walking", **1,62 m em 1 segundo**. Mas quem move
 * o personagem pelo mundo é o jogo (`mover()`, em `floresta.js`), a partir das
 * teclas e da colisão. Com os dois empurrando, o corpo **desliza para fora de
 * onde o jogo o pôs**: ele anda em diagonal, atravessa árvore (o colisor ficou
 * para trás) e volta ao lugar num salto no fim do ciclo.
 *
 * Nada disso dá erro. Parece bug de colisão, de rede, ou de câmera.
 *
 * O que fica é o **`y`**: o sobe-e-desce de 4 cm que faz o passo parecer passo.
 * O `x` e o `z` vão para o valor do PRIMEIRO quadro — e não para zero, porque
 * zero seria a origem do rig, e um rig cujo quadril não nasce em `x = 0`
 * ganharia um deslocamento lateral constante.
 */
export function prenderNoLugar(pista) {
  const v = pista?.values;
  if (!v || v.length < 3) return pista;
  const x0 = v[0], z0 = v[2];
  for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  return pista;
}

// ===========================================================================
// RELIGAR PELA POSE — a conta que faz o corpo não sair torto
// ===========================================================================

/**
 * Religa amostrando o clipe e corrigindo a **pose de descanso**.
 *
 * `religar` (acima) só troca o nome das pistas, e isso vale quando os dois
 * esqueletos foram modelados na mesma convenção. Mixamo e VRoid não foram, e o
 * resultado é o que se viu: *"as pernas pra cima, os braços pra trás,
 * atravessando o tronco"* — com a animação perfeitamente fluida, porque o
 * movimento estava certo e o referencial não.
 *
 * ---
 *
 * ## Por que trocar o nome não basta
 *
 * Uma rotação local só quer dizer a mesma coisa em dois esqueletos se o osso
 * **nasce apontando para o mesmo lado** nos dois. No Mixamo o eixo do braço é
 * um; no VRoid é outro. "Girar 30° em X" leva a lugares diferentes, e ninguém
 * pode saber isso lendo o nome do osso.
 *
 * O `retargetClip` do `SkeletonUtils` também não resolve: ele copia a rotação de
 * MUNDO do osso de origem para o de destino, o que é a mesma suposição por outro
 * caminho — funciona de Mixamo para Mixamo e quebra aqui. Foi medido antes de
 * escrever isto: cabeça, ombro e quadril saíam plausíveis e **o pé ia parar a
 * 1,64 m**, acima da cabeça.
 *
 * ## A conta
 *
 * O que viaja entre corpos não é a pose: é o **desvio da pose de descanso**.
 *
 * ```
 * W_destino(t) = W_origem(t) · W_origem_descanso⁻¹ · W_destino_descanso
 *                └──────────── o desvio ──────────┘
 * ```
 *
 * Em palavras: *"o quanto este osso girou em relação a como ele nasceu"*,
 * aplicado a como o osso do destino nasceu. Se os dois nascem iguais, os termos
 * de descanso se cancelam e sobra a cópia direta — que é o caso fácil, e é por
 * isso que a fórmula antiga funcionava às vezes.
 *
 * Depois vem a volta para o espaço local, que é o que uma pista guarda:
 * `L(t) = W_pai(t)⁻¹ · W(t)`. Por isso os ossos são percorridos **do pai para o
 * filho**: a rotação de mundo do pai já tem de estar calculada.
 *
 * ## O que erra CALADO aqui
 *
 * - **a POSIÇÃO não é copiada**, exceto o quadril. Copiá-la impõe as
 *   proporções do outro corpo: braço saindo do ombro, perna descolando. Os
 *   ossos do destino ficam com o comprimento que eles têm.
 * - **osso sem par fica na pose de descanso.** Um VRoid tem 124 ossos (cabelo,
 *   saia, seios); o Mixamo manda 65. Deixar os outros à deriva daria cabelo
 *   voando para dentro da cabeça.
 * - **a ordem dos quadros é a do clipe**, e não uma taxa fixa nossa: reamostrar
 *   a 30 quadros um clipe gravado a 24 introduz um tremor que só aparece em
 *   movimento lento.
 */
export function religarPelaPose(THREE, { clipe, fonte, alvo, pares, quadros = 30,
                                         alturaDoQuadril = null, noLugar = true }) {
  if (!clipe?.tracks?.length || !fonte || !alvo || !pares?.size) {
    return { clipe: null, religadas: 0, descartadas: 0 };
  }

  // ------------------------------------------------ as poses de DESCANSO
  fonte.updateMatrixWorld(true);
  alvo.updateMatrixWorld(true);

  const descansoFonte = new Map();
  const descansoAlvo = new Map();
  const localDescanso = new Map();
  const noFonte = new Map();
  const noAlvo = new Map();

  fonte.traverse((n) => { if (n.name) noFonte.set(n.name, n); });
  alvo.traverse((n) => { if (n.name) noAlvo.set(n.name, n); });

  for (const n of noFonte.values()) descansoFonte.set(n, mundo(THREE, n));
  for (const n of noAlvo.values()) {
    descansoAlvo.set(n, mundo(THREE, n));
    localDescanso.set(n, n.quaternion.clone());
  }

  // Os ossos do ALVO, do pai para o filho. A volta ao espaço local precisa da
  // rotação de mundo do pai já calculada — fora de ordem, cada osso corrige a
  // si mesmo contra um pai que ainda está na pose de descanso, e o erro se
  // acumula descendo a corrente.
  const ordem = [];
  (function descer(n) {
    if (n !== alvo) ordem.push(n);
    for (const f of n.children) descer(f);
  })(alvo);

  // ------------------------------------------------------- amostrar
  const mixer = new THREE.AnimationMixer(fonte);
  const acao = mixer.clipAction(clipe);
  // Sem PRENDER no fim, `setTime(duracao)` dá a volta e devolve o quadro ZERO.
  // Numa caminhada isso é inofensivo (o último quadro é o primeiro, que é o que
  // um ciclo quer), mas num gesto que não fecha — acenar, pular, sacar a carta —
  // o fim se perde e o movimento volta ao começo antes de terminar.
  acao.setLoop(THREE.LoopOnce, 1);
  acao.clampWhenFinished = true;
  acao.play();

  const n = Math.max(2, Math.round(clipe.duration * quadros));
  const dt = clipe.duration / (n - 1);
  const tempos = new Float32Array(n);
  const valores = new Map();          // nó do alvo -> Float32Array de quatérnios
  for (const [, destino] of pares) {
    const no = noAlvo.get(destino);
    if (no) valores.set(no, new Float32Array(n * 4));
  }

  const paraDestino = new Map();      // nó do alvo -> nó da fonte
  for (const [origem, destino] of pares) {
    const a = noAlvo.get(destino), o = noFonte.get(origem);
    if (a && o) paraDestino.set(a, o);
  }

  const qm = new Map();               // rotação de MUNDO calculada, por nó
  const tmp = new THREE.Quaternion();
  const q = new THREE.Quaternion();

  mixer.setTime(0);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    tempos[i] = t;
    mixer.setTime(t);
    fonte.updateMatrixWorld(true);

    for (const no of ordem) {
      const pai = no.parent === alvo ? null : no.parent;
      const qPai = pai ? qm.get(pai) : null;

      const daFonte = paraDestino.get(no);
      if (daFonte) {
        // W_destino = W_origem(t) · W_origem_descanso⁻¹ · W_destino_descanso
        q.copy(mundo(THREE, daFonte, tmp));
        q.multiply(tmp.copy(descansoFonte.get(daFonte)).invert());
        q.multiply(descansoAlvo.get(no));
      } else {
        // sem par: fica na pose de descanso, acompanhando o pai
        q.copy(qPai ?? new THREE.Quaternion()).multiply(localDescanso.get(no));
      }
      qm.set(no, (qm.get(no) ?? new THREE.Quaternion()).copy(q));

      const guarda = valores.get(no);
      if (guarda) {
        // de volta ao espaço LOCAL, que é o que a pista guarda.
        //
        // `normalize()` não é preciosismo: `Quaternion.invert()` é a CONJUGADA,
        // que só é a inversa de um quatérnio unitário. Com o `decompose` no
        // `mundo()` eles já chegam unitários, e este é o ponto onde essa
        // invariante fica escrita — é o valor que vai para a pista e some de
        // vista até aparecer como osso de comprimento variável (ver `mundo`).
        tmp.copy(qPai ?? new THREE.Quaternion()).invert().multiply(q).normalize();
        guarda[i * 4] = tmp.x; guarda[i * 4 + 1] = tmp.y;
        guarda[i * 4 + 2] = tmp.z; guarda[i * 4 + 3] = tmp.w;
      }
    }
  }

  // ------------------------------------------------------- montar
  const pistas = [];
  for (const [no, vals] of valores) {
    pistas.push(new THREE.QuaternionKeyframeTrack(`${no.name}.quaternion`, tempos, vals));
  }

  // O QUADRIL leva a posição — só ele, e escalada. Ver `religar`.
  const doQuadril = clipe.tracks.find((t) => /hips?\.position$/i.test(t.name));
  const alvoQuadril = noAlvo.get(pares.get(nomeSemProp(doQuadril?.name)));
  if (doQuadril && alvoQuadril) {
    // A altura do quadril é MEDIDA NO CORPO DE DESTINO, e não recebida como
    // constante. Era `ANCORAS.pernaE[1]` (0,80 m) — a junta da coxa do boneco
    // de cápsulas, que não é o quadril de ninguém: o quadril deste modelo está
    // em 1,0127 m. A pista entrava escalada para a altura errada, o corpo todo
    // descia 21 cm e **o dedo do pé ia parar a −15 cm do chão**.
    //
    // É a mesma família do `alturaDoChao` com dois leitores (MUNDO-3D-HANDOFF
    // §6): duas contas para o mesmo número, cada uma certa pela sua. Aqui a
    // conta é uma só — a do esqueleto que vai receber o clipe.
    const k = escalaDoQuadril(doQuadril, alturaDoQuadril ?? alvoQuadril.position.y, null);
    if (k !== null) {
      const p = doQuadril.clone();
      p.name = `${alvoQuadril.name}.position`;
      for (let i = 0; i < p.values.length; i++) p.values[i] *= k;
      if (noLugar) prenderNoLugar(p);
      pistas.push(p);
    }
  }

  if (!pistas.length) return { clipe: null, religadas: 0, descartadas: clipe.tracks.length };

  const fora = new THREE.AnimationClip(clipe.name || 'clipe', clipe.duration, pistas);

  // E o resto da altura sai MEDIDO no clipe já montado: a escala acerta a
  // amplitude do quique, o plantar acerta onde ele acontece. Ver
  // `plantarNoChao` — o alvo ainda está na pose de descanso aqui, e é disso
  // que ele precisa.
  const pes = [];
  for (const [origem, destino] of pares) {
    const osso = ossoDaPista(origem);
    if (!PES.has(osso)) continue;
    const no = noAlvo.get(destino);
    if (no) pes.push(no);
  }
  const { deslocou } = plantarNoChao(THREE, { clipe: fora, alvo, quadril: alvoQuadril, pes, quadros });

  return {
    clipe: fora, religadas: pistas.length, deslocou,
    descartadas: clipe.tracks.length - pistas.length,
  };
}

/** Os ossos que encostam no chão. A referência de cada um é o descanso DELE. */
const PES = new Set(['leftFoot', 'rightFoot', 'leftToes', 'rightToes']);

/**
 * **Põe os pés no chão.** Desloca a pista do quadril para que o ponto mais
 * baixo do passo aterrisse exatamente em `y = 0`. Muda o clipe no lugar.
 *
 * ## Por que a escala não basta
 *
 * `escalaDoQuadril` é uma conta MULTIPLICATIVA: ela converte a unidade do clipe
 * (o Mixamo em centímetros) e a proporção da perna. Onde o corpo pousa é uma
 * conta ADITIVA, e as duas estavam sendo feitas pelo mesmo número — o que só
 * acerta quando a pose média do clipe é a pose de descanso do modelo. Numa
 * caminhada não é: o joelho fica dobrado o tempo todo, e o quadril tem de ficar
 * MAIS BAIXO que no descanso para os pés continuarem no chão. Medido aqui:
 * −4,9 cm em `andar` contra ~0 em `parado`, no mesmo corpo.
 *
 * Separadas, cada uma faz o seu: a escala dá o tamanho do quique, o
 * deslocamento dá a altura em que ele acontece.
 *
 * ## A referência é o DESCANSO de cada osso, e não zero
 *
 * O osso do dedo deste modelo nasce a 4,5 cm do chão, o do tornozelo a 12 cm —
 * é a espessura do pé e do sapato. Plantar o OSSO em zero enterraria o modelo
 * de novo, pela metade. O que se mede é o desvio: `normalizar()` garante que na
 * pose de descanso a sola encosta em `y = 0`, então "este osso está abaixo de
 * onde ele nasceu" é a mesma frase que "o pé afundou".
 *
 * Vale nos DOIS sentidos: flutuar é tão errado quanto afundar, e um clipe cuja
 * pose média é mais alta que o descanso deixaria o personagem pairando.
 *
 * ## O que erra CALADO aqui
 *
 * O alvo é POSADO para medir — é a única forma de perguntar ao three, em vez de
 * refazer a cadeia de transformações por fora (que seria a segunda conta que
 * este arquivo inteiro existe para não ter). Sair daqui sem devolver a pose de
 * descanso deixaria o corpo travado no último quadro medido, e o clipe SEGUINTE
 * seria religado contra uma pose que não é o descanso de nada.
 */
export function plantarNoChao(THREE, { clipe, alvo, quadril, pes, quadros = 30 }) {
  const vazio = { deslocou: 0 };
  if (!clipe?.tracks?.length || !alvo || !quadril || !pes?.length) return vazio;
  const pista = clipe.tracks.find((t) => t.name === `${quadril.name}.position`);
  if (!pista || pista.values.length < 3) return vazio;

  // Medido no referencial do PAI do quadril, que é onde a pista escreve. Fazer
  // a conta em mundo daria um deslocamento na escala errada, porque a raiz do
  // corpo carrega a escala de `normalizar()`.
  const paiDoQuadril = quadril.parent ?? alvo;
  alvo.updateMatrixWorld(true);
  const paraOPai = new THREE.Matrix4().copy(paiDoQuadril.matrixWorld).invert();
  const v = new THREE.Vector3();
  const alturaDe = (no) => v.setFromMatrixPosition(no.matrixWorld).applyMatrix4(paraOPai).y;

  const descanso = pes.map(alturaDe);

  // a pose de quem o clipe toca, para devolver o alvo como ele estava
  const guardado = new Map();
  for (const t of clipe.tracks) {
    const no = alvo.getObjectByName(nomeSemProp(t.name));
    if (no && !guardado.has(no)) {
      guardado.set(no, { q: no.quaternion.clone(), p: no.position.clone() });
    }
  }

  const mixer = new THREE.AnimationMixer(alvo);
  const acao = mixer.clipAction(clipe);
  acao.setLoop(THREE.LoopOnce, 1);
  acao.clampWhenFinished = true;
  acao.play();

  const n = Math.max(2, Math.round(clipe.duration * quadros));
  const dt = clipe.duration / (n - 1);
  let afundou = Infinity;
  for (let i = 0; i < n; i++) {
    mixer.setTime(i * dt);
    alvo.updateMatrixWorld(true);
    for (let k = 0; k < pes.length; k++) {
      afundou = Math.min(afundou, alturaDe(pes[k]) - descanso[k]);
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(alvo);
  for (const [no, pose] of guardado) { no.quaternion.copy(pose.q); no.position.copy(pose.p); }
  alvo.updateMatrixWorld(true);

  if (!Number.isFinite(afundou) || Math.abs(afundou) < 1e-4) return vazio;
  for (let i = 1; i < pista.values.length; i += 3) pista.values[i] -= afundou;
  return { deslocou: -afundou };
}

/**
 * A rotação de MUNDO de um nó, tirada da matriz já atualizada.
 *
 * **`decompose`, e nunca `setFromRotationMatrix`.** O segundo supõe que os 3×3
 * de cima da matriz são uma rotação PURA — e a nossa não é: `normalizar()`
 * (em `modelos.js`) põe a escala do personagem na raiz do corpo, e ela desce
 * para a `matrixWorld` de todos os 152 nós. Com a escala junto, a fórmula do
 * traço devolve um quatérnio **não unitário**, e não unitário por um fator que
 * depende da própria rotação.
 *
 * O que isso causa é o defeito mais difícil de ler que este arquivo já teve:
 * `Matrix4.compose` usa a fórmula do quatérnio unitário, então um `|q| ≠ 1`
 * vira uma base torta — o osso filho passa a nascer a uma distância que MUDA
 * conforme o pai gira. O sintoma é a ponta da corrente tremendo: as mãos
 * (ombro → braço → antebraço → mão, quatro níveis de erro acumulado) vibrando
 * a cada quadro enquanto o corpo anda liso.
 *
 * Medido antes do conserto: **|q| = 0,975 em todas as 22 pistas**, com o osso
 * do antebraço mudando de comprimento 1,8% de um quadro para o outro. Nada dá
 * erro; nem o mixer, nem o skinning, nem o console.
 */
function mundo(THREE, no, alvo = new THREE.Quaternion()) {
  _pos ??= new THREE.Vector3();
  _esc ??= new THREE.Vector3();
  no.matrixWorld.decompose(_pos, alvo, _esc);
  return alvo;
}

// Rascunhos do `decompose`, que exige os três de saída. Nascem na primeira
// chamada porque o `THREE` chega por parâmetro (este módulo não o importa — é
// o que o deixa puro e testável sem o pacote inteiro).
let _pos = null, _esc = null;

const nomeSemProp = (nome) => {
  const i = String(nome ?? '').lastIndexOf('.');
  return i < 0 ? String(nome ?? '') : String(nome).slice(0, i);
};
