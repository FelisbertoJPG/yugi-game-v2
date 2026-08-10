-- Exportada de supabase_migrations.schema_migrations (versao 20260809201722).
-- Aplicada no banco em 2026-08-09; arquivo gravado depois. Ver OQ-FALTOU.md item 0.

-- ============================================================================
-- Decks do jogador no servidor, conferidos contra a colecao.
--
-- A carteira ja' estava travada (migration 0004), mas o DECK continuava sendo um
-- arquivo .ydk no disco do jogador. Abrir num editor e escrever o id de uma
-- Blue-Eyes que ele nunca abriu era tudo: a conferencia de posse morava no
-- `builder.js`, ou seja, do lado de quem estava sendo conferido.
--
-- Agora `salvar_deck` LE' a colecao da carteira e recusa o deck que peca mais
-- copias do que o jogador tem. A checagem no builder continua existindo — mas
-- como conveniencia de tela, nao como trava.
-- ============================================================================

revoke insert, update, delete on public.decks_jogador from authenticated, anon;

drop policy if exists decks_jogador_do_dono on public.decks_jogador;
create policy decks_jogador_ler_proprio on public.decks_jogador
  for select using (usuario_id = auth.uid());

-- Ids de carta de um .ydk, um por linha repetida (3 copias = 3 linhas).
-- Linhas de diretiva (#main, #extra, !side, #created by) sao ignoradas — o
-- formato e' do ygopro e qualquer parser as descarta do mesmo jeito.
create or replace function public.ydk_cartas(p_ydk text)
returns table(id bigint) language sql immutable
set search_path = public as $$
  select trim(l)::bigint
  from regexp_split_to_table(coalesce(p_ydk, ''), E'\r?\n') as l
  where trim(l) ~ '^[0-9]{1,10}$';
$$;

/**
 * Grava um deck do jogador. Recusa se pedir carta que ele nao possui.
 */
create or replace function public.salvar_deck(p_nome text, p_ydk text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  col jsonb;
  falta text[] := '{}';
  r record;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'deck sem nome'; end if;
  if length(p_ydk) > 100000 then raise exception 'deck grande demais'; end if;

  col := coalesce(public.carteira_minha()->'collection', '{}'::jsonb);

  -- Agrupa por carta: 3 linhas do mesmo id exigem 3 copias na colecao.
  for r in
    select id, count(*)::int as pedidas
    from public.ydk_cartas(p_ydk)
    group by id
  loop
    if coalesce((col->>r.id::text)::int, 0) < r.pedidas then
      falta := falta || format('%s (tem %s, pediu %s)',
                               r.id, coalesce((col->>r.id::text)::int, 0), r.pedidas);
    end if;
  end loop;

  if array_length(falta, 1) > 0 then
    raise exception 'cartas que voce nao possui: %', array_to_string(falta, ', ');
  end if;

  insert into public.decks_jogador (usuario_id, nome, ydk)
  values (uid, p_nome, p_ydk)
  on conflict (usuario_id, nome) do update
    set ydk = excluded.ydk, atualizado_em = now();

  return jsonb_build_object('ok', true, 'nome', p_nome);
end;
$$;

create or replace function public.apagar_deck(p_nome text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  delete from public.decks_jogador where usuario_id = uid and nome = p_nome;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

revoke all on function public.ydk_cartas(text) from public, anon, authenticated;
grant execute on function public.salvar_deck(text, text) to authenticated;
grant execute on function public.apagar_deck(text)       to authenticated;
