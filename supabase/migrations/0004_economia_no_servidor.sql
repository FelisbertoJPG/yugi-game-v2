-- ============================================================================
-- Economia no SERVIDOR.
--
-- Ate' aqui a carteira era um arquivo no disco do jogador: abrir o
-- store/wallet.json num editor, trocar "dp": 2000 por "dp": 999999 e salvar era
-- todo o trabalho. Mover o arquivo para o banco NAO resolve sozinho — se o
-- cliente puder dar UPDATE em `carteiras`, um POST no PostgREST faz o mesmo
-- estrago com dois cliques a mais.
--
-- Entao a regra aqui e': o dono LE' a propria carteira e nao escreve nela. Toda
-- mudanca passa por uma funcao SECURITY DEFINER que aplica a regra do jogo do
-- lado de ca' — preco do pacote, sorteio das cartas, valor da recompensa,
-- conferencia de posse na venda. O cliente pede "abrir pacote"; quem decide o
-- que sai e quanto custa e' o banco.
-- ============================================================================

-- ------------------------------------------------------------------ travas
-- SELECT continua (o jogador ve' o que tem). Escrita direta, nunca mais.
revoke insert, update, delete on public.carteiras from authenticated, anon;

drop policy if exists carteiras_do_dono on public.carteiras;
create policy carteiras_ler_proprio on public.carteiras
  for select using (usuario_id = auth.uid());


-- --------------------------------------------------------------- constantes
-- Espelham web/js/wallet.js e web/js/boosters.js. Ficam aqui porque agora o
-- servidor e' a autoridade: se divergirem, vale ESTE lado.
create or replace function public.eco_const()
returns jsonb language sql immutable
set search_path = public as $$
  select jsonb_build_object(
    'start_dp',     2000,
    'win_reward',   100,
    'pack_size',    5,
    'pity_every',   20,      -- a cada N pacotes do MESMO booster, SR garantida
    'ur_pity_dp',   10000,   -- DP gasto em pacotes ate' a UR garantida
    'odds',         jsonb_build_object('N', 706, 'R', 252, 'SR', 38, 'UR', 4),
    'sell',         jsonb_build_object('N', 5, 'R', 10, 'SR', 20, 'UR', 100)
  );
$$;


-- ------------------------------------------------------------ carteira base
-- Cria a carteira na primeira leitura. Um `insert` aqui e' seguro porque a
-- funcao e' DEFINER e so' escreve na linha de auth.uid().
create or replace function public.carteira_minha()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  w   jsonb;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select dados into w from public.carteiras where usuario_id = uid;
  if w is null then
    w := jsonb_build_object(
           'dp', (public.eco_const()->>'start_dp')::int,
           'collection', '{}'::jsonb,
           'pity', '{}'::jsonb,
           'urSpend', 0);
    insert into public.carteiras (usuario_id, dados) values (uid, w)
      on conflict (usuario_id) do nothing;
    select dados into w from public.carteiras where usuario_id = uid;
  end if;
  return w;
end;
$$;


-- ------------------------------------------------------------ abrir pacote
-- O sorteio acontece AQUI. O cliente manda so' o nome do booster; preco, pool e
-- raridade saem de `conteudo->boosters`, que so' admin escreve.
create or replace function public.abrir_pacote(p_booster text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid       uuid := auth.uid();
  k         jsonb := public.eco_const();
  w         jsonb;
  boosters  jsonb;
  b         jsonb;
  preco     int;
  dp        int;
  pity      int;
  ur_spend  int;
  garante_sr boolean;
  garante_ur boolean;
  col       jsonb;
  saiu      jsonb := '[]'::jsonb;
  i         int;
  r         int;
  rar       text;
  pool      jsonb;
  carta     bigint;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select dados into boosters from public.conteudo where chave = 'boosters';
  if boosters is null then raise exception 'nenhum booster publicado'; end if;

  -- O arquivo e' um objeto { "<nome>": {...} } ou um array; aceita os dois.
  if jsonb_typeof(boosters) = 'object' then
    b := boosters -> p_booster;
  else
    select value into b from jsonb_array_elements(boosters)
      where value->>'name' = p_booster limit 1;
  end if;
  if b is null then raise exception 'booster % nao existe', p_booster; end if;

  preco := coalesce((b->>'price')::int, 100);
  w := public.carteira_minha();
  dp := (w->>'dp')::int;
  if dp < preco then raise exception 'DP insuficiente'; end if;

  pity     := coalesce((w->'pity'->>p_booster)::int, 0) + 1;
  ur_spend := coalesce((w->>'urSpend')::int, 0) + preco;

  garante_sr := (pity % (k->>'pity_every')::int) = 0;
  garante_ur := ur_spend >= (k->>'ur_pity_dp')::int
                and jsonb_array_length(coalesce(b->'cards'->'UR', '[]'::jsonb)) > 0;

  col := coalesce(w->'collection', '{}'::jsonb);

  for i in 1..(k->>'pack_size')::int loop
    if i = 1 and garante_ur then
      rar := 'UR';
    elsif i = 1 and garante_sr then
      rar := 'SR';
    else
      -- Sorteio ponderado em milesimos, com o mesmo peso do PACK_ODDS do front.
      r := floor(random() * 1000)::int;
      rar := case
        when r < (k->'odds'->>'UR')::int then 'UR'
        when r < (k->'odds'->>'UR')::int + (k->'odds'->>'SR')::int then 'SR'
        when r < (k->'odds'->>'UR')::int + (k->'odds'->>'SR')::int
               + (k->'odds'->>'R')::int then 'R'
        else 'N' end;
    end if;

    -- Booster sem cartas naquela raridade cai para a de baixo, ate' achar uma
    -- com pool. Sem isto um booster so' de N devolveria buracos no pacote.
    foreach rar in array (case rar
        when 'UR' then array['UR','SR','R','N']
        when 'SR' then array['SR','R','N','UR']
        when 'R'  then array['R','N','SR','UR']
        else array['N','R','SR','UR'] end)
    loop
      pool := coalesce(b->'cards'->rar, '[]'::jsonb);
      exit when jsonb_array_length(pool) > 0;
    end loop;
    if jsonb_array_length(pool) = 0 then raise exception 'booster % esta vazio', p_booster; end if;

    carta := (pool -> floor(random() * jsonb_array_length(pool))::int)::text::bigint;
    saiu  := saiu || jsonb_build_object('id', carta, 'rarity', rar);
    col   := jsonb_set(col, array[carta::text],
                       to_jsonb(coalesce((col->>carta::text)::int, 0) + 1), true);
  end loop;

  if garante_ur then ur_spend := ur_spend - (k->>'ur_pity_dp')::int; end if;

  w := w
       || jsonb_build_object('dp', dp - preco)
       || jsonb_build_object('collection', col)
       || jsonb_build_object('pity', jsonb_set(coalesce(w->'pity','{}'::jsonb),
                                               array[p_booster], to_jsonb(pity), true))
       || jsonb_build_object('urSpend', greatest(0, ur_spend));

  update public.carteiras set dados = w where usuario_id = uid;
  return jsonb_build_object('cartas', saiu, 'carteira', w);
end;
$$;


-- ------------------------------------------------------------ vender cartas
-- `p_lotes` = [{"id":123,"qty":2}]. A RARIDADE nao vem do cliente: e' procurada
-- nos boosters publicados. Aceitar a raridade de fora seria vender tudo como UR.
create or replace function public.vender_cartas(p_lotes jsonb)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  k jsonb := public.eco_const();
  w jsonb; col jsonb; lote jsonb;
  id_ text; qtd int; tem int; rar text; total int := 0; vendidas int := 0;
  boosters jsonb;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  select dados into boosters from public.conteudo where chave = 'boosters';

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);

  for lote in select * from jsonb_array_elements(coalesce(p_lotes, '[]'::jsonb)) loop
    id_ := lote->>'id';
    tem := coalesce((col->>id_)::int, 0);
    qtd := least(greatest(coalesce((lote->>'qty')::int, 0), 0), tem);
    continue when qtd = 0;

    rar := public.raridade_da_carta(boosters, id_);
    total := total + qtd * coalesce((k->'sell'->>rar)::int, (k->'sell'->>'N')::int);
    vendidas := vendidas + qtd;

    if tem - qtd <= 0 then col := col - id_;
    else col := jsonb_set(col, array[id_], to_jsonb(tem - qtd), true); end if;
  end loop;

  if vendidas = 0 then return jsonb_build_object('ok', false, 'carteira', w); end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + total)
         || jsonb_build_object('collection', col);
  update public.carteiras set dados = w where usuario_id = uid;
  return jsonb_build_object('ok', true, 'total', total, 'vendidas', vendidas, 'carteira', w);
