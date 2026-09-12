/**
 * Floresta — o MAPA do cenário andável em 3D. Só decisão e conta: onde fica
 * cada árvore, qual é a altura do chão num ponto, o que bloqueia passagem e
 * onde os duelistas ficam de pé.
 *
 * A divisão é a mesma do mundo 2D, e de propósito: `citymap.js` diz o que
 * existe e onde, `tileset.js` desenha. Aqui `floresta.js` diz e `floresta3d.js`
 * desenha. Sem `three` e sem DOM, este arquivo roda em Node — que é como as
 * três armadilhas abaixo viraram teste em vez de "abre e vê".
 *
 * **A altura do chão é uma FUNÇÃO PURA, e isso é a peça mais importante do
 * arquivo.** Ela é consultada por dois leitores independentes: a malha do
 * terreno (que desloca cada vértice) e o loop (que põe os pés do jogador e dos
 * NPCs no chão). Duas contas parecidas mas diferentes não dão erro nenhum —
 * dão um jogador flutuando um palmo acima da grama, ou enterrado até o joelho,
 * conforme o pedaço do mapa. Por isso ninguém "estima" altura em lugar nenhum:
 * chama `alturaDoChao`.
 *
 * **O ruído é determinístico** (`rnd`, o MESMO de `tileset.js`): a floresta é
 * idêntica em toda máquina e em todo carregamento. Uma floresta sorteada a
 * cada boot faria todo relato de bug — "a árvore está dentro da pedra" —
 * impossível de reproduzir.
 *
 * **O que bloqueia é o TRONCO, não a copa.** Colisor do tamanho da copa
 * transforma o bosque numa parede sólida a três metros de distância; colisor
 * nenhum deixa atravessar o tronco. Nenhum dos dois dá erro — os dois só
 * fazem o mundo parecer errado.
 */
import { rnd } from './tileset.js';   // o MESMO ruido do mundo 2D

/**
 * As medidas do mundo, em METROS (a unidade do three; o boneco tem ~1,7).
 *
 * `raio` é onde está a parede invisível. Ela não é decoração: sem ela dá pra
 * sair andando para o vazio — o chão acaba, a névoa esconde que acabou, e o
 * jogo continua rodando sem um erro sequer enquanto o jogador caminha para
 * lugar nenhum.
 */
export const MUNDO = {
  raio: 92,            // parede invisível
  clareira: 13,        // o descampado onde os duelistas ficam
  rampa: 10,           // largura da transição entre a clareira plana e o relevo
  raioJogador: 0.42,   // raio de colisão dos pés
  raioInteracao: 3.4,  // "chegar perto" de um duelista
};

const DENSIDADE = {
  arvores: { passo: 5.4, salt: 11, min: 3.2 },
  pedras:  { passo: 17,  salt: 31, min: 3.0 },
  moitas:  { passo: 5.0, salt: 51, min: 0 },
  grama:   { passo: 1.9, salt: 71, min: 0, raio: 54 },
};

// ------------------------------------------------------------------ o relevo

const suave = (t) => t * t * (3 - 2 * t);

/**
 * Ruído de VALOR bilinear sobre a grade de `rnd`. `rnd` sozinho é branco —
 * pontos vizinhos não têm relação nenhuma, e um terreno feito dele seria uma
 * lixa de um metro de amplitude, intransitável. A interpolação é o que
 * transforma sorteio em colina.
 */
function ondulacao(x, z, celula, salt) {
  const fx = x / celula, fz = z / celula;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = suave(fx - ix), tz = suave(fz - iz);
  const a = rnd(ix, iz, salt), b = rnd(ix + 1, iz, salt);
  const c = rnd(ix, iz + 1, salt), d = rnd(ix + 1, iz + 1, salt);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}

/**
 * A altura do chão em (x, z). Três oitavas: colina larga, lombada média e uma
 * rugosidade fina que só existe para a luz rasante ter em que bater.
 *
 * A CLAREIRA é achatada até zero. Não é preciosismo: os duelistas ficam em pé
 * nela, e um descampado com 40cm de degrau põe um deles com os pés no ar e
 * outro afundado — e o painel de duelo abre do mesmo jeito, sem nada acusar.
 */
export function alturaDoChao(x, z) {
  const h =
      (ondulacao(x, z, 27, 1) - 0.5) * 5.4
    + (ondulacao(x, z, 9.5, 2) - 0.5) * 1.5
    + (ondulacao(x, z, 3.3, 3) - 0.5) * 0.34;

  const d = Math.hypot(x, z);
  if (d <= MUNDO.clareira) return 0;
  if (d >= MUNDO.clareira + MUNDO.rampa) return h;
  return h * suave((d - MUNDO.clareira) / MUNDO.rampa);
}

