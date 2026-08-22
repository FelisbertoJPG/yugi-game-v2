/**
 * Tabuleiros — layouts de campo desenhados no editor (`web/campo.html`).
 *
 * Um tabuleiro é um retângulo por ZONA FUNCIONAL do campo (as que o `ocgcore`
 * realmente entende — nada inventado): 5 zonas de monstro, 5 de magia/
 * armadilha, campo, deck, extra, cemitério e mão, por jogador. O `duel.html`
 * lê o board ATIVO (se houver) e desenha o campo com essas posições em vez do
 * layout padrão fixo.
 *
 * Persistência em dois níveis, mesmo padrão dos decks (ver `storage.js` /
 * `projectdecks.js`):
 *   - o CONTEÚDO dos tabuleiros é versionado no projeto (`boards/*.json`,
 *     via `projectboards.js`) — não mora aqui;
 *   - qual tabuleiro está ATIVO é preferência local de quem está testando,
 *     então fica só no localStorage (`ygo:activeBoard`) — isso sim é este
 *     módulo.
 */

const KEY_ACTIVE = 'ygo:activeBoard';

/** O tabuleiro "Oficial" (`boards/oficial.json`) é o layout padrão de
 *  verdade do jogo — quem nunca escolheu nada explicitamente cai nele, não
 *  no flexbox cru de bootstrap. `loadActiveBoard()` (duel.html) já tolera
 *  sozinho um path que não existe (servidor fora do ar, arquivo apagado):
 *  cai pro flexbox em silêncio, então apontar pra cá sem checar é seguro. */
const DEFAULT_BOARD = 'oficial.json';

/** Proporção padrão de carta (a mesma de `.zone`/`.pilezone` no duel.html). */
export const CARD_ASPECT = 59 / 86;

/** Resolução de referência: as coordenadas de um board vivem nesse espaço,
 *  escalado pro tamanho real da tela na hora de desenhar. */
export const CANVAS = { w: 1600, h: 900 };

/**
 * Bônus de Campo: os 6 campos básicos já na Lista 1 (`web/js/lista1.js`),
 * cartas REAIS com script no ocgcore — nenhum efeito reimplementado aqui. Um
 * tabuleiro pode fixar um deles como sempre ativo (estilo "campo de Floresta
 * do Weevil": você entra no duelo e a magia de campo já está lá, valendo pra
 * sempre nesse cenário). O `duel-server` só precisa COLOCAR a carta virada
 * pra cima na zona de campo antes do duelo começar — o Lua dela faz o resto.
 */
export const FIELD_SPELLS = [
  { code: 59197169, name: 'Yami' },
  { code: 87430998, name: 'Forest' },
  { code: 50913601, name: 'Mountain' },
  { code: 86318356, name: 'Sogen' },
  { code: 22702055, name: 'Umi' },
  { code: 23424603, name: 'Wasteland' },
];

/**
 * Todas as zonas funcionais válidas, na ordem em que aparecem no campo.
 * `kind: 'slot'` = tamanho único (a largura; altura segue a proporção da
 * carta). `kind: 'area'` = largura E altura livres (só a mão, por enquanto).
 */
export function zoneIds(player) {
  const p = `p${player}`;
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push({ id: `${p}:m${i}`, kind: 'slot', label: `M${i}` });
  ids.push({ id: `${p}:f`, kind: 'slot', label: 'Campo' });
  for (let i = 0; i < 5; i++) ids.push({ id: `${p}:s${i}`, kind: 'slot', label: `S${i}` });
  ids.push({ id: `${p}:deck`, kind: 'slot', label: 'Deck' });
  ids.push({ id: `${p}:extra`, kind: 'slot', label: 'Extra' });
  ids.push({ id: `${p}:gy`, kind: 'slot', label: 'Cemitério' });
  // Banidas (`LOCATION_REMOVED`, 0x20). Não é uma zona das REGRAS — o ocgcore
  // não tem "zona de banimento", tem uma localização — mas é uma pilha que
  // precisa de um lugar na mesa, como o cemitério. Sem ela, carta banida
  // sumia da tela e não ia para lugar nenhum.
  ids.push({ id: `${p}:banido`, kind: 'slot', label: 'Banidas' });
  ids.push({ id: `${p}:hand`, kind: 'area', label: 'Mão' });
  return ids;
}

