/**
 * **TGMS** — a malha 3D do Tag Force (PSP). Decodificador de LEITURA.
 *
 * O `README.md` desta pasta dizia, com todas as letras, que *"não existe `.gmo`
 * nem pasta de modelo no ISO inteiro"*. A frase estava certa sobre o **duelo**
 * (que é 2D) e errada sobre o resto: aquela contagem só enxergava o primeiro
 * nível dos `.ehp`, e dentro deles há **7.628 entradas `.gz`** que só aparecem
 * depois de descompactar. Abertas, são **170 TGMS** — 27,5 MB de malha, entre
 * elas os mapas da Academia.
 *
 * ---
 *
 * ## O GABARITO, que é o que torna isto confiável
 *
 * O header traz uma **caixa envolvente** em seis `float32`, e ela é o `min/max`
 * EXATO dos vértices. Então cada arquivo carrega a própria resposta: decodifica,
 * tira o seu `min/max`, compara. Não é "parece certo" — ou fecha nos seis
 * números, ou está errado.
 *
 * Foi o gabarito que achou o campo da posição: o primeiro teste, *"os vértices
 * caem DENTRO da caixa?"*, passava em **todos** os deslocamentos — qualquer
 * `int16` dividido por 32767 cai dentro de qualquer caixa. O teste que vale é a
 * caixa ficar **JUSTA**, e aí o deslocamento certo ganhou com 0,003% de
 * divergência entre eixos contra 32,8% do segundo colocado.
 *
 * ## O formato
 *
 * ```
 * 0x04  fim do header (0x60)
 * 0x08  inicio do bloco de vertices      0x0c  fim
 * 0x10  tabela de textura                0x14  tabela de objeto
 * 0x20  matriz 4x4                       0x24  blob com os nomes ".tga"
 * 0x28  nº de materiais                  0x34  nº de texturas
 * 0x44  caixa envolvente (6 float32)
 * 0x60  chamadas de desenho, 12 B: (tipo, contagem, offset)
 *       tipo 3 = TRIANGLES, 4 = TRIANGLE_STRIP (numeração do GE do PSP)
 * ```
 *
 * O vértice segue a **ordem fixa do GE**: peso, textura, cor, normal, posição —
 * a posição é sempre a ÚLTIMA. Nos mapas ele tem 24 B:
 *
 * | +0 | +8 | +12 | +18 |
 * |---|---|---|---|
 * | UV, 2×`float32` | cor RGBA | normal, 3×`int16` | posição, 3×`int16` |
 *
 * `int16 ÷ 32767`, depois pela matriz de `0x20` (escala + translação) — é a
 * normalização que o PSP usa para ganhar precisão em 16 bits.
 *
 * ## A cadeia de material, e por que ela fecha
 *
 * ```
 * objeto  (0x14)  -> (quantas chamadas, primeira)
 * material(0x0c)  -> objeto em +158, textura em +28 (-1 = sem textura)
 *                    +156 == 1 é o material valendo; 0 é o descartado
 * textura (0x10)  -> offset do nome no blob de 0x24
 * o nome é "x.tga", e a arte é o "x.gim" do MESMO .ehp
 * ```
 *
 * A prova de que a leitura está certa não é o desenho: é que as faixas de
 * objeto formam uma **partição exata** das chamadas — a soma das contagens dá o
 * total, sem repetir nenhuma e sem deixar nenhuma fora. Uma leitura torta
 * dessas faixas dá sobreposição ou buraco, e o `lerTgms` recusa.
 *
 * ## O que este módulo NÃO faz, e por quê
 *
 * **Personagem não abre.** Os 61 `cutin-chara-*.tms` são malhas *skinned*: têm
 * 78 matrizes 4×4 numa seção própria (o esqueleto), o stride varia POR CHAMADA
 * (12, 14, 16, 18, 20, 22 B) e — o que mata — os vértices não estão em espaço
 * de modelo. A caixa erra 27,17 unidades em qualquer combinação, porque só o
 * esqueleto aplicado põe cada parte no lugar. Sem espaço de modelo não há
 * gabarito, e sem gabarito não se decodifica com segurança. Fica registrado
 * para quem for tentar: o caminho é achar os pesos e a matriz de cada osso.
 *
 * > **Os assets são da Konami.** Este módulo LÊ; ele não escreve nada dentro do
 * > repositório e nada do que ele produz entra num Release. Ver o `README.md`
 * > desta pasta.
 */
