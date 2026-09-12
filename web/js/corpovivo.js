/**
 * **O corpo com ESQUELETO** — achar os ossos que importam, num arquivo qualquer.
 *
 * `repartir.js` resolve o corpo rígido: fatia a malha e pendura as fatias nas
 * juntas. Funciona, e tem um defeito que se vê de perto — **o corte no ombro e
 * no quadril é seco**, como num boneco de blocos. É o que sobra de qualidade
 * quando se anima geometria em vez de pele.
 *
 * Quando o arquivo traz esqueleto (todo VRM traz, e todo modelo do Mixamo
 * também), dá para fazer o certo: girar o OSSO e deixar o *skinning* deformar a
 * malha. A dobra fica lisa, sem emenda, e não custa nada — o three já faz isso.
 *
 * O problema é achar o osso. Cada pacote nomeia do seu jeito, e é isso que este
 * arquivo resolve, em três camadas, da mais confiável para a mais chutada:
 *
 * 1. **a extensão VRM** (`extensions.VRM.humanoid.humanBones`) — um mapa
 *    declarado pelo próprio arquivo, dizendo qual nó é o `leftUpperArm`. É
 *    verdade escrita pelo exportador, não adivinhação;
 * 2. **os nomes do Mixamo** (`mixamorig:LeftArm`), que são um padrão de fato;
 * 3. **nomes comuns** (`LeftArm`, `Arm_L`, `braco_e`…), normalizados.
 *
 * ## O que erra CALADO aqui
 *
 * - **girar o osso ERRADO não dá erro.** Se `leftUpperArm` cair na perna, o
 *   personagem anda chutando com o braço. Por isso a camada 1 existe e vem
 *   primeiro: ela é a única que não depende de convenção de nome.
 * - **o esqueleto é COMPARTILHADO se a cena for clonada com `Object3D.clone`.**
 *   Duas pessoas na floresta andariam em sincronia perfeita, com os mesmos
 *   ossos. É para isso que existe `SkeletonUtils.clone`, e quem monta o boneco
 *   tem de usá-lo.
 * - **o VRM olha para −Z.** A especificação manda o personagem encarar −Z, e o
 *   nosso boneco olha para +Z. Sem virar, todo mundo anda de costas — e "de
 *   costas" é fácil de não notar num teste e impossível de não notar jogando.
 */

/** As juntas do boneco, e o osso humanoide que corresponde a cada uma. */
export const OSSO_DA_JUNTA = {
  raiz: 'hips',
  tronco: 'spine',
  cabeca: 'head',
  bracoE: 'leftUpperArm',
  bracoD: 'rightUpperArm',
  pernaE: 'leftUpperLeg',
  pernaD: 'rightUpperLeg',
};

/**
 * Os nomes de nó que valem por cada osso humanoide, quando não há mapa VRM.
 *
 * Comparados **normalizados** (minúsculas, sem `mixamorig:`, sem `_`, `.` e
 * espaço): `mixamorig:LeftArm`, `Left_Arm` e `leftarm` são o mesmo osso, e
 * exigir a grafia exata reprovaria pacotes idênticos por causa de um sublinhado.
 */
export const NOMES = {
  hips: ['hips', 'quadril', 'pelvis', 'root'],
  spine: ['spine', 'spine1', 'chest', 'upperchest', 'tronco', 'torso'],
  head: ['head', 'cabeca', 'neck'],
  leftUpperArm: ['leftarm', 'leftupperarm', 'armleft', 'arml', 'upperarml', 'shoulderl'],
  rightUpperArm: ['rightarm', 'rightupperarm', 'armright', 'armr', 'upperarmr', 'shoulderr'],
  leftUpperLeg: ['leftupleg', 'leftupperleg', 'legleft', 'legl', 'upperlegl', 'thighl'],
  rightUpperLeg: ['rightupleg', 'rightupperleg', 'legright', 'legr', 'upperlegr', 'thighr'],
};

