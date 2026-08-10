/**
 * Auto montagem — monta um deck jogável com o que o jogador TEM.
 *
 * O que isto é: a mesma cabeça do `NpcBrain`, aplicada antes do duelo. Ele
 * decide "que carta jogo agora?" olhando ATK, custo de tributo e o que a carta
 * faz; aqui a pergunta é "que carta levo?", e as contas são as mesmas.
 *
 * O que isto NÃO é: um construtor de combo. Não existe leitura de sinergia, nem
 * arquétipo, nem plano de jogo. O alvo é um deck **honesto**: curva de invocação
 * que não trava a mão, remoção suficiente, e nenhuma carta morta. Quem quiser
 * combo monta na mão — e o botão existe justamente para quem não quer.
 *
 * Sem DOM de propósito: dá para rodar em Node (`automontagem.test.mjs`), que é o
 * único jeito de provar que a curva sai certa sem abrir o navegador.
 */
// Relativo, como `banlist.js` e `cardlists.js`: é o que deixa o módulo rodar em
// Node (`node web/js/automontagem.test.mjs`) e no browser com o mesmo caminho.
import { isExtraDeck, RULES } from './deck.js';

/** A forma padrão de um deck de 40. Proporção clássica, não invenção nossa. */
export const ALVO = {
  main: 40,
  monstros: 20,
  magias: 12,
  armadilhas: 8,
  /**
   * Teto de monstros que exigem tributo. É a trava mais importante do arquivo:
   * um deck cheio de 2500 de ATK parece forte e trava a mão — você compra três
   * monstros que não pode invocar e perde o turno olhando para eles.
   */
  comTributo: 6,
};

/**
 * Quanto o tributo custa, em fração do ATK.
 *
 * Um 1800 de nível 4 vale mais que um 2400 de nível 6, e é por isso que decks
 * bons são cheios de nível 4. Os números saem da mesma leitura que o
 * `NpcBrain` faz ao escolher entre invocar e passar.
 */
function fatorDeTributo(lv) {
  if (!lv || lv <= 4) return 1;      // sem custo
  if (lv <= 6) return 0.72;          // 1 tributo
  if (lv <= 8) return 0.48;          // 2 tributos
  return 0.35;                       // 3 tributos: quase sempre carta morta
}

/**
 * Nota de um monstro. `def * 0.8` deixa a parede competir: um 1000/2000 segura
 * o jogo tanto quanto um 1900/0 pressiona, e um deck só de ataque perde para
 * qualquer coisa maior.
 */
export function notaMonstro(c) {
  const atk = Number(c.atk) > 0 ? Number(c.atk) : 0;
  const def = Number(c.def) > 0 ? Number(c.def) : 0;
  return Math.round(Math.max(atk, def * 0.8) * fatorDeTributo(Number(c.lv)));
}

/**
 * Nota de magia/armadilha, pelo TEXTO da carta.
 *
 * É grosseiro e assumido: sem interpretar o Lua não há como saber o valor real.
 * Mas a ordem de grandeza acerta o que importa — varredura de campo vale mais
 * que ganhar 1000 de vida, e é essa a decisão que separa um deck jogável de um
 * monte de cartas.
 *
 * Sem texto (o `cards.json` não foi carregado), tudo empata em 300 e a escolha
 * vira "o que eu tenho mais cópias" — pior, mas não quebrado.
 */
export function notaEfeito(texto) {
  const t = String(texto ?? '').toLowerCase();
  if (!t) return 300;

  // Varredura: muda o jogo sozinha.
  if (/destroy all (monsters|cards)|send all|banish all/.test(t)) return 1000;
  // Negação — o que o NpcBrain mais teme.
  if (/negate the (activation|summon)|negate that/.test(t)) return 900;
  if (/draw 2|draw 3/.test(t)) return 800;
  // Remoção pontual.
  if (/destroy (it|that|1|one|up to)|banish (it|that|1)|return .* to the hand/.test(t)) return 650;
  if (/special summon/.test(t)) return 550;
  if (/equip|gains? \d+ atk/.test(t)) return 420;
  if (/add 1 .* from your deck to your hand|search/.test(t)) return 700;
  // Cura pura quase nunca ganha jogo.
  if (/gain \d+ life points/.test(t)) return 120;
  return 300;
}

