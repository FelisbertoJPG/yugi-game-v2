/**
 * **CENA** — a lista de peças que formam um lugar, e as regras dela.
 *
 * Uma cena é um arranjo: *que peça, onde, virada para onde, de que tamanho*.
 * Isto aqui é o modelo — sem DOM, sem three, sem rede —, e é por isso que ele
 * tem teste. O editor (`cenaeditor.js`) desenha e arrasta; o Mundo
 * (`cenario3d.js`) monta. Os dois leem daqui.
 *
 * Mesma divisão de `boards.js` (o schema do tabuleiro) e `campoeditor.js` (o
 * editor dele) — e não por gosto de simetria: é o que deixa provar em Node que
 * uma cena gravada há um mês continua abrindo.
 *
 * ---
 *
 * ## O que erra CALADO aqui
 *
 * Uma cena é dado que **envelhece**: ela é gravada hoje e lida daqui a meses,
 * por um cliente mais novo, com uma biblioteca de peças que mudou. Três
 * defeitos nascem disso, e nenhum dá erro:
 *
 * - **peça que sumiu da biblioteca** vira uma malha que não carrega. Se isso
 *   derrubasse a leitura, uma peça renomeada apagaria a cena inteira; se
 *   passasse batido, o Mundo abriria com um buraco e ninguém saberia por quê.
 *   Aqui ela é SEPARADA (`faltando`), para quem lê decidir — o editor avisa, o
 *   Mundo ignora e segue.
 * - **número torto** (`NaN`, `null`, texto) numa coordenada vira `NaN` na
 *   matriz do objeto, e **objeto com matriz NaN simplesmente não aparece** —
 *   a mesma armadilha que o `MUNDO-3D-HANDOFF.md` documenta para as
 *   instâncias. Por isso a leitura DESCARTA em vez de consertar: `Number(null)`
 *   e `Number('')` são **0**, um lugar legítimo no meio do mapa, onde a peça
 *   apareceria plantada com toda a naturalidade.
 * - **escala zero ou negativa** faz a peça sumir ou nascer do avesso (com as
 *   faces viradas para dentro, invisíveis no culling). É limitada, não
 *   descartada: quem digitou 0 quis dizer "pequena".
 */

/** Limites da colocação. Existem para o dedo escorregado não jogar a peça no infinito. */
export const LIMITE = { xz: 400, y: 200, escala: { min: 0.05, max: 20 } };

/** Uma cena vazia, que é o que se abre num editor sem nada. */
export const cenaVazia = (nome = 'nova') =>
  ({ nome, itens: [], relevo: relevoVazio(), regras: regrasVazias() });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const prender = (v, min, max) => Math.min(max, Math.max(min, v));

/** Um id de peça: slug, a mesma forma que o extrator gera. */
export const ehIdDePeca = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);

/**
 * Lê um item cru. Devolve `null` quando ele não dá para ser confiado — quem
 * chama trata isso como "esta linha não existe", nunca como "põe no zero".
 */