import zlib from 'node:zlib';
import { parseEhp } from './ehp.mjs';
import { decodeGim, png } from './gim.mjs';

/** Bytes do vértice nos mapas. Personagem varia por chamada — ver o cabeçalho. */
export const STRIDE_MAPA = 24;

/** Numeração de primitiva do GE do PSP. Só estas duas aparecem nos mapas. */
export const TRIANGULOS = 3;
export const TIRA = 4;

const u32 = (b, o) => b.readUInt32LE(o);

/**
 * Lê um TGMS. Devolve `{ ok: false, motivo }` quando o arquivo não fecha com o
 * próprio gabarito — **nunca** uma malha "mais ou menos": uma malha torta
 * desenha alguma coisa na tela, e alguma coisa na tela é indistinguível de
 * acerto.
 *
 * `arte(nomeGim)` é opcional e devolve o buffer do `.gim` daquele nome; sem
 * ela, os grupos vêm sem textura (útil para conferir só a geometria).
 */
export function lerTgms(b, { arte = null, tolerancia = 0.01 } = {}) {
  if (b.length < 0x60 || b.toString('latin1', 0, 4) !== 'TGMS') return { ok: false, motivo: 'nao e TGMS' };

  const INI = u32(b, 0x08), FIM = u32(b, 0x0c);
  const TEX = u32(b, 0x10), OBJ = u32(b, 0x14), MAT = u32(b, 0x20), NOM = u32(b, 0x24);
  const nMat = u32(b, 0x28), nTex = u32(b, 0x34);
  if (!(0x60 < INI && INI < FIM && FIM <= b.length && MAT + 64 <= b.length && NOM <= b.length))
    return { ok: false, motivo: 'offsets do header fora do arquivo' };

  const caixa = {
    min: [0x44, 0x48, 0x4c].map((o) => b.readFloatLE(o)),
    max: [0x50, 0x54, 0x58].map((o) => b.readFloatLE(o)),
  };
  const m = []; for (let i = 0; i < 16; i++) m.push(b.readFloatLE(MAT + i * 4));
  const esc = [m[0], m[5], m[10]], tra = [m[12], m[13], m[14]];

  // --- chamadas de desenho ---
  const chamadas = [];
  for (let o = 0x60; o + 12 <= INI; o += 12) {
    const c = { tipo: u32(b, o), n: u32(b, o + 4), off: u32(b, o + 8) };
    chamadas.push(c);
  }
  const validas = chamadas.filter((c) => c.n > 0 && c.off >= INI && c.off < FIM
    && c.off + c.n * STRIDE_MAPA <= b.length);
  if (!validas.length) return { ok: false, motivo: 'nenhuma chamada de desenho valida' };

  // --- objetos: (quantas chamadas, primeira) ---
  const objetos = [];
  for (let o = OBJ + 4; o + 24 <= MAT; o += 24)
    objetos.push({ n: b.readUInt16LE(o + 16), primeira: b.readUInt16LE(o + 18) });

  // a partição EXATA é a prova de que a tabela foi lida certo
  const vistas = new Set();
  for (const ob of objetos) {
    for (let k = 0; k < ob.n; k++) {
      const i = ob.primeira + k;
      if (i >= chamadas.length) return { ok: false, motivo: 'objeto aponta chamada inexistente' };
      if (vistas.has(i)) return { ok: false, motivo: 'duas faixas de objeto pegam a mesma chamada' };
      vistas.add(i);
    }
  }
  if (vistas.size !== chamadas.length)
    return { ok: false, motivo: `faixas de objeto cobrem ${vistas.size} de ${chamadas.length} chamadas` };

  // --- material -> objeto, material -> textura ---
  const texDoObjeto = new Map();
  for (let i = 0; i < nMat; i++) {
    const o = u32(b, 0x0c) + i * 164;
    if (o + 164 > b.length) break;
    if (b.readUInt16LE(o + 156) === 1) texDoObjeto.set(b.readUInt16LE(o + 158), b.readInt32LE(o + 28));
  }

  // --- texturas -> nome ---
  const blob = b.subarray(NOM);
  const nomeEm = (o) => { let f = o; while (f < blob.length && blob[f]) f++; return blob.toString('latin1', o, f); };
  const texturas = [];
  for (let i = 0; i < nTex; i++) {
    const o = TEX + i * 40;
    if (o + 40 > b.length) break;
    const nome = nomeEm(u32(b, o));
    let img = null;
    if (arte) {
      const gim = arte(nome.replace(/\.tga$/i, '.gim'));
      if (gim) { try { img = decodeGim(gim); } catch { img = null; } }
    }
    texturas.push({ nome, img });
  }

  // --- chamada -> textura ---
  const texDaChamada = new Array(chamadas.length).fill(-1);
  objetos.forEach((ob, j) => {
    const t = texDoObjeto.has(j) ? texDoObjeto.get(j) : -1;
    for (let k = 0; k < ob.n; k++) texDaChamada[ob.primeira + k] = t;
  });

  // --- vértices ---
  const lerV = (p) => ({
    uv: [b.readFloatLE(p), b.readFloatLE(p + 4)],
    nor: [0, 1, 2].map((e) => b.readInt16LE(p + 12 + e * 2) / 32767),
    pos: [0, 1, 2].map((e) => (b.readInt16LE(p + 18 + e * 2) / 32767) * esc[e] + tra[e]),
  });

  const porTextura = new Map();
  // as mesmas faces, mas agrupadas por OBJETO — é daqui que sai a biblioteca de
  // peças do editor de cena. Um mapa não é um bloco só: `bg_01_01` tem 23
  // objetos, com mediana de 32 triângulos (uma caixa, a escada, as vigas).
  const porObjeto = new Map();
  const objetoDaChamada = new Array(chamadas.length).fill(-1);
  objetos.forEach((ob, j) => { for (let k = 0; k < ob.n; k++) objetoDaChamada[ob.primeira + k] = j; });

  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let triangulos = 0;
  for (const c of validas) {
    const vs = [];
    for (let i = 0; i < c.n; i++) {
      const v = lerV(c.off + i * STRIDE_MAPA);
      vs.push(v);
      for (let e = 0; e < 3; e++) { if (v.pos[e] < mn[e]) mn[e] = v.pos[e]; if (v.pos[e] > mx[e]) mx[e] = v.pos[e]; }
    }
    const idx = chamadas.indexOf(c);
    const t = texDaChamada[idx];
    if (!porTextura.has(t)) porTextura.set(t, []);
    const obj = objetoDaChamada[idx];
    if (obj >= 0) {
      if (!porObjeto.has(obj)) porObjeto.set(obj, { textura: t, faces: [] });
    }
    const g = porTextura.get(t);
    const gObj = obj >= 0 ? porObjeto.get(obj).faces : null;
    if (c.tipo === TRIANGULOS) {
      for (let i = 0; i + 2 < vs.length; i += 3) {
        const f = [vs[i], vs[i + 1], vs[i + 2]];
        g.push(f); gObj?.push(f); triangulos++;
      }
    } else if (c.tipo === TIRA) {
      // a tira alterna a ordem a cada passo, senão metade dos triângulos nasce
      // virada para dentro e some no back-face culling — sem erro nenhum
      for (let i = 0; i + 2 < vs.length; i++) {
        const f = i % 2 ? [vs[i + 1], vs[i], vs[i + 2]] : [vs[i], vs[i + 1], vs[i + 2]];
        g.push(f); gObj?.push(f); triangulos++;
      }
    }
  }

  const erro = Math.max(...[0, 1, 2].flatMap((e) =>
    [Math.abs(mn[e] - caixa.min[e]), Math.abs(mx[e] - caixa.max[e])]));
  if (!(erro <= tolerancia))
    return { ok: false, motivo: `a caixa nao fecha (erro ${erro.toFixed(3)})`, erro };

  const grupos = [];
  for (const [ti, tris] of porTextura) {
    const pos = [], nor = [], uv = [];
    for (const t of tris) for (const v of t) {
      pos.push(...v.pos); nor.push(...v.nor);
      // o V vem invertido do PSP; quem consome é o three, que conta de baixo
      uv.push(v.uv[0], 1 - v.uv[1]);
    }
    const tex = ti >= 0 ? texturas[ti] : null;
    grupos.push({ textura: tex ? tex.nome : null, imagem: tex?.img ?? null, pos, nor, uv });
  }

  // As PEÇAS: cada objeto vira uma malha própria, **recentrada na base**. O
  // recentro é o que a torna colocável — a peça vem com a coordenada do mapa de
  // origem, e sem tirá-la a peça nasceria a vinte metros de onde foi solta.
  // Origem no centro em X/Z e no PISO em Y: quem posiciona pensa em "onde no
  // chão", não em "onde fica o meio do objeto".
  const pecas = [];
  for (const [oi, dados] of porObjeto) {
    if (!dados.faces.length) continue;
    const pmn = [Infinity, Infinity, Infinity], pmx = [-Infinity, -Infinity, -Infinity];
    for (const f of dados.faces) for (const v of f) for (let e = 0; e < 3; e++) {
      if (v.pos[e] < pmn[e]) pmn[e] = v.pos[e];
      if (v.pos[e] > pmx[e]) pmx[e] = v.pos[e];
    }
    const orig = [(pmn[0] + pmx[0]) / 2, pmn[1], (pmn[2] + pmx[2]) / 2];
    const pos = [], nor = [], uv = [];
    for (const f of dados.faces) for (const v of f) {
      pos.push(v.pos[0] - orig[0], v.pos[1] - orig[1], v.pos[2] - orig[2]);
      nor.push(...v.nor);
      uv.push(v.uv[0], 1 - v.uv[1]);
    }
    const tex = dados.textura >= 0 ? texturas[dados.textura] : null;
    pecas.push({
      objeto: oi,
      textura: tex ? tex.nome : null,
      imagem: tex?.img ?? null,
      dim: [0, 1, 2].map((e) => pmx[e] - pmn[e]),
      triangulos: dados.faces.length,
      pos, nor, uv,
    });
  }

  return { ok: true, caixa, grupos, pecas, triangulos, erro,
           texturas: texturas.length, objetos: objetos.length };
}