end;
$$;

-- Maior raridade em que a carta aparece entre os boosters publicados.
create or replace function public.raridade_da_carta(p_boosters jsonb, p_id text)
returns text language plpgsql immutable
set search_path = public as $$
declare b jsonb; r text; lista jsonb; todos jsonb;
begin
  if p_boosters is null then return 'N'; end if;

  -- O arquivo pode ser objeto { "<nome>": {...} } ou array; normaliza para array.
  todos := case when jsonb_typeof(p_boosters) = 'object'
                then (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each(p_boosters))
                else p_boosters end;

  -- Da maior para a menor: uma carta que aparece como UR num booster e como N
  -- noutro vale UR. O contrario deixaria o preco depender de qual booster foi
  -- encontrado primeiro, que e' ordem de arquivo — nada a ver com o jogo.
  foreach r in array array['UR','SR','R','N'] loop
    for b in select value from jsonb_array_elements(todos) loop
      lista := coalesce(b->'cards'->r, '[]'::jsonb);
      if lista @> to_jsonb(p_id::bigint) then return r; end if;
    end loop;
  end loop;
  return 'N';
end;
$$;


-- --------------------------------------------------------- premio de duelo
-- O valor e' do servidor; o cliente so' avisa que venceu. Isso NAO prova a
-- vitoria (o duelo roda na maquina dele), mas tira do cliente a escolha do
-- quanto — que era o estrago maior.
create or replace function public.premiar_vitoria(p_npc text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); w jsonb; premio int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  premio := (public.eco_const()->>'win_reward')::int;
  w := public.carteira_minha();
  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio);
  update public.carteiras set dados = w where usuario_id = uid;
  return jsonb_build_object('premio', premio, 'carteira', w);
