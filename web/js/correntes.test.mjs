/**
 * Testes do MODO DAS CORRENTES.
 *   node web/js/correntes.test.mjs
 *
 * O relato que originou isto: uma Forgotten Temple of the Deep em campo faz o
 * motor abrir uma janela de corrente a CADA mudança de fase, todo turno,
 * enquanto houver monstro em campo. Perguntar sempre é o certo pra quem está
 * montando corrente e é sufocante pra quem não está.
 *
 * A primeira versão daqui errava o vocabulário: eu tinha feito "auto" querer
 * dizer "ativa a carta sozinho", coisa que jogo nenhum de Yu-Gi-Oh faz — no
 * Master Duel e no EDOPro os três modos decidem só QUANDO o jogo pergunta.
 * Estes casos existem para travar o sentido certo de cada modo, que é a parte
 * fácil de reescrever errado depois.
 */
// Importa a decisão DE VERDADE — nada de reimplementar a regra aqui, senão o
// teste passa enquanto o jogo incomoda.
import { decidirCorrente, momentoDaJanela, normalizarModo, MODOS, MODO_PADRAO, FASE_END, FASE_STANDBY } from './correntes.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const FASE_MAIN1 = 0x4, FASE_BATTLE = 0x8;

/** Uma janela de corrente com N cartas ativáveis. */
const janela = (extra = {}) => ({
  kind: 'chain', player: 0, chainForced: false,
  choices: [{ code: 44095762, index: 0 }],
  chainTriggerKind: '', chainTriggerCode: 0, chainTriggerPlayer: -1,
  ...extra,
});

// ------------------------------------------------------------ o caso do relato

t('AUTO nao pergunta na troca de fase (o caso da Forgotten Temple)', () => {
  const d = decidirCorrente({ modo: 'auto', pergunta: janela(), turno: 1, fase: FASE_MAIN1 });
  assert.equal(d.perguntar, false, 'era pra passar sozinho');
  assert.equal(d.resposta, -1, 'passar a corrente e' + ' responder -1');
});

t('SEMPRE pergunta na MESMA janela (e a diferenca entre os dois modos)', () => {
  const d = decidirCorrente({ modo: 'on', pergunta: janela(), turno: 1, fase: FASE_MAIN1 });
  assert.equal(d.perguntar, true);
  assert.equal(d.resposta, null);
});

t('DESLIGADO nao pergunta nem nos momentos que importam', () => {
  const d = decidirCorrente({
    modo: 'off', pergunta: janela({ chainTriggerKind: 'summon', chainTriggerCode: 5053103 }),
    turno: 1, fase: FASE_MAIN1,
  });
  assert.equal(d.perguntar, false);
  assert.equal(d.resposta, -1);
});

// --------------------------------------------- os quatro momentos do modo auto

t('AUTO pergunta quando o oponente ATIVA uma carta', () => {
  const d = decidirCorrente({
    modo: 'auto', pergunta: janela({ chainTriggerKind: 'activation', chainTriggerCode: 12580477 }),
    turno: 1, fase: FASE_MAIN1,
  });
  assert.equal(d.perguntar, true, 'e a janela pra negar o Raigeki');
});

t('AUTO pergunta quando ha INVOCACAO em andamento', () => {
  const d = decidirCorrente({
    modo: 'auto', pergunta: janela({ chainTriggerKind: 'summon', chainTriggerCode: 5053103 }),
    turno: 1, fase: FASE_MAIN1,
  });
  assert.equal(d.perguntar, true, 'e a janela do Horn of Heaven / Trap Hole');
});

t('AUTO pergunta quando um ATAQUE foi declarado (pelo gatilho do motor)', () => {
  // O motor nomeia a declaracao como qualquer outro gatilho (`MarcaGatilhoDoAtaque`,
  // provado por `--test-etapa-dano`). Antes disto ela era o unico momento sem
  // nome, e a janela da Mirror Force chegava rotulada como mudanca de fase.
  const d = decidirCorrente({
    modo: 'auto',
    pergunta: janela({ chainTriggerKind: 'attack', chainTriggerCode: 5053103, chainTriggerPlayer: 1 }),
    turno: 1, fase: FASE_BATTLE,
  });
  assert.equal(d.perguntar, true, 'e a janela da Mirror Force');
});