/**
 * O "filtro para deixar leve": **solda os vértices repetidos** e vira malha
 * indexada, jogando fora o triângulo degenerado (área zero).
 *
 * Não é decimação, e a diferença importa. Medido: das 152 peças, **duas**
 * passam de 2.000 triângulos — o material é de PSP, já nasceu low-poly, e
 * simplificar malha aqui seria resolver um problema que não existe (e custaria
 * vendorizar o `SimplifyModifier`). O desperdício real é outro: a leitura
 * expande TRIANGLE_STRIP em triângulos soltos, então cada vértice interno é
 * repetido de três a seis vezes. Soldar não tira um triângulo da tela — tira
 * bytes do arquivo e vértices da GPU.
 *
 * O triângulo degenerado é o que a tira produz de propósito para "virar a
 * esquina": ele não desenha nada e ocupa lugar em tudo.
 */
export function soldar({ pos, nor, uv }, { casas = 3 } = {}) {
  const k = 10 ** casas;
  const q = (v) => Math.round(v * k);
  const mapa = new Map();
  const P = [], N = [], U = [], idx = [];

  const somaVertice = (i) => {
    const chave = `${q(pos[i * 3])},${q(pos[i * 3 + 1])},${q(pos[i * 3 + 2])}|`
      + `${q(nor[i * 3])},${q(nor[i * 3 + 1])},${q(nor[i * 3 + 2])}|`
      + `${q(uv[i * 2])},${q(uv[i * 2 + 1])}`;
    const achado = mapa.get(chave);
    if (achado !== undefined) return achado;
    const novo = P.length / 3;
    P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    N.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
    U.push(uv[i * 2], uv[i * 2 + 1]);
    mapa.set(chave, novo);
    return novo;
  };

  let degenerados = 0;
  for (let t = 0; t * 3 < pos.length / 3; t++) {
    const a = somaVertice(t * 3), b = somaVertice(t * 3 + 1), c = somaVertice(t * 3 + 2);
    // depois da solda, um triângulo cujos três cantos viraram o mesmo índice
    // não tem área — é o que a tira usa para virar a esquina
    if (a === b || b === c || a === c) { degenerados++; continue; }
    idx.push(a, b, c);
  }
  return {
    pos: P, nor: N, uv: U, idx,
    antes: pos.length / 3, depois: P.length / 3, degenerados,
  };
}

