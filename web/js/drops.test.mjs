/**
 * Testes da CONFIGURACAO de drop por NPC.
 *   node web/js/drops.test.mjs
 *
 * O sorteio em si NAO esta' aqui: quem sorteia e' o servidor
 * (`premiar_vitoria`), porque o duelo roda na maquina do jogador e sortear no
 * navegador seria deixar escolher o proprio premio. O que se prova aqui e' o
 * que a TELA depende: que a configuracao aguenta ser editada por gente, e que a
 * porcentagem mostrada e' a mesma conta que o servidor faz.
 */
import {
  normalizarDrops, dropsDoNpc, dropsDoDeck, chancesDe, totalDoPool, poolVazio,
  MAX_DROPS, DROP_ODDS, RARIDADES,
} from './drops.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const cfg1 = (pool, quantidade = 3) => normalizarDrops({ yugi: { quantidade, pool } }).yugi;

// ------------------------------------------------------------- normalizacao

t('o caso normal passa inteiro, com as quatro gavetas', () => {
  const c = cfg1({ UR: [1], SR: [2], R: [3], N: [4, 5] });
  assert.deepEqual(c, { quantidade: 3, pool: { UR: [1], SR: [2], R: [3], N: [4, 5] } });
});

t('a MESMA carta em duas raridades fica so na primeira (viciaria a chance)', () => {
  const c = cfg1({ UR: [7], SR: [7], N: [7, 8] });
  assert.deepEqual(c.pool.UR, [7]);
  assert.deepEqual(c.pool.SR, []);
  assert.deepEqual(c.pool.N, [8]);
});

t('id repetido, texto, zero e negativo caem fora', () => {
  const c = cfg1({ N: [5, 5, '6', 'abc', 0, -1, null] });
  assert.deepEqual(c.pool.N, [5, 6]);
});

t('o formato ANTIGO (lista simples) vira a gaveta N', () => {
  // E' onde o servidor ja' colocava quem nao esta' em booster nenhum.
  const c = cfg1([10, 20, 20]);
  assert.deepEqual(c.pool.N, [10, 20]);
  assert.equal(totalDoPool(c.pool), 2);
});

t(`quantidade e cortada em ${MAX_DROPS} e nao aceita quebrada`, () => {
  assert.equal(cfg1({ N: [1] }, 999).quantidade, MAX_DROPS);
  assert.equal(cfg1({ N: [1] }, 2.7).quantidade, 2);
});

t('pool vazio ou quantidade 0 SOME da configuracao', () => {
  // Sumir e' o certo: no servidor "sem configuracao" cai no comportamento
  // antigo (a carta de assinatura), e um registro pela metade viraria vitoria
  // sem premio nenhum.
  assert.deepEqual(normalizarDrops({ a: { quantidade: 3, pool: poolVazio() } }), {});
  assert.deepEqual(normalizarDrops({ b: { quantidade: 0, pool: { N: [1] } } }), {});
});

t('lixo no lugar do objeto nao explode', () => {
  assert.deepEqual(normalizarDrops(null), {});
  assert.deepEqual(normalizarDrops({ a: null, b: 'x', c: 42 }), {});
});

t('normalizar duas vezes da o mesmo (a operacao e estavel)', () => {
  const uma = normalizarDrops({ y: { quantidade: 99, pool: { UR: [5, 5], N: ['6'] } } });
  assert.deepEqual(normalizarDrops(uma), uma);
});

t('dropsDoNpc devolve so o do npc pedido', () => {
  const bruto = { yugi: { quantidade: 2, pool: { N: [1] } }, kaiba: { quantidade: 1, pool: { UR: [9] } } };
  assert.deepEqual(dropsDoNpc(bruto, 'yugi').pool.N, [1]);
  assert.equal(dropsDoNpc(bruto, 'joey'), null);
});

// ------------------------------------------------------------ as chances (%)

