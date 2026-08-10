-- ============================================================================
-- BUG DE PRODUCAO, achado com o primeiro tester: ele montava o deck, clicava em
-- salvar, via "deck salvo" — e o deck NAO existia. Na tela de multiplayer
-- aparecia "nenhum deck salvo".
--
-- Causa: cliente e servidor contavam copias por regras DIFERENTES.
--
--   builder.js (`availableCopies`): carta N ou sem raridade vale 3 copias mesmo
--   possuindo 1 — "assim UR/SR viram colecionaveis de verdade e Normais sao
--   fartas". E' decisao de design, e e' a regra certa: sem ela, fechar 40 cartas
--   exigiria dezenas de boosters.
--
--   salvar_deck (0006/0008): posse LITERAL, sem conhecer raridade nenhuma.
--
-- Resultado: a tela oferecia 3 copias de uma Normal, o jogador montava, e o
-- banco recusava com "cartas que voce nao possui: 58696829 (tem 2, pediu 3)".
-- Reproduzido com a colecao real do tester antes de corrigir.
--
-- O servidor CONTINUA sendo a autoridade — o que muda e' que agora ele aplica a
-- MESMA regra que a tela mostra. R/SR/UR seguem contando copia por copia, que e'
-- o que impede alguem de montar 3 Blue-Eyes tendo uma.
--
-- (O segundo bug era no front: a recusa do servidor era engolida por um
-- `if (!r.ok) return;` em `storage.js`, e o toast dizia "deck salvo" mesmo
-- assim. Corrigido no mesmo commit.)
-- ============================================================================

/**
 * `id -> raridade`, lido do conteudo publicado (`store/boosters.json`).
 *
 * Carta fora de qualquer booster nao tem raridade e cai no mesmo balde das
 * Normais, de proposito: se o jogo nunca a vendeu num pacote, ela nao e' um
 * colecionavel e nao ha' o que proteger.
 *
 * O filtro por `chave` vem numa consulta SEPARADA, nao num WHERE ao lado dos
 * `cross join lateral`: o planejador e' livre para expandir o lateral antes de
 * filtrar, e ai' ele tentava `jsonb_array_elements` em `banlist`, que e' um
 * OBJETO — "cannot extract elements from an object". Vale para qualquer LATERAL
 * sobre coluna jsonb cujo tipo varia por linha.
 */
create or replace function public.raridade_das_cartas()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare mapa jsonb := '{}'::jsonb; boosters jsonb; r record;
begin
  select dados into boosters from public.conteudo where chave = 'boosters';
  if boosters is null or jsonb_typeof(boosters) <> 'array' then return mapa; end if;

  for r in
    select (carta)::text as id, v.rar
      from jsonb_array_elements(boosters) as b(booster)
      cross join lateral (values ('R', 3), ('SR', 2), ('UR', 1)) as v(rar, peso)
      cross join lateral jsonb_array_elements_text(
                   case when jsonb_typeof(b.booster->'cards'->v.rar) = 'array'
                        then b.booster->'cards'->v.rar else '[]'::jsonb end) as x(carta)
     order by v.peso desc     -- R primeiro, UR por ultimo: a raridade MAIS ALTA vence
  loop
    mapa := jsonb_set(mapa, array[r.id], to_jsonb(r.rar), true);
  end loop;
  return mapa;
end;
$$;

/**
 * Quantas copias desta carta o jogador pode LEVAR, dada a colecao dele.
 * Espelha `availableCopies` de `web/js/builder.js` — as duas TEM de concordar,
 * senao a tela oferece o que o banco recusa. Foi exatamente o bug.
 */
create or replace function public.copias_disponiveis(p_id text, p_col jsonb, p_rar jsonb)
returns int language sql immutable
set search_path = public as $$
  select case
           when coalesce(p_rar->>p_id, 'N') = 'N' then 3
           else least(3, coalesce((p_col->>p_id)::int, 0))
         end;
$$;

create or replace function public.salvar_deck(p_nome text, p_ydk text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  col jsonb; banlist jsonb; lista jsonb; rar jsonb;
  n_main int; n_extra int; n_side int;
  falta text[] := '{}';
  problemas text[] := '{}';
  r record;
  teto int; pode int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'deck sem nome'; end if;
  if length(p_ydk) > 100000 then raise exception 'deck grande demais'; end if;

  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  if n_main < 40 or n_main > 60 then
    problemas := problemas || format('main tem %s cartas (precisa de 40 a 60)', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

  col := coalesce(public.carteira_minha()->'collection', '{}'::jsonb);
  rar := public.raridade_das_cartas();
  select dados into banlist from public.conteudo where chave = 'banlist';
  select dados into lista   from public.conteudo where chave = 'lista1';

  for r in
    select id, count(*)::int as pedidas from public.ydk_por_secao(p_ydk) group by id
  loop
    -- POSSE, agora pela MESMA regra da tela.
    pode := public.copias_disponiveis(r.id::text, col, rar);
    if r.pedidas > pode then
      falta := falta || format('%s (pode levar %s, pediu %s)', r.id, pode, r.pedidas);
    end if;

    teto := least(3, coalesce((banlist->'cardLimits'->>r.id::text)::int, 3));
    if r.pedidas > teto then
      problemas := problemas || format('%s: %s copias (max %s)', r.id, r.pedidas, teto);
    end if;

    if lista is not null and not (lista @> to_jsonb(r.id)) then
      problemas := problemas || format('%s nao esta na lista permitida', r.id);
    end if;
  end loop;

  if array_length(falta, 1) > 0 then
    raise exception 'cartas que voce nao possui: %', array_to_string(falta[1:5], ', ');
  end if;
  if array_length(problemas, 1) > 0 then
    raise exception 'deck invalido: %', array_to_string(problemas[1:5], '; ');
  end if;

  insert into public.decks_jogador (usuario_id, nome, ydk)
  values (uid, p_nome, p_ydk)
  on conflict (usuario_id, nome) do update
    set ydk = excluded.ydk, atualizado_em = now();

  return jsonb_build_object('ok', true, 'nome', p_nome,
                            'main', n_main, 'extra', n_extra, 'side', n_side);
end;
$$;

revoke all on function public.raridade_das_cartas()                  from public, anon, authenticated;
revoke all on function public.copias_disponiveis(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.salvar_deck(text, text)                from public, anon;
grant execute on function public.salvar_deck(text, text) to authenticated;