/** Abre um `.ehp` e devolve `{ tms: [{nome, buf}], arte(nome) }`. */
export function abrirPacote(buf) {
  const pk = parseEhp(buf);
  const cru = (e) => (e.nome.endsWith('.gz') ? zlib.gunzipSync(e.dado) : e.dado);
  const tms = pk.entradas
    .filter((e) => /\.tms(\.gz)?$/i.test(e.nome))
    .map((e) => ({ nome: e.nome.replace(/\.gz$/, ''), buf: cru(e) }));
  const arte = (nome) => {
    const e = pk.entradas.find((x) => x.nome === nome || x.nome === nome + '.gz');
    return e ? cru(e) : null;
  };
  return { tms, arte };
}

/**
 * Casas decimais de cada atributo no pacote.
 *
 * **Não é "arredondar para economizar": é parar de imprimir dígito que não
 * existe.** A posição sai de um `int16` sobre uma caixa de ~23 unidades, então
 * a resolução da FONTE é `23/65535 ≈ 0,00036` — e `JSON.stringify` estava
 * escrevendo `0.000019074068422497703`, vinte e três caracteres de ruído de
 * ponto flutuante para um número que tem três casas de informação.
 *
 * O UV leva uma casa a mais porque ele não vem de 16 bits: é `float32` no
 * arquivo, e a textura tem 1024 pixels — abaixo de `1/1024` a diferença começa
 * a aparecer como costura entre dois triângulos vizinhos.
 */
