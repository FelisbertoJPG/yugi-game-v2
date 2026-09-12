/**
 * **DE QUEM É A CARTA que estou escolhendo.**
 *
 * O motor pergunta "escolha uma carta" mandando uma LISTA — e a lista não diz
 * de quem é nada: chega tudo junto, as minhas e as dele, na ordem em que o
 * `ocgcore` as enumerou. A tela desenhava essa lista como uma grade de
 * miniaturas, e era exatamente aí que a informação sumia.
 *
 * O relato: *"quando eu ativo um card, aparecem todos os cards elegíveis para
 * selecionar, porém não diferencia quais são meus e quais são do oponente"* —
 * com o **Chaos Scepter Blast** de exemplo, que bane 1 carta do campo (dos DOIS
 * lados) e pode banir uma minha por engano. E o pior caso é o dele: as cartas
 * SETADAS chegam sem código, todas desenhadas com o mesmo verso. Meia dúzia de
 * versos idênticos numa grade não é uma escolha — é um sorteio.
 *
 * A carta traz `controller` desde sempre (`Sel`, em `InteractiveDuel.cs`), e no
 * multiplayer ele já vem VIRADO para quem está lendo (`CAMPOS_DE_JOGADOR`, em
 * `ponte.js`). O que faltava era usá-lo. São duas respostas ao mesmo problema,
 * e cada uma cobre o que a outra não cobre:
 *
 *   1. **está tudo no CAMPO?** Então a escolha é feita NO CAMPO, sem quadro
 *      nenhum: o tabuleiro já separa os dois lados desenhando um em cima e o
 *      outro embaixo, e é a única leitura que não depende de rótulo nenhum. É
 *      a mesma decisão que a MIRA do ataque tomou antes (`alvosDoAtaque`, em
 *      `duel.html`) — a janela cobria o tabuleiro justamente no momento em que
 *      o que importa é o tabuleiro;
 *   2. **não está?** (mão, deck, cemitério, banidas, ou uma mistura) Então o
 *      quadro continua, mas as cartas saem AGRUPADAS por dono, cada grupo com o
 *      seu título — e cada carta com o seu selo, porque o título de cima some
 *      da vista assim que a grade rola.
 *
 * Sem DOM e com teste (`node web/js/alvos.test.mjs`), como `deck.js` e
 * `correntes.js`: a decisão erra CALADA nos dois sentidos — cair no quadro
 * quando dava para clicar na mesa só é chato, mas cair NA MESA quando uma das
 * cartas não tem zona na tela deixa o jogador com uma pergunta que ele não
 * consegue responder, e o duelo para ali.
 */

/**
 * As localizações do `ocgcore` que este módulo precisa nomear. São as do
 * `constant.lua` (LOCATION_*), e estão aqui porque o front não carrega aquele
 * arquivo — os mesmos números que `selecionaveisNoCampo` já usava soltos.
 */
export const LOCAL = {
  DECK: 0x01,
  MAO: 0x02,
  MZONE: 0x04,
  SZONE: 0x08,
  CEMITERIO: 0x10,
  BANIDA: 0x20,
  EXTRA: 0x40,
};

const NOME_DO_LOCAL = new Map([
  [LOCAL.DECK, 'deck'],
  [LOCAL.MAO, 'mão'],
  [LOCAL.MZONE, 'campo'],
  [LOCAL.SZONE, 'campo'],
  [LOCAL.CEMITERIO, 'cemitério'],
  [LOCAL.BANIDA, 'banidas'],
  [LOCAL.EXTRA, 'extra'],
]);

/** Como se chama, em português, o lugar onde esta carta está. */
export function nomeDoLocal(location) {
  return NOME_DO_LOCAL.get(Number(location)) ?? 'lugar nenhum';
}

/** A carta está numa zona do TABULEIRO (monstro ou magia/armadilha)? */
export function estaNoCampo(c) {
  return Number(c?.location) === LOCAL.MZONE || Number(c?.location) === LOCAL.SZONE;
}

