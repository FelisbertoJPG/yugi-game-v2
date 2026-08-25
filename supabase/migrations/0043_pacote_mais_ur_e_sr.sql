-- 0043 — os PACOTES ficam mais generosos no topo. O drop do NPC nao muda.
--
-- Pedido: "aumentar o droprate de UR e SR dos pacotes e manter o dos NPC", com
-- alvo de **~20 pacotes por UR** (era ~50).
--
-- A conta e' por PACOTE, nao por carta: sao 5 cartas, e o que o jogador sente e'
-- "quantos pacotes ate' sair uma UR". Com peso p por carta, a chance de pelo
-- menos uma UR no pacote e' 1-(1-p)^5.
--
--            por carta     por pacote        1 a cada
--   UR   4 →  10   0,4% → 1,0%    1,98% → 4,90%    50,4 → 20,4 pacotes
--   SR  38 →  80   3,8% → 8,0%   17,61% → 34,09%    5,7 →  2,9 pacotes
--   R  252 → 240
--   N  706 → 670
--
-- O que saiu de N e R manteve a proporcao entre os dois (73,7% / 26,3%), entao o
-- pacote nao fica "mais pobre embaixo": ele fica mais rico em cima.
--
-- POR QUE A SR NAO SUBIU MAIS. Ela ja' foi 100 em 1000 e caiu para 38 por um
-- motivo que continua valendo: o jogador FECHAVA a lista de SR de um booster
-- antes de tirar a primeira UR, e a raridade perdia o sentido. O que mudou e' o
-- outro lado da razao — com a UR a cada 20 pacotes, 80 de SR da' ~6,8 SR por UR,
-- contra as ~8,8 de antes. A SR continua sendo a que aparece primeiro, sem
-- voltar ao ponto em que ela deixa de valer nada.
--
-- NAO MEXE em `pity_every` (SR garantida a cada 20 pacotes do mesmo booster) nem
-- em `ur_pity_dp` (UR garantida a cada 10.000 DP gastos). O segundo e' medido em
-- DP e nao em pacotes, entao ele se ajusta sozinho quando os precos mudarem —
-- que e' o proximo passo do balanceamento.
--
-- `DROP_ODDS` (o premio por vitoria contra NPC, `web/js/drops.js` +
-- `premiar_vitoria`) fica como esta', de proposito: e' outra economia e outra
-- conta — la' o servidor RENORMALIZA entre as gavetas que tem carta; aqui a
-- cascata nao renormaliza.
--
-- O MESMO numero vive em `web/js/pacote.js` (`PACK_ODDS`), que e' o que a Loja
-- PROMETE na tela. Os dois tem de andar juntos: divergir faz a tela mostrar uma
-- porcentagem que o sorteio nao cumpre, e nada acusa. `node web/js/pacote.test.mjs`.

create or replace function public.eco_const()
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'start_dp',     500,
    'win_reward',   100,
    'pack_size',    5,
    'pity_every',   20,      -- a cada N pacotes do MESMO booster, SR garantida
    'ur_pity_dp',   10000,   -- DP gasto em pacotes ate' a UR garantida
    'odds',         jsonb_build_object('N', 670, 'R', 240, 'SR', 80, 'UR', 10),
    'sell',         jsonb_build_object('N', 5, 'R', 10, 'SR', 20, 'UR', 100)
  );
$$;
