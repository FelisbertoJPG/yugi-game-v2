-- Exportada de supabase_migrations.schema_migrations (versao 20260810022954).
-- Aplicada no banco em 2026-08-10; arquivo gravado depois. Ver OQ-FALTOU.md item 0.

-- `gen_random_bytes` vem do pgcrypto, que no Supabase vive no schema
-- `extensions` — e estas funcoes fixam `search_path = public` (necessario:
-- SECURITY DEFINER com search_path mutavel e' brecha). `gen_random_uuid()` e'
-- nativo do Postgres desde a 13 e nao depende de extensao nenhuma.
create or replace function public.criar_sala(p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid(); meu_ydk text; codigo text; nova uuid;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  codigo := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.partidas (jogador_a, deck_a, ydk_a, seed, modo, host, convite)
  values (uid, p_deck, meu_ydk, (random() * 9223372036854775807)::bigint,
          'ponte', uid, codigo)
  returning id into nova;

  return jsonb_build_object('partida', nova, 'convite', codigo);
end;
$$;

grant execute on function public.criar_sala(text) to authenticated;