export function lerItem(cru) {
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return null;
  if (!ehIdDePeca(cru.peca)) return null;

  const x = num(cru.x), y = num(cru.y), z = num(cru.z);
  if (x === null || y === null || z === null) return null;

  const giro = num(cru.giro) ?? 0;
  const escala = num(cru.escala) ?? 1;
  const item = {
    peca: cru.peca,
    x: prender(x, -LIMITE.xz, LIMITE.xz),
    y: prender(y, -LIMITE.y, LIMITE.y),
    z: prender(z, -LIMITE.xz, LIMITE.xz),
    // o giro é livre: dar a volta é legítimo, e prendê-lo faria a peça travar
    // ao girar sempre para o mesmo lado
    giro: ((giro % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    escala: prender(escala, LIMITE.escala.min, LIMITE.escala.max),
  };
  // `!== null` e não `if (col)`: `false` é uma DECISÃO ("esta peça não colide")
  // e é falsy — com o teste de verdade ele era descartado na leitura, e o
  // colisor desligado voltava ligado ao reabrir a cena. Sem erro nenhum: a
  // peça simplesmente barrava de novo, e a decisão parecia não ter sido salva.
  const col = lerColisor(cru.col);
  if (col !== null) item.col = col;
  return item;
}

/**
 * O ajuste do COLISOR de um item — o que na Unity se arrasta nas alças verdes.
 *
 * `false` é "esta peça não colide", e é diferente de `{}`: o primeiro é uma
 * decisão, o segundo é ausência de ajuste. Guardar `false` como se fosse "sem
 * ajuste" perderia a decisão na primeira gravação.
 *
 * As escalas são MULTIPLICADORES da caixa medida, não medidas absolutas: a peça
 * pode ser redimensionada depois, e um colisor em metros fixos deixaria de
 * acompanhá-la — que é justamente o defeito que o pedido de caixa "que segue o
 * tamanho" existiu para resolver.
 */
export function lerColisor(cru) {
  if (cru === false) return false;
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return null;
  const n = (v, padrao) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
  const desl = (v) => prender(n(v, 0), -LIMITE_COLISOR.desloca, LIMITE_COLISOR.desloca);
  const esc = (v) => prender(n(v, 1), LIMITE_COLISOR.min, LIMITE_COLISOR.max);
  const col = {
    dx: desl(cru.dx), dy: desl(cru.dy), dz: desl(cru.dz),
    ex: esc(cru.ex), ey: esc(cru.ey), ez: esc(cru.ez),
  };
  // ajuste que não ajusta nada não é gravado: uma cena de duzentas peças
  // carregaria duzentos objetos idênticos ao padrão
  return ehColisorPadrao(col) ? null : col;
}

export const LIMITE_COLISOR = { desloca: 20, min: 0.01, max: 10 };

export const ehColisorPadrao = (c) => !!c && c.dx === 0 && c.dy === 0 && c.dz === 0
  && c.ex === 1 && c.ey === 1 && c.ez === 1;

/** O colisor "sem ajuste", para a tela ter de onde partir ao mexer. */
export const colisorNeutro = () => ({ dx: 0, dy: 0, dz: 0, ex: 1, ey: 1, ez: 1 });

/**
 * Lê uma cena inteira. **Nunca levanta** e nunca devolve `null`: uma cena
 * ilegível vira uma cena VAZIA com a conta do que caiu, porque o editor abrindo
 * em branco é ruim e o editor não abrindo é pior.
 *
 * `conhecidas` é opcional — um `Set` de ids que a biblioteca tem. Com ele, as
 * peças que sumiram saem separadas em vez de misturadas com as tortas: são
 * problemas diferentes, com respostas diferentes.
 */
export function lerCena(cru, conhecidas = null) {
  const vazia = { ...cenaVazia(), descartados: 0, faltando: [] };
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return vazia;

  const lista = Array.isArray(cru.itens) ? cru.itens : [];
  const itens = [];
  const faltando = [];
  let descartados = 0;

  for (const bruto of lista) {
    const item = lerItem(bruto);
    if (!item) { descartados++; continue; }
    if (conhecidas && !conhecidas.has(item.peca)) { faltando.push(item.peca); continue; }
    itens.push(item);
  }
  return {
    nome: typeof cru.nome === 'string' && cru.nome.trim() ? cru.nome.trim().slice(0, 60) : 'nova',
    itens,
    // o relevo é lido pelo `lerRelevo`, que descarta nó torto — ver lá embaixo
    relevo: lerRelevo(cru.relevo),
    regras: lerRegras(cru.regras),
    descartados,
    faltando: [...new Set(faltando)],
  };
}

/**
 * O que vai para o disco. Arredondado na gravação pelo mesmo motivo do pacote
 * de malha: `0.30000000000000004` é ruído de ponto flutuante, não precisão, e
 * uma cena de duzentas peças paga isso duzentas vezes.
 */
export function paraGravar(cena) {
  const r = (v, casas = 3) => {
    const k = 10 ** casas;
    const n = Math.round(v * k) / k;
    return Object.is(n, -0) ? 0 : n;
  };
  const fora = {
    nome: cena.nome || 'nova',
    itens: (cena.itens ?? []).map((i) => {
      const linha = {
        peca: i.peca, x: r(i.x), y: r(i.y), z: r(i.z),
        giro: r(i.giro, 4), escala: r(i.escala, 3),
      };
      // `col` só entra quando existe — e `false` é um valor, não uma ausência
      if (i.col === false) linha.col = false;
      else if (i.col) {
        linha.col = { dx: r(i.col.dx), dy: r(i.col.dy), dz: r(i.col.dz),
                      ex: r(i.col.ex), ey: r(i.col.ey), ez: r(i.col.ez) };
      }
      return linha;
    }),
  };
  // o relevo só vai quando existe: uma cena plana não carrega um objeto vazio
  if (temRelevo(cena.relevo)) fora.relevo = cena.relevo;
  if (temRegras(cena.regras)) fora.regras = cena.regras;
  return fora;
}

/** Põe uma peça na cena. Devolve a cena NOVA e o índice do que entrou. */
export function acrescentar(cena, peca, { x = 0, y = 0, z = 0, giro = 0, escala = 1 } = {}) {
  const item = lerItem({ peca, x, y, z, giro, escala });
  if (!item) return { cena, indice: -1 };
  const itens = [...cena.itens, item];
  return { cena: { ...cena, itens }, indice: itens.length - 1 };
}

/** Move/gira/redimensiona um item. Índice fora da lista devolve a cena intacta. */
export function mexer(cena, indice, mudanca) {
  if (!(indice >= 0 && indice < cena.itens.length)) return cena;
  const atual = cena.itens[indice];
  const item = lerItem({ ...atual, ...mudanca });
  // uma mudança que não dá para ler é ignorada, e o item FICA como estava:
  // apagá-lo seria perder trabalho por causa de um arrasto torto
  if (!item) return cena;
  const itens = [...cena.itens];
  itens[indice] = item;
  return { ...cena, itens };
}

/** Tira um item. */
export function remover(cena, indice) {
  if (!(indice >= 0 && indice < cena.itens.length)) return cena;
  return { ...cena, itens: cena.itens.filter((_, i) => i !== indice) };
}

/** Duplica um item, deslocado — é o gesto mais comum ao montar uma fileira. */
export function duplicar(cena, indice, desloc = 1) {
  if (!(indice >= 0 && indice < cena.itens.length)) return { cena, indice: -1 };
  const a = cena.itens[indice];
  return acrescentar(cena, a.peca, { ...a, x: a.x + desloc, z: a.z + desloc });
}

/** Quais peças esta cena usa — é o que o Mundo precisa baixar, e só isso. */
export const pecasUsadas = (cena) => [...new Set((cena?.itens ?? []).map((i) => i.peca))];

/**
 * Onde a cena mora, e por quê.
 *
 * Ela é gravada em **`store/cena-<nome>.json`**, pela rota `/__store/` que já
 * existe — e existe nos DOIS back-ends (`tools/serve.mjs` e `StaticServer.cs`).
 * Uma rota nova teria de ser escrita duas vezes, e o projeto já pagou por
 * divergência entre as duas: grava no `npm run dev` e falha no jogo instalado.
 *
 * > **Consequência assumida: a cena ainda NÃO viaja no Release.** `store/` tem
 * > uma allowlist de cinco `.json` nominais (`UpdateEngine.GlobaisPermitidos`),
 * > e a cena não está nela. Isso está certo para o que ela é hoje — trabalho em
 * > andamento de quem administra. No dia em que uma cena estiver pronta para o
 * > jogador, ela vai para `web/cenas/` e passa a viajar, exatamente como o
 * > cenário do dormitório fez.
 */
export const PREFIXO = 'cena-';
export const arquivoDaCena = (nome) => `${PREFIXO}${nome}.json`;

/**
 * A CHAVE de `projectstore.js` — o mesmo caminho de `banlist`, `boosters` e
 * `npcs`. Ela dá três coisas de graça, e as três já foram pagas por este
 * projeto de outra forma: publica no Supabase (a cena montada numa máquina
 * abre na outra), espelha em `store/` e entra na FILA de pendências quando a
 * rede cai — em vez de dizer "salvo" sobre uma edição que não existe para mais
 * ninguém.
 */
export const chaveDaCena = (nome) => `${PREFIXO}${nome}`;
export const caminhoDaCena = (nome) => `/__store/${arquivoDaCena(nome)}`;

/** Um nome de cena: slug curto, porque ele vira nome de arquivo. */
export const ehNomeDeCena = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,30}$/.test(v);

export const CATALOGO = '/web/pecas/catalogo.json';
export const caminhoDaPeca = (id) => `/web/pecas/p/${id}.json`;
export const caminhoDaTextura = (slug) => `/web/pecas/tex/${slug}.png`;

// ===========================================================================
// GRUDAR NA GRADE, EMPILHAR E COLIDIR
//
// As três coisas que separam "arrastar peça" de "montar um lugar", e as três
// são conta pura — por isso moram aqui, e não no editor.
// ===========================================================================

/** Os passos que o editor oferece. `0` é livre (sem grudar). */
export const PASSOS = [0, 0.25, 0.5, 1, 2, 4];

/** O passo de fábrica. 1 m é o da Unity, e é o que casa com peça de 2 e de 4. */
export const PASSO_PADRAO = 1;

/**
 * Gruda um valor no passo. `passo` 0 (ou torto) devolve o valor intacto — modo
 * livre é uma escolha legítima, não um defeito.
 */
export const grudar = (v, passo) =>
  (Number.isFinite(passo) && passo > 0 && Number.isFinite(v) ? Math.round(v / passo) * passo : v);

/**
 * O passo que ESTA peça usa.
 *
 * Uma peça com `modulo` (as placas de chão) gruda no tamanho DELA, e não no
 * passo do editor — é o que faz duas placas de 4 m ficarem lado a lado sem
 * fresta e sem sobrepor. Com o passo de 1 m, dá para pôr uma em `x=0` e outra
 * em `x=3`: elas se cruzam, e o resultado é uma costura no chão que só aparece
 * quando a câmera passa por cima.
 *
 * O módulo vence o passo do editor de propósito, INCLUSIVE no modo livre: quem
 * escolheu "livre" quer liberdade para a árvore, não para o ladrilho.
 */
export const passoDe = (peca, passoDoEditor = PASSO_PADRAO) =>
  (Number.isFinite(peca?.modulo) && peca.modulo > 0 ? peca.modulo : passoDoEditor);

/**
 * A pegada de um item no chão, já com giro e escala.
 *
 * O giro é aplicado ao RETÂNGULO e a caixa é a envolvente do resultado — uma
 * peça girada 45° ocupa mais que a largura dela, e ignorar isso deixa o
 * colisor menor que a peça: o jogador entra pela quina, que é o defeito que
 * ninguém reporta como colisão e sim como "atravessei a parede".
 */
export function caixaDoItem(item, dim) {
  const [lx, ly, lz] = (dim ?? [1, 1, 1]).map((v) => (Number.isFinite(v) ? v : 1));
  const e = Number.isFinite(item?.escala) ? item.escala : 1;
  const g = Number.isFinite(item?.giro) ? item.giro : 0;
  const c = Math.abs(Math.cos(g)), s = Math.abs(Math.sin(g));
  const largura = (lx * c + lz * s) * e;
  const fundo = (lx * s + lz * c) * e;
  const alto = ly * e;
  const x = Number.isFinite(item?.x) ? item.x : 0;
  const y = Number.isFinite(item?.y) ? item.y : 0;
  const z = Number.isFinite(item?.z) ? item.z : 0;
  return {
    min: [x - largura / 2, y, z - fundo / 2],
    max: [x + largura / 2, y + alto, z + fundo / 2],
  };
}

/**
 * A ALTURA em que um item pousa se cair daqui — o topo do que estiver embaixo,
 * ou o chão (`0`).
 *
 * É o que faz uma pedra pousar EM CIMA da montanha em vez de dentro dela, e é
 * conta pura de propósito: raycast contra malha responderia a mesma pergunta
 * pagando a geometria inteira, e erraria em peça com buraco (a copa da árvore
 * tem vão entre as bolhas — o raio passa e a pedra afunda até o tronco).
 *
 * `ignorar` é o índice do próprio item: sem ele, a peça pousaria em cima de si
 * mesma e subiria um andar a cada tecla.
 */
export function alturaDePouso(caixas, x, z, { ignorar = -1, tetoMax = Infinity } = {}) {
  let topo = 0;
  for (let i = 0; i < caixas.length; i++) {
    if (i === ignorar) continue;
    const c = caixas[i];
    if (!c) continue;
    if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2]) continue;
    if (c.max[1] > topo && c.max[1] <= tetoMax) topo = c.max[1];
  }
  return topo;
}

