/**
 * O CONTRATO do schema de tabuleiros.
 *
 *     node web/js/boards.test.mjs
 *
 * Uma zona nova (`p0:banido` foi a última) é acrescentada em dois lugares:
 * `zoneIds()`, que a faz aparecer no editor de campo, e `defaultLayout()`, que
 * lhe dá uma posição. **Esquecer o segundo não dá erro nenhum**: todo
 * `boards/*.json` já salvo foi gravado antes de ela existir, e o backfill —
 * `backfillMissingZones` no editor, `loadActiveBoard` no duelo — copia a
 * posição do layout padrão. Sem ela, a zona fica sem posição, o elemento cai
 * sozinho em fluxo numa fileira toda absoluta e aterrissa por cima do campo.
 *
 * É esse par que este teste guarda, para toda zona de agora em diante.
 */
import { allZoneIds, zoneIds, uiZoneIds, defaultLayout, zoneGroups, isKnownZone, CANVAS, CARD_ASPECT }
  from './boards.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

const zonas = allZoneIds();
const padrao = defaultLayout().zones;

/** A caixa de uma zona no canvas. `slot` tem só largura (a altura sai da
 *  proporção da carta, como na CSS); `area` tem as duas. */
const caixa = (id) => {
  const v = padrao[id];
  const w = v.size ?? v.w;
  return { x: v.x, y: v.y, w, h: v.size ? v.size / CARD_ASPECT : v.h };
};
const encosta = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ------------------------------------------------------- o contrato ----
{
  const semPosicao = zonas.filter((z) => !padrao[z.id]).map((z) => z.id);
  t('TODA zona do schema tem posição no layout padrão (o backfill depende disto)',
    semPosicao.length === 0 || !console.log('      faltam: ' + semPosicao.join(', ')));
}

t('nenhum id se repete', new Set(zonas.map((z) => z.id)).size === zonas.length);

t('isKnownZone reconhece todas e recusa um id inventado',
  zonas.every((z) => isKnownZone(z.id)) && !isKnownZone('p0:inventada'));

t('todo id conhecido tem kind slot ou area',
  zonas.every((z) => z.kind === 'slot' || z.kind === 'area'));

// Zona fora do canvas é zona que ninguém acha no editor sem rolar atrás dela.
{
  const fora = zonas.map((z) => ({ id: z.id, c: caixa(z.id) }))
    .filter(({ c }) => c.x < 0 || c.y < 0 || c.x + c.w > CANVAS.w || c.y + c.h > CANVAS.h);
  t('nenhuma zona nasce fora do canvas',
    fora.length === 0 || !console.log('      fora: ' + fora.map((f) => f.id).join(', ')));
}

// ------------------------------------------- a zona de banimento ----
for (const p of [0, 1]) {
  t(`p${p}:banido existe no schema`, zonas.some((z) => z.id === `p${p}:banido`));
  t(`p${p}:banido tem posição padrão`, !!padrao[`p${p}:banido`]);
}

t('as banidas são um slot (tamanho de carta), não uma área',
  zonas.find((z) => z.id === 'p0:banido')?.kind === 'slot');

// Ela é a posição que TODO tabuleiro antigo vai herdar, então não pode nascer
// em cima de outra coisa — nem do cemitério, nem da fileira de monstro.
for (const p of [0, 1]) {
  const ban = caixa(`p${p}:banido`);
  const vizinhas = zonas.map((z) => z.id)
    .filter((id) => id !== `p${p}:banido` && id !== 'mid')   // `mid` cruza a fileira de propósito
    .filter((id) => encosta(ban, caixa(id)));
  t(`p${p}:banido não nasce em cima de nenhuma outra zona`,
    vizinhas.length === 0 || !console.log('      encosta em: ' + vizinhas.join(', ')));
}

// Ela acompanha a fileira de monstro do dono: é o que faz as duas pilhas
// (banidas e cemitério) ladearem a mesma linha.
for (const p of [0, 1]) {
  t(`p${p}:banido fica na mesma altura da fileira de monstro`,
    padrao[`p${p}:banido`].y === padrao[`p${p}:m0`].y);
  t(`p${p}:banido fica à esquerda da fileira`,
    padrao[`p${p}:banido`].x < padrao[`p${p}:f`].x);
}

// ------------------------------------------------- os agrupamentos ----
{
  const g = zoneGroups();
  t('as banidas entram no grupo "campo" (escala em bloco no editor)',
    g.field.includes('p0:banido') && !g.hand.includes('p0:banido'));
  t('"tudo" cobre o schema inteiro', g.all.length === zonas.length);
}

// As zonas de UI não são por jogador; as do campo são as duas metades iguais.
t('cada jogador tem o mesmo conjunto de zonas',
  zoneIds(0).map((z) => z.id.slice(3)).join() === zoneIds(1).map((z) => z.id.slice(3)).join());

t('as zonas de UI não pertencem a jogador nenhum',
  uiZoneIds().every((z) => !z.id.startsWith('p0:') && !z.id.startsWith('p1:')));

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
