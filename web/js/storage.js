/**
 * Persistência dos decks do JOGADOR.
 *
 * A verdade mora em `decks/player/*.ydk`, versionado no git — igual a carteira
 * (`store/wallet.json`) e aos decks de NPC. O `localStorage` é só a cópia de
 * trabalho, rápida e síncrona; ele NÃO acompanha você para outra máquina nem
 * sobrevive a uma limpeza de dados do navegador, então nunca pode ser a fonte.
 *
 * Isso já foi diferente: por muito tempo o deck do jogador era o único dado do
 * jogo que só existia no navegador. O sintoma era mudar de máquina, levar a
 * pasta junto, e ainda assim ver os decks antigos DAQUELE navegador — os `.ydk`
 * viajavam no git mas ninguém os lia de volta.
 *
 * Ordem que importa (a mesma do resto do projeto): `hydrateDecks()` no boot,
 * ANTES de qualquer gravação. Gravar antes de ler é como um estado vazio
 * sobrescreve dados bons.
 */
import { Deck } from './deck.js';
import {
  canWrite, listProjectDecks, saveProjectDeck, deleteProjectDeck, playerDeckPath,
} from './projectdecks.js';

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

/**
 * @returns {Deck[]} — cada Deck carrega `.path` (o arquivo dele em `decks/`),
 * ou null se ainda só existe neste navegador.
 */
export function listDecks() {
  return read(KEY_DECKS, []).map((d) => {
    const deck = new Deck(d);
    deck.path = d.path ?? null;
    return deck;
  });
}

/**
 * Grava o deck: `localStorage` na hora, servidor logo atrás.
 *
 * @param {(erro: string) => void} [aoFalharNoServidor] chamado se o SERVIDOR
 *   recusar. Não é opcional por preguiça — é opcional porque o `localStorage`
 *   realmente gravou, e quem chama decide se isso basta.
 *
 *   Passe SEMPRE, no fluxo do jogador. Sem isto o deck fica só neste navegador:
 *   a tela diz "deck salvo", o jogador vai ao Multiplayer e lê "nenhum deck
 *   salvo" — foi exatamente o que aconteceu com o primeiro tester, e o erro do
 *   banco ("cartas que voce nao possui: …") morria aqui dentro sem nunca chegar
 *   a ninguém.
 *
 * @param {{livre?: boolean}} [opcoes] `livre` é o modo ADMIN da Área de Teste
 *   (ver `saveProjectDeck`): grava no banco sem conferir a Coleção. Quem decide
 *   se pode é o servidor.
 */
export function saveDeck(deck, index = null, aoFalharNoServidor = null, opcoes = {}) {
  const decks = read(KEY_DECKS, []);
  const i = (index === null || index < 0 || index >= decks.length) ? decks.length : index;
  // Renomear NÃO troca o arquivo: o `path` de quem já está no projeto é
  // preservado (o nome novo vai no `#name` de dentro do .ydk). Senão cada
  // rename deixaria um órfão em decks/player/.
  const path = decks[i]?.path ?? null;
  decks[i] = { ...deck.toJSON(), path };
  write(KEY_DECKS, decks);
  pushDeckToProject(i, deck, path, aoFalharNoServidor, opcoes);
  return i;
}

export function deleteDeck(index) {
  const decks = read(KEY_DECKS, []);
  if (index < 0 || index >= decks.length) return false;
  const [removido] = decks.splice(index, 1);
  write(KEY_DECKS, decks);
  if (removido?.path) deleteProjectDeck(removido.path).catch(() => {});

  const active = getActiveIndex();
  if (active === index) setActiveIndex(decks.length ? 0 : null);
  else if (active !== null && active > index) setActiveIndex(active - 1);
  return true;
}

/**
 * Tira o deck da cópia de trabalho SEM tocar no servidor.
 *
 * É o par de quem já apagou no banco por outro caminho (a Área de Teste apaga
 * direto em `decks_jogador`). Sem isto os dois discordariam até o próximo
 * `hydrateDecks`, e o deck apagado continuaria aparecendo no Deck Builder desta
 * máquina — parecendo que a exclusão não funcionou.
 *
 * @returns {boolean} se havia algo para esquecer.
 */
export function esquecerDeckLocal(path) {
  const decks = read(KEY_DECKS, []);
  const i = decks.findIndex((d) => d.path === path);
  if (i < 0) return false;
  decks.splice(i, 1);
  write(KEY_DECKS, decks);

  const active = getActiveIndex();
  if (active === i) setActiveIndex(decks.length ? 0 : null);
  else if (active !== null && active > i) setActiveIndex(active - 1);
  return true;
}

