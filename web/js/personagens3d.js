/**
 * **Personagens 3D** — a tinta de `personagens.js` virando textura de verdade.
 *
 * `personagens.js` decide (e é testável em Node, porque não encosta em three
 * nem em canvas); isto aqui pinta. Mesma divisão de `floresta.js`/`floresta3d.js`
 * e de `cenario.js`/`cenario3d.js`.
 *
 * ## A textura base sai do MODELO JÁ CARREGADO
 *
 * Ela não é buscada de novo por um caminho escrito à mão. O `.glb` referencia
 * `Textures/texture-a.png` de dentro dele, o `GLTFLoader` já a baixou e ela está
 * no material do corpo — então a base é `materialDe(corpo, 'tronco').map.image`.
 *
 * Isso não é economia de uma requisição: é **não ter um segundo caminho** para o
 * mesmo arquivo. Um caminho escrito aqui continuaria funcionando no dia em que o
 * `.glb` passasse a apontar outra textura, e o Mundo mostraria o personagem
 * pintado por cima da arte errada — sem erro nenhum.
 *
 * ## Material por PERSONAGEM, não por boneco
 *
 * Dez pessoas com o mesmo personagem dividem um material e uma textura. Fossem
 * por boneco, cada um que entrasse na floresta subiria uma cópia de 1 MB para a
 * GPU — e `descartar()` de um apagaria a textura dos outros, que é exatamente o
 * defeito que o cache de geometria de `boneco3d.js` já documenta.
 *
 * > Por isso nada aqui é descartado no `descartar()` do boneco: o cache é do
 * > jogo, não da pessoa. Ele nasce no boot e vive enquanto a página viver.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { CORPO_INTEIRO, materialDe } from './modelos.js';
import { PERSONAGEM_PADRAO, girarMatiz, giroPara, normalizarPersonagem } from './personagens.js';

/** id do personagem → `THREE.CanvasTexture`. O padrão nunca entra aqui. */
const _texturas = new Map();
/** `id|uuid do material base` → material clonado. */
const _materiais = new Map();
let _base = null;      // { imagem, largura, altura } da textura do arquivo

/** A imagem que o `.glb` trouxe, ou `null` se não há corpo modelado. */
export function texturaBase() {
  const mat = materialDe(CORPO_INTEIRO, 'tronco') || materialDe(CORPO_INTEIRO, 'cabeca');
  const img = mat?.map?.image;
  return img && img.width ? img : null;
}

/**
 * Gera as variantes. **Nunca levanta**: sem corpo modelado, sem canvas ou sem
 * catálogo, devolve o que conseguiu — e o Mundo segue com o personagem padrão,
 * que é a textura do arquivo.
 */
export function prepararPersonagens(catalogo) {
  const img = texturaBase();
  if (!img) return { base: false, feitos: 0 };
  _base = img;

  let cv;
  try {
    cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
  } catch { return { base: false, feitos: 0 }; }

  const ctx = cv.getContext('2d');
  const original = ctx.getImageData(0, 0, cv.width, cv.height);
  let feitos = 0;

  for (const p of catalogo ?? []) {
    if (!p || p.id === PERSONAGEM_PADRAO || !p.cor || _texturas.has(p.id)) continue;
    const giro = giroPara(original.data, p.cor);
    if (!giro) continue;                         // nada a pintar: fica o padrão

    // uma cópia por personagem, porque `girarMatiz` muda no lugar (de propósito)
    const dados = new ImageData(new Uint8ClampedArray(original.data), cv.width, cv.height);
    girarMatiz(dados.data, giro);

    const lona = document.createElement('canvas');
    lona.width = cv.width; lona.height = cv.height;
    lona.getContext('2d').putImageData(dados, 0, 0);

    const tex = new THREE.CanvasTexture(lona);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;                           // o glTF já vem com o V virado
    tex.needsUpdate = true;
    _texturas.set(p.id, tex);
    feitos++;
  }
  return { base: true, feitos, total: _texturas.size };
}

/** A textura de um personagem, ou `null` (padrão, desconhecido, sem base). */
export function texturaDe(id) {
  const alvo = normalizarPersonagem(id);
  return alvo === PERSONAGEM_PADRAO ? null : (_texturas.get(alvo) ?? null);
}

/**
 * O material do corpo para um personagem: um clone do material do ARQUIVO com
 * a textura trocada. Devolve `null` quando não há troca a fazer — e aí quem
 * chama usa o material original, sem clonar nada.
 */
export function materialDoPersonagem(id, base) {
  const tex = texturaDe(id);
  if (!tex || !base) return null;
  const chave = `${normalizarPersonagem(id)}|${base.uuid}`;
  const pronto = _materiais.get(chave);
  if (pronto) return pronto;
  const m = base.clone();
  m.map = tex;
  m.needsUpdate = true;
  _materiais.set(chave, m);
  return m;
}

/** Diagnóstico: quantas variantes existem, e se a base foi encontrada. */
export const estadoDosPersonagens = () => ({ base: !!_base, variantes: _texturas.size });
