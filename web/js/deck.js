/**
 * Modelo de deck e validação pelas regras oficiais de construção.
 *
 * Regras aplicadas (sem banlist, como pedido):
 *   - Main Deck: 40 a 60 cartas
 *   - Extra Deck: 0 a 15 cartas
 *   - Máximo de 3 cópias da mesma carta, somando Main + Extra
 *   - Sem Side Deck
 *
 * Nota sobre "sem banlist": a lista de Proibidas/Limitadas é o que estamos
 * ignorando. O limite de 3 cópias NÃO é banlist — é regra base do jogo, então
 * continua valendo. As artes alternativas contariam como a mesma carta, mas
 * elas já ficam fora do pool (o índice as marca com `alt`).
 */

export const RULES = {
  MAIN_MIN: 40,
  MAIN_MAX: 60,
  EXTRA_MAX: 15,
  MAX_COPIES: 3,
};

/**
 * Uma carta vai para o Extra Deck se for Fusion, Synchro, Xyz ou Link.
 * Pendulum sozinho é Main Deck (só vai para o Extra ao ser destruída em campo,
 * o que é regra de duelo, não de construção).
 *
 * Derivado de `typeLabel`, que é gerado pelo build.py e tem formato estável
 * (ex.: "Link/Effect Monster", "Xyz/Pendulum/Effect Monster").
 */
export function isExtraDeck(card) {
  const tl = card?.tl ?? card?.typeLabel ?? '';
  return /\b(Fusion|Synchro|Xyz|Link)\b/.test(tl);
}

export class Deck {
  /** @param {{name?: string, main?: number[], extra?: number[]}} init */
  constructor(init = {}) {
    this.name = init.name ?? 'Novo Deck';
    this.main = [...(init.main ?? [])];
    this.extra = [...(init.extra ?? [])];
  }

  get size() { return this.main.length + this.extra.length; }

  /** Quantas cópias desta carta existem no deck inteiro. */
  copies(id) {
    id = Number(id);
    return this.main.filter((x) => x === id).length
         + this.extra.filter((x) => x === id).length;
  }

  /**
   * Adiciona uma carta, roteando para Main ou Extra automaticamente.
   * @returns {{ok: boolean, zone?: 'main'|'extra', reason?: string}}
   */
  add(card) {
    const id = Number(card.id);
    const zone = isExtraDeck(card) ? 'extra' : 'main';

    if (this.copies(id) >= RULES.MAX_COPIES) {
      return { ok: false, reason: `máximo de ${RULES.MAX_COPIES} cópias por carta` };
    }
    if (zone === 'main' && this.main.length >= RULES.MAIN_MAX) {
      return { ok: false, reason: `Main Deck cheio (${RULES.MAIN_MAX})` };
    }
    if (zone === 'extra' && this.extra.length >= RULES.EXTRA_MAX) {
      return { ok: false, reason: `Extra Deck cheio (${RULES.EXTRA_MAX})` };
    }

    this[zone].push(id);
    return { ok: true, zone };
  }

  /** Remove UMA cópia da carta da zona indicada. */
  remove(id, zone) {
    id = Number(id);
    const i = this[zone].indexOf(id);
    if (i === -1) return false;
    this[zone].splice(i, 1);
    return true;
  }

  /** Remove todas as cópias de uma carta. */
  removeAll(id, zone) {
    id = Number(id);
    const before = this[zone].length;
    this[zone] = this[zone].filter((x) => x !== id);
    return before !== this[zone].length;
  }

  /** Agrupa uma zona em [{id, count}], preservando a ordem de inserção. */
  grouped(zone) {
    const seen = new Map();
    for (const id of this[zone]) seen.set(id, (seen.get(id) ?? 0) + 1);
    return [...seen].map(([id, count]) => ({ id, count }));
  }

  /**
   * Valida contra as regras oficiais de construção.
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate() {
    const errors = [];
    if (this.main.length < RULES.MAIN_MIN) {
      errors.push(`Main Deck tem ${this.main.length} cartas; o mínimo é ${RULES.MAIN_MIN}`);
    }
    if (this.main.length > RULES.MAIN_MAX) {
      errors.push(`Main Deck tem ${this.main.length} cartas; o máximo é ${RULES.MAIN_MAX}`);
    }
    if (this.extra.length > RULES.EXTRA_MAX) {
      errors.push(`Extra Deck tem ${this.extra.length} cartas; o máximo é ${RULES.EXTRA_MAX}`);
    }
    for (const [id, n] of countBy([...this.main, ...this.extra])) {
      if (n > RULES.MAX_COPIES) {
        errors.push(`carta ${id} aparece ${n} vezes; o máximo é ${RULES.MAX_COPIES}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  clone() {
    return new Deck({ name: this.name, main: this.main, extra: this.extra });
  }

  toJSON() {
    return { name: this.name, main: this.main, extra: this.extra };
  }

  /**
   * Exporta no formato .ydk do ygopro — é o que o ocgcore consome, então vale
   * manter compatibilidade.
   *
   * O .ydk só tem campo para os ids das cartas. Metadados nossos (nome do deck,
   * de qual NPC é, qual carta ele dropa) vão como comentários `#chave valor`:
   * qualquer parser de .ydk ignora linhas que começam com `#`, então o arquivo
   * continua válido para o YGOPro/EDOPro, e nós conseguimos ler de volta.
   */
  toYdk(meta = {}) {
    const lines = ['#created by yugi-game-v2'];

    // `main` e `extra` são marcadores estruturais do formato — não podem virar
    // metadado, senão o arquivo fica ambíguo.
    const all = { name: this.name, ...meta };
    for (const [k, v] of Object.entries(all)) {
      if (RESERVED_YDK_KEYS.has(k.toLowerCase())) continue;
      if (v === null || v === undefined || v === '') continue;
      lines.push(`#${k} ${String(v).replace(/[\r\n]+/g, ' ')}`);
    }

    lines.push('#main');
    lines.push(...this.main);
    lines.push('#extra');
    lines.push(...this.extra);
    lines.push('!side');       // sem side deck, mas o marcador faz parte do formato
    return lines.join('\n') + '\n';
  }

  /**
   * Lê um .ydk. Ignora o que não for id numérico e recupera os metadados
   * `#chave valor` em `deck.meta`. Um .ydk de outra ferramenta simplesmente
   * volta com `meta` vazio.
   */
  static fromYdk(text, name = 'Deck importado') {
    const deck = new Deck({ name });
    deck.meta = {};
    let zone = null;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#main')) { zone = 'main'; continue; }
      if (line.startsWith('#extra')) { zone = 'extra'; continue; }
      if (line.startsWith('!side')) { zone = null; continue; }

      if (line.startsWith('#')) {
        const m = /^#([a-z][\w-]*)\s+(.+)$/i.exec(line);
        if (m && !RESERVED_YDK_KEYS.has(m[1].toLowerCase())) {
          deck.meta[m[1].toLowerCase()] = m[2].trim();
        }
        continue;                                   // demais comentários
      }

      if (!zone) continue;                          // side deck: descartado
      const id = Number(line);
      if (Number.isInteger(id) && id > 0) deck[zone].push(id);
    }

    if (deck.meta.name) deck.name = deck.meta.name;
    return deck;
  }
}

/** Chaves que o formato .ydk usa como estrutura — não servem de metadado. */
const RESERVED_YDK_KEYS = new Set(['main', 'extra', 'side', 'created']);

function countBy(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
