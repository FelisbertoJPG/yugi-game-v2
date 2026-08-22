/**
 * **O enquadramento de uma foto num círculo** — a conta por trás do recorte
 * estilo foto de perfil: arrastar para posicionar, zoom para aproximar.
 *
 * Sem DOM e sem canvas de propósito, como `trilhaordem.js` e `drops.js`, porque
 * é ela que erra **calado**. Um limite frouxo deixa a imagem descolar do
 * círculo e o ícone sai com uma **faixa vazia** na borda; uma escala mínima
 * errada deixa a foto menor que o quadro e o fundo aparece. Nenhum dos dois dá
 * erro — o admin salva, publica, e o ícone só fica estranho.
 *
 * O modelo é simples e vale a pena escrever: existe um **quadro** quadrado de
 * lado `lado` (o círculo é só a máscara por cima dele), e a imagem é desenhada
 * dentro com uma `escala` e um deslocamento `{x, y}` medido em pixels do
 * quadro, do canto superior esquerdo da imagem até o canto do quadro.
 *
 *     x = 0    → a borda esquerda da imagem encosta na esquerda do quadro
 *     x < 0    → a imagem está deslocada para a esquerda (o normal)
 *     x = lado − largura·escala → a borda direita encosta na direita
 */

/**
 * A MENOR escala em que a imagem ainda cobre o quadro inteiro.
 *
 * É o `object-fit: cover` feito à mão: a maior das duas razões, e não a menor —
 * a menor caberia dentro do quadro deixando sobra, que é exatamente a faixa
 * vazia que não se quer.
 */
export function escalaMinima(largura, altura, lado) {
  const w = Number(largura), h = Number(altura), l = Number(lado);
  if (!(w > 0) || !(h > 0) || !(l > 0)) return 1;
  return Math.max(l / w, l / h);
}

/**
 * Prende o deslocamento para a imagem nunca descolar do quadro.
 *
 * Quando a imagem escalada é MAIOR que o quadro, o deslocamento anda entre
 * `lado − tamanhoEscalado` (borda final encostada) e `0` (borda inicial
 * encostada). Quando é do tamanho exato, só resta o zero.
 *
 * O caso de ela ser MENOR não deveria existir — a escala mínima impede —, mas
 * se acontecer (uma escala forçada de fora), centralizar é a única resposta que
 * não deixa a sobra num canto só.
 */
export function limitarOffset(offset, largura, altura, escala, lado) {
  const prender = (v, tamanho) => {
    const total = tamanho * escala;
    if (!(total > 0)) return 0;
    if (total <= lado) return (lado - total) / 2;   // menor que o quadro: centraliza
    return Math.min(0, Math.max(lado - total, Number(v) || 0));
  };
  return {
    x: prender(offset?.x, Number(largura) || 0),
    y: prender(offset?.y, Number(altura) || 0),
  };
}

/**
 * A região da imagem ORIGINAL que aparece no quadro — o `sx, sy, sw, sh` de um
 * `drawImage` de nove argumentos.
 *
 * É a conta inversa do desenho: o que está em `x` no quadro está em `-x/escala`
 * na imagem. Dividir na hora errada (usar o deslocamento sem desfazer a escala)
 * dá um recorte que parece certo em zoom 1 e escorrega em qualquer outro — o
 * tipo de erro que passa no olho de quem testou uma vez.
 */
export function areaDeOrigem(offset, escala, lado) {
  const e = Number(escala) || 1;
  // O `+ 0` mata o zero NEGATIVO que `-(0)/e` produz. O canvas não se importa,
  // mas `-0` sobrevive a um JSON.stringify e aparece escrito assim em qualquer
  // log ou teste — um valor que parece errado sem estar.
  return {
    sx: -(Number(offset?.x) || 0) / e + 0,
    sy: -(Number(offset?.y) || 0) / e + 0,
    sw: lado / e,
    sh: lado / e,
  };
}

/**
 * O zoom, preso entre o mínimo (cobrir) e um teto.
 *
 * O teto existe para o admin não ampliar a foto a ponto de recortar oito
 * pixels e publicar um borrão — a tela mostra o resultado em 44px e 26px, onde
 * um borrão ainda parece aceitável.
 */
export const TETO_DE_ZOOM = 8;

export function prenderEscala(escala, minima) {
  const min = Number(minima) > 0 ? Number(minima) : 0.01;
  const e = Number(escala);
  if (!Number.isFinite(e)) return min;
  return Math.min(Math.max(e, min), min * TETO_DE_ZOOM);
}

/**
 * Zoom mantendo FIXO o ponto que está no centro do quadro.
 *
 * Sem isto o zoom "puxa" a imagem para o canto superior esquerdo: a escala
 * cresce a partir da origem, e o que estava no meio escapa. Quem está tentando
 * centralizar um rosto vê a foto fugir a cada rolada da roda, e a única saída é
 * arrastar de novo depois de cada zoom.
 */
export function zoomNoCentro(offset, escalaAtual, escalaNova, lado) {
  const meio = lado / 2;
  const razao = escalaNova / escalaAtual;
  return {
    x: meio - (meio - (Number(offset?.x) || 0)) * razao,
    y: meio - (meio - (Number(offset?.y) || 0)) * razao,
  };
}

/**
 * O enquadramento inicial: a menor escala que cobre, centralizado.
 *
 * É o que a pessoa vê ao escolher o arquivo, e por isso não pode depender de
 * nada além das dimensões — uma foto vertical e uma horizontal abrem as duas
 * com o meio à mostra.
 */
export function enquadrarInicial(largura, altura, lado) {
  const escala = escalaMinima(largura, altura, lado);
  const offset = limitarOffset(
    { x: (lado - largura * escala) / 2, y: (lado - altura * escala) / 2 },
    largura, altura, escala, lado,
  );
  return { escala, ...offset };
}
