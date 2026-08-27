/**
 * Testes dos MOMENTOS DO ATAQUE.
 *   node web/js/batalha.test.mjs
 *
 * O relato: *"a fase de batalha e a etapa de dano não estão bem definidas — no
 * Yu-Gi-Oh o fluxo é declarar o ataque, escolher quem ataca e em quem, virar o
 * monstro que estava com a face para baixo, abrir uma janela de respostas,
 * colidir e só então calcular o dano"*.
 *
 * As sequências usadas aqui não são inventadas: são as que
 * `duel-server --test-etapa-dano` mede no motor de verdade. Se elas mudarem
 * lá, este arquivo tem de mudar junto — é de propósito que os dois estejam
 * escritos com os mesmos nomes.
 */
import { ETAPAS, proximaEtapa, emBatalha, textoDoAtaque, calculoDaBatalha } from './batalha.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

/** Roda uma sequência de eventos e devolve os momentos por que ela passou. */
const trilha = (evs) => {
  const saida = [];
  let etapa = null;
  for (const ev of evs) { etapa = proximaEtapa(etapa, ev); saida.push(etapa); }
  return saida;
};

const ATAQUE = { type: 'attack', direct: false };
const DIRETO = { type: 'attack', direct: true };
const ABRE = { type: 'damagestep', etapa: 'inicio' };
const FECHA = { type: 'damagestep', etapa: 'fim' };
const COLIDE = { type: 'battle', atkAtk: 1700, atkDef: 1000, defAtk: 1400, defDef: 1200 };

// ------------------------------------------------ a sequência medida no motor

t('contra monstro virado: declaracao -> etapa de dano -> calculo -> fim', () => {
  assert.deepEqual(
    trilha([ATAQUE, ABRE, { type: 'pos', code: 91152256 }, COLIDE, FECHA]),
    ['declaracao', 'dano', 'dano', 'calculo', null]);
});

t('a virada do alvo NAO tira o duelo da etapa de dano', () => {
  // O `pos` do alvo abrindo chega no meio da etapa; tratá-lo como fronteira
  // apagaria a seta do ataque bem no instante em que a carta aparece.
  assert.equal(proximaEtapa('dano', { type: 'pos', code: 91152256 }), 'dano');
});

t('ataque direto: mesma trilha, e o `lp` no meio nao muda o momento', () => {
  assert.deepEqual(
    trilha([DIRETO, ABRE, { ...COLIDE, defAtk: 0, defDef: 0 },
            { type: 'lp', player: 0, delta: -1700 }, FECHA]),
    ['declaracao', 'dano', 'calculo', 'calculo', null]);
});

t('ataque anulado: a declaracao vira ANULADO e nao ha etapa de dano', () => {
  assert.deepEqual(trilha([ATAQUE, { type: 'attackcancel' }]),
                   ['declaracao', 'anulado']);
});

t('todo momento tem nome na tela', () => {
  for (const m of ['declaracao', 'dano', 'calculo', 'anulado'])
    assert.ok(ETAPAS[m], `sem rotulo para ${m}`);
});

// ------------------------------------------------------- o momento que morre

t('fora do ataque nao ha momento nenhum', () => {
  assert.equal(proximaEtapa(null, { type: 'draw' }), null);
  assert.equal(proximaEtapa(null, { type: 'phase', phase: 0x8 }), null);
});

t('o momento SOBREVIVE aos eventos do meio da batalha', () => {
  // O contrário apagaria a seta a cada carta que vai ao cemitério durante a
  // etapa de dano — e é justamente ali que uma vai.
  assert.equal(proximaEtapa('dano', { type: 'move', code: 91152256 }), 'dano');
  assert.equal(proximaEtapa('calculo', { type: 'lp', player: 1, delta: -300 }), 'calculo');
});

t('a virada do TURNO encerra um ataque que nao terminou', () => {
  // Rede de segurança: momento velho faz a próxima janela de corrente prometer
  // "responda ao ataque" quando não há ataque nenhum.
  assert.equal(proximaEtapa('declaracao', { type: 'turn', player: 1 }), null);
  assert.equal(proximaEtapa('dano', { type: 'turn', player: 0 }), null);
});

t('emBatalha separa o ataque em curso do que ja acabou', () => {
  assert.ok(emBatalha('declaracao') && emBatalha('dano') && emBatalha('calculo'));
  assert.ok(!emBatalha(null));
  assert.ok(!emBatalha('anulado'), 'anulado ja e o fim do ataque');
});

// ----------------------------------------------------------- quem ataca quem

t('quem ataca quem, por extenso', () => {
  assert.equal(textoDoAtaque({ atacante: 'Battle Ox', alvo: 'Celtic Guardian' }),
               'Battle Ox ataca Celtic Guardian');
  assert.equal(textoDoAtaque({ atacante: 'Battle Ox', direto: true }),
               'Battle Ox ataca diretamente');
});

t('o alvo VIRADO nao tem nome — e a frase diz isso em vez de inventar', () => {
  // Antes da etapa de dano o alvo chega com `code: 0` (`Projetar`, no
  // servidor). Um `nameOf(0)` devolveria a string "0" na cara do jogador.
  assert.equal(textoDoAtaque({ atacante: 'Battle Ox', alvo: '' }),
               'Battle Ox ataca uma carta virada');
});

// -------------------------------------------------------- o cálculo de dano

t('em ataque, os dois lados colidem pelo ATK', () => {
  const c = calculoDaBatalha({ ...COLIDE, defDestroyed: true }, { posDoAlvo: 0x1 });
  assert.equal(c.atacante.valor, 1700);
  assert.equal(c.defensor.valor, 1400);
  assert.equal(c.defensor.emDefesa, false);
  assert.ok(c.defensor.destruido && !c.atacante.destruido);
});

t('o monstro DEITADO luta pela DEF, nao pelo ATK', () => {
  // O caso medido: 1700 contra um Celtic Guardian que a etapa de dano abriu em
  // defesa. Mostrar o ATK dele anunciaria "1700 x 1400" numa batalha que o
  // motor resolveu como 1700 x 1200 — e o resultado (ninguem leva dano) deixa
  // de fechar com os numeros na tela.
  const c = calculoDaBatalha(COLIDE, { posDoAlvo: 0x4 });
  assert.equal(c.defensor.valor, 1200);
  assert.ok(c.defensor.emDefesa);
});

t('o alvo ainda VIRADO tambem luta pela DEF', () => {
  assert.equal(calculoDaBatalha(COLIDE, { posDoAlvo: 0x8 }).defensor.valor, 1200);
});

t('ataque DIRETO nao desenha defensor nenhum', () => {
  // Medido: o ataque direto TAMBEM manda MSG_BATTLE, com o lado do defensor
  // zerado. Desenhar o quadro porque o evento existe poe na tela um adversario
  // de 0 de ATK apanhando.
  const c = calculoDaBatalha({ atkAtk: 1700, defAtk: 0, defDef: 0 }, { direto: true });
  assert.equal(c.defensor, null);
  assert.equal(c.atacante.valor, 1700);
});

t('um monstro de 0/0 NAO e confundido com ataque direto', () => {
  // A checagem tem de ser do ataque (`direct`), e nunca de "os numeros vieram
  // zerados": o jogo tem monstro de 0 de ATK e 0 de DEF.
  const c = calculoDaBatalha({ atkAtk: 1700, defAtk: 0, defDef: 0, defDestroyed: true },
                             { posDoAlvo: 0x1, direto: false });
  assert.ok(c.defensor, 'o defensor de 0/0 existe e apanhou');
  assert.equal(c.defensor.valor, 0);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
