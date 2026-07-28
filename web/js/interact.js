/**
 * Gestos de interação compartilhados entre as telas.
 */

/** Quanto tempo segurar para disparar a ação de "segurar". */
export const HOLD_MS = 600;

/**
 * Segurar o elemento por `ms` dispara `onLong`.
 *
 * Devolve `foiSegurado()`, que o `onclick` deve consultar: sem isso, soltar o
 * botão dispararia a ação de clique logo depois da de segurar — no deck isso
 * significaria adicionar uma cópia e remover outra na mesma interação.
 *
 * O arrasto cancela a contagem, senão começar a arrastar viraria "segurar".
 */
export function wireLongPress(el, ms, onLong) {
  let timer = null;
  let disparou = false;

  const parar = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('holding');
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;            // só o botão esquerdo
    disparou = false;
    el.classList.add('holding');
    timer = setTimeout(() => {
      disparou = true;
      parar();
      onLong();
    }, ms);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'dragstart']) {
    el.addEventListener(ev, parar);
  }

  return () => {
    const r = disparou;
    disparou = false;   // consome: vale só para o clique imediatamente seguinte
    return r;
  };
}

/** CSS do anel de progresso do "segurar". Injetado uma vez por página. */
export function injectHoldStyles(ms = HOLD_MS) {
  if (document.getElementById('hold-styles')) return;
  const s = document.createElement('style');
  s.id = 'hold-styles';
  s.textContent = `
    .holding { position: relative; }
    .holding::after {
      content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 2;
      animation: segurando ${ms}ms linear forwards;
    }
    @keyframes segurando {
      from { box-shadow: inset 0 0 0 0 var(--gold, #e8c46a); }
      to   { box-shadow: inset 0 0 0 5px var(--gold, #e8c46a); }
    }`;
  document.head.append(s);
}
