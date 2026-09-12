/**
 * **Organizar o deck** — a ordem em que as cartas aparecem no Deck Builder.
 *
 * O deck é uma LISTA de ids, e a ordem dela é a ordem em que as cartas foram
 * clicadas: quem monta vai e volta no pool, tira uma cópia aqui, põe outra ali,
 * e o que sobra é a ordem da montagem, não a ordem de LEITURA. Só que é essa
 * lista que vira o `.ydk`, que é o que o motor recebe e o que outra pessoa abre
 * — então arrumá-la é arrumar o deck em todo lugar em que ele aparece, e não um
 * enfeite da tela.
 *
 * A ordem é a que se lê de cima para baixo num deck de verdade:
 *
 *   RITUAL → MONSTRO DE EFEITO → MONSTRO NORMAL → MAGIA → ARMADILHA
 *
 * e, DENTRO de cada uma, pela QUANTIDADE de cópias, da maior para a menor: as
 * três cópias primeiro, depois as duas, depois a única. É o que põe o núcleo do
 * deck na frente — a carta de que se joga três é a que o deck quer ver toda
 * partida, e a de uma cópia é a resposta pontual.
 *
 * A categoria manda mais que a quantidade, de propósito: um Monstro de Efeito
 * do qual há DUAS cópias continua vindo antes de um Normal do qual há três,
 * porque a leitura é por classe de carta primeiro.
 *
 * O EXTRA DECK entra na mesma escada, com os degraus dele (Fusão → Sincro →
 * Xyz → Link): as duas zonas passam pela mesma função, e a zona de cada carta
 * já a manteve separada muito antes daqui.
 *
 * Sem DOM e sem `fetch`, como `deck.js`, `drops.js` e `poolordem.js` — a
 * decisão erra CALADA (uma carta na gaveta errada é um deck plausível), e é o
 * teste em Node que a prova: `node web/js/organizardeck.test.mjs`.
 */

/**
 * Os degraus, do primeiro ao último. `outro` é a carta que o índice não
 * conhece (customizada sem `tl`, id de um banco mais novo): ela vai para o fim,
 * mas NUNCA some — ver `ordenarDeck`.
 */
export const CATEGORIAS = [
  'ritual', 'efeito', 'normal',
  'fusao', 'sincro', 'xyz', 'link',
  'magia', 'armadilha',
  'outro',
];

const POSTO = new Map(CATEGORIAS.map((c, i) => [c, i]));

/**
 * Em que degrau esta carta cai.
 *
 * A pergunta é respondida pelo `typeLabel` (`tl` no índice), que é gerado pelo
 * `build.py` e tem formato estável — o mesmo campo de que `isExtraDeck`
 * (`deck.js`) vive. O `t` ('M' | 'S' | 'T') separa monstro de magia e de
 * armadilha; ele sozinho não bastaria, porque "Ritual Spell" e "Ritual Monster"
 * dizem a mesma palavra e são cartas de zonas diferentes.
 *
 * A ORDEM das perguntas é a regra: o Extra vem primeiro porque "Fusion/Effect
 * Monster" é as duas coisas e a fusão é a que importa; ritual antes de efeito
 * pelo mesmo motivo ("Ritual/Effect Monster"); e NORMAL é o que sobra de
 * monstro, não uma palavra procurada — "Normal Spell" e "Normal Trap" também a
 * têm, e um `tl.includes('Normal')` cru jogaria magia no meio dos monstros.
 */
export function categoriaDaCarta(carta) {
  if (!carta) return 'outro';
  const tl = String(carta.tl ?? carta.typeLabel ?? '');
  const t = String(carta.t ?? '');

  if (t === 'S') return 'magia';
  if (t === 'T') return 'armadilha';

  // Sem `t` (carta de outra origem), o `tl` ainda responde.
  if (!t && /\bSpell\b/.test(tl)) return 'magia';
  if (!t && /\bTrap\b/.test(tl)) return 'armadilha';

  if (/\bFusion\b/.test(tl)) return 'fusao';
  if (/\bSynchro\b/.test(tl)) return 'sincro';
  if (/\bXyz\b/.test(tl)) return 'xyz';
  if (/\bLink\b/.test(tl)) return 'link';
  if (/\bRitual\b/.test(tl)) return 'ritual';
  if (/\bEffect\b/.test(tl)) return 'efeito';
  if (/\bMonster\b/.test(tl)) return 'normal';

  return 'outro';
}

/** Número ou `-Infinity` — o que não tem o campo vai para o fim do desempate. */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity);

/**
 * Devolve os ids da zona na ordem organizada.
 *
 * @param ids      a lista de ids da zona (`deck.main` ou `deck.extra`).
 * @param briefDe  `(id) => carta | null` — o mesmo `brief` do builder.
 *
 * As cópias da mesma carta ficam SEMPRE juntas: é a contagem delas que decide o
 * lugar do grupo, então espalhá-las seria contradizer a própria ordenação (e a
 * tela agrupa mesmo — `Deck.grouped`).
 *
 * Depois da categoria e da quantidade, o desempate é NÍVEL ↓, ATK ↓ e nome — o
 * bastante para a ordem ser sempre a mesma. Sem ele, duas organizadas seguidas
 * do mesmo deck podem sair diferentes, e "organizar" vira um botão que mexe no
 * deck sem se poder dizer o que fez.
 *
 * **É uma permutação da entrada, sempre**: mesma quantidade de cartas, mesmas
 * cópias. Uma carta que o índice não conhece não some — organizar um deck não
 * pode ser um jeito de perdê-lo.
 */
export function ordenarDeck(ids, briefDe) {
  const lista = Array.isArray(ids) ? ids.map(Number) : [];
  const carta = typeof briefDe === 'function' ? briefDe : () => null;

  const grupos = new Map();               // id -> {id, count, c}
  for (const id of lista) {
    const g = grupos.get(id);
    if (g) { g.count++; continue; }
    grupos.set(id, { id, count: 1, c: carta(id) });
  }

  const ordenados = [...grupos.values()].sort((a, b) => {
    const pa = POSTO.get(categoriaDaCarta(a.c)) ?? CATEGORIAS.length;
    const pb = POSTO.get(categoriaDaCarta(b.c)) ?? CATEGORIAS.length;
    if (pa !== pb) return pa - pb;
    if (a.count !== b.count) return b.count - a.count;

    const la = num(a.c?.lv), lb = num(b.c?.lv);
    if (la !== lb) return lb - la;
    const aa = num(a.c?.atk), ab = num(b.c?.atk);
    if (aa !== ab) return ab - aa;

    const na = String(a.c?.name ?? a.id), nb = String(b.c?.name ?? b.id);
    return na.localeCompare(nb, 'pt', { sensitivity: 'base' }) || (a.id - b.id);
  });

  const saida = [];
  for (const g of ordenados) for (let i = 0; i < g.count; i++) saida.push(g.id);
  return saida;
}

/**
 * A lista já está nesta ordem? É o que separa "organizei" de "não havia o que
 * organizar" no aviso da tela — e o que impede o botão de sujar um deck salvo
 * (`markDirty`) sem ter mexido em nada.
 */
export function jaOrganizado(ids, briefDe) {
  const antes = Array.isArray(ids) ? ids.map(Number) : [];
  const depois = ordenarDeck(antes, briefDe);
  return antes.length === depois.length && antes.every((id, i) => id === depois[i]);
}
