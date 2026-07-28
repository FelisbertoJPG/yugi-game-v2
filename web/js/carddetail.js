/**
 * Janela de detalhes da carta — a mesma do navegador de cartas, reaproveitada
 * pelo Deck Builder e pela tela de duelo.
 *
 * Ela se injeta sozinha (markup + estilo) na primeira vez que é usada, para as
 * telas não precisarem repetir o HTML. O `cards.json` completo (~14 MB) só é
 * carregado quando alguém abre um detalhe pela primeira vez — o índice enxuto
 * basta para tudo o mais.
 */

import { YgoDB } from '/ygo-data/src/ygodb.js';

const ART = (id, small = false) =>
  `https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/${id}.jpg`;

let cfg = { db: null, artOf: null, descOf: null };
let fullDb = null;
let dlg = null;

/**
 * @param {object} o
 * @param {YgoDB}  o.db      índice já carregado pela tela (evita recarregar)
 * @param {Function} [o.artOf]  (id) => url, para cartas customizadas
 * @param {Function} [o.descOf] (id) => texto, para cartas customizadas
 */
export function configureCardDetail(o = {}) {
  cfg = { ...cfg, ...o };
}

function build() {
  if (dlg) return dlg;

  const style = document.createElement('style');
  style.textContent = `
    #card-dlg {
      background: var(--panel, #1a2032); color: var(--ink, #dde3f0);
      border: 2px solid var(--gold, #e8c46a); padding: 0;
      max-width: 620px; width: 92%;
    }
    #card-dlg::backdrop { background: #000b; }
    #card-dlg .body { display: flex; gap: 16px; padding: 16px; }
    #card-dlg img {
      width: 180px; flex: none; align-self: flex-start;
      border: 1px solid var(--line, #38425f); background: var(--panel2, #232b41);
    }
    #card-dlg h2 { margin: 0 0 4px; font-size: 16px; color: var(--gold, #e8c46a); }
    #card-dlg .sub { color: var(--blue, #6fa8dc); font-size: 11px; margin-bottom: 10px; }
    #card-dlg dl {
      display: grid; grid-template-columns: auto 1fr; gap: 3px 12px;
      margin: 0; font-size: 11px;
    }
    #card-dlg dt { color: var(--dim, #8b95ae); }
    #card-dlg dd { margin: 0; }
    #card-dlg .desc {
      font-size: 11px; white-space: pre-wrap; margin-top: 10px; padding-top: 8px;
      border-top: 1px solid var(--line, #38425f); max-height: 34vh; overflow: auto;
    }
    #card-dlg .foot {
      padding: 8px 16px; background: var(--panel2, #232b41);
      border-top: 1px solid var(--line, #38425f); text-align: right;
    }`;
  document.head.append(style);

  dlg = document.createElement('dialog');
  dlg.id = 'card-dlg';
  dlg.innerHTML = `
    <div class="body">
      <img alt="">
      <div style="min-width:0">
        <h2></h2>
        <div class="sub"></div>
        <dl></dl>
        <div class="desc"></div>
      </div>
    </div>
    <div class="foot"><button>fechar</button></div>`;
  dlg.querySelector('.foot button').onclick = () => dlg.close();
  // clicar fora fecha
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  return dlg;
}

/** Abre a janela de detalhes da carta. */
export async function showCardDetail(id) {
  id = Number(id);
  const d = build();
  const q = (s) => d.querySelector(s);

  const brief = cfg.db?.brief(id);
  const artCustom = cfg.artOf?.(id);

  q('img').src = artCustom || ART(id);
  q('h2').textContent = brief?.name ?? String(id);
  q('.sub').textContent = brief?.tl ?? '';
  q('dl').replaceChildren();
  q('.desc').textContent = '';
  if (!d.open) d.showModal();

  // Carta customizada não existe no cards.json: usa o que a tela souber dela.
  const descCustom = cfg.descOf?.(id);
  if (brief?.custom) {
    linhas(q('dl'), [
      ['id', id],
      ['tipo', brief.tl],
      ...(brief.t === 'M' ? [
        ['atributo', brief.at], ['tipo/raça', brief.r],
        ['nível', brief.lv], ['ATK / DEF', `${brief.atk ?? '?'} / ${brief.def ?? '?'}`],
      ] : []),
      ['origem', 'carta customizada (sem efeito em duelo)'],
    ]);
    q('.desc').textContent = descCustom || '(sem texto)';
    return;
  }

  if (!fullDb) {
    q('.desc').textContent = 'carregando…';
    try { fullDb = await YgoDB.load('/ygo-data/data', { full: true }); }
    catch { q('.desc').textContent = '(não consegui carregar o texto da carta)'; return; }
  }

  const c = fullDb.get(id);
  if (!c) { q('.desc').textContent = descCustom || '(carta não encontrada no banco)'; return; }
  if (q('h2').textContent !== c.name) return;   // trocou de carta enquanto carregava

  q('h2').textContent = c.name;
  q('.sub').textContent = c.typeLabel;

  const rows = [['id', c.id]];
  if (c.cardType === 'Monster') {
    rows.push(
      ['atributo', c.attribute], ['tipo', c.race],
      [c.levelLabel.toLowerCase(), c.level],
      ['ATK / DEF', `${c.atkLabel} / ${c.defLabel ?? '—'}`]);
    if (c.scales) rows.push(['escalas', `${c.scales.left} / ${c.scales.right}`]);
    if (c.linkArrows) rows.push(['markers', c.linkArrows.join(' ')]);
  }
  if (c.archetypes?.length) {
    rows.push(['arquétipos', c.archetypes.map((a) => a.name || a.hex).join(', ')]);
  }
  rows.push(['legal em', c.legal.join(' / ') || '—']);
  rows.push(['script lua', c.hasScript ? c.script : '(vanilla, sem script)']);

  linhas(q('dl'), rows);
  q('.desc').textContent = c.desc;
}

function linhas(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v ?? '—';
    return [dt, dd];
  }));
}
