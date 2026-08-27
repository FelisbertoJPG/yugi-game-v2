// Bancada visual: roda as funções DE VERDADE do duel.html num quadro de mentira.
// Elas são FATIADAS do arquivo, não copiadas — uma cópia passaria a valer por si
// e deixaria de provar o que está no jogo. Foi assim que o `svg.hidden = false`
// (que não existe em SVGElement) passou batido: os testes de geometria passavam
// e a seta nunca aparecia.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A raiz sai do lugar do proprio arquivo: caminho absoluto de uma maquina so'
// funciona nela, e este gerador e' para quem for depurar a tela depois.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const html = readFileSync(RAIZ + 'web/duel.html', 'utf8');
const seta = readFileSync(RAIZ + 'web/js/setaataque.js', 'utf8')
  .replace(/^export /gm, '');   // sem módulos: file:// não carrega import
const batalha = readFileSync(RAIZ + 'web/js/batalha.js', 'utf8')
  .replace(/^export /gm, '');

/** Fatia um bloco do arquivo entre dois marcadores, incluindo os dois. */
function fatia(de, ate, nome) {
  const i = html.indexOf(de);
  const j = html.indexOf(ate, i);
  if (i < 0 || j < 0) throw new Error(`não achei o bloco: ${nome}`);
  return html.slice(i, j + ate.length);
}

// Os quatro blocos de CSS saem por SENTINELA (`/* [bancada:x] --- inicio --- */`
// no duel.html), e nao por um trecho de codigo qualquer: recortar por codigo
// quebra no primeiro ajuste de estilo, e quebrou duas vezes antes disto.
function bloco(nome) {
  const ini = `[bancada:${nome}] --- inicio ---`;
  const fim = `[bancada:${nome}] --- fim ---`;
  const i = html.indexOf(ini), j = html.indexOf(fim, i);
  if (i < 0 || j < 0) throw new Error(`nao achei as sentinelas de ${nome} no duel.html`);
  return html.slice(html.indexOf('*/', i) + 2, j - 3);
}

const cssSeta = bloco('seta');
const cssNum = bloco('lp');
const cssFx = bloco('fx');
const cssFlash = bloco('brilho');
const cssBatalha = bloco('batalha');

const jsSeta = fatia('function limparSeta() {', '  }\n}\n', 'desenharSeta');
const jsPontos = fatia('function pontosDoAtaque(a) {', '\n}\n', 'pontosDoAtaque');
const jsNum = fatia('async function voarNumeroLp(player, delta) {', '\n  el.remove();\n}', 'voarNumeroLp');
const jsFlash = fatia('function flashZone(anchor', '\n}', 'flashZone');
const jsBrilho = fatia('function brilhoDaEntrada(ev, viradaAntes) {', '  return null;\n}', 'brilhoDaEntrada');
// A faixa da batalha e o nome da carta na zona. Ela e' o item mais visual desta
// tela — tres passos, uma frase e dois numeros —, e nenhum teste de logica diz
// se ela cabe na largura nem se o passo aceso da' para ler.
const jsNomeZona = fatia('function nomeNaZona(ctrl, seq) {', '\n}', 'nomeNaZona');
const jsFaixa = fatia('function renderBatalha() {', '  faixa.hidden = false;\n}', 'renderBatalha');

const CARD = 'width:62px;height:90px';
const zonas = (ctrl, top) => [0,1,2,3,4].map((i) =>
  `<div class="zona" data-anchor="${ctrl}:4:${i}" style="left:${190+i*74}px;top:${top}px;${CARD}"></div>`).join('');