/**
 * Os círculos que barram o jogador — a mesma forma que `floresta.js` já usa
 * para as árvores (`livre` colide círculo contra círculo).
 *
 * Uma peça vira VÁRIOS círculos quando é comprida: um só, com o raio da
 * diagonal, engordaria um muro de 8 m num disco de 4 m de raio, fechando a
 * passagem ao lado dele. O passo é o menor lado, então uma peça quadrada dá um
 * círculo e uma comprida dá uma fileira.
 *
 * `alturaMin` deixa de fora o que não barra quem anda: uma placa de CHÃO tem
 * pegada enorme e altura zero, e virar colisor faria o mapa inteiro ser
 * intransponível — o defeito mais fácil de criar aqui.
 */
export function colisoresDaCena(cena, dimDe, { alturaMin = 0.4, infoDe = null } = {}) {
  const fora = [];
  const regras = cena?.regras;
  for (const item of cena?.itens ?? []) {
    const dim = dimDe?.(item.peca);
    if (!dim) continue;

    // Quem barra é a REGRA, e a altura é só o padrão dela. Sem `infoDe` não há
    // classe para consultar, e aí só valem a regra da peça e a altura — é o que
    // mantém todo chamador antigo com o comportamento de antes.
    const info = infoDe ? infoDe(item.peca) : { id: item.peca, grupo: null };
    if (!colide(regras, info, dim, { alturaMin })) continue;

    const c = caixaDeColisao(item, dim);
    if (!c) continue;                                     // colisor desligado no item

    const lx = c.max[0] - c.min[0], lz = c.max[2] - c.min[2];
    const raio = Math.min(lx, lz) / 2;
    if (!(raio > 0.05)) continue;
    const nx = Math.max(1, Math.round(lx / (raio * 2)));
    const nz = Math.max(1, Math.round(lz / (raio * 2)));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        fora.push({
          x: c.min[0] + ((i + 0.5) * lx) / nx,
          z: c.min[2] + ((k + 0.5) * lz) / nz,
          r: raio,
        });
      }
    }
  }
  return fora;
}

