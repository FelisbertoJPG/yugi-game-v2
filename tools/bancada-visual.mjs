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
// `estaVirada` e' a metade da regra da virada que nao mora no duel.html.
const posicao = readFileSync(RAIZ + 'web/js/posicao.js', 'utf8')
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
const cssVirar = bloco('virar');
// O tremor do alvo. Desde que a investida parou de ir ATE' o alvo, e' ele que
// diz que houve colisao — sem ele a bancada mostraria um golpe sem impacto.
const cssTremor = bloco('tremor');
const cssBatalha = bloco('batalha');

const jsSeta = fatia('function limparSeta() {', '  }\n}\n', 'desenharSeta');
const jsPontos = fatia('function pontosDoAtaque(a) {', '\n}\n', 'pontosDoAtaque');
const jsNum = fatia('async function voarNumeroLp(player, delta) {', '\n  el.remove();\n}', 'voarNumeroLp');
const jsFlash = fatia('function flashZone(anchor', '\n}', 'flashZone');
const jsBrilho = fatia('function brilhoDaEntrada(ev, viradaAntes) {', '  return null;\n}', 'brilhoDaEntrada');
// A VIRADA da carta em campo: a decisao (este `pos` abriu alguma coisa?) e o
// giro em si. E' o gesto mais dificil de alcancar no jogo — depende de o
// oponente ter setado um monstro e de alguem abri-lo —, e o que ele erra e'
// invisivel num teste de logica: a frente sem o `rotateY(180deg)` faz a carta
// abrir no proprio verso, e os 90 graus no elemento errado a fazem capotar de
// lado em vez de levantar.
const jsLocAnchor = fatia('function locAnchor(ctrl, loc, seq) {', '\n}', 'locAnchor');
const jsDecideVirar = fatia('function viradaDaCarta(ev, posAntes) {', '\n}', 'viradaDaCarta');
const jsVirar = fatia('async function virarNaZona(v) {', '\n}', 'virarNaZona');
// A MIRA: a seta da escolha do alvo, seguindo o mouse. O que erra CALADO aqui
// e' o CSS — as animacoes de ENTRADA da seta (o traco que cresce, a cabeca com
// 300ms de atraso, a mancha do alvo) recomecam a cada movimento do ponteiro, e
// o resultado e' uma seta piscando que nenhum teste de logica ve'. A DECISAO
// (`alvosDoAtaque`) fica de fora: ela le a pergunta do motor e nao desenha nada.
const jsRecuoCursor = fatia('/** Quanto a ponta recua do CURSOR', 'const RECUO_DO_CURSOR = 5;', 'RECUO_DO_CURSOR');
const jsMoverMira = fatia('function aoMoverMira(e) {', '\n}', 'aoMoverMira');
const jsAlvoPonteiro = fatia('function alvoSobOPonteiro(x, y) {', '\n}', 'alvoSobOPonteiro');
const jsDesenharMira = fatia('function desenharMira() {', '\n}', 'desenharMira');
const jsDicaMira = fatia('function mostrarDicaDaMira(ligar) {', '\n}', 'mostrarDicaDaMira');
// A INVESTIDA — o golpe. Ela e' o unico gesto do ataque em que uma CARTA se
// move, e o quanto ela avanca so' da' para julgar olhando: no jogo as duas
// fileiras de monstro sao vizinhas, entao um avanco grande demais poe o
// fantasma em cima da carta atacada e a leitura vira "o alvo saiu do lugar".
const jsSpawnGhost = fatia('function spawnGhost(rect, code, face) {', '\n}', 'spawnGhost');
const jsAvanco = fatia('const INVESTIDA_FRACAO = 0.34;', 'const INVESTIDA_TETO = 34;', 'INVESTIDA_*');
const jsInvestida = fatia('async function resolverInvestida() {', '\n}', 'resolverInvestida');
// A faixa da batalha e o nome da carta na zona. Ela e' o item mais visual desta
// tela — tres passos, uma frase e dois numeros —, e nenhum teste de logica diz
// se ela cabe na largura nem se o passo aceso da' para ler.
const jsNomeZona = fatia('function nomeNaZona(ctrl, seq) {', '\n}', 'nomeNaZona');
const jsFaixa = fatia('function renderBatalha() {', '  faixa.hidden = false;\n}', 'renderBatalha');

