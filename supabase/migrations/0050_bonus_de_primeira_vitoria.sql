-- 0050 — BÔNUS DE PRIMEIRA VITÓRIA
--
-- O pool de drops (0027/0028/0033) é a economia CONTÍNUA: sorteio, repetição, e
-- é ela que faz valer a pena duelar de novo. Faltava o contrário — um prêmio
-- FIXO, garantido e uma vez só, para dar ao primeiro "eu venci este deck" um
-- peso que sorteio nenhum vai ter.
--
-- A configuração mora na MESMA chave de sempre (`conteudo/npc-drops`), dentro
-- do deck, sem coluna nova:
--
--     decks: { "guardiao_do_portao": {
--       quantidade: 3, pool: {...},
--       bonus: { cartas: [{id, qtd}],
--                itens:  [{tipo:'icone'|'estrutural', id}] } } }
--
-- **"Primeira vitória" não precisou de coluna nova.** `premiar_vitoria` já
-- carimba `duelos.premiado_em`, e ela só é chamada quando o jogador vence:
-- então "é a primeira" é simplesmente *não existe outro duelo meu contra este
-- NPC e este DECK já premiado*. Uma coluna `bonus_pago` seria uma segunda
-- verdade sobre o mesmo fato, e as duas se desencontrariam no primeiro duelo
-- que falhasse no meio.
--
-- Duas decisões editoriais, tomadas com o dono do jogo:
--   • ganhar um Deck Estrutural CONTA como compra (entra em
--     `compras_estruturais`), então ele passa a aparecer como adquirido na Loja
--     e a trava de 1 por conta continua valendo;
--   • item que o jogador já tem é PULADO em silêncio — o resto do bônus é
--     entregue normalmente. Vitória nenhuma pode ser negada por causa de um
--     prêmio repetido.