/**
 * A âncora da zona desta carta — a MESMA chave que `fieldRows` escreve no
 * `data-anchor` de cada zona (`ctrl:location:sequence`). É por ela que a
 * escolha no campo liga a carta oferecida à zona clicável.
 */
export function ancoraDe(c) {
  return `${c?.controller}:${c?.location}:${c?.sequence}`;
}

/**
 * De quem é. `controller === 0` é sempre QUEM ESTÁ LENDO — no duelo contra o
 * NPC porque o jogador é o 0 do motor, no multiplayer porque a ponte já virou
 * a mesa antes de a visão chegar aqui.
 */
export function donoDaCarta(c) {
  return Number(c?.controller) === 0 ? 'meu' : 'dele';
}

/** O título do grupo e o selo da carta. Duas frases, porque são dois lugares:
 *  o título é lido uma vez, o selo fica na carta depois de a grade rolar. */
export const ROTULO = {
  meu: { titulo: 'SUAS CARTAS', selo: 'sua' },
  dele: { titulo: 'DO SEU OPONENTE', selo: 'do oponente' },
};

/**
 * A ordem em que os lugares aparecem — a mesma leitura da mesa: primeiro o que
 * está em jogo, depois o que está na mão, e por último as pilhas.
 */
const ORDEM_DOS_LOCAIS = [LOCAL.MZONE, LOCAL.SZONE, LOCAL.MAO,
                          LOCAL.CEMITERIO, LOCAL.BANIDA, LOCAL.DECK, LOCAL.EXTRA];

const postoDoLocal = (loc) => {
  const i = ORDEM_DOS_LOCAIS.indexOf(Number(loc));
  return i < 0 ? ORDEM_DOS_LOCAIS.length : i;
};

/**
 * **O que de fato SEPARA as cartas desta escolha.**
 *
 * Uma lista só precisa dizer o que nela varia. Se as cartas são todas minhas,
 * carimbar "sua" em cada uma é ruído — e ruído esconde a informação que
 * importa. Se estão todas no mesmo lugar, o mesmo vale para o lugar.
 *
 * O relato que trouxe isto: *"tributei meu Lustro Negro errado porque eu tinha
 * 1 na mão e 1 no campo, e na hora de escolher os dois apareceram iguais, sem
 * dizer de onde era cada um"*. As duas eram minhas — o selo de dono estava
 * certo e era inútil —, e o que separava as duas cartas, que era o LUGAR, só
 * existia no `title`, atrás de um hover e de uma espera. Tooltip não é feedback
 * visual: numa escolha que não dá para desfazer, ou está desenhado, ou não
 * existe.
 */
export function eixosQueVariam(choices) {
  const cartas = Array.isArray(choices) ? choices : [];
  const donos = new Set(cartas.map(donoDaCarta));
  const locais = new Set(cartas.map((c) => Number(c?.location)));
  return { dono: donos.size > 1, local: locais.size > 1 };
}

/**
 * O selo que vai NA carta: só os eixos que variam, na ordem em que se lê.
 *
 * Vazio quando nada varia — aí o título do grupo já disse tudo, e um selo
 * repetido em cada miniatura só tira espaço da arte.
 */
export function seloDaCarta(c, eixos) {
  const partes = [];
  if (eixos?.dono) partes.push(donoDaCarta(c) === 'meu' ? 'sua' : 'dele');
  if (eixos?.local) partes.push(nomeDoLocal(c?.location));
  return partes.join(' · ');
}

/**
 * Agrupa as cartas oferecidas por DONO e LUGAR — as minhas primeiro, e dentro
 * de cada lado a ordem de leitura da mesa (campo, mão, pilhas).
 *
 * Era só por dono, e isso resolvia metade do problema: separava as minhas das
 * dele e deixava duas cartas MINHAS, uma na mão e outra no campo, lado a lado
 * na mesma grade, com a mesma arte e o mesmo selo. Agrupar pelo par resolve as
 * duas metades com uma regra só.
 *
 * A ordem DENTRO do grupo é a que o motor mandou, e isso não é descuido: o
 * `index` de cada carta é a resposta que volta para o motor, e reordenar a
 * lista por qualquer critério nosso só reordena o que se vê — mas quem lê a
 * grade da esquerda para a direita passa a contar as cartas numa ordem que não
 * é a de lugar nenhum. Agrupar já é o suficiente.
 *
 * **Grupo vazio não aparece**, e o grupo único continua rotulado: "só tem carta
 * minha aqui, e ela está na mão" é justamente o que o jogador não consegue
 * saber olhando uma grade de miniaturas.
 */