/** Quanto deste ponto é terra batida (1) em vez de mato (0) — pinta o chão. */
export function terraBatida(x, z) {
  const d = Math.hypot(x, z);
  const borda = MUNDO.clareira - 2.5;
  if (d <= borda) return 1;
  if (d >= MUNDO.clareira + 4) return 0;
  return 1 - suave((d - borda) / (MUNDO.clareira + 4 - borda));
}

/**
 * Variação de tom do chão (0..1), em manchas largas. Chão de uma cor só fica
 * plástico: é essa mancha que dá a impressão de mato mais alto num lugar e
 * mais ralo no outro, sem custar geometria nenhuma.
 *
 * Mora aqui, e não em quem desenha, pela mesma razão da altura: é ruído, e
 * ruído espalhado por dois arquivos é ruído que diverge.
 */
export function manchaDeChao(x, z) {
  return ondulacao(x, z, 13, 7) * 0.7 + ondulacao(x, z, 4.5, 8) * 0.3;
}

// --------------------------------------------------------------- povoamento

/**
 * Candidatos numa grade SACUDIDA: grade pura dá um pomar (fileiras visíveis a
 * qualquer distância), sorteio puro dá tufos e clareiras acidentais. A grade
 * com jitter é o meio-termo barato — e, por vir de `rnd`, continua o mesmo em
 * toda máquina.
 */
function* candidatos(passo, salt) {
  const n = Math.ceil((MUNDO.raio * 2) / passo);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      yield {
        x: -MUNDO.raio + (i + rnd(i, j, salt)) * passo,
        z: -MUNDO.raio + (j + rnd(i, j, salt + 1)) * passo,
        a: rnd(i, j, salt + 2),
        b: rnd(i, j, salt + 3),
        c: rnd(i, j, salt + 4),
      };
    }
  }
}

/** Distância mínima entre plantas do mesmo tipo — evita duas no mesmo tronco. */
function longeDeTodos(postos, x, z, min) {
  if (min <= 0) return true;
  const m2 = min * min;
  for (const p of postos) {
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz < m2) return false;
  }
  return true;
}

/**
 * A mata não pode encostar na clareira de repente — ela RAREIA. Perto do
 * descampado quase nada nasce; a uns 20m já é bosque fechado. Sem isso a
 * clareira vira um buraco recortado a compasso no meio das árvores.
 */
function chanceDeNascer(d, margem) {
  if (d < margem) return 0;
  if (d > MUNDO.raio - 2) return 0;
  return Math.min(1, (d - margem) / 16);
}

function povoar({ passo, salt, min }, margem, limite, molde) {
  const postos = [];
  for (const c of candidatos(passo, salt)) {
    if (postos.length >= limite) break;
    const d = Math.hypot(c.x, c.z);
    if (c.c > chanceDeNascer(d, margem)) continue;
    if (!longeDeTodos(postos, c.x, c.z, min)) continue;
    postos.push(molde(c, d));
  }
  return postos;
}

/**
 * Monta o cenário inteiro. Devolve tudo em coordenadas de mundo, com a altura
 * já resolvida — quem desenha não recalcula relevo nenhum (ver o cabeçalho:
 * duas contas de altura é o defeito que este arquivo existe para não ter).
 */
