-- ============================================================================
-- DROP ALEATORIO POR NPC
--
-- Ate' aqui vencer um adversario dava DP + a carta de ASSINATURA dele: sempre a
-- mesma, todas as vezes. Vencer o Yugi pela decima vez entregava a decima copia
-- da mesma carta, o que e' o contrario do que faz querer duelar de novo.
--
-- Agora cada NPC pode ter um POOL de cartas e uma QUANTIDADE de drops por
-- vitoria: pool de 20, quantidade 3, e cada vitoria sorteia 3 dentro dos 20.
--
-- A configuracao mora em `conteudo/npc-drops` (espelhada em
-- `store/npc-drops.json` pela API de sempre do `projectstore.js`):
--
--     { "yugi": { "quantidade": 3, "pool": [46986414, 89631139, ...] } }
--
-- Chave PROPRIA, e nao um campo dentro de `conteudo/npcs`, por um motivo
-- pratico: os 3 NPCs fixos (kaiba/joey/yugi) NAO estao naquele array — eles sao
-- um `const` no codigo com um overlay a' parte. Uma chave por fora vale igual
-- para fixo e customizado, sem mexer na divisao que ja' existe.
--
-- O SORTEIO E' DO SERVIDOR, e nao do cliente, pelo mesmo motivo de tudo nesta
-- pasta: o duelo roda na maquina do jogador, entao o que o cliente manda e'
-- pedido, nao resultado. Sortear no navegador seria deixar escolher o premio.
--
-- COM REPETICAO de proposito: cada drop e' um sorteio independente. Sem isso um
-- pool de 2 com quantidade 3 seria impossivel de resolver, e a regra "sem
-- repetir" cria uma pergunta ("e quando acabar o pool?") que nao tem resposta
-- boa. Repetir tambem e' o que faz uma carta rara no meio de 20 comuns ser
-- rara de verdade.
--
-- Sem pool configurado, o comportamento e' O DE ANTES (a assinatura). Nenhum
-- NPC existente muda de comportamento ate' alguem editar o pool dele.
-- ============================================================================

-- A tabela `conteudo` tem lista BRANCA de chaves (uma tela de admin nao pode
-- inventar chave nova a' vontade), entao a chave do drop precisa entrar nela.
alter table public.conteudo drop constraint if exists conteudo_chave_check;
alter table public.conteudo add constraint conteudo_chave_check check (
  chave in ('banlist', 'boosters', 'npcs', 'npc-base-meta', 'cardlists', 'npc-drops')
  or chave ~ '^lista[a-z0-9-]{0,31}$'
);

create or replace function public.premiar_vitoria(p_duelo uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  d record; w jsonb; npcs jsonb; npc jsonb;
  premio int; assinatura bigint; col jsonb;
  cfg jsonb; pool jsonb; n_pool int; qtd int; i int; escolhida bigint;
  sorteadas jsonb := '[]'::jsonb;
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
  n_pool := coalesce(jsonb_array_length(case when jsonb_typeof(pool) = 'array' then pool end), 0);
  -- Um registro mal editado nao pode virar diluvio: 20 cartas por vitoria ja'
  -- e' generoso, e o teto e' do SERVIDOR porque a tela nao manda nada aqui.
  qtd := least(greatest(coalesce((cfg -> d.npc ->> 'quantidade')::int, 0), 0), 20);

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);

  if n_pool > 0 and qtd > 0 then
    for i in 1..qtd loop
      escolhida := nullif(pool ->> floor(random() * n_pool)::int, '')::bigint;
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
