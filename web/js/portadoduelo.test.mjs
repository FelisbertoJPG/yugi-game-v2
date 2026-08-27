/**
 * **A PORTA DO DUELO** — `node web/js/portadoduelo.test.mjs`
 *
 * O relato: *"o player está conseguindo duelar com um deck que possui mais de
 * uma cópia de cards limitados — isso é um problema grande, o ideal é ter dupla
 * abordagem (não permitir salvar, e nunca iniciar um duelo que o player tenha
 * cards acima da regra da banlist)"*.
 *
 * A primeira metade já existia: o Deck Builder desabilita o botão e
 * `salvar_deck` recusa no Postgres. A segunda **não existia de jeito nenhum** —
 * e o caminho é curto de explicar:
 *
 *   `chosenDeck()` lê o deck do **localStorage** e manda as cartas direto para
 *   o motor local. O único servidor no caminho, `iniciar_duelo`, recebia apenas
 *   o **NOME** do deck. Ou seja: o builder recusava salvar, o banco recusava
 *   gravar, o deck ficava só naquele navegador — e o duelo o carregava de lá,
 *   normalmente.
 *
 * A trava tem duas camadas, e este arquivo guarda a de cá:
 *
 *   • a **PORTA** (`podeDuelar`, em `duel.html`) — a checagem local, que existe
 *     para o aviso dizer O QUE está errado em vez de o duelo simplesmente não
 *     começar. Ela só sabe ACRESCENTAR um motivo, nunca dar permissão: a cópia
 *     local da banlist pode estar velha, e velha ela deixa passar;
 *   • a **FECHADURA** (`iniciar_duelo`, migration 0047) — o servidor, que
 *     recebe as cartas e recusa. É ela que vale contra quem abre o console.
 *
 * O que se prova aqui é a porta e, principalmente, a **ORDEM**: uma trava que
 * roda depois de o motor subir não é uma trava, é um aviso — e nada acusaria a
 * diferença, porque o texto na tela seria o mesmo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBanlist, textoDoProblema } from './banlist.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUEL = readFileSync(join(RAIZ, 'duel.html'), 'utf8');
const WALLET = readFileSync(join(RAIZ, 'js', 'wallet.js'), 'utf8');

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

/** Fatia um bloco do `duel.html` entre dois marcadores, incluindo os dois. */
function fatia(de, ate, nome) {
  const i = DUEL.indexOf(de);
  const j = DUEL.indexOf(ate, i);
  assert.ok(i >= 0 && j >= 0, `nao achei o bloco ${nome} no duel.html`);
  return DUEL.slice(i, j + ate.length);
}

// A `podeDuelar` de VERDADE, fatiada do jogo — copiá-la aqui faria o teste
// passar a valer por si e deixar de provar o que está na tela.
const FONTE = fatia('function podeDuelar(deck) {', "Ajuste-o no Deck Builder.';\n}", 'podeDuelar');

/** Roda a função real com uma banlist de mentira injetada. */
function montar(banlist) {
  const fabrica = new Function('validateBanlist', 'textoDoProblema', 'getBanlist', 'nameOf',
    `${FONTE}\nreturn podeDuelar;`);
  return fabrica(validateBanlist, textoDoProblema, () => banlist,
                 (id) => ({ 10667321: 'Card Destruction', 5053103: 'Battle Ox' })[id] ?? String(id));
}

const LIMITADA = 10667321, LIVRE = 5053103;
const BANLIST = { cardLimits: { [LIMITADA]: 1 }, cardPoints: {}, cardGroups: {}, pointBudget: 0 };
const deck = (main, extra = []) => ({ main, extra });

// ------------------------------------------------------------------- a porta

t('deck com 3 copias de uma LIMITADA nao pode duelar', () => {
  const podeDuelar = montar(BANLIST);
  const motivo = podeDuelar(deck([LIMITADA, LIMITADA, LIMITADA, LIVRE]));
  assert.ok(motivo, 'passou — e este e exatamente o deck do relato');
  assert.match(motivo, /Card Destruction/, 'a frase tem de dizer QUAL carta');
  assert.match(motivo, /3 cópias.*máximo 1/, `veio: ${motivo}`);
});

