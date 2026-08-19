-- ============================================================================
-- QUAL DECK DO ADVERSARIO FOI ENFRENTADO — E O DROP QUE SAI DELE
--
-- Ate' aqui um duelo registrava so' CONTRA QUEM (`duelos.npc`). Bastava, porque
-- o premio tambem era por adversario. Agora nao basta mais: cada deck de um NPC
-- tem a sua propria dificuldade, o seu proprio pool de drop, e destranca o
-- proximo deck ao ser derrotado. Sem saber QUAL deck caiu:
--
--   • o pool sorteado seria sempre o mesmo, e destrancar o deck dificil nao
--     daria premio melhor nenhum — tirando o unico motivo de encara-lo;
--   • a trilha de decks nunca abriria o segundo, porque "venci o Para & Dox"
--     nao diz se foi com o Labirinto ou com o Guardiao do Portao.
--
-- Por isso a coluna `deck_npc` (o NOME do deck, a mesma chave do deck ativo na
-- 0030 e do `#libera` no .ydk — nao o indice, que troca de significado quando um
-- deck novo entra).
--
-- A resolucao do pool e' a MESMA do cliente (`dropsDoDeck` em web/js/drops.js):
-- o pool do deck primeiro, o pool do NPC como reserva. A reserva nao e' apego ao
-- passado — e' o que faz um deck recem-criado ja' nascer dropando, e o que
-- impede que criar um segundo deck apague o premio do primeiro.
--
--     { "para_dox": {
--         "quantidade": 1, "pool": {...},                    <- a reserva
--         "decks": { "Guardiao do Portao": {"quantidade": 3, "pool": {...}} }
--     } }
--
-- Duelo antigo (sem `deck_npc`) cai na reserva, que e' exatamente o que ele
-- sempre teve. Cliente antigo (o .exe ainda nao atualizado) nao manda o campo e
-- continua funcionando igual.
-- ============================================================================

alter table public.duelos add column if not exists deck_npc text;

comment on column public.duelos.deck_npc is
  'Nome do deck do NPC enfrentado. Resolve o pool de drop e a liberacao do proximo deck. Nulo nos duelos anteriores a 0033.';

-- ---------------------------------------------------------------------------
-- iniciar_duelo: mais um parametro.
--
-- DROP + CREATE, e nao um `create or replace` com default: adicionar parametro
-- cria SOBRECARGA, e ai' o PostgREST tem duas funcoes candidatas para a mesma
-- chamada. A 0018 ja' pagou esse preco uma vez (a correcao valeu para ninguem
-- porque o cliente publicado caia na versao velha) — a nota de la' vale aqui.
-- ---------------------------------------------------------------------------
drop function if exists public.iniciar_duelo(text, text);

create or replace function public.iniciar_duelo(p_npc text,
                                                p_deck text default null,
                                                p_deck_npc text default null)
returns uuid language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); novo uuid; abertos int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  update public.duelos
     set resultado = 'abandonado', encerrado_em = now()
   where usuario_id = uid and resultado is null;

  select count(*) into abertos from public.duelos
   where usuario_id = uid and iniciado_em > now() - interval '1 hour';
  if abertos >= 60 then raise exception 'muitos duelos iniciados nesta hora'; end if;

  insert into public.duelos (usuario_id, npc, deck, deck_npc)
  values (uid, p_npc, p_deck, nullif(btrim(coalesce(p_deck_npc, '')), ''))
  returning id into novo;
  return novo;
end;
$$;

revoke all on function public.iniciar_duelo(text, text, text) from public, anon;
grant execute on function public.iniciar_duelo(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- premiar_vitoria: o pool sai do DECK enfrentado.
--
-- Tudo o mais e' identico a' 0029 — inclusive `cartas`/`carta` saindo iguais
-- para o cliente antigo, e o `drops` com gaveta e "e' nova".
--
-- O deck vem da TABELA (`d.deck_npc`), nunca de um parametro: o duelo roda na
-- maquina do jogador, e deixar a chamada escolher o pool seria deixa-lo
-- escolher o proprio premio — a mesma razao de o sorteio morar aqui.
-- ---------------------------------------------------------------------------
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
