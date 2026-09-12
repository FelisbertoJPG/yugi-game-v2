/**
 * **A DEFESA ESPERADA de uma carta virada** — `node web/js/defesavirada.test.mjs`.
 *
 * O NPC decide se bate num monstro setado por uma conta que qualquer jogador faz
 * de cabeça: *"ele só SETOU, então é nível ≤4, então tem no máximo tanto de
 * defesa"*. Os números moram em `NpcBrain.cs`, e este arquivo existe porque eles
 * **envelhecem calados**.
 *
 * **Eles não são um TETO — são uma APOSTA, e a diferença é a feature inteira.**
 * O pior caso do pool para nível ≤4 é 2400; apostar no pior caso é voltar ao
 * medo que originou tudo isto (*"ele está com medo de bater em qualquer card meu
 * em def"*), porque um deck de 40 a 60 leva no máximo três cópias de um muro e a
 * chance de ser justamente ele é pequena. Então a aposta fica ABAIXO do pior
 * caso de propósito, e quem a fura é **contado** aqui — o risco é medido, não
 * ignorado.
 *
 * Nada de número copiado: as apostas são LIDAS do fonte em C# e conferidas
 * contra o pool publicado. É a mesma escolha do `vivo.test.mjs`, que lê a
 * `JANELA_VIVO` do C# — dois números escritos à mão em linguagens diferentes se
 * desencontram no primeiro ajuste.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let n = 0;
const teste = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..');
const cs = readFileSync(join(raiz, 'duel-server', 'src', 'NpcBrain.cs'), 'utf8');

function constanteDoCs(nome) {
  const m = new RegExp(`const int ${nome}\\s*=\\s*(\\d+)`).exec(cs);
  assert.ok(m, `não achei a constante ${nome} em NpcBrain.cs`);
  return Number(m[1]);
}

const APOSTA = {
  '<=4': constanteDoCs('APOSTA_DEF_ATE_NV4'),
  '5-6': constanteDoCs('APOSTA_DEF_NV5_6'),
  '>=7': constanteDoCs('APOSTA_DEF_NV7_MAIS'),
};

console.log('defesa esperada de uma carta virada');

teste('as faixas SOBEM: mais tributo nunca pode valer menos', () => {
  assert.ok(APOSTA['<=4'] <= APOSTA['5-6']);
  assert.ok(APOSTA['5-6'] <= APOSTA['>=7']);
});

teste('a faixa de nível é a mesma dos dois lados (≤4, 5-6, ≥7)', () => {
  // Se o corte mudar de um lado só, a medição abaixo passa a provar outra coisa.
  const inter = readFileSync(join(raiz, 'duel-server', 'src', 'InteractiveDuel.cs'), 'utf8');
  assert.match(inter, /nivel <= 4 \? 4 : nivel <= 6 \? 6 : 12/);
});

teste('a memória do que foi VISTO vence a aposta', () => {
  // É o pedido: *"se ele viu eu adicionar um 2000 de def, então o setado tem
  // quase 100% de chance de ser ele"*. Sem esta linha o NPC continuaria
  // apostando contra uma carta que ele viu entrar na mão.
  assert.match(cs, /int DefesaEsperadaDoVirado\(int foe, int nivelMax\)/);
  assert.match(cs, /_vistosNaMao\(foe\)/);
  assert.match(cs, /return visto > aposta \? visto : aposta;/);
  // E só conta o que CABE na faixa: um Nv7 na mão não explica um set sem tributo.
  assert.match(cs, /if \(st\.Level > nivelMax\) continue;/);
});

// ------------------------------------------------- a medição contra o pool
let cl;
try {
  cl = JSON.parse(readFileSync(join(raiz, 'dist', 'release', 'cardlists.json'), 'utf8')).listas[0];
} catch {
  console.log('  -- sem dist/release/cardlists.json (rode `npm run release:build`): pulando a medição');
  console.log(`\n${n} testes ok`);
  process.exit(0);
}

const idx = JSON.parse(readFileSync(join(raiz, 'ygo-data', 'data', 'cards.index.json'), 'utf8'));
const dentro = new Set(cl.ids);
const tiposPorRegra = cl.tipos ?? [];
const noPool = (c) => dentro.has(c.id) || tiposPorRegra.includes(c.tl);
/** Só o que pode ser SETADO da mão: monstro de Main Deck. */
const doMain = (c) => c.t === 'M'
  && !/\b(Fusion|Synchro|Xyz|Link)\b/.test(c.tl ?? '')
  && !/Token/.test(c.name ?? '');
const faixa = (lv) => (lv <= 4 ? '<=4' : lv <= 6 ? '5-6' : '>=7');

const total = {}, furam = {}, maior = {}, pior = {};
for (const c of idx) {
  if (!doMain(c) || !noPool(c)) continue;
  if (!Number.isInteger(c.lv) || c.lv < 1 || !Number.isInteger(c.def)) continue;
  const f = faixa(c.lv);
  total[f] = (total[f] ?? 0) + 1;
  if (c.def > APOSTA[f]) furam[f] = (furam[f] ?? 0) + 1;
  if (!(f in maior) || c.def > maior[f]) { maior[f] = c.def; pior[f] = `${c.name} Nv${c.lv}`; }
}

teste('a aposta é ARRISCADA de propósito — mas o risco é pequeno e medido', () => {
  for (const f of ['<=4', '5-6', '>=7']) {
    const q = furam[f] ?? 0, t = total[f];
    const pct = (100 * q) / t;
    console.log(`     ${f.padEnd(5)} aposta ${String(APOSTA[f]).padStart(4)}`
              + ` — ${String(q).padStart(3)} de ${String(t).padStart(3)} cartas a furam`
              + ` (${pct.toFixed(1)}%) · pior caso ${maior[f]} (${pior[f]})`);
    // O teto de risco é editorial: acima de 10% do pool a "aposta" deixa de ser
    // aposta e vira ignorar o adversário — o NPC passaria a se jogar contra
    // paredes com frequência que dá para sentir jogando.
    assert.ok(pct <= 10,
      `faixa ${f}: ${q} de ${t} cartas (${pct.toFixed(1)}%) furam a aposta de ${APOSTA[f]}. `
      + `Isso deixou de ser risco calculado — suba a constante em NpcBrain.cs.`);
  }
});

teste('a aposta não voltou a ser um TETO — senão o medo volta junto', () => {
  // Se ela alcançar o pior caso do pool, o NPC para de arriscar: é literalmente
  // o comportamento que esta feature veio tirar. Uma faixa em que a aposta
  // iguala o pior caso ainda é aceitável (pode não haver folga no pool); as
  // três, não.
  const colada = ['<=4', '5-6', '>=7'].filter((f) => APOSTA[f] >= maior[f]);
  assert.ok(colada.length < 3,
    'as três faixas apostam no PIOR caso do pool — isso é o teto de novo, e com ele '
    + 'o NPC volta a não atacar carta virada nenhuma');
});

console.log(`\n${n} testes ok`);