t('com as quatro raridades, a soma das chances e 100%', () => {
  const ch = chancesDe({ UR: [1], SR: [2], R: [3], N: [4] });
  assert.equal(Math.round(ch.UR + ch.SR + ch.R + ch.N), 100);
  assert.ok(ch.UR < ch.SR && ch.SR < ch.R && ch.R < ch.N, 'a ordem das raridades tem de valer');
});

t('raridade SEM carta vale 0% (nao se promete UR num pool sem UR)', () => {
  const ch = chancesDe({ UR: [], SR: [], R: [1], N: [2] });
  assert.equal(ch.UR, 0);
  assert.equal(ch.SR, 0);
  assert.equal(Math.round(ch.R + ch.N), 100);
});

t('pool de UMA raridade so da 100% para ela', () => {
  // Sem renormalizar, um pool so de N daria 52% e 48% de "nada".
  const ch = chancesDe({ UR: [], SR: [], R: [], N: [1, 2] });
  assert.equal(ch.N, 100);
});

t('pool vazio nao da chance nenhuma (e nao divide por zero)', () => {
  assert.deepEqual(chancesDe(poolVazio()), { UR: 0, SR: 0, R: 0, N: 0 });
  assert.deepEqual(chancesDe(null), { UR: 0, SR: 0, R: 0, N: 0 });
});

t('as chances saem dos PESOS, nao de numero escrito na tela', () => {
  // Se alguem mexer em DROP_ODDS, a tela acompanha sozinha — e este teste
  // continua valendo, porque ele compara com a fonte.
  const ch = chancesDe({ UR: [1], N: [2] });
  const esperado = Math.round((DROP_ODDS.UR / (DROP_ODDS.UR + DROP_ODDS.N)) * 1000) / 10;
  assert.equal(ch.UR, esperado);
});

t('RARIDADES esta na ordem da mais alta para a mais baixa', () => {
  assert.deepEqual(RARIDADES, ['UR', 'SR', 'R', 'N']);
});

// ---------------------------------------------------------------------------
// O POOL QUE SOME QUANDO A QUANTIDADE E' ZERO
//
// Relato: "configurei a pool pro wevil e nao subiu". A gravacao SUBIU — o que
// nao foi junto era o wevil, descartado aqui antes de sair da tela. A regra
// esta' certa (0 carta por vitoria e' o mesmo que nao ter drop), o erro era o
// silencio: o editor apagava a configuracao sem dizer nada.
//
// Estes testes fixam a regra, para o dia em que alguem "consertar" o descarte
// no lugar errado — a correcao e' na TELA (ligar a quantidade na primeira carta
// e avisar quando ela estiver zerada), nao aqui.
{
  const comCartas = { wevil: { quantidade: 0, pool: { UR: [1], SR: [], R: [], N: [2, 3] } } };
  t('pool com carta e quantidade 0 e descartado (e o mesmo que nao ter drop)',
    () => assert.equal(Object.keys(normalizarDrops(comCartas)).length, 0));

  const completo = { wevil: { quantidade: 1, pool: { UR: [1], SR: [], R: [], N: [2, 3] } } };
  t('...e com quantidade 1 ele fica',
    () => assert.equal(normalizarDrops(completo).wevil?.quantidade, 1));

  t('quantidade sem pool nenhum tambem e descartada',
    () => assert.equal(Object.keys(normalizarDrops({ wevil: { quantidade: 3, pool: {} } })).length, 0));

  // O outro NPC nao pode ser levado junto: salvar o wevil errado nao pode
  // apagar a pool do para_dox, que ja' estava publicada.
  const dois = {
    para_dox: { quantidade: 3, pool: { UR: [9], SR: [], R: [], N: [] } },
    wevil: { quantidade: 0, pool: { UR: [1], SR: [], R: [], N: [] } },
  };
  const saida = normalizarDrops(dois);
  t('descartar um NPC nao derruba os outros', () => {
    assert.equal(saida.para_dox?.quantidade, 3);
    assert.ok(!saida.wevil);
  });
}

