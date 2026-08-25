/**
 * A ECONOMIA DO PACOTE: o front promete o que o servidor cumpre?
 *   node web/js/economia.test.mjs
 *
 * Os mesmos números vivem em DOIS lugares, e é assim de propósito:
 *
 *   • `eco_const()` no banco — quem SORTEIA. É a verdade.
 *   • `PACK_ODDS`, `PITY_EVERY`, `UR_PITY_PACKS`, `PACK_SIZE` no front — o que a
 *     Loja PROMETE na tela (a porcentagem de cada gaveta, a barra "7/10", o
 *     "★ próximo pacote garantido").
 *
 * O front não pode simplesmente perguntar ao servidor a cada card desenhado, e o
 * servidor não pode importar JavaScript. Então eles são copiados — e cópia
 * diverge. Quando divergem, o estrago é **calado e do pior tipo**: a barra diz
 * "faltam 3 para a SR garantida" e ela vem no oitavo; a tela promete 5% de UR e o
 * sorteio dá 1%. Ninguém recebe erro, ninguém vê log, e quem joga só sente que o
 * jogo mente.
 *
 * Este teste lê os DOIS lados dos arquivos e compara. O lado do banco vem da
 * migration mais recente que define `eco_const` — o mesmo truque de
 * `vivo.test.mjs`, que lê a `JANELA_VIVO` do fonte em C# em vez de copiar o
 * número para dentro do teste. Copiá-lo aqui criaria uma TERCEIRA cópia, e o
 * teste passaria a concordar consigo mesmo enquanto o jogo erra.
 *
 * O que ele NÃO prova: que o `eco_const()` aplicado no banco é igual ao da
 * migration. Isso é do domínio do deploy — mas uma migration é o registro do que
 * foi aplicado, e ela ficando para trás já é o defeito que este teste acusa.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..', '..');

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ------------------------------------------------------- o lado do servidor

/** A migration mais recente que (re)define `eco_const`. */
function migrationDaEconomia() {
  const dir = path.join(RAIZ, 'supabase', 'migrations');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of [...arquivos].reverse()) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/create\s+or\s+replace\s+function\s+public\.eco_const/i.test(txt)) {
      return { nome: f, txt };
    }
  }
  throw new Error('nenhuma migration define eco_const');
}

const { nome: arquivoSql, txt: sql } = migrationDaEconomia();

/** Um `'chave', <numero>` do jsonb_build_object. */
function num(chave) {
  const m = sql.match(new RegExp(`'${chave}'\\s*,\\s*(\\d+)`));
  if (!m) throw new Error(`nao achei '${chave}' em ${arquivoSql}`);
  return Number(m[1]);
}

/** Os pesos do `jsonb_build_object('N', .., 'R', .., 'SR', .., 'UR', ..)`. */
function odds() {
  const bloco = sql.match(/'odds'\s*,\s*jsonb_build_object\(([^)]*)\)/);
  if (!bloco) throw new Error(`nao achei 'odds' em ${arquivoSql}`);
  const out = {};
  for (const [, k, v] of bloco[1].matchAll(/'(N|R|SR|UR)'\s*,\s*(\d+)/g)) out[k] = Number(v);
  return out;
}

const SERVIDOR = {
  odds: odds(),
  pack_size: num('pack_size'),
  pity_every: num('pity_every'),
  ur_pity_packs: num('ur_pity_packs'),
};

// ---------------------------------------------------------- o lado do front
// Lidos do FONTE e não por `import`: `boosters.js` usa caminhos absolutos
// (`/web/js/...`), que o navegador resolve e o Node não.
function constDoFonte(arquivo, nome) {
  const txt = fs.readFileSync(path.join(AQUI, arquivo), 'utf8');
  const m = txt.match(new RegExp(`export const ${nome}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error(`nao achei ${nome} em ${arquivo}`);
  return JSON.parse(m[1].trim().replace(/(\w+)\s*:/g, '"$1":').replace(/'/g, '"'));
}

const FRONT = {
  odds: constDoFonte('pacote.js', 'PACK_ODDS'),
  pack_size: constDoFonte('boosters.js', 'PACK_SIZE'),
  pity_every: constDoFonte('boosters.js', 'PITY_EVERY'),
  ur_pity_packs: constDoFonte('boosters.js', 'UR_PITY_PACKS'),
};

// ------------------------------------------------------------------ provas

console.log(`  (servidor lido de ${arquivoSql})\n`);

t('os PESOS do front são os do servidor', () => {
  assert.deepEqual(FRONT.odds, SERVIDOR.odds,
    'a Loja mostraria uma chance que o sorteio nao cumpre');
});

t('os pesos somam 1000', () => {
  const soma = Object.values(SERVIDOR.odds).reduce((a, b) => a + b, 0);
  assert.equal(soma, 1000, `somam ${soma}: o sorteio rola 0..999, entao o que passa de 1000 e' inalcancavel e o que falta cai no ultimo`);
});

t('cartas por pacote', () => assert.equal(FRONT.pack_size, SERVIDOR.pack_size));

t('a SR garantida é a cada os MESMOS pacotes', () => {
  assert.equal(FRONT.pity_every, SERVIDOR.pity_every,
    'a barra "x/N" contaria ate\' um numero diferente do que dispara a garantia');
});

t('a UR garantida também', () => {
  assert.equal(FRONT.ur_pity_packs, SERVIDOR.ur_pity_packs);
});

t('as duas garantias NÃO disputam a mesma carta', () => {
  // Com SR a cada 10 e UR a cada 20, todo multiplo de 20 dispara as duas. Elas
  // ocupam cartas diferentes no pacote (UR na 1, SR na 2) — sem isso, a UR
  // vencia o `elsif` e a SR garantida sumia calada, e o jogador perdia uma
  // garantia sem nunca saber que ela existiu.
  const colidem = SERVIDOR.ur_pity_packs % SERVIDOR.pity_every === 0
                || SERVIDOR.pity_every % SERVIDOR.ur_pity_packs === 0;
  if (!colidem) return;                       // nao colidem: nada a provar
  assert.match(sql, /slot_sr|when garante_ur then 2/,
    'os ciclos coincidem e o SQL nao separa os slots — a SR garantida sera engolida pela UR');
  assert.ok(SERVIDOR.pack_size >= 2, 'com 1 carta por pacote as duas nao cabem');
});

t('o piso da UR não é mais medido em DP', () => {
  // `ur_pity_dp` era um alvo movel: mudar o preco de um booster mudava a
  // promessa sem ninguem tocar nela.
  assert.doesNotMatch(sql, /'ur_pity_dp'/,
    'voltou o piso por DP — ele muda de significado quando os precos mudam');
});

// ------------------------------------------------------- o que isso vira na mão
// Nao e' asercao: e' o relatorio que se quer ler ao mexer nos numeros.
const p = (peso) => 1 - (1 - peso / 1000) ** SERVIDOR.pack_size;
console.log('\n  por pacote de ' + SERVIDOR.pack_size + ' cartas:');
for (const r of ['UR', 'SR']) {
  const q = p(SERVIDOR.odds[r]);
  console.log(`    ${r}: ${(SERVIDOR.odds[r] / 10).toFixed(1)}%/carta`
    + ` → ${(q * 100).toFixed(2)}%/pacote → 1 a cada ${(1 / q).toFixed(1)} pacotes`);
}
const semUr = (1 - p(SERVIDOR.odds.UR)) ** SERVIDOR.ur_pity_packs;
console.log(`    o piso de ${SERVIDOR.ur_pity_packs} pacotes dispara em ${(semUr * 100).toFixed(2)}% dos casos`);

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