writeFileSync(join(RAIZ, 'bancada.html'), `<!doctype html><meta charset="utf-8"><title>bancada</title>
<style>
  :root { --red:#e2554f; --gold:#e8c46a; --green:#5fd48a; --line:#38425f; --panel:#141a2b;
          --panel2:#1b2338; --ink:#dfe6f7; --dim:#8792ad; }
  body { margin:0; background:#0a0f1c; color:#c8d0e6; font:13px ui-monospace,monospace; height:100vh; overflow:hidden; }
  .hud { display:flex; border-bottom:2px solid var(--line); background:var(--panel); }
  .hud-side { flex:1; padding:6px 14px; font:700 21px/1 ui-monospace,monospace; color:var(--gold); }
  .hud-side.opp { text-align:right; color:#f0a0a8; }
  #hand-opp, #hand-you { position:absolute; left:190px; width:380px; height:40px; border:1px dashed #3a4560; }
  #hand-opp { top:16px; } #hand-you { top:520px; }
  .zona { position:absolute; border:2px solid var(--line); background:linear-gradient(160deg,#2a3450,#161c2e); }
  .barra { position:fixed; bottom:8px; left:8px; display:flex; gap:6px; z-index:99; }
  button { background:var(--panel2); color:var(--ink); border:1px solid var(--line); padding:6px 10px; font:12px ui-monospace,monospace; cursor:pointer; }
${cssFx}
${cssFlash}
${cssSeta}
${cssNum}
${cssBatalha}
  #atk-seta { position: fixed; }
</style>
<div class="hud"><div class="hud-side you" id="hud-p0">8000</div><div class="hud-side opp" id="hud-p1">8000</div></div>
<div id="hand-opp"></div><div id="hand-you"></div>
${zonas(1, 120)}
${zonas(0, 330)}
${[0,1,2,3,4].map((i) => `<div class="zona" data-anchor="0:8:${i}" style="left:${190+i*74}px;top:430px;${CARD}"></div>`).join('')}
<div id="fx"></div>
<svg id="atk-seta" hidden aria-hidden="true"></svg>
<div id="bat-faixa" hidden></div>
<div class="barra">
  <button onclick="cena({atkCtrl:1,atkSeq:1,defCtrl:0,defSeq:2,direct:false})">NPC ataca voce</button>
  <button onclick="cena({atkCtrl:0,atkSeq:0,defCtrl:1,defSeq:4,direct:false})">voce ataca NPC</button>
  <button onclick="cena({atkCtrl:1,atkSeq:0,defCtrl:0,defSeq:0,direct:true})">ataque direto</button>
  <button onclick="momento('declaracao')">1. declaracao</button>
  <button onclick="momento('dano')">2. etapa de dano</button>
  <button onclick="momento('calculo', {posDoAlvo:0x4})">3. calculo (alvo DEITADO)</button>
  <button onclick="momento('calculo', {posDoAlvo:0x1})">3. calculo (alvo de pe)</button>
  <button onclick="momento('anulado')">ataque anulado</button>
  <button onclick="momento(null)">acabou</button>
  <button onclick="voarNumeroLp(0,-1800)">dano 1800</button>
  <button onclick="voarNumeroLp(1,+300)">cura 300</button>
  <button onclick="entrada({type:'move',loc:4,seq:2,controller:0,code:1,pos:1})">monstro entra (ATAQUE)</button>
  <button onclick="entrada({type:'move',loc:4,seq:3,controller:0,code:0,pos:8})">entra VIRADO (nao acende)</button>
  <button onclick="entrada({type:'pos',loc:4,seq:1,controller:0,code:1,pos:1}, true)">virou pra cima (flip)</button>
  <button onclick="entrada({type:'pos',loc:4,seq:0,controller:0,code:1,pos:4}, false)">deitou em defesa (nao acende)</button>
  <button onclick="entrada({type:'move',loc:8,seq:1,controller:0,code:1,pos:1})">magia ativada</button>
</div>
<script>
${seta}
${batalha}
const $ = (id) => document.getElementById(id);
const prefersReduced = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const elDaAncora = (a) => a ? document.querySelector('[data-anchor="' + a + '"]') : null;
function anchorRect(a) { const el = elDaAncora(a); if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; }
function containerRect(id) { const el = document.getElementById(id); const r = el && el.getBoundingClientRect(); return r && r.width ? r : null; }
let ataquePendente = null;
// Duas cartas de mentira nas zonas que os botoes usam, para a faixa ter nome
// que mostrar (a de baixo e' a atacada no ataque "NPC ataca voce").
const field = {
  0: { m: [null, null, { code: 5053103, pos: 0x1 }, null, null] },
  1: { m: [null, { code: 91152256, pos: 0x4 }, null, null, null] },
};
const NOMES = { 5053103: 'Battle Ox', 91152256: 'Celtic Guardian' };
const nameOf = (id) => NOMES[id] || String(id);
let etapaDaBatalha = null, ataqueAtual = null, calculoNaTela = null;

${jsPontos}
${jsSeta}
${jsNum}
${jsFlash}
${jsBrilho}
${jsNomeZona}
${jsFaixa}

// As DUAS linhas do laco de eventos do apply(), na ordem em que ele as roda.
// Assim o botao prova a DECISAO (quem acende e quem nao acende), e nao so' o
// efeito visual de quem ja' foi decidido.
async function entrada(ev, viradaAntes = false) {
  const b = brilhoDaEntrada(ev, viradaAntes);
  console.log(ev.type, 'loc', ev.loc, 'pos', ev.pos, '->', b ? 'ACENDE ' + b.anchor : 'nao acende');
  if (b) { flashZone(b.anchor); await sleep(b.ms); }
}
window.entrada = entrada;

function cena(a) {
  ataquePendente = a; ataqueAtual = a;
  desenharSeta();
  if (!etapaDaBatalha) etapaDaBatalha = 'declaracao';
  renderBatalha();
}

// O MSG_BATTLE de mentira e a mesma conta do jogo (calculoDaBatalha): o botao
// do alvo DEITADO existe porque e' ali que a leitura errada aparece — o motor
// manda ATK e DEF dos dois lados sempre, e quem escolhe qual vale e' a posicao.
const COLISAO = { atkAtk: 1700, atkDef: 1000, defAtk: 1400, defDef: 1200, defDestroyed: true };
function momento(m, { posDoAlvo = 0x1 } = {}) {
  etapaDaBatalha = m;
  calculoNaTela = m === 'calculo'
    ? calculoDaBatalha(COLISAO, { posDoAlvo, direto: !!(ataqueAtual && ataqueAtual.direct) })
    : null;
  renderBatalha();
}
window.cena = cena; window.momento = momento;
window.voarNumeroLp = voarNumeroLp; window.flashZone = flashZone;
</script>
`);
console.log('bancada.html gerado');
