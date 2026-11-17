/**
 * **Card Builder** — o modelo de uma carta criada na Área de Teste e o `Lua`
 * que o `ocgcore` roda para ela.
 *
 * São três passos, na ordem da tela (`web/cardbuilder.html`):
 *   1. a ARTE;
 *   2. o TIPO — e o tipo já traz o esqueleto Lua dele (Magia de Equipamento
 *      nasce com `aux.AddEquipProcedure`, Contra-Armadilha com `EVENT_CHAINING`,
 *      Magia Contínua com a ativação que a deixa na zona…);
 *   3. os EFEITOS — adicionar, comprar, reviver, destruir, bônus —, cada um com
 *      QUANDO acontece, o CUSTO, o LIMITE por turno, e se é para ESTA carta ou
 *      para OUTRA (com um filtro "raça X **ou** Nível 3–4 com ATK 1000–1800").
 *
 * **As regras do jogo continuam no motor.** Isto não decide se um efeito pode
 * ser ativado: escreve o Lua no mesmo idioma dos scripts oficiais que o motor já
 * roda (Reinforcement of the Army, Monster Reborn, Pot of Greed, Magic Jammer,
 * Trap Hole) e o `ocgcore` responde o resto. O que se valida aqui é só a FORMA —
 * uma combinação que não fecha ("descarte esta carta e reviva esta carta") vira
 * problema na tela em vez de um script que nunca ativa, calado.
 *
 * **Nenhum texto do admin entra no código.** O nome vai só no comentário do
 * cabeçalho (numa linha, sem quebra); todo o resto é número coagido ou valor de
 * lista fechada. `gerarLua` normaliza a carta ANTES de escrever uma linha.
 *
 * Sem DOM e sem rede: é o que deixa `cardbuilder.test.mjs` rodar em Node. A
 * persistência mora em `cardbuilderbanco.js`.
 *
 * RELATIVO de propósito: em Node `/web/js/...` não resolve.
 */
import { buildTypeLabel, parseCardmaker } from './customcards.js';

/** A faixa das cartas do Card Builder (a mesma CHECK da migration 0058). */
export const ID_MIN = 950000000;
export const ID_MAX = 999999999;
export const ehIdDoBuilder = (id) => Number.isInteger(id) && id >= ID_MIN && id <= ID_MAX;

// ------------------------------------------------------------------ o tipo

export const TIPOS = [
  ['monstro-normal', 'Monstro Normal'],
  ['monstro-efeito', 'Monstro de Efeito'],
  ['monstro-fusao', 'Monstro de Fusão'],
  ['monstro-ritual', 'Monstro de Ritual'],
  ['magia', 'Magia'],
  ['armadilha', 'Armadilha'],
];

/**
 * O VISUAL da carta — como ela aparece, nunca o que ela faz: o Lua é o mesmo
 * nos três. A imagem importada (moldura ou carta completa) mora na coluna
 * `imagem` (migration 0059), separada da `arte`.
 */
export const VISUAIS = [
  ['desenhada', 'layout do Card Builder'],
  ['moldura', 'moldura importada (arte e texto por cima)'],
  ['completa', 'carta completa importada'],
];

export const SUBTIPOS = {
  magia: [
    ['normal', 'Normal'], ['rapida', 'Rápida'], ['continua', 'Contínua'],
    ['equipamento', 'Equipamento'], ['campo', 'Campo'], ['ritual', 'Ritual'],
  ],
  armadilha: [
    ['normal', 'Normal'], ['continua', 'Contínua'], ['contra', 'Contra-Armadilha'],
  ],
};

/** O subtipo no rótulo em inglês que o índice de cartas usa (`tl`, `r`). */
const SUBTIPO_EN = {
  normal: 'Normal', rapida: 'Quick-Play', continua: 'Continuous', equipamento: 'Equip',
  campo: 'Field', ritual: 'Ritual', contra: 'Counter',
};

/**
 * Os bits de `type` do `cards.cdb`. **Os números NÃO são a fonte**: a fonte é o
 * `constant.lua` do motor, e `cardbuilder.test.mjs` lê o arquivo e confere cada
 * um — número copiado à mão envelhece calado.
 */
export const BITS_DE_TIPO = {
  TYPE_MONSTER: 0x1, TYPE_SPELL: 0x2, TYPE_TRAP: 0x4, TYPE_NORMAL: 0x10,
  TYPE_EFFECT: 0x20, TYPE_FUSION: 0x40, TYPE_RITUAL: 0x80, TYPE_QUICKPLAY: 0x10000,
  TYPE_CONTINUOUS: 0x20000, TYPE_EQUIP: 0x40000, TYPE_FIELD: 0x80000,
  TYPE_COUNTER: 0x100000,
};

/** [nome no índice de cartas, rótulo, constante Lua, valor] */
export const RACAS = [
  ['Warrior', 'Guerreiro', 'RACE_WARRIOR', 0x1],
  ['Spellcaster', 'Mago', 'RACE_SPELLCASTER', 0x2],
  ['Fairy', 'Fada', 'RACE_FAIRY', 0x4],
  ['Fiend', 'Demônio', 'RACE_FIEND', 0x8],
  ['Zombie', 'Zumbi', 'RACE_ZOMBIE', 0x10],
  ['Machine', 'Máquina', 'RACE_MACHINE', 0x20],
  ['Aqua', 'Aqua', 'RACE_AQUA', 0x40],
  ['Pyro', 'Piro', 'RACE_PYRO', 0x80],
  ['Rock', 'Rocha', 'RACE_ROCK', 0x100],
  ['Winged Beast', 'Besta Alada', 'RACE_WINGEDBEAST', 0x200],
  ['Plant', 'Planta', 'RACE_PLANT', 0x400],
  ['Insect', 'Inseto', 'RACE_INSECT', 0x800],
  ['Thunder', 'Trovão', 'RACE_THUNDER', 0x1000],
  ['Dragon', 'Dragão', 'RACE_DRAGON', 0x2000],
  ['Beast', 'Besta', 'RACE_BEAST', 0x4000],
  ['Beast-Warrior', 'Besta-Guerreira', 'RACE_BEASTWARRIOR', 0x8000],
  ['Dinosaur', 'Dinossauro', 'RACE_DINOSAUR', 0x10000],
  ['Fish', 'Peixe', 'RACE_FISH', 0x20000],
  ['Sea Serpent', 'Serpente Marinha', 'RACE_SEASERPENT', 0x40000],
  ['Reptile', 'Réptil', 'RACE_REPTILE', 0x80000],
  ['Psychic', 'Psíquico', 'RACE_PSYCHIC', 0x100000],
  ['Divine-Beast', 'Besta Divina', 'RACE_DIVINE', 0x200000],
  ['Creator God', 'Deus Criador', 'RACE_CREATORGOD', 0x400000],
  ['Wyrm', 'Wyrm', 'RACE_WYRM', 0x800000],
  ['Cyberse', 'Ciberso', 'RACE_CYBERSE', 0x1000000],
  ['Illusion', 'Ilusão', 'RACE_ILLUSION', 0x2000000],
];

/** [nome no índice, rótulo, constante Lua, valor] */
export const ATRIBUTOS = [
  ['DARK', 'TREVAS', 'ATTRIBUTE_DARK', 0x20],
  ['LIGHT', 'LUZ', 'ATTRIBUTE_LIGHT', 0x10],
  ['EARTH', 'TERRA', 'ATTRIBUTE_EARTH', 0x1],
  ['WATER', 'ÁGUA', 'ATTRIBUTE_WATER', 0x2],
  ['FIRE', 'FOGO', 'ATTRIBUTE_FIRE', 0x4],
  ['WIND', 'VENTO', 'ATTRIBUTE_WIND', 0x8],
  ['DIVINE', 'DIVINO', 'ATTRIBUTE_DIVINE', 0x40],
];

const RACA = new Map(RACAS.map((r) => [r[0], r]));
const ATRIBUTO = new Map(ATRIBUTOS.map((a) => [a[0], a]));

const MONSTROS = new Set(['monstro-normal', 'monstro-efeito', 'monstro-fusao', 'monstro-ritual']);
export const ehMonstro = (carta) => MONSTROS.has(carta.tipo);

/**
 * Fusão e Ritual: monstros que NÃO se Invocam por Invocação-Normal e que o motor
 * só deixa voltar do Cemitério se tiverem sido Invocados direito antes
 * (`c:EnableReviveLimit()`). Os efeitos são opcionais nos dois.
 */
export const ehFusaoOuRitual = (carta) => carta.tipo === 'monstro-fusao' || carta.tipo === 'monstro-ritual';

// --------------------------------------------------------------- os efeitos

export const QUANDO = {
  ativacao: 'ao ativar a carta',
  mao: 'da mão (Main Phase)',
  'mao-rapido': 'da mão (efeito rápido, a qualquer momento)',
  campo: 'no campo (Main Phase)',
  cemiterio: 'do Cemitério (Main Phase)',
  invocado: 'ao ser Invocado',
  // Só a Especial (`EVENT_SPSUMMON_SUCCESS`) — o `invocado` pega as duas.
  'invocado-especial': 'ao ser Invocado por Invocação-Especial',
  'enviado-cemiterio': 'ao ser enviado ao Cemitério',
  'saiu-do-campo': 'quando um monstro seu deixa o campo por carta do oponente',
  'esta-saiu-do-campo': 'quando ESTA carta deixa o campo por carta do oponente',
  // "Se este card deixar o campo" — por QUALQUER motivo, inclusive o seu.
  'esta-deixou-campo': 'quando ESTA carta deixa o campo (por qualquer motivo)',
  // "Se você ativar 1 X e 1 Y enquanto esta carta estiver no seu Cemitério" —
  // cada opção de `gatilhoFiltros` é UMA carta que precisa ter sido ativada
  // (todas, no mesmo turno, com esta no Cemitério). Ver `efeitoAtivavel`.
  'ativou-cartas': 'quando você ativa estas cartas (com esta no Cemitério)',
  continuo:'contínuo (enquanto estiver em campo)',
  equipado: 'no monstro equipado',
  'ataque-oponente': 'quando o oponente declara um ataque',
  'invocacao-oponente': 'quando o oponente Invoca um monstro',
  resposta: 'em resposta a uma ativação do oponente',
};

export const ACOES = {
  adicionar: 'adicionar à mão',
  comprar: 'comprar',
  reviver: 'Invocação-Especial',
  destruir: 'destruir',
  bonus: 'dar bônus de ATK/DEF',
  negar: 'negar a ativação',
  ataques: 'atacar mais vezes (ataques extras)',
  baixar: 'baixar Magia/Armadilha (Set)',
  'sem-tributo': 'Invocação-Normal sem tributo',
  'menos-tributo': 'Invocação-Normal com menos tributo',
  'nao-alvo': 'não pode ser alvo de efeitos do oponente',
  'ganhar-nome': 'ganhar o nome de outra carta (neste turno)',
  'sem-dano': 'você não sofre dano neste turno',
  // Só existe como PASSO do "e depois" (ver `acoesDoPasso`): "…; você pode
  // Invocar por Invocação-Fusão 1 X usando esta carta".
  fundir: 'Invocação-Fusão de 1 monstro usando esta carta',
  'enviar-cemiterio': 'enviar ao Cemitério (cartas no campo)',
};

export const ALVOS = {
  outra: 'outra carta',
  esta: 'esta carta',
  gatilho: 'o monstro que atacou / foi Invocado',
  equipado: 'o monstro equipado',
};

export const CUSTOS = {
  nenhum: 'nenhum',
  'revelar-esta': 'revelar esta carta',
  'descartar-esta': 'descartar esta carta',
  'tributar-esta': 'tributar esta carta',
  'banir-esta': 'banir esta carta do Cemitério',
  'descartar-1': 'descartar 1 carta',
  'descartar-filtro': 'descartar cartas (com filtro)',
  // "Envie 1 X e 1 Y da sua mão ou Deck ao Cemitério": cada opção de
  // `custoFiltros` é UMA carta obrigatória — o "e" do texto, e não o "ou" do
  // `descartar-filtro`. Ver `funcoesDeCada`.
  'enviar-cada': 'enviar 1 de cada (mão ou Deck) ao Cemitério',
  'pagar-lp': 'pagar LP',
};

export const LIMITES = {
  nenhum: 'sem limite',
  'por-copia': '1 vez por turno (por cópia)',
  'por-nome': '1 vez por turno (pelo nome)',
  // A conta de CADA efeito, pelo nome: o "Você só pode usar cada efeito de X uma
  // vez por turno". O `por-nome` continua sendo a conta DIVIDIDA entre os efeitos.
  'por-efeito': '1 vez por turno (pelo nome, só este efeito)',
};

/**
 * A condição de um efeito que se ATIVA — "Se você controlar um monstro Normal
 * Dragão…". Soma-se à que o momento já traz (ataque ou Invocação do oponente, a
 * negação), nunca a substitui.
 */
export const CONDICOES = {
  nenhuma: 'sempre',
  controla: 'se você controlar um monstro com a face para cima',
  // "Se X foi Invocado por Invocação-Especial neste turno". O motor guarda isso
  // no próprio monstro (`STATUS_SPSUMMON_TURN`), então a pergunta é feita ao
  // campo — e não a um contador que teríamos de manter.
  'invocado-neste-turno': 'se um monstro seu foi Invocado por Invocação-Especial neste turno',
  // "Se você não controlar nenhum outro card" — o filtro diz QUAIS contam
  // (vazio = qualquer carta). É a única condição que não pede monstro.
  'nada-mais': 'se você não controlar nenhuma OUTRA carta',
};

/**
 * Os momentos de GATILHO — os que podem ser obrigatórios (`ef.obrigatorio` →
 * `EFFECT_TYPE_TRIGGER_F`). O texto oficial sem "você pode" é obrigatório.
 */
export const GATILHOS = new Set(['invocado', 'invocado-especial', 'enviado-cemiterio', 'saiu-do-campo',
  'esta-saiu-do-campo', 'esta-deixou-campo']);

/** O contínuo e o de equipamento VALEM, não se ativam: não têm condição de ativação. */
export const permiteCondicao = (ef) => !!ef && !['continuo', 'equipado'].includes(ef.quando);

/**
 * De onde sai a carta. Na Invocação-Especial o Cemitério vem PRIMEIRO de
 * propósito: é o que valia antes de a mão, o Deck e as banidas existirem, e é
 * para ele que um `origem` desconhecido cai no ajuste — uma carta salva antes
 * disto não pode passar a Invocar do Deck sozinha.
 */
export const ORIGENS = {
  adicionar: [['deck', 'do Deck'], ['cemiterio', 'do Cemitério'], ['deck-cemiterio', 'do Deck ou do Cemitério']],
  baixar: [['deck', 'do Deck'], ['cemiterio', 'do Cemitério'], ['deck-cemiterio', 'do Deck e/ou do Cemitério'],
    ['deck-mao-cemiterio', 'do Deck, da mão e/ou do Cemitério']],
  reviver: [
    ['cemiterio-meu', 'do seu Cemitério'], ['cemiterio-ambos', 'de qualquer Cemitério'],
    ['mao', 'da sua mão'], ['deck', 'do seu Deck'],
    ['mao-deck-cemiterio', 'da sua mão, Deck ou Cemitério'],
    ['banidas-meu', 'das suas cartas banidas'], ['banidas-ambos', 'das cartas banidas (qualquer lado)'],
  ],
};

/**
 * Cada origem da Invocação-Especial no idioma do motor: as zonas (minha, dele),
 * se a carta é escolhida como ALVO e o texto da carta.
 *
 * Mão e Deck NÃO são alvo — carta que não está à vista não se escolhe como alvo,
 * e os scripts oficiais ("Invoque 1 monstro da sua mão/Deck") escolhem na
 * resolução. Cemitério e banidas são alvo, como o Monster Reborn. Banida só com
 * a face para CIMA: a virada não mostra o que é, e o filtro nem teria o que ler.
 */
const LUGAR_DA_INVOCACAO = {
  'cemiterio-meu': { loc: 'LOCATION_GRAVE', opp: '0', alvo: true, faceUp: false, texto: 'no seu Cemitério' },
  'cemiterio-ambos': { loc: 'LOCATION_GRAVE', opp: 'LOCATION_GRAVE', alvo: true, faceUp: false, texto: 'em qualquer Cemitério' },
  mao: { loc: 'LOCATION_HAND', opp: '0', alvo: false, faceUp: false, texto: 'da sua mão' },
  deck: { loc: 'LOCATION_DECK', opp: '0', alvo: false, faceUp: false, texto: 'do seu Deck' },
  // As três zonas juntas. NUNCA é alvo: mão e Deck estão escondidos, e carta que
  // ninguém vê não se escolhe como alvo — a escolha é na resolução, como nos
  // scripts oficiais que dizem "da sua mão, Deck ou Cemitério".
  'mao-deck-cemiterio': {
    loc: 'LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE', opp: '0', alvo: false, faceUp: false,
    texto: 'da sua mão, Deck ou Cemitério',
  },
  'banidas-meu': { loc: 'LOCATION_REMOVED', opp: '0', alvo: true, faceUp: true, texto: 'entre as suas cartas banidas' },
  'banidas-ambos': { loc: 'LOCATION_REMOVED', opp: 'LOCATION_REMOVED', alvo: true, faceUp: true, texto: 'entre as cartas banidas' },
};
const lugarDaInvocacao = (origem) => LUGAR_DA_INVOCACAO[origem] ?? LUGAR_DA_INVOCACAO['cemiterio-meu'];

/**
 * De onde se BUSCA uma carta — adicionar à mão e baixar. `excl` é quem sai da
 * escolha: no Cemitério a própria carta pode estar lá (descartada como custo, ou
 * o efeito é de lá), e "outra carta" a exclui. As duas zonas juntas são a forma
 * oficial (`LOCATION_DECK|LOCATION_GRAVE`, a do Darkuriboh), e buscar no Deck é
 * CATEGORY_SEARCH. `origem` desconhecido cai no Deck, que era o padrão antes.
 */
const LUGAR_DA_BUSCA = {
  deck: { loc: 'LOCATION_DECK', excl: 'nil', texto: 'do seu Deck' },
  cemiterio: { loc: 'LOCATION_GRAVE', excl: 'e:GetHandler()', texto: 'do seu Cemitério' },
  'deck-cemiterio': { loc: 'LOCATION_DECK|LOCATION_GRAVE', excl: 'e:GetHandler()', texto: 'do seu Deck ou Cemitério' },
  // A mão entra junto só no BAIXAR: "baixe 1 X do seu Deck, mão ou Cemitério".
  // Em "adicionar à mão" ela não faria sentido nenhum — a carta já está lá.
  'deck-mao-cemiterio': {
    loc: 'LOCATION_DECK|LOCATION_HAND|LOCATION_GRAVE', excl: 'e:GetHandler()',
    texto: 'do seu Deck, mão ou Cemitério',
  },
};
const lugarDaBusca = (origem) => LUGAR_DA_BUSCA[origem] ?? LUGAR_DA_BUSCA.deck;

export const LADOS = {
  destruir: [['oponente', 'do oponente'], ['qualquer', 'de qualquer lado'], ['meus', 'suas']],
  'enviar-cemiterio': [['qualquer', 'de qualquer lado'], ['oponente', 'do oponente'], ['meus', 'suas']],
  bonus: [['meus', 'seus monstros'], ['oponente', 'monstros do oponente'], ['qualquer', 'qualquer monstro']],
  'nao-alvo': [['meus', 'seus monstros'], ['oponente', 'monstros do oponente'], ['qualquer', 'qualquer monstro']],
};

export const ZONAS = [['monstro', 'monstro'], ['magia-armadilha', 'magia/armadilha'], ['qualquer', 'qualquer carta']];
export const DURACOES = [['turno', 'até o fim do turno'], ['permanente', 'permanente']];
export const CATEGORIAS = [
  ['qualquer', 'qualquer carta'], ['monstro', 'monstro'], ['monstro-normal', 'monstro Normal'],
  ['monstro-efeito', 'monstro de Efeito'], ['magia', 'magia'], ['armadilha', 'armadilha'],
];
export const RESPONDE_A = [['magia', 'Magia'], ['armadilha', 'Armadilha'], ['monstro', 'efeito de monstro']];

/** Os momentos de ATIVAÇÃO de carta (a carta sai da mão/zona ao resolver). */
const ATIVACOES = new Set(['ativacao', 'ataque-oponente', 'invocacao-oponente', 'resposta']);

/** Os momentos que cada tipo oferece. É aqui que o tipo decide o esqueleto. */
export function quandoPermitidos(carta) {
  const s = carta.subtipo;
  if (carta.tipo === 'monstro-efeito' || carta.tipo === 'monstro-ritual') {
    return ['mao', 'mao-rapido', 'campo', 'cemiterio', 'invocado', 'enviado-cemiterio',
      'saiu-do-campo', 'esta-saiu-do-campo', 'continuo', 'ativou-cartas', 'invocado-especial', 'esta-deixou-campo'];
  }
  // A Fusão mora no Extra Deck: não existe "com esta carta na mão" para ela.
  if (carta.tipo === 'monstro-fusao') {
    return ['campo', 'cemiterio', 'invocado', 'enviado-cemiterio', 'saiu-do-campo', 'esta-saiu-do-campo', 'continuo',
      'ativou-cartas', 'invocado-especial', 'esta-deixou-campo'];
  }
  // Magia Normal/Rápida e Armadilha Normal resolvem e vão para o Cemitério — e
  // é de lá que elas podem ter um efeito a mais (o "bana esta carta do seu
  // Cemitério; …" das cartas oficiais). A ativação vem PRIMEIRO: é o padrão de
  // um efeito novo, e `problemasDaCarta` exige que ela exista.
  if (carta.tipo === 'magia') {
    if (s === 'normal' || s === 'rapida') return ['ativacao', 'cemiterio', 'ativou-cartas'];
    if (s === 'continua' || s === 'campo') return ['ativacao', 'campo', 'saiu-do-campo', 'continuo'];
    if (s === 'equipamento') return ['equipado'];
    return [];                                              // ritual: sem efeitos, só o procedimento
  }
  if (carta.tipo === 'armadilha') {
    if (s === 'normal') return ['ativacao', 'ataque-oponente', 'invocacao-oponente', 'cemiterio', 'ativou-cartas'];
    if (s === 'continua') return ['ativacao', 'campo', 'saiu-do-campo', 'continuo'];
    if (s === 'contra') return ['resposta'];
  }
  return [];                                                // monstro normal: vanilla
}

/**
 * Quantos efeitos o tipo aceita. Magia Normal/Rápida e Armadilha Normal têm a
 * ativação e, além dela, efeitos do Cemitério — por isso até 4, com a ativação
 * obrigatória cobrada em `problemasDaCarta` (`resolveEVai`).
 *
 * Magia/Armadilha Contínua e Magia de Campo vão até 5 (28/09/2026): a Revenge
 * MAX tem um contínuo de Invocação, outro de ATK/DEF e três efeitos ativados, e
 * o quinto simplesmente não cabia — o botão "+ efeito" ficava desligado e
 * `normalizarCarta` cortaria o que passasse do teto. O `n` dos efeitos vai até
 * 5, ainda longe do `{id,9}` da Invocação por procedimento próprio.
 */
export function limiteDeEfeitos(carta) {
  const s = carta.subtipo;
  if (carta.tipo === 'monstro-normal') return { min: 0, max: 0 };
  if (carta.tipo === 'monstro-efeito') return { min: 1, max: 4 };
  // Fusão e Ritual valem só pelo corpo (a Fusão "normal" de dois materiais) ou
  // com efeito — o tipo já os distingue do Monstro Normal.
  if (ehFusaoOuRitual(carta)) return { min: 0, max: 4 };
  if (carta.tipo === 'magia') {
    if (s === 'normal' || s === 'rapida') return { min: 1, max: 4 };
    if (s === 'ritual') return { min: 0, max: 0 };
    if (s === 'equipamento') return { min: 1, max: 1 };
    return { min: 1, max: 5 };                               // Contínua e Campo
  }
  if (s === 'continua') return { min: 1, max: 5 };
  if (s === 'normal') return { min: 1, max: 4 };
  return { min: 1, max: 1 };
}

/**
 * A carta que RESOLVE e vai para o Cemitério (Magia Normal/Rápida, Armadilha
 * Normal): sem um efeito de ativação ela não tem como sair da mão/zona — os
 * efeitos de Cemitério sozinhos a deixariam presa, sem erro nenhum.
 */
const resolveEVai = (carta) => (carta.tipo === 'magia' && (carta.subtipo === 'normal' || carta.subtipo === 'rapida'))
  || (carta.tipo === 'armadilha' && carta.subtipo === 'normal');

