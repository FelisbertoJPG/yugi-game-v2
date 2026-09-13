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
  campo: 'no campo (Main Phase)',
  cemiterio: 'do Cemitério (Main Phase)',
  invocado: 'ao ser Invocado',
  'enviado-cemiterio': 'ao ser enviado ao Cemitério',
  continuo: 'contínuo (enquanto estiver em campo)',
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
};

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
  baixar: [['deck', 'do Deck'], ['cemiterio', 'do Cemitério'], ['deck-cemiterio', 'do Deck e/ou do Cemitério']],
  reviver: [
    ['cemiterio-meu', 'do seu Cemitério'], ['cemiterio-ambos', 'de qualquer Cemitério'],
    ['mao', 'da sua mão'], ['deck', 'do seu Deck'],
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
};
const lugarDaBusca = (origem) => LUGAR_DA_BUSCA[origem] ?? LUGAR_DA_BUSCA.deck;

export const LADOS = {
  destruir: [['oponente', 'do oponente'], ['qualquer', 'de qualquer lado']],
  bonus: [['meus', 'seus monstros'], ['oponente', 'monstros do oponente'], ['qualquer', 'qualquer monstro']],
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
    return ['mao', 'campo', 'cemiterio', 'invocado', 'enviado-cemiterio', 'continuo'];
  }
  // A Fusão mora no Extra Deck: não existe "com esta carta na mão" para ela.
  if (carta.tipo === 'monstro-fusao') return ['campo', 'cemiterio', 'invocado', 'enviado-cemiterio', 'continuo'];
  if (carta.tipo === 'magia') {
    if (s === 'normal' || s === 'rapida') return ['ativacao'];
    if (s === 'continua' || s === 'campo') return ['ativacao', 'campo', 'continuo'];
    if (s === 'equipamento') return ['equipado'];
    return [];                                              // ritual: sem efeitos, só o procedimento
  }
  if (carta.tipo === 'armadilha') {
    if (s === 'normal') return ['ativacao', 'ataque-oponente', 'invocacao-oponente'];
    if (s === 'continua') return ['ativacao', 'campo', 'continuo'];
    if (s === 'contra') return ['resposta'];
  }
  return [];                                                // monstro normal: vanilla
}

/** Quantos efeitos o tipo aceita. Magia Normal É o seu efeito: exatamente um. */
export function limiteDeEfeitos(carta) {
  const s = carta.subtipo;
  if (carta.tipo === 'monstro-normal') return { min: 0, max: 0 };
  if (carta.tipo === 'monstro-efeito') return { min: 1, max: 4 };
  // Fusão e Ritual valem só pelo corpo (a Fusão "normal" de dois materiais) ou
  // com efeito — o tipo já os distingue do Monstro Normal.
  if (ehFusaoOuRitual(carta)) return { min: 0, max: 4 };
  if (carta.tipo === 'magia') {
    if (s === 'normal' || s === 'rapida') return { min: 1, max: 1 };
    if (s === 'ritual') return { min: 0, max: 0 };
    if (s === 'equipamento') return { min: 1, max: 1 };
    return { min: 1, max: 4 };
  }
  if (s === 'continua') return { min: 1, max: 4 };
  return { min: 1, max: 1 };
}

export function acoesPermitidas(carta, quando) {
  if (quando === 'equipado') return ['bonus'];
  // A Invocação sem tributo é um efeito que VALE enquanto a carta está em campo
  // (o `EFFECT_SUMMON_PROC` de campo do Metaphys Factor oficial): só no contínuo.
  if (quando === 'continuo') return ['bonus', 'sem-tributo'];
  if (quando === 'resposta') return ['negar'];
  return ['adicionar', 'comprar', 'reviver', 'destruir', 'bonus', 'ataques', 'baixar'];
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

/** As ações de um passo do "e depois" — as mesmas do efeito, menos a negação. */
export const acoesDoPasso = () => ['adicionar', 'comprar', 'reviver', 'destruir', 'bonus', 'ataques', 'baixar'];

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
    case 'baixar':
      return ['outra'];
    case 'adicionar':
      return monstro && (quando === 'cemiterio' || quando === 'enviado-cemiterio') ? ['outra', 'esta'] : ['outra'];
    case 'reviver':
      return monstro && ['mao', 'cemiterio', 'enviado-cemiterio'].includes(quando) ? ['outra', 'esta'] : ['outra'];
    case 'destruir': {
      const l = ['outra'];
      if (gatilho) l.push('gatilho');
      if ((monstro && (quando === 'campo' || quando === 'invocado')) || (!monstro && quando === 'campo')) l.push('esta');
      return l;
    }
    case 'bonus': {
      if (quando === 'equipado') return ['equipado'];
      const l = ['outra'];
      if (gatilho) l.push('gatilho');
      if (monstro && ['campo', 'invocado', 'continuo'].includes(quando)) l.push('esta');
      return l;
    }
    case 'ataques':
      // "Esta carta pode atacar mais vezes" só com ela EM CAMPO; da mão, é o
      // "e depois" de uma Invocação que dá os ataques a ela.
      return monstro && (quando === 'campo' || quando === 'invocado') ? ['esta', 'outra'] : ['outra'];
    default:
      return [];                                            // comprar e negar não têm alvo
  }
}