/**
 * Elementos de UI que não são zona do motor (o indicador de fase não tem
 * localização nenhuma pro `ocgcore` — não existe carta que "more" ali), mas
 * o usuário quer poder posicionar do mesmo jeito.
 *
 * Os LP saíram daqui: eles moram no placar do topo da tela (`.hud` em
 * `duel.html`), que fica FORA da arena e por isso não é posicionável. Pôr o
 * placar sob o editor é tarefa própria — precisa de zona nova no schema, e
 * todo tabuleiro já gravado teria de ganhar uma posição padrão para ela.
 */
export function uiZoneIds() {
  return [
    { id: 'mid', kind: 'area', label: 'Fase' },
    // Os botões "próxima fase"/"End Phase". Moram ao lado do Deck, e não no
    // centro junto das fases: escolher entre avançar e pular direto pro fim
    // do turno é ação do jogador, então fica do lado de onde ele já está
    // olhando (mão, deck), não no meio do campo.
    { id: 'acts', kind: 'area', label: 'Botões de fase' },
    // O seletor de correntes (desligado/auto/sempre). Morava na barra do topo,
    // que durante o duelo só atrapalhava — desceu para o tabuleiro pelo mesmo
    // motivo dos botões de fase: é decisão que se toma olhando a mesa, e quem
    // decide onde ela fica é quem monta o campo.
    { id: 'correntes', kind: 'area', label: 'Correntes (modo)' },
  ];
}

export function allZoneIds() {
  return [...zoneIds(0), ...zoneIds(1), ...uiZoneIds()];
}

/** A zona é válida (existe no schema)? Usado pelo editor pra nunca deixar
 *  gravar um `id` inventado. */
export function isKnownZone(id) {
  return allZoneIds().some((z) => z.id === id);
}

/**
 * Agrupamentos prontos pra escala em bloco no editor ("mão", "campo" ou
 * "tudo", separado ou junto — dos dois jogadores de uma vez, porque escalar
 * só o seu lado sem o do oponente desalinharia o tabuleiro).
 */
export function zoneGroups() {
  const all = allZoneIds().map((z) => z.id);
  const hand = all.filter((id) => id.endsWith(':hand'));
  const field = all.filter((id) => !id.endsWith(':hand'));   // inclui 'mid' e 'acts'
  return { hand, field, all };
}

/**
 * Layout padrão: reproduz a disposição atual do `duel.html` (flexbox) como
 * ponto de partida — um board novo não nasce em branco.
 *
 * Espelha `fieldRows()`: por jogador, uma fileira com [Campo, M0..M4, GY] e
 * outra com [S0..S4, Deck, Extra]; o jogador de baixo tem a fileira de
 * monstro mais perto do centro (a de magia abaixo dela), o de cima é o
 * espelho. A mão de cada um fica na borda correspondente (baixo/cima).
 */