export function acoesPermitidas(carta, quando) {
  if (quando === 'equipado') return ['bonus'];
  // A Invocação sem tributo é um efeito que VALE enquanto a carta está em campo
  // (o `EFFECT_SUMMON_PROC` de campo do Metaphys Factor oficial): só no contínuo.
  if (quando === 'continuo') return ['bonus', 'sem-tributo', 'nao-alvo'];
  if (quando === 'resposta') return ['negar'];
  // `menos-tributo` é o oposto do `sem-tributo`: não VALE enquanto a carta está
  // em campo — ele ACONTECE e dura até o fim do turno (o `Duel.RegisterEffect`
  // com `RESET_PHASE|PHASE_END` do Amarylease oficial). Por isso mora aqui, com
  // as ações que se ativam, e não na lista do contínuo.
  // `ganhar-nome` só existe em monstro: uma Magia que resolve sai da zona, e o
  // nome que ela ganhasse morreria junto.
  // `sem-dano`, como o `menos-tributo`, ACONTECE e dura até o fim do turno: é
  // registrado no jogador, e não na carta que já foi para o Cemitério.
  return ['adicionar', 'comprar', 'reviver', 'destruir', 'bonus', 'ataques', 'baixar', 'menos-tributo', 'sem-dano',
    ...(ehMonstro(carta) ? ['ganhar-nome'] : []), 'enviar-cemiterio'];
}

/** Quantos passos cabem no "e depois, se isso resolver". */
export const MAX_PASSOS = 3;

/**
 * O efeito aceita "e depois"? Não nos que não resolvem nada por si: o bônus
 * contínuo e o de equipamento são efeitos que VALEM, não que acontecem, e a
 * negação da Contra-Armadilha tem forma própria.
 */
export const permiteSequencia = (ef) =>
  !!ef && !['continuo', 'equipado', 'resposta'].includes(ef.quando);

/**
 * As ações de um passo do "e depois" — as mesmas do efeito, menos a negação.
 * A Invocação-Fusão "usando esta carta" só existe num monstro: é ele o material.
 */
export const acoesDoPasso = (carta = null) => ['adicionar', 'comprar', 'reviver', 'destruir', 'bonus', 'ataques', 'baixar',
  'sem-dano', ...(carta && ehMonstro(carta) ? ['fundir'] : []), 'enviar-cemiterio'];

/**
 * Os momentos em que "esta carta" pode ser MATERIAL de Fusão quando o passo
 * chega: na mão ou em campo — que é de onde `Duel.GetFusionMaterial` tira os
 * materiais. Do Cemitério o passo nunca acharia a carta, e calado.
 */
const FUNDE_DAQUI = new Set(['mao', 'mao-rapido', 'campo', 'invocado', 'invocado-especial']);

/** O passo anterior mexeu em OUTRA carta que dá para conferir depois? */
const moveOutra = (p) => (p.acao === 'adicionar' || p.acao === 'reviver') && p.alvo === 'outra';

/**
 * Os alvos de um passo. Num passo a carta já pode ter mudado de lugar (o
 * primeiro passo acabou de Invocá-la), então "esta carta" vale para o que se faz
 * com um monstro EM CAMPO — bônus, ataques e destruir —, e nunca para trazê-la
 * de volta ou para a mão.
 */
export function alvosDoPasso(carta, acao, quando) {
  switch (acao) {
    case 'adicionar':
    case 'baixar': return ['outra'];
    // "Invoque ESTE card" num passo: vale quando o efeito é da carta na mão ou no
    // Cemitério — ela ainda está lá quando o passo chega, porque nenhum passo
    // anterior a leva para outro lugar sem acusar (ver `problemasDoEfeito`).
    // Faltava: o "descarte 3 de Tipos diferentes; Invoque este card" da Dragias
    // não tinha como ser montado com a Invocação depois de outro passo.
    case 'reviver':
      return ehMonstro(carta) && ['mao', 'cemiterio', 'enviado-cemiterio'].includes(quando)
        ? ['outra', 'esta'] : ['outra'];
    case 'destruir': return ['outra', 'esta'];
    case 'bonus':
    case 'ataques': return ehMonstro(carta) ? ['esta', 'outra'] : ['outra'];
    case 'enviar-cemiterio': return ['outra'];
    default: return [];
  }
}

/**
 * "Para ELE ou para OUTRO card". `esta` só aparece onde a carta ESTÁ no lugar
 * em que a ação faz sentido na hora de resolver: adicionar esta carta à mão só
 * vale com ela no Cemitério; revivê-la, com ela na mão ou no Cemitério; dar
 * bônus a ela, com ela em campo.
 */
export function alvosPermitidos(carta, quando, acao) {
  const monstro = ehMonstro(carta);
  const gatilho = quando === 'ataque-oponente' || quando === 'invocacao-oponente';
  switch (acao) {
    // Não se escolhe carta nenhuma: o desconto de tributo vale para TODO monstro
    // da mão que casar com o filtro, e não para uma carta apontada.
    // Quem ganha o nome é a própria carta — é o "este card é tratado como".
    case 'ganhar-nome':
      return ['esta'];
    // O desconto de tributo não aponta carta: o filtro é que diz de quem ele fala.
    case 'menos-tributo':
      return [];
    // A proteção contra alvo pode ser da PRÓPRIA carta ("este card não pode ser
    // alvo") ou de um grupo ("seus monstros Normais não podem"). Num monstro as
    // duas fazem sentido; numa Magia/Armadilha só a de grupo.
    case 'nao-alvo':
      return monstro ? ['esta', 'outra'] : ['outra'];
    case 'baixar':
    case 'enviar-cemiterio':
      return ['outra'];
    // "Adicione esta carta à mão" é a volta do CEMITÉRIO, e vale para qualquer
    // tipo: uma Armadilha Normal no Cemitério volta à mão como um monstro. Só o
    // `saiu-do-campo` depende do tipo — o monstro espera no Cemitério, a
    // Contínua espera em campo.
    case 'adicionar': {
      const noCemiterio = ['cemiterio', 'enviado-cemiterio', 'ativou-cartas'].includes(quando)
        || (monstro && quando === 'saiu-do-campo');
      return noCemiterio ? ['outra', 'esta'] : ['outra'];
    }
    // `saiu-do-campo` dispara com a carta no Cemitério: "Invoque ESTA carta por
    // Invocação-Especial do seu Cemitério" é o uso principal do momento.
    case 'reviver':
      return monstro && ['mao', 'mao-rapido', 'cemiterio', 'enviado-cemiterio', 'saiu-do-campo', 'ativou-cartas', 'esta-deixou-campo'].includes(quando)
        ? ['outra', 'esta'] : ['outra'];
    case 'destruir': {
      const l = ['outra'];
      if (gatilho) l.push('gatilho');
      if ((monstro && ['campo', 'invocado', 'invocado-especial'].includes(quando)) || (!monstro && quando === 'campo')) l.push('esta');
      return l;
    }
    case 'bonus': {
      if (quando === 'equipado') return ['equipado'];
      const l = ['outra'];
      if (gatilho) l.push('gatilho');
      if (monstro && ['campo', 'invocado', 'invocado-especial', 'continuo'].includes(quando)) l.push('esta');
      return l;
    }
    case 'ataques':
      // "Esta carta pode atacar mais vezes" só com ela EM CAMPO; da mão, é o
      // "e depois" de uma Invocação que dá os ataques a ela.
      return monstro && ['campo', 'invocado', 'invocado-especial'].includes(quando) ? ['esta', 'outra'] : ['outra'];
    default:
      return [];                                            // comprar e negar não têm alvo
  }
}

/**
 * A ação escolhe cartas por FILTRO? É quem decide se a tela mostra a caixa de
 * OPÇÕES, e mora aqui — e não na tela — porque quem LÊ `ef.filtros` é o gerador.
 *
 * A regra nasceu de um erro calado (19/09/2026): a tela mostrava o filtro só
 * quando a ação tinha alvo (`outra`/`gatilho`), e as duas Invocações com desconto
 * não têm alvo nenhum — o desconto vale para todo monstro da mão que casar, e o
 * filtro É a escolha. Sem a caixa, `menos-tributo` foi salva com a lista vazia e
 * o Lua saiu dando desconto a QUALQUER monstro, sem erro em lugar nenhum: o
 * gerador lia um filtro que a tela nunca deixou preencher.
 *
 * `cardbuilder.test.mjs` cobra isto de toda combinação: se mudar o filtro muda o
 * Lua, a tela precisa oferecer o filtro.
 */
export function usaFiltros(ef) {
  if (!ef) return false;
  // Sem alvo: o filtro é a única coisa que diz de quem a ação fala.
  if (ef.acao === 'sem-tributo' || ef.acao === 'menos-tributo') return true;
  // A proteção de grupo filtra; a da própria carta não tem o que escolher.
  if (ef.acao === 'nao-alvo') return ef.alvo !== 'esta';
  // Comprar não escolhe carta nenhuma: quem compra, compra de cima.
  if (ef.acao === 'comprar') return false;
  return ef.alvo === 'outra' || ef.alvo === 'gatilho';
}

export function custosPermitidos(carta, quando) {
  if (quando === 'continuo' || quando === 'equipado') return ['nenhum'];
  const l = ['nenhum'];
  if (quando === 'mao' || quando === 'mao-rapido') l.push('revelar-esta', 'descartar-esta');
  // A carta está no Cemitério quando o gatilho acontece: banir-se é o custo que
  // cabe ali, o mesmo do `cemiterio`.
  if (['saiu-do-campo', 'esta-saiu-do-campo', 'esta-deixou-campo'].includes(quando)) l.push('banir-esta');
  if (quando === 'campo' && ehMonstro(carta)) l.push('tributar-esta');
  if (quando === 'cemiterio' || quando === 'ativou-cartas') l.push('banir-esta');
  l.push('descartar-1', 'descartar-filtro', 'enviar-cada', 'pagar-lp');
  return l;
}

/** A ativação de uma carta não tem "por cópia": ela sai da zona ao resolver. */
export function limitesPermitidos(carta, quando) {
  if (quando === 'continuo' || quando === 'equipado') return ['nenhum'];
  if (ATIVACOES.has(quando)) return ['nenhum', 'por-nome', 'por-efeito'];
  return ['nenhum', 'por-copia', 'por-nome', 'por-efeito'];
}

// ---------------------------------------------------------------- criação

export function novoFiltro() {
  return {
    categoria: 'monstro', raca: '', atributo: '',
    nivelMin: null, nivelMax: null, atkMin: null, atkMax: null, defMin: null, defMax: null,
    codigo: null, codigoNome: '', lista: null, listaNome: '',
  };
}

export function novoEfeito(carta) {
  const ef = {
    quando: '', custo: 'nenhum', custoLp: 1000, limite: 'nenhum',
    custoQtd: 1, custoTiposDiferentes: false, custoFiltros: [],
    acao: 'adicionar', alvo: 'outra', quantidade: 1,
    origem: 'deck', lado: 'oponente', zona: 'monstro',
    atk: 500, def: 0, duracao: 'turno', ataques: 2,
    respondeA: ['magia', 'armadilha', 'monstro'], destruirNegada: true,
    ativaNoTurno: false, gatilhoFiltros: [],
    ganhaCodigo: null, ganhaNome: '',
    condicao: 'nenhuma', condicaoFiltros: [], nomesDiferentes: false,
    filtros: [novoFiltro()],
    depois: [],
  };
  return carta ? ajustarEfeito(carta, ef) : ef;
}

/** Um passo novo do "e depois": destruir 1 carta em campo, o caso mais comum. */
export function novoPasso(carta) {
  return ajustarPasso(carta, {
    acao: 'destruir', alvo: 'outra', lado: 'qualquer', zona: 'qualquer', quantidade: 1,
    atk: 500, def: 0, duracao: 'turno', ataques: 2, filtros: [],
  });
}

export function novaCarta() {
  const carta = {
    versao: 1, id: null, nome: '',
    tipo: 'monstro-efeito', subtipo: 'normal', visual: 'desenhada',
    atributo: 'DARK', raca: 'Spellcaster', nivel: 4, atk: 1000, def: 1000,
    tratadoComoNormal: false,
    normalNoCemiterio: false,
    tratadoComo: { codigo: null, nome: '' },
    arquetipo: { setcode: null, nome: '' },
    invocacaoEspecial: { ligado: false, umaVezPorTurno: false, custoFiltros: [], destruir: [] },
    texto: '',
    ritual: { codigo: null },
    // A Fusão começa com dois materiais de 1 monstro cada: é a forma mínima
    // ("A + B"), e a tela nunca mostra uma lista vazia para quem troca o tipo.
    fusao: { materiais: [{ qtd: 1, filtros: [novoFiltro()] }, { qtd: 1, filtros: [novoFiltro()] }] },
    equipa: { lado: 'meus', filtros: [] },
    efeitos: [],
  };
  carta.efeitos.push(novoEfeito(carta));
  return carta;
}

// ----------------------------------------------------------- normalização

