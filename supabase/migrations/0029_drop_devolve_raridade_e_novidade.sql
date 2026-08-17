-- ============================================================================
-- O DROP DIZ DE QUE GAVETA VEIO — E SE A CARTA E' NOVA
--
-- O 0028 ja' sorteava por raridade, mas devolvia so' os ids (`cartas`). A tela
-- de fim de duelo entao virava a carta e mostrava o nome, sem nenhuma pista de
-- que aquela era a UR do adversario ou o Normal de enchimento — a graduacao que
-- o sorteio criou morria antes de chegar no jogador.
--
-- Duas informacoes so' o servidor tem:
--
--   • a RARIDADE e' a GAVETA em que a carta estava (`pool.UR`, `pool.SR`, ...),
--     e nao a raridade que ela tem nos boosters. E' de proposito: e' o que deixa
--     um adversario largar um Normal como premio raro sem mexer na Loja. O
--     cliente nao consegue calcular isso — o `npc-drops` e' publicado, mas quem
--     sorteou a gaveta foi esta funcao;
--
--   • se a carta e' NOVA para aquela conta so' da' para saber ANTES de creditar.
--     Depois do `update` na carteira toda carta ja' esta' na Colecao, e a tela
--     (que recebe a carteira ja' atualizada) nunca mais conseguiria diferenciar.
--
-- Sai em `drops`, um por carta e na ordem sorteada:
--
--     "drops": [ {"id": 46986414, "raridade": "UR", "nova": true}, ... ]
--
-- `cartas` e `carta` continuam saindo iguais: um cliente antigo (o `.exe` que o
-- jogador ainda nao atualizou) ignora `drops` e segue funcionando como antes.
--
-- Duas copias da MESMA carta no mesmo sorteio: so' a primeira e' `nova`. A
-- checagem le' o `col` que esta' sendo montado, entao a segunda ja' encontra a
-- primeira la' dentro — que e' a verdade do ponto de vista da Colecao.
-- ============================================================================

create or replace function public.premiar_vitoria(p_duelo uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  d record; w jsonb; npcs jsonb; npc jsonb;
  premio int; assinatura bigint; col jsonb;
  cfg jsonb; pool jsonb; qtd int; i int; escolhida bigint;
  sorteadas jsonb := '[]'::jsonb;
  drops jsonb := '[]'::jsonb;
  nova boolean;
  boosters jsonb;
  pesos jsonb := '{"UR": 4, "SR": 14, "R": 30, "N": 52}'::jsonb;
  baldes text[]; total int; sorteio numeric; r text; escolhido text; lista jsonb;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- `for update` fecha a corrida: duas chamadas simultaneas com o mesmo id
  -- passariam as duas pela checagem de `premiado_em` sem isto.
  select * into d from public.duelos
   where id = p_duelo and usuario_id = uid for update;

  if d is null then raise exception 'duelo nao encontrado'; end if;
  if d.premiado_em is not null then raise exception 'este duelo ja foi premiado'; end if;
  if now() - d.iniciado_em < interval '30 seconds' then
    raise exception 'duelo curto demais para ter sido jogado';
  end if;

  select dados into npcs from public.conteudo where chave = 'npcs';
  if npcs is not null then
    if jsonb_typeof(npcs) = 'array' then
      select value into npc from jsonb_array_elements(npcs)
        where value->>'id' = d.npc limit 1;
    else
      npc := npcs -> d.npc;
    end if;
  end if;

  premio := greatest(0, coalesce((npc->>'rewardDp')::int,
                                 (public.eco_const()->>'win_reward')::int));
  assinatura := nullif(npc->>'signatureId', '')::bigint;

  select dados into cfg from public.conteudo where chave = 'npc-drops';
  pool := cfg -> d.npc -> 'pool';
  -- Um registro mal editado nao pode virar diluvio: o teto e' do SERVIDOR
  -- porque a tela nao manda nada aqui.
  qtd := least(greatest(coalesce((cfg -> d.npc ->> 'quantidade')::int, 0), 0), 20);

  -- Formato antigo (pool como lista simples): vira a gaveta N, que e' onde
  -- quem nao esta' em booster nenhum ja' caia.
  if jsonb_typeof(pool) = 'array' then
    pool := jsonb_build_object('N', pool);
  end if;

  -- So' as raridades que REALMENTE tem carta entram no sorteio; sem isso um
  -- pool so' de N teria 48% de chance de nao dar nada.
  select array_agg(k order by k) into baldes
    from jsonb_object_keys(coalesce(pool, '{}'::jsonb)) k
   where pesos ? k and jsonb_array_length(pool -> k) > 0;

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);

  if baldes is not null and array_length(baldes, 1) > 0 and qtd > 0 then
    select sum((pesos->>k)::int) into total from unnest(baldes) k;
    for i in 1..qtd loop
      -- 1. a raridade, pelo peso; 2. a carta, uniforme dentro dela.
      sorteio := random() * total;
      escolhido := baldes[array_length(baldes, 1)];
      foreach r in array baldes loop
        sorteio := sorteio - (pesos->>r)::int;
        if sorteio <= 0 then escolhido := r; exit; end if;
      end loop;
      lista := pool -> escolhido;
      escolhida := nullif(lista ->> floor(random() * jsonb_array_length(lista))::int, '')::bigint;
      if escolhida is not null then
        -- ANTES do credito: depois do jsonb_set toda carta esta' na Colecao.
        nova := coalesce((col->>escolhida::text)::int, 0) = 0;
        col := jsonb_set(col, array[escolhida::text],
                         to_jsonb(coalesce((col->>escolhida::text)::int, 0) + 1), true);
        sorteadas := sorteadas || to_jsonb(escolhida);
        drops := drops || jsonb_build_object('id', escolhida,
                                             'raridade', escolhido,
                                             'nova', nova);
      end if;
    end loop;
  elsif assinatura is not null then
    -- Sem pool configurado o premio e' o de antes (a assinatura), e ai' nao ha'
    -- gaveta nenhuma para ler: cai na raridade dos BOOSTERS, a mesma que o
    -- Inventario usa para precificar a carta.
    nova := coalesce((col->>assinatura::text)::int, 0) = 0;
    select dados into boosters from public.conteudo where chave = 'boosters';
    col := jsonb_set(col, array[assinatura::text],
                     to_jsonb(coalesce((col->>assinatura::text)::int, 0) + 1), true);
    sorteadas := jsonb_build_array(assinatura);
    drops := jsonb_build_array(
               jsonb_build_object('id', assinatura,
                                  'raridade', public.raridade_da_carta(boosters, assinatura::text),
                                  'nova', nova));
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  -- `carta` (singular) e `cartas` continuam saindo iguais para nao quebrar
  -- cliente antigo; `drops` e' o mesmo sorteio com a gaveta e o "e' nova".
  return jsonb_build_object('premio', premio,
                            'carta', sorteadas->0,
                            'cartas', sorteadas,
                            'drops', drops,
                            'carteira', w);
end;
$$;

grant execute on function public.premiar_vitoria(uuid) to authenticated;
