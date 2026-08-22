/**
 * **Os ícones de perfil**: desenha as artes-semente e gera o manifesto da pasta.
 *
 *     node tools/icones.mjs
 *
 * Duas coisas, e a segunda é a que importa mais:
 *
 *   1. desenha uns poucos ícones **em código** em `web/img/icones/`. É a mesma
 *      escolha do ícone do jogo (`gerar-icone.mjs`) e da pixel art do mundo
 *      andável: arte gerada tem fonte, um PNG solto no repositório não tem —
 *      ninguém sabe como refazê-lo maior, ou com outra cor, dois meses depois.
 *      São SEMENTES: existem para a tela nascer com o que escolher, e saem do
 *      caminho assim que houver arte de verdade;
 *   2. gera **`web/img/icones/index.json`**, a lista do que a pasta tem.
 *
 * ## Por que o manifesto existe
 *
 * A imagem do ícone mora no repositório e viaja no `game.zip`; o banco guarda
 * só o nome do arquivo. Isso deixa um buraco por onde o conteúdo cai calado: o
 * admin cadastra `arquivo: "dragao.png"`, ninguém publica a imagem, e o jogador
 * vê um quadrado vazio. O banco não sabe o que existe no disco, e o navegador
 * não pode listar uma pasta.
 *
 * O manifesto é a resposta: um `.json` estático (nada de rota nova — o
 * `tools/serve.mjs` e o `StaticServer.cs` já servem arquivos, e uma rota de
 * listagem custaria paridade nos dois). O painel do admin só oferece o que está
 * nele, e o `npm run icones:check` cruza o catálogo publicado com ele.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { novaImagem, ponto, png } from './png.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = path.join(raiz, 'web', 'img', 'icones');
const TAM = 128;

// A paleta do jogo (web/css/ui.css). Repetida aqui em número porque o CSS não é
// legível de um script sem um parser — e são cinco cores, não um tema.
const COR = {
  fundo:  [26, 32, 50],
  linha:  [56, 66, 95],
  ouro:   [232, 196, 106],
  azul:   [111, 168, 220],
  verde:  [111, 206, 159],
  roxo:   [176, 98, 155],
  vinho:  [226, 112, 122],
};

/** Disco cheio, com uma borda de outra cor. É a moldura de todos os ícones. */
function moldura(img, corFundo, corBorda) {
  const c = (TAM - 1) / 2, r = c - 1;
  for (let y = 0; y < TAM; y++) {
    for (let x = 0; x < TAM; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > r) continue;
      // A borda tem 5px: fina demais e ela some quando o ícone é desenhado a
      // 26px na lista de amigos.
      ponto(img, x, y, d > r - 5 ? corBorda : corFundo);
    }
  }
}

/** Um losango cheio, centrado — a forma-base dos desenhos abaixo. */
function losango(img, cx, cy, raio, cor) {
  for (let y = -raio; y <= raio; y++) {
    const largura = raio - Math.abs(y);
    for (let x = -largura; x <= largura; x++) ponto(img, cx + x, cy + y, cor);
  }
}

/** Retângulo cheio. */
function retangulo(img, x0, y0, w, h, cor) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) ponto(img, x, y, cor);
}

/**
 * As sementes. Cada uma é uma função que pinta — não um arquivo — e é isso que
 * permite gerar outra variação sem abrir um editor de imagem.
 */
const SEMENTES = {
  // O padrão de fábrica: o verso de uma carta. Todo jogador começa com ele, e é
  // por isso que ele é `gratuito` no catálogo — uma lista de escolha vazia é
  // pior que uma lista com uma opção só.
  'verso': (img) => {
    moldura(img, COR.fundo, COR.linha);
    const c = (TAM - 1) / 2;
    retangulo(img, c - 22, c - 30, 44, 60, COR.linha);
    retangulo(img, c - 18, c - 26, 36, 52, COR.fundo);
    losango(img, c, c, 16, COR.ouro);
    losango(img, c, c, 9, COR.fundo);
  },
  'ouro': (img) => {
    moldura(img, COR.fundo, COR.ouro);
    const c = (TAM - 1) / 2;
    losango(img, c, c, 34, COR.ouro);
    losango(img, c, c, 24, COR.fundo);
    losango(img, c, c, 12, COR.ouro);
  },
  'azul': (img) => {
    moldura(img, COR.fundo, COR.azul);
    const c = (TAM - 1) / 2;
    for (let i = 0; i < 3; i++) retangulo(img, c - 26 + i * 20, c - 26, 12, 52, COR.azul);
  },
  'verde': (img) => {
    moldura(img, COR.fundo, COR.verde);
    const c = (TAM - 1) / 2;
    losango(img, c, c - 14, 18, COR.verde);
    retangulo(img, c - 4, c, 8, 30, COR.verde);
  },
  'roxo': (img) => {
    moldura(img, COR.fundo, COR.roxo);
    const c = (TAM - 1) / 2;
    for (let a = 0; a < 5; a++) {
      const ang = (a / 5) * Math.PI * 2 - Math.PI / 2;
      losango(img, c + Math.cos(ang) * 22, c + Math.sin(ang) * 22, 10, COR.roxo);
    }
  },
  'vinho': (img) => {
    moldura(img, COR.fundo, COR.vinho);
    const c = (TAM - 1) / 2;
    retangulo(img, c - 30, c - 6, 60, 12, COR.vinho);
    retangulo(img, c - 6, c - 30, 12, 60, COR.vinho);
  },
};

fs.mkdirSync(pasta, { recursive: true });

for (const [nome, desenhar] of Object.entries(SEMENTES)) {
  const img = novaImagem(TAM);
  desenhar(img);
  fs.writeFileSync(path.join(pasta, `${nome}.png`), png(img));
}
console.log(`  ${Object.keys(SEMENTES).length} icone(s) semente desenhados em web/img/icones/`);

// ------------------------------------------------------------- o manifesto
// Lista o que a pasta TEM, e não o que as sementes acabaram de escrever: um
// PNG que você largou ali à mão precisa aparecer para o painel do admin tanto
// quanto os gerados. É a pasta que manda.
const arquivos = fs.readdirSync(pasta)
  .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
  .sort();

const manifesto = {
  _comentario: 'Gerado por `node tools/icones.mjs`. Lista os arquivos de '
             + 'web/img/icones/ para o painel do admin oferecer e para o '
             + '`npm run icones:check` cruzar com o catalogo do banco.',
  gerado_em: new Date().toISOString().slice(0, 10),
  arquivos,
};

fs.writeFileSync(path.join(pasta, 'index.json'), `${JSON.stringify(manifesto, null, 2)}\n`);
console.log(`  index.json com ${arquivos.length} arquivo(s)`);
console.log('  publique com `npm run release:build` — a imagem viaja no game.zip.');
