/**
 * **CENÁRIO** — pôr uma construção pronta dentro do Mundo.
 *
 * A floresta é gerada em código (`floresta.js`); isto aqui é a porta para um
 * pedaço de mundo **modelado**, que chega como um pacote de malha e texturas.
 * Hoje quem produz esse pacote é `tools/tagforce/mapa.mjs`, mas este módulo não
 * sabe disso e não deve saber: ele valida uma FORMA, e qualquer coisa que
 * produza essa forma serve.
 *
 * ## Faltar é normal — a mesma lei do `modelos.js`
 *
 * Sem pacote, a floresta de sempre. Uma requisição, 404, segue o jogo. O que
 * **não** pode acontecer é "faltou e ninguém viu": pacote presente e torto tem
 * de ser recusado com motivo, porque uma malha lida errado **desenha alguma
 * coisa**, e alguma coisa na tela é indistinguível de acerto.
 *
 * ## A colisão sai da própria malha, e é de CÍRCULOS
 *
 * O Mundo colide círculo contra círculo (`livre`, em `floresta.js`) — é assim
 * que a árvore barra. Um cenário de 2.500 triângulos não pode virar 2.500
 * círculos, e triângulo a triângulo seria caro e ruim (uma parede vira um
 * colar de contas com furos entre elas).
 *
 * Então a conta é por CÉLULA: as faces **de parede** — as que não apontam para
 * cima — carimbam uma grade, e cada célula ocupada vira um círculo. Duas
 * decisões dentro disso, e as duas erram calado:
 *
 * - **a faixa de altura.** Sem ela, o CHÃO viraria parede (o piso tem face
 *   virada para cima, mas as bordas dele não) e o TELHADO também — e o jogador
 *   não conseguiria entrar em lugar nenhum. Só conta o que está na altura de
 *   quem anda: do tornozelo à cabeça. E o teste é de **cruzamento**, não de
 *   pertencimento: uma parede de piso a teto tem os vértices em `y=0` e `y=3`,
 *   os DOIS fora da faixa — perguntar "o vértice está na faixa?" faria a
 *   parede inteira deixar de barrar, que é o caso mais comum que existe.
 * - **o raio da célula.** Menor que a meia-diagonal deixa buraco na diagonal e
 *   o jogador atravessa a parede em ângulo; muito maior engorda tudo e a porta
 *   fecha sozinha. É a meia-diagonal, e é por isso que ela é calculada e não
 *   escrita.
 */

/** Grade da colisão, em metros. Menor que isto explode o número de círculos. */
export const CELULA = 0.7;

/** Do tornozelo à cabeça: o que barra quem anda. */
export const FAIXA = { de: 0.25, ate: 2.0 };

/** Acima disto a face é "chão/teto" e não vira parede. */
export const COS_PAREDE = 0.6;

/**
 * A forma que o Mundo aceita. Recusa com MOTIVO — nunca devolve "mais ou
 * menos", porque meia malha na tela passa por malha inteira.
 */
export function validarPacote(p) {
  if (!p || typeof p !== 'object') return { ok: false, motivo: 'pacote nao e objeto' };
  if (!Array.isArray(p.grupos) || !p.grupos.length) return { ok: false, motivo: 'sem grupos' };
  if (!p.caixa || !Array.isArray(p.caixa.min) || !Array.isArray(p.caixa.max)
      || p.caixa.min.length !== 3 || p.caixa.max.length !== 3)
    return { ok: false, motivo: 'caixa ausente ou torta' };

  let vertices = 0;
  for (const [i, g] of p.grupos.entries()) {
    if (!Array.isArray(g.pos) || !g.pos.length) return { ok: false, motivo: `grupo ${i} sem posicao` };
    if (g.pos.length % 9) return { ok: false, motivo: `grupo ${i} nao fecha em triangulos` };
    if (!Array.isArray(g.nor) || g.nor.length !== g.pos.length)
      return { ok: false, motivo: `grupo ${i}: normal nao acompanha a posicao` };
    if (!Array.isArray(g.uv) || g.uv.length !== (g.pos.length / 3) * 2)
      return { ok: false, motivo: `grupo ${i}: UV nao acompanha a posicao` };
    if (g.png != null && typeof g.png !== 'string')
      return { ok: false, motivo: `grupo ${i}: png nao e string` };
    vertices += g.pos.length / 3;
  }

  // a caixa tem de conter o que o pacote diz conter. Um pacote montado por
  // outra ferramenta pode trazer uma caixa herdada de outro arquivo, e aí o
  // cenario nasce enterrado ou flutuando — sem erro nenhum.
  for (const g of p.grupos) {
    for (let i = 0; i < g.pos.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const v = g.pos[i + e];
        if (!Number.isFinite(v)) return { ok: false, motivo: 'posicao com NaN' };
        if (v < p.caixa.min[e] - 0.05 || v > p.caixa.max[e] + 0.05)
          return { ok: false, motivo: 'vertice fora da caixa declarada' };
      }
    }
  }
  return { ok: true, vertices, triangulos: vertices / 3, grupos: p.grupos.length };
}

/**
 * Onde o cenário pousa. O `y` é escolhido para o **piso** do cenário encostar
 * no chão do ponto de destino: sem isto ele nasce na altura em que foi
 * modelado, que não é a altura do terreno aqui.
 */
export function assentar(pacote, { x = 0, z = 0, chao = 0 } = {}) {
  const cx = (pacote.caixa.min[0] + pacote.caixa.max[0]) / 2;
  const cz = (pacote.caixa.min[2] + pacote.caixa.max[2]) / 2;
  return { x: x - cx, y: chao - pacote.caixa.min[1], z: z - cz };
}

