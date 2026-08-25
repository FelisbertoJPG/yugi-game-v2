/**
 * **O que cada adversário larga ao ser derrotado.**
 *
 * Até aqui vencer um NPC dava DP + a carta de ASSINATURA dele: sempre a mesma,
 * todas as vezes. Vencer o Yugi pela décima vez entregava a décima cópia da
 * mesma carta — o contrário do que faz querer duelar de novo.
 *
 * Agora cada NPC tem um POOL dividido POR RARIDADE e uma QUANTIDADE de drops
 * por vitória. O sorteio é o mesmo do booster: primeiro a raridade (pelos pesos
 * de `DROP_ODDS`, renormalizados entre as raridades que o pool REALMENTE tem —
 * senão um pool só de N nunca daria carta), depois uma carta dentro dela.
 *
 *     { "yugi": { quantidade: 3,
 *                 pool: { UR: [...], SR: [...], R: [...], N: [...] } } }
 *
 * **Quem sorteia é o SERVIDOR** (`premiar_vitoria`, migrations 0027/0028).
 * Este módulo é a configuração e a CONTA das chances que a tela mostra —
 * sortear aqui seria deixar o jogador escolher o próprio prêmio, já que o duelo
 * roda na máquina dele.
 *
 * A raridade de cada carta não é escolhida à mão: ela vem dos boosters, que já
 * são a fonte da verdade de raridade no jogo (`reprintsOf`, e no servidor
 * `raridade_da_carta`). Carta que não está em booster nenhum é N.
 */

// Relativo, e não `/web/js/...`: assim o módulo carrega igual no navegador e no
// Node, que é o que permite o `drops.test.mjs` existir. Caminho absoluto é para
// o que o HTML importa.
import { pullFile, pushFile, aoGravar } from './projectstore.js';

const ARQUIVO = 'npc-drops';

/** As mesmas quatro do booster, da mais alta para a mais baixa. */
export const RARIDADES = ['UR', 'SR', 'R', 'N'];

/** Teto por vitória. O MESMO número está no servidor, que é quem manda. */
export const MAX_DROPS = 20;

/**
 * Peso de cada raridade no sorteio do drop, em pontos percentuais.
 *
 * NÃO são os `PACK_ODDS` do booster (4 UR em 1000). Lá o jogador abre dezenas
 * de pacotes e a raridade extrema é o que dá graça; aqui ele ganha 1 a 3 cartas
 * por duelo, e uma UR a 0,4% simplesmente nunca apareceria — a raridade
 * deixaria de ser rara para ser inexistente. Estes números dão à UR o peso de
 * "acontece de vez em quando", que é o que se quer de um prêmio de vitória.
 */
export const DROP_ODDS = { UR: 4, SR: 14, R: 30, N: 52 };

/**
 * A chance de um ÍCONE por vitória, em % inteiros de 0 a 100.
 *
 * O ícone não entra nas gavetas de raridade das cartas, e a razão é dupla:
 * carta repete e ícone não (a segunda cópia de uma rara é o jogo funcionando; o
 * mesmo ícone duas vezes é um prêmio vazio), e as gavetas já significam a % que
 * a tela promete — um ícone dentro da gaveta UR mudaria essa conta sem mudar o
 * texto, e a tela passaria a mentir sem ninguém mexer nela.
 *
 * O MESMO teto e o mesmo arredondamento estão no servidor, que é quem sorteia
 * (`premiar_vitoria`, migration 0038).
 */
export function chanceDoIcone(bruto) {
  const n = Number(bruto);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

/** Pool vazio, com as quatro gavetas. */
export const poolVazio = () => ({ UR: [], SR: [], R: [], N: [] });

/**
 * Põe uma configuração em forma. Aceita lixo de propósito: este arquivo é
 * editado por gente, e um id repetido ou um texto no lugar do número não pode
 * derrubar a tela de recompensa de ninguém.
 *
 *   • ids viram número, sem repetir DENTRO da raridade nem entre elas (a mesma
 *     carta em duas gavetas viciaria a chance dela);
 *   • quantidade fica entre 0 e MAX_DROPS;
 *   • NPC sem carta nenhuma ou com quantidade 0 não entra no resultado — é o
 *     mesmo que não ter configuração, e é o que faz o servidor cair no
 *     comportamento antigo (a carta de assinatura).
 *
 * Aceita também o formato ANTIGO (`pool` como lista simples): as cartas caem em
 * N, que é onde o servidor já colocava quem não está em booster nenhum.
 */
function normalizarUm(cfg) {
  if (typeof cfg !== 'object' || cfg == null) return null;

  const pool = poolVazio();
  const vistos = new Set();
  const guardar = (raridade, lista) => {
    for (const c of Array.isArray(lista) ? lista : []) {
      const n = Number(c);
      if (!Number.isInteger(n) || n <= 0 || vistos.has(n)) continue;
      vistos.add(n);
      pool[raridade].push(n);
    }
  };

  if (Array.isArray(cfg.pool)) guardar('N', cfg.pool);          // formato antigo
  else for (const r of RARIDADES) guardar(r, cfg.pool?.[r]);

  let qtd = Number(cfg.quantidade);
  if (!Number.isFinite(qtd)) qtd = 0;
  qtd = Math.max(0, Math.min(MAX_DROPS, Math.trunc(qtd)));

  // Os ÍCONES são um prêmio à parte, com chance própria — não entram nas
  // gavetas de carta. O porquê está em `chanceDoIcone` e na migration 0038.
  const icones = [];
  const jaVi = new Set();
  for (const bruto of Array.isArray(cfg.icones) ? cfg.icones : []) {
    // TEM de ser texto. Um `0` ou um `false` vindos de um JSON torto viram
    // "0" e "false" no `String()`, e os dois casam com o formato de slug —
    // entrariam como ids legítimos de ícones que não existem.
    if (typeof bruto !== 'string') continue;
    const id = bruto.trim();
    // O mesmo formato do `check` da coluna `icones.id`: um id que o banco
    // recusaria não pode ficar guardado aqui parecendo configuração boa.
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id) || jaVi.has(id)) continue;
    jaVi.add(id);
    icones.push(id);
  }
  const chance = chanceDoIcone(cfg.chanceIcone);

  // Sem carta E sem ícone não há prêmio nenhum: some da configuração, como já
  // acontecia com o pool vazio.
  const semCarta = !vistos.size || qtd <= 0;
  const semIcone = !icones.length || chance <= 0;
  if (semCarta && semIcone) return null;

  return {
    quantidade: semCarta ? 0 : qtd,
    pool,
    ...(semIcone ? {} : { icones, chanceIcone: chance }),
  };
}