/** Um caminho livre em decks/player/ — nunca por cima de um arquivo existente. */
function caminhoLivre(nome, ocupados) {
  let p = playerDeckPath(nome);
  for (let n = 2; ocupados.has(p); n++) p = playerDeckPath(`${nome} ${n}`);
  return p;
}

/**
 * Espelha um deck no servidor (o seu vai para o banco, via `salvar_deck`).
 *
 * A falha de REDE continua silenciosa — sem servidor no ar não há o que fazer, e
 * o `localStorage` já guardou. A falha de REGRA, não: "cartas que você não
 * possui" é uma decisão do jogo, e o jogador precisa saber para poder corrigir
 * o deck. Eram as duas tratadas como uma só, e a segunda sumia junto.
 */
async function pushDeckToProject(index, deck, path, aoFalhar = null, opcoes = {}) {
  if (!(await canWrite())) return;
  let alvo = path;
  if (!alvo) {
    const ocupados = new Set((await listProjectDecks())
      .filter((p) => p.path.startsWith('player/')).map((p) => p.path));
    alvo = caminhoLivre(deck.name, ocupados);
  }
  const r = await saveProjectDeck(alvo, deck, { updated: new Date().toISOString() }, opcoes);
  if (!r.ok) {
    console.warn('[deck] o servidor recusou:', r.error);
    aoFalhar?.(r.error || 'o servidor recusou o deck');
    return;
  }
  const decks = read(KEY_DECKS, []);
  if (decks[index]) { decks[index].path = r.path; write(KEY_DECKS, decks); }
}

/**
 * Traz `decks/player/*.ydk` (disco) para o `localStorage`. Chame no boot, antes
 * de qualquer gravação.
 *
 * Antes de sobrescrever, MIGRA: todo deck que só existe neste navegador sobe
 * para o projeto primeiro — e num arquivo livre, nunca por cima de um `.ydk`
 * que veio de outra máquina. Assim trocar de máquina não pode custar um deck de
 * nenhum dos dois lados; no pior caso os dois aparecem na lista e você escolhe.
 *
 * Sem servidor no ar não faz nada: mexer no `localStorage` sem conseguir ler o
 * disco só destruiria a cópia de trabalho.
 */
export async function hydrateDecks() {
  if (!(await canWrite())) return { server: false, migrados: 0, carregados: 0 };

  // Só `player/` — `listProjectDecks()` devolve a pasta `decks/` inteira, e os
  // decks de NPC (`npc/<id>/*.ydk`) têm dono próprio em `npcs.js`. Sem este
  // filtro eles apareceriam como se fossem seus.
  const projeto = (await listProjectDecks()).filter((p) => p.path.startsWith('player/'));
  const ocupados = new Set(projeto.map((p) => p.path));

  let migrados = 0;
  for (const d of read(KEY_DECKS, [])) {
    if (d.path) continue;                       // já veio do projeto
    // O que se le' aqui e' o `localStorage` daquele navegador, escrito por
    // versoes antigas do jogo — nao ha' garantia nenhuma sobre o formato. Um
    // registro torto fazia `new Deck(d)` lancar, e a excecao subia ate' o
    // `await hydrateDecks()` do topo da home, que nao tinha catch: a tela
    // ficava em 'carregando…' PARA SEMPRE naquela maquina, porque o registro
    // ruim continuava la' no boot seguinte.
    try {
      const deck = new Deck(d);
      const r = await saveProjectDeck(caminhoLivre(deck.name, ocupados), deck,
                                      { updated: new Date().toISOString() });
      if (!r.ok) continue;
      ocupados.add(r.path);
      projeto.push({ path: r.path, deck });
      migrados++;
    } catch (e) {
      console.warn('[decks] deck local ilegivel; deixando para tras', d, e);
    }
  }

  const nomeAtivo = getActiveDeck()?.name ?? null;
  write(KEY_DECKS, projeto.map(({ path, deck }) => ({ ...deck.toJSON(), path })));

  // O índice ativo é posicional: depois de recarregar a lista ele apontaria
  // para outro deck. Reancora pelo nome.
  const i = nomeAtivo === null ? -1 : projeto.findIndex(({ deck }) => deck.name === nomeAtivo);
  setActiveIndex(projeto.length ? (i >= 0 ? i : 0) : null);

  if (migrados) console.info(`[decks] ${migrados} deck(s) so deste navegador migraram para decks/player/`);
  return { server: true, migrados, carregados: projeto.length };
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
