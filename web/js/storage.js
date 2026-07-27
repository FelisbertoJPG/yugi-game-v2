/**
 * Persistência dos decks.
 *
 * Sem backend: tudo em `localStorage`, preso ao navegador e ao domínio. Isso
 * significa que os decks NÃO acompanham você para outra máquina nem sobrevivem
 * a uma limpeza de dados do navegador — por isso existe o export `.ydk`, que é
 * a cópia de segurança de verdade e o formato que o motor vai ler depois.
 *
 * Quando houver backend, só esta camada muda.
 */
import { Deck } from './deck.js';

const KEY_DECKS = 'ygo:decks';
const KEY_ACTIVE = 'ygo:activeDeck';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('[storage] falha ao gravar', key, e);
    return false;
  }
}

/** @returns {Deck[]} */
export function listDecks() {
  return read(KEY_DECKS, []).map((d) => new Deck(d));
}

export function saveDeck(deck, index = null) {
  const decks = read(KEY_DECKS, []);
  if (index === null || index < 0 || index >= decks.length) {
    decks.push(deck.toJSON());
    write(KEY_DECKS, decks);
    return decks.length - 1;
  }
  decks[index] = deck.toJSON();
  write(KEY_DECKS, decks);
  return index;
}

export function deleteDeck(index) {
  const decks = read(KEY_DECKS, []);
  if (index < 0 || index >= decks.length) return false;
  decks.splice(index, 1);
  write(KEY_DECKS, decks);

  const active = getActiveIndex();
  if (active === index) setActiveIndex(decks.length ? 0 : null);
  else if (active !== null && active > index) setActiveIndex(active - 1);
  return true;
}

export function getActiveIndex() {
  const i = read(KEY_ACTIVE, null);
  return Number.isInteger(i) ? i : null;
}

export function setActiveIndex(i) {
  write(KEY_ACTIVE, i);
}

/** O deck ativo, ou null se não houver nenhum salvo. */
export function getActiveDeck() {
  const decks = listDecks();
  if (!decks.length) return null;
  const i = getActiveIndex();
  return decks[i] ?? decks[0];
}

/** Dispara o download de um .ydk. */
export function downloadYdk(deck) {
  const safe = (deck.name || 'deck').replace(/[^\w\-. ]+/g, '_').trim() || 'deck';
  const blob = new Blob([deck.toYdk()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.ydk`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Abre um seletor de arquivo e devolve o Deck lido. */
export function importYdk() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ydk,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      const name = file.name.replace(/\.ydk$/i, '') || 'Deck importado';
      resolve(Deck.fromYdk(text, name));
    };
    input.click();
  });
}