const CARD = 'width:62px;height:90px';
const zonas = (ctrl, top) => [0,1,2,3,4].map((i) =>
  `<div class="zona zone" data-anchor="${ctrl}:4:${i}" style="left:${190+i*74}px;top:${top}px;${CARD}"></div>`).join('');

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
  .back { width:100%; height:100%; box-sizing:border-box; border:1px solid #2a1c08;
          background:#0c141d url('web/assets/back_card.png') center / cover no-repeat; }
${cssFx}
${cssFlash}
${cssVirar}
${cssTremor}
${cssSeta}
${cssNum}
${cssBatalha}
  #atk-seta { position: fixed; }
</style>
<div class="hud"><div class="hud-side you" id="hud-p0">8000</div><div class="hud-side opp" id="hud-p1">8000</div></div>
<div id="hand-opp"></div><div id="hand-you"></div>
${zonas(1, 120)}
${zonas(0, 330)}
${[0,1,2,3,4].map((i) => `<div class="zona zone" data-anchor="0:8:${i}" style="left:${190+i*74}px;top:430px;${CARD}"></div>`).join('')}
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
  <button onclick="vira({type:'pos',loc:4,seq:2,controller:0,code:5053103,pos:1}, 0x8)">VIRA: deitada abre EM PE (flip)</button>
  <button onclick="vira({type:'pos',loc:4,seq:3,controller:0,code:91152256,pos:4}, 0x8)">VIRA: abre DEITADA (alvo do ataque)</button>
  <button onclick="vira({type:'pos',loc:8,seq:2,controller:0,code:5053103,pos:1}, 0x8)">VIRA: armadilha baixada (nao deita)</button>
  <button onclick="vira({type:'pos',loc:4,seq:1,controller:0,code:5053103,pos:4}, 0x1)">NAO vira: so deitou em defesa</button>
  <button onclick="vira({type:'pos',loc:4,seq:1,controller:0,code:0,pos:8}, 0x2)">NAO vira: virada continua virada</button>
  <button onclick="investida({atkCtrl:1,atkSeq:1,defCtrl:0,defSeq:2,direct:false})">INVESTIDA: NPC bate no seu (olhe o ALVO)</button>
  <button onclick="investida({atkCtrl:0,atkSeq:2,defCtrl:1,defSeq:1,direct:false})">INVESTIDA: voce bate no dele</button>
  <button onclick="investida({atkCtrl:0,atkSeq:2,defCtrl:1,defSeq:0,direct:true})">INVESTIDA: ataque direto</button>
  <button onclick="mirar(0, ['1:4:1','1:4:2','1:4:4'])">MIRA: 3 alvos (mexa o mouse)</button>
  <button onclick="mirar(2, ['1:4:1'])">MIRA: 1 alvo so</button>
  <button onclick="pararMira()">MIRA: sai</button>
</div>
<script>
${seta}
${batalha}
${posicao}
const $ = (id) => document.getElementById(id);
const prefersReduced = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const elDaAncora = (a) => a ? document.querySelector('[data-anchor="' + a + '"]') : null;
function anchorRect(a) { const el = elDaAncora(a); if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; }
function containerRect(id) { const el = document.getElementById(id); const r = el && el.getBoundingClientRect(); return r && r.width ? r : null; }
let ataquePendente = null;
let mira = null;
// Duas cartas de mentira nas zonas que os botoes usam, para a faixa ter nome
// que mostrar (a de baixo e' a atacada no ataque "NPC ataca voce").
const field = {
  0: { m: [null, null, { code: 5053103, pos: 0x1 }, null, null] },
  1: { m: [null, { code: 91152256, pos: 0x4 }, null, null, null] },
};
// O locAnchor fatiado cita a zona de banidas; sem a constante, qualquer loc
// fora dos quatro primeiros ramos estouraria um ReferenceError no meio de uma
// funcao que so devia devolver null.
const LOCATION_BANIDO = 0x20;
const ART = (id) => 'https://images.ygoprodeck.com/images/cards_small/' + id + '.jpg';
const NOMES = { 5053103: 'Battle Ox', 91152256: 'Celtic Guardian' };
const nameOf = (id) => NOMES[id] || String(id);
let etapaDaBatalha = null, ataqueAtual = null, calculoNaTela = null;

${jsPontos}
${jsSeta}
${jsNum}
${jsFlash}
${jsBrilho}
${jsLocAnchor}
${jsDecideVirar}
${jsVirar}
${jsRecuoCursor}
${jsDicaMira}
${jsAlvoPonteiro}
${jsDesenharMira}
${jsMoverMira}
${jsSpawnGhost}
${jsAvanco}
${jsInvestida}
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

// As duas linhas do animateEvent para o pos, na ordem em que ele as roda.
// A posicao anterior chega pelo botao porque aqui nao ha estado de duelo — no
// jogo ela e' lida da zona, que ainda nao foi mutada.
async function vira(ev, posAntes) {
  const v = viradaDaCarta(ev, posAntes);
  console.log(ev.type, 'loc', ev.loc, 'pos', ev.pos, 'antes', posAntes,
              '->', v ? 'VIRA ' + v.anchor : 'nao vira');
  await virarNaZona(v);
}
window.vira = vira;

// A INVESTIDA. Olhe a carta ATACADA, e nao o atacante: o defeito que fez esta
// funcao mudar era so' visivel dali — o fantasma pousava em cima dela e depois
// ia embora para o lado de quem atacou, e o que se lia era "a carta atacada saiu
// da zona". Com o NPC atacando, "ir embora" e' para cima, na direcao da mao dele.
async function investida(a) {
  ataquePendente = a;
  await resolverInvestida();
}
window.investida = investida;

// A mira, sem a pergunta do motor: os alvos entram na mao porque quem os
// escolhe (alvosDoAtaque) le o SELECT_CARD, e aqui nao ha duelo nenhum. O
// que esta em jogo e o traco — mexa o mouse entre os quadros de cima.
function mirar(atkSeq, ancoras) {
  pararMira();
  mira = { atacante: '0:4:' + atkSeq, alvos: new Map(ancoras.map((a) => [a, {}])),
           alvo: ancoras[0], ponto: null };
  document.addEventListener('mousemove', aoMoverMira, { passive: true });
  mostrarDicaDaMira(true);
  desenharMira();
}
function pararMira() {
  if (!mira) return;
  document.removeEventListener('mousemove', aoMoverMira);
  for (const z of document.querySelectorAll('.zone.mira-alvo')) z.classList.remove('mira-alvo');
  mira = null;
  mostrarDicaDaMira(false);
  limparSeta();
}
window.mirar = mirar; window.pararMira = pararMira;

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
