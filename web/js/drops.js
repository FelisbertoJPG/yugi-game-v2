/**
 * **O que cada adversário larga ao ser derrotado.**
 *
 * Até aqui vencer um NPC dava DP + a carta de ASSINATURA dele: sempre a mesma,
 * todas as vezes. Vencer o Yugi pela décima vez entregava a décima cópia da
 * mesma carta — o contrário do que faz querer duelar de novo.
 *
 * Agora cada NPC pode ter um POOL de cartas e uma QUANTIDADE de drops por
 * vitória: pool de 20, quantidade 3, e cada vitória sorteia 3 dentro dos 20.
 *
 *     { "yugi": { quantidade: 3, pool: [46986414, 89631139, ...] } }
 *
 * **Quem sorteia é o SERVIDOR** (`premiar_vitoria`, migration 0027). Este
 * módulo é só a configuração: ler, normalizar e gravar. Sortear aqui seria
 * deixar o jogador escolher o próprio prêmio — o duelo roda na máquina dele.
 *
 * Guardado em `conteudo/npc-drops` (espelhado em `store/npc-drops.json`) pela
 * API de sempre do `projectstore.js`. Chave própria, e não um campo dentro de
 * `conteudo/npcs`, por um motivo prático: os 3 NPCs fixos não estão naquele
 * array — são um `const` no código com um overlay à parte. Uma chave por fora
 * vale igual para fixo e customizado.
 */

// Relativo, e não `/web/js/...`: assim o módulo carrega igual no navegador e no
// Node, que é o que permite o `drops.test.mjs` existir. Caminho absoluto é para
// o que o HTML importa.
import { pullFile, pushFile } from './projectstore.js';

const ARQUIVO = 'npc-drops';

/** Teto por vitória. O MESMO número está no servidor, que é quem manda —
 *  aqui é só para a tela não oferecer o que vai ser recusado. */
export const MAX_DROPS = 20;

/**
 * Põe uma configuração em forma. Aceita lixo de propósito: este arquivo é
 * editado por gente, e um id repetido ou um texto no lugar do número não pode
 * derrubar a tela de recompensa de ninguém.
 *
 *   • ids viram número, sem repetir, na ordem em que foram escolhidos;
 *   • quantidade fica entre 0 e MAX_DROPS;
 *   • NPC sem pool ou com quantidade 0 simplesmente não entra no resultado —
 *     é o mesmo que não ter configuração, e é o que faz o servidor cair no
 *     comportamento antigo (a carta de assinatura).
 */
export function normalizarDrops(bruto) {
  const saida = {};
  for (const [id, cfg] of Object.entries(bruto ?? {})) {
    if (!id || typeof cfg !== 'object' || cfg == null) continue;

    const vistos = new Set();
    const pool = [];
    for (const c of Array.isArray(cfg.pool) ? cfg.pool : []) {
      const n = Number(c);
      if (!Number.isInteger(n) || n <= 0 || vistos.has(n)) continue;
      vistos.add(n);
      pool.push(n);
    }

    let qtd = Number(cfg.quantidade);
    if (!Number.isFinite(qtd)) qtd = 0;
    qtd = Math.max(0, Math.min(MAX_DROPS, Math.trunc(qtd)));

    if (!pool.length || qtd <= 0) continue;
    saida[id] = { quantidade: qtd, pool };
  }
  return saida;
}

/** A configuração de um NPC só. `null` quando ele não tem drop configurado. */
export function dropsDoNpc(cfg, npcId) {
  return normalizarDrops(cfg)[String(npcId ?? '')] ?? null;
}

/** Lê a configuração publicada (banco, com o disco de reserva). */
export async function carregarDrops() {
  return normalizarDrops(await pullFile(ARQUIVO));
}

/** Publica. Só admin — a RLS de `conteudo` recusa o resto. */
export async function salvarDrops(cfg) {
  return pushFile(ARQUIVO, normalizarDrops(cfg));
}
