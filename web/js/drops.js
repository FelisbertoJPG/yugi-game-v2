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
export function normalizarDrops(bruto) {
  const saida = {};
  for (const [id, cfg] of Object.entries(bruto ?? {})) {
    if (!id || typeof cfg !== 'object' || cfg == null) continue;

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

    if (!vistos.size || qtd <= 0) continue;
    saida[id] = { quantidade: qtd, pool };
  }
  return saida;
}

/** Quantas cartas o pool tem no total. */
export function totalDoPool(pool) {
  return RARIDADES.reduce((n, r) => n + (pool?.[r]?.length ?? 0), 0);
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

/** A configuração de um NPC só. `null` quando ele não tem drop configurado. */
export function dropsDoNpc(cfg, npcId) {
  return normalizarDrops(cfg)[String(npcId ?? '')] ?? null;
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