// ===========================================================================
// RELEVO — o chão que sobe e desce
//
// **É da CENA, não da peça.** As alturas moram numa grade compartilhada, e cada
// placa de terreno lê os cantos dela dessa grade. É o que faz duas placas
// vizinhas casarem SOZINHAS: elas dividem o mesmo nó, então levantar um ponto
// levanta o canto das duas ao mesmo tempo.
//
// Fosse propriedade de cada peça (quatro cantos por placa), montar um morro
// exigiria acertar canto a canto e casar com a vizinha à mão — e um erro de um
// centímetro abriria uma fresta que só aparece com a câmera rente ao chão.
//
// > **Só o SOLO se deforma.** Árvore e pedra não têm vértice para levantar: elas
// > POUSAM na altura do terreno. Quem decide isso é o `terreno: true` do
// > catálogo, e o editor recusa esculpir onde não há placa de terreno.
// ===========================================================================

/**
 * O lado da célula do relevo — a menor coisa que dá para esculpir.
 *
 * Era 4 m (o módulo das placas), e isso impedia **fendas**: o menor acidente
 * possível é um cone de dois passos de largura, então nada abaixo de 8 m
 * existia. Um vale de 8 m de boca com queda suave é um vale; uma fenda, não.
 *
 * Com 2 m o menor acidente cai para 4 m de boca, que já é greta. Não custa
 * nada quando o chão é plano — o relevo é ESPARSO, só o que foi esculpido
 * ocupa lugar — e a placa é subdividida a ~1 m, então a grade fina cabe
 * inteira no desenho.
 *
 * Cena antiga continua abrindo: `passo` é gravado DENTRO do relevo e
 * `alturaDoRelevo`/`lerRelevo` leem o que está lá, não esta constante.
 */
