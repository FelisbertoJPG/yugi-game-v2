/**
 * API de consulta sobre o banco local gerado por `tools/build.py`.
 *
 * Zero dependências. Funciona em Node (>=18) e no browser — a única diferença
 * é a origem dos arquivos, resolvida por `fetch` em ambos os casos (Node 18+
 * tem fetch nativo, inclusive para file://? não: em Node use `loadFromDisk`).
 *
 *   // browser / servidor http
 *   const db = await YgoDB.load('/data');
 *
 *   // node, lendo do disco
 *   const db = await YgoDB.loadFromDisk('./data');
 */

const DEFAULT_LIMIT = 50;

export class YgoDB {
  #cards = new Map();
  #index = [];
  #archetypes = new Map();
  #scripts = new Map();
  #meta = null;
  #baseUrl = '';
  #full = false;

  constructor({ cards, index, archetypes, scripts, meta, baseUrl = '' }) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#meta = meta ?? null;
    this.#index = index ?? [];

    if (cards) {
      this.#full = true;
      for (const c of cards) this.#cards.set(c.id, c);
      if (!index) {
        this.#index = cards.map((c) => ({
          id: c.id, name: c.name, t: c.cardType?.[0], tl: c.typeLabel,
          atk: c.atk, def: c.def, lv: c.level, at: c.attribute, r: c.race,
          a: (c.archetypes ?? []).map((x) => x.name || x.hex),
          alt: c.isAlternateArt ? 1 : 0,
        }));
      }
    }
    if (archetypes) {
      for (const [code, name] of Object.entries(archetypes)) {
        this.#archetypes.set(Number(code), name);
      }
    }
    if (scripts) {
      for (const [id, path] of Object.entries(scripts)) {
        this.#scripts.set(Number(id), path);
      }
    }
  }

  /** Carrega via HTTP (browser ou servidor). `full: false` puxa só o índice. */
  static async load(baseUrl = './data', { full = true } = {}) {
    const base = baseUrl.replace(/\/$/, '');
    const get = async (f) => {
      const res = await fetch(`${base}/${f}`);
      if (!res.ok) throw new Error(`Falha ao carregar ${f}: ${res.status}`);
      return res.json();
    };
    const [index, archetypes, scripts, meta] = await Promise.all([
      get('cards.index.json'), get('archetypes.json'),
      get('scripts.index.json'), get('meta.json'),
    ]);
    const cards = full ? await get('cards.json') : null;
    return new YgoDB({ cards, index, archetypes, scripts, meta, baseUrl: base });
  }

  /** Carrega do disco em Node, sem servidor HTTP. */
  static async loadFromDisk(dir = './data', { full = true } = {}) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const get = async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
    const [index, archetypes, scripts, meta] = await Promise.all([
      get('cards.index.json'), get('archetypes.json'),
      get('scripts.index.json'), get('meta.json'),
    ]);
    const cards = full ? await get('cards.json') : null;
    return new YgoDB({ cards, index, archetypes, scripts, meta, baseUrl: dir });
  }

  get meta() { return this.#meta; }
  get size() { return this.#index.length; }
  get isFull() { return this.#full; }

  /** Carta completa por id. Exige ter carregado com `full: true`. */
  get(id) { return this.#cards.get(Number(id)) ?? null; }

  /** Entrada enxuta do índice por id (sempre disponível). */
  brief(id) { return this.#index.find((c) => c.id === Number(id)) ?? null; }

  /**
   * Busca exata por nome. Cartas com arte alternativa compartilham o nome do
   * original; devolvemos sempre a impressão canônica (alias === 0), que é a
   * que tem o script Lua e a que o motor espera receber.
   */
  byName(name) {
    const needle = String(name).toLowerCase();
    const hits = this.#index.filter((c) => c.name.toLowerCase() === needle);
    if (!hits.length) return null;
    const hit = hits.find((c) => !c.alt) ?? hits[0];
    return this.get(hit.id) ?? hit;
  }

  /**
   * Busca por substring no nome. Ordena por: prefixo exato > início de
   * palavra > qualquer posição, e depois alfabeticamente.
   * Por padrão esconde artes alternativas — passe `includeAlt: true` para vê-las.
   */
  search(query, { limit = DEFAULT_LIMIT, includeAlt = false } = {}) {
    const q = String(query).trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const c of this.#index) {
      if (!includeAlt && c.alt) continue;
      const n = c.name.toLowerCase();
      const at = n.indexOf(q);
      if (at === -1) continue;
      const score = at === 0 ? 0 : /\s|-/.test(n[at - 1] ?? '') ? 1 : 2;
      scored.push([score, c.name, c]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    return scored.slice(0, limit).map((s) => s[2]);
  }

  /**
   * Filtro estruturado sobre o índice.
   * Campos: cardType ('Monster'|'Spell'|'Trap'), race, attribute,
   * level, levelMin, levelMax, atkMin, atkMax, archetype, name,
   * types (lista de flags, exige `full`), hasScript (exige `full`).
   * Artes alternativas ficam fora por padrão (`includeAlt: true` inclui).
   */
  filter(criteria = {}, { limit = Infinity, includeAlt = false } = {}) {
    const {
      cardType, race, attribute, level, levelMin, levelMax,
      atkMin, atkMax, archetype, name, types, hasScript,
    } = criteria;

    const out = [];
    for (const c of this.#index) {
      if (!includeAlt && c.alt) continue;
      if (cardType && c.t !== cardType[0]) continue;
      if (race && c.r !== race) continue;
      if (attribute && c.at !== attribute) continue;
      if (level != null && c.lv !== level) continue;
      if (levelMin != null && (c.lv == null || c.lv < levelMin)) continue;
      if (levelMax != null && (c.lv == null || c.lv > levelMax)) continue;
      if (atkMin != null && (c.atk == null || c.atk < atkMin)) continue;
      if (atkMax != null && (c.atk == null || c.atk > atkMax)) continue;
      if (archetype && !c.a.some((a) => a?.toLowerCase() === archetype.toLowerCase())) continue;
      if (name && !c.name.toLowerCase().includes(name.toLowerCase())) continue;

      if (types || hasScript != null) {
        const fullCard = this.get(c.id);
        if (!fullCard) continue;
        if (types && !types.every((t) => fullCard.types.includes(t))) continue;
        if (hasScript != null && fullCard.hasScript !== hasScript) continue;
      }

      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Todas as cartas de um arquétipo, pelo nome ('Blue Eyes'). */
  archetype(name) {
    return this.filter({ archetype: name });
  }

  /** Lista de arquétipos conhecidos, ordenada. */
  archetypeNames() {
    return [...new Set(this.#archetypes.values())].sort();
  }

  /** Caminho do script Lua da carta, ou null se ela não tiver (ex.: vanilla). */
  scriptPath(id) {
    const p = this.#scripts.get(Number(id));
    return p ? `${this.#baseUrl}/${p}` : null;
  }

  /** Busca o conteúdo do script Lua (browser/HTTP). */
  async scriptSource(id) {
    const p = this.scriptPath(id);
    if (!p) return null;
    const res = await fetch(p);
    return res.ok ? res.text() : null;
  }

  /** N cartas aleatórias, opcionalmente filtradas. Útil para pools de NPC. */
  random(n = 1, criteria = null) {
    const pool = criteria ? this.filter(criteria) : this.#index;
    if (!pool.length) return [];
    const picked = [];
    const seen = new Set();
    const take = Math.min(n, pool.length);
    while (picked.length < take) {
      const i = Math.floor(Math.random() * pool.length);
      if (seen.has(i)) continue;
      seen.add(i);
      picked.push(pool[i]);
    }
    return picked;
  }

  /** URL da arte da carta no ygoprodeck (o cdb não guarda imagens). */
  static artUrl(id, { small = false } = {}) {
    const folder = small ? 'cards_small' : 'cards';
    return `https://images.ygoprodeck.com/images/${folder}/${id}.jpg`;
  }
}

export default YgoDB;