export function normalizarDrops(bruto) {
  const saida = {};
  for (const [id, cfg] of Object.entries(bruto ?? {})) {
    if (!id || typeof cfg !== 'object' || cfg == null) continue;

    // O pool do NPC INTEIRO. Continua existindo por dois motivos: é o que as
    // configurações feitas antes dos drops por deck já têm gravado, e é a
    // reserva de todo deck que não ganhou pool próprio — sem ela, criar um
    // segundo deck faria o adversário parar de dropar no primeiro.
    const base = normalizarUm(cfg);

    // O pool de cada DECK, por NOME (a mesma chave do deck ativo e do `#libera`
    // — índice trocaria de significado quando um deck novo entrasse).
    const decks = {};
    const crus = (typeof cfg.decks === 'object' && cfg.decks != null) ? cfg.decks : {};
    for (const [nome, sub] of Object.entries(crus)) {
      const limpo = String(nome ?? '').trim();
      if (!limpo) continue;
      const n = normalizarUm(sub);
      if (n) decks[limpo] = n;
    }

    const temDecks = Object.keys(decks).length > 0;
    if (!base && !temDecks) continue;

    saida[id] = { ...(base ?? {}), ...(temDecks ? { decks } : {}) };
  }
  return saida;
}

/** Quantas cartas o pool tem no total. */
export function totalDoPool(pool) {
  return RARIDADES.reduce((n, r) => n + (pool?.[r]?.length ?? 0), 0);
}

/**
 * **Definir rápido**: o que entra no pool quando o admin manda preencher a
 * partir do DECK que ele está editando.
 *
 * A pergunta que isto responde é "quais cartas DESTE deck já têm raridade, e em
 * que gaveta cada uma cai" — montar isso à mão é clicar carta por carta num
 * deck de 40 a 60, e o pool de drop quase sempre quer justamente as cartas do
 * próprio deck.
 *
 * Três regras, e todas as três erram CALADAS se estiverem sozinhas na tela:
 *
 *   • **carta sem raridade fica de fora.** Quem decide a raridade é o booster
 *     (`rarityOf`, a mesma fonte da Loja e do `raridade_da_carta` no servidor);
 *     carta que não está em booster nenhum não tem raridade nenhuma. Jogá-la em
 *     N "para não perder" despejaria o deck inteiro no pool — o contrário do
 *     que o botão promete, e sem aviso, porque um pool cheio parece certo.
 *   • **carta que já está no pool não se mexe.** Ela pode ter sido posta à mão
 *     numa gaveta diferente da do booster, o que é uma decisão deliberada (é o
 *     que deixa um adversário largar uma Normal como prêmio raro). Um preenchi-
 *     mento automático que reescreve isso desfaz trabalho sem dizer nada.
 *   • **cópia repetida conta uma vez.** Três cópias no deck não são três
 *     entradas no pool: o sorteio é uniforme dentro da gaveta, então a carta
 *     repetida roubaria a chance das outras.
 *
 * Puro de propósito — quem sabe de raridade é o `boosters.js`, que fala com o
 * `localStorage` e não roda em Node. A raridade entra como função, e é por isso
 * que isto tem teste.
 *
 * @param {number[]} cartas  os ids do deck (main + extra), com repetição
 * @param {object} pool      o pool atual, para não repisar o que já está lá
 * @param {(id:number)=>string|null} raridadeDe  a raridade nos boosters, ou null
 * @returns {{novas:object, total:number, jaNoPool:number[], semRaridade:number[]}}
 */