export const PASSO_RELEVO = 2;

/** Teto do relevo, para o pincel não jogar o chão na estratosfera. */
export const LIMITE_RELEVO = 40;

export const relevoVazio = () => ({ passo: PASSO_RELEVO, pontos: {} });

const chaveNo = (i, k) => `${i},${k}`;

/** A altura de um NÓ da grade (não interpolada). */
export const alturaNo = (relevo, i, k) => {
  const v = relevo?.pontos?.[chaveNo(i, k)];
  return Number.isFinite(v) ? v : 0;
};

/**
 * A altura do terreno em qualquer ponto — **interpolação bilinear** entre os
 * quatro nós da célula.
 *
 * Bilinear e não "o nó mais perto": com o vizinho mais próximo o chão vira
 * degraus de 4 m, e uma peça posta no meio da célula pousa flutuando meio
 * metro acima do triângulo que a placa desenha ali. A placa é desenhada com os
 * cantos interpolados pela mesma conta, então quem pousa e quem desenha
 * concordam — é a lei do `alturaDoChao` da floresta, aplicada aqui.
 */
export function alturaDoRelevo(relevo, x, z) {
  if (!relevo?.pontos) return 0;
  const p = Number.isFinite(relevo.passo) && relevo.passo > 0 ? relevo.passo : PASSO_RELEVO;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;

  const fx = x / p, fz = z / p;
  const i = Math.floor(fx), k = Math.floor(fz);
  const tx = fx - i, tz = fz - k;

  const a = alturaNo(relevo, i, k);
  const b = alturaNo(relevo, i + 1, k);
  const c = alturaNo(relevo, i, k + 1);
  const d = alturaNo(relevo, i + 1, k + 1);
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
}

/**
 * Levanta (ou abaixa) o terreno em volta de um ponto. Devolve um relevo NOVO.
 *
 * A queda é suave (`cos`), e não um degrau: um pincel de borda dura deixa uma
 * parede vertical de 4 m a cada clique, e "montanha" vira "caixa".
 */
export function esculpir(relevo, x, z, dy, { raio = 6 } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(dy) || !dy) return relevo;
  const base = relevo?.pontos ? relevo : relevoVazio();
  const p = Number.isFinite(base.passo) && base.passo > 0 ? base.passo : PASSO_RELEVO;
  const r = Math.max(p * 0.5, Number.isFinite(raio) ? raio : 6);

  const pontos = { ...base.pontos };
  const alcance = Math.ceil(r / p);
  const ci = Math.round(x / p), ck = Math.round(z / p);

  for (let i = ci - alcance; i <= ci + alcance; i++) {
    for (let k = ck - alcance; k <= ck + alcance; k++) {
      const d = Math.hypot(i * p - x, k * p - z);
      if (d > r) continue;
      // cosseno: 1 no centro, 0 na borda — sem parede vertical na quina do pincel
      const peso = 0.5 + 0.5 * Math.cos((d / r) * Math.PI);
      const nova = alturaNo(base, i, k) + dy * peso;
      const presa = Math.max(-LIMITE_RELEVO, Math.min(LIMITE_RELEVO, nova));
      // nó que voltou a zero SAI do mapa: o relevo é esparso de propósito, e
      // guardar milhares de zeros incharia a cena a cada pincelada desfeita
      if (Math.abs(presa) < 1e-4) delete pontos[chaveNo(i, k)];
      else pontos[chaveNo(i, k)] = Math.round(presa * 1000) / 1000;
    }
  }
  return { passo: p, pontos };
}