-- ---------------------------------------------------------------------------
-- 1. A ENTREGA de um estrutural, extraída para um lugar só.
--
-- Ela já existia dentro de `comprar_deck_estrutural`; agora o bônus precisa da
-- MESMA entrega sem cobrar DP. Copiar o corpo criaria duas verdades sobre o que
-- é "receber um estrutural" — e a segunda envelheceria calada no dia em que a
-- primeira ganhasse um passo (foi assim que este projeto pagou caro com
-- `chancesDe` × `chancesDoPacote`).
--
-- **Ela nunca levanta exceção**: devolve `null` quando não dá para entregar
-- (deck inexistente, incompleto, ou já comprado). Quem cobra DP faz as próprias
-- conferências antes, com as mensagens boas; quem premia uma vitória não pode
-- derrubar a premiação inteira por causa de um item torto.
create or replace function public.entregar_estrutural(p_uid uuid, p_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d      record;
  v      jsonb;
  col    jsonb;
  r      record;
  v_nome text;
  n      int := 1;
begin
  if p_uid is null or p_id is null then return null; end if;

  select * into d from public.decks_estruturais where id = p_id;
  if d is null then return null; end if;

  -- Deck incompleto não é entregue nem de graça: ele cairia em `decks_jogador`
  -- como um deck que o jogador não consegue usar, e o motor recusaria na porta.
  v := public.validar_deck_estrutural(d.ydk);
  if not (v->>'ok')::boolean then return null; end if;

  -- Já é dele: pula. É a trava de 1 por conta, e ela vale igual para o caminho
  -- de graça — senão o bônus seria a porta dos fundos dela.
  if exists (select 1 from public.compras_estruturais c
              where c.usuario_id = p_uid and c.deck_id = p_id) then
    return null;
  end if;

  select coalesce(dados->'collection', '{}'::jsonb) into col
    from public.carteiras where usuario_id = p_uid;
  if col is null then return null; end if;   -- sem carteira não há onde creditar

  for r in select id, count(*)::int as qtd from public.ydk_cartas(d.ydk) group by id loop
    col := jsonb_set(col, array[r.id::text],
                     to_jsonb(coalesce((col->>r.id::text)::int, 0) + r.qtd), true);
  end loop;

  update public.carteiras
     set dados = dados || jsonb_build_object('collection', col)
   where usuario_id = p_uid;

  -- O nome do deck do jogador não pode colidir com um que ele já tenha.
  v_nome := d.nome;
  while exists (select 1 from public.decks_jogador dj
                 where dj.usuario_id = p_uid and dj.nome = v_nome) loop
    n := n + 1;
    v_nome := d.nome || ' ' || n;
  end loop;

  insert into public.decks_jogador (usuario_id, nome, ydk) values (p_uid, v_nome, d.ydk);
  insert into public.compras_estruturais (usuario_id, deck_id, nome_do_deck)
  values (p_uid, p_id, v_nome);

  return jsonb_build_object('tipo', 'estrutural', 'id', d.id,
                            'nome', d.nome, 'deck', v_nome);
end;
$$;

revoke all on function public.entregar_estrutural(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A compra passa a usar a entrega acima — uma implementação só.
create or replace function public.comprar_deck_estrutural(p_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  d   record;
  v   jsonb;
  w   jsonb;
  dp  int;
  ent jsonb;
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

  -- O DP sai ANTES da entrega: a entrega mexe na mesma carteira (a coleção), e
  -- gravar o desconto depois dela sobrescreveria as cartas recém-creditadas.
  update public.carteiras
     set dados = dados || jsonb_build_object('dp', dp - d.preco)
   where usuario_id = uid;

  ent := public.entregar_estrutural(uid, p_id);
  if ent is null then
    raise exception 'nao consegui entregar o deck "%"', p_id;
  end if;

  w := public.carteira_minha();
  return jsonb_build_object('ok', true, 'deck', ent->>'deck',
                            'preco', d.preco, 'carteira', w);
end;
$$;

revoke all on function public.comprar_deck_estrutural(text) from public, anon;
grant execute on function public.comprar_deck_estrutural(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. `premiar_vitoria` paga o bônus na PRIMEIRA vitória contra aquele deck.
create or replace function public.premiar_vitoria(p_duelo uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  -- bônus de primeira vitória
  bonus jsonb; primeira boolean := false; c record; it record;
  itens jsonb := '[]'::jsonb; entregue jsonb;
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

  if d.deck_npc is not null
     and coalesce(doNpc -> 'decks', '{}'::jsonb) ? d.deck_npc then
    escolhidoCfg := doNpc -> 'decks' -> d.deck_npc;
  else
    escolhidoCfg := doNpc;
  end if;

  -- Os boosters saem daqui de cima porque o BÔNUS também precisa deles para
  -- dizer a raridade de cada carta na tela de fim de duelo. Antes eles só eram
  -- lidos dentro do ramo da assinatura.
  select dados into boosters from public.conteudo where chave = 'boosters';

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
    col := jsonb_set(col, array[assinatura::text],
                     to_jsonb(coalesce((col->>assinatura::text)::int, 0) + 1), true);
    sorteadas := jsonb_build_array(assinatura);
    drops := jsonb_build_array(
               jsonb_build_object('id', assinatura,
                                  'raridade', public.raridade_da_carta(boosters, assinatura::text),
                                  'nova', nova));
  end if;

  chanceIcone := least(greatest(coalesce((escolhidoCfg ->> 'chanceIcone')::int, 0), 0), 100);

  if chanceIcone > 0 then
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

      select jsonb_build_object('id', x.id, 'nome', x.nome,
                                'imagem', x.imagem, 'raridade', x.raridade)
        into icone
        from public.icones x where x.id = icone_id;
    end if;
  end if;

  -- ------------------------------------------------- BÔNUS DE PRIMEIRA VITÓRIA
  bonus := escolhidoCfg -> 'bonus';
  if bonus is not null and jsonb_typeof(bonus) = 'object' then
    -- É a primeira? Não existe outro duelo MEU contra este NPC e este DECK que
    -- já tenha sido premiado. `is not distinct from` porque `deck_npc` pode ser
    -- nulo (adversário sem deck escolhido), e `null = null` seria falso — o
    -- bônus sairia toda vitória.
    primeira := not exists (
      select 1 from public.duelos x
       where x.usuario_id = uid
         and x.npc = d.npc
         and x.deck_npc is not distinct from d.deck_npc
         and x.premiado_em is not null
         and x.id <> d.id);
  end if;

  if primeira then
    for c in select (e->>'id')::bigint as id,
                    least(greatest(coalesce((e->>'qtd')::int, 1), 1), 3) as qtd
               from jsonb_array_elements(coalesce(bonus -> 'cartas', '[]'::jsonb)) e
              where (e->>'id') ~ '^[0-9]+$'
    loop
      nova := coalesce((col->>c.id::text)::int, 0) = 0;
      col := jsonb_set(col, array[c.id::text],
                       to_jsonb(coalesce((col->>c.id::text)::int, 0) + c.qtd), true);
      -- Uma entrada por CÓPIA: a tela de fim de duelo revela carta a carta, e
      -- duas cópias têm de virar duas viradas. O selo de "nova" só vale para a
      -- primeira delas — a segunda, por definição, já não é.
      for i in 1..c.qtd loop
        sorteadas := sorteadas || to_jsonb(c.id);
        drops := drops || jsonb_build_object(
          'id', c.id,
          'raridade', public.raridade_da_carta(boosters, c.id::text),
          'nova', nova and i = 1,
          'bonus', true);
      end loop;
    end loop;
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  -- Os ITENS vêm DEPOIS da gravação da carteira, e não por organização: a
  -- entrega de um estrutural credita as cartas dele na mesma carteira, por
  -- conta própria. Fazendo antes, o `update` acima apagaria o que ela creditou.
  if primeira then
    for it in select e->>'tipo' as tipo, e->>'id' as id
                from jsonb_array_elements(coalesce(bonus -> 'itens', '[]'::jsonb)) e
    loop
      if it.tipo = 'icone' then
        -- Item repetido é PULADO em silêncio (decisão editorial): quem já tem o
        -- ícone leva o resto do bônus normalmente.
        if exists (select 1 from public.icones x where x.id = it.id and not x.gratuito)
           and not exists (select 1 from public.icones_do_jogador j
                            where j.icone_id = it.id and j.usuario_id = uid) then
          insert into public.icones_do_jogador (usuario_id, icone_id)
          values (uid, it.id) on conflict do nothing;
          itens := itens || (select jsonb_build_object('tipo', 'icone', 'id', x.id,
                                                       'nome', x.nome, 'imagem', x.imagem,
                                                       'raridade', x.raridade)
                               from public.icones x where x.id = it.id);
        end if;
      elsif it.tipo = 'estrutural' then
        entregue := public.entregar_estrutural(uid, it.id);
        if entregue is not null then itens := itens || entregue; end if;
      end if;
      -- Tipo desconhecido cai fora sem erro: um cliente novo configurando um
      -- tipo que este banco ainda não sabe pagar não pode derrubar a vitória.
    end loop;

    -- Reler: o estrutural mexeu na carteira depois do `update` lá em cima.
    w := public.carteira_minha();
  end if;

  return jsonb_build_object('premio', premio,
                            'carta', sorteadas->0,
                            'cartas', sorteadas,
                            'drops', drops,
                            'icone', icone,
                            'bonus', primeira,
                            'bonusItens', itens,
                            'carteira', w);
end;
$$;

revoke all on function public.premiar_vitoria(uuid) from public, anon;
grant execute on function public.premiar_vitoria(uuid) to authenticated;