const int = (v, min, max, padrao) => {
  if (v === '' || v === null || v === undefined) return padrao;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
const intOuNulo = (v, min, max) => int(v, min, max, null);

/**
 * Um setcode de arquétipo: 16 bits, 1–0xFFFF. Aceita o número ou o texto em
 * hexadecimal ("0x62"), que é como `archetype_setcode_constants.lua` os escreve.
 */
function setcodeOuNulo(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'string' && /^\s*0x/i.test(v) ? parseInt(v, 16) : Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 0xffff ? n : null;
}
const escolha = (v, opcoes, padrao = opcoes[0]) => (opcoes.includes(v) ? v : padrao);
const chaves = (pares) => pares.map((p) => p[0]);

/**
 * Qualquer quebra de linha vira espaço — inclusive os separadores Unicode de
 * linha e parágrafo (`\p{Zl}`, `\p{Zp}`), que o Lua não trata como quebra mas
 * que um editor mostra como uma, e que um JS escrito por cima deste nome leria
 * como fim de linha. Nunca escreva esses dois caracteres LITERAIS num fonte:
 * dentro de um regex eles terminam a linha e o arquivo inteiro deixa de carregar.
 */
const QUEBRAS = /[\r\n\p{Zl}\p{Zp}]+/gu;

function normalizarFiltro(f) {
  const b = f ?? {};
  return {
    categoria: escolha(b.categoria, chaves(CATEGORIAS), 'qualquer'),
    raca: RACA.has(b.raca) ? b.raca : '',
    atributo: ATRIBUTO.has(b.atributo) ? b.atributo : '',
    nivelMin: intOuNulo(b.nivelMin, 0, 13),
    nivelMax: intOuNulo(b.nivelMax, 0, 13),
    atkMin: intOuNulo(b.atkMin, 0, 99999),
    atkMax: intOuNulo(b.atkMax, 0, 99999),
    defMin: intOuNulo(b.defMin, 0, 99999),
    defMax: intOuNulo(b.defMax, 0, 99999),
    codigo: intOuNulo(b.codigo, 1, 4294967295),
    // O NOME da carta apontada pelo `codigo`, só para o TEXTO ("baixe 1
    // 'Legado dos Guerreiros'", como as cartas oficiais escrevem). Quem manda no
    // Lua é sempre o `codigo`: o motor não conhece nome nenhum, ele compara
    // `IsCode`. É por isso que dá para apontar para uma carta que AINDA NÃO
    // EXISTE — o filtro simplesmente não casa com nada até ela ser criada, sem
    // erro e sem quebrar o duelo.
    codigoNome: String(b.codigoNome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80),
    // "que LISTA a carta X" — o `Card.ListsCode` do motor, que é como se pede
    // "1 Magia que liste 'Dark Magician'". Ele responde pelo `listed_names` que o
    // script da carta declara, então vale para as cartas oficiais que citam o
    // nome: não é busca em texto, e uma carta sem script não lista nada.
    lista: intOuNulo(b.lista, 1, 4294967295),
    listaNome: String(b.listaNome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80),
  };
}

/**
 * Põe as escolhas de um efeito dentro do que o tipo da carta aceita — é o que
 * roda quando o admin troca o tipo depois de montar os efeitos. Escolha que
 * deixou de existir cai na primeira permitida, em vez de sobrar invisível no
 * JSON e reaparecer no Lua.
 */
export function ajustarEfeito(carta, bruto) {
  const b = bruto ?? {};
  const ef = { ...b };
  const qs = quandoPermitidos(carta);
  ef.quando = escolha(b.quando, qs, qs[0] ?? 'ativacao');
  ef.acao = escolha(b.acao, acoesPermitidas(carta, ef.quando));
  const alvos = alvosPermitidos(carta, ef.quando, ef.acao);
  ef.alvo = alvos.length ? escolha(b.alvo, alvos) : null;
  ef.custo = escolha(b.custo, custosPermitidos(carta, ef.quando));
  ef.custoLp = int(b.custoLp, 1, 8000, 1000);
  ef.limite = escolha(b.limite, limitesPermitidos(carta, ef.quando));
  ef.quantidade = ef.acao === 'reviver' ? 1 : int(b.quantidade, 1, 5, 1);
  ef.origem = ORIGENS[ef.acao] ? escolha(b.origem, chaves(ORIGENS[ef.acao])) : null;
  ef.lado = LADOS[ef.acao] ? escolha(b.lado, chaves(LADOS[ef.acao])) : null;
  ef.zona = escolha(b.zona, chaves(ZONAS));
  ef.atk = int(b.atk, -9999, 9999, 0);
  ef.def = int(b.def, -9999, 9999, 0);
  ef.duracao = escolha(b.duracao, chaves(DURACOES));
  ef.respondeA = (Array.isArray(b.respondeA) ? b.respondeA : []).filter((x) => chaves(RESPONDE_A).includes(x));
  ef.destruirNegada = b.destruirNegada !== false;
  ef.filtros = (Array.isArray(b.filtros) ? b.filtros : []).slice(0, 6).map(normalizarFiltro);
  ef.custoQtd = int(b.custoQtd, 1, 5, 1);
  ef.custoTiposDiferentes = !!b.custoTiposDiferentes;
  ef.custoFiltros = (Array.isArray(b.custoFiltros) ? b.custoFiltros : []).slice(0, 6).map(normalizarFiltro);
  ef.ataques = int(b.ataques, 2, 5, 2);
  ef.nomesDiferentes = !!b.nomesDiferentes;
  // "Adicione 1 X e 1 Y": cada opção do filtro é UMA carta, todas obrigatórias
  // (ver `funcoesDeCada`). Só o adicionar de outra carta sabe fazer isso.
  ef.umDeCada = !!b.umDeCada;
  // "Destrua TODAS as cartas que…" — sem escolha nem alvo (ver `passoDaSequencia`).
  ef.todas = !!b.todas;
  // Gatilho sem "você pode": `TRIGGER_F`. Só existe nos momentos de gatilho.
  ef.obrigatorio = GATILHOS.has(ef.quando) && !!b.obrigatorio;
  // "(Esta carta pode ser ativada neste turno)" — só o baixar tem o que fazer
  // com isso; guardado à toa nos outros, reapareceria no dia em que a ação
  // mudasse de volta.
  ef.ativaNoTurno = !!b.ativaNoTurno;
  // QUEM disparou o gatilho é pergunta separada de QUEM a ação afeta: em
  // "se um monstro Normal seu deixar o campo, Invoque 1 monstro do Deck" as
  // duas listas descrevem cartas diferentes. Um campo só para as duas faria a
  // busca herdar o filtro do gatilho em silêncio.
  ef.gatilhoFiltros = (Array.isArray(b.gatilhoFiltros) ? b.gatilhoFiltros : []).slice(0, 6).map(normalizarFiltro);
  // O nome que a carta GANHA com o efeito (`ganhar-nome`). O id manda no motor;
  // o nome é rótulo do texto.
  ef.ganhaCodigo = intOuNulo(b.ganhaCodigo, 1, 4294967295);
  ef.ganhaNome = String(b.ganhaNome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80);
  // Condição que o momento não aceita cai para "sempre"; os filtros dela ficam,
  // como os do custo, para o dia em que o admin a religar.
  ef.condicao = permiteCondicao(ef) ? escolha(b.condicao, Object.keys(CONDICOES)) : 'nenhuma';
  ef.condicaoFiltros = (Array.isArray(b.condicaoFiltros) ? b.condicaoFiltros : []).slice(0, 6).map(normalizarFiltro);
  // Passo que o momento não aceita some aqui, e não na geração: sobrar no JSON
  // faria ele reaparecer no dia em que o admin trocasse o momento de volta.
  ef.depois = permiteSequencia(ef)
    ? (Array.isArray(b.depois) ? b.depois : []).slice(0, MAX_PASSOS).map((p) => ajustarPasso(carta, p, ef.quando))
    : [];
  return ef;
}

/**
 * Um passo do "e depois", dentro do que ele aceita — a mesma ideia do
 * `ajustarEfeito`. O `quando` é o momento do EFEITO: sem ele "Invocar esta
 * carta" não é oferecido e um passo salvo assim viraria "outra carta", calado.
 */
export function ajustarPasso(carta, bruto, quando) {
  const b = bruto ?? {};
  const p = { ...b };
  p.acao = escolha(b.acao, acoesDoPasso(carta));
  const alvos = alvosDoPasso(carta, p.acao, quando);
  p.alvo = alvos.length ? escolha(b.alvo, alvos) : null;
  p.quantidade = p.acao === 'reviver' ? 1 : int(b.quantidade, 1, 5, 1);
  p.origem = ORIGENS[p.acao] ? escolha(b.origem, chaves(ORIGENS[p.acao])) : null;
  p.lado = LADOS[p.acao] ? escolha(b.lado, chaves(LADOS[p.acao])) : null;
  p.zona = escolha(b.zona, chaves(ZONAS));
  p.atk = int(b.atk, -9999, 9999, 0);
  p.def = int(b.def, -9999, 9999, 0);
  p.duracao = escolha(b.duracao, chaves(DURACOES));
  p.ataques = int(b.ataques, 2, 5, 2);
  p.nomesDiferentes = !!b.nomesDiferentes;
  p.umDeCada = !!b.umDeCada;
  p.todas = !!b.todas;
  p.ativaNoTurno = !!b.ativaNoTurno;
  p.ganhaCodigo = intOuNulo(b.ganhaCodigo, 1, 4294967295);
  p.ganhaNome = String(b.ganhaNome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80);
  p.filtros = (Array.isArray(b.filtros) ? b.filtros : []).slice(0, 6).map(normalizarFiltro);
  // O monstro de Fusão do `fundir`. O id manda no motor; o nome é rótulo do texto.
  p.fusaoCodigo = intOuNulo(b.fusaoCodigo, 1, 4294967295);
  p.fusaoNome = String(b.fusaoNome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80);
  // "…você PODE": o passo pergunta sim/não antes (e só se ele for possível).
  p.opcional = !!b.opcional;
  // "Se você adicionou 1 X do seu Cemitério POR ESTE EFEITO": o passo só roda se
  // o passo ANTERIOR moveu uma carta que casa com `seFiltros` (vazio = sem
  // condição). É pergunta sobre o que ACONTECEU, e não sobre o que há em campo.
  p.seFiltros = (Array.isArray(b.seFiltros) ? b.seFiltros : []).slice(0, 6).map(normalizarFiltro);
  p.seDoCemiterio = !!b.seDoCemiterio;
  return p;
}

/** A carta em forma, com tudo coagido. `gerarLua` só enxerga isto. */
export function normalizarCarta(bruta) {
  const b = bruta ?? {};
  const tipo = escolha(b.tipo, chaves(TIPOS), 'monstro-efeito');
  const subs = SUBTIPOS[tipo] ? chaves(SUBTIPOS[tipo]) : ['normal'];
  const carta = {
    versao: 1,
    id: intOuNulo(b.id, ID_MIN, ID_MAX),
    // Uma linha, sem quebra: é o único texto livre que chega ao arquivo `.lua`,
    // e só como comentário. Uma quebra ali viraria uma linha de CÓDIGO.
    nome: String(b.nome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80),
    tipo,
    subtipo: escolha(b.subtipo, subs),
    // Visual desconhecido cai no layout do builder, que não precisa de imagem.
    visual: escolha(b.visual, chaves(VISUAIS)),
    atributo: ATRIBUTO.has(b.atributo) ? b.atributo : 'DARK',
    raca: RACA.has(b.raca) ? b.raca : 'Warrior',
    nivel: int(b.nivel, 1, 12, 4),
    atk: int(b.atk, 0, 9999, 0),
    def: int(b.def, 0, 9999, 0),
    // "Este card é sempre tratado como um monstro Normal". Vira o BIT
    // `TYPE_NORMAL` em `dadosDoMotor`, e não um efeito registrado: assim vale em
    // TODA zona (mão, Deck, campo, Cemitério, banidas) e para todo filtro que
    // leia o tipo — inclusive os filtros desta própria carta. Um efeito
    // registrado só valeria onde ele tivesse alcance, e "sempre" quer dizer
    // sempre. Ver `dadosDoMotor`.
    tratadoComoNormal: !!b.tratadoComoNormal,
    // "Enquanto estiver no Cemitério, esta carta é tratada como um monstro
    // Normal" — o irmão de alcance LIMITADO do de cima. Aqui não dá para ser o
    // bit: na mão e em campo ela continua de Efeito. É o par ADD_TYPE/REMOVE_TYPE
    // do Gemini oficial (`proc_gemini.lua`), com alcance só do Cemitério.
    normalNoCemiterio: !!b.normalNoCemiterio,
    // "Esta carta é sempre tratada como <outra carta>" — o `EFFECT_ADD_CODE` dos
    // scripts oficiais. O NOME é rótulo do texto; quem o motor lê é o `codigo`,
    // e por isso ele pode apontar para uma carta que ainda não existe.
    tratadoComo: {
      codigo: intOuNulo(b.tratadoComo?.codigo, 1, 4294967295),
      nome: String(b.tratadoComo?.nome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 80),
    },
    // "Este card é sempre tratado como um card 'Toon'" — o ARQUÉTIPO (setcode),
    // que é o que `IsSetCard` pergunta. Não é o tipo `TYPE_TOON`: esse traria as
    // regras de monstro Toon (depender do Toon World, não atacar no turno). O
    // setcode manda no motor (aceita "0x62"); o nome é rótulo do texto e do
    // filtro de arquétipo do Deck Builder.
    arquetipo: {
      setcode: setcodeOuNulo(b.arquetipo?.setcode),
      nome: String(b.arquetipo?.nome ?? '').replace(QUEBRAS, ' ').trim().slice(0, 40),
    },
    // PROCEDIMENTO PRÓPRIO de Invocação-Especial (`EFFECT_SPSUMMON_PROC`): a
    // carta sai da MÃO pagando um preço, e não por um efeito que a invoque. É
    // propriedade da CARTA, como a receita da Fusão — não um efeito da lista.
    //
    // `destruir` são os grupos que a Invocação obriga a destruir; cada um é
    // "1 carta que case com este filtro". Eles entram TAMBÉM na condição: sem
    // todos em campo, a Invocação não é oferecida (foi a escolha do usuário —
    // o outro caminho seria destruir só o que houvesse).
    invocacaoEspecial: {
      ligado: !!b.invocacaoEspecial?.ligado,
      umaVezPorTurno: !!b.invocacaoEspecial?.umaVezPorTurno,
      custoFiltros: (Array.isArray(b.invocacaoEspecial?.custoFiltros) ? b.invocacaoEspecial.custoFiltros : [])
        .slice(0, 6).map(normalizarFiltro),
      destruir: (Array.isArray(b.invocacaoEspecial?.destruir) ? b.invocacaoEspecial.destruir : [])
        .slice(0, 3).map((g) => ({
          filtros: (Array.isArray(g?.filtros) ? g.filtros : []).slice(0, 6).map(normalizarFiltro),
        })),
    },
    texto: String(b.texto ?? '').slice(0, 1200),
    ritual: { codigo: intOuNulo(b.ritual?.codigo, 1, 4294967295) },
    // Os materiais entram no Lua como funções de filtro: coagidos aqui, como
    // todo o resto, antes de `gerarLua` escrever uma linha.
    fusao: {
      materiais: (Array.isArray(b.fusao?.materiais) ? b.fusao.materiais : []).slice(0, 5).map((m) => ({
        qtd: int(m?.qtd, 1, 5, 1),
        filtros: (Array.isArray(m?.filtros) ? m.filtros : []).slice(0, 6).map(normalizarFiltro),
      })),
    },
    equipa: {
      lado: escolha(b.equipa?.lado, chaves(LADOS.bonus)),
      filtros: (Array.isArray(b.equipa?.filtros) ? b.equipa.filtros : []).slice(0, 6).map(normalizarFiltro),
    },
    efeitos: [],
  };
  const { max } = limiteDeEfeitos(carta);
  carta.efeitos = (Array.isArray(b.efeitos) ? b.efeitos : []).slice(0, max).map((e) => ajustarEfeito(carta, e));
  return carta;
}

// --------------------------------------------------------------- problemas

/** Nível/ATK/DEF/raça/atributo — o que só um monstro tem. */
const temStats = (f) => !!(f.raca || f.atributo || f.nivelMin != null || f.nivelMax != null
  || f.atkMin != null || f.atkMax != null || f.defMin != null || f.defMax != null);

function problemasDoFiltro(f, { soMonstro, soMagiaArmadilha, soBaixavel }) {
  const p = [];
  const cat = f.categoria;
  const naoMonstro = cat === 'magia' || cat === 'armadilha';
  if (temStats(f) && naoMonstro) p.push('raça, atributo, Nível, ATK e DEF só existem em monstro');
  if (soMonstro && naoMonstro) p.push('este alvo só pode ser monstro');
  if (soMagiaArmadilha && (temStats(f) || cat.startsWith('monstro'))) p.push('na zona de magia/armadilha não há monstro');
  if (soBaixavel && (temStats(f) || cat.startsWith('monstro'))) p.push('só Magia e Armadilha podem ser baixadas');
  for (const [a, b, nome] of [['nivelMin', 'nivelMax', 'Nível'], ['atkMin', 'atkMax', 'ATK'], ['defMin', 'defMax', 'DEF']]) {
    if (f[a] != null && f[b] != null && f[a] > f[b]) p.push(`o mínimo de ${nome} passou do máximo`);
  }
  // O NOME sozinho não aponta para nada. Quem o motor lê é o `codigo` (`IsCode`);
  // o nome é rótulo do texto. Preenchida só a caixa do nome, o filtro casa com
  // QUALQUER carta — "adicione 1 'The Warrior Returning Alive'" vira "adicione 1
  // Magia qualquer" —, e nem no texto o nome aparece, porque ele só sai
  // acompanhado do id. Nada disso dá erro: a carta salva e o duelo roda errado.
  if (f.codigo == null && f.codigoNome) {
    p.push(`"${f.codigoNome}": falta o id da carta — só o nome não aponta para nada`);
  }
  if (f.lista == null && f.listaNome) {
    p.push(`"${f.listaNome}": falta o id da carta listada — só o nome não aponta para nada`);
  }
  return p;
}

function problemasDoEfeito(carta, ef) {
  const p = [];
  if (ef.acao === 'bonus' && ef.atk === 0 && ef.def === 0) p.push('o bônus precisa mudar o ATK ou a DEF');
  // Sem o id o efeito "resolve" sem renomear nada — e o passo seguinte roda
  // como se tivesse dado certo.
  if (ef.acao === 'ganhar-nome' && !ef.ganhaCodigo) p.push('informe o id da carta cujo nome esta carta ganha');
  if (ef.acao === 'negar' && !ef.respondeA.length) p.push('escolha a que a Contra-Armadilha responde');

  if (ef.acao === 'sem-tributo' || ef.acao === 'menos-tributo') {
    ef.filtros.forEach((f, i) => {
      const onde = ef.filtros.length > 1 ? `opção ${i + 1}: ` : '';
      for (const t of problemasDoFiltro(f, { soMonstro: true })) p.push(onde + t);
      // Nível 4 ou menos já se Invoca sem tributo: a opção nunca mudaria nada.
      if (f.nivelMax != null && f.nivelMax < 5) p.push(`${onde}monstro de Nível 4 ou menos já é Invocado sem tributo`);
      // Nível 5 e 6 pedem UM tributo: "2 a menos" ali é um desconto que não
      // existe, e o efeito não faria nada — sem erro nenhum no duelo.
      if (ef.acao === 'menos-tributo' && ef.quantidade > 1 && f.nivelMax != null && f.nivelMax < 7) {
        p.push(`${onde}monstro de Nível 5 ou 6 pede só 1 tributo: "${ef.quantidade} a menos" não muda nada`);
      }
    });
  }
  // Toda condição escrita tem filtro — não só a de controlar.
  if (ef.condicao !== 'nenhuma') {
    ef.condicaoFiltros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, { soMonstro: ef.condicao !== 'nada-mais' })) p.push(`condição, opção ${i + 1}: ${t}`);
    });
  }

  if (ef.alvo === 'esta') {
    if (ef.custo === 'descartar-esta') p.push('descartar esta carta e usá-la como alvo no mesmo efeito não fecha');
    if (ef.custo === 'tributar-esta') p.push('tributar esta carta e usá-la como alvo no mesmo efeito não fecha');
    if (ef.custo === 'banir-esta') p.push('banir esta carta e usá-la como alvo no mesmo efeito não fecha');
  }

  const precisaFiltro = ef.alvo === 'outra' || ef.alvo === 'gatilho';
  if (precisaFiltro && ef.acao !== 'comprar') {
    const soMonstro = ef.acao === 'reviver' || ef.acao === 'bonus' || ef.alvo === 'gatilho'
      || (ef.acao === 'destruir' && ef.zona === 'monstro');
    const soMagiaArmadilha = ef.acao === 'destruir' && ef.zona === 'magia-armadilha' && ef.alvo === 'outra';
    const soBaixavel = ef.acao === 'baixar';
    ef.filtros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, { soMonstro, soMagiaArmadilha, soBaixavel })) {
        p.push(ef.filtros.length > 1 ? `opção ${i + 1}: ${t}` : t);
      }
    });
  }

  // As três listas de "1 de cada": sem opção nenhuma não há carta a pedir, e o
  // Lua sairia pedindo nada (o gatilho nunca acordaria; o custo e a busca
  // "resolveriam" sem mexer em carta nenhuma).
  if (ef.quando === 'ativou-cartas') {
    if (!ef.gatilhoFiltros.length) p.push('diga quais cartas você precisa ativar (uma opção por carta)');
    ef.gatilhoFiltros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, {})) p.push(`carta ativada ${i + 1}: ${t}`);
    });
  }
  if (ef.custo === 'enviar-cada') {
    if (!ef.custoFiltros.length) p.push('custo: diga quais cartas vão ao Cemitério (uma opção por carta)');
    ef.custoFiltros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, {})) p.push(`custo, carta ${i + 1}: ${t}`);
    });
  }
  if ((ef.acao === 'adicionar' || ef.acao === 'reviver') && ef.alvo === 'outra' && ef.umDeCada && !ef.filtros.length) {
    p.push('"1 de cada" precisa de uma opção por carta');
  }
  // "1 de cada" na Invocação escolhe na resolução: só do SEU lado, e nunca como
  // alvo (a busca com volta atrás olha um lado só).
  if (ef.acao === 'reviver' && ef.alvo === 'outra' && ef.umDeCada && ef.origem.endsWith('-ambos')) {
    p.push('"1 de cada" só Invoca do seu lado — troque "de qualquer lado"');
  }

  if (ef.custo === 'descartar-filtro') {
    ef.custoFiltros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, {})) p.push(`custo, opção ${i + 1}: ${t}`);
    });
    // "Tipos diferentes" é Tipo de MONSTRO (a raça): magia e armadilha não têm,
    // e o custo nunca poderia ser pago — a carta ficaria na mão sem ativar, calada.
    if (ef.custoTiposDiferentes && ef.custoFiltros.some((f) => f.categoria === 'magia' || f.categoria === 'armadilha')) {
      p.push('custo: "de Tipos diferentes" só existe entre monstros');
    }
  }

  ef.depois.forEach((passo, k) => {
    for (const t of problemasDoPasso(passo)) p.push(`e depois (${k + 1}): ${t}`);
    // "Se você adicionou X por este efeito" pergunta ao passo ANTERIOR: sem uma
    // carta movida por ele, a condição nunca seria verdade e o passo nunca rodaria.
    const anterior = k === 0 ? ef : ef.depois[k - 1];
    if (passo.seFiltros.length && !moveOutra(anterior)) {
      p.push(`e depois (${k + 1}): "se o passo anterior moveu…" só existe depois de adicionar ou Invocar OUTRA carta`);
    }
    if (passo.acao === 'fundir') {
      if (!FUNDE_DAQUI.has(ef.quando)) {
        p.push(`e depois (${k + 1}): a Fusão usa esta carta — ela precisa estar na mão ou em campo (momento da mão, do campo ou "ao ser Invocado")`);
      }
      if (['descartar-esta', 'tributar-esta', 'banir-esta'].includes(ef.custo)) {
        p.push(`e depois (${k + 1}): o custo já tirou esta carta de onde ela seria material`);
      }
    }
  });

  // "Esta carta" num passo depende de ela AINDA estar onde estava. Um custo que
  // a tira da mão/Cemitério, ou um passo anterior que a Invoca ou põe na mão,
  // deixa o passo sem carta: o motor resolve o resto e esse passo não faz nada,
  // calado. (No 1º passo, o custo contraditório já é acusado lá em cima.)
  let saiu = ['descartar-esta', 'tributar-esta', 'banir-esta'].includes(ef.custo);
  [ef, ...ef.depois].forEach((passo, k) => {
    const pegaEsta = passo.alvo === 'esta' && (passo.acao === 'reviver' || passo.acao === 'adicionar');
    if (k > 0 && pegaEsta && saiu) {
      p.push(`e depois (${k}): esta carta já saiu de onde estava (pelo custo ou por um passo anterior)`);
    }
    if (pegaEsta) saiu = true;

    // "De Tipos/Atributos diferentes" é Tipo e Atributo de MONSTRO: com filtro de
    // magia/armadilha a escolha nunca separaria nada, e a promessa do texto
    // ("um de cada") não seria cumprida por ninguém.
    const diferentes = passo.acao === 'adicionar' && passo.alvo === 'outra'
      && (passo.tiposDiferentes || passo.atributosDiferentes);
    if (diferentes && passo.filtros.some((f) => f.categoria === 'magia' || f.categoria === 'armadilha')) {
      p.push(`${k > 0 ? `e depois (${k}): ` : ''}"de Tipos/Atributos diferentes" só existe entre monstros`);
    }
  });
  return p;
}

/** Os problemas de um passo do "e depois" — o mesmo critério do efeito. */
function problemasDoPasso(passo) {
  const p = [];
  // Sem o id a Fusão não tem monstro nenhum para procurar no Extra Deck.
  if (passo.acao === 'fundir' && !passo.fusaoCodigo) p.push('informe o id do monstro de Fusão');
  if (!passo.fusaoCodigo && passo.fusaoNome) p.push(`"${passo.fusaoNome}": falta o id — só o nome não aponta para nada`);
  passo.seFiltros.forEach((f, i) => {
    for (const t of problemasDoFiltro(f, {})) p.push(`condição, opção ${i + 1}: ${t}`);
  });
  if (passo.acao === 'bonus' && passo.atk === 0 && passo.def === 0) p.push('o bônus precisa mudar o ATK ou a DEF');
  if ((passo.acao === 'adicionar' || passo.acao === 'reviver') && passo.alvo === 'outra' && passo.umDeCada && !passo.filtros.length) {
    p.push('"1 de cada" precisa de uma opção por carta');
  }
  if (passo.alvo === 'outra' && passo.acao !== 'comprar') {
    const soMonstro = ['reviver', 'bonus', 'ataques'].includes(passo.acao)
      || (passo.acao === 'destruir' && passo.zona === 'monstro');
    const soMagiaArmadilha = passo.acao === 'destruir' && passo.zona === 'magia-armadilha';
    const soBaixavel = passo.acao === 'baixar';
    passo.filtros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, { soMonstro, soMagiaArmadilha, soBaixavel })) {
        p.push(passo.filtros.length > 1 ? `opção ${i + 1}: ${t}` : t);
      }
    });
  }
  return p;
}

/**
 * Tudo que impede salvar, como `[{ efeito: índice|null, texto }]`. Vazio é
 * "pode salvar". A tela desenha cada um ao lado do que o causou.
 */
export function problemasDaCarta(bruta) {
  const carta = normalizarCarta(bruta);
  const fora = [];
  const card = (texto) => fora.push({ efeito: null, texto });

  if (!carta.nome) card('dê um nome à carta');
  const qtd = Array.isArray(bruta?.efeitos) ? bruta.efeitos.length : 0;
  const { min, max } = limiteDeEfeitos(carta);
  if (qtd > max) card(max === 0 ? 'este tipo de carta não tem efeitos' : `este tipo aceita no máximo ${max} efeito(s)`);
  if (qtd < min) card(`este tipo precisa de ${min === 1 ? 'um efeito' : `${min} efeitos`}`);
  if (carta.tipo === 'monstro-fusao') {
    // O motor só oferece a Polymerization com uma receita que feche: Fusão com um
    // material só não é Fusão, e a carta ficaria no Extra Deck para sempre.
    const total = carta.fusao.materiais.reduce((soma, m) => soma + m.qtd, 0);
    if (total < 2) card('uma Fusão precisa de pelo menos 2 materiais');
    if (total > 5) card('uma Fusão aceita no máximo 5 materiais');
    carta.fusao.materiais.forEach((m, i) => {
      m.filtros.forEach((f) => problemasDoFiltro(f, { soMonstro: true }).forEach((t) => card(`material ${i + 1}: ${t}`)));
    });
  }
  if (carta.tipo === 'magia' && carta.subtipo === 'ritual' && !carta.ritual.codigo) {
    card('informe o id do monstro de Ritual que esta magia invoca');
  }
  // O mesmo do filtro: o nome sozinho não aponta para carta nenhuma.
  if (ehMonstro(carta) && carta.tratadoComoNormal && carta.normalNoCemiterio) {
    card('"tratada como Normal no Cemitério" não soma nada a "sempre tratada como Normal" — marque só uma');
  }
  // O nome do arquétipo sozinho não é arquétipo nenhum: o motor pergunta o setcode.
  if (!carta.arquetipo.setcode && carta.arquetipo.nome) {
    card(`"tratada como ${carta.arquetipo.nome}": falta o setcode do arquétipo (ex.: 0x62)`);
  }
  if (!carta.tratadoComo.codigo && carta.tratadoComo.nome) {
    card(`"tratada como ${carta.tratadoComo.nome}": falta o id da carta`);
  }
  if (carta.efeitos.filter((e) => e.quando === 'ativacao').length > 1) {
    card('só um efeito pode ser o da ativação da carta');
  }
  if (resolveEVai(carta) && carta.efeitos.length && !carta.efeitos.some((e) => ATIVACOES.has(e.quando))) {
    card('esta carta precisa de um efeito de ativação — os do Cemitério não a tiram da mão');
  }
  if (carta.tipo === 'magia' && carta.subtipo === 'equipamento') {
    carta.equipa.filtros.forEach((f) => problemasDoFiltro(f, { soMonstro: true }).forEach((t) => card(`equipar: ${t}`)));
  }
  carta.efeitos.forEach((ef, i) => problemasDoEfeito(carta, ef).forEach((texto) => fora.push({ efeito: i, texto })));
  return fora;
}

// ================================================================ o Lua
//
// O idioma é o dos scripts oficiais que o motor já roda — `local s,id=GetID()`,
// `#g`, `Cost.SelfDiscard`, `aux.AddEquipProcedure`, `Ritual.AddProcGreater`.
// Nada de função nova do core: a `ocgcore.dll` daqui é MAIS VELHA que os
// scripts (o `Group.Iter` não existe nela — ver `--test-synthesis`), então o
// seguro é escrever como as cartas que já provadamente funcionam.

const T = (n) => '\t'.repeat(n);

/** As condições de UM grupo do filtro, ligadas por `and`. */
function condicoes(f, { exigeMonstro = false, faceUp = false } = {}) {
  const c = [];
  const stats = temStats(f);
  if (faceUp && stats) c.push('c:IsFaceup()');
  switch (f.categoria) {
    case 'monstro': c.push('c:IsType(TYPE_MONSTER)'); break;
    case 'monstro-normal': c.push('c:IsType(TYPE_MONSTER)', 'c:IsType(TYPE_NORMAL)'); break;
    case 'monstro-efeito': c.push('c:IsType(TYPE_MONSTER)', 'c:IsType(TYPE_EFFECT)'); break;
    case 'magia': c.push('c:IsType(TYPE_SPELL)'); break;
    case 'armadilha': c.push('c:IsType(TYPE_TRAP)'); break;
    default:
      // Magia tem ATK 0 e Nível 0: sem isto, "ATK até 1500" pegaria toda magia
      // do Deck. É por isso que o Sangan oficial pede `IsMonster()`.
      if (stats || exigeMonstro) c.push('c:IsType(TYPE_MONSTER)');
  }
  if (f.raca) c.push(`c:IsRace(${RACA.get(f.raca)[2]})`);
  if (f.atributo) c.push(`c:IsAttribute(${ATRIBUTO.get(f.atributo)[2]})`);
  if (f.nivelMin != null) c.push(`c:IsLevelAbove(${f.nivelMin})`);
  if (f.nivelMax != null) c.push(`c:IsLevelBelow(${f.nivelMax})`);
  if (f.atkMin != null) c.push(`c:IsAttackAbove(${f.atkMin})`);
  if (f.atkMax != null) c.push(`c:IsAttackBelow(${f.atkMax})`);
  if (f.defMin != null) c.push(`c:IsDefenseAbove(${f.defMin})`);
  if (f.defMax != null) c.push(`c:IsDefenseBelow(${f.defMax})`);
  if (f.codigo != null) c.push(`c:IsCode(${f.codigo})`);
  if (f.lista != null) c.push(`c:ListsCode(${f.lista})`);
  return c;
}

/** Os grupos, ligados por `or`. Sem grupo nenhum: qualquer carta (ou monstro). */
function expressao(filtros, opts = {}) {
  const grupos = filtros.map((f) => condicoes(f, opts)).map((cs) => (cs.length ? cs.join(' and ') : 'true'));
  if (!grupos.length) return opts.exigeMonstro ? 'c:IsType(TYPE_MONSTER)' : 'true';
  if (grupos.length === 1) return grupos[0];
  return grupos.map((g) => `(${g})`).join(`\n${T(2)}or `);
}

/** `return (A) and B` sem parêntese sobrando quando a expressão é `true`. */
const eJunto = (expr, resto) => (expr === 'true' ? resto : `(${expr}) and ${resto}`);

function linhasDoBonus(ef, alvo) {
  const reset = ef.duracao === 'turno' ? 'RESETS_STANDARD_PHASE_END' : 'RESET_EVENT|RESETS_STANDARD';
  const l = [];
  const um = (v, codigo, valor) => l.push(
    `${T(2)}local ${v}=Effect.CreateEffect(e:GetHandler())`,
    `${T(2)}${v}:SetType(EFFECT_TYPE_SINGLE)`,
    `${T(2)}${v}:SetCode(${codigo})`,
    `${T(2)}${v}:SetValue(${valor})`,
    `${T(2)}${v}:SetReset(${reset})`,
    `${T(2)}${alvo}:RegisterEffect(${v})`,
  );
  if (ef.atk) um('e1', 'EFFECT_UPDATE_ATTACK', ef.atk);
  if (ef.def) um('e2', 'EFFECT_UPDATE_DEFENSE', ef.def);
  return l;
}

const cabecaAlvo = (n, chkc = false) =>
  `function s.alvo${n}(e,tp,eg,ep,ev,re,r,rp,chk${chkc ? ',chkc' : ''})`;
const cabecaOp = (n) => `function s.operacao${n}(e,tp,eg,ep,ev,re,r,rp)`;

/** O monstro do gatilho: quem atacou, ou quem acabou de ser Invocado. */
const tcDoGatilho = (quando) => (quando === 'ataque-oponente' ? 'Duel.GetAttacker()' : 'eg:GetFirst()');

/**
 * **"1 X e 1 Y"** — uma carta de CADA opção, todas obrigatórias. É o "e" do
 * texto, e não o "ou" que as opções querem dizer em todo o resto do builder.
 * Serve ao custo `enviar-cada` e ao `adicionar` com `umDeCada`.
 *
 * Gera, com `nome` = `s.cada1`:
 *   • `s.cada1_1`, `s.cada1_2`… — o filtro de cada opção, com `extra` junto;
 *   • `s.cada1` — a lista deles;
 *   • `s.cada1_resta(tp,sg,ex,i)` — "dá para achar uma carta para cada opção
 *     de i em diante, sem repetir as de `sg` nem `ex`?";
 *   • `s.cada1_escolhe(tp,ex,hint)` — escolhe uma por opção e devolve o grupo.
 *
 * A pergunta é uma busca com volta atrás, e não uma contagem por opção, porque
 * UMA carta pode casar com duas opções: com um só "Red Medicine" no Deck e as
 * opções "Red Medicine" e "Magia Normal", contar daria 1+1 e a carta seria
 * gasta duas vezes. E a escolha só oferece carta que deixa as opções
 * seguintes possíveis — quem escolhe nunca fica sem saída no meio. Por isso o
 * grupo volta INTEIRO ou VAZIO, nunca pela metade.
 *
 * `Group.Iter`/`aux.SelectUnselectGroup` não entram: a `ocgcore.dll` daqui não
 * tem o primeiro (ver `escolherDiferentes`). Linhas sem indentação de base.
 */
