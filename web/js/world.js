/**
 * Mundo — o mapa que liga os cenários andáveis (`cidade.html`). Cada cenário é
 * uma "cidade" no estilo Tag Force: você anda até um NPC pra abrir o duelo.
 *
 * Um cenário pode RESERVAR nomes de campanha (`claims`) — todo NPC com uma
 * dessas campanhas mora nesse cenário; o resto (incluindo NPC sem campanha
 * nenhuma) cai no cenário padrão (`cidade`). Isso evita ter que migrar dado
 * nenhum: basta dar à campanha o mesmo nome do `claims` pra ela "virar" outro
 * cenário no mapa.
 *
 * Não existe ainda sistema de missão/progresso — o desbloqueio de cenário é
 * fixo (`locked`) até essa peça existir. Trocar pra progresso real é só
 * mudar `isUnlocked()`.
 */

export const SCENARIOS = [
  {
    id: 'cidade',
    name: 'Cidade',
    subtitle: 'onde tudo começa',
    icon: '🏙',
    locked: false,
  },
  {
    id: 'reino',
    name: 'Reino dos Duelistas',
    subtitle: 'a ilha do torneio',
    icon: '🏝',
    locked: true,
    unlockHint: 'desbloqueia depois de vencer o Torneio Regional',
    claims: ['Reino dos Duelistas'],
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/** Cenário "dono" de uma campanha — o primeiro que a reserva, ou `cidade`. */
export function scenarioForCampaign(campaignName) {
  if (campaignName) {
    for (const s of SCENARIOS) {
      if (s.claims?.includes(campaignName)) return s.id;
    }
  }
  return 'cidade';
}

/** Fixo por enquanto — ver nota acima sobre progresso real. */
export function isUnlocked(scenario) {
  return !scenario.locked;
}
