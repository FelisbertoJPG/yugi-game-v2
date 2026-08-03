/**
 * Motor de arrastar/redimensionar do editor de campo (`web/campo.html`).
 *
 * Sem framework, Pointer Events puros — mesmo estilo do resto do projeto.
 * Este módulo só sabe de RETÂNGULOS num canvas lógico fixo (`CANVAS`, ver
 * `boards.js`); não sabe nada de cartas/duelo — quem alimenta o preview (arte,
 * contagens) é `campo.html`, via `setPreview()`.
 */

import { CANVAS, CARD_ASPECT, allZoneIds } from './boards.js';

const THRESHOLD = 8;      // unidades de canvas pra um snap "grudar"
const NUDGE = 1, NUDGE_FAST = 10;

/** Retângulo em unidades de canvas a partir de uma zona do board. */
function rectOf(zoneVal, kind) {
  if (kind === 'area') return { x: zoneVal.x, y: zoneVal.y, w: zoneVal.w, h: zoneVal.h };
  const w = zoneVal.size, h = zoneVal.size / CARD_ASPECT;
  return { x: zoneVal.x, y: zoneVal.y, w, h };
}

export function createEditor({ canvasEl, guidesEl, onChange, onSelect }) {
  const KINDS = new Map(allZoneIds().map((z) => [z.id, z]));
  let board = null;
  let els = new Map();          // id -> {root, art, handle}
  let selected = new Set();
  let scale = 1;
  let gridSize = null;
  let preview = null;           // { hand: {0:[codes],1:count}, deck:{0,1}, extra:{0,1}, gy:{0,1} }
  let drag = null;              // estado do gesto em andamento

  function setBoard(b) {
    board = b;
    selected.clear();
    rebuild();
    notifySelect();
  }
  function getBoard() { return board; }

  function setPreview(p) { preview = p; renderAll(); }

  function setGrid(size) { gridSize = size; }

  const bgImg = document.createElement('img');
  bgImg.className = 'ez-bg';

  /** Reconstrói os elementos (chamado quando o board muda de identidade —
   *  trocar de tabuleiro, resetar). Movimentos do dia a dia usam renderAll(). */
  function rebuild() {
    canvasEl.replaceChildren();
    canvasEl.append(bgImg);   // primeiro filho = atrás de tudo (ordem do DOM)
    els.clear();
    for (const { id, kind, label } of allZoneIds()) {
      const root = document.createElement('div');
      root.className = 'ez';
      root.dataset.zoneid = id;
      root.dataset.kind = kind;
      const art = document.createElement('div');
      art.className = 'ez-art';
      const tag = document.createElement('div');
      tag.className = 'ez-label';
      tag.textContent = label;
      const handle = document.createElement('div');
      handle.className = 'ez-handle';
      root.append(art, tag, handle);
      canvasEl.append(root);
      els.set(id, { root, art, handle });
      wireZone(id, root, handle);
    }
    renderAll();
  }

  /**
   * A escala vem do espaço DISPONÍVEL de verdade (`.canvas-wrap`), não do
   * elemento pai imediato — `#stage` é item de um flex container e "abraça"
   * o próprio conteúdo (`flex-basis: auto`), então medir `parentElement`
   * seria circular: o tamanho de `#canvas` dependeria do tamanho de `#stage`,
   * que por sua vez só reflete o tamanho atual de `#canvas`. `closest()` sobe
   * a árvore até achar o container real, robusto à profundidade do DOM.
   */
  function updateScale() {
    const viewport = canvasEl.closest('.canvas-wrap') ?? canvasEl.parentElement;
    const style = getComputedStyle(viewport);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = viewport.clientWidth - padX;
    const availH = viewport.clientHeight - padY;
    scale = Math.max(0.1, Math.min(availW / CANVAS.w, availH / CANVAS.h));
    canvasEl.style.width = `${CANVAS.w * scale}px`;
    canvasEl.style.height = `${CANVAS.h * scale}px`;
  }

  function renderAll() {
    if (!board) return;
    updateScale();
    if (board.background) {
      bgImg.src = board.background;
      bgImg.style.display = 'block';
      bgImg.style.width = `${CANVAS.w * scale}px`;
      bgImg.style.height = `${CANVAS.h * scale}px`;
    } else {
      bgImg.style.display = 'none';
    }
    for (const { id, kind } of allZoneIds()) {
      const zv = board.zones[id];
      const { root, art, handle } = els.get(id);
      if (!zv) { root.style.display = 'none'; continue; }
      root.style.display = '';
      const r = rectOf(zv, kind);
      root.style.left = `${r.x * scale}px`;
      root.style.top = `${r.y * scale}px`;
      root.style.width = `${r.w * scale}px`;
      root.style.height = `${r.h * scale}px`;
      root.classList.toggle('sel', selected.has(id));
      handle.hidden = false;
      renderPreviewInto(id, art);
    }
  }

  function renderPreviewInto(id, art) {
    art.replaceChildren();
    if (!preview) return;
    const [pStr, zone] = id.split(':');
    const p = Number(pStr.slice(1));
    if (zone === 'hand') {
      const cards = preview.hand?.[p];
      if (Array.isArray(cards)) {
        for (const url of cards.slice(0, 12)) {
          const img = document.createElement('img');
          img.className = 'ez-card';
          img.src = url;
          art.append(img);
        }
      } else if (typeof cards === 'number') {
        art.textContent = `${cards} carta(s)`;
      }
      return;
    }
    const counts = { deck: preview.deck, extra: preview.extra, gy: preview.gy };
    if (zone in counts && counts[zone]) {
      const n = counts[zone][p];
      if (n != null) art.textContent = String(n);
    }
  }

  // ------------------------------------------------------------ seleção ----

  function select(id, { additive = false } = {}) {
    if (additive) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
    } else if (!selected.has(id)) {
      selected = new Set([id]);
    }
    renderAll();
    notifySelect();
  }
  function clearSelection() { selected.clear(); renderAll(); notifySelect(); }
  function notifySelect() { onSelect?.([...selected]); }
  function getSelection() { return [...selected]; }

  // -------------------------------------------------------- arrastar/resize --

  function wireZone(id, root, handle) {
    root.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return;   // o handle cuida do próprio gesto
      e.preventDefault();
      if (e.shiftKey) { select(id, { additive: true }); return; }
      if (!selected.has(id)) select(id);
      startDrag(e, 'move', id);
    });
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(id)) select(id);
      startDrag(e, 'resize', id);
    });
  }

  function startDrag(e, mode, primaryId) {
    const ids = mode === 'resize' ? [primaryId] : [...selected];
    const startRects = new Map(ids.map((id) => {
      const { kind } = KINDS.get(id);
      return [id, { ...board.zones[id], kind }];
    }));
    drag = {
      mode, primaryId, ids, startRects,
      startPx: { x: e.clientX, y: e.clientY },
      pointerId: e.pointerId,
    };
    // Sem pointer capture: o gesto já é seguido em window (funciona mesmo se
    // o ponteiro sair do elemento original), e capturar num elemento que não
    // recebeu o pointerdown (canvasEl != root/handle) não faz o esperado.
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }

  function onDragMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.startPx.x) / scale;
    const dy = (e.clientY - drag.startPx.y) / scale;
    clearGuides();

    if (drag.mode === 'move') {
      const primary = drag.startRects.get(drag.primaryId);
      const primKind = primary.kind;
      let tentative = { x: primary.x + dx, y: primary.y + dy };
      const tRect = primKind === 'area'
        ? { x: tentative.x, y: tentative.y, w: primary.w, h: primary.h }
        : { x: tentative.x, y: tentative.y, w: primary.size, h: primary.size / CARD_ASPECT };
      // Exclui TODAS as zonas em arrasto (não só a primária) dos candidatos de
      // snap — senão, numa seleção múltipla, a primária podia "grudar" numa
      // colega que está se movendo junto (sempre na mesma posição relativa),
      // o que não é um alinhamento de verdade e só causaria tremulação perto
      // do limiar.
      const snap = computeMoveSnap(drag.ids, tRect);
      const adjX = snap.dx, adjY = snap.dy;
      for (const id of drag.ids) {
        const s = drag.startRects.get(id);
        board.zones[id] = { ...board.zones[id], x: s.x + dx + adjX, y: s.y + dy + adjY };
      }
    } else {
      const s = drag.startRects.get(drag.primaryId);
      if (s.kind === 'area') {
        const w = snapValue(s.w + dx, drag.primaryId, 'w');
        const h = snapValue(s.h + dy, drag.primaryId, 'h');
        board.zones[drag.primaryId] = { ...board.zones[drag.primaryId], w: Math.max(24, w), h: Math.max(24, h) };
      } else {
        const size = snapValue(s.size + dx, drag.primaryId, 'size');
        board.zones[drag.primaryId] = { ...board.zones[drag.primaryId], size: Math.max(20, size) };
      }
    }
    renderAll();
  }

  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    clearGuides();
    drag = null;
    onChange?.(board);
  }

  // ------------------------------------------------------------ snapping ----

  /** Bordas/centros de todas as zonas FORA do que está sendo arrastado. */
  function otherRects(excludeIds) {
    const out = [];
    for (const { id, kind } of allZoneIds()) {
      if (excludeIds.includes(id)) continue;
      const zv = board.zones[id];
      if (!zv) continue;
      out.push({ id, ...rectOf(zv, kind) });
    }
    return out;
  }

  function snapAxis(value, size, candidates, edges) {
    // candidates: valores-alvo (bordas/centros de outras zonas) nessa unidade.
    // edges: [value, value+size/2, value+size] — testa esquerda, centro, direita.
    // `at` no resultado é a coordenada onde a guia deve ser desenhada.
    let best = null;
    for (const edge of edges(value, size)) {
      for (const c of candidates) {
        const d = Math.abs(edge - c.at);
        if (d <= THRESHOLD && (!best || d < best.d)) best = { d, delta: c.at - edge, at: c.at };
      }
    }
    return best;
  }

  function computeMoveSnap(excludeIds, tRect) {
    if (gridSize) {
      const gx = Math.round(tRect.x / gridSize) * gridSize - tRect.x;
      const gy = Math.round(tRect.y / gridSize) * gridSize - tRect.y;
      return { dx: gx, dy: gy };
    }
    const others = otherRects(excludeIds);
    const xCand = others.flatMap((o) => [
      { at: o.x, guide: o }, { at: o.x + o.w / 2, guide: o }, { at: o.x + o.w, guide: o },
    ]);
    const yCand = others.flatMap((o) => [
      { at: o.y, guide: o }, { at: o.y + o.h / 2, guide: o }, { at: o.y + o.h, guide: o },
    ]);
    const xHit = snapAxis(tRect.x, tRect.w, xCand, (v, s) => [v, v + s / 2, v + s]);
    const yHit = snapAxis(tRect.y, tRect.h, yCand, (v, s) => [v, v + s / 2, v + s]);
    let dx = xHit ? xHit.delta : 0;
    let dy = yHit ? yHit.delta : 0;

    // Espaçamento igual: se a zona ficar entre duas outras na mesma "linha"
    // (faixa Y sobreposta), tenta igualar o vão dos dois lados.
    const rowMates = others.filter((o) => overlapsY({ ...tRect, y: tRect.y + dy }, o));
    const left = rowMates.filter((o) => o.x + o.w <= tRect.x + dx + 1).sort((a, b) => b.x - a.x)[0];
    const right = rowMates.filter((o) => o.x >= tRect.x + dx + tRect.w - 1).sort((a, b) => a.x - b.x)[0];
    if (left && right) {
      const rightGap = right.x - (tRect.x + dx + tRect.w);
      const leftGap = tRect.x + dx - (left.x + left.w);
      // gap de referência: entre os DOIS vizinhos, se estiverem adjacentes um ao outro
      // não dá (eles têm a zona no meio); usa o gap oposto como referência mútua.
      if (Math.abs(rightGap - leftGap) > 0.5 && Math.abs(rightGap - leftGap) <= THRESHOLD) {
        dx += (rightGap - leftGap) / 2;
      }
    }
    if (xHit) drawGuideV(xHit.at);
    if (yHit) drawGuideH(yHit.at);
    return { dx, dy };
  }

  function overlapsY(a, b) {
    return a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function snapValue(value, id, prop) {
    if (gridSize) return Math.round(value / gridSize) * gridSize;
    const others = otherRects([id]);
    // 'size' e 'w' comparam contra largura; só 'h' compara contra altura.
    const targets = others.map((o) => (prop === 'h' ? o.h : o.w));
    let best = null;
    for (const t of targets) {
      const d = Math.abs(t - value);
      if (d <= THRESHOLD && (!best || d < best.d)) best = t;
    }
    return best ?? value;
  }

  // -------------------------------------------------------------- guias ----

  function clearGuides() { guidesEl.replaceChildren(); }
  /** Linha vertical de guia na coordenada X (unidades de canvas), altura toda. */
  function drawGuideV(atX) {
    const el = document.createElement('div');
    el.className = 'guide guide-v';
    el.style.left = `${atX * scale}px`;
    guidesEl.append(el);
  }
  /** Linha horizontal de guia na coordenada Y (unidades de canvas), largura toda. */
  function drawGuideH(atY) {
    const el = document.createElement('div');
    el.className = 'guide guide-h';
    el.style.top = `${atY * scale}px`;
    guidesEl.append(el);
  }

  // ----------------------------------------------------------- ferramentas --

  function selRects() {
    return [...selected].map((id) => {
      const { kind } = KINDS.get(id);
      return { id, kind, ...rectOf(board.zones[id], kind) };
    });
  }

  function applyRect(id, kind, r) {
    if (kind === 'area') board.zones[id] = { ...board.zones[id], x: r.x, y: r.y, w: r.w, h: r.h };
    else board.zones[id] = { ...board.zones[id], x: r.x, y: r.y, size: r.w };
  }

  function alignLeft() { const rs = selRects(); const x = Math.min(...rs.map((r) => r.x)); for (const r of rs) applyRect(r.id, r.kind, { ...r, x }); finish(); }
  function alignRight() { const rs = selRects(); const x2 = Math.max(...rs.map((r) => r.x + r.w)); for (const r of rs) applyRect(r.id, r.kind, { ...r, x: x2 - r.w }); finish(); }
  function alignTop() { const rs = selRects(); const y = Math.min(...rs.map((r) => r.y)); for (const r of rs) applyRect(r.id, r.kind, { ...r, y }); finish(); }
  function alignBottom() { const rs = selRects(); const y2 = Math.max(...rs.map((r) => r.y + r.h)); for (const r of rs) applyRect(r.id, r.kind, { ...r, y: y2 - r.h }); finish(); }
  function centerX() { const rs = selRects(); const cx = rs.reduce((s, r) => s + r.x + r.w / 2, 0) / rs.length; for (const r of rs) applyRect(r.id, r.kind, { ...r, x: cx - r.w / 2 }); finish(); }
  function centerY() { const rs = selRects(); const cy = rs.reduce((s, r) => s + r.y + r.h / 2, 0) / rs.length; for (const r of rs) applyRect(r.id, r.kind, { ...r, y: cy - r.h / 2 }); finish(); }

  function equalizeSize() {
    const rs = selRects();
    if (rs.length < 2) return;
    const ref = rs[0];
    for (const r of rs) {
      if (r.kind === 'area') applyRect(r.id, r.kind, { ...r, w: ref.w, h: ref.h });
      else applyRect(r.id, r.kind, { ...r, w: ref.w });
    }
    finish();
  }

  /**
   * Escala um GRUPO de zonas (mão, campo ou tudo — ver `zoneGroups()`) por
   * `pct`, uniformemente em torno do CENTRO do próprio grupo — não de cada
   * zona isolada, senão "campo a 80%" só encolheria cada caixa no lugar e os
   * vãos entre elas ficariam maiores em vez do conjunto todo encolher junto.
   * Ignora ids que não existem neste board (grupo cobre os 2 jogadores; um
   * board pode não ter usado algum, embora hoje todo `defaultLayout` tenha).
   */
  function scaleGroup(ids, pct) {
    const k = pct / 100;
    if (!Number.isFinite(k) || k <= 0) return;
    const rs = ids
      .filter((id) => board.zones[id])
      .map((id) => { const { kind } = KINDS.get(id); return { id, kind, ...rectOf(board.zones[id], kind) }; });
    if (!rs.length) return;
    const minX = Math.min(...rs.map((r) => r.x));
    const minY = Math.min(...rs.map((r) => r.y));
    const maxX = Math.max(...rs.map((r) => r.x + r.w));
    const maxY = Math.max(...rs.map((r) => r.y + r.h));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const r of rs) {
      const w = r.w * k, h = r.h * k;
      const oldCx = r.x + r.w / 2, oldCy = r.y + r.h / 2;
      const newCx = cx + (oldCx - cx) * k, newCy = cy + (oldCy - cy) * k;
      applyRect(r.id, r.kind, { ...r, x: newCx - w / 2, y: newCy - h / 2, w, h });
    }
    finish();
  }

  /**
   * Escala CADA zona em torno do PRÓPRIO centro, independente das outras —
   * ao contrário de `scaleGroup`. É o que "mão" e "campo" precisam: a mão do
   * jogador 0 fica no rodapé, a do jogador 1 no topo — um centro
   * COMPARTILHADO entre as duas fica bem no meio do canvas, longe de ambas, e
   * qualquer escala em torno dele empurra as duas mãos pra longe uma da
   * outra (às vezes pra fora do canvas — foi assim que uma mão "sumiu" ao
   * escalar "mão" pra 150%). Cada zona crescer/encolher no PRÓPRIO lugar é o
   * que corresponde à intuição de "aumenta a mão".
   */
  function scaleEach(ids, pct) {
    const k = pct / 100;
    if (!Number.isFinite(k) || k <= 0) return;
    for (const id of ids) {
      if (!board.zones[id]) continue;
      const { kind } = KINDS.get(id);
      const r = { kind, ...rectOf(board.zones[id], kind) };
      const w = r.w * k, h = r.h * k;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      applyRect(id, kind, { ...r, x: cx - w / 2, y: cy - h / 2, w, h });
    }
    finish();
  }

  function selectAll() {
    selected = new Set(allZoneIds().map((z) => z.id));
    renderAll();
    notifySelect();
  }

  /** Distribui espaçamento uniforme entre as zonas selecionadas, mantendo a
   *  primeira e a última fixas (ordenadas pelo eixo escolhido). */
  function distribute(axis = 'x') {
    const rs = selRects();
    if (rs.length < 3) return;
    rs.sort((a, b) => a[axis] - b[axis]);
    const dim = axis === 'x' ? 'w' : 'h';
    const first = rs[0], last = rs[rs.length - 1];
    const totalSpan = (last[axis] + last[dim]) - first[axis];
    const totalSize = rs.reduce((s, r) => s + r[dim], 0);
    const gap = (totalSpan - totalSize) / (rs.length - 1);
    let cursor = first[axis];
    for (const r of rs) {
      applyRect(r.id, r.kind, { ...r, [axis]: cursor });
      cursor += r[dim] + gap;
    }
    finish();
  }

  function nudge(dx, dy) {
    for (const id of selected) {
      const { kind } = KINDS.get(id);
      const zv = board.zones[id];
      board.zones[id] = { ...zv, x: zv.x + dx, y: zv.y + dy };
    }
    finish();
  }

  function finish() { renderAll(); onChange?.(board); }

  function setBackground(dataUrl) {
    if (!board) return;
    board.background = dataUrl || null;
    renderAll();
    onChange?.(board);
  }

  /** Bônus de Campo: qual magia de campo (código real, ver `FIELD_SPELLS` em
   *  `boards.js`) já entra ativa nesse tabuleiro. Não afeta o desenho do
   *  editor — é metadado do board, igual `background`. */
  function setFieldSpell(code) {
    if (!board) return;
    board.fieldSpell = code || null;
    onChange?.(board);
  }

  window.addEventListener('resize', () => renderAll());
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (!selected.size) return;
    const n = e.shiftKey ? NUDGE_FAST : NUDGE;
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-n, 0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(n, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -n); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, n); }
  });

  return {
    setBoard, getBoard, setPreview, setGrid, setBackground, setFieldSpell,
    clearSelection, getSelection, selectAll,
    alignLeft, alignRight, alignTop, alignBottom, centerX, centerY,
    equalizeSize, distribute, scaleGroup, scaleEach,
  };
}