const ehMonstro = (c) => c?.t === 'M' || /Monster/.test(c?.tl ?? '');
const ehMagia = (c) => c?.t === 'S' || /\bSpell\b/.test(c?.tl ?? '');
const ehArmadilha = (c) => c?.t === 'T' || /\bTrap\b/.test(c?.tl ?? '');
const ehRitualMonstro = (c) => ehMonstro(c) && /\bRitual\b/.test(c?.tl ?? '');
const ehRitualMagia = (c) => ehMagia(c) && /\bRitual\b/.test(c?.tl ?? '');

/** Nomes entre aspas — é assim que o texto oficial cita outra carta. */
function nomesCitados(texto) {
  return [...String(texto ?? '').matchAll(/"([^"]{2,80})"/g)].map((m) => m[1]);
}

/**
 * A magia de ritual que invoca ESTE monstro.
 *
 * O índice não liga uma coisa à outra — quem liga é o texto da magia, que cita o
 * monstro pelo nome. Sem o `cards.json` carregado não há como saber, e aí o
 * ritual é descartado: melhor ficar de fora que entrar como carta morta, que é
 * exatamente o que um Ritual sem a magia dele é.
 */
function magiaDoRitual(monstro, candidatas, descOf) {
  const nome = String(monstro.name ?? '');
  for (const m of candidatas) {
    const citados = nomesCitados(descOf?.(m.card.id));
    if (citados.some((n) => n === nome)) return m;
  }
  return null;
}

/** "A" + "B" na primeira linha do texto de uma Fusão = os materiais dela. */
function materiaisDaFusao(descOf, id) {
  const primeira = String(descOf?.(id) ?? '').split('\n')[0];
  if (!primeira.includes('+')) return [];
  return nomesCitados(primeira);
}

/**
 * Monta o deck.
 *
 * @param {Array<{card: object, copias: number}>} pool o que o jogador tem
 * @param {object} [opcoes]
 * @param {(id:number)=>string} [opcoes.descOf] texto da carta; sem ele, sem ritual e sem fusão
 * @param {object} [opcoes.alvo] sobrescreve o {@link ALVO}
 * @returns {{main:number[], extra:number[], relatorio:string[]}}
 */