end;
$$;


-- ------------------------------------------------ remover cartas (sem pagar)
-- Limpeza de carta que saiu do jogo. Nao paga DP de proposito: creditar por
-- registro morto injetaria moeda a partir de nada.
create or replace function public.remover_cartas(p_ids jsonb)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); w jsonb; col jsonb; id_ text; n int := 0;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);
  for id_ in select jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) loop
    if col ? id_ then col := col - id_; n := n + 1; end if;
  end loop;
  if n = 0 then return jsonb_build_object('ok', false, 'carteira', w); end if;
  w := w || jsonb_build_object('collection', col);
  update public.carteiras set dados = w where usuario_id = uid;
  return jsonb_build_object('ok', true, 'distintas', n, 'carteira', w);
end;
$$;


-- ------------------------------------------------------------------ grants
-- So' `authenticated`. `anon` nao tem carteira e nao precisa ver a superficie.
revoke all on function public.eco_const()                    from public, anon, authenticated;
revoke all on function public.raridade_da_carta(jsonb, text) from public, anon, authenticated;

grant execute on function public.carteira_minha()      to authenticated;
grant execute on function public.abrir_pacote(text)    to authenticated;
grant execute on function public.vender_cartas(jsonb)  to authenticated;
grant execute on function public.premiar_vitoria(text) to authenticated;
grant execute on function public.remover_cartas(jsonb) to authenticated;
