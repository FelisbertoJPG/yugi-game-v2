/**
 * **MALHA** — subdividir e deformar uma geometria qualquer.
 *
 * Existe por causa de um caso concreto: as peças de CHÃO do Tag Force (as
 * estradas, os pátios) são placas de **3 a 8 triângulos**. Marcar uma delas
 * como terreno e deslocar os vértices pelo relevo não produz fenda nenhuma —
 * com quatro cantos, a superfície entre eles é um plano, e o buraco que se
 * cavou no meio dela simplesmente não existe na malha. É o MESMO defeito que
 * matou a primeira versão do relevo (ver `pecasbase.js`), agora vindo de outro
 * lado: lá era a conta, aqui é a falta de vértice onde pôr o resultado.
 *
 * `geoPlaca` resolve isso nascendo subdividida, porque ela é gerada em código.
 * Uma peça importada chega pronta, e a única saída é **acrescentar vértices**.
 *
 * ---
 *
 * ## O que erra CALADO aqui
 *
 * - **subdividir é exponencial.** Cada passe dobra a contagem de triângulos, e
 *   uma peça de 3 mil triângulos marcada como terreno viraria centenas de
 *   milhares sem nada avisar — o editor engasgaria e a culpa cairia no relevo.
 *   Por isso há TETO, e ele é respeitado antes de cada divisão, não depois.
 * - **atributo esquecido vira peça sem textura.** Ao criar um vértice no meio
 *   de uma aresta, todo atributo que existir (uv, cor, normal) tem de ser
 *   interpolado junto. Esquecer o `uv` deixa a estrada com a textura embolada,
 *   o que se parece com um erro do extrator e não com um erro daqui.
 * - **índice.** Uma geometria indexada e uma não-indexada têm de dar o mesmo
 *   resultado; trabalhar sempre em não-indexado é mais caro em memória e é a
 *   única forma que não depende de quem gerou a malha.
 */
import * as THREE from '../vendor/three/three.module.min.js';

/** Teto de triângulos de uma peça subdividida. Ver o cabeçalho. */
export const TETO_TRIANGULOS = 24000;

/**
 * Divide os triângulos até nenhuma aresta passar de `alvo` metros.
 *
 * A divisão é pela aresta MAIS LONGA, e não pelo baricentro: dividir pelo meio
 * da maior aresta mantém os triângulos razoavelmente equiláteros, enquanto o
 * baricentro produz lascas cada vez mais finas — que somem na tela e continuam
 * custando o mesmo.
 *
 * Devolve uma geometria NOVA (não-indexada). A original fica intacta: ela é
 * compartilhada por todas as cópias da peça, e mexer nela deformaria o mapa
 * inteiro de uma vez.
 */
export function subdividir(geo, alvo = 1, { teto = TETO_TRIANGULOS } = {}) {
  if (!geo?.attributes?.position || !(alvo > 0)) return geo;

  const fonte = geo.index ? geo.toNonIndexed() : geo;
  // os atributos acompanham a posição: sem isso a peça perde textura ao ser
  // subdividida, e o sintoma parece defeito do extrator
  const nomes = Object.keys(fonte.attributes);
  const tam = Object.fromEntries(nomes.map((n) => [n, fonte.attributes[n].itemSize]));

  // cada triângulo é um array de 3 vértices, e cada vértice um objeto
  // { atributo: [valores] } — a forma mais simples que aguenta atributo novo
  // aparecendo sem este arquivo saber o nome dele
  let tris = [];
  const pos = fonte.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const t = [];
    for (let k = 0; k < 3; k++) {
      const v = {};
      for (const n of nomes) {
        const a = fonte.attributes[n];
        v[n] = [];
        for (let c = 0; c < a.itemSize; c++) v[n].push(a.array[(i + k) * a.itemSize + c]);
      }
      t.push(v);
    }
    tris.push(t);
  }

  const alvo2 = alvo * alvo;
  const dist2 = (a, b) => {
    const p = a.position, q = b.position;
    return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  };
  const meio = (a, b) => {
    const v = {};
    for (const n of nomes) v[n] = a[n].map((x, c) => (x + b[n][c]) / 2);
    return v;
  };

  // Um passe de cada vez, conferindo o teto ANTES: dividir e só então descobrir
  // que passou entregaria a malha estourada mesmo assim.
  for (let volta = 0; volta < 12; volta++) {
    let precisa = false;
    for (const t of tris) {
      if (dist2(t[0], t[1]) > alvo2 || dist2(t[1], t[2]) > alvo2 || dist2(t[2], t[0]) > alvo2) {
        precisa = true; break;
      }
    }
    if (!precisa) break;
    if (tris.length * 2 > teto) break;

    const novos = [];
    for (const t of tris) {
      const d = [dist2(t[0], t[1]), dist2(t[1], t[2]), dist2(t[2], t[0])];
      const maior = d[0] >= d[1] && d[0] >= d[2] ? 0 : (d[1] >= d[2] ? 1 : 2);
      if (d[maior] <= alvo2) { novos.push(t); continue; }
      // parte a aresta mais longa; o vértice oposto a ela é o que sobra
      const [a, b, c] = [t[maior], t[(maior + 1) % 3], t[(maior + 2) % 3]];
      const m = meio(a, b);
      novos.push([a, m, c], [m, b, c]);
    }
    tris = novos;
  }

  const fora = new THREE.BufferGeometry();
  for (const n of nomes) {
    const arr = new Float32Array(tris.length * 3 * tam[n]);
    let i = 0;
    for (const t of tris) for (const v of t) for (const x of v[n]) arr[i++] = x;
    fora.setAttribute(n, new THREE.BufferAttribute(arr, tam[n]));
  }
  return fora;
}

/**
 * Empurra cada vértice para a altura do terreno. Devolve a MESMA geometria.
 *
 * `altura(x, z) => metros` é lida em coordenadas LOCAIS da peça, como em
 * `geoPlaca` — quem chama é que sabe onde a peça está no mundo e desfaz o giro
 * e a escala.
 *
 * O `y` original é SOMADO, e não substituído: uma calçada com 8 cm de meio-fio
 * tem de continuar com o meio-fio depois de subir o morro. Substituir achataria
 * a peça contra o terreno, e o relato seria "a estrada perdeu o relevo dela".
 */
export function deformarPeloRelevo(geo, altura) {
  const p = geo?.attributes?.position;
  if (!p || typeof altura !== 'function') return geo;
  for (let i = 0; i < p.count; i++) {
    const h = altura(p.getX(i), p.getZ(i));
    if (Number.isFinite(h)) p.setY(i, p.getY(i) + h);
  }
  p.needsUpdate = true;
  // as normais TÊM de ser refeitas: mantidas as antigas, o morro fica iluminado
  // como se fosse plano — existe na silhueta e some na luz, sem nada acusar
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Quantos triângulos uma geometria tem. */
export const triangulosDe = (geo) => {
  const p = geo?.attributes?.position;
  if (!p) return 0;
  return Math.floor((geo.index ? geo.index.count : p.count) / 3);
};