/** Minúsculas, sem prefixo de rig e sem separador. */
export const normalizarNome = (n) => String(n ?? '')
  .replace(/^mixamorig:?/i, '')
  .replace(/[\s_.:-]/g, '')
  .toLowerCase();

/**
 * O mapa `junta -> nome do nó`, lido da extensão VRM.
 *
 * `null` quando o arquivo não é VRM ou não declara o humanoide — e aí quem
 * chama cai nos nomes. Devolver um mapa vazio seria pior: quem lê não
 * distinguiria "não é VRM" de "é VRM e não achei nada".
 */
export function ossosDoVrm(gltfJson) {
  const vrm = gltfJson?.extensions?.VRM ?? gltfJson?.extensions?.VRMC_vrm;
  const lista = vrm?.humanoid?.humanBones;
  if (!lista) return null;

  // VRM 0.x traz um ARRAY de `{ bone, node }`; VRM 1.0 traz um OBJETO
  // `{ hips: { node } }`. Ler só um dos dois deixa metade dos arquivos de fora,
  // e o sintoma é o corpo cair no caminho dos nomes sem ninguém saber por quê.
  const porOsso = new Map();
  if (Array.isArray(lista)) {
    for (const b of lista) if (b?.bone !== undefined) porOsso.set(b.bone, b.node);
  } else if (typeof lista === 'object') {
    for (const [osso, v] of Object.entries(lista)) {
      if (v?.node !== undefined) porOsso.set(osso, v.node);
    }
  }
  if (!porOsso.size) return null;

  const fora = {};
  for (const [junta, osso] of Object.entries(OSSO_DA_JUNTA)) {
    const i = porOsso.get(osso);
    const nome = gltfJson?.nodes?.[i]?.name;
    if (nome) fora[junta] = nome;
  }
  return Object.keys(fora).length ? fora : null;
}

/**
 * O mapa `junta -> nome do nó`, deduzido dos NOMES presentes.
 *
 * A ordem de `NOMES` importa: o primeiro que casar vence. `spine` antes de
 * `chest` porque o tronco inteiro girando a partir do peito deixa o quadril
 * parado e o personagem anda partido ao meio.
 */
export function ossosPorNome(nomesDeNo) {
  const vistos = new Map();
  for (const n of nomesDeNo ?? []) {
    const k = normalizarNome(n);
    if (k && !vistos.has(k)) vistos.set(k, n);
  }
  const fora = {};
  for (const [junta, osso] of Object.entries(OSSO_DA_JUNTA)) {
    for (const cand of NOMES[osso] ?? []) {
      if (vistos.has(cand)) { fora[junta] = vistos.get(cand); break; }
    }
  }
  return fora;
}

/**
 * O mapa final: VRM se houver, nomes se não, e o que faltar fica de fora.
 *
 * Uma junta ausente é normal (nem todo rig tem `spine`) e **não** é motivo para
 * desistir do esqueleto: o que existe já anima. Desistir por causa de um osso
 * faltando devolveria o corpo ao corte seco, que é justamente o que se veio
 * evitar.
 */
export function acharOssos(gltfJson, nomesDeNo) {
  return ossosDoVrm(gltfJson) ?? ossosPorNome(nomesDeNo);
}

/** É um VRM? (Vale para a pose de repouso; a FRENTE é medida, não deduzida.) */
export const ehVrm = (gltfJson) =>
  !!(gltfJson?.extensions?.VRM || gltfJson?.extensions?.VRMC_vrm);