export function agruparEscolhas(choices) {
  const cartas = Array.isArray(choices) ? choices : [];
  const grupos = new Map();

  for (const c of cartas) {
    const dono = donoDaCarta(c);
    const loc = Number(c?.location);
    const chave = `${dono}:${loc}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        dono, local: loc,
        titulo: `${ROTULO[dono].titulo} · ${nomeDoLocal(loc).toUpperCase()}`,
        cartas: [],
      });
    }
    grupos.get(chave).cartas.push(c);
  }

  return [...grupos.values()].sort((a, b) =>
    (a.dono === b.dono ? 0 : a.dono === 'meu' ? -1 : 1)
    || postoDoLocal(a.local) - postoDoLocal(b.local));
}

/** A escolha mistura os dois lados? É o caso do relato original. */
export function misturaOsDoisLados(choices) {
  return eixosQueVariam(choices).dono;
}

/** As perguntas que oferecem uma lista de cartas para escolher. */
export const PERGUNTAS_DE_CARTA =
  ['selectcard', 'selecttribute', 'selectunselect', 'selectsum'];

/**
 * **Dá para responder esta pergunta clicando na mesa?** Devolve as cartas
 * indexadas pela âncora da zona, ou `null` — e aí o quadro de sempre vale.
 *
 * @param q       a pergunta do motor.
 * @param temZona `(âncora) => boolean` — a zona existe NA TELA? Quem responde é
 *                o `duel.html` (`elDaAncora`), porque isto é a única metade da
 *                decisão que não está na pergunta.
 *
 * As condições, e o que cada uma evita:
 *
 *   • **é minha a vez de responder** (`player === 0`): a pergunta do oponente
 *     não é minha para responder;
 *   • **toda carta está no CAMPO.** Basta uma na mão ou no cemitério para o
 *     tabuleiro não ter onde mostrá-la — e ela sumiria da escolha em silêncio,
 *     que é pior que o quadro que a mostrava mal;
 *   • **toda carta tem zona na TELA.** Material de Xyz mora em `MZONE` com
 *     sequência de sobreposição, e a fileira só desenha cinco: a âncora nunca
 *     apareceria, e o clique não teria onde acontecer;
 *   • **duas cartas nunca dividem a mesma zona.** Se dividissem, o clique seria
 *     ambíguo e a tela responderia por conta própria qual das duas;
 *   • **`selectsum` fica de fora** (o ritual). Ali o que decide é o NÍVEL de
 *     cada carta, que o quadro imprime no canto da miniatura e a zona não
 *     mostra — escolher tributo pela soma olhando a mesa seria escolher no
 *     escuro. O ritual também é a única dessas perguntas em que as cartas são
 *     sempre minhas, então não é o caso do relato.
 *
 * O que **não** é condição, de propósito: quantas cartas se escolhe. Com mais
 * de uma, o clique na zona acumula (a zona ganha o ✓) e quem confirma é o botão
 * da barra — a mesma barra do quadro, sem o vidro por cima.
 */
export function escolhaNoCampo(q, temZona = () => true) {
  if (!q || Number(q.player) !== 0) return null;
  if (!PERGUNTAS_DE_CARTA.includes(q.kind)) return null;
  if (q.kind === 'selectsum') return null;

  const cs = Array.isArray(q.choices) ? q.choices : [];
  if (!cs.length) return null;
  if (!cs.every(estaNoCampo)) return null;

  const zonas = new Map();
  for (const c of cs) {
    const a = ancoraDe(c);
    if (zonas.has(a)) return null;      // duas cartas na mesma zona: clique ambíguo
    if (!temZona(a)) return null;       // a zona não está na tela
    zonas.set(a, c);
  }
  return zonas;
}
