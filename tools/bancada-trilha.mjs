/**
 * **A bancada da TRILHA**: gera `bancada-trilha.html` na raiz, com a serpentina
 * desenhada por adversários de mentira — sem servidor, sem login e sem rede.
 * Dois cliques no arquivo, e **arraste a borda da janela**: é isso que a
 * bancada existe para mostrar.
 *
 *     node tools/bancada-trilha.mjs
 *
 * Existe pela mesma razão da `bancada-visual.mjs` e da `bancada-home.mjs`:
 * **mudança visual não se prova em teste de lógica**. O relato que a originou
 * foi *"as conexões ficam quebradas quando a tela fica cheia ou o tamanho da
 * janela muda"* — e o `serpentina.test.mjs` prova a conta, a fonte única das
 * medidas e a ausência do laço, mas nenhuma das treze asserções olha para onde
 * o traço aterrissa. Foi assim que a seta de ataque saiu publicada invisível
 * com treze testes de geometria passando.
 *
 * O CSS é **fatiado** do `web/trilha.html`, nunca copiado — uma cópia passaria
 * a valer por si e daria para consertar a bancada publicando a trilha quebrada.
 * O que a bancada troca é só o que depende de rede e de sessão: os adversários
 * viram uma lista fixa, a arte vira um degradê (nada é baixado do
 * ygoprodeck.com) e o `<script type="module">` inteiro fica de fora.
 *
 * A REGRA DE LAYOUT, essa, é a do jogo: as mesmas `--no`/`--gap`/`--cols`, a
 * mesma `.linha` com largura própria, os mesmos `liga-lado`/`liga-baixo`, e o
 * mesmo `quantosCabem` importado de `web/js/serpentina.js`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fonte = fs.readFileSync(path.join(raiz, 'web', 'trilha.html'), 'utf8');

/** Fatia entre dois marcadores, com erro claro quando o marcador sumiu. */
function fatiar(texto, abre, fecha, oQue) {
  const i = texto.indexOf(abre);
  const j = texto.indexOf(fecha, i + abre.length);
  if (i < 0 || j < 0) {
    throw new Error(`nao achei ${oQue} em web/trilha.html — o marcador "${abre}" mudou?`);
  }
  return texto.slice(i + abre.length, j);
}

const css = fatiar(fonte, '<style>', '</style>', 'o CSS da trilha');

// Adversários de mentira. Só nome e estado: nada aqui muda uma regra de layout
// — se mudasse, a bancada estaria provando outra tela. Treze de propósito, um
// número que não é múltiplo de coluna nenhuma: é com a ÚLTIMA linha incompleta
// que a serpentina erra, porque é ela que a linha invertida tem de encostar na
// direita da LINHA e não na do último quadro dela.
const NPCS = [
  ['Wevil', 'vencido'], ['Rex Raptor', 'vencido'], ['Mako', 'vencido'],
  ['Mai Valentine', 'vencido'], ['Pegasus', 'vencido'], ['Para & Dox', 'vencido'],
  ['Panik', 'vencido'], ['Bandit Keith', 'aberto'], ['Bonz', 'trancado'],
  ['Kaiba', 'trancado'], ['Yugi', 'trancado'], ['Ishizu', 'trancado'],
  ['Marik', 'trancado'],
];

// Um degradê por adversário no lugar da arte: a bancada não baixa nada, e o
// quadro precisa ter FUNDO para o conector aparecer por cima do que deve.
const tinta = (i) => `linear-gradient(135deg,hsl(${(i * 37) % 360} 45% 32%),hsl(${(i * 37 + 40) % 360} 45% 18%))`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bancada — Trilha de Duelos</title>
<link rel="stylesheet" href="web/css/ui.css">
<style>${css}
  /* Só da bancada: a régua que diz o que está sendo medido. Nada aqui toca no
     layout da serpentina. */
  .regua {
    position: fixed; right: 10px; bottom: 10px; z-index: 9;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 12px; font-size: 12px; color: var(--dim); line-height: 1.7;
  }
  .regua b { color: var(--gold); }