export function defaultLayout(name = 'Padrão') {
  const zones = {};
  const SIZE = 92;
  const GAP = 14;

  // Distribui `count` slots de largura SIZE, centralizados, a partir de x0.
  function row(ids, y, x0 = null) {
    const w = ids.length * SIZE + (ids.length - 1) * GAP;
    let x = x0 ?? (CANVAS.w - w) / 2;
    for (const id of ids) { zones[id] = { x, y, size: SIZE }; x += SIZE + GAP; }
  }

  // Span da fileira de monstro (campo + 5 zonas + cemitério) — a barra de
  // fases/LP usa a MESMA largura, alinhada com as colunas acima e abaixo
  // dela, em vez de um valor solto.
  const FIELD_W = 7 * SIZE + 6 * GAP;
  const FIELD_X = (CANVAS.w - FIELD_W) / 2;

  let magiaY0 = 0;   // linha de magia do jogador — os botões de fase alinham por ela

  for (const player of [0, 1]) {
    const p = `p${player}`;
    // jogador 0 (você) embaixo: monstro perto do centro, magia abaixo dele.
    // jogador 1 (oponente) em cima: espelhado.
    const meio = CANVAS.h / 2;
    const monstroY = player === 0 ? meio + 20 : meio - 20 - SIZE * (86 / 59);
    const magiaY = player === 0
      ? monstroY + SIZE * (86 / 59) + GAP
      : monstroY - SIZE * (86 / 59) - GAP;
    const handY = player === 0 ? CANVAS.h - 130 : 20;
    if (player === 0) magiaY0 = magiaY;

    row([`${p}:f`, `${p}:m0`, `${p}:m1`, `${p}:m2`, `${p}:m3`, `${p}:m4`, `${p}:gy`], monstroY, FIELD_X);
    row([`${p}:s0`, `${p}:s1`, `${p}:s2`, `${p}:s3`, `${p}:s4`, `${p}:deck`, `${p}:extra`], magiaY, FIELD_X);
    // Banidas: à ESQUERDA da fileira de monstro, espelhando o cemitério que
    // fica na ponta direita dela. O espaço ali está livre (a fileira começa em
    // FIELD_X = 436 de 1600) e é o único canto do canvas que não disputa lugar
    // com nada — a direita já tem os botões de fase e a caixa das correntes.
    //
    // Esta posição é também a que TODO tabuleiro antigo vai herdar no backfill,
    // então ela precisa ser defensável sozinha, e não só bonita ao lado das
    // outras deste layout.
    zones[`${p}:banido`] = { x: FIELD_X - SIZE - GAP, y: monstroY, size: SIZE };
    zones[`${p}:hand`] = { x: (CANVAS.w - 1000) / 2, y: handY, w: 1000, h: 110 };
  }

  // Fases/LP: na faixa estreita entre as duas fileiras de monstro (o "meio"
  // de sempre no layout flexbox), mesma largura da fileira de monstro — mais
  // estreito que isso e o rótulo mais longo do botão de fase ("▶ próxima
  // fase", quando não há ação disponível) quebra linha e vaza da caixa.
  zones.mid = { x: FIELD_X, y: CANVAS.h / 2 - 25, w: FIELD_W, h: 50 };

  // Botões de fase: à direita do Extra do jogador, na mesma linha do Deck.
  // Sobra folga de canvas ali (a fileira termina em FIELD_X+FIELD_W = 1164 de
  // 1600), então a caixa cabe sem espremer nada do campo.
  zones.acts = { x: FIELD_X + FIELD_W + GAP, y: magiaY0, w: 160, h: 64 };

  // Correntes: logo ACIMA dos botões de fase, na mesma coluna. As duas caixas
  // são do mesmo dono (decisões suas, fora do campo) e ficam juntas em vez de
  // espalhadas — quem quiser separar arrasta no editor.
  zones.correntes = { x: FIELD_X + FIELD_W + GAP, y: magiaY0 - 46, w: 160, h: 38 };

  return { name, canvas: { ...CANVAS }, background: null, fieldSpell: null, zones };
}

// ---------------------------------------------------------------- ativo ----

/** Nome do tabuleiro ativo — o "Oficial" por padrão, até alguém escolher
 *  outro explicitamente (ou desativar, o que também volta pro Oficial). */
export function getActiveBoard() {
  try { return localStorage.getItem(KEY_ACTIVE) || DEFAULT_BOARD; }
  catch { return DEFAULT_BOARD; }
}

/** Ativa (ou, com null, desativa — volta pro Oficial, o padrão do jogo). */
export function setActiveBoard(name) {
  try {
    if (name) localStorage.setItem(KEY_ACTIVE, name);
    else localStorage.removeItem(KEY_ACTIVE);
    return true;
  } catch (e) {
    console.error('[boards] falha ao gravar tabuleiro ativo', e);
    return false;
  }
}