/**
 * Achata a região de volta ao plano.
 *
 * `forca` (0..1) é o quanto do caminho se anda de uma vez: `1` achata de vez
 * (o clique), e uma fração achata aos poucos (o arrasto). Sem ela, passar o
 * pincel por cima apagaria o morro inteiro no primeiro pixel de movimento.
 */
export const aplainar = (relevo, x, z, opcoes = {}) => {
  const f = Number.isFinite(opcoes.forca) ? opcoes.forca : 1;
  const alvo = -alturaDoRelevo(relevo, x, z) * f;
  return esculpir(relevo, x, z, alvo, opcoes);
};

/**
 * Este pedaço de chão tem relevo? (Uma placa em terreno plano reaproveita a
 * geometria da biblioteca em vez de ganhar uma própria.)
 *
 * A margem de UM nó não é folga: `alturaDoRelevo` dentro da placa interpola com
 * os nós de fora dela, então uma placa cercada de morro é inclinada mesmo sem
 * nenhum nó seu levantado.
 */
export function relevoNaArea(relevo, x, z, lado) {
  if (!temRelevo(relevo)) return false;
  const p = Number.isFinite(relevo.passo) && relevo.passo > 0 ? relevo.passo : PASSO_RELEVO;
  const m = lado / 2;
  const i0 = Math.floor((x - m) / p) - 1, i1 = Math.ceil((x + m) / p) + 1;
  const k0 = Math.floor((z - m) / p) - 1, k1 = Math.ceil((z + m) / p) + 1;
  for (let i = i0; i <= i1; i++) {
    for (let k = k0; k <= k1; k++) if (alturaNo(relevo, i, k)) return true;
  }
  return false;
}

/** Este relevo tem alguma coisa? (Um plano não precisa de geometria própria.) */
export function temRelevo(relevo) {
  // `function` e não `const`: `paraGravar` a chama e está declarada ACIMA. Com
  // arrow, a chamada cairia na zona morta temporal — o mesmo defeito que já
  // custou uma tela inteira neste projeto (ver `cenapagina.js`).
  return !!relevo?.pontos && Object.keys(relevo.pontos).length > 0;
}

/**
 * Lê um relevo cru. **Descarta o nó torto em vez de convertê-lo**, pela mesma
 * razão da coordenada de um item: `Number(null)` é 0, uma altura legítima, e o
 * chão apareceria plano num ponto que deveria ser morro.
 */
export function lerRelevo(cru) {
  const fora = relevoVazio();
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return fora;
  const p = Number(cru.passo);
  fora.passo = Number.isFinite(p) && p > 0 ? p : PASSO_RELEVO;
  const pontos = cru.pontos;
  if (!pontos || typeof pontos !== 'object' || Array.isArray(pontos)) return fora;
  for (const [k, v] of Object.entries(pontos)) {
    if (!/^-?\d+,-?\d+$/.test(k)) continue;
    if (!Number.isFinite(v) || Math.abs(v) > LIMITE_RELEVO) continue;
    if (Math.abs(v) < 1e-4) continue;
    fora.pontos[k] = v;
  }
  return fora;
}

// ===========================================================================
// PLACA POR CIMA DE PLACA
// ===========================================================================

/**
 * As placas de terreno que a nova placa **cobre**, para serem apagadas.
 *
 * Duas placas de chão no mesmo lugar não são duas coisas: são a mesma coisa
 * duas vezes, e coplanares elas brigam pelo pixel (o *z-fighting*, aquele
 * chiado que muda conforme a câmera anda). O jeito antigo era selecionar a de
 * baixo e apagá-la à mão, peça por peça, montando um piso.
 *
 * Três cuidados, cada um por um caso ruim:
 *
 * - **Encostar não é cobrir.** Placas lado a lado dividem a borda e a
 *   sobreposição é zero; a margem estrita (`1e-6`) é o que impede o piso
 *   inteiro de se apagar sozinho enquanto se monta.
 * - **Só terreno apaga terreno.** `ladoDe` devolve `0` para árvore e pedra, e
 *   elas nunca entram — pôr chão não pode limpar a floresta em cima dele.
 * - **Altura diferente é degrau, não sobra.** Com relevo dá para empilhar chão
 *   em alturas diferentes de propósito (um mezanino, um patamar), e apagar o de
 *   baixo ali seria abrir um buraco no que se acabou de construir. Só conta
 *   quem está praticamente na mesma altura.
 *
 * O giro não entra na conta: as placas são quadradas e grudam na grade, então
 * a caixa alinhada aos eixos já é a placa. Uma placa girada 37° teria a caixa
 * maior que ela — e o erro seria apagar de mais, que o `Ctrl+Z` desfaz.
 */
