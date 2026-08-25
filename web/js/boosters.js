/**
 * Boosters — coleções de cartas organizadas por RARIDADE (UR/SR/R/N), no lugar
 * das zonas Main/Extra de um deck. Servem para dar "raridade" às cartas: ao
 * salvar um booster, cada carta ganha as tags `[nome do booster]` e `[raridade]`,
 * que passam a aparecer no filtro de tag do Deck Builder e como selo na carta.
 *
 * Persistência: `localStorage` (preso ao navegador) + export/import `.json` — é
 * o `.json` que faz o booster (e as raridades) "sobreviverem fora" desta máquina.
 * Quando houver backend, só esta camada muda. Espelha o papel de storage.js.
 */

import { pushFile, pushFileGuardado, pullFileEx } from '/web/js/projectstore.js';
// A CONTA das chances mora fora daqui de propósito: sem `localStorage` e sem
// `projectstore`, ela é importável no Node e tem teste (`pacote.test.mjs`).
// Reexportada para quem já importava `PACK_ODDS` daqui continuar funcionando.
import { PACK_ODDS, totalDoPacote } from './pacote.js';
export { PACK_ODDS, chancesDoPacote, totalDoPacote, CASCATA } from './pacote.js';

/** Raridades, da mais alta para a mais baixa (a ordem importa: define a "maior"). */
export const RARITIES = ['UR', 'SR', 'R', 'N'];

export const RARITY_LABEL = {
  UR: 'Ultra Rare',
  SR: 'Super Rare',
  R: 'Rare',
  N: 'Normal',
};

const KEY = 'ygo:boosters';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
}

/**
 * Mesma trava da carteira: só espelha depois de ter lido o disco. Um booster
 * criado antes disso ficaria só no navegador — que foi exatamente como o
 * "Origem do Caos" se perdeu na primeira transferência de máquina.
 */
let leuODisco = false;

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    pushFileGuardado('boosters', list, leuODisco);   // store/boosters.json (vai no git)
    return true;
  } catch (e) {
    console.error('[boosters] falha ao gravar', e);
    return false;
  }
}

/** Traz store/boosters.json (disco) para o localStorage. Chame no boot. */
export async function hydrateBoosters() {
  const { alcancou, data } = await pullFileEx('boosters');
  leuODisco = alcancou;
  if (!alcancou) {
    console.warn('[boosters] sem servidor: usando só o localStorage, sem gravar no disco');
    return false;
  }
  if (data === null || data === undefined) return false;
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch { return false; }
}

/**
 * Devolve ao disco o que já existe no navegador. Serve para RESGATAR boosters
 * que ficaram só no localStorage (criados antes do espelhamento existir).
 */
export function salvarNoProjeto() {
  const list = read();
  if (!leuODisco) return { ok: false, motivo: 'o disco ainda não foi lido' };
  pushFile('boosters', list);
  return { ok: true, quantos: list.length };
}

// `PACK_ODDS` (o peso de cada raridade) e a CASCATA que o servidor segue quando
// a gaveta sorteada está vazia moram em `pacote.js` e são reexportados no topo.
// A UR continua "ultra rara": 0,4%/carta → ~2% por pacote de 5 → em média ~50
// pacotes (~5000 DP) por UR.
/** Quantas cartas saem por pacote. */
export const PACK_SIZE = 5;
/** Preço padrão de um pacote (o booster pode ter o seu). */
export const DEFAULT_PRICE = 100;
/**
 * A cada N pacotes deste booster, 1 SR garantida.
 *
 * Foi 10, virou 20 quando a taxa de SR foi cortada, e voltou a 10 agora que ela
 * subiu (38 → 80) — as duas sempre andaram juntas, e mexer só numa deixa o
 * efeito pela metade.
 *
 * **O múltiplo de 20 dispara as DUAS garantias** (SR a cada 10, UR a cada 20), e
 * é por isso que elas ocupam cartas diferentes no pacote: a UR na 1, a SR na 2.
 * Com as duas mirando a carta 1, a UR vencia o `elsif` e a SR garantida sumia
 * calada em todo múltiplo de 20 — o jogador perdia uma garantia sem nunca saber
 * que ela existiu. Ver `abrir_pacote` (migration 0046).
 */