t('AUTO ainda pergunta pela reserva, com o motor que nao manda o gatilho', () => {
  // Cliente com o `engine` atrasado: o gatilho vem vazio e quem sabe do ataque
  // e' a tela. Sem esta reserva, atualizar o front antes do motor tiraria do
  // jogador justamente a janela que decide o duelo.
  const d = decidirCorrente({
    modo: 'auto', pergunta: janela(), turno: 1, fase: FASE_BATTLE, ataqueDeclarado: true,
  });
  assert.equal(d.perguntar, true, 'e a janela da Mirror Force');
});

t('AUTO pergunta na End Phase DELE (a hora do MST baixado)', () => {
  const d = decidirCorrente({ modo: 'auto', pergunta: janela(), turno: 1, fase: FASE_END });
  assert.equal(d.perguntar, true);
});

t('AUTO nao pergunta na End Phase do MEU proprio turno', () => {
  // O momento so' vale no turno DELE: na minha End Phase nao ha nada chegando.
  const d = decidirCorrente({ modo: 'auto', pergunta: janela(), turno: 0, fase: FASE_END });
  assert.equal(d.perguntar, false);
});

// ------------------------------------- o gatilho de tempo (a Golden Ladybug)
//
// O relato: *"a Golden Ladybug nao pediu pra ativar o efeito da standby, ou ele
// foi consumido por outra coisa"*. Foi consumido: pelo modo `auto`, que e' o
// PADRAO. O efeito dela e' `EVENT_PHASE|PHASE_STANDBY` +
// `SetRange(LOCATION_HAND)` + `SetCountLimit(1)` — revelar a carta na MAO, na
// SUA Standby Phase, e ganhar 500 LP. Ninguem invoca, ninguem ativa, ninguem
// ataca: a janela caia em "rotina" e era passada sozinha, todo turno, sem uma
// linha no log. Do lado de quem joga, a carta simplesmente nunca fazia nada.

const MAO = 0x02, CAMPO_ST = 0x08;
/** A janela que o motor abre na sua Standby Phase, com a carta na mao. */
const janelaDaLadybug = () => janela({
  choices: [{ code: 87102774, index: 0, controller: 0, location: MAO, sequence: 0 }],
});

t('AUTO pergunta pela carta da MAO (o caso da Golden Ladybug)', () => {
  const d = decidirCorrente({ modo: 'auto', pergunta: janelaDaLadybug(), turno: 0, fase: FASE_STANDBY });
  assert.equal(d.perguntar, true, 'o gatilho de tempo passa uma vez e nao volta');
  assert.equal(d.resposta, null);
});

t('AUTO pergunta na MINHA Standby Phase mesmo com a carta em CAMPO', () => {
  // A segunda condicao, sozinha: a fase que existe para os gatilhos de tempo
  // acontece UMA vez por turno, entao o teto do incomodo e' uma pergunta.
  const d = decidirCorrente({
    modo: 'auto', turno: 0, fase: FASE_STANDBY,
    pergunta: janela({ choices: [{ code: 44095762, index: 0, controller: 0, location: CAMPO_ST, sequence: 2 }] }),
  });
  assert.equal(d.perguntar, true);
});

t('CONTROLE: a mesma carta em CAMPO, fora da Standby, continua sendo rotina', () => {
  // Sem este par, "perguntou" nao provaria nada — bastaria perguntar sempre. E'
  // a Forgotten Temple do primeiro teste, agora com a localizacao preenchida.
  const naMain = janela({
    choices: [{ code: 44095762, index: 0, controller: 0, location: CAMPO_ST, sequence: 2 }],
  });
  assert.equal(decidirCorrente({ modo: 'auto', pergunta: naMain, turno: 0, fase: FASE_MAIN1 }).perguntar, false);
  assert.equal(decidirCorrente({ modo: 'auto', pergunta: naMain, turno: 1, fase: FASE_MAIN1 }).perguntar, false);
});

t('CONTROLE: a Standby DELE nao e minha — nada meu tem hora marcada ali', () => {
  const d = decidirCorrente({
    modo: 'auto', turno: 1, fase: FASE_STANDBY,
    pergunta: janela({ choices: [{ code: 44095762, index: 0, controller: 0, location: CAMPO_ST, sequence: 2 }] }),
  });
  assert.equal(d.perguntar, false);
});