export function terrenoCoberto(cena, novo, ladoDe, { ignorar = -1, folgaY = 0.5 } = {}) {
  const ladoN = (ladoDe(novo?.peca) || 0) * (novo?.escala || 1);
  if (!ladoN) return [];
  const fora = [];
  const itens = cena?.itens ?? [];
  for (let i = 0; i < itens.length; i++) {
    if (i === ignorar) continue;
    const it = itens[i];
    const lado = (ladoDe(it.peca) || 0) * (it.escala || 1);
    if (!lado) continue;
    if (Math.abs((it.y ?? 0) - (novo.y ?? 0)) > folgaY) continue;
    const meio = (ladoN + lado) / 2 - 1e-6;
    if (Math.abs(it.x - novo.x) < meio && Math.abs(it.z - novo.z) < meio) fora.push(i);
  }
  return fora;
}

// ===========================================================================
// DESFAZER e REFAZER
// ===========================================================================

/**
 * A pilha do `Ctrl+Z`/`Ctrl+Y`.
 *
 * Ela guarda CENAS INTEIRAS, não operações inversas. Um editor com "desfazer
 * por operação" precisa de um inverso escrito à mão para cada gesto novo, e o
 * que envelhece calado é justamente o gesto que ninguém lembrou de inverter —
 * o `Ctrl+Z` "funciona" e deixa a cena um pouco errada. Aqui a cena é imutável
 * (`acrescentar`, `mexer` e `remover` devolvem uma nova), então guardar o
 * estado anterior custa uma referência.
 *
 * Ela **não é dona da cena**: recebe e devolve. Quem manda continua sendo o
 * editor — duas cópias da cena viva divergiriam na primeira mexida.
 */
export function criarHistorico({ max = 60 } = {}) {
  const passado = [];
  const futuro = [];
  return {
    /** Chame ANTES de mudar a cena, com o estado que ainda vale. */
    guardar(cena) {
      passado.push(cena);
      // o teto é memória: cada entrada é a cena inteira, e uma tarde de edição
      // são milhares de gestos
      if (passado.length > max) passado.shift();
      // um gesto novo apaga o futuro: refazer depois dele republicaria um ramo
      // que não existe mais
      futuro.length = 0;
    },
    /** A cena anterior, ou `null` se não há o que desfazer. */
    desfazer(atual) {
      if (!passado.length) return null;
      futuro.push(atual);
      return passado.pop();
    },
    /** A cena de volta, ou `null` se não há o que refazer. */
    refazer(atual) {
      if (!futuro.length) return null;
      passado.push(atual);
      return futuro.pop();
    },
    pode: () => ({ desfazer: passado.length > 0, refazer: futuro.length > 0 }),
    limpar() { passado.length = 0; futuro.length = 0; },
  };
}

// ===========================================================================
// REGRAS por CLASSE e por PEÇA
//
// Duas perguntas que o catálogo sozinho não responde, e que são a MESMA
// pergunta com dois campos:
//
//   • `colide`  — esta peça barra quem anda? (capim e arbusto não deveriam)
//   • `terreno` — esta peça acompanha o relevo? (a estrada deveria; a árvore não)
//
// A resolução tem TRÊS níveis, do mais específico para o mais geral:
//
//   1. a peça      (`pecas['bg-01-01-11']`)  — a exceção dentro da classe
//   2. a classe    (`grupos['Árvores e plantas']`) — a decisão de atacado
//   3. o catálogo  — o que a peça declara de si mesma
//
// É o que o pedido descreve: *"definir que itens da classe X não têm colisão, e
// ali nessa classe decidir quais itens são"*. Sem o nível da peça, a classe
// seria uma escolha de tudo ou nada e a exceção obrigaria a tirar a peça dela.
//
// As regras moram na CENA, e não numa configuração global, por dois motivos:
// elas viajam junto com o arquivo (o Mundo lê a mesma decisão que o editor
// provou, sem uma segunda publicação que pode não acontecer) e cenas diferentes
// podem discordar de propósito — um mapa de corrida quer a grama sólida.
// ===========================================================================

/** Os campos que uma regra pode ter. Qualquer outro é descartado na leitura. */
export const CAMPOS_DE_REGRA = ['colide', 'terreno'];

export const regrasVazias = () => ({ grupos: {}, pecas: {} });

export const temRegras = (r) =>
  !!r && (Object.keys(r.grupos ?? {}).length > 0 || Object.keys(r.pecas ?? {}).length > 0);

/** Lê regras cruas. Entrada torta vira regra AUSENTE, nunca `false`. */
export function lerRegras(cru) {
  const fora = regrasVazias();
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return fora;
  for (const onde of ['grupos', 'pecas']) {
    const bloco = cru[onde];
    if (!bloco || typeof bloco !== 'object' || Array.isArray(bloco)) continue;
    for (const [chave, valor] of Object.entries(bloco)) {
      if (typeof chave !== 'string' || !chave || chave.length > 80) continue;
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) continue;
      const limpa = {};
      for (const campo of CAMPOS_DE_REGRA) {
        // SÓ booleano. `Number(null)` e `'false'` são verdadeiros em JS, e uma
        // conversão aqui transformaria lixo numa decisão explícita — o pior
        // resultado possível para um sistema cuja graça é a exceção declarada.
        if (typeof valor[campo] === 'boolean') limpa[campo] = valor[campo];
      }
      if (Object.keys(limpa).length) fora[onde][chave] = limpa;
    }
  }
  return fora;
}

