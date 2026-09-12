/**
 * **PERSONAGENS** — quem é o seu corpo no Mundo.
 *
 * O vestiário (`aparencia.js`) responde *"o que eu visto"*; isto responde
 * *"quem eu sou"*. São perguntas diferentes e por isso não moram no mesmo
 * lugar — mas a ESCOLHA mora no mesmo campo (`perfis.aparencia`), porque é a
 * mesma coluna, o mesmo gatilho e a mesma `rpc/aparencias` que os outros já
 * leem para desenhar você. Uma segunda coluna seria uma segunda verdade sobre
 * a mesma pessoa.
 *
 * ---
 *
 * ## Por que os personagens são TEXTURA, e não malha
 *
 * O pacote *Blocky Characters* do Kenney (CC0), que já está em
 * `web/modelos/kenney/`, tem dezoito personagens com **geometria idêntica**:
 * eles diferem só pela textura. Isso é a feature inteira — um `.glb` de 113 KB
 * serve a todos, e cada personagem custa **zero byte** no `game.zip`, porque a
 * variante é PINTADA no navegador a partir da textura que já viaja.
 *
 * É a mesma regra do resto do projeto (*"a arte é gerada em código"*), aplicada
 * a um asset que veio pronto.
 *
 * ## A tinta: rotação de MATIZ, com piso de CROMA
 *
 * A textura é arte chapada: camisa laranja, calça verde, pele bege, cabelo
 * cinza. Rodar o matiz de tudo trocaria também a pele e o cabelo, e todo
 * personagem sairia com pele colorida. Então só roda o que tem croma acima do
 * piso — pele e cabelo, que são pálidos ou acinzentados, ficam onde estão.
 *
 * > **É croma (max−min), e NÃO a saturação do HSL.** Medido nesta textura: a
 * > pele tem saturação HSL de **0,78** — tão "saturada" quanto a camisa —,
 * > porque o `s` do HSL é relativo à distância de 0,5 de luminosidade, e pele
 * > clara mora perto do topo. Por croma a conta se separa sozinha: pele
 * > **0,31**, camisa **0,56**, calça **0,45**, cabelo **0,05**. Um piso de
 * > saturação despintaria a pele de todo personagem, e nada acusaria — foi o
 * > teste que pegou, antes de existir tela.
 *
 * O ângulo não é escrito à mão: mede-se o **matiz dominante** da textura (o da
 * camisa, que ocupa mais pixels coloridos) e roda-se o quanto falta para chegar
 * ao matiz que aquele personagem deve ter. Escrever "gire 137°" envelheceria
 * calado no dia em que a textura mudasse de cor — a peça continuaria girando,
 * só que a partir de outro lugar.
 *
 * ## O que erra CALADO aqui
 *
 * - **id desconhecido** (cliente velho contra um catálogo novo) não pode virar
 *   `undefined` no meio da montagem do boneco: cai no padrão, que é a textura
 *   como veio do arquivo.
 * - **piso de saturação frouxo** despinta a pele; **apertado** demais não
 *   pinta nada, e todo personagem fica igual — os dois dão uma tela plausível.
 * - **matiz de um pixel cinza** é indefinido (dividir por zero na conversão), e
 *   um NaN em matiz vira preto na tela sem um erro sequer.
 */

/** O personagem de fábrica: a textura como veio no arquivo, sem repintar. */
export const PERSONAGEM_PADRAO = 'padrao';

/**
 * Abaixo disto o pixel é neutro e não é repintado: pele, cabelo, sombra.
 * Entre a pele (0,31) e a calça (0,45), mais perto da pele — o erro barato é
 * deixar uma peça sem pintar; o caro é despintar o rosto.
 */
export const CROMA_MINIMA = 0.40;

/** Croma de um pixel: 0 (cinza) a 1 (cor pura). */
export const cromaDe = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

/** A forma de um id de personagem. Slug, como o resto do projeto. */
const FORMA_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const ehIdValido = (id) => typeof id === 'string' && FORMA_ID.test(id);

/**
 * Sempre devolve um id usável. Desconhecido cai no padrão — nunca `undefined`,
 * que viraria uma textura ausente no meio da montagem.
 */
export function normalizarPersonagem(id) {
  return ehIdValido(id) ? id : PERSONAGEM_PADRAO;
}

// --------------------------------------------------------------- cor

/** `#rrggbb` → `[r,g,b]` 0..255, ou `null` se não for cor. */
export function hexParaRgb(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGB 0..255 → `{ h: 0..360, s: 0..1, l: 0..1 }`. Cinza devolve `h: 0`. */
export function rgbParaHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };          // cinza: matiz indefinido, nunca NaN
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