t('a carta da MAO vale em qualquer fase — o gatilho de tempo nao mora so na Standby', () => {
  for (const fase of [0x1, FASE_MAIN1, FASE_BATTLE, 0x100]) {
    assert.equal(
      decidirCorrente({ modo: 'auto', pergunta: janelaDaLadybug(), turno: 0, fase }).perguntar,
      true, `fase ${fase}`);
  }
});

t('DESLIGADO continua sem perguntar, inclusive isto', () => {
  // O `off` e' uma escolha do jogador, e ela vale para tudo: alargar o `auto`
  // nao pode furar o modo de quem pediu silencio.
  const d = decidirCorrente({ modo: 'off', pergunta: janelaDaLadybug(), turno: 0, fase: FASE_STANDBY });
  assert.equal(d.perguntar, false);
  assert.equal(d.resposta, -1);
});

t('o MOTIVO de cada um vai para o log, e sao diferentes', () => {
  const m1 = momentoDaJanela(janelaDaLadybug(), { turno: 0, fase: FASE_STANDBY });
  const m2 = momentoDaJanela(
    janela({ choices: [{ code: 44095762, index: 0, location: CAMPO_ST }] }),
    { turno: 0, fase: FASE_STANDBY });
  assert.match(m1, /m[aã]o/i);
  assert.match(m2, /standby/i);
  assert.notEqual(m1, m2);
});

// ------------------------------------------------------------------- a travada

t('janela OBRIGATORIA pergunta em TODOS os modos', () => {
  for (const modo of ['auto', 'on', 'off']) {
    const d = decidirCorrente({
      modo, pergunta: janela({ chainForced: true }), turno: 1, fase: FASE_MAIN1,
    });
    assert.equal(d.perguntar, true, `o modo ${modo} nao pode responder por conta propria`);
    assert.equal(d.resposta, null, 'responder -1 numa janela forcada trava o duelo');
  }
});

// -------------------------------------------------------------------- bordas

t('janela sem carta nenhuma nao e' + ' decisao de ninguem', () => {
  const d = decidirCorrente({ modo: 'auto', pergunta: janela({ choices: [] }) });
  assert.equal(d.perguntar, false);
  assert.equal(d.resposta, null, 'null = nao respondo; -1 mandaria uma resposta que ninguem pediu');
});

t('pergunta de outro tipo (idle) nao e' + ' tocada', () => {
  const d = decidirCorrente({ modo: 'off', pergunta: { kind: 'idle', choices: [{ code: 1, index: 0 }] } });
  assert.equal(d.resposta, null);
});

t('sem pergunta nenhuma nao explode', () => {
  assert.equal(decidirCorrente({ modo: 'auto', pergunta: null }).perguntar, false);
  assert.equal(decidirCorrente().perguntar, false);
});

t('modo desconhecido cai no padrao (auto), nao em silencio', () => {
  assert.equal(normalizarModo('sei la'), MODO_PADRAO);
  assert.equal(normalizarModo(undefined), MODO_PADRAO);
  assert.equal(normalizarModo(null), MODO_PADRAO);
});

t('o nome ANTIGO "manual" vira "sempre" (era o que ele fazia)', () => {
  // Quem ja' tinha escolhido "manual" perguntava em toda janela. Cair no padrao
  // mudaria o comportamento dele sem aviso.
  assert.equal(normalizarModo('manual'), 'on');
  const d = decidirCorrente({ modo: 'manual', pergunta: janela(), turno: 1, fase: FASE_MAIN1 });
  assert.equal(d.perguntar, true);
});

t('os tres modos tem rotulo (e a barra desenha por esta tabela)', () => {
  assert.deepEqual(Object.keys(MODOS), ['off', 'auto', 'on']);
  for (const [chave, rotulo] of Object.entries(MODOS))
    assert.ok(rotulo && typeof rotulo === 'string', `modo ${chave} sem rotulo`);
});

t('momentoDaJanela devolve o MOTIVO, que e' + ' o que vai pro log', () => {
  const m = momentoDaJanela({ chainTriggerKind: 'activation' }, { turno: 1, fase: FASE_MAIN1 });
  assert.ok(typeof m === 'string' && m.length > 0);
  assert.equal(momentoDaJanela({}, { turno: 1, fase: FASE_MAIN1 }), null);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