function funcoesDeCada(nome, filtros, LOC, extra, comE = false) {
  // `comE`: os filtros recebem `(c,e,tp)` — a Invocação pergunta
  // `IsCanBeSpecialSummoned(e,0,tp,…)`. Desligado, a saída é a de sempre.
  const E = comE ? ',e' : '';
  const ARGS = comE ? ',e,tp' : '';
  const l = [];
  filtros.forEach((f, i) => l.push(`function ${nome}_${i + 1}(c${ARGS})`,
    `${T(1)}return ${eJunto(expressao([f]), extra)}`,
    'end'));
  l.push(`${nome}={${filtros.map((_, i) => `${nome}_${i + 1}`).join(',')}}`,
    `function ${nome}_resta(tp,sg,ex,i${E})`,
    `${T(1)}if i>#${nome} then return true end`,
    `${T(1)}local g=Duel.GetMatchingGroup(${nome}[i],tp,${LOC},0,sg${ARGS})`,
    `${T(1)}if ex then g:RemoveCard(ex) end`,
    `${T(1)}local tc=g:GetFirst()`,
    `${T(1)}while tc do`,
    `${T(2)}sg:AddCard(tc)`,
    `${T(2)}local ok=${nome}_resta(tp,sg,ex,i+1${E})`,
    `${T(2)}sg:RemoveCard(tc)`,
    `${T(2)}if ok then return true end`,
    `${T(2)}tc=g:GetNext()`,
    `${T(1)}end`,
    `${T(1)}return false`,
    'end',
    `function ${nome}_escolhe(tp,ex,hint${E})`,
    `${T(1)}local sg=Group.CreateGroup()`,
    `${T(1)}for i=1,#${nome} do`,
    `${T(2)}local g=Duel.GetMatchingGroup(${nome}[i],tp,${LOC},0,sg${ARGS})`,
    `${T(2)}if ex then g:RemoveCard(ex) end`,
    `${T(2)}g=g:Filter(function(c)`,
    `${T(3)}sg:AddCard(c)`,
    `${T(3)}local ok=${nome}_resta(tp,sg,ex,i+1${E})`,
    `${T(3)}sg:RemoveCard(c)`,
    `${T(3)}return ok`,
    `${T(2)}end,nil)`,
    `${T(2)}if #g==0 then return Group.CreateGroup() end`,
    `${T(2)}Duel.Hint(HINT_SELECTMSG,tp,hint)`,
    `${T(2)}sg:Merge(g:Select(tp,1,1,nil))`,
    `${T(1)}end`,
    `${T(1)}return sg`,
    'end');
  return l;
}

/**
 * "Todo dano que você sofreria neste turno se torna 0" — as duas peças do
 * oficial `c7025445` (Power Giant), com a duração do turno inteiro:
 * `EFFECT_CHANGE_DAMAGE` com valor 0 zera o dano de BATALHA e o de efeito que
 * chega a ser calculado, e `EFFECT_NO_EFFECT_DAMAGE` é o que o motor pergunta
 * antes de causar dano por efeito. Uma sem a outra deixa passar metade do dano,
 * calada. Registradas no JOGADOR: a carta já foi para o Cemitério.
 * Linhas sem indentação de base.
 */
const LINHAS_SEM_DANO = [
  'local e1=Effect.CreateEffect(e:GetHandler())',
  'e1:SetType(EFFECT_TYPE_FIELD)',
  'e1:SetCode(EFFECT_CHANGE_DAMAGE)',
  'e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)',
  'e1:SetTargetRange(1,0)',
  'e1:SetValue(0)',
  'e1:SetReset(RESET_PHASE|PHASE_END)',
  'Duel.RegisterEffect(e1,tp)',
  'local e2=e1:Clone()',
  'e2:SetCode(EFFECT_NO_EFFECT_DAMAGE)',
  'e2:SetReset(RESET_PHASE|PHASE_END)',
  'Duel.RegisterEffect(e2,tp)',
];

/**
 * A AÇÃO de um efeito: categoria, flags, filtro, alvo e operação.
 * Devolve `{ categorias, flags, funcoes, temAlvo, condicao }`.
 */
function acao(carta, ef, n) {
  const f = [];
  const out = { categorias: [], flags: [], funcoes: f, temAlvo: true, condicao: null };

  switch (ef.acao) {
    case 'adicionar': {
      if (ef.alvo === 'esta') {
        out.categorias.push('CATEGORY_TOHAND');
        f.push(cabecaAlvo(n),
          `${T(1)}local c=e:GetHandler()`,
          `${T(1)}if chk==0 then return c:IsAbleToHand() end`,
          `${T(1)}Duel.SetOperationInfo(0,CATEGORY_TOHAND,c,1,0,0)`,
          'end',
          cabecaOp(n),
          `${T(1)}local c=e:GetHandler()`,
          `${T(1)}if c:IsRelateToEffect(e) then`,
          `${T(2)}Duel.SendtoHand(c,nil,REASON_EFFECT)`,
          `${T(2)}Duel.ConfirmCards(1-tp,c)`,
          `${T(1)}end`,
          'end');
        break;
      }
      // Deck, Cemitério ou os dois — e quem sai da escolha (ver `LUGAR_DA_BUSCA`).
      const { loc: LOC, excl: EXCL } = lugarDaBusca(ef.origem);
      out.categorias.push('CATEGORY_TOHAND');
      if (LOC.includes('LOCATION_DECK')) out.categorias.push('CATEGORY_SEARCH');
      // "Adicione 1 X e 1 Y": só ativa se der para achar as duas, e adiciona as
      // duas ou nenhuma (ver `funcoesDeCada`).
      if (ef.umDeCada) {
        f.push(...funcoesDeCada(`s.cada${n}`, ef.filtros, LOC, 'c:IsAbleToHand()'),
          cabecaAlvo(n),
          `${T(1)}if chk==0 then return s.cada${n}_resta(tp,Group.CreateGroup(),${EXCL},1) end`,
          `${T(1)}Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,#s.cada${n},tp,${LOC})`,
          'end',
          cabecaOp(n),
          `${T(1)}local sg=s.cada${n}_escolhe(tp,${EXCL},HINTMSG_ATOHAND)`,
          `${T(1)}if #sg>0 then`,
          `${T(2)}Duel.SendtoHand(sg,nil,REASON_EFFECT)`,
          `${T(2)}Duel.ConfirmCards(1-tp,sg)`,
          `${T(1)}end`,
          'end');
        break;
      }
      // "De Tipos/Atributos diferentes" só existe entre monstros: com uma das
      // caixas marcada o filtro exige monstro (ver `escolherDiferentes`).
      f.push(`function s.filtro${n}(c)`,
        `${T(1)}return ${eJunto(expressao(ef.filtros, { exigeMonstro: querDiferentes(ef) }), 'c:IsAbleToHand()')}`,
        'end',
        cabecaAlvo(n),
        `${T(1)}if chk==0 then return Duel.IsExistingMatchingCard(s.filtro${n},tp,${LOC},0,1,${EXCL}) end`,
        `${T(1)}Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,${LOC})`,
        'end',
        cabecaOp(n),
        ...(querDiferentes(ef)
          ? [
            ...escolherDiferentes(ef, `s.filtro${n}`, LOC, '0', EXCL, 1, 'HINTMSG_ATOHAND'),
            `${T(1)}if #sg>0 then`,
            `${T(2)}Duel.SendtoHand(sg,nil,REASON_EFFECT)`,
            `${T(2)}Duel.ConfirmCards(1-tp,sg)`,
            `${T(1)}end`,
          ]
          : [
            `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)`,
            `${T(1)}local g=Duel.SelectMatchingCard(tp,s.filtro${n},tp,${LOC},0,1,${ef.quantidade},${EXCL})`,
            `${T(1)}if #g>0 then`,
            `${T(2)}Duel.SendtoHand(g,nil,REASON_EFFECT)`,
            `${T(2)}Duel.ConfirmCards(1-tp,g)`,
            `${T(1)}end`,
          ]),
        'end');
      break;
    }

    case 'comprar':
      out.categorias.push('CATEGORY_DRAW');
      out.flags.push('EFFECT_FLAG_PLAYER_TARGET');
      f.push(cabecaAlvo(n),
        `${T(1)}if chk==0 then return Duel.IsPlayerCanDraw(tp,${ef.quantidade}) end`,
        `${T(1)}Duel.SetTargetPlayer(tp)`,
        `${T(1)}Duel.SetTargetParam(${ef.quantidade})`,
        `${T(1)}Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,${ef.quantidade})`,
        'end',
        cabecaOp(n),
        `${T(1)}local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)`,
        `${T(1)}Duel.Draw(p,d,REASON_EFFECT)`,
        'end');
      break;

    case 'reviver': {
      out.categorias.push('CATEGORY_SPECIAL_SUMMON');
      if (ef.alvo === 'esta') {
        f.push(cabecaAlvo(n),
          `${T(1)}local c=e:GetHandler()`,
          `${T(1)}if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0`,
          `${T(2)}and c:IsCanBeSpecialSummoned(e,0,tp,false,false) end`,
          `${T(1)}Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)`,
          'end',
          cabecaOp(n),
          `${T(1)}local c=e:GetHandler()`,
          `${T(1)}if c:IsRelateToEffect(e) then`,
          `${T(2)}Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)`,
          `${T(1)}end`,
          'end');
        break;
      }
      // De onde sai a carta: Cemitério e banidas são ALVO (como o Monster
      // Reborn); mão e Deck se escolhem na resolução (ver `LUGAR_DA_INVOCACAO`).
      const lugar = lugarDaInvocacao(ef.origem);
      const { loc: LOC, opp: OPP } = lugar;
      const soDoMeuLado = OPP === '0';
      const condicao = lugar.faceUp ? 'c:IsFaceup() and c:IsCanBeSpecialSummoned(e,0,tp,false,false)'
        : 'c:IsCanBeSpecialSummoned(e,0,tp,false,false)';
      f.push(`function s.filtro${n}(c,e,tp)`,
        `${T(1)}return ${eJunto(expressao(ef.filtros, { exigeMonstro: true }), condicao)}`,
        'end');
      if (lugar.alvo) {
        out.flags.push('EFFECT_FLAG_CARD_TARGET');
        f.push(cabecaAlvo(n, true),
          `${T(1)}if chkc then return chkc:IsLocation(${LOC})${soDoMeuLado ? ' and chkc:IsControler(tp)' : ''} and chkc~=e:GetHandler() and s.filtro${n}(chkc,e,tp) end`,
          `${T(1)}if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0`,
          `${T(2)}and Duel.IsExistingTarget(s.filtro${n},tp,${LOC},${OPP},1,e:GetHandler(),e,tp) end`,
          `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)`,
          `${T(1)}local g=Duel.SelectTarget(tp,s.filtro${n},tp,${LOC},${OPP},1,1,e:GetHandler(),e,tp)`,
          `${T(1)}Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)`,
          'end',
          cabecaOp(n),
          `${T(1)}local tc=Duel.GetFirstTarget()`,
          `${T(1)}if tc and tc:IsRelateToEffect(e) then`,
          `${T(2)}Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)`,
          `${T(1)}end`,
          'end');
        break;
      }
      f.push(cabecaAlvo(n),
        `${T(1)}if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0`,
        `${T(2)}and Duel.IsExistingMatchingCard(s.filtro${n},tp,${LOC},${OPP},1,e:GetHandler(),e,tp) end`,
        `${T(1)}Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,${LOC})`,
        'end',
        cabecaOp(n),
        `${T(1)}if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end`,
        `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)`,
        `${T(1)}local g=Duel.SelectMatchingCard(tp,s.filtro${n},tp,${LOC},${OPP},1,1,e:GetHandler(),e,tp)`,
        `${T(1)}if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP) end`,
        'end');
      break;
    }

    case 'destruir': {
      out.categorias.push('CATEGORY_DESTROY');
      if (ef.alvo === 'esta') {
        f.push(cabecaAlvo(n),
          `${T(1)}if chk==0 then return true end`,
          `${T(1)}Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)`,
          'end',
          cabecaOp(n),
          `${T(1)}local c=e:GetHandler()`,
          `${T(1)}if c:IsRelateToEffect(e) then`,
          `${T(2)}Duel.Destroy(c,REASON_EFFECT)`,
          `${T(1)}end`,
          'end');
        break;
      }
      if (ef.alvo === 'gatilho') {
        // O Trap Hole oficial: a relação com o efeito é criada no alvo, e é ela
        // que diz na resolução se ainda é o MESMO monstro.
        f.push(`function s.filtro${n}(c)`,
          `${T(1)}return ${expressao(ef.filtros, { exigeMonstro: true, faceUp: true })}`,
          'end',
          cabecaAlvo(n),
          `${T(1)}local tc=${tcDoGatilho(ef.quando)}`,
          `${T(1)}if chk==0 then return tc and tc:IsControler(1-tp) and s.filtro${n}(tc) end`,
          `${T(1)}tc:CreateEffectRelation(e)`,
          `${T(1)}Duel.SetOperationInfo(0,CATEGORY_DESTROY,tc,1,0,0)`,
          'end',
          cabecaOp(n),
          `${T(1)}local tc=${tcDoGatilho(ef.quando)}`,
          `${T(1)}if tc and tc:IsRelateToEffect(e) then`,
          `${T(2)}Duel.Destroy(tc,REASON_EFFECT)`,
          `${T(1)}end`,
          'end');
        break;
      }
      const LOC = ef.zona === 'monstro' ? 'LOCATION_MZONE' : ef.zona === 'magia-armadilha' ? 'LOCATION_SZONE' : 'LOCATION_ONFIELD';
      const qualquerLado = ef.lado === 'qualquer';
      const MEU = qualquerLado || ef.lado === 'meus' ? LOC : '0';
      const OPP = ef.lado === 'meus' ? '0' : LOC;
      const dono = qualquerLado ? '' : ef.lado === 'meus' ? ' and chkc:IsControler(tp)' : ' and chkc:IsControler(1-tp)';
      out.flags.push('EFFECT_FLAG_CARD_TARGET');
      // Face para baixo não tem ATK para ler: com filtro de stats, só face para cima.
      f.push(`function s.filtro${n}(c)`,
        `${T(1)}return ${expressao(ef.filtros, { exigeMonstro: ef.zona === 'monstro', faceUp: true })}`,
        'end',
        cabecaAlvo(n, true),
        `${T(1)}if chkc then return chkc:IsLocation(${LOC})${dono} and s.filtro${n}(chkc) end`,
        `${T(1)}if chk==0 then return Duel.IsExistingTarget(s.filtro${n},tp,${MEU},${OPP},1,e:GetHandler()) end`,
        `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)`,
        `${T(1)}local g=Duel.SelectTarget(tp,s.filtro${n},tp,${MEU},${OPP},1,${ef.quantidade},e:GetHandler())`,
        `${T(1)}Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)`,
        'end',
        cabecaOp(n),
        `${T(1)}local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)`,
        `${T(1)}if not g then return end`,
        `${T(1)}local tg=g:Filter(Card.IsRelateToEffect,nil,e)`,
        `${T(1)}if #tg>0 then`,
        `${T(2)}Duel.Destroy(tg,REASON_EFFECT)`,
        `${T(1)}end`,
        'end');
      break;
    }

    case 'bonus': {
      if (ef.atk) out.categorias.push('CATEGORY_ATKCHANGE');
      if (ef.def) out.categorias.push('CATEGORY_DEFCHANGE');
      if (ef.alvo === 'esta') {
        out.temAlvo = false;
        f.push(cabecaOp(n),
          `${T(1)}local c=e:GetHandler()`,
          `${T(1)}if c:IsFaceup() and c:IsRelateToEffect(e) then`,
          ...linhasDoBonus(ef, 'c'),
          `${T(1)}end`,
          'end');
        break;
      }
      if (ef.alvo === 'gatilho') {
        f.push(`function s.filtro${n}(c)`,
          `${T(1)}return ${expressao(ef.filtros, { exigeMonstro: true, faceUp: true })}`,
          'end',
          cabecaAlvo(n),
          `${T(1)}local tc=${tcDoGatilho(ef.quando)}`,
          `${T(1)}if chk==0 then return tc and tc:IsControler(1-tp) and tc:IsFaceup() and s.filtro${n}(tc) end`,
          `${T(1)}tc:CreateEffectRelation(e)`,
          'end',
          cabecaOp(n),
          `${T(1)}local tc=${tcDoGatilho(ef.quando)}`,
          `${T(1)}if tc and tc:IsFaceup() and tc:IsRelateToEffect(e) then`,
          ...linhasDoBonus(ef, 'tc'),
          `${T(1)}end`,
          'end');
        break;
      }
      const MEU = ef.lado === 'oponente' ? '0' : 'LOCATION_MZONE';
      const OPP = ef.lado === 'meus' ? '0' : 'LOCATION_MZONE';
      const ctrl = ef.lado === 'meus' ? ' and chkc:IsControler(tp)' : ef.lado === 'oponente' ? ' and chkc:IsControler(1-tp)' : '';
      out.flags.push('EFFECT_FLAG_CARD_TARGET');
      f.push(`function s.filtro${n}(c)`,
        `${T(1)}return ${eJunto(expressao(ef.filtros, { exigeMonstro: true }), 'c:IsFaceup()')}`,
        'end',
        cabecaAlvo(n, true),
        `${T(1)}if chkc then return chkc:IsLocation(LOCATION_MZONE)${ctrl} and chkc~=e:GetHandler() and s.filtro${n}(chkc) end`,
        `${T(1)}if chk==0 then return Duel.IsExistingTarget(s.filtro${n},tp,${MEU},${OPP},1,e:GetHandler()) end`,
        `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)`,
        `${T(1)}Duel.SelectTarget(tp,s.filtro${n},tp,${MEU},${OPP},1,1,e:GetHandler())`,
        'end',
        cabecaOp(n),
        `${T(1)}local tc=Duel.GetFirstTarget()`,
        `${T(1)}if tc and tc:IsFaceup() and tc:IsRelateToEffect(e) then`,
        ...linhasDoBonus(ef, 'tc'),
        `${T(1)}end`,
        'end');
      break;
    }

    case 'ganhar-nome': {
      // Sem alvo: quem ganha o nome é a própria carta. `IsRelateToEffect` é o
      // que garante que ela ainda é ELA — se saiu da mão em resposta, não há o
      // que renomear.
      out.temAlvo = false;
      f.push(cabecaOp(n),
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}if not c:IsRelateToEffect(e) then return end`,
        ...linhasDoNome(ef).map((l) => `${T(1)}${l}`),
        'end');
      break;
    }

    case 'menos-tributo': {
      // O Amarylease oficial (`c18988391`): o efeito NÃO fica na carta — é
      // registrado no JOGADOR (`Duel.RegisterEffect`) e morre no fim do turno.
      // É o que permite descontar tributo com uma carta que já foi descartada
      // como custo: ela não está mais em lugar nenhum para segurar o efeito.
      //
      // O valor é um BITMASK, e não uma contagem: o bit 0 é "1 tributo a menos",
      // o bit 1 é "2 a menos". Escrever o NÚMERO faria "3 a menos" virar 0x3,
      // que o motor lê como "1 ou 2 a menos" — e nada acusaria.
      out.temAlvo = false;
      const mascara = 1 << (ef.quantidade - 1);
      f.push(`function s.filtro${n}(e,c)`,
        `${T(1)}return ${expressao(ef.filtros, { exigeMonstro: true })}`,
        'end',
        cabecaOp(n),
        `${T(1)}local e1=Effect.CreateEffect(e:GetHandler())`,
        `${T(1)}e1:SetType(EFFECT_TYPE_FIELD)`,
        `${T(1)}e1:SetCode(EFFECT_DECREASE_TRIBUTE)`,
        `${T(1)}e1:SetTargetRange(LOCATION_HAND,0)`,
        `${T(1)}e1:SetTarget(s.filtro${n})`,
        `${T(1)}e1:SetValue(0x${mascara.toString(16)})`,
        `${T(1)}e1:SetReset(RESET_PHASE|PHASE_END)`,
        `${T(1)}Duel.RegisterEffect(e1,tp)`,
        'end');
      break;
    }

    case 'sem-dano':
      // Sem alvo e sem trava: ativar duas vezes no mesmo turno não faz mal a
      // ninguém, e a pergunta "já estou protegido?" não é do texto da carta.
      out.temAlvo = false;
      f.push(cabecaOp(n), ...LINHAS_SEM_DANO.map((l) => `${T(1)}${l}`), 'end');
      break;

    case 'baixar': {
      // Baixar (Set) Magia/Armadilha — o Magical Cylinders oficial: `IsSSetable`
      // no filtro e `Duel.SSet` na operação. A escolha é na RESOLUÇÃO, como a
      // dele, e "até N" deixa quem joga parar antes (ver `escolherParaBaixar`).
      const { loc: LOC, excl: EXCL } = lugarDaBusca(ef.origem);
      f.push(`function s.filtro${n}(c)`,
        `${T(1)}return ${eJunto(expressao(ef.filtros), 'c:IsSSetable()')}`,
        'end',
        ...(ef.nomesDiferentes ? funcaoNomeLivre(`s.nomelivre${n}`) : []),
        cabecaAlvo(n),
        `${T(1)}if chk==0 then return Duel.IsExistingMatchingCard(s.filtro${n},tp,${LOC},0,1,${EXCL}) end`,
        'end',
        cabecaOp(n),
        ...escolherParaBaixar(ef, `s.filtro${n}`, `s.nomelivre${n}`, LOC, EXCL, 'return').map((l) => `${T(1)}${l}`),
        ...linhasDoSSet(ef, 'solto').map((l) => `${T(1)}${l}`),
        'end');
      break;
    }

    case 'negar': {
      // O Magic Jammer oficial, com "a que responde" escolhido na tela.
      out.categorias.push('CATEGORY_NEGATE');
      if (ef.destruirNegada) out.categorias.push('CATEGORY_DESTROY');
      const tipos = [];
      if (ef.respondeA.includes('magia')) tipos.push('(re:IsActiveType(TYPE_SPELL) and re:IsHasType(EFFECT_TYPE_ACTIVATE))');
      if (ef.respondeA.includes('armadilha')) tipos.push('(re:IsActiveType(TYPE_TRAP) and re:IsHasType(EFFECT_TYPE_ACTIVATE))');
      if (ef.respondeA.includes('monstro')) tipos.push('re:IsActiveType(TYPE_MONSTER)');
      out.condicao = [
        `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`,
        `${T(1)}if rp==tp or not Duel.IsChainNegatable(ev) then return false end`,
        `${T(1)}return ${tipos.length ? tipos.join(`\n${T(2)}or `) : 'false'}`,
        'end',
      ];
      f.push(cabecaAlvo(n),
        `${T(1)}if chk==0 then return true end`,
        `${T(1)}Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)`,
        ...(ef.destruirNegada ? [
          `${T(1)}if re:GetHandler():IsDestructable() and re:GetHandler():IsRelateToEffect(re) then`,
          `${T(2)}Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,1,0,0)`,
          `${T(1)}end`,
        ] : []),
        'end',
        cabecaOp(n),
        ...(ef.destruirNegada ? [
          `${T(1)}if Duel.NegateActivation(ev) and re:GetHandler():IsRelateToEffect(re) then`,
          `${T(2)}Duel.Destroy(eg,REASON_EFFECT)`,
          `${T(1)}end`,
        ] : [`${T(1)}Duel.NegateActivation(ev)`]),
        'end');
      break;
    }
    default:
      break;
  }
  return out;
}

// ------------------------------------------------ "e depois, se isso resolver"
//
// Com sequência, cada passo vira uma função `s.passoN_K` que FAZ a ação na
// resolução e devolve se fez: a operação só chama o passo seguinte quando o
// anterior devolveu `true`, com `Duel.BreakEffect()` no meio — é o "então" do
// texto oficial ("Invoque esta carta, então destrua 1 carta"), em que as duas
// coisas não acontecem ao mesmo tempo.
//
// A escolha de carta de um passo é feita NA RESOLUÇÃO, sem alvo: é o que o
// "então" diz, e um alvo escolhido na ativação poderia nem existir mais depois
// do primeiro passo.
//
// "Esta carta" num passo usa LUGAR (`IsLocation`/`IsOnField`) e não
// `IsRelateToEffect`: o primeiro passo pode tê-la Invocado, e mudar de lugar
// desfaz a relação com o efeito — o bônus e os ataques seguintes nunca
// aconteceriam, calados.

// As ações que só existem na forma de passo (escolha NA RESOLUÇÃO, sem alvo) vão
// por aqui mesmo sozinhas: destruir TODAS, enviar ao Cemitério e o "Invoque 1 X
// e 1 Y".
const emSequencia = (ef) => ef.acao === 'ataques' || (ef.depois?.length ?? 0) > 0
  || (ef.acao === 'destruir' && ef.todas) || ef.acao === 'enviar-cemiterio'
  || (ef.acao === 'reviver' && ef.alvo === 'outra' && ef.umDeCada);

/** Marcou "de Tipos diferentes" e/ou "de Atributos diferentes"? */
const querDiferentes = (p) => !!(p.tiposDiferentes || p.atributosDiferentes);

/**
 * Escolher até N cartas "de Tipos/Atributos diferentes": uma por vez, tirando da
 * lista as do mesmo Tipo e/ou Atributo da escolhida — a mesma seleção à mão do
 * custo (`custoComFiltro`), sem `Group.Iter`. Marcar os dois tira pelos dois, e
 * então sobra uma carta de cada Tipo E de cada Atributo. Deixa o escolhido em
 * `sg`; `ind` é a indentação de base.
 */
function escolherDiferentes(p, filtro, LOC, OPP, EXCL, ind, hint) {
  const l = [
    `${T(ind)}local g=Duel.GetMatchingGroup(${filtro},tp,${LOC},${OPP},${EXCL})`,
    `${T(ind)}local sg=Group.CreateGroup()`,
    `${T(ind)}for i=1,${p.quantidade} do`,
    `${T(ind + 1)}if #g==0 then break end`,
    `${T(ind + 1)}Duel.Hint(HINT_SELECTMSG,tp,${hint})`,
    `${T(ind + 1)}local tc=g:Select(tp,1,1,nil):GetFirst()`,
    `${T(ind + 1)}sg:AddCard(tc)`,
  ];
  if (p.tiposDiferentes) l.push(`${T(ind + 1)}g:Remove(Card.IsRace,nil,tc:GetRace())`);
  if (p.atributosDiferentes) l.push(`${T(ind + 1)}g:Remove(Card.IsAttribute,nil,tc:GetAttribute())`);
  l.push(`${T(ind)}end`);
  return l;
}

