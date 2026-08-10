-- ============================================================================
-- O Postgres da' EXECUTE ao role PUBLIC em toda funcao nova, e o PostgREST
-- publica o schema `public` inteiro como `/rest/v1/rpc/...`. Resultado: 25 das
-- 33 funcoes eram chamaveis por visitante NAO AUTENTICADO — inclusive
-- `abrir_pacote`, `vender_cartas`, `premiar_vitoria` e `salvar_deck`.
--
-- Nao havia exploracao: todas comecam com `if auth.uid() is null then raise`.
-- Mas superficie que nao precisa existir e' superficie que nao precisa ser
-- defendida — e o dia em que alguem escrever uma funcao esquecendo essa linha,
-- a diferenca entre "erro 404" e "carteira de graca" e' este arquivo.
--
-- `grant ... to authenticated` NAO resolvia sozinho: ele soma ao PUBLIC em vez
-- de restringir. Tem de revogar do PUBLIC primeiro.
-- ============================================================================

do $$
declare f record;
begin
  for f in
    select p.oid,
           format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       -- `rls_auto_enable` e' do proprio Supabase, nao nossa. Nao mexer.
       and p.proname <> 'rls_auto_enable'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;

-- Agora devolve, uma a uma, so' para quem tem sessao.
grant execute on function public.carteira_minha()              to authenticated;
grant execute on function public.abrir_pacote(text)            to authenticated;
grant execute on function public.vender_cartas(jsonb)          to authenticated;
grant execute on function public.remover_cartas(jsonb)         to authenticated;
grant execute on function public.salvar_deck(text, text)       to authenticated;
grant execute on function public.apagar_deck(text)             to authenticated;
grant execute on function public.iniciar_duelo(text)           to authenticated;
grant execute on function public.premiar_vitoria(uuid)         to authenticated;
grant execute on function public.entrar_na_fila(text)          to authenticated;
grant execute on function public.sair_da_fila()                to authenticated;
grant execute on function public.abandonar_partida(uuid)       to authenticated;
grant execute on function public.criar_sala(text)              to authenticated;
grant execute on function public.entrar_na_sala(text, text)    to authenticated;
grant execute on function public.buscar_jogador(text)          to authenticated;
grant execute on function public.pedir_amizade(int)            to authenticated;
grant execute on function public.responder_amizade(uuid, bool) to authenticated;
grant execute on function public.remover_amigo(uuid)           to authenticated;
grant execute on function public.meus_amigos()                 to authenticated;
grant execute on function public.desafiar_amigo(uuid, text)    to authenticated;
grant execute on function public.aceitar_desafio(uuid, text)   to authenticated;
grant execute on function public.recusar_desafio(uuid)         to authenticated;
grant execute on function public.meus_desafios()               to authenticated;

-- As DUAS excecoes, e cada uma tem motivo:
--
-- `espiar_sala`: quem recebeu um link de convite precisa ver contra quem vai
-- jogar ANTES de criar conta. Devolve so' o nome do anfitriao.
grant execute on function public.espiar_sala(text) to anon, authenticated;
--
-- `eh_admin`: as POLICIES chamam ela, e uma policy e' avaliada com os
-- privilegios de quem consulta. Sem isto, a leitura anonima de `conteudo`
-- (NPCs e banlist, que o jogo carrega antes de qualquer login) morre com
-- "permission denied for function public.eh_admin".
grant execute on function public.eh_admin() to anon, authenticated;

-- Conferido depois de aplicar: leitura anonima de `conteudo` e `decks_npc`
-- responde 200; `POST /rpc/abrir_pacote` sem sessao responde 401
-- "permission denied for function abrir_pacote" — recusa ANTES de executar.