export function custosPermitidos(carta, quando) {
  if (quando === 'continuo' || quando === 'equipado') return ['nenhum'];
  const l = ['nenhum'];
  if (quando === 'mao') l.push('revelar-esta', 'descartar-esta');
  if (quando === 'campo' && ehMonstro(carta)) l.push('tributar-esta');
  if (quando === 'cemiterio') l.push('banir-esta');
  l.push('descartar-1', 'descartar-filtro', 'pagar-lp');
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
    codigo: null,
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
  p.acao = escolha(b.acao, acoesDoPasso());
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
  p.filtros = (Array.isArray(b.filtros) ? b.filtros : []).slice(0, 6).map(normalizarFiltro);
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
  return p;
}

function problemasDoEfeito(carta, ef) {
  const p = [];
  if (ef.acao === 'bonus' && ef.atk === 0 && ef.def === 0) p.push('o bônus precisa mudar o ATK ou a DEF');
  if (ef.acao === 'negar' && !ef.respondeA.length) p.push('escolha a que a Contra-Armadilha responde');

  if (ef.acao === 'sem-tributo') {
    ef.filtros.forEach((f, i) => {
      const onde = ef.filtros.length > 1 ? `opção ${i + 1}: ` : '';
      for (const t of problemasDoFiltro(f, { soMonstro: true })) p.push(onde + t);
      // Nível 4 ou menos já se Invoca sem tributo: a opção nunca mudaria nada.
      if (f.nivelMax != null && f.nivelMax < 5) p.push(`${onde}monstro de Nível 4 ou menos já é Invocado sem tributo`);
    });
  }
  if (ef.condicao === 'controla') {
    ef.condicaoFiltros.forEach((f, i) => {
      for (const t of problemasDoFiltro(f, { soMonstro: true })) p.push(`condição, opção ${i + 1}: ${t}`);
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
  if (passo.acao === 'bonus' && passo.atk === 0 && passo.def === 0) p.push('o bônus precisa mudar o ATK ou a DEF');
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
  if (carta.efeitos.filter((e) => e.quando === 'ativacao').length > 1) {
    card('só um efeito pode ser o da ativação da carta');
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
      const MEU = qualquerLado ? LOC : '0';
      out.flags.push('EFFECT_FLAG_CARD_TARGET');
      // Face para baixo não tem ATK para ler: com filtro de stats, só face para cima.
      f.push(`function s.filtro${n}(c)`,
        `${T(1)}return ${expressao(ef.filtros, { exigeMonstro: ef.zona === 'monstro', faceUp: true })}`,
        'end',
        cabecaAlvo(n, true),
        `${T(1)}if chkc then return chkc:IsLocation(${LOC})${qualquerLado ? '' : ' and chkc:IsControler(1-tp)'} and s.filtro${n}(chkc) end`,
        `${T(1)}if chk==0 then return Duel.IsExistingTarget(s.filtro${n},tp,${MEU},${LOC},1,e:GetHandler()) end`,
        `${T(1)}Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)`,
        `${T(1)}local g=Duel.SelectTarget(tp,s.filtro${n},tp,${MEU},${LOC},1,${ef.quantidade},e:GetHandler())`,
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
        `${T(1)}if #sg>0 then Duel.SSet(tp,sg) end`,
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

const emSequencia = (ef) => ef.acao === 'ataques' || (ef.depois?.length ?? 0) > 0;

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
  const l = [
    `local ft=math.min(${p.quantidade},Duel.GetLocationCount(tp,LOCATION_SZONE))`,
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

/** "Nenhuma carta com este nome já foi escolhida" — o filtro do "de nomes diferentes". */
function funcaoNomeLivre(nome) {
  return [
    `function ${nome}(c,sg)`,
    `${T(1)}return not sg:IsExists(Card.IsCode,1,nil,c:GetCode())`,
    'end',
  ];
}

function passoDaSequencia(carta, p, n, k, quando) {
  const nome = `s.passo${n}_${k}`;
  const filtro = `s.filtro${n}_${k}`;
  const fn = [];
  const cat = [];
  let pode = 'true';
  let info = null;
  let corpo = [];
  const reset = p.duracao === 'turno' ? 'RESETS_STANDARD_PHASE_END' : 'RESET_EVENT|RESETS_STANDARD';

  switch (p.acao) {
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
        'return #g>0 and Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0',
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
          'Duel.ConfirmCards(1-tp,sg)',
          'return true',
        ]
        : [
          'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)',
          `local g=Duel.SelectMatchingCard(tp,${filtro},tp,${LOC},0,1,${p.quantidade},${EXCL})`,
          'if #g==0 or Duel.SendtoHand(g,nil,REASON_EFFECT)==0 then return false end',
          'Duel.ConfirmCards(1-tp,g)',
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
        'return #sg>0 and Duel.SSet(tp,sg)>0',
      ];
      break;
    }

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
      const MEU = p.lado === 'qualquer' ? LOC : '0';
      fn.push(`function ${filtro}(c)`,
        `${T(1)}return ${expressao(p.filtros, { exigeMonstro: p.zona === 'monstro', faceUp: true })}`, 'end');
      pode = `Duel.IsExistingMatchingCard(${filtro},tp,${MEU},${LOC},1,e:GetHandler())`;
      info = `Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,1,0,${LOC})`;
      corpo = [
        'Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)',
        `local g=Duel.SelectMatchingCard(tp,${filtro},tp,${MEU},${LOC},1,${p.quantidade},e:GetHandler())`,
        'if #g==0 then return false end',
        'return Duel.Destroy(g,REASON_EFFECT)>0',
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
  return { nome, fn, cat, pode, info, corpo };
}

/** A ação de um efeito em SEQUÊNCIA — a mesma forma que `acao()` devolve. */
function acaoEmSequencia(carta, ef, n) {
  const passos = [ef, ...ef.depois].map((p, i) => passoDaSequencia(carta, p, n, i + 1, ef.quando));
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

const CUSTO_LUA = {
  'revelar-esta': () => 'Cost.SelfReveal',
  'descartar-esta': () => 'Cost.SelfDiscard',
  'tributar-esta': () => 'Cost.SelfTribute',
  'banir-esta': () => 'Cost.SelfBanish',
  'descartar-1': () => 'Cost.Discard(nil,true,1)',
  'descartar-filtro': (ef, n) => `s.custo${n}`,
  'pagar-lp': (ef) => `Cost.PayLP(${ef.custoLp})`,
};

/**
 * "Se você controlar um monstro … com a face para cima": a condição do efeito.
 * Com uma condição que o MOMENTO já trazia (ataque, Invocação do oponente, a
 * negação), a antiga vira `s.condicaobaseN` e a nova exige as duas — trocar uma
 * pela outra faria a Armadilha de ataque ativar sem ataque nenhum, calada.
 */
function condicaoDeControlar(ef, n, base) {
  const filtro = `s.condfiltro${n}`;
  const existe = `Duel.IsExistingMatchingCard(${filtro},tp,LOCATION_MZONE,0,1,nil)`;
  const cabeca = `function s.condicao${n}(e,tp,eg,ep,ev,re,r,rp)`;
  const linhas = [
    `function ${filtro}(c)`,
    `${T(1)}return c:IsFaceup() and (${expressao(ef.condicaoFiltros, { exigeMonstro: true })})`,
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
  const flags = [...a.flags];
  let tipo; let codigo = null; let range = null; let condicao = a.condicao;
  let clone = null;
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
    case 'enviado-cemiterio':
      tipo = 'EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O'; codigo = 'EVENT_TO_GRAVE';
      flags.push('EFFECT_FLAG_DELAY');
      break;
    default: tipo = 'EFFECT_TYPE_ACTIVATE'; codigo = 'EVENT_FREE_CHAIN';
  }

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
  if (ef.condicao === 'controla') condicao = condicaoDeControlar(ef, n, condicao);
  if (condicao) corpo.push(`${T(1)}${v}:SetCondition(s.condicao${n})`);
  if (ef.custo !== 'nenhum') corpo.push(`${T(1)}${v}:SetCost(${CUSTO_LUA[ef.custo](ef, n)})`);
  if (a.temAlvo) corpo.push(`${T(1)}${v}:SetTarget(s.alvo${n})`);
  corpo.push(`${T(1)}${v}:SetOperation(s.operacao${n})`, `${T(1)}c:RegisterEffect(${v})`);
  if (clone) {
    corpo.push(`${T(1)}local ${v}b=${v}:Clone()`, `${T(1)}${v}b:SetCode(${clone})`, `${T(1)}c:RegisterEffect(${v}b)`);
  }
  return { corpo, funcoes: [...(condicao ?? []), ...a.funcoes] };
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
  return t;
}

const textoDoFiltro = (filtros, padrao) => (filtros.length ? filtros.map(textoDoGrupo).join(', ou ') : padrao);

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
      const diferentes = ef.tiposDiferentes && ef.atributosDiferentes ? ' de Tipos e Atributos diferentes'
        : ef.tiposDiferentes ? ' de Tipos diferentes'
          : ef.atributosDiferentes ? ' de Atributos diferentes' : '';
      return `adicione ${qtd} ${textoDoFiltro(ef.filtros, 'carta')}${diferentes} ${lugarDaBusca(ef.origem).texto} à sua mão`;
    }
    case 'comprar':
      return `compre ${q} ${q > 1 ? 'cartas' : 'carta'}`;
    case 'reviver':
      if (ef.alvo === 'esta') return 'Invoque esta carta por Invocação-Especial';
      return `escolha 1 ${textoDoFiltro(ef.filtros, 'monstro')} ${lugarDaInvocacao(ef.origem).texto} e Invoque-o por Invocação-Especial`;
    case 'destruir': {
      if (ef.alvo === 'esta') return 'destrua esta carta';
      if (ef.alvo === 'gatilho') {
        return ef.filtros.length ? `se esse monstro for ${textoDoFiltro(ef.filtros, 'monstro')}, destrua-o` : 'destrua esse monstro';
      }
      const padrao = { monstro: 'monstro', 'magia-armadilha': 'Magia/Armadilha', qualquer: 'carta' }[ef.zona];
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
      return `baixe ${qtd} ${textoDoFiltro(ef.filtros, 'Magia/Armadilha')}${ef.nomesDiferentes ? ' com nomes diferentes' : ''} ${q > 1 ? onde.replace(' ou ', ' e/ou ') : onde}`;
    }
    case 'sem-tributo':
      return `cada ${textoDoFiltro(ef.filtros, 'monstro')} na sua mão pode ser Invocado por Invocação-Normal sem oferecer tributos`;
    case 'negar':
      return `negue a ativação${ef.destruirNegada ? ' e destrua essa carta' : ''}`;
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

  for (const ef of carta.efeitos) {
    const gatilho = {
      mao: 'Durante sua Main Phase, com esta carta na mão: ',
      campo: ehMonstro(carta) ? 'Durante sua Main Phase: ' : 'Enquanto esta carta estiver com a face para cima: ',
      cemiterio: 'Durante sua Main Phase, com esta carta no Cemitério: ',
      invocado: 'Se esta carta for Invocada: ',
      'enviado-cemiterio': 'Se esta carta for enviada ao Cemitério: ',
      'ataque-oponente': 'Quando um monstro do oponente declarar um ataque: ',
      'invocacao-oponente': 'Quando o oponente Invocar um monstro: ',
      resposta: `Quando o oponente ativar ${ef.respondeA.map((x) => rotuloDe(RESPONDE_A, x)).join(' ou ') || '(nada)'}: `,
    }[ef.quando] ?? '';
    const condicao = ef.condicao === 'controla'
      ? `se você controlar um ${textoDoFiltro(ef.condicaoFiltros, 'monstro')} com a face para cima, ` : '';
    const custo = ef.custo !== 'nenhum' ? `${TEXTO_DO_CUSTO[ef.custo](ef)}; ` : '';
    // Com "e depois", cada passo entra atrás do anterior como o texto oficial
    // escreve: "…; se fizer isso, …". O passo não tem momento próprio.
    const acoes = [ef, ...ef.depois]
      .map((p) => textoDaAcao(carta, p === ef ? ef : { ...p, quando: '' }))
      .join('; se fizer isso, ');
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
    a: [],
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
