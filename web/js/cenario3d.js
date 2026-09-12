/**
 * **Cenário 3D** — o DESENHO do que `cenario.js` validou.
 *
 * Mesma divisão do resto do Mundo: `cenario.js` decide (e é testável em Node,
 * porque não encosta em three nem em DOM), isto aqui desenha, `mundo3d.js`
 * amarra. É essa separação que deixa a colisão ser provada sem navegador.
 *
 * > Isto é a exceção à regra de ouro do `floresta3d.js` (*"a arte é gerada em
 * > código"*), e a exceção é declarada: a floresta continua gerada; o cenário é
 * > uma construção MODELADA que chega de fora, por `store/`, e por isso nunca
 * > viaja num Release. Quem produz o pacote hoje é `tools/tagforce/mapa.mjs`.
 *
 * ## As três coisas que erram CALADAS aqui
 *
 * - **`RepeatWrapping`**: o UV de um mapa vai muito além de 0..1 (o chão do
 *   dormitório vai de −9,5 a 21). Sem repetição, a textura estica a última
 *   fileira de pixels pelo piso inteiro — que parece uma escolha de arte, não
 *   um defeito.
 * - **`alphaTest`**: os decalques (as linhas do campo de duelo pintadas no
 *   chão) têm alfa. Sem ele, cada decalque vira um retângulo PRETO sobre o
 *   piso — e nada no console diz por quê.
 * - **`colorSpace`**: textura sem `SRGBColorSpace` no three moderno sai
 *   lavada. Não quebra nada, só fica errado, que é o pior tipo de errado.
 */
import * as THREE from '/web/vendor/three/three.module.min.js';

/** Enquanto a arte não chega, o cinza do concreto — nunca branco (some na névoa). */
const SEM_TEXTURA = 0xb9bcc2;

/**
 * Monta o grupo. `offset` é o que `assentar()` devolveu.
 *
 * As texturas entram por `Image` a partir da `data:` URL do pacote, e a malha
 * aparece ANTES delas: um cenário cinza que ganha cor meio segundo depois é
 * melhor que um Mundo parado esperando vinte PNGs.
 */
export function montarCenario(pacote, offset = { x: 0, y: 0, z: 0 }, { sombra = true } = {}) {
  const grupo = new THREE.Group();
  grupo.name = 'cenario';
  grupo.position.set(offset.x, offset.y, offset.z);

  for (const g of pacote.grupos) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({ color: SEM_TEXTURA, side: THREE.DoubleSide });
    if (g.png) {
      const im = new Image();
      im.onload = () => {
        const t = new THREE.Texture(im);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        mat.map = t;
        mat.color.set(0xffffff);       // a cor multiplica a textura: cinza a escureceria
        mat.alphaTest = 0.35;          // decalque com alfa vira retangulo preto sem isto
        mat.needsUpdate = true;
      };
      im.src = g.png;
    }

    const malha = new THREE.Mesh(geo, mat);
    malha.castShadow = sombra;
    malha.receiveShadow = sombra;
    grupo.add(malha);
  }
  return grupo;
}

/** Devolve a malha e as texturas à GPU. Sem isto, trocar de cenário vaza. */
export function descartarCenario(grupo) {
  grupo?.traverse?.((o) => {
    o.geometry?.dispose?.();
    if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); }
  });
  grupo?.parent?.remove(grupo);
}