export const PITY_EVERY = 10;
/**
 * A cada este tanto de DP gasto em pacotes, 1 UR garantida — em QUALQUER
 * booster que tenha UR. É piso, não fonte: a chance normal já dá ~1 UR a cada
 * Contado em PACOTES do MESMO booster, e ZERADO sempre que uma UR sai — seja
 * ela natural ou garantida. É o que faz disto um PISO ("você nunca passa 20
 * pacotes sem UR") e não um bônus: um contador que só somasse entregaria a
 * garantida no 20º mesmo tendo saído uma natural no 19º.
 *
 *   taxa natural: 10,07% por pacote (~1 a cada 9,9)
 *   com o piso:   nunca mais de 30 — ele dispara em ~4% dos casos
 *
 * ERA MEDIDO EM DP (10.000). Saiu por duas razões: era um alvo móvel — o
 * balanceamento de preços mudaria a promessa sem ninguém tocar nela — e era
 * ilegível, porque "faltam 7600 DP" não responde à pergunta que o jogador faz,
 * que é *quantos pacotes ainda*.
 *
 * POR BOOSTER, e não global como o DP era: um contador global de PACOTES é
 * explorável (19 pacotes no booster barato, o 20º no caro, levando a UR dele
 * de graça). Com o DP isso não existia, porque o barato somava menos — trocar
 * a unidade sem trocar o escopo abriria a brecha.
 */
export const UR_PITY_PACKS = 30;

/** Garante o formato { name, coverId, inShop, price, order, cards:{...}, updatedAt }. */
export function normalize(b = {}) {
  const cards = {};
  for (const r of RARITIES) {
    cards[r] = Array.isArray(b.cards?.[r]) ? b.cards[r].map(Number).filter(Boolean) : [];
  }
  const price = Number(b.price);
  const order = Number(b.order);
  return {
    name: (b.name ?? 'Novo Booster').toString(),
    coverId: b.coverId ? Number(b.coverId) : null,   // carta que ilustra/define o booster
    inShop: !!b.inShop,                               // exposto na Loja?
    price: Number.isFinite(price) && price >= 0 ? Math.round(price) : DEFAULT_PRICE,
    order: Number.isFinite(order) ? Math.round(order) : 0,   // prioridade na vitrine
    cards,
    updatedAt: b.updatedAt ?? null,
  };
}

/** Booster vazio. */
export function emptyBooster(name = 'Novo Booster') {
  return normalize({ name });
}

export function listBoosters() {
  return read();
}

/**
 * Ordem em que os boosters devem APARECER: `order` crescente (menor = primeiro),
 * empate resolvido pelo nome. Cada item leva o `index` original, porque é ele
 * que identifica o booster para salvar/excluir — a posição na vitrine não pode
 * virar identidade, senão mudar a ordem passaria a editar o booster errado.
 */
