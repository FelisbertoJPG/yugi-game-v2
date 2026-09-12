/**
 * Gera `bancada-cena.html` na raiz: o **editor de cena** rodando com a
 * biblioteca de verdade, sem servidor e sem login — dois cliques no arquivo.
 *
 * Existe porque o editor é a única tela do projeto que **só se julga usando**:
 * "dá para montar um lugar movendo peças?" não é pergunta que teste de lógica
 * responda, e abrir o jogo para descobrir custa login, sessão e o Mundo inteiro.
 *
 * ## Ela USA o editor, não tem uma cópia dele
 *
 * `cena.js` e `cenaeditor.js` são LIDOS do jogo e embutidos como estão (só os
 * `export` caem, porque aqui tudo roda num escopo só). A bancada põe a volta —
 * a gaveta e o selo de modo —, exatamente como `cenapagina.js` põe a dela.
 *
 * > A primeira versão tinha a interação copiada, e o primeiro pedido de
 * > mudança (o fantasma que segue o mouse) teria sido feito num lugar e não no
 * > outro: a bancada continuaria "funcionando", provando o editor de ontem.
 *
 * ## O que a bancada precisa trocar, e só isso
 *
 * `file://` não faz `fetch` de arquivo local — um editor que só soubesse buscar
 * por rede abriria vazio aqui e não provaria nada. Por isso as peças vêm
 * EMBUTIDAS, e `montarEditor` recebe um `carregar` que lê do objeto em memória
 * em vez da rede. É o único ponto em que as duas telas diferem.
 *
 *   node tools/bancada-cena.mjs [quantas peças]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PECAS = path.join(RAIZ, 'web', 'pecas');
const QUANTAS = Number(process.argv[2]) || 30;

if (!fs.existsSync(path.join(PECAS, 'catalogo.json'))) {
  console.error('nao ha biblioteca em web/pecas/.');
  console.error('gere com: node tools/tagforce/pecas.mjs <pasta do PSP_GAME>');
  process.exit(1);
}

const catalogo = JSON.parse(fs.readFileSync(path.join(PECAS, 'catalogo.json'), 'utf8')).pecas;

// As MAIORES primeiro: são as que mostram se a escala e a textura estão certas.
// Uma bancada com as vinte peças de dois triângulos não mostraria nada.
const escolhidas = [...catalogo].sort((a, b) => b.tri - a.tri).slice(0, QUANTAS);

const malhas = {}, texturas = {};
for (const p of escolhidas) {
  malhas[p.id] = JSON.parse(fs.readFileSync(path.join(PECAS, 'p', p.id + '.json'), 'utf8'));
  if (p.tex && !texturas[p.tex]) {
    texturas[p.tex] = 'data:image/png;base64,'
      + fs.readFileSync(path.join(PECAS, 'tex', p.tex + '.png')).toString('base64');
  }
}

/**
 * Lê um módulo do jogo e o prepara para viver num escopo só: tira os `export`
 * e os `import` (que a bancada resolve uma vez, no topo).
 *
 * O `import` casa ATÉ o `from '...'` porque ele pode ocupar VÁRIAS LINHAS — um
 * `^import .*$` apaga só a primeira e deixa a lista de nomes órfã no meio do
 * arquivo, o que é um erro de sintaxe e uma página preta e muda. Foi assim que
 * esta bancada quebrou na primeira tentativa.
 */
const doJogo = (arq) => fs.readFileSync(path.join(RAIZ, 'web', 'js', arq), 'utf8')
  // o `;?` NÃO pode ser seguido de `$`: um import com COMENTÁRIO na mesma linha
  // (`import { rnd } from './tileset.js';   // …`) não casaria, e a linha
  // sobreviveria dentro do bloco — que é justamente o que a checagem no fim
  // deste arquivo pegou.
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
  .replace(/^export /gm, '')

