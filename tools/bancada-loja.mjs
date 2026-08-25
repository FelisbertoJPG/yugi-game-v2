/**
 * BANCADA DA LOJA — `node tools/bancada-loja.mjs` gera `bancada-loja.html`.
 *
 * Dois cliques no arquivo e o medidor das garantidas aparece em todos os estados
 * que importam, com dados de mentira: sem servidor, sem login, sem DP.
 *
 * POR QUE ELA EXISTE. Mudança visual não se prova em teste de lógica. A seta de
 * ataque foi publicada INVISÍVEL com treze testes de geometria passando, e a
 * lateral social saiu flutuando no meio da tela com os vinte e um de notificação
 * verdes. Uma barra de progresso tem exatamente o mesmo risco: `width: NaN%` não
 * desenha nada, não dá erro e não aparece no console — e o jeito de descobrir
 * seria um jogador dizendo "sumiu".
 *
 * O CSS é FATIADO de `web/loja.html`, nunca copiado. Uma cópia passaria a valer
 * por si e daria para "consertar a bancada" publicando a Loja quebrada — ela
 * deixaria de provar o que está no jogo.
 */
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(RAIZ, 'web', 'loja.html'), 'utf8');

/** Fatia o CSS entre dois marcadores do arquivo real. */
function fatiar(de, ate) {
  const i = html.indexOf(de);
  const j = html.indexOf(ate, i);
  if (i < 0 || j < 0) {
    console.error(`nao achei o trecho de CSS ("${de.slice(0, 40)}…").\n`
      + 'A bancada FATIA o loja.html — se o CSS mudou de forma, conserte AQUI\n'
      + 'em vez de copiar o estilo para dentro dela.');
    process.exit(1);
  }
  return html.slice(i, j);
}

const css = fatiar('  .pack {', '</style>');

// ---------------------------------------------------------------- os estados
// Cada linha é um caso que o jogador vive. Os dois últimos são os que erram
// calado: divisão que dá NaN e progresso cheio.
const CASOS = [
  ['nunca abriu',            0,  20,    0, 10000],
  ['no meio da volta',       7,  20, 2400, 10000],
  ['quase la',              19,  20, 9800, 10000],
  ['acabou de ganhar',      20,  20,    0, 10000],
  ['muitas voltas (273)',  273,  20, 7600, 10000],
  ['UR pronta',              5,  20, 10000, 10000],
];

const card = (rot, opens, cada, gasto, teto) => {
  const passos = opens % cada;
  const faltam = cada - passos;
  const proxSR = faltam === 1;
  const g = Math.min(teto, gasto);
  const urPronta = teto - g === 0;
  const pct = (n, d) => (d ? (n / d) * 100 : 0);
  return `
  <div class="pack">
    <div class="art"></div>
    <div class="body">
      <span class="name">Booster de Mentira</span>
      <span class="meta">${rot} · 40 cartas · 100 DP</span>

      <div class="pity ${proxSR ? 'pronta' : ''}">
        <div class="pity-topo">
          <span class="pity-rot">${proxSR ? '★ SR GARANTIDA NO PRÓXIMO!' : 'SR garantida'}</span>
          <span class="pity-n">${passos}<i>/${cada}</i></span>
        </div>
        <div class="pity-trilho"><div class="pity-fill" style="width:${pct(passos, cada)}%"></div></div>
      </div>

      <div class="pity ur ${urPronta ? 'pronta' : ''}">
        <div class="pity-topo">
          <span class="pity-rot">${urPronta ? '★★ UR GARANTIDA NO PRÓXIMO!' : 'UR garantida'}</span>
          <span class="pity-n">${g}<i>/${teto} DP</i></span>
        </div>
        <div class="pity-trilho"><div class="pity-fill" style="width:${pct(g, teto)}%"></div></div>
      </div>

      <div class="compra">
        <button class="buy btn-primary">abrir (100 DP)</button>
        <button class="buy10">abrir 10 <b>(1000 DP)</b></button>
      </div>
      <button class="ver">ver as cartas</button>
    </div>
  </div>`;
};

const pagina = `<!doctype html>
<meta charset="utf-8">
<title>bancada — medidor das garantidas</title>
<style>
  :root {
    --bg:#0b0b10; --panel:#141420; --panel2:#1b1b2a; --line:#2a2a3d;
    --ink:#e8e8f0; --dim:#8a8aa0; --gold:#e5c46a; --red:#d05a5a; --green:#3fd68a;
  }
  body { background:var(--bg); color:var(--ink); font:13px/1.5 monospace; padding:24px; }
  h1 { color:var(--gold); font-size:15px; letter-spacing:2px; font-weight:normal; }
  p.nota { color:var(--dim); max-width:70ch; }
  .grade { display:flex; flex-wrap:wrap; gap:14px; margin-top:18px; }
  .btn-primary { background:var(--gold); border:0; color:#1a1a24; font-family:inherit;
                 padding:6px 10px; cursor:pointer; }
${css}
</style>
<h1>MEDIDOR DAS GARANTIDAS</h1>
<p class="nota">
  Os estados que o jogador vive, com dados de mentira. O CSS e o markup vêm
  FATIADOS de <code>web/loja.html</code> — se algo aqui estiver torto, está torto
  no jogo. Passe o mouse nos botões; o estado <b>pronta</b> pulsa sozinho.
</p>
<div class="grade">${CASOS.map((c) => card(...c)).join('')}</div>
`;

const saida = path.join(RAIZ, 'bancada-loja.html');
fs.writeFileSync(saida, pagina);
console.log(`  bancada-loja.html gerado (${(pagina.length / 1024).toFixed(1)} KB)`);
console.log('  dois cliques no arquivo — sem servidor, sem login.');
