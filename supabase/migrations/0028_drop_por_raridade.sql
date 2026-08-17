-- ============================================================================
-- DROP POR RARIDADE
--
-- O 0027 sorteava uniforme dentro de UMA lista: 20 cartas, 5% cada. Isso faz
-- toda carta do pool valer o mesmo — a UR de assinatura sai tanto quanto o
-- Normal de enchimento, e o premio deixa de ter graduacao nenhuma.
--
-- Agora o pool e' dividido em QUATRO GAVETAS e o sorteio tem dois passos:
--
--     { "yugi": { "quantidade": 3,
--                 "pool": { "UR": [...], "SR": [...], "R": [...], "N": [...] } } }
--
--   1. a RARIDADE, pelos pesos abaixo, renormalizados entre as gavetas que
--      REALMENTE tem carta (senao um pool so' de N teria 48% de chance de nao
--      dar nada);
--   2. a CARTA, uniforme dentro da gaveta sorteada.
--
-- Os pesos NAO sao os `PACK_ODDS` do booster (4 UR em 1000). La' o jogador abre
-- dezenas de pacotes e a raridade extrema e' o que da' graca; aqui ele ganha 1 a
-- 3 cartas por duelo, e uma UR a 0,4% simplesmente nunca apareceria — a
-- raridade deixaria de ser rara para ser inexistente. Os mesmos numeros estao em
-- `DROP_ODDS` (web/js/drops.js), que e' quem mostra a % na tela do editor.
--
-- QUEM MANDA E' A GAVETA GRAVADA, e nao a raridade que a carta tem nos boosters:
-- o servidor le' o JSON como esta'. E' o que deixa o editor por adversario dizer
-- "este aqui larga um Normal como premio raro" sem mexer na Loja.
--
-- Compativel com o formato ANTIGO (pool como lista simples): ele vira a gaveta
-- N, que e' onde quem nao esta' em booster nenhum ja' caia.
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
        col := jsonb_set(col, array[escolhida::text],
                         to_jsonb(coalesce((col->>escolhida::text)::int, 0) + 1), true);
        sorteadas := sorteadas || to_jsonb(escolhida);
      end if;
    end loop;
  elsif assinatura is not null then
    col := jsonb_set(col, array[assinatura::text],
                     to_jsonb(coalesce((col->>assinatura::text)::int, 0) + 1), true);
    sorteadas := jsonb_build_array(assinatura);
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  -- `carta` (singular) continua saindo para nao quebrar quem ainda le' o campo
  -- antigo; quem manda agora e' `cartas`.
  return jsonb_build_object('premio', premio,
                            'carta', sorteadas->0,
                            'cartas', sorteadas,
                            'carteira', w);
end;
$$;

grant execute on function public.premiar_vitoria(uuid) to authenticated;