const html = `<!doctype html>
<meta charset="utf-8">
<title>bancada — editor de cena</title>
<style>
  html,body{margin:0;height:100%;background:#0e1119;overflow:hidden;
            font:13px system-ui,sans-serif;color:#cbd5e1}
  #app{display:flex;height:100%}
  #palco{flex:1;position:relative;min-width:0}
  canvas{display:block;width:100%;height:100%;cursor:crosshair}
  canvas.arrastando{cursor:grabbing}
  aside{width:290px;border-left:1px solid #26314a;background:#131a29;
        display:flex;flex-direction:column}
  aside h2{margin:0;padding:10px 12px;font-size:12px;color:#8fa0bd;
           border-bottom:1px solid #26314a;font-weight:normal}
  #busca{margin:8px 8px 0;padding:6px 8px;background:#0e1119;color:#cbd5e1;
         border:1px solid #26314a;border-radius:6px;font:inherit;font-size:11px}
  #largar{margin:8px;padding:6px;background:#1e293b;color:#e8c46a;border:1px solid #e8c46a;
          border-radius:6px;cursor:pointer;font:inherit;font-size:11px}
  #largar[hidden]{display:none}
  #gaveta{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px}
  /* Os GRUPOS da gaveta. <details> é HTML: abrir e fechar é do navegador,
     sem estado nosso e sem ouvinte de clique — e sem o defeito clássico do
     acordeão escrito à mão, o display que some junto com a classe e deixa a
     seção aberta e vazia. */
  .grupo { border: 1px solid #26314a; border-radius: 6px; overflow: hidden; }
  .grupo > summary { padding: 7px 10px; cursor: pointer; font-size: 11px;
                     background: #0e1119; display: flex; justify-content: space-between;
                     align-items: center; gap: 8px; user-select: none; list-style: none; }
  .grupo > summary::-webkit-details-marker { display: none; }
  /* o triângulo é nosso, e gira com o estado — o marcador nativo some acima
     porque ele é desenhado de forma diferente em cada navegador */
  .grupo > summary::before { content: '▸'; color: #64748b; transition: transform .12s; }
  .grupo[open] > summary::before { transform: rotate(90deg); }
  .grupo > summary .conta { color: #64748b; font-size: 10px; margin-left: auto; }
  .grupo > .peca { margin: 3px 6px; }
  .grupo > .peca:first-of-type { margin-top: 6px; }
  .grupo > .peca:last-child { margin-bottom: 6px; }
  .grupo > .nota { padding: 4px 10px 8px; font-size: 10px; color: #64748b; }

  .peca{background:#0e1119;border:1px solid #26314a;border-radius:6px;padding:6px 8px;
        cursor:pointer;color:#cbd5e1;font:inherit;font-size:11px;text-align:left;
        display:flex;justify-content:space-between;gap:8px}
  .peca:hover{border-color:#e8c46a}
  .peca.ativa{border-color:#e8c46a;box-shadow:0 0 0 1px #e8c46a inset}
  .peca .m{color:#64748b;font-size:10px;white-space:nowrap}
  #hud{position:absolute;left:12px;bottom:10px;font-size:11px;color:#8fa0bd;
       line-height:1.7;pointer-events:none;text-shadow:0 1px 3px #000}
  kbd{background:#1e293b;border:1px solid #475569;border-radius:3px;padding:0 4px;
      font:11px ui-monospace,monospace}
  b{color:#e2e8f0}
  #medidor{position:absolute;right:12px;top:10px;font-size:11px;color:#8fa0bd;
           text-align:right;pointer-events:none;text-shadow:0 1px 3px #000}
  #modo{position:absolute;left:50%;transform:translateX(-50%);top:10px;font-size:11px;
        color:#8fa0bd;background:#0f172acc;padding:4px 12px;border:1px solid #26314a;
        border-radius:20px;pointer-events:none}
  #modo.pondo{color:#e8c46a;border-color:#e8c46a}
  #barra{display:flex;gap:6px;margin:8px 8px 0}
  #barra select,#barra button{flex:1;background:#0e1119;color:#cbd5e1;border:1px solid #26314a;
    border-radius:6px;padding:5px;font:inherit;font-size:11px;cursor:pointer}
  #colisoes.ligado{border-color:#51d88a;color:#51d88a}
  #relevo.ligado{border-color:#d8a24a;color:#d8a24a}
  #modo.relevo{color:#d8a24a;border-color:#d8a24a}
</style>
<div id=app>
  <div id=palco>
    <canvas id=cv></canvas>
    <div id=medidor></div>
    <div id=modo></div>
    <div id=hud>
      <b>pondo</b> — a peça segue o mouse; <kbd>clique</kbd> deixa uma cópia<br>
      <b>escolhendo</b> — <kbd>clique</kbd> seleciona, <kbd>arraste</kbd> move,
      <kbd>Del</kbd> apaga, <kbd>D</kbd> duplica<br>
      <b>relevo</b> (<kbd>R</kbd>) — arraste no chão para levantar,
      <kbd>Shift</kbd> cava &nbsp;·&nbsp; só onde há placa de terreno<br>
      <kbd>Shift</kbd>+arraste sobe/desce &nbsp; <kbd>W</kbd>/<kbd>S</kbd> altura &nbsp;
      <kbd>F</kbd> assenta no que está embaixo<br>
      <kbd>Ctrl</kbd>+<kbd>roda</kbd> tamanho &nbsp; <kbd>Q</kbd>/<kbd>E</kbd> gira &nbsp;
      <kbd>C</kbd> colisões &nbsp; <kbd>Esc</kbd> larga a peça<br>
      <kbd>botão direito</kbd> gira a câmera &nbsp; <kbd>roda</kbd> aproxima
    </div>
  </div>
  <aside>
    <h2>biblioteca</h2>
    <input id=busca type=search placeholder="procurar peça…" autocomplete=off>
    <div id=barra>
      <select id=passo title="a peça gruda neste passo">
        <option value=0>livre</option><option value=0.5>0,5 m</option>
        <option value=1 selected>1 m</option><option value=2>2 m</option>
        <option value=4>4 m</option>
      </select>
      <button id=colisoes>colisões</button>
      <button id=relevo>relevo</button>
    </div>
    <button id=largar hidden>✕ largar a peça (Esc)</button>
    <div id=gaveta></div>
  </aside>
</div>

<script type="module">
import * as THREE from './web/vendor/three/three.module.min.js';

const MALHAS = ${JSON.stringify(malhas)};
const TEXTURAS = ${JSON.stringify(texturas)};
const GAVETA = ${JSON.stringify(escolhidas)};

// ---- a REGRA e o EDITOR, lidos do jogo ----
${doJogo('cena.js')}
${doJogo('tileset.js')}
${doJogo('floresta.js')}
${doJogo('floresta3d.js')}
${doJogo('malha.js')}
${doJogo('pecasbase.js')}
${doJogo('cenagaveta.js')}
${doJogo('cenaeditor.js')}

// ---- a volta da bancada: gaveta, selo de modo, e as peças embutidas ----
const carregar = {
  // e' o UNICO ponto em que a bancada difere da tela: file:// nao faz fetch
  buscar: async (id) => MALHAS[id] ?? null,
  urlDaTextura: (slug) => TEXTURAS[slug] ?? '',
};

const $ = (id) => document.getElementById(id);
const botoes = new Map();   // preenchido por pintar2()

const editor = montarEditor($('cv'), { aoMudar: pintar, carregar });

function pintar({ cena, selecionado, modo, peca, pincel, aviso }) {
  $('modo').textContent = modo === 'relevo' ? 'relevo — arraste no chão (Shift cava)'
    : modo === 'por' ? 'pondo: ' + peca
    : (selecionado >= 0 ? 'peça selecionada' : 'clique numa peça da cena');
  $('modo').classList.toggle('pondo', modo === 'por');
  $('modo').classList.toggle('relevo', modo === 'relevo');
  $('relevo').classList.toggle('ligado', !!pincel);
  if (aviso) { $('modo').textContent = aviso; }
  $('largar').hidden = modo !== 'por';
  $('medidor').textContent = cena.itens.length + ' peças · '
    + editor.triangulos().toLocaleString('pt-BR') + ' triângulos';
  for (const [id, b] of botoes) b.classList.toggle('ativa', id === peca);
}

// as peças BASE (geradas em código) + as do Tag Force (embutidas acima)
const CATALOGO_TUDO = juntarCatalogos(catalogoBase(), GAVETA);
editor.usarCatalogo(CATALOGO_TUDO);   // sem ele nao ha snap por modulo nem colisao

function pintar2() {
  const novos = desenharGaveta($('gaveta'), agrupar(CATALOGO_TUDO, $('busca').value),
    (id) => editor.pegarPeca(id));
  botoes.clear();
  for (const [k, v] of novos) botoes.set(k, v);
  for (const [id, b] of botoes) b.classList.toggle('ativa', id === editor.pecaNaMao());
}
$('busca').oninput = pintar2;
$('largar').onclick = () => editor.largarPeca();
$('passo').onchange = () => editor.passo(Number($('passo').value));
$('colisoes').onclick = () => {
  $('colisoes').classList.toggle('ligado', editor.mostrarColisoes());
};
$('relevo').onclick = () => editor.usarPincel(editor.pincel() ? null : { raio: 6 });
pintar2();
<\/script>
`;