/**
 * Escolher até N Magias/Armadilhas para BAIXAR, deixando o escolhido em `sg`
 * (linhas sem indentação de base; `sair` é o `return` de quem chama). Nunca mais
 * do que as zonas livres: `SSet` de duas cartas com uma zona só baixaria uma.
 *
 * Com "de nomes diferentes" a escolha é incremental (`SelectUnselect`, o seletor
 * do Full Armored Utopic Ray Lancer oficial): a cada carta escolhida saem da
 * lista as do MESMO nome, e dá para encerrar depois da primeira — é o "até 2,
 * só 1 de cada". Não é `aux.dncheck`: ele depende de `aux.SelectUnselectGroup`,
 * que usa o `Group.Iter` ausente na `ocgcore.dll` daqui.
 */
function escolherParaBaixar(p, filtro, livre, LOC, EXCL, sair) {
  // Os PARÊNTESES em volta do `GetLocationCount` não são enfeite: nesta dll ele
  // devolve DOIS valores, e como último argumento do `math.min` os dois entram na
  // conta. O segundo vale 0 com a zona de Magia/Armadilha vazia — o `ft` saía 0 e
  // o baixar não acontecia, calado, exatamente quando havia mais espaço. Medido
  // no `--test-card-builder` (seção Evil Dragon Knight, 26/09/2026).
  const l = [
    `local ft=math.min(${p.quantidade},(Duel.GetLocationCount(tp,LOCATION_SZONE)))`,
    `if ft<=0 then ${sair} end`,
  ];
  if (!p.nomesDiferentes) {
    return [...l,
      'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)',
      `local sg=Duel.SelectMatchingCard(tp,${filtro},tp,${LOC},0,1,ft,${EXCL})`];
  }
  return [...l,
    `local g=Duel.GetMatchingGroup(${filtro},tp,${LOC},0,${EXCL})`,
    'local sg=Group.CreateGroup()',
    'while #sg<ft do',
    `${T(1)}local livres=g:Filter(${livre},sg,sg)`,
    `${T(1)}if #livres==0 then break end`,
    `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)`,
    `${T(1)}local tc=livres:SelectUnselect(sg,tp,#sg>0,false,1,ft)`,
    `${T(1)}if not tc then break end`,
    `${T(1)}if sg:IsContains(tc) then sg:RemoveCard(tc) else sg:AddCard(tc) end`,
    'end',
  ];
}

/**
 * O `Duel.SSet` do baixar, com o "(pode ser ativada neste turno)" quando pedido.
 *
 * O rider é o do **Trap Trick oficial** (`c15943341`): um `EFFECT_TYPE_SINGLE`
 * com `EFFECT_TRAP_ACT_IN_SET_TURN` registrado NA CARTA BAIXADA. Os dois
 * detalhes que erram calados vêm dele: `EFFECT_FLAG_SET_AVAILABLE` — sem ele o
 * efeito não vale para uma carta virada para BAIXO, que é exatamente onde ele
 * precisa valer — e `RESET_EVENT|RESETS_STANDARD`, que o mata quando a carta
 * sai de onde está.
 *
 * O clone com `EFFECT_QP_ACT_IN_SET_TURN` é o par da regra para MAGIA RÁPIDA: a
 * trava "baixou neste turno, não ativa" tem uma constante para Armadilha e
 * outra para Magia Rápida, e o builder não sabe qual das duas é a carta que vai
 * ser baixada — ela sai de um FILTRO, e só se conhece na resolução. Registrar as
 * duas é inofensivo: cada uma só tem efeito no tipo a que pertence. Registrar
 * uma só deixaria metade dos casos sem o "pode ser ativada", sem erro nenhum.
 *
 * Devolve linhas com indentação RELATIVA (`T(0)` é vazio): quem chama soma a
 * base dele.
 *
 * @param {'solto'|'passo'} fim  a operação de um efeito, ou um passo do "e
 *   depois" — que precisa DEVOLVER se funcionou, senão o passo seguinte roda.
 */
function linhasDoSSet(ef, fim) {
  // `base` é o nível do `for`: no passo ele fica solto no corpo da função, e na
  // operação de um efeito ele mora dentro de um `if … then`, um nível adentro.
  const rider = (base) => [
    `${T(base)}for tc in aux.Next(sg) do`,
    `${T(base + 1)}local ea=Effect.CreateEffect(e:GetHandler())`,
    `${T(base + 1)}ea:SetType(EFFECT_TYPE_SINGLE)`,
    `${T(base + 1)}ea:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)`,
    `${T(base + 1)}ea:SetProperty(EFFECT_FLAG_SET_AVAILABLE)`,
    `${T(base + 1)}ea:SetReset(RESET_EVENT|RESETS_STANDARD)`,
    `${T(base + 1)}tc:RegisterEffect(ea)`,
    `${T(base + 1)}local eb=ea:Clone()`,
    `${T(base + 1)}eb:SetCode(EFFECT_QP_ACT_IN_SET_TURN)`,
    `${T(base + 1)}tc:RegisterEffect(eb)`,
    `${T(base)}end`,
  ];
  if (fim === 'passo') {
    if (!ef.ativaNoTurno) return ['return #sg>0 and Duel.SSet(tp,sg)>0'];
    return ['if #sg==0 or Duel.SSet(tp,sg)==0 then return false end', ...rider(0), 'return true'];
  }
  if (!ef.ativaNoTurno) return ['if #sg>0 then Duel.SSet(tp,sg) end'];
  return ['if #sg>0 and Duel.SSet(tp,sg)>0 then', ...rider(1), 'end'];
}

/**
 * **"Esta carta é tratada como X NESTE TURNO"** — o nome GANHO por um efeito, e
 * não o de nascença (`carta.tratadoComo`, que é permanente).
 *
 * A forma é a do oficial `c24521325`: `EFFECT_ADD_CODE` registrado NA
 * OPERAÇÃO, com `RESETS_STANDARD_PHASE_END` — o nome morre no fim do turno E
 * quando a carta muda de lugar. É isso que faz "revele este card: neste turno
 * ele é tratado como Dark Magician" valer enquanto ele está na MÃO, que é onde
 * o nome importa: pagar o custo de OUTRA carta que pede um "Dark Magician".
 *
 * A diferença para o permanente não é detalhe de balanço, é a carta inteira: com
 * o nome de nascença, toda cópia no DECK já é um "Dark Magician" e paga o custo
 * sozinha; com o nome ganho, só a cópia revelada — uma por turno — paga.
 *
 * Linhas com indentação RELATIVA; `c` (o handler) precisa existir antes.
 */
function linhasDoNome(p) {
  if (!p.ganhaCodigo) return ['--(falta o id da carta cujo nome esta ganha)'];
  return [
    'local en=Effect.CreateEffect(c)',
    'en:SetType(EFFECT_TYPE_SINGLE)',
    'en:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)',
    'en:SetCode(EFFECT_ADD_CODE)',
    `en:SetValue(${p.ganhaCodigo})`,
    'en:SetReset(RESETS_STANDARD_PHASE_END)',
    'c:RegisterEffect(en)',
  ];
}

/** "Nenhuma carta com este nome já foi escolhida" — o filtro do "de nomes diferentes". */
function funcaoNomeLivre(nome) {
  return [
    `function ${nome}(c,sg)`,
    `${T(1)}return not sg:IsExists(Card.IsCode,1,nil,c:GetCode())`,
    'end',
  ];
}

/**
 * `anterior`/`proximo` são os passos vizinhos (ou `null`). O próximo decide se
 * ESTE guarda o que moveu (`s.moveuN`): só quando ele pergunta por isso
 * (`seFiltros`) — gravar sempre mudaria o Lua de toda carta já salva.
 */
