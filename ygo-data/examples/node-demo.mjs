/**
 * Demonstra (e valida) a API do banco local rodando em Node.
 *   node examples/node-demo.mjs
 */
import { YgoDB } from '../src/ygodb.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const db = await YgoDB.loadFromDisk(dataDir);

const h = (s) => console.log(`\n\x1b[36m=== ${s} ===\x1b[0m`);

h('meta');
console.log(`cartas: ${db.size}  |  gerado em: ${db.meta.generatedAt}`);
console.log(db.meta.counts.byCardType);

h('busca por nome');
for (const c of db.search('blue-eyes', { limit: 5 })) {
  console.log(`  ${c.id}  ${c.name.padEnd(38)} ${c.tl}`);
}

h('carta completa');
const bewd = db.byName('Blue-Eyes White Dragon');
console.log(`  ${bewd.name} — ${bewd.typeLabel}`);
console.log(`  ${bewd.attribute} / ${bewd.race} / ${bewd.levelLabel} ${bewd.level}`);
console.log(`  ATK ${bewd.atkLabel} / DEF ${bewd.defLabel}`);
console.log(`  arquétipos: ${bewd.archetypes.map((a) => a.name).join(', ')}`);
console.log(`  script lua: ${db.scriptPath(bewd.id) ?? '(vanilla, não tem)'}`);
console.log(`  arte: ${YgoDB.artUrl(bewd.id)}`);

h('link monster (markers vêm do campo def)');
const decode = db.byName('Decode Talker');
console.log(`  ${decode.name} — ${decode.typeLabel}`);
console.log(`  LINK-${decode.level}  markers: ${decode.linkArrows.join(' ')}`);
console.log(`  script: ${db.scriptPath(decode.id)}`);

h('pendulum (escalas vêm empacotadas no campo level)');
const odd = db.byName('Odd-Eyes Pendulum Dragon');
console.log(`  ${odd.name} — escalas ${odd.scales.left}/${odd.scales.right}, nível ${odd.level}`);

h('filtro estruturado');
const dragons = db.filter({ cardType: 'Monster', race: 'Dragon', attribute: 'LIGHT', levelMin: 8 });
console.log(`  dragões LIGHT nível 8+: ${dragons.length}`);
for (const c of dragons.slice(0, 5)) console.log(`    ${c.name} (ATK ${c.atk})`);

h('arquétipo inteiro');
const hero = db.archetype('Blue Eyes');
console.log(`  cartas "Blue Eyes": ${hero.length}`);

h('pool aleatório — base para recompensa de NPC');
for (const c of db.random(5, { cardType: 'Monster', levelMax: 4, atkMin: 1500 })) {
  console.log(`    ${c.name.padEnd(38)} ATK ${c.atk} / nv ${c.lv}`);
}

h('sanidade');
const checks = [
  ['todas as cartas têm nome', db.filter({}).every((c) => c.name)],
  ['índice bate com meta', db.size === db.meta.counts.cards],
  ['Blue-Eyes é vanilla (sem script)', db.scriptPath(89631139) === null],
  ['Monster Reborn tem script', db.scriptPath(83764718) !== null],
  ['link monster não tem DEF', decode.def === null],
];
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFALHA\x1b[0m'} ${label}`);
}
if (!checks.every(([, ok]) => ok)) process.exitCode = 1;
