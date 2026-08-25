// Bancada da REVELAÇÃO: as cartas viradas do fim de duelo e da abertura de
// pacote, num quadro de mentira — sem servidor, sem login e sem gastar DP.
//
// Existe pela mesma razão da `bancada-visual.mjs`: mudança VISUAL não se prova
// em teste de lógica. A virada, a aproximação da carta revelada e a grade de
// sete colunas não têm asserção possível — o que se pode fazer é OLHAR, e olhar
// custava um duelo vencido ou 1000 DP num [abrir 10].
//
// O módulo e o CSS são LIDOS do jogo, nunca copiados: uma cópia passaria a
// valer por si e daria para "consertar a bancada" enquanto a Loja continua
// quebrada.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';

const ui = readFileSync(RAIZ + 'web/css/ui.css', 'utf8');
// O verso da carta é buscado por caminho ABSOLUTO no jogo (`/web/assets/…`),
// que em `file://` aponta para a raiz do disco. Aqui ele vira relativo — a
// bancada é gerada na raiz do repositório, ao lado da pasta `web/`.
const css = readFileSync(RAIZ + 'web/css/revelacao.css', 'utf8')
  .replace("url('/web/assets/", "url('web/assets/");
const js = readFileSync(RAIZ + 'web/js/revelacao.js', 'utf8')
  .replace(/^export /gm, '');   // sem módulos: file:// não carrega import

// Cartas reais, para a arte vir do ygoprodeck quando houver internet (sem ela
// ficam em branco — igual ao jogo).
const CARTAS = [
  [46986414, 'Dark Magician'], [89631139, 'Blue-Eyes White Dragon'],
  [74677422, 'Red-Eyes B. Dragon'], [33396948, 'Exodia the Forbidden One'],
  [70781052, 'Summoned Skull'], [53129443, 'Dark Hole'],
  [12580477, 'Raigeki'], [44095762, 'Mirror Force'],
  [5318639, 'Petit Moth'], [55144522, 'Pot of Greed'],
  [83764718, 'Monster Reborn'], [70903634, 'Cocoon of Evolution'],
];
const RAR = ['N', 'N', 'N', 'R', 'R', 'SR', 'UR'];

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Bancada — revelação de cartas</title>
<style>
${ui}
${css}
body { padding: 20px; font-family: inherit; }
.quadro { background: var(--panel); border: 2px solid var(--gold); padding: 20px;
          max-width: min(860px, 96vw); max-height: 92vh; margin: 0 auto 20px;
          display: flex; flex-direction: column; min-height: 0; text-align: center; }
.quadro h2 { margin: 0 0 4px; color: var(--gold); font-size: 18px; }
.quadro .sub { font-size: 11px; color: var(--dim); margin-bottom: 14px; }
.lista { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 4px; }
.acts { margin-top: 14px; flex: none; display: flex; gap: 8px; justify-content: center; }
</style></head><body>

<div class="quadro">
  <h2>ABRIR 10 — 50 cartas</h2>
  <div class="sub">a caixa não passa da janela: a rolagem é da LISTA, e os botões
    ficam sempre alcançáveis. Sete por linha.</div>
  <div class="lista" id="loja"></div>
  <div class="acts">
    <button id="loja-pular">revelar rápido</button>
    <button id="loja-ordem">organizar por raridade</button>
    <button id="loja-de-novo">sortear outro lote</button>
  </div>
</div>

<div class="quadro">
  <h2>DROP DE NPC — 3 cartas</h2>
  <div class="sub">a mesma cerimônia com poucas cartas: a grade se fecha no
    número que houver, centralizada.</div>
  <div class="lista" id="drop" style="--rev-w:96px"></div>
  <div class="acts"><button id="drop-pular">pular e revelar tudo</button></div>
</div>

<script type="module">
${js}

const CARTAS = ${JSON.stringify(CARTAS)};
const RAR = ${JSON.stringify(RAR)};
const nomes = new Map(CARTAS.map(([id, n]) => [id, n]));
const nomeDe = (id) => nomes.get(id) ?? String(id);
const arte = (id) => \`https://images.ygoprodeck.com/images/cards/\${id}.jpg\`;
const sorteia = (a) => a[Math.floor(Math.random() * a.length)];

function lote(n) {
  return Array.from({ length: n }, () => {
    const [id] = sorteia(CARTAS);
    return { id, raridade: sorteia(RAR), nova: Math.random() < 0.35 };
  });
}

function loja() {
  const r = montarRevelacao(document.getElementById('loja'), lote(50),
                            { nomeDe, arte, colunas: 7 });
  document.getElementById('loja-pular').onclick = () => r.revelarTudo();
  const b = document.getElementById('loja-ordem');
  const pintar = () => {
    b.textContent = r.agrupadoPorRaridade() ? 'ordem do pacote' : 'organizar por raridade';
  };
  b.onclick = () => { r.ordenar(!r.agrupadoPorRaridade()); pintar(); };
  pintar();
}
loja();
document.getElementById('loja-de-novo').onclick = loja;

const d = montarRevelacao(document.getElementById('drop'), lote(3),
                          { nomeDe, arte, colunas: 7 });
document.getElementById('drop-pular').onclick = () => d.revelarTudo();
</script>
</body></html>`;

writeFileSync(RAIZ + 'bancada-revelacao.html', html);
console.log('  bancada-revelacao.html gerado (' + (html.length / 1024).toFixed(1) + ' KB)');
console.log('  dois cliques no arquivo — sem servidor, sem login.');