function passoDaSequencia(carta, p, n, k, quando, anterior = null, proximo = null) {
  const nome = `s.passo${n}_${k}`;
  const filtro = `s.filtro${n}_${k}`;
  const fn = [];
  const cat = [];
  let pode = 'true';
  let info = null;
  let corpo = [];
  const reset = p.duracao === 'turno' ? 'RESETS_STANDARD_PHASE_END' : 'RESET_EVENT|RESETS_STANDARD';
  const registra = !!proximo?.seFiltros?.length && moveOutra(p);
  const grava = (g) => (registra ? [`s.moveu${n}=${g}`] : []);

  switch (p.acao) {
    case 'ganhar-nome': {
      // O 1º passo de "revele: vire X, então busque". Não trava a ativação
      // (`pode` fica `true`) e "resolve" sempre que a carta ainda é ela mesma —
      // é isso que deixa o passo seguinte acontecer.
      corpo = [
        'local c=e:GetHandler()',
        'if not c:IsRelateToEffect(e) then return false end',
        ...linhasDoNome(p),
        'return true',
      ];
      break;
    }
    case 'reviver': {
      cat.push('CATEGORY_SPECIAL_SUMMON');
      if (p.alvo === 'esta') {
        pode = 'Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and e:GetHandler():IsCanBeSpecialSummoned(e,0,tp,false,false)';
        info = 'Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)';
        corpo = [
          'local c=e:GetHandler()',
          'if not c:IsRelateToEffect(e) or Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return false end',
          'return Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0',
        ];
        break;
      }
      // "Invoque 1 X E 1 Y": uma de cada opção, todas juntas — a busca com volta
      // atrás do `funcoesDeCada`, e zonas livres para todas. Nunca é alvo: mão e
      // Deck estão escondidos. Invoca as duas ou nenhuma.
      if (p.umDeCada) {
        const cada = `s.cada${n}_${k}`;
        const { loc: LOC } = lugarDaInvocacao(p.origem);
        fn.push(...funcoesDeCada(cada, p.filtros, LOC, 'c:IsCanBeSpecialSummoned(e,0,tp,false,false)', true));
        pode = `Duel.GetLocationCount(tp,LOCATION_MZONE)>=#${cada} and ${cada}_resta(tp,Group.CreateGroup(),e:GetHandler(),1,e)`;
        info = `Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,#${cada},tp,${LOC})`;
        corpo = [
          `if Duel.GetLocationCount(tp,LOCATION_MZONE)<#${cada} then return false end`,
          `local sg=${cada}_escolhe(tp,e:GetHandler(),HINTMSG_SPSUMMON,e)`,
          ...(registra ? ['if #sg==0 then return false end', ...grava('sg')] : []),
          'return #sg>0 and Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)>0',
        ];
        break;
      }
      // Num passo a escolha é sempre NA RESOLUÇÃO, de qualquer origem: é o
      // "então" do texto, e um alvo marcado na ativação podia nem existir mais.
      const lugar = lugarDaInvocacao(p.origem);
      const condicao = lugar.faceUp ? 'c:IsFaceup() and c:IsCanBeSpecialSummoned(e,0,tp,false,false)'
        : 'c:IsCanBeSpecialSummoned(e,0,tp,false,false)';
      fn.push(`function ${filtro}(c,e,tp)`,
        `${T(1)}return ${eJunto(expressao(p.filtros, { exigeMonstro: true }), condicao)}`,
        'end');
      pode = `Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(${filtro},tp,${lugar.loc},${lugar.opp},1,e:GetHandler(),e,tp)`;
      info = `Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,${lugar.loc})`;
      corpo = [
        'if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return false end',
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)',
        `local g=Duel.SelectMatchingCard(tp,${filtro},tp,${lugar.loc},${lugar.opp},1,1,e:GetHandler(),e,tp)`,
        ...(registra
          ? ['if #g==0 then return false end', ...grava('g'), 'return Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0']
          : ['return #g>0 and Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0']),
      ];
      break;
    }

    case 'adicionar': {
      cat.push('CATEGORY_TOHAND');
      if (p.alvo === 'esta') {
        pode = 'e:GetHandler():IsAbleToHand()';
        info = 'Duel.SetOperationInfo(0,CATEGORY_TOHAND,e:GetHandler(),1,0,0)';
        corpo = [
          'local c=e:GetHandler()',
          'if not c:IsRelateToEffect(e) or Duel.SendtoHand(c,nil,REASON_EFFECT)==0 then return false end',
          'Duel.ConfirmCards(1-tp,c)',
          'return true',
        ];
        break;
      }
      const { loc: LOC, excl: EXCL } = lugarDaBusca(p.origem);
      if (LOC.includes('LOCATION_DECK')) cat.push('CATEGORY_SEARCH');
      if (p.umDeCada) {
        const cada = `s.cada${n}_${k}`;
        fn.push(...funcoesDeCada(cada, p.filtros, LOC, 'c:IsAbleToHand()'));
        pode = `${cada}_resta(tp,Group.CreateGroup(),${EXCL},1)`;
        info = `Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,#${cada},tp,${LOC})`;
        corpo = [
          `local sg=${cada}_escolhe(tp,${EXCL},HINTMSG_ATOHAND)`,
          'if #sg==0 or Duel.SendtoHand(sg,nil,REASON_EFFECT)==0 then return false end',
          ...grava('sg'),
          'Duel.ConfirmCards(1-tp,sg)',
          'return true',
        ];
        break;
      }
      // "Diferentes" é Tipo/Atributo de MONSTRO: sem exigir monstro, as magias
      // (que não têm nenhum dos dois) entrariam na escolha e nunca sairiam dela.
      fn.push(`function ${filtro}(c)`,
        `${T(1)}return ${eJunto(expressao(p.filtros, { exigeMonstro: querDiferentes(p) }), 'c:IsAbleToHand()')}`, 'end');
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,${LOC},0,1,${EXCL})`;
      info = `Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,${LOC})`;
      corpo = querDiferentes(p)
        ? [
          ...escolherDiferentes(p, filtro, LOC, '0', EXCL, 0, 'HINTMSG_ATOHAND'),
          'if #sg==0 or Duel.SendtoHand(sg,nil,REASON_EFFECT)==0 then return false end',
          ...grava('sg'),
          'Duel.ConfirmCards(1-tp,sg)',
          'return true',
        ]
        : [
          'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)',
          `local g=Duel.SelectMatchingCard(tp,${filtro},tp,${LOC},0,1,${p.quantidade},${EXCL})`,
          'if #g==0 or Duel.SendtoHand(g,nil,REASON_EFFECT)==0 then return false end',
          ...grava('g'),
          'Duel.ConfirmCards(1-tp,g)',
          'return true',
        ];
      break;
    }

    // "Invoque por Invocação-Fusão 1 X, usando esta carta como material" — a
    // forma manual da Polymerization (`proc_fusion_spell.lua`, que a dll daqui
    // roda): `GetFusionMaterial` (mão + campo), `CheckFusionMaterial` com ESTA
    // carta como `gc` (o material obrigatório), `SelectFusionMaterial`,
    // `SetMaterial`, os materiais ao Cemitério com REASON_FUSION, e o
    // `CompleteProcedure` — sem ele o monstro conta como mal-Invocado e o
    // `EnableReviveLimit` o prende no Cemitério depois. `chkf=tp` é o que confere
    // que sobra zona para ele sair do Extra Deck.
    case 'fundir': {
      cat.push('CATEGORY_SPECIAL_SUMMON', 'CATEGORY_FUSION_SUMMON');
      const fus = `s.fusao${n}_${k}`;
      const podeFundir = `s.podefundir${n}_${k}`;
      fn.push(`function ${fus}(c,e,tp,mg,gc)`,
        `${T(1)}return c:IsType(TYPE_FUSION) and c:IsCode(${p.fusaoCodigo ?? 0})`,
        `${T(2)}and c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false) and c:CheckFusionMaterial(mg,gc,tp)`,
        'end',
        `function ${podeFundir}(e,tp)`,
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}local mg=Duel.GetFusionMaterial(tp)`,
        `${T(1)}return mg:IsContains(c) and Duel.IsExistingMatchingCard(${fus},tp,LOCATION_EXTRA,0,1,nil,e,tp,mg,c)`,
        'end');
      pode = `${podeFundir}(e,tp)`;
      info = 'Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)';
      corpo = [
        'local c=e:GetHandler()',
        `if not ${podeFundir}(e,tp) then return false end`,
        'local mg=Duel.GetFusionMaterial(tp)',
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)',
        `local fc=Duel.SelectMatchingCard(tp,${fus},tp,LOCATION_EXTRA,0,1,1,nil,e,tp,mg,c):GetFirst()`,
        'if not fc then return false end',
        'local mat=Duel.SelectFusionMaterial(tp,fc,mg,c,tp)',
        'if #mat==0 then return false end',
        'fc:SetMaterial(mat)',
        'Duel.SendtoGrave(mat,REASON_EFFECT+REASON_MATERIAL+REASON_FUSION)',
        'Duel.BreakEffect()',
        'if Duel.SpecialSummon(fc,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP)==0 then return false end',
        'fc:CompleteProcedure()',
        'return true',
      ];
      break;
    }

    case 'baixar': {
      const { loc: LOC, excl: EXCL } = lugarDaBusca(p.origem);
      const livre = `s.nomelivre${n}_${k}`;
      fn.push(`function ${filtro}(c)`, `${T(1)}return ${eJunto(expressao(p.filtros), 'c:IsSSetable()')}`, 'end',
        ...(p.nomesDiferentes ? funcaoNomeLivre(livre) : []));
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,${LOC},0,1,${EXCL})`;
      corpo = [
        ...escolherParaBaixar(p, filtro, livre, LOC, EXCL, 'return false'),
        ...linhasDoSSet(p, 'passo'),
      ];
      break;
    }

    // Sempre "resolve": a proteção vale mesmo que nenhum dano chegue a vir.
    case 'sem-dano':
      corpo = [...LINHAS_SEM_DANO, 'return true'];
      break;

    case 'comprar':
      cat.push('CATEGORY_DRAW');
      pode =`Duel.IsPlayerCanDraw(tp,${p.quantidade})`;
      info = `Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,${p.quantidade})`;
      corpo = [`return Duel.Draw(tp,${p.quantidade},REASON_EFFECT)>0`];
      break;

    case 'destruir': {
      cat.push('CATEGORY_DESTROY');
      if (p.alvo === 'esta') {
        corpo = [
          'local c=e:GetHandler()',
          'if not c:IsOnField() then return false end',
          'return Duel.Destroy(c,REASON_EFFECT)>0',
        ];
        break;
      }
      if (p.alvo === 'gatilho') {
        const tc = tcDoGatilho(quando);
        fn.push(`function ${filtro}(c)`, `${T(1)}return ${expressao(p.filtros, { exigeMonstro: true, faceUp: true })}`, 'end');
        pode = `${tc} and ${tc}:IsControler(1-tp) and ${filtro}(${tc})`;
        corpo = [
          `local tc=${tc}`,
          'if not tc or not tc:IsOnField() then return false end',
          'return Duel.Destroy(tc,REASON_EFFECT)>0',
        ];
        break;
      }
      const LOC = p.zona === 'monstro' ? 'LOCATION_MZONE' : p.zona === 'magia-armadilha' ? 'LOCATION_SZONE' : 'LOCATION_ONFIELD';
      const MEU = p.lado === 'qualquer' || p.lado === 'meus' ? LOC : '0';
      const OPP = p.lado === 'meus' ? '0' : LOC;
      // "Destrua TODAS": sem escolha, e SEMPRE resolve — não ter nada a destruir
      // não impede o "então" seguinte (o chefe que limpa o próprio campo e depois
      // manda cartas ao Cemitério precisa do segundo passo com o campo já vazio).
      // O filtro fica sem `IsFaceup`: "todas as cartas" inclui as viradas.
      if (p.todas) {
        fn.push(`function ${filtro}(c)`, `${T(1)}return ${expressao(p.filtros, { exigeMonstro: p.zona === 'monstro' })}`, 'end');
        info = `Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,0,0,${LOC})`;
        corpo = [
          `local g=Duel.GetMatchingGroup(${filtro},tp,${MEU},${OPP},e:GetHandler())`,
          'if #g>0 then Duel.Destroy(g,REASON_EFFECT) end',
          'return true',
        ];
        break;
      }
      fn.push(`function ${filtro}(c)`,
        `${T(1)}return ${expressao(p.filtros, { exigeMonstro: p.zona === 'monstro', faceUp: true })}`, 'end');
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,${MEU},${OPP},1,e:GetHandler())`;
      info = `Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,1,0,${LOC})`;
      corpo = [
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)',
        `local g=Duel.SelectMatchingCard(tp,${filtro},tp,${MEU},${OPP},1,${p.quantidade},e:GetHandler())`,
        'if #g==0 then return false end',
        'return Duel.Destroy(g,REASON_EFFECT)>0',
      ];
      break;
    }

    // "Envie até N cartas no campo ao Cemitério" — escolha NA RESOLUÇÃO, sem
    // alvo, como todo passo. Não é destruir: não dispara "se for destruída".
    // A própria carta fica de fora da escolha, como no destruir.
    case 'enviar-cemiterio': {
      cat.push('CATEGORY_TOGRAVE');
      const LOC = p.zona === 'monstro' ? 'LOCATION_MZONE' : p.zona === 'magia-armadilha' ? 'LOCATION_SZONE' : 'LOCATION_ONFIELD';
      const MEU = p.lado === 'oponente' ? '0' : LOC;
      const OPP = p.lado === 'meus' ? '0' : LOC;
      fn.push(`function ${filtro}(c)`,
        `${T(1)}return ${eJunto(expressao(p.filtros, { exigeMonstro: p.zona === 'monstro', faceUp: true }), 'c:IsAbleToGrave()')}`, 'end');
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,${MEU},${OPP},1,e:GetHandler())`;
      info = `Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,0,${LOC})`;
      corpo = [
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)',
        `local g=Duel.SelectMatchingCard(tp,${filtro},tp,${MEU},${OPP},1,${p.quantidade},e:GetHandler())`,
        'if #g==0 then return false end',
        'return Duel.SendtoGrave(g,REASON_EFFECT)>0',
      ];
      break;
    }

    case 'bonus': {
      if (p.atk) cat.push('CATEGORY_ATKCHANGE');
      if (p.def) cat.push('CATEGORY_DEFCHANGE');
      if (p.alvo === 'esta') {
        corpo = [
          'local c=e:GetHandler()',
          'if not (c:IsFaceup() and c:IsLocation(LOCATION_MZONE)) then return false end',
          ...linhasDoBonus(p, 'c').map((l) => l.replace(/^\t\t/, '')),
          'return true',
        ];
        break;
      }
      if (p.alvo === 'gatilho') {
        const tc = tcDoGatilho(quando);
        fn.push(`function ${filtro}(c)`, `${T(1)}return ${expressao(p.filtros, { exigeMonstro: true, faceUp: true })}`, 'end');
        pode = `${tc} and ${tc}:IsControler(1-tp) and ${tc}:IsFaceup() and ${filtro}(${tc})`;
        corpo = [
          `local tc=${tc}`,
          'if not tc or not (tc:IsFaceup() and tc:IsLocation(LOCATION_MZONE)) then return false end',
          ...linhasDoBonus(p, 'tc').map((l) => l.replace(/^\t\t/, '')),
          'return true',
        ];
        break;
      }
      const MEU = p.lado === 'oponente' ? '0' : 'LOCATION_MZONE';
      const OPP = p.lado === 'meus' ? '0' : 'LOCATION_MZONE';
      fn.push(`function ${filtro}(c)`, `${T(1)}return ${eJunto(expressao(p.filtros, { exigeMonstro: true }), 'c:IsFaceup()')}`, 'end');
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,${MEU},${OPP},1,e:GetHandler())`;
      corpo = [
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)',
        `local tc=Duel.SelectMatchingCard(tp,${filtro},tp,${MEU},${OPP},1,1,e:GetHandler()):GetFirst()`,
        'if not tc then return false end',
        ...linhasDoBonus(p, 'tc').map((l) => l.replace(/^\t\t/, '')),
        'return true',
      ];
      break;
    }

    case 'ataques': {
      // "Pode atacar N vezes" = N-1 ataques EXTRAS (`EFFECT_EXTRA_ATTACK`).
      const extra = [
        'local e1=Effect.CreateEffect(e:GetHandler())',
        'e1:SetType(EFFECT_TYPE_SINGLE)',
        'e1:SetCode(EFFECT_EXTRA_ATTACK)',
        `e1:SetValue(${p.ataques - 1})`,
        `e1:SetReset(${reset})`,
      ];
      if (p.alvo === 'esta') {
        corpo = [
          'local c=e:GetHandler()',
          'if not (c:IsFaceup() and c:IsLocation(LOCATION_MZONE)) then return false end',
          ...extra,
          'c:RegisterEffect(e1)',
          'return true',
        ];
        break;
      }
      fn.push(`function ${filtro}(c)`, `${T(1)}return ${eJunto(expressao(p.filtros, { exigeMonstro: true }), 'c:IsFaceup()')}`, 'end');
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,LOCATION_MZONE,0,1,e:GetHandler())`;
      corpo = [
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)',
        `local tc=Duel.SelectMatchingCard(tp,${filtro},tp,LOCATION_MZONE,0,1,1,e:GetHandler()):GetFirst()`,
        'if not tc then return false end',
        ...extra,
        'tc:RegisterEffect(e1)',
        'return true',
      ];
      break;
    }
    default:
      corpo = ['return false'];
  }

  // As duas portas de um passo do "e depois", nesta ordem: a CONDIÇÃO sobre o
  // passo anterior ("se você adicionou X do Cemitério por este efeito") e o
  // "você PODE". A pergunta sim/não só vem se o passo é possível — perguntar
  // "quer Invocar?" sem nada a Invocar é oferecer o que o motor não vai cumprir.
  // No 1º passo (a ação do efeito) não há anterior, nem o que perguntar.
  const portas = [];
  if (k > 1 && p.seFiltros?.length && anterior && moveOutra(anterior)) {
    const se = `s.se${n}_${k}`;
    const onde = anterior.acao === 'adicionar' ? 'LOCATION_HAND' : 'LOCATION_MZONE';
    const conds = [`c:IsLocation(${onde})`, ...(p.seDoCemiterio ? ['c:IsPreviousLocation(LOCATION_GRAVE)'] : [])];
    fn.push(`function ${se}(c)`, `${T(1)}return ${eJunto(expressao(p.seFiltros), conds.join(' and '))}`, 'end');
    portas.push(`if not (s.moveu${n} and s.moveu${n}:IsExists(${se},1,nil)) then return false end`);
  }
  if (k > 1 && p.opcional) {
    portas.push(pode === 'true'
      ? 'if not Duel.SelectYesNo(tp,aux.Stringid(id,0)) then return false end'
      : `if not (${pode}) or not Duel.SelectYesNo(tp,aux.Stringid(id,0)) then return false end`);
  }
  return { nome, fn, cat, pode, info, corpo: [...portas, ...corpo] };
}

/** A ação de um efeito em SEQUÊNCIA — a mesma forma que `acao()` devolve. */
function acaoEmSequencia(carta, ef, n) {
  const lista = [ef, ...ef.depois];
  const passos = lista.map((p, i) => passoDaSequencia(carta, p, n, i + 1, ef.quando, lista[i - 1] ?? null, lista[i + 1] ?? null));
  // O que um passo guardou (`s.moveuN`) só vale para ESTA resolução: zerado na
  // entrada, uma ativação anterior nunca responde pela de agora.
  const zera = ef.depois.some((p) => p.seFiltros?.length) ? [`${T(1)}s.moveu${n}=nil`] : [];
  const funcoes = [];
  for (const ps of passos) {
    funcoes.push(...ps.fn, `function ${ps.nome}(e,tp,eg,ep,ev,re,r,rp)`, ...ps.corpo.map((l) => `${T(1)}${l}`), 'end');
  }
  // O "pode ativar?" é o do PRIMEIRO passo: os seguintes são "se isso resolver",
  // e não ter o que destruir depois não impede a Invocação.
  const primeiro = passos[0];
  funcoes.push(cabecaAlvo(n),
    `${T(1)}if chk==0 then return ${primeiro.pode} end`,
    ...(primeiro.info ? [`${T(1)}${primeiro.info}`] : []),
    'end',
    cabecaOp(n),
    ...zera,
    ...passos.flatMap((ps, i) => (i === passos.length - 1
      ? [`${T(1)}${ps.nome}(e,tp,eg,ep,ev,re,r,rp)`]
      : [`${T(1)}if not ${ps.nome}(e,tp,eg,ep,ev,re,r,rp) then return end`, `${T(1)}Duel.BreakEffect()`])),
    'end');
  return {
    categorias: [...new Set(passos.flatMap((ps) => ps.cat))],
    flags: [],
    funcoes,
    temAlvo: true,
    condicao: null,
  };
}

/**
 * O custo "descartar N cartas (com filtro)". Com "de Tipos diferentes" a
 * escolha é feita À MÃO — escolhe uma, tira da lista as do mesmo Tipo, repete —
 * e não por `aux.SelectUnselectGroup`, que usa `Group.Iter`, ausente na
 * `ocgcore.dll` daqui. A conta fecha sempre: cada escolha tira exatamente um
 * Tipo, então quem começou com N Tipos termina com uma de cada.
 */
function custoComFiltro(ef, n) {
  const f = `s.custofiltro${n}`;
  const Q = ef.custoQtd;
  const linhas = [
    `function ${f}(c)`,
    `${T(1)}return ${eJunto(expressao(ef.custoFiltros), 'c:IsDiscardable()')}`,
    'end',
    `function s.custo${n}(e,tp,eg,ep,ev,re,r,rp,chk)`,
  ];
  if (!ef.custoTiposDiferentes) {
    linhas.push(
      `${T(1)}if chk==0 then return Duel.IsExistingMatchingCard(${f},tp,LOCATION_HAND,0,${Q},e:GetHandler()) end`,
      `${T(1)}Duel.DiscardHand(tp,${f},${Q},${Q},REASON_COST+REASON_DISCARD,e:GetHandler())`,
      'end');
    return linhas;
  }
  linhas.push(
    `${T(1)}local g=Duel.GetMatchingGroup(${f},tp,LOCATION_HAND,0,e:GetHandler())`,
    `${T(1)}if chk==0 then return g:GetClassCount(Card.GetRace)>=${Q} end`,
    `${T(1)}local sg=Group.CreateGroup()`,
    `${T(1)}for i=1,${Q} do`,
    `${T(2)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DISCARD)`,
    `${T(2)}local tc=g:Select(tp,1,1,nil):GetFirst()`,
    `${T(2)}sg:AddCard(tc)`,
    `${T(2)}g:Remove(Card.IsRace,nil,tc:GetRace())`,
    `${T(1)}end`,
    `${T(1)}Duel.SendtoGrave(sg,REASON_COST+REASON_DISCARD)`,
    'end');
  return linhas;
}

/**
 * O custo "envie 1 X e 1 Y da sua mão ou Deck ao Cemitério" — uma carta de cada
 * opção (`funcoesDeCada`). A própria carta nunca paga o custo dela mesma.
 */
function custoDeCada(ef, n) {
  const cada = `s.custocada${n}`;
  return [
    ...funcoesDeCada(cada, ef.custoFiltros, 'LOCATION_HAND|LOCATION_DECK', 'c:IsAbleToGraveAsCost()'),
    `function s.custo${n}(e,tp,eg,ep,ev,re,r,rp,chk)`,
    `${T(1)}if chk==0 then return ${cada}_resta(tp,Group.CreateGroup(),e:GetHandler(),1) end`,
    `${T(1)}local sg=${cada}_escolhe(tp,e:GetHandler(),HINTMSG_TOGRAVE)`,
    `${T(1)}Duel.SendtoGrave(sg,REASON_COST)`,
    'end',
  ];
}

const CUSTO_LUA = {
  'enviar-cada': (ef, n) => `s.custo${n}`,
  'revelar-esta': () => 'Cost.SelfReveal',
  'descartar-esta': () => 'Cost.SelfDiscard',
  'tributar-esta': () => 'Cost.SelfTribute',
  'banir-esta': () => 'Cost.SelfBanish',
  'descartar-1': () => 'Cost.Discard(nil,true,1)',
  'descartar-filtro': (ef, n) => `s.custo${n}`,
  'pagar-lp': (ef) => `Cost.PayLP(${ef.custoLp})`,
};

/**
 * A condição ESCRITA do efeito — "se você controlar um monstro … com a face para
 * cima", ou "se um monstro seu foi Invocado por Invocação-Especial neste turno".
 * As duas perguntam ao CAMPO a mesma coisa, mudando só uma cláusula do filtro.
 *
 * Com uma condição que o MOMENTO já trazia (ataque, Invocação do oponente, a
 * negação), a antiga vira `s.condicaobaseN` e a nova exige as duas — trocar uma
 * pela outra faria a Armadilha de ataque ativar sem ataque nenhum, calada.
 */
function condicaoDoEfeito(ef, n, base) {
  const filtro = `s.condfiltro${n}`;
  const cabeca = `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`;
  // "Se você não controlar nenhuma OUTRA carta": a pergunta é a AUSÊNCIA, em
  // todo o campo (monstro, magia/armadilha e campo), sem contar esta carta — e
  // viradas contam, então nada de `IsFaceup`. Filtro vazio = qualquer carta.
  if (ef.condicao === 'nada-mais') {
    const linhas = [`function ${filtro}(c)`, `${T(1)}return ${expressao(ef.condicaoFiltros)}`, 'end'];
    const nada = `not Duel.IsExistingMatchingCard(${filtro},tp,LOCATION_ONFIELD,0,1,e:GetHandler())`;
    if (!base) return [...linhas, cabeca, `${T(1)}return ${nada}`, 'end'];
    return [...linhas,
      ...base.map((l) => (l === cabeca ? `function s.condicaobase${n}(e,tp,eg,ep,ev,re,r,rp)` : l)),
      cabeca, `${T(1)}return s.condicaobase${n}(e,tp,eg,ep,ev,re,r,rp) and ${nada}`, 'end'];
  }
  const existe = `Duel.IsExistingMatchingCard(${filtro},tp,LOCATION_MZONE,0,1,nil)`;
  // "Foi Invocado por Invocação-Especial neste turno" não precisa de contador
  // nosso: o motor já marca o próprio monstro com `STATUS_SPSUMMON_TURN`, e a
  // marca morre no fim do turno sozinha.
  const invocado = ef.condicao === 'invocado-neste-turno' ? ' and c:IsStatus(STATUS_SPSUMMON_TURN)' : '';
  const linhas = [
    `function ${filtro}(c)`,
    `${T(1)}return c:IsFaceup()${invocado} and (${expressao(ef.condicaoFiltros, { exigeMonstro: true })})`,
    'end',
  ];
  if (!base) return [...linhas, cabeca, `${T(1)}return ${existe}`, 'end'];
  return [
    ...linhas,
    ...base.map((l) => (l === cabeca ? `function s.condicaobase${n}(e,tp,eg,ep,ev,re,r,rp)` : l)),
    cabeca,
    `${T(1)}return s.condicaobase${n}(e,tp,eg,ep,ev,re,r,rp) and ${existe}`,
    'end',
  ];
}

/** Um efeito com ativação (tem alvo/operação). Devolve `{ corpo, funcoes }`. */
function efeitoAtivavel(carta, ef, n) {
  const v = `e${n}`;
  const a = emSequencia(ef) ? acaoEmSequencia(carta, ef, n) : acao(carta, ef, n);
  if (ef.custo === 'descartar-filtro') a.funcoes.unshift(...custoComFiltro(ef, n));
  if (ef.custo === 'enviar-cada') a.funcoes.unshift(...custoDeCada(ef, n));
  const flags = [...a.flags];
  let tipo; let codigo = null; let range = null; let condicao = a.condicao;
  let clone = null;
  // Efeitos que o momento registra ALÉM do principal (o registro do
  // `ativou-cartas`), escritos logo depois dele.
  let extras = [];
  const monstro = ehMonstro(carta);

  switch (ef.quando) {
    case 'ativacao': tipo = 'EFFECT_TYPE_ACTIVATE'; codigo = 'EVENT_FREE_CHAIN'; break;
    case 'ataque-oponente':
      tipo = 'EFFECT_TYPE_ACTIVATE'; codigo = 'EVENT_ATTACK_ANNOUNCE';
      condicao = [`function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`, `${T(1)}return Duel.GetTurnPlayer()~=tp`, 'end'];
      break;
    case 'invocacao-oponente':
      tipo = 'EFFECT_TYPE_ACTIVATE'; codigo = 'EVENT_SUMMON_SUCCESS';
      condicao = [`function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`, `${T(1)}return ep~=tp`, 'end'];
      break;
    case 'resposta': tipo = 'EFFECT_TYPE_ACTIVATE'; codigo = 'EVENT_CHAINING'; break;
    case 'mao': tipo = 'EFFECT_TYPE_IGNITION'; range = 'LOCATION_HAND'; break;
    // "Efeito rápido" é isto e só isto: `EFFECT_TYPE_QUICK_O` com
    // `EVENT_FREE_CHAIN`. O `IGNITION` do `mao` só roda na SUA Main Phase, com a
    // corrente vazia — a diferença não aparece em teste de geração nenhum, e sim
    // num duelo, no turno do oponente, quando a carta não é oferecida.
    case 'mao-rapido':
      tipo = 'EFFECT_TYPE_QUICK_O'; codigo = 'EVENT_FREE_CHAIN'; range = 'LOCATION_HAND';
      break;
    case 'cemiterio': tipo = 'EFFECT_TYPE_IGNITION'; range = 'LOCATION_GRAVE'; break;
    case 'campo':
      if (monstro) { tipo = 'EFFECT_TYPE_IGNITION'; range = 'LOCATION_MZONE'; }
      else if (carta.tipo === 'armadilha') { tipo = 'EFFECT_TYPE_QUICK_O'; codigo = 'EVENT_FREE_CHAIN'; range = 'LOCATION_SZONE'; }
      else { tipo = 'EFFECT_TYPE_IGNITION'; range = carta.subtipo === 'campo' ? 'LOCATION_FZONE' : 'LOCATION_SZONE'; }
      break;
    case 'invocado':
      tipo = 'EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_SUMMON_SUCCESS';
      flags.push('EFFECT_FLAG_DELAY');
      clone = 'EVENT_SPSUMMON_SUCCESS';
      break;
    // Só a Invocação-Especial — a Fusão, o Ritual, o Monster Reborn: é o
    // `EVENT_SPSUMMON_SUCCESS` sozinho, sem o clone do `invocado`.
    case 'invocado-especial':
      tipo = 'EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_SPSUMMON_SUCCESS';
      flags.push('EFFECT_FLAG_DELAY');
      break;
    case 'enviado-cemiterio':
      tipo = 'EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_TO_GRAVE';
      flags.push('EFFECT_FLAG_DELAY');
      break;
    // "Se um monstro seu deixar o campo por uma carta do oponente" — o gatilho
    // dispara com esta carta NO CEMITÉRIO, e por isso é `EFFECT_TYPE_FIELD` com
    // `SetRange(LOCATION_GRAVE)`, e não o `EFFECT_TYPE_SINGLE` dos gatilhos que
    // falam da própria carta.
    //
    // As três perguntas da condição são as dos scripts oficiais, e cada uma tapa
    // um buraco: `IsPreviousLocation(LOCATION_MZONE)` — saiu do CAMPO, não do
    // Deck nem da mão; `IsPreviousControler(tp)` — era SEU, senão o monstro do
    // oponente que você destruiu também serviria; e `GetReasonPlayer()~=tp` —
    // foi o OPONENTE que o tirou de lá, senão o seu próprio tributo dispararia
    // o gatilho.
    // "Se ESTA carta deixar o campo": o gatilho é da própria carta, então é
    // `EFFECT_TYPE_SINGLE` e segue com ela — sem `SetRange`, que é o que o
    // `EFFECT_TYPE_FIELD` do irmão precisa. A condição pergunta ao PRÓPRIO
    // handler, e não a `eg`.
    case 'esta-saiu-do-campo':
      tipo = 'EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_LEAVE_FIELD';
      flags.push('EFFECT_FLAG_DAMAGE_STEP', 'EFFECT_FLAG_DELAY');
      condicao = [
        `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`,
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}return c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp)`,
        `${T(2)}and (c:IsReason(REASON_BATTLE) or (c:IsReason(REASON_EFFECT) and c:GetReasonPlayer()~=tp))`,
        'end',
      ];
      break;
    // "Se este card deixar o campo" — por QUALQUER motivo: batalha, efeito de
    // qualquer um, tributo, material. Mesmo `EFFECT_TYPE_SINGLE` do irmão acima
    // e as mesmas duas flags (a Etapa de Dano é onde ele morre em batalha); a
    // condição só confere que ela estava MESMO em campo e era sua.
    case 'esta-deixou-campo':
      tipo = 'EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_LEAVE_FIELD';
      flags.push('EFFECT_FLAG_DAMAGE_STEP', 'EFFECT_FLAG_DELAY');
      condicao = [
        `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`,
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp)`,
        'end',
      ];
      break;
    case 'saiu-do-campo':
      tipo = 'EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_LEAVE_FIELD';
      // ONDE a carta está quando o gatilho acontece, e isso MUDA com o tipo: o
      // monstro fala do Cemitério (é de lá que ele volta), e a Contínua fala do
      // campo, onde ela já está. Com o range errado o efeito nunca é oferecido —
      // e nada acusa, porque não há erro nenhum: ele só não aparece.
      range = monstro ? 'LOCATION_GRAVE' : carta.subtipo === 'campo' ? 'LOCATION_FZONE' : 'LOCATION_SZONE';
      // `EFFECT_FLAG_DAMAGE_STEP` não é enfeite: sem ela um gatilho NÃO PODE ser
      // ativado durante a Etapa de Dano — e é ali que um monstro destruído em
      // BATALHA deixa o campo. O efeito simplesmente não é oferecido, sem erro
      // nenhum, e o jogador vê a carta parada no Cemitério enquanto o monstro
      // dele é atropelado. Foi o `--test-card-builder` que achou; antes dele a
      // carta parecia certa em toda leitura. O oficial `c26077387` é o molde.
      flags.push('EFFECT_FLAG_DAMAGE_STEP', 'EFFECT_FLAG_DELAY');
      condicao = [
        `function s.saiu${n}(c,tp)`,
        `${T(1)}return c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp)`,
        // "POR CAUSA DO OPONENTE" são DUAS coisas, e o idioma oficial escreve as
        // duas: a BATALHA conta sempre (o motor não marca o oponente como razão
        // de uma destruição em batalha — `GetReasonPlayer()` ali devolve o dono
        // da carta), e o EFEITO só conta quando quem o usou foi ele.
        //
        // Só a segunda metade era o que o gerador escrevia, e o `--test-card-builder`
        // pegou: o monstro morria atacado, a condição dava falso e o gatilho
        // NUNCA acordava. Num duelo isso é mudo — o efeito simplesmente não é
        // oferecido, e foi exatamente o relato ("ativei e não trouxe o card").
        `${T(2)}and (c:IsReason(REASON_BATTLE) or (c:IsReason(REASON_EFFECT) and c:GetReasonPlayer()~=tp))`,
        `${T(2)}and (${expressao(ef.gatilhoFiltros, { exigeMonstro: true })})`,
        'end',
        `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`,
        `${T(1)}return eg:IsExists(s.saiu${n},1,nil,tp)`,
        'end',
      ];
      break;
    // "Se você ativar 1 X e 1 Y enquanto esta carta estiver no seu Cemitério":
    // um gatilho de CEMITÉRIO em `EVENT_CHAINING` (a forma do oficial
    // `c13567610`, com `EFFECT_FLAG_DELAY`) que acorda na ativação que COMPLETA
    // a lista.
    //
    // Quem guarda as ativações anteriores é um segundo efeito, contínuo, também
    // no Cemitério: ele marca a carta (`RegisterFlagEffect`) a cada ativação que
    // casa com uma opção. A marca morre no fim do turno e quando a carta SAI do
    // Cemitério (`RESETS_STANDARD`) — é isso que faz valer só "enquanto esta
    // carta estiver no Cemitério": o que foi ativado antes de ela chegar lá
    // nunca foi marcado. A condição não depende de quem roda primeiro entre o
    // registro e o gatilho no mesmo evento: ela soma a carta que está sendo
    // ativada AGORA às marcas.
    //
    // "Ativar" uma Magia/Armadilha é ativar a CARTA (`EFFECT_TYPE_ACTIVATE`) —
    // um efeito dela no Cemitério não conta; de um monstro, é ativar o efeito.
    case 'ativou-cartas': {
      tipo = 'EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_CHAINING'; range = 'LOCATION_GRAVE';
      flags.push('EFFECT_FLAG_DELAY');
      const lista = `s.ativou${n}`;
      const marca = (i) => `id+${100 * n}+${i}`;
      const ativacao = '(re:IsHasType(EFFECT_TYPE_ACTIVATE) or re:IsActiveType(TYPE_MONSTER))';
      extras = [
        `${T(1)}--registro: o que você ativa enquanto esta carta está no Cemitério`,
        `${T(1)}local ${v}r=Effect.CreateEffect(c)`,
        `${T(1)}${v}r:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)`,
        `${T(1)}${v}r:SetCode(EVENT_CHAINING)`,
        `${T(1)}${v}r:SetRange(LOCATION_GRAVE)`,
        `${T(1)}${v}r:SetOperation(s.registro${n})`,
        `${T(1)}c:RegisterEffect(${v}r)`,
      ];
      condicao = [
        ...ef.gatilhoFiltros.flatMap((g, i) => [`function ${lista}_${i + 1}(c)`,
          `${T(1)}return ${expressao([g])}`,
          'end']),
        `${lista}={${ef.gatilhoFiltros.map((_, i) => `${lista}_${i + 1}`).join(',')}}`,
        `function s.registro${n}(e,tp,eg,ep,ev,re,r,rp)`,
        `${T(1)}if rp~=tp or not ${ativacao} then return end`,
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}local rc=re:GetHandler()`,
        `${T(1)}for i=1,#${lista} do`,
        `${T(2)}if ${lista}[i](rc) then c:RegisterFlagEffect(${marca('i')},RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_END,0,1) end`,
        `${T(1)}end`,
        'end',
        `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`,
        `${T(1)}if rp~=tp or not ${ativacao} or #${lista}==0 then return false end`,
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}local rc=re:GetHandler()`,
        `${T(1)}local agora=false`,
        `${T(1)}for i=1,#${lista} do`,
        `${T(2)}if ${lista}[i](rc) then agora=true`,
        `${T(2)}elseif c:GetFlagEffect(${marca('i')})==0 then return false end`,
        `${T(1)}end`,
        `${T(1)}return agora`,
        'end',
      ];
      break;
    }
    default: tipo = 'EFFECT_TYPE_ACTIVATE'; codigo = 'EVENT_FREE_CHAIN';
  }

  // Gatilho OBRIGATÓRIO: o texto não diz "você pode". `TRIGGER_F` ativa sozinho
  // (ninguém pergunta), e é o que faz o "destrua tudo o que você controla" não
  // poder ser recusado quando convém.
  if (ef.obrigatorio) tipo = tipo.replace('EFFECT_TYPE_TRIGGER_O', 'EFFECT_TYPE_TRIGGER_F');

  const corpo = [`${T(1)}--${QUANDO[ef.quando]}: ${ACOES[ef.acao]}${ef.alvo ? ` (${ALVOS[ef.alvo]})` : ''}`,
    `${T(1)}local ${v}=Effect.CreateEffect(c)`];
  if (a.categorias.length) corpo.push(`${T(1)}${v}:SetCategory(${a.categorias.join('+')})`);
  corpo.push(`${T(1)}${v}:SetType(${tipo})`);
  if (flags.length) corpo.push(`${T(1)}${v}:SetProperty(${flags.join('+')})`);
  if (codigo) corpo.push(`${T(1)}${v}:SetCode(${codigo})`);
  if (range) corpo.push(`${T(1)}${v}:SetRange(${range})`);
  if (ef.limite === 'por-copia') corpo.push(`${T(1)}${v}:SetCountLimit(1)`);
  // "Pelo nome" é contado no `id` da carta: dois efeitos com esse limite
  // DIVIDEM a conta — o "só pode usar 1 destes efeitos por turno" do jogo.
  if (ef.limite === 'por-nome') {
    corpo.push(ATIVACOES.has(ef.quando)
      ? `${T(1)}${v}:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)`
      : `${T(1)}${v}:SetCountLimit(1,id)`);
  }
  // "Este efeito" pelo nome: `{id,n}` dá a CADA efeito o seu contador — a forma
  // oficial (o Darkuriboh usa `{id,1}`). O `n` nunca é 0: `{id,0}` é o próprio
  // `id`, a conta dividida do `por-nome`.
  if (ef.limite === 'por-efeito') {
    corpo.push(ATIVACOES.has(ef.quando)
      ? `${T(1)}${v}:SetCountLimit(1,{id,${n}},EFFECT_COUNT_CODE_OATH)`
      : `${T(1)}${v}:SetCountLimit(1,{id,${n}})`);
  }
  if (ef.condicao !== 'nenhuma') condicao = condicaoDoEfeito(ef, n, condicao);
  if (condicao) corpo.push(`${T(1)}${v}:SetCondition(s.condicao${n})`);
  if (ef.custo !== 'nenhum') corpo.push(`${T(1)}${v}:SetCost(${CUSTO_LUA[ef.custo](ef, n)})`);
  if (a.temAlvo) corpo.push(`${T(1)}${v}:SetTarget(s.alvo${n})`);
  corpo.push(`${T(1)}${v}:SetOperation(s.operacao${n})`, `${T(1)}c:RegisterEffect(${v})`, ...extras);
  if (clone) {
    corpo.push(`${T(1)}local ${v}b=${v}:Clone()`, `${T(1)}${v}b:SetCode(${clone})`, `${T(1)}c:RegisterEffect(${v}b)`);
  }
  return { corpo, funcoes: [...(condicao ?? []), ...a.funcoes] };
}