/**
 * O valor de um campo para uma peça, ou `undefined` se ninguém decidiu.
 *
 * `info` é a entrada do catálogo (`{ id, grupo, ... }`) — é dela que sai a
 * classe, e é por isso que a resolução precisa do catálogo e não só do id.
 */
export function regraDe(regras, info, campo) {
  if (!info || !regras) return undefined;
  const daPeca = regras.pecas?.[info.id]?.[campo];
  if (typeof daPeca === 'boolean') return daPeca;
  const doGrupo = regras.grupos?.[info.grupo]?.[campo];
  if (typeof doGrupo === 'boolean') return doGrupo;
  return undefined;
}

/**
 * Esta peça barra quem anda?
 *
 * O padrão continua sendo a ALTURA (`alturaMin`): chão, decalque e capim são
 * atravessáveis sem ninguém precisar declarar nada. A regra é o que permite
 * dizer o contrário — nos dois sentidos, porque "este arbusto de 2 m não
 * barra" e "esta grama rasteira barra" são pedidos igualmente legítimos.
 */
export function colide(regras, info, dim, { alturaMin = 0.4 } = {}) {
  const decidido = regraDe(regras, info, 'colide');
  if (typeof decidido === 'boolean') return decidido;
  const alto = Array.isArray(dim) && Number.isFinite(dim[1]) ? dim[1] : 0;
  return alto >= alturaMin;
}

/**
 * Esta peça acompanha o relevo?
 *
 * O padrão é o `terreno` do catálogo — as placas de chão o declaram. A regra é
 * o que deixa marcar uma ESTRADA importada do Tag Force como chão: ela nasce
 * plana (o extrator não sabe o que é estrada e o que é telhado), e sem isto
 * ela ficava pairando reta por cima do morro.
 */
export function segueRelevo(regras, info) {
  const decidido = regraDe(regras, info, 'terreno');
  if (typeof decidido === 'boolean') return decidido;
  return !!info?.terreno;
}

/**
 * Muda uma regra. Devolve regras NOVAS (a cena é imutável).
 *
 * `valor === undefined` APAGA a regra em vez de gravar um `false`: são coisas
 * diferentes — "não decidi" volta ao padrão do catálogo, "decidi que não" fica.
 * Sem essa distinção não haveria como desfazer uma decisão de classe.
 */
export function porRegra(regras, onde, chave, campo, valor) {
  if ((onde !== 'grupos' && onde !== 'pecas') || !chave) return regras;
  if (!CAMPOS_DE_REGRA.includes(campo)) return regras;
  const base = regras?.grupos && regras?.pecas ? regras : regrasVazias();
  const bloco = { ...base[onde] };
  const atual = { ...(bloco[chave] ?? {}) };

  if (valor === undefined) delete atual[campo];
  else atual[campo] = !!valor;

  if (Object.keys(atual).length) bloco[chave] = atual;
  else delete bloco[chave];

  return { ...base, [onde]: bloco };
}

/**
 * A caixa que COLIDE — a geométrica, com o ajuste do item aplicado.
 *
 * Separada de `caixaDoItem` de propósito: aquela é a forma da peça e responde
 * "o que há embaixo de mim" (o pouso, o encaixe); esta é o colisor, que a
 * pessoa arrasta. Misturá-las faria apertar o colisor de uma pedra mudar a
 * altura em que as peças pousam em cima dela — um efeito colateral que ninguém
 * pediu e que só apareceria depois.
 *
 * `null` quando o item não colide.
 */
export function caixaDeColisao(item, dim) {
  if (item?.col === false) return null;
  const c = caixaDoItem(item, dim);
  const a = item?.col;
  if (!a) return c;

  const meio = [0, 1, 2].map((e) => (c.min[e] + c.max[e]) / 2);
  const lado = [0, 1, 2].map((e) => c.max[e] - c.min[e]);
  const esc = [a.ex, a.ey, a.ez];
  const desl = [a.dx, a.dy, a.dz];
  const e2 = Number.isFinite(item?.escala) ? item.escala : 1;

  const min = [], max = [];
  for (let i = 0; i < 3; i++) {
    // o deslocamento acompanha a ESCALA da peça: um colisor empurrado 1 m numa
    // peça que depois dobra de tamanho tem de continuar na mesma parte dela
    const centro = meio[i] + desl[i] * e2;
    const metade = (lado[i] * esc[i]) / 2;
    min.push(centro - metade);
    max.push(centro + metade);
  }
  return { min, max };
}