export const CASAS = { pos: 3, nor: 3, uv: 4 };

const arredondar = (v, casas) => {
  const k = 10 ** casas;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;      // "-0" vira "-0" no JSON e não serve para nada
};

/**
 * O pacote que o front consome: grupos com `pos/nor/uv` e a textura já em PNG,
 * como `data:` URL. Vai para **`web/cenarios/`**, e portanto VIAJA no
 * `game.zip` como qualquer coisa de `web/`.
 *
 * > Isso é uma decisão, e ela mudou: enquanto o cenário era experimento, o
 * > destino era `store/` (que o Release não leva). A partir do momento em que
 * > ele é o ambiente que se quer publicar, ficar fora do pacote significaria um
 * > jogo que só funciona nesta máquina — e um cenário que existe aqui e não lá
 * > é a pior forma de não existir.
 */
export function paraOMundo(lido, { nome }) {
  if (!lido.ok) throw new Error('malha nao fecha: ' + lido.motivo);
  const enxugar = (arr, casas) => arr.map((v) => arredondar(v, casas));
  return {
    fonte: nome,
    caixa: lido.caixa,
    triangulos: lido.triangulos,
    grupos: lido.grupos.map((g) => ({
      textura: g.textura,
      png: g.imagem ? 'data:image/png;base64,' + png(g.imagem.w, g.imagem.h, g.imagem.rgba).toString('base64') : null,
      pos: enxugar(g.pos, CASAS.pos),
      nor: enxugar(g.nor, CASAS.nor),
      uv: enxugar(g.uv, CASAS.uv),
    })),
  };
}
