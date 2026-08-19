/**
 * **A trilha de DECKS de um adversário** — a regra, sozinha.
 *
 * A Trilha de Duelos libera adversários; isto é o andar de baixo: dentro de um
 * mesmo adversário, cada deck pode liberar OUTRO deck dele ao ser derrotado.
 * O Para & Dox tem "Bem-vindo ao Labirinto" e "Guardião do Portão"; o primeiro
 * aponta para o segundo, e o segundo só aparece depois que o primeiro cai.
 *
 * Isso existe por causa do DROP: o pool passou a ser por deck, não por
 * adversário, então um deck mais difícil é o que dá acesso a prêmios melhores.
 * Sem a liberação, escolher o deck fácil e ganhar a mesma coisa tornaria o
 * difícil uma escolha sem motivo.
 *
 * Duas decisões que valem registro:
 *
 * 1. **Aponta-se pelo NOME do deck, não pelo índice.** É a mesma regra do deck
 *    ativo (migration 0030) e da ordem da trilha (0032): índice muda de
 *    significado quando um deck novo entra, e trocaria a cadeia de todo mundo
 *    sem ninguém mexer em nada.
 * 2. **A dificuldade é texto livre.** Quem edita escreve o que quiser — um NPC
 *    pode ter "fácil" e outro "iniciante". É rótulo para o jogador ler, e não
 *    muda como o adversário joga: quem decide se ele lê a sua mão continua
 *    sendo o `level` do NPC.
 *
 * Sem import nenhum de propósito: é função pura, e é isso que a torna testável
 * em Node (`node web/js/decksnpc.test.mjs`).
 */

/** O texto de dificuldade em forma: uma linha só, sem exageros de tamanho. */
export function normalizarDificuldade(valor) {
  // Número vira texto: `metaDoYdk` converte "1" em 1 ao ler o .ydk, e um
  // rótulo "1" é perfeitamente legítimo.
  const s = String(valor ?? '').replace(/[\r\n]+/g, ' ').trim();
  return s.slice(0, 24);
}

/**
 * O nome do deck que este libera, ou `null`.
 *
 * Um deck nunca libera a si mesmo: seria um nó que só abre depois de já estar
 * aberto, e a checagem é barata o bastante para não deixar isso entrar.
 */
export function normalizarLibera(valor, nomeDoProprio) {
  const s = String(valor ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!s) return null;
  if (nomeDoProprio != null && s === String(nomeDoProprio).trim()) return null;
  return s.slice(0, 120);
}

/**
 * Ordena os decks seguindo as cadeias de liberação e diz quais estão ABERTOS.
 *
 * Um deck é RAIZ quando nenhum outro aponta para ele — essas são as portas de
 * entrada e estão sempre abertas. Os demais abrem quando algum deck que aponta
 * para eles já foi derrotado.
 *
 * @param {Array<{name: string, libera?: string|null}>} decks os decks do NPC
 * @param {Set<string>} vencidos nomes de deck que este jogador já derrotou
 * @returns {Array<{deck: object, aberto: boolean, i: number}>}
 */
export function decksLiberados(decks, vencidos) {
  const lista = Array.isArray(decks) ? decks : [];
  if (!lista.length) return [];

  const nome = (d) => String(d?.name ?? '').trim();
  const alvo = (d) => normalizarLibera(d?.libera, nome(d));

  // Quem é apontado por alguém. Só conta o apontador que EXISTE: um `#libera`
  // para um deck já apagado não pode trancar o que sobrou para sempre.
  const existentes = new Set(lista.map(nome));
  const apontadoPor = new Map();          // nome -> [decks que o liberam]
  for (const d of lista) {
    const a = alvo(d);
    if (!a || !existentes.has(a)) continue;
    if (!apontadoPor.has(a)) apontadoPor.set(a, []);
    apontadoPor.get(a).push(d);
  }

  let raizes = lista.filter((d) => !apontadoPor.has(nome(d)));

  // Ciclo fechado (A libera B, B libera A): sem raiz, nenhum deck abriria e o
  // adversário ficaria injogável por um erro de configuração. O primeiro da
  // lista vira a porta de entrada — ficar fora de ordem é muito melhor que
  // ficar inalcançável, a mesma escolha que a ordem da trilha faz.
  if (!raizes.length) raizes = [lista[0]];

  // Ordem topológica: um deck só entra depois de TODOS os que o liberam. Seguir
  // uma cadeia de cada vez parece equivalente e não é — com dois decks
  // apontando para o mesmo terceiro, a cadeia da primeira raiz colocaria o
  // terceiro antes da segunda raiz, e a lista mostraria o deck final no meio
  // dos que ainda o destrancam.
  const ordenados = [];
  const posto = new Set();
  const faltam = new Map(lista.map((d) => [d, (apontadoPor.get(nome(d)) ?? []).length]));
  const fila = [...raizes];
  for (const r of raizes) faltam.set(r, 0);

  while (fila.length) {
    const atual = fila.shift();
    if (posto.has(atual)) continue;
    posto.add(atual);
    ordenados.push(atual);

    const a = alvo(atual);
    const seguinte = a ? lista.find((d) => nome(d) === a) : null;
    if (!seguinte || posto.has(seguinte)) continue;
    const resta = (faltam.get(seguinte) ?? 0) - 1;
    faltam.set(seguinte, resta);
    if (resta <= 0) fila.push(seguinte);
  }
  // Preso num ciclo lateral: entra no fim, na ordem em que veio. Sumir da lista
  // seria perder o acesso a um deck por um erro de configuração.
  for (const d of lista) if (!posto.has(d)) ordenados.push(d);

  const venceu = (n) => !!vencidos && vencidos.has(n);
  const ehRaiz = new Set(raizes.map(nome));

  return ordenados.map((d, i) => {
    const n = nome(d);
    const aberto = ehRaiz.has(n)
      || (apontadoPor.get(n) ?? []).some((quem) => venceu(nome(quem)));
    return { deck: d, aberto, i };
  });
}

/**
 * O deck que a tela deve abrir por padrão: o primeiro ABERTO da ordem, ou o
 * primeiro de todos quando nada está aberto (não acontece com a regra acima,
 * mas a tela não pode depender disso para ter o que desenhar).
 */
export function deckPadrao(decks, vencidos) {
  const l = decksLiberados(decks, vencidos);
  if (!l.length) return null;
  return (l.find((x) => x.aberto) ?? l[0]).deck;
}