export function planoRapido(cartas, pool, raridadeDe) {
  const novas = poolVazio();
  const jaNoPool = [];
  const semRaridade = [];
  const vistos = new Set();

  const noPool = new Set();
  for (const r of RARIDADES) for (const id of pool?.[r] ?? []) noPool.add(Number(id));

  for (const bruto of Array.isArray(cartas) ? cartas : []) {
    const id = Number(bruto);
    if (!Number.isInteger(id) || id <= 0 || vistos.has(id)) continue;
    vistos.add(id);

    if (noPool.has(id)) { jaNoPool.push(id); continue; }

    const r = raridadeDe?.(id) ?? null;
    if (!RARIDADES.includes(r)) { semRaridade.push(id); continue; }

    novas[r].push(id);
  }

  return { novas, total: totalDoPool(novas), jaNoPool, semRaridade };
}

/**
 * **A chance real de cada raridade**, em %, já renormalizada entre as que têm
 * carta. É o número que a tela mostra — e é o mesmo que o servidor usa para
 * sortear, por isso a conta mora aqui e não num texto solto na tela.
 *
 * Raridade sem carta vale 0: não adianta prometer 4% de UR num pool que não
 * tem nenhuma UR.
 */
export function chancesDe(pool) {
  const comCarta = RARIDADES.filter((r) => (pool?.[r]?.length ?? 0) > 0);
  const total = comCarta.reduce((s, r) => s + DROP_ODDS[r], 0);
  const out = { UR: 0, SR: 0, R: 0, N: 0 };
  if (!total) return out;
  for (const r of comCarta) out[r] = Math.round((DROP_ODDS[r] / total) * 1000) / 10;
  return out;
}

/**
 * A configuração do NPC INTEIRO — a reserva, válida para todo deck que não tem
 * pool próprio. `null` quando ele não tem drop de NPC configurado (o que hoje
 * pode significar apenas que tudo dele é por deck).
 */
export function dropsDoNpc(cfg, npcId) {
  const n = normalizarDrops(cfg)[String(npcId ?? '')] ?? null;
  if (!n || !Number.isFinite(n.quantidade)) return null;
  return { quantidade: n.quantidade, pool: n.pool };
}

/**
 * **A configuração que vale para um DUELO**: o pool do deck escolhido, caindo
 * no pool do NPC quando aquele deck não tem um.
 *
 * É por deck porque é isso que dá sentido a destrancar o deck difícil: se o
 * prêmio fosse o mesmo, escolher o caminho mais duro não teria motivo. A
 * reserva por NPC existe para o outro lado — quem já tinha um pool montado
 * antes disto não perde nada, e um deck novo nasce dropando.
 *
 * A MESMA resolução roda no servidor (`premiar_vitoria`), que é quem sorteia.
 *
 * > **Devolve a configuração INTEIRA, e não uma cópia de dois campos.** Ela era
 * > remontada campo a campo (`{ quantidade, pool }`), e o ÍCONE ficava para
 * > trás — invisível, porque o objeto continuava parecendo certo. O estrago era
 * > no editor: a aba DROPS carrega o que está publicado por aqui, então o ícone
 * > voltava sempre como "nenhum selecionado", e o SALVAMENTO SEGUINTE apagava do
 * > banco a configuração que estava lá. Do lado de quem edita: *"tive que salvar
 * > 2x; voltei ao deck e o ícone não estava selecionado"*. Uma lista de campos
 * > escrita à mão envelhece toda vez que a configuração ganha um.
 */
export function dropsDoDeck(cfg, npcId, deckNome) {
  const doNpc = normalizarDrops(cfg)[String(npcId ?? '')] ?? null;
  if (!doNpc) return null;

  const nome = String(deckNome ?? '').trim();
  const doDeck = nome ? doNpc.decks?.[nome] : null;
  // `decks` fora, e só ele: é a lista dos OUTROS decks, e não faz sentido dentro
  // da configuração de um. Todo o resto passa — inclusive o que for acrescentado
  // depois desta linha ser escrita.
  if (doDeck) return { ...doDeck };

  const { decks: _outros, ...doNpcSemDecks } = doNpc;
  return Number.isFinite(doNpc.quantidade) ? doNpcSemDecks : null;
}

/** Lê a configuração publicada (banco, com o disco de reserva). */
export async function carregarDrops() {
  return normalizarDrops(await pullFile(ARQUIVO));
}

/**
 * Publica. Só admin — a RLS de `conteudo` recusa o resto.
 *
 * Devolve o RESULTADO (`{banco:{ok,erro}, disco:{ok}}`), e isso não é detalhe:
 * `pushFile` não devolve nada (ele guarda a promessa numa fila interna para
 * poder descartar gravações atropeladas), então quem chamava direto ficava sem
 * saber se a publicação falhou — e uma configuração de drop que não chegou ao
 * banco é exatamente uma que "não funciona" sem dizer por quê.
 */
export function salvarDrops(cfg) {
  return new Promise((resolve) => {
    aoGravar(ARQUIVO, (r) => { aoGravar(ARQUIVO, null); resolve(r); });
    pushFile(ARQUIVO, normalizarDrops(cfg));
  });
}
