/**
 * Mapa mundi — nós de cenário (ver `world.js`) ligados por uma estrada
 * pontilhada. Cenário liberado abre `cidade.html?id=<id>`; bloqueado só
 * mostra o motivo num toast.
 */
import { SCENARIOS, isUnlocked } from '/web/js/world.js';
import { getDP, hydrateWallet } from '/web/js/wallet.js';
import { requireAdmin } from '/web/js/auth.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Layout fixo em S — só precisa parecer uma estrada serpenteando entre os
// cenários, na ordem em que aparecem em SCENARIOS.
function layout() {
  const w = 900, h = 460;
  const n = SCENARIOS.length;
  return SCENARIOS.map((s, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    return {
      ...s,
      x: 100 + t * (w - 200),
      y: h / 2 + Math.sin(t * Math.PI * 1.6) * (h * 0.28),
    };
  });
}

function render() {
  const nodes = layout();

  const svg = $('road-svg');
  svg.setAttribute('viewBox', '0 0 900 460');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.replaceChildren();
  if (nodes.length > 1) {
    const path = document.createElementNS(SVG_NS, 'path');
    const d = nodes.map((n, i) => `${i === 0 ? 'M' : 'L'} ${n.x} ${n.y}`).join(' ');
    path.setAttribute('d', d);
    path.setAttribute('class', 'road');
    svg.append(path);
  }

  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    const unlocked = isUnlocked(n);
    const btn = document.createElement('button');
    btn.className = 'node' + (unlocked ? '' : ' locked');
    btn.style.left = `${(n.x / 900) * 100}%`;
    btn.style.top = `${(n.y / 460) * 100}%`;
    btn.innerHTML =
      `<div class="disc">${n.icon ?? '📍'}${unlocked ? '' : '<span class="lock">🔒</span>'}</div>` +
      `<span class="label">${n.name}</span>` +
      `<span class="sub">${n.subtitle ?? ''}</span>`;
    btn.onclick = () => {
      if (!unlocked) { toast(n.unlockHint || 'ainda bloqueado'); return; }
      location.href = `/web/cidade.html?id=${encodeURIComponent(n.id)}`;
    };
    frag.append(btn);
  }
  $('nodes').replaceChildren(frag);
}

$('btn-home').onclick = () => (location.href = '/web/teste.html');

// ---------------------------------------------------------------- boot
// Ferramenta de ADMIN (Área de Teste): quem não é admin volta para a home.
// A trava de verdade é a RLS do servidor — isto é só não abrir a ferramenta
// para quem levaria 403 ao publicar. Ver requireAdmin() em auth.js.
const perfil = await requireAdmin();
if (!perfil) throw new Error('Área de Teste: só admin');

await hydrateWallet();
$('dp').textContent = `${getDP()} DP`;
render();

if (new URLSearchParams(location.search).get('blocked')) {
  toast('esse cenário ainda está bloqueado');
}
