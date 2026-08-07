-- ============================================================================
-- Revoga o que o Supabase concede sozinho ao `anon`.
--
-- ACHADO NA VERIFICACAO da 0001: depois de aplicar tudo, `anon` tinha
-- INSERT/UPDATE/DELETE nas SEIS tabelas — inclusive `carteiras` e
-- `decks_jogador`. Nao veio da 0001: o Supabase deixa configurado
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated`, entao toda tabela nova nasce assim, e os `grant` da 0001
-- SOMARAM a isso em vez de restringir.
--
-- A RLS ja' segurava (as policies exigem `usuario_id = auth.uid()`, e para anon
-- isso e' NULL, entao nenhuma linha casa). Mas grant e RLS sao camadas
-- INDEPENDENTES de proposito. Deixar a de fora destrancada em tudo significa que
-- uma policy derrubada por engano — um `alter table ... disable row level
-- security` no lugar errado — vira escrita anonima na carteira do jogador, sem
-- nenhum outro obstaculo.
--
-- LICAO PARA AS PROXIMAS MIGRATIONS: toda tabela nova em `public` nasce aberta
-- para anon. Revogue explicitamente, nao confie no default.
-- ============================================================================

revoke all on public.perfis         from anon;
revoke all on public.carteiras      from anon;
revoke all on public.decks_jogador  from anon;

revoke insert, update, delete on public.conteudo   from anon;
revoke insert, update, delete on public.decks_npc  from anon;
revoke insert, update, delete on public.tabuleiros from anon;

-- Reafirma o que anon PODE: so' ler o conteudo do jogo. O front carrega NPCs e
-- banlist antes de qualquer login, e o app mobile le' sem sessao nenhuma.
grant select on public.conteudo, public.decks_npc, public.tabuleiros to anon;
grant select on public.conteudo_carimbo to anon;