/** `{h,s,l}` → RGB 0..255. */
export function hslParaRgb(h, s, l) {
  const H = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    let T = t; if (T < 0) T += 1; if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  return [canal(H + 1 / 3), canal(H), canal(H - 1 / 3)].map((v) => Math.round(v * 255));
}

/**
 * O matiz que mais aparece entre os pixels **cromáticos** — na textura do
 * Kenney, o da camisa. É daqui que sai o ponto de partida da rotação, em vez de
 * um ângulo escrito à mão que envelheceria calado se a arte mudasse.
 *
 * Devolve `null` quando não há pixel cromático nenhum: uma textura em tons de
 * cinza não tem de onde girar, e fingir um ângulo pintaria tudo de uma cor só.
 */
export function matizDominante(rgba, { cromaMin = CROMA_MINIMA, faixas = 36 } = {}) {
  const conta = new Array(faixas).fill(0);
  let cromaticos = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 8) continue;                                  // transparente
    if (cromaDe(rgba[i], rgba[i + 1], rgba[i + 2]) < cromaMin) continue;
    const { h } = rgbParaHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    conta[Math.min(faixas - 1, Math.floor((h / 360) * faixas))]++;
    cromaticos++;
  }
  if (!cromaticos) return null;
  let melhor = 0;
  for (let i = 1; i < faixas; i++) if (conta[i] > conta[melhor]) melhor = i;
  return ((melhor + 0.5) / faixas) * 360;
}

/**
 * Roda o matiz dos pixels cromáticos em `giro` graus. **Muda o array no
 * lugar** e o devolve — é um `ImageData.data` de textura, e copiar 1 MB por
 * personagem para nada é o tipo de desperdício que não aparece em teste.
 */
export function girarMatiz(rgba, giro, { cromaMin = CROMA_MINIMA } = {}) {
  if (!giro) return rgba;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 8) continue;
    if (cromaDe(rgba[i], rgba[i + 1], rgba[i + 2]) < cromaMin) continue;
    const { h, s, l } = rgbParaHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    const [r, g, b] = hslParaRgb(h + giro, s, l);
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
  }
  return rgba;
}

/**
 * Quanto girar para levar o matiz dominante da textura ao matiz `alvo`.
 * Devolve `0` quando não dá para medir — a textura original é uma resposta
 * honesta; uma rotação inventada não é.
 */
export function giroPara(rgba, alvoHex, opcoes = {}) {
  const de = matizDominante(rgba, opcoes);
  const rgb = hexParaRgb(alvoHex);
  if (de === null || !rgb) return 0;
  const { h: para } = rgbParaHsl(rgb[0], rgb[1], rgb[2]);
  if (cromaDe(rgb[0], rgb[1], rgb[2]) < 0.05) return 0;   // alvo cinza: não pinta nada
  return para - de;
}

/**
 * O catálogo. Sai de uma LISTA DE GENTE que já existe no jogo (os adversários)
 * mais a função de cor que já os pinta nos dois mundos — e não de uma terceira
 * lista escrita à mão, que envelheceria sozinha a cada adversário novo.
 *
 * As duas dependências entram por parâmetro para este módulo continuar puro:
 * `npcs.js` faz leitura de rede no boot, e um teste não pode depender disso.
 */
export function catalogoDe(elenco, cores) {
  const saida = [{ id: PERSONAGEM_PADRAO, nome: 'Padrão', cor: null }];
  const vistos = new Set([PERSONAGEM_PADRAO]);
  for (const p of elenco ?? []) {
    const id = normalizarPersonagem(String(p?.id ?? '').toLowerCase());
    if (id === PERSONAGEM_PADRAO || vistos.has(id)) continue;
    const c = cores?.(p.id);
    if (!c?.c) continue;                        // sem camisa não há o que pintar
    vistos.add(id);
    saida.push({ id, nome: p.name || p.nome || p.id, cor: c.c });
  }
  return saida;
}

/** O personagem do catálogo, ou o padrão. Nunca `undefined`. */
export function acharPersonagem(catalogo, id) {
  const alvo = normalizarPersonagem(id);
  return (catalogo ?? []).find((p) => p.id === alvo)
      ?? (catalogo ?? []).find((p) => p.id === PERSONAGEM_PADRAO)
      ?? { id: PERSONAGEM_PADRAO, nome: 'Padrão', cor: null };
}