</style>
</head>
<body>
<div class="topbar"><div class="marca">TRILHA DE DUELOS — BANCADA</div></div>
<div class="hint">
  Arraste a borda da janela. A serpentina refaz as linhas sozinha e os traços
  continuam ligando — foi isso que quebrou no relato.
</div>
<div class="palco" id="palco">
  <div class="painel">
    <div class="instrucao">Bancada: sem servidor, sem login e sem rede.<br>
      Os adversários e a arte são de mentira; o LAYOUT é o do jogo.</div>
  </div>
  <div class="trilha" id="trilha"></div>
</div>
<div class="regua" id="regua"></div>

<script type="module">
import { quantosCabem } from './web/js/serpentina.js';

const NPCS = ${JSON.stringify(NPCS)};
const TINTA = ${JSON.stringify(NPCS.map((_, i) => tinta(i)))};
const trilha = document.getElementById('trilha');
const regua = document.getElementById('regua');

// A MESMA leitura do jogo (\`medidas()\` em web/js/trilha.js): as medidas moram
// no CSS e são lidas de volta. Uma cópia aqui deixaria a bancada provar
// números que a trilha não usa.
function medidas() {
  const cs = getComputedStyle(trilha);
  return {
    quadro: parseFloat(cs.getPropertyValue('--no')),
    vao: parseFloat(cs.getPropertyValue('--gap')),
  };
}
const porLinha = () => {
  const { quadro, vao } = medidas();
  return quantosCabem(trilha.clientWidth, quadro, vao);
};

let colsDesenhadas = 0;

function render() {
  trilha.replaceChildren();
  const cols = porLinha();
  colsDesenhadas = cols;
  trilha.style.setProperty('--cols', cols);

  for (let inicio = 0; inicio < NPCS.length; inicio += cols) {
    const fatia = NPCS.slice(inicio, inicio + cols);
    const linha = document.createElement('div');
    linha.className = 'linha' + ((inicio / cols) % 2 ? ' invertida' : '');

    fatia.forEach(([nome, estado], k) => {
      const i = inicio + k;
      const no = document.createElement('div');
      // As MESMAS classes do jogo: vencido e' sempre 'aberto vencido' (o
      // dourado do liberado mais o verde da vitoria), nunca 'vencido'
      // sozinho — desenhar um estado que o jogo nao produz seria provar
      // outra tela.
      no.className = 'no ' + (estado === 'vencido' ? 'aberto vencido' : estado);
      if (i < NPCS.length - 1) no.classList.add(k < fatia.length - 1 ? 'liga-lado' : 'liga-baixo');
      if (estado !== 'trancado') no.style.backgroundImage = TINTA[i];
      no.innerHTML = (estado === 'trancado' ? '<span class="cadeado">🔒</span>' : '')
        + (estado === 'vencido' ? '<span class="selo">✔</span>' : '')
        + '<span class="rotulo">' + (estado === 'trancado' ? '???' : nome) + '</span>';
      linha.append(no);
    });
    trilha.append(linha);
  }

  const { quadro, vao } = medidas();
  const larguraDaLinha = cols * quadro + (cols - 1) * vao;
  regua.innerHTML = 'trilha: <b>' + trilha.clientWidth + 'px</b>'
    + ' · quadro <b>' + quadro + '</b> vao <b>' + vao + '</b>'
    + '<br>cabem <b>' + cols + '</b> por linha (' + larguraDaLinha + 'px)'
    + ' · <b>' + Math.ceil(NPCS.length / cols) + '</b> linha(s)';
}

// O mesmo observador do jogo, com a mesma guarda contra o laço.
new ResizeObserver(() => {
  if (porLinha() === colsDesenhadas) return;
  render();
}).observe(trilha);

render();
</script>
</body>
</html>
`;

const saida = path.join(raiz, 'bancada-trilha.html');
fs.writeFileSync(saida, html, 'utf8');
console.log(`bancada-trilha.html gerado em ${saida}`);
console.log('abra o arquivo e ARRASTE a borda da janela.');
