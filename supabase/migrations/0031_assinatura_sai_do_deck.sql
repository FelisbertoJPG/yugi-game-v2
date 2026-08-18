-- ============================================================================
-- A CARTA DE ASSINATURA SAI DO DECK QUANDO O REGISTRO NAO TEM
--
-- Sintoma: "ganhei e nao veio carta nenhuma". Sem pool de drop configurado, o
-- `premiar_vitoria` cai no premio antigo — a carta de ASSINATURA do adversario,
-- lida de `conteudo/npcs -> signatureId`. So' que nenhum adversario tem esse
-- campo la': quem calcula a assinatura e' o FRONT, a partir do `#signature` do
-- `.ydk` do deck ativo. O servidor nao via nada, `assinatura` vinha null e a
-- vitoria pagava so' DP, sem uma carta sequer — e nada acusava.
--
-- Os 3 NPCs fixos (kaiba/joey/yugi) sao `const` no codigo do front e NEM
-- APARECEM no array `conteudo/npcs`, entao para eles o registro nunca existiu.
--
-- A correcao le' o `#signature` do proprio deck, que e' onde a informacao mora
-- de verdade e ja' esta' no banco (`decks_npc`). Preferindo o deck ATIVO
-- publicado (`conteudo/npc-deck-ativo`, migration 0030) e caindo no primeiro em
-- ordem alfabetica — a MESMA ordem que o front usa para escolher o padrao.
--
-- O registro continua tendo a ultima palavra: `signatureId` preenchido vence o
-- deck. E' o que permite um adversario largar de premio uma carta que ele nem
-- joga.
-- ============================================================================

create or replace function public.assinatura_do_npc(p_npc text)
returns bigint language plpgsql stable
set search_path = public as $$
declare ativo text; ydk text; achado text;
begin
  -- 1. o deck ATIVO publicado, se houver.
  select dados -> p_npc ->> 'nome' into ativo
    from public.conteudo where chave = 'npc-deck-ativo';

  -- O `npc-deck-ativo` guarda o nome de EXIBICAO do deck ("Guardiao do Portao"),
  -- que e' o `#name` de dentro do .ydk; a coluna `nome` de `decks_npc` e' o SLUG
  -- ("guardiao_do_portao"). Casar so' pela coluna erra em silencio e cai no
  -- primeiro deck da ordem alfabetica — que e' justamente o outro.
  if ativo is not null then
    select d.ydk into ydk from public.decks_npc d
     where d.npc = p_npc
       and (btrim(coalesce(substring(d.ydk from '#name[[:space:]]*([^' || chr(10) || chr(13) || ']+)'), '')) = ativo
            or d.nome = ativo)
     limit 1;
  end if;

  -- 2. senao, o primeiro em ordem alfabetica — o mesmo padrao do front.
  if ydk is null then
    select d.ydk into ydk from public.decks_npc d
     where d.npc = p_npc order by d.nome limit 1;
  end if;

  if ydk is null then return null; end if;

  -- `#signature 12345678` numa linha propria do .ydk.
  achado := substring(ydk from '#signature[[:space:]]+([0-9]+)');
  return nullif(achado, '')::bigint;
end;
$$;

grant execute on function public.assinatura_do_npc(text) to authenticated;

-- E o premio passa a usar isso quando o registro nao tiver assinatura.
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
  -- O registro vence; sem ele, o `#signature` do deck.
  assinatura := coalesce(nullif(npc->>'signatureId', '')::bigint,
                         public.assinatura_do_npc(d.npc));

  select dados into cfg from public.conteudo where chave = 'npc-drops';
  pool := cfg -> d.npc -> 'pool';
  qtd := least(greatest(coalesce((cfg -> d.npc ->> 'quantidade')::int, 0), 0), 20);

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

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  return jsonb_build_object('premio', premio,
                            'carta', sorteadas->0,
                            'cartas', sorteadas,
                            'drops', drops,
                            'carteira', w);
end;
$$;

grant execute on function public.premiar_vitoria(uuid) to authenticated;
