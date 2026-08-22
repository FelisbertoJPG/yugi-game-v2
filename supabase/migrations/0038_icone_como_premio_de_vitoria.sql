-- ============================================================================
-- ICONE COMO PREMIO DE VITORIA.
--
-- O pool de drop continua sendo de CARTAS, com as quatro gavetas de raridade e
-- o sorteio de sempre. O icone entra POR FORA dele, com chance propria, e as
-- razoes de nao o enfiar numa gaveta sao tres:
--
--   • carta REPETE e icone nao. Ganhar a segunda copia de uma carta rara e' o
--     jogo funcionando; ganhar o mesmo icone duas vezes e' um premio vazio;
--   • as gavetas ja' significam alguma coisa (a % que a tela promete, calculada
--     por `chancesDe`). Um icone dentro da gaveta UR mudaria essa conta sem
--     mudar o texto — a tela passaria a mentir sem ninguem mexer nela;
--   • um icone e' um evento raro. Ele merece uma chance dita em numero redondo
--     ("5% por vitoria"), nao diluida entre trinta cartas.
--
-- A configuracao fica ao lado do pool, no mesmo lugar por deck:
--
--     { quantidade: 3, pool: {...},
--       icones: ['dourado', 'dragao'], chanceIcone: 5 }
--
-- E o sorteio so' olha os que o jogador AINDA NAO TEM: sem isso, quem ja'
-- completou a colecao continuaria "ganhando" nada com 5% de chance, e a tela
-- de fim de duelo teria de explicar um premio que nao existe.
-- ============================================================================

create or replace function public.premiar_vitoria(p_duelo uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  d record; w jsonb; npcs jsonb; npc jsonb;
  premio int; assinatura bigint; col jsonb;
  cfg jsonb; doNpc jsonb; escolhidoCfg jsonb; pool jsonb; qtd int; i int; escolhida bigint;
  sorteadas jsonb := '[]'::jsonb;
  drops jsonb := '[]'::jsonb;
  nova boolean;
  boosters jsonb;
  pesos jsonb := '{"UR": 4, "SR": 14, "R": 30, "N": 52}'::jsonb;
  baldes text[]; total int; sorteio numeric; r text; escolhido text; lista jsonb;
  chanceIcone int; faltando text[]; icone_id text; icone jsonb := null;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

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
  doNpc := cfg -> d.npc;

  -- O pool do DECK enfrentado; sem ele, o do NPC. A ordem importa: e' ela que
  -- faz o deck dificil valer a pena e, ao mesmo tempo, nao apaga o premio de
  -- quem configurou por NPC antes de existir pool por deck.
  if d.deck_npc is not null
     and coalesce(doNpc -> 'decks', '{}'::jsonb) ? d.deck_npc then
    escolhidoCfg := doNpc -> 'decks' -> d.deck_npc;
  else
    escolhidoCfg := doNpc;
  end if;

  pool := escolhidoCfg -> 'pool';
  qtd := least(greatest(coalesce((escolhidoCfg ->> 'quantidade')::int, 0), 0), 20);

  if jsonb_typeof(pool) = 'array' then
    pool := jsonb_build_object('N', pool);
  end if;

  select array_agg(k order by k) into baldes
    from jsonb_object_keys(coalesce(pool, '{}'::jsonb)) k
   where pesos ? k and jsonb_array_length(pool -> k) > 0;

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);

  if baldes is not null and array_length(baldes, 1) > 0 and qtd > 0 then
    select sum((pesos->>k)::int) into total from unnest(baldes) k;
    for i in 1..qtd loop
      sorteio := random() * total;
      escolhido := baldes[array_length(baldes, 1)];
      foreach r in array baldes loop
        sorteio := sorteio - (pesos->>r)::int;
        if sorteio <= 0 then escolhido := r; exit; end if;
      end loop;
      lista := pool -> escolhido;
      escolhida := nullif(lista ->> floor(random() * jsonb_array_length(lista))::int, '')::bigint;
      if escolhida is not null then
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

  -- ------------------------------------------------------------- o icone
  chanceIcone := least(greatest(coalesce((escolhidoCfg ->> 'chanceIcone')::int, 0), 0), 100);

  if chanceIcone > 0 then
    -- So' os que EXISTEM no catalogo e que o jogador ainda NAO tem. O
    -- cruzamento e' aqui e nao no cliente pelo motivo de sempre: o duelo roda
    -- na maquina dele, e quem decide o premio nao pode ser quem o recebe.
    select array_agg(x.id order by x.id) into faltando
      from jsonb_array_elements_text(coalesce(escolhidoCfg -> 'icones', '[]'::jsonb)) as t(id)
      join public.icones x on x.id = t.id
     where not x.gratuito
       and not exists (select 1 from public.icones_do_jogador j
                        where j.icone_id = x.id and j.usuario_id = uid);

    if faltando is not null and array_length(faltando, 1) > 0
       and random() * 100 < chanceIcone then
      icone_id := faltando[1 + floor(random() * array_length(faltando, 1))::int];

      insert into public.icones_do_jogador (usuario_id, icone_id)
      values (uid, icone_id) on conflict do nothing;

      -- O nome e o arquivo vao junto: a tela de fim de duelo mostra o icone na
      -- hora, e uma segunda consulta so' para descobrir como ele se chama seria
      -- uma ida de rede no meio da comemoracao.
      select jsonb_build_object('id', x.id, 'nome', x.nome,
                                'arquivo', x.arquivo, 'raridade', x.raridade)
        into icone
        from public.icones x where x.id = icone_id;
    end if;
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  -- `icone` e' um campo NOVO no retorno, e nao uma entrada em `drops`: o
  -- cliente antigo desenha cada `drops[i].id` como codigo de CARTA, e um id de
  -- texto ali viraria uma arte quebrada na tela de quem ainda nao atualizou.
  -- Campo novo, ele simplesmente ignora.
  return jsonb_build_object('premio', premio,
                            'carta', sorteadas->0,
                            'cartas', sorteadas,
                            'drops', drops,
                            'icone', icone,
                            'carteira', w);
end;
$$;

grant execute on function public.premiar_vitoria(uuid) to authenticated;
