/**
 * Testes de PARA ONDE A CARTA FOI — `node web/js/movimento.test.mjs`.
 *
 * O relato: *"a carta escolhida simplesmente desaparece da zona, sem animação
 * nenhuma — parece que foi para a mão do oponente"*. E era isso mesmo: a MÃO
 * não é uma zona, não tinha âncora, e `flyGhost` desiste em silêncio sem
 * destino (`if (!from || !to) return`). A carta devolvida à mão saía da mesa
 * entre dois quadros de vídeo e reaparecia como um número maior na contagem da
 * mão do outro lado. O estado sempre esteve certo; faltava o desenho.
 *
 * Por isso o teste que mais vale aqui é uma VARREDURA: toda localização que o
 * motor sabe mandar tem de ter um lugar na tela. Foi uma localização legítima e
 * não mapeada que abriu o buraco, e o buraco não acusa nada — nenhum erro,
 * nenhum log, só uma carta que some.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lugarDaCarta, ancoraDaCarta, LOCALIZACOES, FZONE } from './movimento.js';
import { LOCAL } from './alvos.js';

let n = 0;
const teste = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log('movimento.js');

teste('TODA localização do motor tem um lugar na tela (a varredura)', () => {
  for (const loc of LOCALIZACOES) {
    for (const ctrl of [0, 1]) {
      const l = lugarDaCarta(ctrl, loc, 0);
      assert.ok(l, `localização ${loc} (0x${loc.toString(16)}) ficou sem lugar`);
      assert.ok(l.tipo === 'ancora' ? l.ancora : l.caixa, `lugar vazio em ${loc}`);
    }
  }
});

teste('a MÃO é as DUAS metades do defeito: existe, e não é uma zona', () => {
  // Existe: é o que faltava, e sem ela a carta sumia sem movimento.
  assert.deepEqual(lugarDaCarta(0, LOCAL.MAO), { tipo: 'mao', caixa: 'hand-you' });
  assert.deepEqual(lugarDaCarta(1, LOCAL.MAO), { tipo: 'mao', caixa: 'hand-opp' });
  // E não é zona: quem só sabe apontar para uma âncora tem de receber `null`,
  // em vez de uma âncora inventada que não existe no documento.
  assert.equal(ancoraDaCarta(0, LOCAL.MAO), null);
});

teste('o EXTRA também estava fora do mapa', () => {
  assert.equal(ancoraDaCarta(0, LOCAL.EXTRA), '0:extra');
  assert.equal(ancoraDaCarta(1, LOCAL.EXTRA), '1:extra');
});

teste('as âncoras são as MESMAS que as zonas escrevem no data-anchor', () => {
  assert.equal(ancoraDaCarta(0, LOCAL.MZONE, 2), '0:4:2');
  assert.equal(ancoraDaCarta(1, LOCAL.SZONE, 3), '1:8:3');
  assert.equal(ancoraDaCarta(0, LOCAL.CEMITERIO), '0:gy');
  assert.equal(ancoraDaCarta(1, LOCAL.BANIDA), '1:banido');
  assert.equal(ancoraDaCarta(1, LOCAL.DECK), '1:deck');
});

teste('a zona de CAMPO chega por dois caminhos e aterrissa no mesmo lugar', () => {
  // `SZONE` com sequência 5 é como o motor a LISTA; `0x100` é como ele a nomeia
  // num evento de movimento. As duas formas existem, e a tela desenha uma só.
  assert.equal(ancoraDaCarta(0, LOCAL.SZONE, 5), '0:8:5');
  assert.equal(ancoraDaCarta(0, FZONE), '0:8:5');
});

teste('controller que não é 0 é o outro lado — nunca um terceiro campo', () => {
  assert.equal(ancoraDaCarta(1, LOCAL.CEMITERIO), '1:gy');
  assert.equal(ancoraDaCarta(2, LOCAL.CEMITERIO), '1:gy');
  assert.equal(ancoraDaCarta('1', LOCAL.CEMITERIO), '1:gy');
  assert.equal(ancoraDaCarta(0, LOCAL.CEMITERIO), '0:gy');
});

teste('localização que não existe devolve null — e null tem consequência', () => {
  assert.equal(lugarDaCarta(0, 0), null);
  assert.equal(lugarDaCarta(0, 0x999), null);
});

// -------------------------------------------- o que a tela faz com isso
const aqui = dirname(fileURLToPath(import.meta.url));
const duel = readFileSync(join(aqui, '..', 'duel.html'), 'utf8');

teste('sem destino, a tela faz a carta SUMIR NO LUGAR (nunca nada)', () => {
  // `flyGhost` continua desistindo sem `to` — e tem de continuar, é ela que
  // protege contra o `NaN` no transform. Quem fecha o buraco é o `else`: sem
  // ele a carta volta a desaparecer entre dois quadros, calada, e é isso que
  // quem olha lê como "foi para a mão do oponente".
  assert.match(duel, /if \(to\) await flyGhost\(from, to, ev\.code, face, 300, endScale\);/);
  assert.match(duel, /else await sumirGhost\(from, ev\.code, face\);/);
  assert.match(duel, /async function sumirGhost\(/);
});

teste('a tela usa o módulo — a regra não voltou a morar dentro do duel.html', () => {
  assert.match(duel, /from '\/web\/js\/movimento\.js'/);
  assert.match(duel, /rectDoLugar\(lugarDaCarta\(ev\.controller, ev\.loc, ev\.seq\), from\)/);
  // A compra passou a usar a MESMA conta do meio da fileira. Duas contas para o
  // mesmo ponto se desencontram no primeiro ajuste, e o sintoma seria a carta
  // comprada e a carta devolvida aterrissando em lugares diferentes da mão.
  assert.match(duel, /rectDoLugar\(lugarDaCarta\(ev\.player, LOCAL\.MAO\), from\)/);
});

console.log(`\n${n} testes ok`);
