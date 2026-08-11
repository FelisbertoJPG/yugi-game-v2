-- `nome` era variavel PL/pgSQL E coluna de `decks_jogador`: o laco que procurava
-- um nome livre virou `nome = decks_jogador.nome`, que o Postgres recusa como
-- ambiguo (42702) — e que, se tivesse passado, seria tautologia (laco infinito).
-- Variavel com prefixo `v_` resolve dos dois jeitos.
create or replace function public.comprar_deck_estrutural(p_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid    uuid := auth.uid();
  d      record;
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

grant execute on function public.comprar_deck_estrutural(text) to authenticated;