// O gerador RECUSA em vez de gravar uma bancada quebrada.
//
// A saída é um HTML com JS embutido: um erro de sintaxe ali abre uma página
// PRETA E MUDA — o pior desfecho para uma ferramenta que existe para se olhar.
// Duas armadilhas já morderam esta bancada, e as duas são invisíveis na leitura:
// um `import` multi-linha cujo strip deixava a lista de nomes órfã, e um
// backtick que veio junto de um comentário e FECHOU o template deste arquivo.
const corpo = html.slice(html.lastIndexOf('<script type="module">'));
for (const [erro, achou] of [
  // o ÚNICO import legítimo é o do three, na primeira linha do bloco
  ['import solto no corpo embutido',
   corpo.split(/\r?\n/).filter((l) => l.startsWith('import ')).length > 1],
  ['linha orfa de import (} from)', /^\}\s*from /m.test(corpo)],
  ['export sobrando (nao vale fora de modulo)', /^export /m.test(corpo)],
]) {
  if (achou) { console.error('RECUSADO: ' + erro); process.exit(1); }
}
try {
  // `new Function` PARSEIA sem executar: é a mesma checagem do navegador, e a
  // única que enxerga o erro antes de o arquivo existir.
  new Function(corpo.replace(/^<script[^>]*>/, '').replace(/<\/script>\s*$/, '')
    .replace(/^import .*$/gm, '').replace(/await/g, ''));
} catch (e) {
  console.error('RECUSADO: o JS embutido nao parseia —', e.message);
  process.exit(1);
}

const destino = path.join(RAIZ, 'bancada-cena.html');
fs.writeFileSync(destino, html);
console.log('peças embutidas :', escolhidas.length, '| texturas:', Object.keys(texturas).length);
console.log('gravado         :', path.relative(RAIZ, destino),
  '(' + (html.length / 1048576).toFixed(1) + ' MB)');
console.log('dois cliques no arquivo — sem servidor, sem login.');