t('par CONTROLE: uma copia da MESMA carta duela', () => {
  // Sem ele, uma `podeDuelar` que recusasse tudo passaria no teste de cima e
  // trancaria o jogo inteiro.
  assert.equal(montar(BANLIST)(deck([LIMITADA, LIVRE, LIVRE])), '');
});

t('o EXTRA conta junto do main', () => {
  // A banlist é do deck, não da pilha: duas no main e uma no extra são três.
  const motivo = montar(BANLIST)(deck([LIMITADA, LIMITADA], [LIMITADA]));
  assert.ok(motivo, 'a copia no Extra escapou da conta');
});

t('carta BANIDA (teto 0) e recusada, e a frase nao a chama de "maximo 0"', () => {
  const motivo = montar({ cardLimits: { [LIMITADA]: 0 }, cardPoints: {}, cardGroups: {}, pointBudget: 0 })
    (deck([LIMITADA]));
  assert.match(motivo, /BANIDA/, `veio: ${motivo}`);
});

t('banlist vazia nao inventa motivo (o jogo sem regra nenhuma continua jogavel)', () => {
  assert.equal(montar({ cardLimits: {}, cardPoints: {}, cardGroups: {}, pointBudget: 0 })
    (deck([LIMITADA, LIMITADA, LIMITADA])), '');
});

// -------------------------------------------------------------- a ORDEM

t('a porta e conferida ANTES de o motor acender', () => {
  // Barrar depois do `/start` não é barrar: o duelo já está na tela, e a única
  // diferença visível seria nenhuma.
  const iPorta = DUEL.indexOf('const barrado = podeDuelar(deck)');
  const iMotor = DUEL.indexOf("rpc('/start'");
  assert.ok(iPorta > 0, 'a porta sumiu do start()');
  assert.ok(iMotor > 0, 'nao achei a chamada do motor');
  assert.ok(iPorta < iMotor, 'a conferencia da banlist ficou DEPOIS do /start');
});

t('e o duelo e REGISTRADO antes do motor — a fechadura tambem barra', () => {
  // `iniciar_duelo` é quem recusa de verdade (migration 0047). Chamado depois
  // do `/start`, o duelo rodaria inteiro e só o prêmio seria negado no fim.
  const iReg = DUEL.indexOf('await iniciarDuelo(');
  const iMotor = DUEL.indexOf("rpc('/start'");
  assert.ok(iReg > 0, 'nao achei a chamada de iniciarDuelo');
  assert.ok(iReg < iMotor, 'o registro do duelo voltou para depois do /start');
});

t('o erro do servidor e MOSTRADO, e o duelo nao comeca', () => {
  const trecho = DUEL.slice(DUEL.indexOf('await iniciarDuelo('), DUEL.indexOf("rpc('/start'"));
  assert.match(trecho, /warn\([a-zA-Z]+\.erro\)/, 'o recado do banco voltou a ser jogado fora');
  assert.match(trecho, /return/, 'sem o `return` o duelo comeca mesmo barrado');
});

// ------------------------------------------------------- as cartas viajam

t('as CARTAS do deck viajam para o servidor', () => {
  // Sem elas `iniciar_duelo` só conhece o NOME do deck — que é como o buraco
  // existiu desde sempre.
  const trecho = DUEL.slice(DUEL.indexOf('await iniciarDuelo('), DUEL.indexOf("rpc('/start'"));
  assert.match(trecho, /\[\.\.\.ids,\s*\.\.\.extraIds\]/,
    'iniciarDuelo parou de mandar as cartas (main + extra)');
});

t('e `wallet.js` as repassa como `p_cartas`', () => {
  const i = WALLET.indexOf('export async function iniciarDuelo');
  const j = WALLET.indexOf('\nexport ', i + 1);
  const corpo = WALLET.slice(i, j < 0 ? undefined : j);
  assert.match(corpo, /p_cartas/, 'o parametro do banco sumiu da chamada');
  // Lista vazia NÃO vai: o banco leria "vou jogar com deck nenhum" como um deck
  // em regra, quando omitir faz ele conferir o que está salvo com aquele nome.
  assert.match(corpo, /cartas\?\.length/, 'a lista vazia voltou a ser enviada');
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