/**
 * O corpo está virado para onde? `+1` = olha para `+Z` (como o nosso boneco),
 * `-1` = olha para `-Z` e precisa de meia-volta.
 *
 * **Isto é MEDIDO, e a primeira versão errou por não medir.**
 *
 * Eu tinha lido na especificação do VRM que o personagem encara −Z, e devolvia
 * `-1` para todo VRM. O modelo entrou virado, e o sintoma foi *"o modelo está se
 * movimentando de trás pra frente"*: ele andava de costas, com a caminhada
 * certa. Nada dá erro — um personagem de costas parece um defeito de câmera, ou
 * do modelo, ou da animação. Qualquer coisa menos uma constante trocada.
 *
 * A medida é o **dedo do pé contra o calcanhar**: o dedo aponta para a frente
 * em todo bípede, e a conta vale para qualquer rig — VRoid, Mixamo, ou um
 * exportador que ninguém viu ainda. Medido no modelo: `dz = +0,137`, ou seja
 * `+Z`, o mesmo lado do nosso boneco. A especificação podia estar certa e o
 * exportador não; a malha na mão não mente.
 *
 * Sem achar pé e dedo, devolve `+1` — **não virar**. Entre errar virando e
 * errar não virando, a segunda é a recuperável: um personagem de frente com o
 * modelo torto ainda é jogável, e de costas não.
 */
export function frenteDoModelo(_gltfJson, cena = null) {
  if (!cena?.traverse) return 1;

  // O nome vem com PREFIXO em quase todo rig — `J_Bip_L_Foot` no VRoid,
  // `mixamorig:LeftFoot` no Mixamo (esse o `normalizarNome` já tira). Ancorar o
  // regex no começo (`/^l.../`) reprovava o VRoid inteiro, e o efeito foi pior
  // que reprovar: a função caía no `return 1` do fim e o modelo funcionava **pelo
  // motivo errado**. Um teste com nomes de VRoid é o que separa as duas coisas.
  //
  // O LADO tem de ser o mesmo nos dois, senão se compara o pé esquerdo com o
  // dedo direito e a conta sai do eixo Z. `toe` é procurado antes de `foot`
  // porque `LeftToeBase` contém as duas palavras — na ordem contrária, o dedo
  // seria confundido com o pé e `dz` daria zero.
  let pe = null, dedo = null;
  cena.traverse((n) => {
    const k = normalizarNome(n.name);
    if (!k) return;
    if (!dedo && /l(eft)?toe/.test(k)) { dedo = n; return; }
    if (!pe && /l(eft)?foot/.test(k)) pe = n;
  });
  if (!pe || !dedo) return 1;

  cena.updateMatrixWorld(true);
  const a = pe.matrixWorld.elements, b = dedo.matrixWorld.elements;
  const dz = b[14] - a[14];          // a translação em Z da matriz de mundo
  if (Math.abs(dz) < 1e-4) return 1;
  return dz > 0 ? 1 : -1;
}

/**
 * Quanto BAIXAR cada braço, em radianos, a partir da pose do arquivo.
 *
 * A pose de bind do VRM é **T** — a especificação manda. Um personagem que entra
 * no jogo de braços abertos não parece "em pose de T" para quem olha; parece
 * quebrado. E o `andar()` gira o braço em torno de X, o que o faria remar para
 * frente e para trás sem nunca baixar.
 *
 * O eixo é **Z** (o braço se estende no X, então descê-lo é girar no plano X-Y),
 * e o sinal é oposto entre os lados — com o mesmo sinal os dois vão para o mesmo
 * lado, um baixando e o outro subindo por cima da cabeça.
 *
 * `1.30` (~75°) deixa o braço quase ao longo do corpo, com a folga que uma
 * pessoa em repouso tem. Medido no modelo: a mão sai de 0° (horizontal) para
 * 71° abaixo dela.
 */
export const REPOUSO_DO_BRACO = 1.30;

/**
 * A rotação de repouso de cada junta, em `{ junta: { eixo, valor } }`.
 *
 * Só os braços por enquanto: perna e tronco já vêm na pose certa em todo
 * humanoide, porque a pose de T só abre os braços.
 */
export function poseDeRepouso(ehVrm = true) {
  if (!ehVrm) return {};
  return {
    bracoE: { eixo: 'z', valor: -REPOUSO_DO_BRACO },
    bracoD: { eixo: 'z', valor: REPOUSO_DO_BRACO },
  };
}
