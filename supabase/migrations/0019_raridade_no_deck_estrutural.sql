-- ============================================================================
-- Raridade no Deck Estrutural.
--
-- O estrutural passa a carregar a raridade de cada carta, como o booster. Nao
-- e' enfeite: `vender_cartas` calcula o preco pela raridade, e ate' agora ela
-- so' era procurada em `conteudo->boosters`. Uma carta que existisse APENAS num
-- estrutural nao tinha raridade nenhuma e era vendida como N (5 DP) — inclusive
-- se fosse a carta-chefe do deck.
-- ============================================================================

alter table public.decks_estruturais
  add column if not exists raridades jsonb not null default '{}'::jsonb;

comment on column public.decks_estruturais.raridades is
  'Mapa {"<id da carta>": "UR|SR|R|N"}. Alimenta o preco de venda, como os boosters.';

/**
 * Maior raridade em que a carta aparece — agora olhando boosters E estruturais.
 *
 * Deixou de ser IMMUTABLE: consulta `decks_estruturais`, entao depende do
 * banco. STABLE basta (nao muda dentro da mesma consulta) e e' o que
 * `vender_cartas` precisa.
 *
 * O BOOSTER VENCE de proposito: e' a regra que o Booster Builder ja' aplicava —
 * "a raridade e' da carta, nao do pacote". Sem essa ordem, a mesma carta seria
 * UR num booster e N num estrutural, e o preco dependeria de onde o servidor
 * olhasse primeiro.
 */
create or replace function public.raridade_da_carta(p_boosters jsonb, p_id text)
returns text language plpgsql stable
set search_path = public as $$
declare b jsonb; r text; lista jsonb; todos jsonb; do_estrutural text;
begin
  -- 1. boosters (a fonte historica, e a que trava a raridade de um reprint)
  if p_boosters is not null then
    todos := case when jsonb_typeof(p_boosters) = 'object'
                  then (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each(p_boosters))
                  else p_boosters end;

    foreach r in array array['UR','SR','R','N'] loop
      for b in select value from jsonb_array_elements(todos) loop
        lista := coalesce(b->'cards'->r, '[]'::jsonb);
        if lista @> to_jsonb(p_id::bigint) then return r; end if;
      end loop;
    end loop;
  end if;

  -- 2. estruturais. `order by` pela ordem das raridades para a MAIOR ganhar,
  --    mesmo criterio da busca acima.
  select de.raridades->>p_id into do_estrutural
  from public.decks_estruturais de
  where de.raridades ? p_id
  order by case de.raridades->>p_id
             when 'UR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end
  limit 1;

  return coalesce(do_estrutural, 'N');
end;
$$;

/**
 * Validacao do estrutural. Passa a exigir 40 no MINIMO de forma explicita — o
 * deck e' vendido, entao entregar menos que um deck jogavel seria vender algo
 * que nao da' para usar.
 */
create or replace function public.validar_deck_estrutural(p_ydk text)
returns jsonb language plpgsql immutable
set search_path = public as $$
declare
  n_main int; n_extra int; n_side int; problemas text[] := '{}'; r record;
begin
  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  if n_main < 40 then
    problemas := problemas || format('o deck tem %s cartas — o minimo e 40', n_main);
  elsif n_main > 60 then
    problemas := problemas || format('o deck tem %s cartas — o maximo e 60', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

  for r in select id, count(*)::int as q from public.ydk_por_secao(p_ydk) group by id loop
    if r.q > 3 then problemas := problemas || format('%s: %s copias (max 3)', r.id, r.q); end if;
  end loop;

  return jsonb_build_object('ok', array_length(problemas, 1) is null,
                            'main', n_main, 'extra', n_extra, 'side', n_side,
                            'problemas', to_jsonb(problemas));
end;
$$;

-- A venda de um estrutural nao pode acontecer sem o deck ser valido: a compra
-- ja' conferia so' na publicacao. Reforca no ato da compra, porque um deck
-- publicado ANTES desta regra pode estar com menos de 40.
create or replace function public.comprar_deck_estrutural(p_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid    uuid := auth.uid();
  d      record;
  v      jsonb;
  w      jsonb;
  dp     int;
  col    jsonb;
  r      record;
  v_nome text;
  n      int := 1;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select * into d from public.decks_estruturais where id = p_id and na_loja;
  if d is null then raise exception 'deck estrutural "%" nao esta a venda', p_id; end if;

  v := public.validar_deck_estrutural(d.ydk);
  if not (v->>'ok')::boolean then
    raise exception 'este deck esta incompleto e nao pode ser vendido: %',
                    array_to_string(array(select jsonb_array_elements_text(v->'problemas')), '; ');
  end if;

  if exists (select 1 from public.compras_estruturais c
              where c.usuario_id = uid and c.deck_id = p_id) then
    raise exception 'voce ja tem este deck (limite de 1 por conta)';
  end if;

  w  := public.carteira_minha();
  dp := (w->>'dp')::int;
  if dp < d.preco then raise exception 'DP insuficiente'; end if;

  col := coalesce(w->'collection', '{}'::jsonb);
  for r in select id, count(*)::int as qtd from public.ydk_cartas(d.ydk) group by id loop
    col := jsonb_set(col, array[r.id::text],
                     to_jsonb(coalesce((col->>r.id::text)::int, 0) + r.qtd), true);
  end loop;

  w := w || jsonb_build_object('dp', dp - d.preco)
         || jsonb_build_object('collection', col);
  update public.carteiras set dados = w where usuario_id = uid;

  v_nome := d.nome;
  while exists (select 1 from public.decks_jogador dj
                 where dj.usuario_id = uid and dj.nome = v_nome) loop
    n := n + 1;
    v_nome := d.nome || ' ' || n;
  end loop;

  insert into public.decks_jogador (usuario_id, nome, ydk) values (uid, v_nome, d.ydk);
  insert into public.compras_estruturais (usuario_id, deck_id, nome_do_deck)
  values (uid, p_id, v_nome);

  return jsonb_build_object('ok', true, 'deck', v_nome, 'preco', d.preco, 'carteira', w);
end;
$$;

revoke all on function public.raridade_da_carta(jsonb, text) from public, anon, authenticated;
grant execute on function public.validar_deck_estrutural(text) to authenticated;
grant execute on function public.comprar_deck_estrutural(text) to authenticated;