// ------------------------------------------------------- o pool por DECK
//
// O pool passou a ser por DECK, e nao mais por adversario. E' o que da' sentido
// a destrancar o deck dificil: se o premio fosse o mesmo, escolher o caminho
// mais duro nao teria motivo.
//
// O pool do NPC continua existindo como RESERVA — quem montou um antes disto
// nao perde nada, e um deck novo ja' nasce dropando.
{
  const p = (id) => ({ UR: [], SR: [], R: [], N: [id] });
  const cfg = {
    para_dox: {
      quantidade: 1, pool: p(111),                       // a reserva do NPC
      decks: {
        'Bem-vindo ao Labirinto': { quantidade: 2, pool: p(222) },
        'Guardiao do Portao':     { quantidade: 5, pool: p(333) },
      },
    },
    wevil: { quantidade: 3, pool: p(444) },              // so' o formato antigo
  };

  t('o deck com pool proprio usa o DELE, nao o do NPC', () => {
    assert.deepEqual(dropsDoDeck(cfg, 'para_dox', 'Guardiao do Portao'),
      { quantidade: 5, pool: p(333) });
  });

  t('cada deck tem o seu, sem um vazar no outro', () => {
    assert.deepEqual(dropsDoDeck(cfg, 'para_dox', 'Bem-vindo ao Labirinto'),
      { quantidade: 2, pool: p(222) });
  });

  t('deck SEM pool proprio cai na reserva do NPC', () => {
    assert.deepEqual(dropsDoDeck(cfg, 'para_dox', 'Um Deck Novo'),
      { quantidade: 1, pool: p(111) });
  });

  t('config so no formato antigo vale para qualquer deck', () => {
    assert.deepEqual(dropsDoDeck(cfg, 'wevil', 'Furia dos Insetos'),
      { quantidade: 3, pool: p(444) });
  });

  t('NPC sem configuracao nenhuma continua sem drop', () => {
    assert.equal(dropsDoDeck(cfg, 'kaiba', 'Legend of Blue-Eyes'), null);
  });

  t('sem o nome do deck, vale a reserva do NPC', () => {
    assert.deepEqual(dropsDoDeck(cfg, 'para_dox', ''), { quantidade: 1, pool: p(111) });
  });

  // Um NPC pode ter SO' pools por deck, sem reserva nenhuma. Nesse caso o deck
  // configurado dropa e o que nao esta' na lista nao dropa — e' o unico jeito
  // de dizer "so' o deck dificil da' premio".
  const soDeck = {
    para_dox: { decks: { 'Guardiao do Portao': { quantidade: 4, pool: p(555) } } },
  };
  t('NPC so com pool por deck: o configurado dropa', () => {
    assert.deepEqual(dropsDoDeck(soDeck, 'para_dox', 'Guardiao do Portao'),
      { quantidade: 4, pool: p(555) });
  });
  t('...e o deck de fora dele nao dropa', () => {
    assert.equal(dropsDoDeck(soDeck, 'para_dox', 'Bem-vindo ao Labirinto'), null);
  });
  t('...e o NPC nao some da configuracao por nao ter reserva', () => {
    assert.ok(normalizarDrops(soDeck).para_dox);
  });

  // As mesmas travas do pool do NPC valem dentro de cada deck: um deck com
  // carta e quantidade 0 e' o mesmo que nao ter drop.
  t('deck com quantidade 0 e descartado, como o do NPC', () => {
    const zerado = { para_dox: { decks: { 'X': { quantidade: 0, pool: p(1) } } } };
    assert.ok(!normalizarDrops(zerado).para_dox);
  });

  t('normalizar duas vezes da o mesmo, tambem com decks', () => {
    const uma = normalizarDrops(cfg);
    assert.deepEqual(normalizarDrops(uma), uma);
  });

  // `dropsDoNpc` continua existindo e continua devolvendo a RESERVA — as telas
  // que ainda nao sabem de deck nenhum seguem funcionando.
  t('dropsDoNpc devolve a reserva, sem o mapa de decks dentro', () => {
    assert.deepEqual(dropsDoNpc(cfg, 'para_dox'), { quantidade: 1, pool: p(111) });
  });
}

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