/**
 * **"Não pode ser alvo de efeitos de cartas do oponente"** — o contínuo do
 * `EFFECT_CANNOT_BE_EFFECT_TARGET`, na forma do script oficial `c1061200`.
 *
 * Duas peças pequenas seguram a regra inteira, e as duas erram CALADAS:
 *
 *   • **`aux.tgoval` no `SetValue`** é o que restringe a proteção aos efeitos do
 *     OPONENTE. Sem ele a proteção vale contra todo mundo — e os seus próprios
 *     efeitos deixam de poder mirar os seus monstros, o que ninguém pediu e o
 *     texto da carta não diz;
 *   • **`EFFECT_FLAG_IGNORE_IMMUNE`** faz a proteção ser enxergada mesmo por
 *     quem ignora imunidade.
 *
 * Aqui o monstro que concede NÃO se exclui: o texto fala de "monstros que você
 * controla", e ele é um deles. (O bônus contínuo exclui, porque lá o texto
 * oficial é "cada OUTRO monstro".)
 */
function efeitoNaoAlvo(carta, ef, n) {
  const v = `e${n}`;
  const monstro = ehMonstro(carta);

  // "ESTE card não pode ser alvo": o efeito é da própria carta, e a forma é a do
  // oficial `c10000000` — `EFFECT_TYPE_SINGLE` com `EFFECT_FLAG_SINGLE_RANGE` e
  // o alcance da zona em que ela está. Não há filtro: ela já sabe de quem fala.
  if (ef.alvo === 'esta') {
    return {
      corpo: [
        `${T(1)}--${QUANDO.continuo}: ${ACOES['nao-alvo']} (${ALVOS.esta})`,
        `${T(1)}local ${v}=Effect.CreateEffect(c)`,
        `${T(1)}${v}:SetType(EFFECT_TYPE_SINGLE)`,
        `${T(1)}${v}:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)`,
        `${T(1)}${v}:SetProperty(EFFECT_FLAG_SINGLE_RANGE)`,
        `${T(1)}${v}:SetRange(LOCATION_MZONE)`,
        `${T(1)}${v}:SetValue(aux.tgoval)`,
        `${T(1)}c:RegisterEffect(${v})`,
      ],
      funcoes: [],
    };
  }
  const range = monstro ? 'LOCATION_MZONE' : carta.subtipo === 'campo' ? 'LOCATION_FZONE' : 'LOCATION_SZONE';
  const MEU = ef.lado === 'oponente' ? '0' : 'LOCATION_MZONE';
  const OPP = ef.lado === 'meus' ? '0' : 'LOCATION_MZONE';
  const corpo = [
    `${T(1)}--${QUANDO.continuo}: ${ACOES['nao-alvo']}`,
    `${T(1)}local ${v}=Effect.CreateEffect(c)`,
    `${T(1)}${v}:SetType(EFFECT_TYPE_FIELD)`,
    `${T(1)}${v}:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)`,
    `${T(1)}${v}:SetRange(${range})`,
    `${T(1)}${v}:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)`,
    `${T(1)}${v}:SetTargetRange(${MEU},${OPP})`,
    `${T(1)}${v}:SetTarget(s.filtro${n})`,
    `${T(1)}${v}:SetValue(aux.tgoval)`,
    `${T(1)}c:RegisterEffect(${v})`,
  ];
  const funcoes = [
    `function s.filtro${n}(e,c)`,
    `${T(1)}return ${expressao(ef.filtros, { exigeMonstro: true })}`,
    'end',
  ];
  return { corpo, funcoes };
}

/** Bônus contínuo (monstro em campo, Magia/Armadilha Contínua, Campo) ou de equipamento. */
function efeitoDeBonus(carta, ef, n) {
  const corpo = [];
  const funcoes = [];
  const monstro = ehMonstro(carta);
  const partes = [];
  if (ef.atk) partes.push(['EFFECT_UPDATE_ATTACK', ef.atk, '']);
  if (ef.def) partes.push(['EFFECT_UPDATE_DEFENSE', ef.def, ef.atk ? 'b' : '']);

  if (ef.quando === 'equipado') {
    corpo.push(`${T(1)}--${QUANDO.equipado}: ${ACOES.bonus}`);
    for (const [codigo, valor, sufixo] of partes) {
      const v = `e${n}${sufixo}`;
      corpo.push(`${T(1)}local ${v}=Effect.CreateEffect(c)`, `${T(1)}${v}:SetType(EFFECT_TYPE_EQUIP)`,
        `${T(1)}${v}:SetCode(${codigo})`, `${T(1)}${v}:SetValue(${valor})`, `${T(1)}c:RegisterEffect(${v})`);
    }
    return { corpo, funcoes };
  }

  corpo.push(`${T(1)}--${QUANDO.continuo}: ${ACOES.bonus} (${ALVOS[ef.alvo]})`);
  if (ef.alvo === 'esta') {
    for (const [codigo, valor, sufixo] of partes) {
      const v = `e${n}${sufixo}`;
      corpo.push(`${T(1)}local ${v}=Effect.CreateEffect(c)`, `${T(1)}${v}:SetType(EFFECT_TYPE_SINGLE)`,
        `${T(1)}${v}:SetProperty(EFFECT_FLAG_SINGLE_RANGE)`, `${T(1)}${v}:SetRange(LOCATION_MZONE)`,
        `${T(1)}${v}:SetCode(${codigo})`, `${T(1)}${v}:SetValue(${valor})`, `${T(1)}c:RegisterEffect(${v})`);
    }
    return { corpo, funcoes };
  }

  const range = monstro ? 'LOCATION_MZONE' : carta.subtipo === 'campo' ? 'LOCATION_FZONE' : 'LOCATION_SZONE';
  const MEU = ef.lado === 'oponente' ? '0' : 'LOCATION_MZONE';
  const OPP = ef.lado === 'meus' ? '0' : 'LOCATION_MZONE';
  let expr = expressao(ef.filtros, { exigeMonstro: true });
  // "Outro" monstro: num monstro, o bônus contínuo não vale para ele mesmo.
  if (monstro) expr = eJunto(expr, 'c~=e:GetHandler()');
  funcoes.push(`function s.filtro${n}(e,c)`, `${T(1)}return ${expr}`, 'end');
  for (const [codigo, valor, sufixo] of partes) {
    const v = `e${n}${sufixo}`;
    corpo.push(`${T(1)}local ${v}=Effect.CreateEffect(c)`, `${T(1)}${v}:SetType(EFFECT_TYPE_FIELD)`,
      `${T(1)}${v}:SetRange(${range})`, `${T(1)}${v}:SetTargetRange(${MEU},${OPP})`,
      `${T(1)}${v}:SetTarget(s.filtro${n})`, `${T(1)}${v}:SetCode(${codigo})`,
      `${T(1)}${v}:SetValue(${valor})`, `${T(1)}c:RegisterEffect(${v})`);
  }
  return { corpo, funcoes };
}

/**
 * "Monstros X podem ser Invocados por Invocação-Normal sem tributo" — o
 * `EFFECT_SUMMON_PROC` de campo do Metaphys Factor oficial, para as cartas da
 * SUA mão enquanto esta estiver em campo.
 *
 * `IsLevelAbove(5)` vai no alvo mesmo quando o filtro não pede Nível: um monstro
 * de Nível 4 já se Invoca sem tributo, e o procedimento só daria a ele uma
 * segunda forma idêntica de ser Invocado — duas ofertas iguais na tela.
 */
function efeitoSemTributo(carta, ef, n) {
  const v = `e${n}`;
  const range = ehMonstro(carta) ? 'LOCATION_MZONE' : carta.subtipo === 'campo' ? 'LOCATION_FZONE' : 'LOCATION_SZONE';
  return {
    corpo: [
      `${T(1)}--${QUANDO.continuo}: ${ACOES['sem-tributo']}`,
      `${T(1)}local ${v}=Effect.CreateEffect(c)`,
      `${T(1)}${v}:SetType(EFFECT_TYPE_FIELD)`,
      `${T(1)}${v}:SetCode(EFFECT_SUMMON_PROC)`,
      `${T(1)}${v}:SetRange(${range})`,
      `${T(1)}${v}:SetTargetRange(LOCATION_HAND,0)`,
      `${T(1)}${v}:SetCondition(s.condicao${n})`,
      `${T(1)}${v}:SetTarget(aux.FieldSummonProcTg(s.filtro${n}))`,
      `${T(1)}c:RegisterEffect(${v})`,
    ],
    funcoes: [
      `function s.condicao${n}(e,c,minc)`,
      `${T(1)}if c==nil then return true end`,
      `${T(1)}return minc==0 and Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0`,
      'end',
      `function s.filtro${n}(e,c)`,
      `${T(1)}return ${eJunto(expressao(ef.filtros, { exigeMonstro: true }), 'c:IsLevelAbove(5)')}`,
      'end',
    ],
  };
}

/** O rótulo da linha de tipo, para o cabeçalho do script e a tela. */
export function rotuloDoTipo(bruta) {
  const carta = normalizarCarta(bruta);
  const t = TIPOS.find((x) => x[0] === carta.tipo)[1];
  const sub = SUBTIPOS[carta.tipo]?.find((x) => x[0] === carta.subtipo)?.[1];
  return sub ? `${t} ${sub}` : t;
}

/**
 * **O `c<id>.lua` da carta.** O esqueleto sai do TIPO; os efeitos entram
 * depois dele, cada um com as suas funções no fim do arquivo.
 */
export function gerarLua(bruta) {
  const carta = normalizarCarta(bruta);
  const corpo = [];
  const funcoes = [];
  const s = carta.subtipo;

  // ---- o esqueleto do tipo
  if (carta.tipo === 'monstro-normal') {
    corpo.push(`${T(1)}--Monstro Normal: sem efeito. O script existe para o motor achar a carta.`);
  }
  if (ehFusaoOuRitual(carta)) {
    // Sem o EnableReviveLimit o motor deixaria Invocar a carta por Invocação-
    // Normal e revivê-la do Cemitério sem nunca ter sido Invocada direito.
    corpo.push(carta.tipo === 'monstro-fusao'
      ? `${T(1)}--Monstro de Fusão: sai do Extra Deck por Invocação-Fusão, com os materiais abaixo`
      : `${T(1)}--Monstro de Ritual: só sai por Invocação-Ritual (a Magia de Ritual aponta o id desta carta)`,
    `${T(1)}c:EnableReviveLimit()`);
  }
  if (carta.tipo === 'monstro-fusao' && carta.fusao.materiais.length) {
    // `AddProcMixN` recebe pares (filtro, quantos): "A + 2 B" vira
    // (s.material1,1,s.material2,2) — a forma do Nordic Gorilla oficial.
    const pares = carta.fusao.materiais.map((m, i) => `s.material${i + 1},${m.qtd}`).join(',');
    corpo.push(`${T(1)}Fusion.AddProcMixN(c,true,true,${pares})`);
    carta.fusao.materiais.forEach((m, i) => {
      funcoes.push(`function s.material${i + 1}(c,fc,sumtype,tp)`,
        `${T(1)}return ${expressao(m.filtros, { exigeMonstro: true })}`,
        'end');
    });
  }
  if (carta.tipo === 'magia' && s === 'ritual') {
    corpo.push(`${T(1)}--Magia de Ritual: Invoca por Ritual o monstro abaixo (Níveis iguais ou maiores)`);
    if (carta.ritual.codigo) {
      corpo.push(`${T(1)}Ritual.AddProcGreater({handler=c,filter=aux.FilterBoolFunction(Card.IsCode,${carta.ritual.codigo})})`);
    } else {
      corpo.push(`${T(1)}--(falta o id do monstro de Ritual)`);
    }
  }
  if (carta.tipo === 'magia' && s === 'equipamento') {
    const p = carta.equipa.lado === 'meus' ? '0' : carta.equipa.lado === 'oponente' ? '1' : 'PLAYER_ALL';
    const temFiltro = carta.equipa.filtros.length > 0;
    corpo.push(`${T(1)}--Magia de Equipamento: ativa escolhendo um monstro com a face para cima`,
      `${T(1)}aux.AddEquipProcedure(c,${p},${temFiltro ? 's.equipfiltro' : 'nil'})`);
    if (temFiltro) {
      funcoes.push('function s.equipfiltro(c,e,tp)', `${T(1)}return ${expressao(carta.equipa.filtros, { exigeMonstro: true })}`, 'end');
    }
  }
  // "Esta carta é sempre tratada como <outra carta>": o `EFFECT_ADD_CODE` do
  // script oficial `c11082056`, registrado no `initial_effect` e por isso
  // PERMANENTE — é o que "sempre" quer dizer. `CANNOT_DISABLE` e `UNCOPYABLE`
  // vêm do oficial: o NOME de uma carta não é um efeito que se negue nem se copie.
  //
  // O nome só entra no COMENTÁRIO; quem o motor lê é o id.
  if (ehMonstro(carta) && carta.tratadoComo.codigo) {
    const quem = carta.tratadoComo.nome ? ` "${carta.tratadoComo.nome}"` : '';
    corpo.push(`${T(1)}--sempre tratada como${quem} (${carta.tratadoComo.codigo})`,
      `${T(1)}local ec=Effect.CreateEffect(c)`,
      `${T(1)}ec:SetType(EFFECT_TYPE_SINGLE)`,
      `${T(1)}ec:SetCode(EFFECT_ADD_CODE)`,
      `${T(1)}ec:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)`,
      `${T(1)}ec:SetValue(${carta.tratadoComo.codigo})`,
      `${T(1)}c:RegisterEffect(ec)`);
  }
  // "Sempre tratada como um card <arquétipo>": `EFFECT_ADD_SETCODE` no
  // `initial_effect`, SINGLE e SEM alcance — vale em toda zona (Deck, mão,
  // campo, Cemitério), que é o que "sempre" quer dizer e o que uma busca por
  // arquétipo no Deck precisa. A mesma forma do "tratada como <carta>" acima.
  // O motor não lê setcode de carta do builder pelos dados (o `CardReaderCallback`
  // deixa `setcodes` nulo para elas); por isso é o script que o carrega. O valor
  // vai como NÚMERO: o `SET_*` mora noutro arquivo de constantes.
  if (ehMonstro(carta) && carta.arquetipo.setcode) {
    const hex = `0x${carta.arquetipo.setcode.toString(16)}`;
    const quem = carta.arquetipo.nome ? ` "${carta.arquetipo.nome}"` : '';
    corpo.push(`${T(1)}--sempre tratada como um card${quem} (arquétipo ${hex})`,
      `${T(1)}local ea=Effect.CreateEffect(c)`,
      `${T(1)}ea:SetType(EFFECT_TYPE_SINGLE)`,
      `${T(1)}ea:SetCode(EFFECT_ADD_SETCODE)`,
      `${T(1)}ea:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)`,
      `${T(1)}ea:SetValue(${hex})`,
      `${T(1)}c:RegisterEffect(ea)`);
  }
  // "Enquanto estiver no Cemitério, é tratada como um monstro Normal": o par do
  // Gemini oficial (`proc_gemini.lua`) — GANHA `TYPE_NORMAL` e PERDE
  // `TYPE_EFFECT`, com `SINGLE_RANGE` no Cemitério. As duas metades importam:
  // só a primeira deixaria a carta Normal E de Efeito ao mesmo tempo, e um filtro
  // "monstro de Efeito" continuaria a achando lá. Não é o bit de `dadosDoMotor`,
  // porque na mão e em campo ela precisa continuar sendo de Efeito.
  if (ehMonstro(carta) && carta.normalNoCemiterio) {
    corpo.push(`${T(1)}--no Cemitério: tratada como um monstro Normal`,
      `${T(1)}local etn=Effect.CreateEffect(c)`,
      `${T(1)}etn:SetType(EFFECT_TYPE_SINGLE)`,
      `${T(1)}etn:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_IGNORE_IMMUNE)`,
      `${T(1)}etn:SetCode(EFFECT_ADD_TYPE)`,
      `${T(1)}etn:SetRange(LOCATION_GRAVE)`,
      `${T(1)}etn:SetValue(TYPE_NORMAL)`,
      `${T(1)}c:RegisterEffect(etn)`,
      `${T(1)}local etn2=etn:Clone()`,
      `${T(1)}etn2:SetCode(EFFECT_REMOVE_TYPE)`,
      `${T(1)}etn2:SetValue(TYPE_EFFECT)`,
      `${T(1)}c:RegisterEffect(etn2)`);
  }
  // PROCEDIMENTO PRÓPRIO de Invocação-Especial — a forma do Dark Eradicator
  // Warlock oficial (`c29436665`): `EFFECT_TYPE_FIELD` com `EFFECT_SPSUMMON_PROC`
  // e alcance da MÃO, que é de onde a carta sai.
  //
  // A condição pergunta as DUAS coisas: existe o que PAGAR e existe o que
  // DESTRUIR. Sem a segunda metade a Invocação seria oferecida e a destruição
  // obrigatória não aconteceria — o texto da carta estaria mentindo.
  //
  // `spcon` recebe `(e,c)` e NÃO tem `tp`: o jogador sai de `c:GetControler()`,
  // como no oficial. E o `c==nil then return true` do começo não é enfeite — o
  // motor chama a condição sem carta para saber se o procedimento existe.
  if (ehMonstro(carta) && carta.invocacaoEspecial.ligado) {
    const inv = carta.invocacaoEspecial;
    corpo.push(`${T(1)}--Invocação-Especial própria: sai da mão pagando o preço abaixo`,
      `${T(1)}local ei=Effect.CreateEffect(c)`,
      `${T(1)}ei:SetType(EFFECT_TYPE_FIELD)`,
      `${T(1)}ei:SetCode(EFFECT_SPSUMMON_PROC)`,
      `${T(1)}ei:SetProperty(EFFECT_FLAG_UNCOPYABLE)`,
      `${T(1)}ei:SetRange(LOCATION_HAND)`);
    // "Você só pode Invocar X desta forma uma vez por turno" — o `OATH` do
    // oficial `c1003028`: conta mesmo se a Invocação for negada. O `{id,9}` fica
    // longe dos `{id,n}` dos efeitos (n vai até 5), senão a Invocação e um
    // efeito dividiriam a mesma conta, calados.
    if (inv.umaVezPorTurno) corpo.push(`${T(1)}ei:SetCountLimit(1,{id,9},EFFECT_COUNT_CODE_OATH)`);
    // `SetValue(1)` marca a Invocação como `SUMMON_TYPE_SPECIAL+1`: é por essa
    // marca que o gatilho de baixo sabe que ela entrou por ESTE procedimento, e
    // não por um Monster Reborn (oficial `c13224603`).
    corpo.push(`${T(1)}ei:SetCondition(s.invcon)`,
      `${T(1)}ei:SetOperation(s.invop)`,
      `${T(1)}ei:SetValue(1)`,
      `${T(1)}c:RegisterEffect(ei)`);
    // O "ENTÃO destrua" é um gatilho OBRIGATÓRIO depois de entrar, e não parte
    // do procedimento. A diferença é de regra, não de estilo: dentro do
    // procedimento a destruição acontecia ANTES de a carta pisar no campo, sem
    // o oponente poder responder, e valia até se a Invocação fosse negada.
    if (inv.destruir.length) {
      corpo.push(`${T(1)}--então destrua (depois de entrar pelo procedimento acima)`,
        `${T(1)}local ed=Effect.CreateEffect(c)`,
        `${T(1)}ed:SetCategory(CATEGORY_DESTROY)`,
        `${T(1)}ed:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)`,
        `${T(1)}ed:SetCode(EVENT_SPSUMMON_SUCCESS)`,
        `${T(1)}ed:SetCondition(s.invdcon)`,
        `${T(1)}ed:SetTarget(s.invdtg)`,
        `${T(1)}ed:SetOperation(s.invdop)`,
        `${T(1)}c:RegisterEffect(ed)`);
    }

    funcoes.push('function s.invcusto(c)',
      `${T(1)}return ${eJunto(expressao(inv.custoFiltros), 'c:IsAbleToGrave()')}`,
      'end');
    inv.destruir.forEach((g, i) => {
      funcoes.push(`function s.invdestruir${i + 1}(c)`,
        `${T(1)}return ${eJunto(expressao(g.filtros), 'c:IsFaceup()')}`,
        'end');
    });

    const existe = [`Duel.IsExistingMatchingCard(s.invcusto,tp,LOCATION_HAND|LOCATION_DECK,0,1,c)`]
      .concat(inv.destruir.map((_, i) =>
        `Duel.IsExistingMatchingCard(s.invdestruir${i + 1},tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)`));
    funcoes.push('function s.invcon(e,c)',
      `${T(1)}if c==nil then return true end`,
      `${T(1)}local tp=c:GetControler()`,
      `${T(1)}return ${existe.join(`\n${T(2)}and `)}`,
      'end');

    // O procedimento só PAGA o preço; a destruição é o gatilho de baixo.
    funcoes.push('function s.invop(e,tp,eg,ep,ev,re,r,rp,c)',
      `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)`,
      `${T(1)}local g=Duel.SelectMatchingCard(tp,s.invcusto,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,c)`,
      `${T(1)}Duel.SendtoGrave(g,REASON_COST)`,
      'end');

    if (inv.destruir.length) {
      // `fora` guarda a PRÓPRIA carta e o que já foi escolhido: ela é um Mago de
      // TREVAS em campo agora, e sem isso o filtro a ofereceria como alvo da
      // própria destruição; e uma carta não conta duas vezes.
      const dop = ['function s.invdop(e,tp,eg,ep,ev,re,r,rp)',
        `${T(1)}local c=e:GetHandler()`,
        `${T(1)}local dg=Group.CreateGroup()`,
        `${T(1)}local fora=Group.FromCards(c)`];
      inv.destruir.forEach((_, i) => {
        dop.push(`${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)`,
          `${T(1)}local g${i + 1}=Duel.SelectMatchingCard(tp,s.invdestruir${i + 1},tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,fora)`,
          `${T(1)}dg:Merge(g${i + 1})`,
          `${T(1)}fora:Merge(g${i + 1})`);
      });
      dop.push(`${T(1)}if #dg>0 then Duel.Destroy(dg,REASON_EFFECT) end`, 'end');
      funcoes.push('function s.invdcon(e,tp,eg,ep,ev,re,r,rp)',
        `${T(1)}return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1`,
        'end',
        'function s.invdtg(e,tp,eg,ep,ev,re,r,rp,chk)',
        `${T(1)}if chk==0 then return true end`,
        `${T(1)}Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,${inv.destruir.length},PLAYER_ALL,LOCATION_ONFIELD)`,
        'end',
        ...dop);
    }
  }
  const ficaNaZona = (carta.tipo === 'magia' && (s === 'continua' || s === 'campo'))
    || (carta.tipo === 'armadilha' && s === 'continua');
  if (ficaNaZona && !carta.efeitos.some((e) => e.quando === 'ativacao')) {
    // Contínua e Campo precisam de uma ativação para ENTRAR na zona, mesmo sem
    // efeito nenhum nela — sem isto o motor nunca oferece "Ativar".
    corpo.push(`${T(1)}--Ativar (a carta fica na zona)`,
      `${T(1)}local e0=Effect.CreateEffect(c)`,
      `${T(1)}e0:SetType(EFFECT_TYPE_ACTIVATE)`,
      `${T(1)}e0:SetCode(EVENT_FREE_CHAIN)`,
      `${T(1)}c:RegisterEffect(e0)`);
  }

  // ---- os efeitos
  carta.efeitos.forEach((ef, i) => {
    const n = i + 1;
    let r;
    if (ef.acao === 'sem-tributo') r = efeitoSemTributo(carta, ef, n);
    else if (ef.acao === 'nao-alvo') r = efeitoNaoAlvo(carta, ef, n);
    else if (ef.quando === 'continuo' || ef.quando === 'equipado') r = efeitoDeBonus(carta, ef, n);
    else r = efeitoAtivavel(carta, ef, n);
    corpo.push(...r.corpo);
    if (r.funcoes.length) funcoes.push(...r.funcoes);
  });

  const nome = carta.nome || '(sem nome)';
  return [
    `--${nome}`,
    `--Classic Duels · Card Builder · ${rotuloDoTipo(carta)}`,
    '--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.',
    'local s,id=GetID()',
    'function s.initial_effect(c)',
    ...corpo,
    'end',
    ...funcoes,
    '',
  ].join('\n');
}