export function listBoostersOrdered() {
  return read()
    .map((b, index) => ({ ...b, index }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'));
}

export function getBoosterAt(i) {
  return read()[i] ?? null;
}

/** Salva (novo se index null/inválido) e devolve o índice gravado. */
export function saveBooster(booster, index = null) {
  const list = read();
  const rec = normalize({ ...booster, updatedAt: new Date().toISOString() });
  if (index === null || index < 0 || index >= list.length) {
    list.push(rec);
    write(list);
    return list.length - 1;
  }
  list[index] = rec;
  write(list);
  return index;
}

export function deleteBooster(index) {
  const list = read();
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  write(list);
  return true;
}

/** Total de cartas (todas as raridades) de um booster. */
export function boosterSize(b) {
  return totalDoPacote(b?.cards);   // a mesma conta de `pacote.js`, num lugar so'
}

// ------------------------------------------------------- loja / pacotes

/** Boosters expostos na Loja (inShop, com carta), já na ordem de prioridade. */
export function listShopBoosters() {
  return listBoostersOrdered().filter((b) => b.inShop && boosterSize(b) > 0);
}

/** Liga/desliga a exposição de um booster na Loja (por índice). Persiste. */
export function setInShop(index, on) {
  const list = read();
  if (index < 0 || index >= list.length) return false;
  list[index].inShop = !!on;
  write(list);
  return true;
}

/**
 * Abre um pacote: sorteia PACK_SIZE cartas do booster.
 *
 * **NÃO é este o sorteio do jogo.** Quem abre pacote é o banco
 * (`abrir_pacote()`, migration 0004/0023) desde que a economia saiu do cliente
 * — enquanto o sorteio rodava aqui, quem chamasse a API na mão podia pular o
 * `spendDP` e creditar as cartas do mesmo jeito. Esta função ficou sem chamador
 * nenhum; ela vale como referência do formato do resultado.
 *
 * E ela nem sorteia igual: aqui as raridades presentes são RENORMALIZADAS, e o
 * servidor em vez disso DESCE pela cascata (ver `pacote.js`). Quem quiser saber
 * a chance que a tela deve mostrar usa `chancesDoPacote`, não esta função.
 */
export function openPack(booster, n = PACK_SIZE, { guaranteeSR = false, guaranteeUR = false } = {}) {
  const buckets = RARITIES.filter((r) => booster.cards[r]?.length);
  if (!buckets.length) return [];
  const total = buckets.reduce((s, r) => s + PACK_ODDS[r], 0);
  const pulls = [];
  for (let i = 0; i < n; i++) {
    let roll = Math.random() * total;
    let chosen = buckets[buckets.length - 1];
    for (const r of buckets) { roll -= PACK_ODDS[r]; if (roll <= 0) { chosen = r; break; } }
    const pool = booster.cards[chosen];
    pulls.push({ id: pool[Math.floor(Math.random() * pool.length)], rarity: chosen });
  }
  // A UR vem primeiro de propósito: se ela entrar, a garantia de SR já está
  // satisfeita (aplicarSRGarantida desiste quando o pacote tem SR ou UR) e o
  // jogador não gasta os dois contadores no mesmo pacote.
  if (guaranteeUR) aplicarURGarantida(booster, pulls);
  if (guaranteeSR) aplicarSRGarantida(booster, pulls);
  return pulls;
}

/**
 * Garante uma UR substituindo a carta de MENOR raridade do pacote. Se o pacote
 * já trouxe UR (ou o booster não tem UR), não faz nada — e é por isso que quem
 * chama deve conferir `guaranteedUR` antes de descontar o contador de DP, senão
 * um booster sem UR queimaria os 10.000 do jogador sem entregar nada.
 */
function aplicarURGarantida(booster, pulls) {
  const ur = booster.cards.UR;
  if (!ur?.length) return;
  if (pulls.some((p) => p.rarity === 'UR')) return;
  for (const r of ['N', 'R', 'SR']) {                  // sempre sacrificar a mais baixa
    const i = pulls.findIndex((p) => p.rarity === r);
    if (i >= 0) {
      pulls[i] = { id: ur[Math.floor(Math.random() * ur.length)], rarity: 'UR', guaranteed: true, guaranteedUR: true };
      return;
    }
  }
}

/**
 * Garante uma SR no pacote SUBSTITUINDO a carta de menor raridade (N; se não
 * houver N, uma R) — NUNCA uma SR ou UR. Se o pacote já trouxe SR/UR (ou o
 * booster não tem SR), não faz nada: a garantia (nível SR+) já está satisfeita.
 */
function aplicarSRGarantida(booster, pulls) {
  const sr = booster.cards.SR;
  if (!sr?.length) return;
  if (pulls.some((p) => p.rarity === 'SR' || p.rarity === 'UR')) return;
  for (const r of ['N', 'R']) {                       // preferir N, depois R
    const i = pulls.findIndex((p) => p.rarity === r);
    if (i >= 0) {
      pulls[i] = { id: sr[Math.floor(Math.random() * sr.length)], rarity: 'SR', guaranteed: true };
      return;
    }
  }
}

// ------------------------------------------------------- raridade das cartas

/**
 * Índice cartaId → { rarity, boosters:[nomes] } considerando TODOS os boosters
 * salvos. `rarity` é a MAIOR raridade em que a carta aparece (para o selo).
 */
export function rarityIndex() {
  const idx = new Map();
  for (const b of read()) {
    for (const r of RARITIES) {
      for (const id of b.cards[r]) {
        const cur = idx.get(id);
        if (!cur) {
          idx.set(id, { rarity: r, boosters: [b.name] });
        } else {
          if (!cur.boosters.includes(b.name)) cur.boosters.push(b.name);
          // mantém a MAIOR raridade (menor índice em RARITIES)
          if (RARITIES.indexOf(r) < RARITIES.indexOf(cur.rarity)) cur.rarity = r;
        }
      }
    }
  }
  return idx;
}

/** A maior raridade da carta, ou null se ela não está em nenhum booster. */
export function rarityOf(id) {
  return rarityIndex().get(Number(id))?.rarity ?? null;
}

/**
 * Onde a carta já aparece em OUTROS boosters — a trava do reprint.
 *
 * Uma carta pode ser reimpressa em quantos pacotes quiser, mas sempre na MESMA
 * raridade: sem isso, uma UT de um booster entra como N no seguinte e o valor
 * dela (e o preço de venda no Inventário, que lê `rarityIndex`) muda conforme o
 * pacote de onde ela caiu. A raridade é da carta, não do pacote.
 *
 * `exceto` é o índice do booster sendo editado — ele não conta como "outro".
 * Passe `null` para um booster ainda não salvo, que naturalmente não está na
 * lista.
 *
 * @returns {{rarity: string, boosters: string[]}|null}
 */
export function reprintsOf(id, exceto = null) {
  id = Number(id);
  let rarity = null;
  const boosters = [];

  read().forEach((b, i) => {
    if (i === exceto) return;
    for (const r of RARITIES) {
      if (!b.cards[r].includes(id)) continue;
      boosters.push(b.name);
      // Dados antigos podem ter a mesma carta em raridades diferentes; a MAIOR
      // vence, para a trava nunca rebaixar uma carta.
      if (!rarity || RARITIES.indexOf(r) < RARITIES.indexOf(rarity)) rarity = r;
      break;
    }
  });

  return rarity ? { rarity, boosters } : null;
}

/** As tags que uma carta ganha dos boosters: nomes dos boosters + raridades. */
export function tagsForCard(id, idx = rarityIndex()) {
  const info = idx.get(Number(id));
  if (!info) return [];
  return [...info.boosters.map(tagify), info.rarity.toLowerCase()];
}

/** Todas as tags que os boosters introduzem (para popular o select de tags). */
export function allBoosterTags() {
  const tags = new Set();
  for (const b of read()) {
    if (boosterSize(b) > 0) tags.add(tagify(b.name));
    for (const r of RARITIES) if (b.cards[r].length) tags.add(r.toLowerCase());
  }
  return [...tags];
}

/**
 * Anota as entradas do índice em memória (`db`) com as tags de raridade/booster,
 * mesclando com quaisquer tags que a carta já tenha (ex.: customizadas). Assim o
 * filtro por tag e o selo funcionam de forma uniforme, sem o builder saber de
 * onde a tag veio. Chame depois de carregar o db (e após salvar um booster).
 */
export function annotateDb(db) {
  const idx = rarityIndex();
  for (const [id, info] of idx) {
    const brief = db.brief(id);
    if (!brief) continue;
    const extra = [...info.boosters.map(tagify), info.rarity.toLowerCase()];
    const base = (brief.tags ?? []).filter((t) => !RARITIES.some((r) => r.toLowerCase() === t));
    brief.tags = [...new Set([...base, ...extra])];
    brief.rarity = info.rarity;
  }
}

/** Nome de booster → tag (minúsculo, como as demais tags). */
function tagify(name) {
  return String(name || '').trim().toLowerCase();
}

// ------------------------------------------------------- export / import

/** Dispara o download do booster como `.json` (sobrevive fora do navegador). */
export function downloadBooster(booster) {
  const rec = normalize(booster);
  const safe = (rec.name || 'booster').replace(/[^\w\-. ]+/g, '_').trim() || 'booster';
  const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.booster.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Abre um seletor de arquivo e devolve o booster lido (ou null). */
export function importBoosterFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const rec = normalize(JSON.parse(await file.text()));
        if (!rec.name || rec.name === 'Novo Booster') {
          rec.name = file.name.replace(/\.(booster\.)?json$/i, '') || 'Booster importado';
        }
        resolve(rec);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
