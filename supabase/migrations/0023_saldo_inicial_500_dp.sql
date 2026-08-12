-- ============================================================================
-- SALDO INICIAL: 2000 -> 500 DP
--
-- `eco_const()` e' a fonte unica da economia; `carteira_minha()` le' `start_dp`
-- dela na PRIMEIRA vez que abre a carteira de alguem. Trocar aqui e' o
-- suficiente — nao existe outro lugar no servidor que decida saldo inicial.
--
-- Vale so' para carteira NOVA, e isso e' o certo: quem ja' jogou gastou e
-- ganhou em cima do saldo antigo, e reescrever isso agora tiraria DP que a
-- pessoa comprou pacote com. Para acertar uma conta especifica existe o
-- `creditar_dp` (0022), que e' de admin e registra a diferenca.
--
-- 500 DP compram 5 pacotes (BOOSTER_PRICE = 100) em vez de 20.
-- ============================================================================

create or replace function public.eco_const()
returns jsonb language sql immutable
set search_path = public as $$
  select jsonb_build_object(
    'start_dp',     500,
    'win_reward',   100,
    'pack_size',    5,
    'pity_every',   20,      -- a cada N pacotes do MESMO booster, SR garantida
    'ur_pity_dp',   10000,   -- DP gasto em pacotes ate' a UR garantida
    'odds',         jsonb_build_object('N', 706, 'R', 252, 'SR', 38, 'UR', 4),
    'sell',         jsonb_build_object('N', 5, 'R', 10, 'SR', 20, 'UR', 100)
  );
$$;