// ======================================================= texto e prévia
//
// O texto da carta sai dos MESMOS dados que o Lua. Não é enfeite: é o jeito de
// o admin conferir, lendo português, se o que montou é o que queria — um filtro
// "Nível 3 ou mais" que devia ser "ou menos" aparece aqui antes de aparecer num
// duelo.

const rotuloDe = (pares, k) => pares.find((p) => p[0] === k)?.[1] ?? k;

function faixa(min, max, frente, atras) {
  if (min != null && max != null) return min === max ? `${frente}${min}${atras}` : `${frente}${min} a ${max}${atras}`;
  if (min != null) return `${frente}${min} ou mais${atras}`;
  if (max != null) return `${frente}${max} ou menos${atras}`;
  return '';
}

function textoDoGrupo(f) {
  // Uma carta apontada pelo id, com nome, vira o NOME ENTRE ASPAS — é assim que
  // o texto oficial escreve uma referência a outra carta ("baixe 1 'Legado dos
  // Guerreiros'"), e ele substitui o resto do grupo: ninguém escreve "1 Magia
  // com o código 950000003".
  if (f.codigo != null && f.codigoNome) return `"${f.codigoNome}"`;

  const base = {
    qualquer: temStats(f) ? 'monstro' : 'carta', monstro: 'monstro',
    'monstro-normal': 'monstro Normal', 'monstro-efeito': 'monstro de Efeito',
    magia: 'Magia', armadilha: 'Armadilha',
  }[f.categoria];
  let t = base;
  if (f.raca) t += ` ${RACA.get(f.raca)[1]}`;
  if (f.atributo) t += ` de ${ATRIBUTO.get(f.atributo)[1]}`;
  const nivel = faixa(f.nivelMin, f.nivelMax, 'de Nível ', '');
  if (nivel) t += ` ${nivel}`;
  const com = [faixa(f.atkMin, f.atkMax, '', ' de ATK'), faixa(f.defMin, f.defMax, '', ' de DEF')].filter(Boolean);
  if (f.codigo != null) com.push(`o código ${f.codigo}`);
  if (com.length) t += ` com ${com.join(' e ')}`;
  // "1 Magia que lista 'Dark Magician'" — o `ListsCode` do motor.
  if (f.lista != null) t += ` que lista ${f.listaNome ? `"${f.listaNome}"` : `a carta ${f.lista}`}`;
  return t;
}

const textoDoFiltro = (filtros, padrao) => (filtros.length ? filtros.map(textoDoGrupo).join(', ou ') : padrao);

/** "1 X e 1 Y" — as opções do "1 de cada", ligadas por "e". */
const textoDeCada = (filtros) => {
  const l = filtros.map((f) => `1 ${textoDoGrupo(f)}`);
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : (l[0] ?? '(nada)');
};

function textoDoBonus(ef, comDuracao) {
  const p = [];
  if (ef.atk) p.push(ef.atk > 0 ? `ganha ${ef.atk} de ATK` : `perde ${-ef.atk} de ATK`);
  if (ef.def) p.push(ef.def > 0 ? `ganha ${ef.def} de DEF` : `perde ${-ef.def} de DEF`);
  return p.join(' e ') + (comDuracao && ef.duracao === 'turno' ? ' até o fim do turno' : '');
}

const LADO_TEXTO = { meus: 'que você controla', oponente: 'que o oponente controla', qualquer: 'em campo' };

function textoDaAcao(carta, ef) {
  const q = ef.quantidade;
  const qtd = q > 1 ? `até ${q}` : '1';
  switch (ef.acao) {
    case 'adicionar': {
      if (ef.alvo === 'esta') return 'adicione esta carta à sua mão';
      if (ef.umDeCada) {
        return `adicione ${textoDeCada(ef.filtros)} ${lugarDaBusca(ef.origem).texto.replace(' ou ', ' e/ou ')} à sua mão`;
      }
      const diferentes = ef.tiposDiferentes && ef.atributosDiferentes ? ' de Tipos e Atributos diferentes'
        : ef.tiposDiferentes ? ' de Tipos diferentes'
          : ef.atributosDiferentes ? ' de Atributos diferentes' : '';
      return `adicione ${qtd} ${textoDoFiltro(ef.filtros, 'carta')}${diferentes} ${lugarDaBusca(ef.origem).texto} à sua mão`;
    }
    case 'comprar':
      return `compre ${q} ${q > 1 ? 'cartas' : 'carta'}`;
    case 'reviver':
      if (ef.alvo === 'esta') return 'Invoque esta carta por Invocação-Especial';
      if (ef.umDeCada) return `Invoque por Invocação-Especial ${textoDeCada(ef.filtros)} ${lugarDaInvocacao(ef.origem).texto.replace(' ou ', ' e/ou ')}`;
      return `escolha 1 ${textoDoFiltro(ef.filtros, 'monstro')} ${lugarDaInvocacao(ef.origem).texto} e Invoque-o por Invocação-Especial`;
    case 'destruir': {
      if (ef.alvo === 'esta') return 'destrua esta carta';
      if (ef.alvo === 'gatilho') {
        return ef.filtros.length ? `se esse monstro for ${textoDoFiltro(ef.filtros, 'monstro')}, destrua-o` : 'destrua esse monstro';
      }
      const padrao = { monstro: 'monstro', 'magia-armadilha': 'Magia/Armadilha', qualquer: 'carta' }[ef.zona];
      if (ef.todas) {
        const onde = { meus: 'que você controla', oponente: 'que o oponente controla', qualquer: 'em campo' }[ef.lado];
        const quais = ef.filtros.length ? ` (${textoDoFiltro(ef.filtros, padrao)})` : '';
        return `destrua todas as cartas${quais} ${onde}, exceto esta`;
      }
      if (ef.lado === 'meus') return `escolha ${qtd} ${textoDoFiltro(ef.filtros, padrao)} que você controla e destrua ${q > 1 ? 'essas cartas' : 'essa carta'}`;
      return `escolha ${qtd} ${textoDoFiltro(ef.filtros, padrao)} ${ef.lado === 'qualquer' ? 'em campo' : 'que o oponente controla'} e destrua ${q > 1 ? 'essas cartas' : 'essa carta'}`;
    }
    case 'bonus': {
      if (ef.quando === 'equipado') return `o monstro equipado ${textoDoBonus(ef, false)}`;
      if (ef.alvo === 'esta') return `esta carta ${textoDoBonus(ef, ef.quando !== 'continuo')}`;
      if (ef.alvo === 'gatilho') return `esse monstro ${textoDoBonus(ef, true)}`;
      const quem = textoDoFiltro(ef.filtros, 'monstro');
      if (ef.quando === 'continuo') {
        return `cada ${ehMonstro(carta) ? 'outro ' : ''}${quem} ${LADO_TEXTO[ef.lado]} ${textoDoBonus(ef, false)}`;
      }
      return `escolha 1 ${quem} com a face para cima ${LADO_TEXTO[ef.lado]}; ele ${textoDoBonus(ef, true)}`;
    }
    case 'baixar': {
      const onde = lugarDaBusca(ef.origem).texto;
      const podeAtivar = ef.ativaNoTurno
        ? ` (${q > 1 ? 'elas podem' : 'ela pode'} ser ativada${q > 1 ? 's' : ''} neste turno)` : '';
      return `baixe ${qtd} ${textoDoFiltro(ef.filtros, 'Magia/Armadilha')}${ef.nomesDiferentes ? ' com nomes diferentes' : ''} ${q > 1 ? onde.replace(' ou ', ' e/ou ') : onde}${podeAtivar}`;
    }
    case 'sem-tributo':
      return `cada ${textoDoFiltro(ef.filtros, 'monstro')} na sua mão pode ser Invocado por Invocação-Normal sem oferecer tributos`;
    case 'menos-tributo':
      return `até o fim deste turno, cada ${textoDoFiltro(ef.filtros, 'monstro')} na sua mão pode ser Invocado por Invocação-Normal com ${ef.quantidade} tributo${ef.quantidade > 1 ? 's' : ''} a menos`;
    case 'ganhar-nome': {
      const quem = ef.ganhaNome ? `"${ef.ganhaNome}"` : ef.ganhaCodigo ? `a carta ${ef.ganhaCodigo}` : '(?)';
      return `neste turno, esta carta é tratada como ${quem}`;
    }
    case 'nao-alvo':
      if (ef.alvo === 'esta') return 'esta carta não pode ser alvo de efeitos de cartas do oponente';
      return `cada ${textoDoFiltro(ef.filtros, 'monstro')} ${LADO_TEXTO[ef.lado]} não pode ser alvo de efeitos de cartas do oponente`;
    case 'negar':
      return `negue a ativação${ef.destruirNegada ? ' e destrua essa carta' : ''}`;
    case 'sem-dano':
      return 'todo dano que você sofreria neste turno se torna 0';
    case 'enviar-cemiterio': {
      const padrao = q > 1
        ? { monstro: 'monstros', 'magia-armadilha': 'Magias/Armadilhas', qualquer: 'cartas' }[ef.zona]
        : { monstro: 'monstro', 'magia-armadilha': 'Magia/Armadilha', qualquer: 'carta' }[ef.zona];
      return `escolha ${qtd} ${textoDoFiltro(ef.filtros, padrao)} ${LADO_TEXTO[ef.lado]} e envie ${q > 1 ? 'essas cartas' : 'essa carta'} ao Cemitério`;
    }
    case 'fundir': {
      const quem = ef.fusaoNome ? `"${ef.fusaoNome}"` : ef.fusaoCodigo ? `a carta ${ef.fusaoCodigo}` : '(?)';
      return `Invoque por Invocação-Fusão 1 ${quem} do seu Extra Deck, usando esta carta como material`;
    }
    case 'ataques': {
      const vezes = `pode atacar ${ef.ataques} vezes em cada Battle Phase${ef.duracao === 'turno' ? ' neste turno' : ''}`;
      if (ef.alvo === 'esta') return `esta carta ${vezes}`;
      return `escolha 1 ${textoDoFiltro(ef.filtros, 'monstro')} com a face para cima que você controla; ele ${vezes}`;
    }
    default:
      return '';
  }
}

const TEXTO_DO_CUSTO = {
  'revelar-esta': () => 'revele esta carta',
  'descartar-esta': () => 'descarte esta carta',
  'tributar-esta': () => 'tribute esta carta',
  'banir-esta': () => 'bana esta carta do seu Cemitério',
  'descartar-1': () => 'descarte 1 carta',
  'descartar-filtro': (ef) => `descarte ${ef.custoQtd} ${textoDoFiltro(ef.custoFiltros, ef.custoQtd > 1 ? 'cartas' : 'carta')}`
    + (ef.custoTiposDiferentes ? ' de Tipos diferentes' : ''),
  'enviar-cada': (ef) => `envie ${textoDeCada(ef.custoFiltros)} da sua mão ou Deck ao Cemitério`,
  'pagar-lp': (ef) => `pague ${ef.custoLp} LP`,
};

const maiuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** O texto da caixa de efeito, montado dos dados. */
export function textoDosEfeitos(bruta) {
  const carta = normalizarCarta(bruta);
  const nome = carta.nome || 'esta carta';
  const frases = [];

  if (carta.tipo === 'monstro-fusao') {
    // A linha de materiais das cartas oficiais: "A + 2 B".
    const materiais = carta.fusao.materiais
      .map((m) => `${m.qtd > 1 ? `${m.qtd} ` : ''}${textoDoFiltro(m.filtros, 'monstro')}`)
      .join(' + ');
    if (materiais) frases.push(`${maiuscula(materiais)}.`);
  }
  if (carta.tipo === 'monstro-ritual') {
    frases.push('Só pode ser Invocado por Invocação-Ritual.');
  }
  if (carta.tipo === 'magia' && carta.subtipo === 'ritual') {
    frases.push(`Usada para Invocar por Ritual o monstro ${carta.ritual.codigo ?? '(?)'}. Você também precisa oferecer monstros cujos Níveis somados sejam iguais ou maiores que o Nível dele.`);
  }
  if (carta.tipo === 'magia' && carta.subtipo === 'equipamento') {
    const onde = { meus: 'num monstro que você controla', oponente: 'num monstro que o oponente controla', qualquer: 'em qualquer monstro' }[carta.equipa.lado];
    const quem = carta.equipa.filtros.length ? ` (${textoDoFiltro(carta.equipa.filtros, 'monstro')})` : '';
    frases.push(`Equipe somente ${onde}${quem}.`);
  }

  // A linha entre parênteses das cartas oficiais, e a primeira do texto: ela
  // descreve o que a carta É, antes de qualquer coisa que ela faça.
  if (ehMonstro(carta) && carta.tratadoComoNormal) {
    frases.push('(Esta carta é sempre tratada como um monstro Normal.)');
  }
  if (ehMonstro(carta) && carta.tratadoComo.codigo) {
    const quem = carta.tratadoComo.nome ? `"${carta.tratadoComo.nome}"` : `a carta ${carta.tratadoComo.codigo}`;
    frases.push(`(Esta carta é sempre tratada como ${quem}.)`);
  }
  if (ehMonstro(carta) && carta.arquetipo.setcode) {
    const quem = carta.arquetipo.nome ? `"${carta.arquetipo.nome}"` : `do arquétipo 0x${carta.arquetipo.setcode.toString(16)}`;
    frases.push(`(Esta carta é sempre tratada como um card ${quem}.)`);
  }
  if (ehMonstro(carta) && carta.normalNoCemiterio) {
    frases.push('Enquanto estiver no Cemitério, esta carta é tratada como um monstro Normal.');
  }
  if (ehMonstro(carta) && carta.invocacaoEspecial.ligado) {
    const inv = carta.invocacaoEspecial;
    const exige = inv.destruir
      .map((g) => `1 ${textoDoFiltro(g.filtros, 'carta')} com a face para cima`)
      .join(' e ');
    let frase = 'Você pode Invocar esta carta por Invocação-Especial da sua mão enviando '
      + `1 ${textoDoFiltro(inv.custoFiltros, 'carta')} da sua mão ou Deck ao Cemitério`
      + (exige ? `, se houver ${exige} em campo` : '') + '.';
    if (inv.umaVezPorTurno) frase += ` Você só pode Invocar "${nome}" desta forma uma vez por turno.`;
    frases.push(frase);
    if (exige) frases.push(`Se esta carta for Invocada por Invocação-Especial desta forma: destrua ${exige} em campo (exceto esta carta).`);
  }

  for (const ef of carta.efeitos) {
    const gatilho = {
      mao: 'Durante sua Main Phase, com esta carta na mão: ',
      'mao-rapido': '(Efeito Rápido) Com esta carta na mão: ',
      campo: ehMonstro(carta) ? 'Durante sua Main Phase: ' : 'Enquanto esta carta estiver com a face para cima: ',
      cemiterio: 'Durante sua Main Phase, com esta carta no Cemitério: ',
      invocado: 'Se esta carta for Invocada: ',
      'invocado-especial': 'Se esta carta for Invocada por Invocação-Especial: ',
      'esta-deixou-campo': 'Se esta carta deixar o campo: ',
      'enviado-cemiterio': 'Se esta carta for enviada ao Cemitério: ',
      'saiu-do-campo': `Se um ${textoDoFiltro(ef.gatilhoFiltros, 'monstro')} que você controla deixar o campo por uma carta do oponente: `,
      'esta-saiu-do-campo': 'Se esta carta deixar o campo por uma carta do oponente: ',
      'ativou-cartas': `Se você ativar ${textoDeCada(ef.gatilhoFiltros)} enquanto esta carta estiver no seu Cemitério: `,
      'ataque-oponente': 'Quando um monstro do oponente declarar um ataque: ',
      'invocacao-oponente': 'Quando o oponente Invocar um monstro: ',
      resposta: `Quando o oponente ativar ${ef.respondeA.map((x) => rotuloDe(RESPONDE_A, x)).join(' ou ') || '(nada)'}: `,
    }[ef.quando] ?? '';
    const condicao = ef.condicao === 'controla'
      ? `se você controlar um ${textoDoFiltro(ef.condicaoFiltros, 'monstro')} com a face para cima, `
      : ef.condicao === 'invocado-neste-turno'
        ? `se um ${textoDoFiltro(ef.condicaoFiltros, 'monstro')} seu foi Invocado por Invocação-Especial neste turno, `
        : ef.condicao === 'nada-mais'
          ? `se você não controlar nenhuma outra ${textoDoFiltro(ef.condicaoFiltros, 'carta')}, `
          : '';
    const custo = ef.custo !== 'nenhum' ? `${TEXTO_DO_CUSTO[ef.custo](ef)}; ` : '';
    // Com "e depois", cada passo entra atrás do anterior como o texto oficial
    // escreve: "…; se fizer isso, …". O passo não tem momento próprio.
    // Um passo com condição sobre o anterior vira frase própria, como o texto
    // oficial escreve: "… à sua mão. Se você adicionou 1 X do seu Cemitério por
    // este efeito, você pode …".
    let acoes = textoDaAcao(carta, ef);
    ef.depois.forEach((p, k) => {
      const anterior = k === 0 ? ef : ef.depois[k - 1];
      let t = textoDaAcao(carta, { ...p, quando: '' });
      if (p.opcional) t = `se quiser, ${t}`;
      if (p.seFiltros.length) {
        const verbo = anterior.acao === 'reviver' ? 'Invocou' : 'adicionou';
        acoes += `. Se você ${verbo} 1 ${textoDoFiltro(p.seFiltros, 'carta')}${p.seDoCemiterio ? ' do seu Cemitério' : ''} por este efeito, ${t}`;
      } else {
        acoes += `; se fizer isso, ${t}`;
      }
    });
    let frase = `${maiuscula(gatilho + condicao + custo + acoes)}.`;
    if (ef.limite === 'por-nome' || ef.limite === 'por-efeito') frase += ` Você só pode usar este efeito de "${nome}" uma vez por turno.`;
    if (ef.limite === 'por-copia') frase += ' Uma vez por turno.';
    frases.push(frase);
  }
  return frases.join(' ');
}

/**
 * A linha que o `cards.cdb` teria (`datas`) — o que o `CardReaderCallback`
 * do motor precisa saber de uma carta além do Lua.
 */
export function dadosDoMotor(bruta) {
  const c = normalizarCarta(bruta);
  const B = BITS_DE_TIPO;
  const m = ehMonstro(c);
  let type;
  if (c.tipo === 'monstro-normal') type = B.TYPE_MONSTER | B.TYPE_NORMAL;
  else if (c.tipo === 'monstro-efeito') type = B.TYPE_MONSTER | B.TYPE_EFFECT;
  else if (ehFusaoOuRitual(c)) {
    // Sem este ramo a Fusão caía no `else` de magia/armadilha e saía com
    // type 4 — o motor a leria como ARMADILHA.
    type = B.TYPE_MONSTER | (c.tipo === 'monstro-fusao' ? B.TYPE_FUSION : B.TYPE_RITUAL);
    if (c.efeitos.length) type |= B.TYPE_EFFECT;
  }
  else {
    type = c.tipo === 'magia' ? B.TYPE_SPELL : B.TYPE_TRAP;
    type |= {
      rapida: B.TYPE_QUICKPLAY, continua: B.TYPE_CONTINUOUS, equipamento: B.TYPE_EQUIP,
      campo: B.TYPE_FIELD, ritual: B.TYPE_RITUAL, contra: B.TYPE_COUNTER,
    }[c.subtipo] ?? 0;
  }
  // "Sempre tratado como um monstro Normal": o BIT, e não um efeito. Com ele
  // `c:IsType(TYPE_NORMAL)` é verdade em qualquer zona, o que é exatamente o que
  // "sempre" quer dizer — e é o que faz a própria carta casar com os filtros de
  // "monstro Normal" que ela mesma escreve. O `TYPE_EFFECT` continua: ela TEM
  // efeito, e sem ele o motor não rodaria o script dela.
  if (m && c.tratadoComoNormal) type |= B.TYPE_NORMAL;

  return {
    id: c.id, alias: 0, setcode: 0, type,
    level: m ? c.nivel : 0,
    attribute: m ? ATRIBUTO.get(c.atributo)[3] : 0,
    race: m ? RACA.get(c.raca)[3] : 0,
    atk: m ? c.atk : 0,
    def: m ? c.def : 0,
  };
}

/** Os campos que `renderFramedCard` (customcards.js) sabe desenhar. */
export function camposDaPrevia(bruta) {
  const c = normalizarCarta(bruta);
  const m = ehMonstro(c);
  return {
    name: c.nome,
    cat: m ? 'Monster' : c.tipo === 'magia' ? 'Spell' : 'Trap',
    // A "espécie" que a moldura desenhada (cor) e o índice (`tl` → Extra Deck) leem.
    kind: m ? ({ 'monstro-normal': 'Normal', 'monstro-fusao': 'Fusion', 'monstro-ritual': 'Ritual' }[c.tipo] ?? 'Effect') : null,
    subtype: m ? null : SUBTIPO_EN[c.subtipo],
    attribute: m ? c.atributo : null,
    race: m ? RACA.get(c.raca)[1] : null,
    level: m ? c.nivel : null,
    atk: m ? c.atk : null,
    def: m ? c.def : null,
    desc: c.texto || textoDosEfeitos(c),
  };
}

/**
 * A entrada no formato do índice de cartas (`ygodb.addCustom`), a mesma forma
 * que `customcards.buildCard` produz — para o dia em que o Deck Builder listar
 * as cartas do builder. `tl` sai de `buildTypeLabel`, que é quem o resto do
 * sistema (`isExtraDeck`) já sabe ler.
 */
export function entradaDoIndice(bruta, arteDesenhada = null) {
  const c = normalizarCarta(bruta);
  const p = camposDaPrevia(c);
  return {
    id: c.id,
    name: c.nome,
    t: p.cat === 'Monster' ? 'M' : p.cat === 'Spell' ? 'S' : 'T',
    tl: buildTypeLabel(p.cat, { kind: p.kind, subtype: p.subtype }),
    at: p.cat === 'Monster' ? c.atributo : null,
    r: p.cat === 'Monster' ? c.raca : p.subtype,
    lv: p.level,
    atk: p.atk,
    def: p.def,
    // O arquétipo pelo NOME, como o índice guarda — é o que o filtro "arquétipo"
    // do Deck Builder e da Banlist lê.
    a: c.arquetipo.setcode && c.arquetipo.nome ? [c.arquetipo.nome] : [],
    desc: p.desc,
    tags: ['custom', 'card-builder'],
    art: arteDesenhada,
    custom: true,
  };
}

// ================================================== import do card maker

/**
 * O TEXTO do card maker com as quebras de linha: cada "●" de efeito começa numa
 * linha própria, e o `strip` do import do Deck Builder junta tudo numa só.
 */
function textoDoCardmaker(ef) {
  return String(ef ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200);
}

/**
 * Um JSON do **card maker** como carta NOVA do Card Builder: nome, tipo e
 * subtipo, os números do monstro e o texto. Os EFEITOS não saem dele — o card
 * maker desenha a carta e não conhece regra nenhuma —, então ela vem com os
 * efeitos mínimos do tipo, para o admin montar no passo 3. A arte (`ad`) fica
 * com a tela, que a reduz antes de subir.
 */
export function cartaDoCardmaker(json) {
  const { draft } = parseCardmaker(json && typeof json === 'object' ? json : {});
  const bruta = { ...novaCarta(), nome: draft.name, texto: textoDoCardmaker(json?.ef), efeitos: [] };
  if (draft.cat === 'Spell' || draft.cat === 'Trap') {
    bruta.tipo = draft.cat === 'Spell' ? 'magia' : 'armadilha';
    bruta.subtipo = Object.keys(SUBTIPO_EN).find((k) => SUBTIPO_EN[k] === draft.subtype) ?? 'normal';
  } else {
    bruta.tipo = { Normal: 'monstro-normal', Fusion: 'monstro-fusao', Ritual: 'monstro-ritual' }[draft.kind] ?? 'monstro-efeito';
    Object.assign(bruta, { atributo: draft.attribute, raca: draft.race, nivel: draft.level, atk: draft.atk, def: draft.def });
  }
  const carta = normalizarCarta(bruta);
  const { min } = limiteDeEfeitos(carta);
  while (carta.efeitos.length < min) carta.efeitos.push(novoEfeito(carta));
  return carta;
}