export function montarAuto(pool, { descOf, alvo: alvoIn } = {}) {
  const alvo = { ...ALVO, ...(alvoIn ?? {}) };
  const relatorio = [];

  const limpo = (pool ?? [])
    .filter((p) => p?.card && Number(p.copias) > 0)
    // Carta importada do card maker não tem Lua: entra no deck e o motor a
    // ignora. Um deck com ela é um deck menor do que parece.
    .filter((p) => !(p.card.tags ?? []).includes('sem-efeito'))
    .map((p) => ({ card: p.card, copias: Math.min(Number(p.copias), RULES.MAX_COPIES) }));

  const doExtra = limpo.filter((p) => isExtraDeck(p.card));
  const doMain = limpo.filter((p) => !isExtraDeck(p.card));

  const monstros = doMain.filter((p) => ehMonstro(p.card) && !ehRitualMonstro(p.card))
    .map((p) => ({ ...p, nota: notaMonstro(p.card) }))
    .sort((a, b) => b.nota - a.nota);

  const magias = doMain.filter((p) => ehMagia(p.card) && !ehRitualMagia(p.card))
    .map((p) => ({ ...p, nota: notaEfeito(descOf?.(p.card.id)) }))
    .sort((a, b) => b.nota - a.nota);

  const armadilhas = doMain.filter((p) => ehArmadilha(p.card))
    .map((p) => ({ ...p, nota: notaEfeito(descOf?.(p.card.id)) }))
    .sort((a, b) => b.nota - a.nota);

  const main = [];
  let comTributo = 0;

  /** Põe até `quantas` cópias, respeitando o teto de tributos. */
  function levar(p, quantas, motivo) {
    const lv = Number(p.card.lv) || 0;
    const pesado = ehMonstro(p.card) && lv >= 5;
    let postas = 0;
    for (let i = 0; i < quantas; i++) {
      if (main.length >= alvo.main) break;
      if (pesado && comTributo >= alvo.comTributo) break;
      main.push(Number(p.card.id));
      if (pesado) comTributo++;
      postas++;
    }
    if (postas > 0) relatorio.push(`${postas}× ${p.card.name} — ${motivo}`);
    return postas;
  }

  // --- 1. RITUAIS primeiro: eles trazem a magia junto e mexem no orçamento.
  const ritMonstros = doMain.filter((p) => ehRitualMonstro(p.card))
    .map((p) => ({ ...p, nota: notaMonstro(p.card) }))
    .sort((a, b) => b.nota - a.nota);
  const ritMagias = doMain.filter((p) => ehRitualMagia(p.card));

  for (const rm of ritMonstros.slice(0, 2)) {
    const magia = descOf ? magiaDoRitual(rm.card, ritMagias, descOf) : null;
    if (!magia) {
      relatorio.push(`✗ ${rm.card.name} ficou de fora — sem a magia de ritual dele, seria carta morta`);
      continue;
    }
    const q = Math.min(rm.copias, 2);
    levar(rm, q, `Ritual (ATK ${rm.card.atk})`);
    // A magia acompanha, uma para cada monstro: ter o ritual sem a magia na mão
    // é o mesmo que não ter o ritual.
    levar(magia, Math.min(magia.copias, q), `a magia que invoca ${rm.card.name}`);
  }

  // --- 2. MONSTROS até a cota.
  const cotaMon = alvo.monstros - main.length;
  for (const p of monstros) {
    if (main.filter((id) => temTipo(id, limpo, ehMonstro)).length >= alvo.monstros) break;
    if (main.length >= alvo.main) break;
    const falta = alvo.monstros - main.filter((id) => temTipo(id, limpo, ehMonstro)).length;
    if (falta <= 0) break;
    const lv = Number(p.card.lv) || 0;
    const rotulo = lv >= 5 ? `ATK ${p.card.atk}, custa ${lv >= 7 ? 2 : 1} tributo` : `ATK ${p.card.atk}, sem tributo`;
    levar(p, Math.min(p.copias, falta), rotulo);
  }
  void cotaMon;

  // --- 3. MAGIAS e 4. ARMADILHAS.
  for (const [lista, cota, nome] of [[magias, alvo.magias, 'magia'], [armadilhas, alvo.armadilhas, 'armadilha']]) {
    let postas = 0;
    for (const p of lista) {
      if (postas >= cota || main.length >= alvo.main) break;
      postas += levar(p, Math.min(p.copias, cota - postas), `${nome} (nota ${p.nota})`);
    }
  }

  // --- 5. COMPLETO os 40 com o que sobrou, na ordem de nota.
  if (main.length < alvo.main) {
    const resto = [...monstros, ...magias, ...armadilhas].sort((a, b) => b.nota - a.nota);
    for (const p of resto) {
      if (main.length >= alvo.main) break;
      const jaTem = main.filter((id) => id === Number(p.card.id)).length;
      const podeMais = Math.min(p.copias, RULES.MAX_COPIES) - jaTem;
      if (podeMais > 0) levar(p, Math.min(podeMais, alvo.main - main.length), 'completando o deck');
    }
  }

  // --- 6. EXTRA: só Fusão, e só se a receita estiver de pé.
  const extra = [];
  const temPoly = doMain.some((p) => ehMagia(p.card) && /fusion summon/i.test(descOf?.(p.card.id) ?? ''));
  if (descOf && temPoly) {
    const nomesNoMain = new Set(main.map((id) => limpo.find((p) => Number(p.card.id) === id)?.card?.name));
    for (const p of doExtra) {
      if (extra.length >= RULES.EXTRA_MAX) break;
      if (!/Fusion/.test(p.card.tl ?? '')) continue;
      const mats = materiaisDaFusao(descOf, p.card.id);
      if (!mats.length || !mats.every((n) => nomesNoMain.has(n))) continue;
      extra.push(Number(p.card.id));
      relatorio.push(`1× ${p.card.name} (Extra) — os materiais estão no deck`);
    }
  } else if (doExtra.length) {
    relatorio.push('✗ Extra Deck vazio — sem uma magia de Fusão, nada de lá seria invocável');
  }

  if (main.length < RULES.MAIN_MIN) {
    relatorio.push(`⚠ só deu para ${main.length} cartas — o mínimo é ${RULES.MAIN_MIN}. Abra mais boosters.`);
  }
  return { main, extra, relatorio };
}

/** A carta deste id é do tipo dado? (o pool é a única fonte que sabe). */
function temTipo(id, pool, teste) {
  const p = pool.find((x) => Number(x.card.id) === Number(id));
  return p ? teste(p.card) : false;
}