export function construirFloresta() {
  const margem = MUNDO.clareira + 2.5;

  const arvores = povoar(DENSIDADE.arvores, margem, 420, (c, d) => {
    // Duas espécies: conífera (cone empilhado) e copada (bolhas). Duas já
    // quebram o padrão o bastante; uma só faz um bosque de clones.
    const conifera = c.a < 0.42;
    const escala = (conifera ? 0.85 : 0.75) + c.b * (conifera ? 0.75 : 0.6);
    return {
      x: c.x, z: c.z, y: alturaDoChao(c.x, c.z),
      escala, conifera,
      giro: c.a * Math.PI * 2,
      // Inclinação pequena: árvore perfeitamente a prumo denuncia o gerador.
      tombo: (c.b - 0.5) * 0.09,
      fase: c.c * Math.PI * 2,   // desencontra o balanço ao vento
      distancia: d,
    };
  });

  const pedras = povoar(DENSIDADE.pedras, margem - 1, 60, (c) => ({
    x: c.x, z: c.z, y: alturaDoChao(c.x, c.z),
    escala: 0.5 + c.a * 1.5,
    giro: c.b * Math.PI * 2,
    tombo: (c.c - 0.5) * 0.6,
  }));

  // Samambaias: enfeite puro, atravessável. Elas entram DENTRO da clareira
  // também (margem menor), que é o que evita o descampado pelado.
  const moitas = povoar(DENSIDADE.moitas, MUNDO.clareira - 4, 520, (c) => ({
    x: c.x, z: c.z, y: alturaDoChao(c.x, c.z),
    escala: 0.55 + c.a * 0.75,
    giro: c.b * Math.PI * 2,
    fase: c.c * Math.PI * 2,
  }));

  // Grama: só perto, porque é o que mais custa e é o que menos se vê longe —
  // a névoa come tudo antes. O raio é uma economia deliberada, não um limite.
  const grama = [];
  for (const c of candidatos(DENSIDADE.grama.passo, DENSIDADE.grama.salt)) {
    const d = Math.hypot(c.x, c.z);
    if (d > DENSIDADE.grama.raio) continue;
    // Rareia sobre a terra batida: a clareira é pisada, e capim brotando no
    // meio do chão de terra desmente o próprio desenho do chão.
    if (c.c > 0.62 * (1 - terraBatida(c.x, c.z) * 0.9)) continue;
    grama.push({
      x: c.x, z: c.z, y: alturaDoChao(c.x, c.z),
      escala: 0.6 + c.a * 0.8,
      giro: c.b * Math.PI,
      fase: c.c * Math.PI * 2,
    });
  }

  // O que barra passagem. Copa e samambaia ficam de fora de propósito.
  const colisores = [
    ...arvores.map((a) => ({ x: a.x, z: a.z, r: 0.34 + a.escala * 0.26 })),
    ...pedras.filter((p) => p.escala > 0.8).map((p) => ({ x: p.x, z: p.z, r: p.escala * 0.75 })),
  ];

  return {
    arvores, pedras, moitas, grama, colisores,
    vagas: vagasDeNpc(colisores),
    entrada: { x: 0, z: MUNDO.clareira - 3.5 },
  };
}

/**
 * As vagas dos duelistas: um anel dentro da clareira, todos virados para o
 * centro. Vaga em cima de um colisor é DESCARTADA — um adversário dentro de um
 * tronco não dá erro nenhum, só é impossível de alcançar (a mesma armadilha
 * que `buildMap()` já documenta no mundo 2D, e que aqui tem teste).
 */
export function vagasDeNpc(colisores, quantas = 12) {
  const anel = MUNDO.clareira - 4.2;
  const vagas = [];
  for (let i = 0; i < quantas; i++) {
    // Começa em -90° para a primeira vaga não nascer em cima da entrada.
    const ang = -Math.PI / 2 + (i / quantas) * Math.PI * 2 + Math.PI / quantas;
    const x = Math.cos(ang) * anel, z = Math.sin(ang) * anel;
    if (!livre(colisores, x, z, 0.9)) continue;
    // Virado para o centro: `atan2(-x, -z)` é o giro em Y de um modelo que
    // olha para +Z.
    vagas.push({ x, z, y: alturaDoChao(x, z), giro: Math.atan2(-x, -z) });
  }
  return vagas;
}

/**
 * Dá para pisar aqui? Círculo contra círculo, mais a parede do mundo.
 *
 * `parede` é o raio dessa parede, e existe para o **Editor de Cena** poder
 * andar numa cena que vai além dos 92 m da floresta (uma cena chega a 400 m,
 * ver `LIMITE.xz`). Ela é parâmetro, e não uma segunda função lá: colisão
 * escrita duas vezes diverge calada, e o sintoma seria o pior possível — o
 * ambiente aprovado no teste do editor barrando de outro jeito no Mundo.
 */
export function livre(colisores, x, z, raio = MUNDO.raioJogador, parede = MUNDO.raio) {
  if (Math.hypot(x, z) > parede - raio) return false;
  for (const c of colisores) {
    const dx = c.x - x, dz = c.z - z;
    const r = c.r + raio;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

/**
 * Anda `dx`,`dz` respeitando os colisores, um EIXO DE CADA VEZ. É o mesmo
 * truque do mundo 2D: barrar em X ainda deixa deslizar em Z, e é isso que faz
 * o jogador escorregar contornando o tronco em vez de grudar nele.
 */
export function mover(colisores, x, z, dx, dz, raio = MUNDO.raioJogador, parede = MUNDO.raio) {
  let nx = x, nz = z;
  if (dx && livre(colisores, nx + dx, nz, raio, parede)) nx += dx;
  if (dz && livre(colisores, nx, nz + dz, raio, parede)) nz += dz;
  return { x: nx, z: nz };
}