/**
 * Os círculos que barram o jogador, tirados das faces de parede. `offset` é o
 * que `assentar` devolveu — a colisão vive no mesmo espaço em que a malha é
 * desenhada, senão a parede fica num lugar e o bloqueio no outro.
 */
export function colisoresDoCenario(pacote, offset = { x: 0, y: 0, z: 0 },
                                   { celula = CELULA, faixa = FAIXA, cosParede = COS_PAREDE } = {}) {
  const celulas = new Map();
  const carimbar = (x, z) => {
    const cx = Math.round(x / celula), cz = Math.round(z / celula);
    celulas.set(cx + ',' + cz, { x: cx * celula, z: cz * celula });
  };

  for (const g of pacote.grupos) {
    for (let i = 0; i < g.pos.length; i += 9) {
      // a normal do triângulo: a média das três já basta para decidir
      // "parede ou não", e é mais barata que o produto vetorial
      let ny = 0;
      for (let k = 0; k < 3; k++) ny += g.nor[i + k * 3 + 1];
      if (Math.abs(ny / 3) > cosParede) continue;                 // chão ou teto

      const p = [0, 1, 2].map((k) => [
        g.pos[i + k * 3] + offset.x,
        g.pos[i + k * 3 + 1] + offset.y,
        g.pos[i + k * 3 + 2] + offset.z,
      ]);
      // CRUZA a faixa de quem anda? (não "está dentro dela" — ver o cabeçalho)
      const yMin = Math.min(p[0][1], p[1][1], p[2][1]);
      const yMax = Math.max(p[0][1], p[1][1], p[2][1]);
      if (yMax < faixa.de || yMin > faixa.ate) continue;

      // as três arestas, andadas em meia-célula: só carimbar os vértices
      // deixaria uma parede de 8 m com três círculos e um vão no meio
      for (let k = 0; k < 3; k++) {
        const a = p[k], b = p[(k + 1) % 3];
        const dx = b[0] - a[0], dz = b[2] - a[2];
        const passos = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (celula / 2)));
        for (let s = 0; s <= passos; s++) carimbar(a[0] + (dx * s) / passos, a[2] + (dz * s) / passos);
      }
    }
  }
  // meia-diagonal: menos que isto abre furo na diagonal e se atravessa a parede
  const r = (celula * Math.SQRT2) / 2;
  return [...celulas.values()].map((c) => ({ x: c.x, z: c.z, r }));
}

/**
 * De onde vem o pacote, e qual vem por padrão.
 *
 * O cenário mora em `web/cenarios/`, que **viaja no `game.zip`** como todo o
 * resto de `web/` — quem joga recebe o mesmo mundo que quem desenvolve. Foi
 * uma troca deliberada: enquanto era experimento ele ficava em `store/`, que o
 * Release não leva, e ali ele nunca chegaria a ninguém.
 *
 * **DESLIGADO por padrão desde 07/09/2026, e isto reverteu uma decisão minha.**
 * Ele chegou a nascer ligado, pelo argumento de que um mundo que muda conforme
 * o console de cada um não é um lugar de encontro. O argumento continua de pé —
 * e é irrelevante enquanto o cenário está quebrado: o Mundo é a floresta que
 * funciona, e a floresta é o padrão.
 *
 * A máquina fica inteira, e ligá-la é uma chave:
 * `localStorage['ygo:cenario'] = 'dormitorio'`. Ela é o caminho de quem
 * DESENVOLVE o cenário — e, quando um estiver bom, é `CENARIO_PADRAO` que volta
 * a apontar para ele.
 */
export const CHAVE_LOCAL = 'ygo:cenario';

/**
 * O cenário que entra sem ninguém pedir. `null` = a floresta de sempre.
 *
 * Não é uma string vazia nem o nome de um arquivo que não existe: `null` faz
 * `nomeDoCenario` responder "não há" ANTES de qualquer requisição, então o
 * Mundo desligado não paga nem o 404.
 */
export const CENARIO_PADRAO = null;
export const SEM_CENARIO = 'nenhum';

export const nomeDoCenario = (armazem) => {
  let escolhido = null;
  try { escolhido = armazem?.getItem(CHAVE_LOCAL) || null; } catch { escolhido = null; }
  const nome = escolhido ?? CENARIO_PADRAO;
  // `nenhum` é a saída explícita. Sem ela, desligar exigiria apagar a chave —
  // e "apagar para desligar" é o tipo de gesto que ninguém descobre sozinho.
  if (!nome || nome === SEM_CENARIO) return null;
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(nome) ? nome : null;
};

export const caminhoDoCenario = (nome) => `/web/cenarios/${nome}.json`;

/**
 * Busca e valida. **Nunca levanta**: devolve `null` quando não há cenário (o
 * caso comum) e `{ erro }` quando há e está torto — que é o caso que precisa
 * aparecer no console de quem acabou de gerar o pacote.
 */
export async function carregarCenario({ nome, buscar = fetch } = {}) {
  if (!nome) return null;
  let r;
  try { r = await buscar(caminhoDoCenario(nome)); } catch { return null; }
  if (!r || !r.ok) return null;
  let pacote;
  try { pacote = await r.json(); } catch { return { erro: 'json invalido' }; }
  const v = validarPacote(pacote);
  if (!v.ok) return { erro: v.motivo };
  return { pacote, ...v };
}
