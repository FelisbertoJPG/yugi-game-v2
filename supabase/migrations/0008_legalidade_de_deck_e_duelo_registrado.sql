-- Exportada de supabase_migrations.schema_migrations (versao 20260810013555).
-- Aplicada no banco em 2026-08-10; arquivo gravado depois. Ver OQ-FALTOU.md item 0.

-- ============================================================================
-- 1) LEGALIDADE DE DECK no servidor  2) PREMIO PRESO A UM DUELO REGISTRADO
--
-- O que faltava depois da 0004/0005: o banco conferia POSSE mas nao LEGALIDADE
-- (salvei um deck de 0 cartas e outro com 4 copias da mesma), e `premiar_vitoria`
-- podia ser chamada em laco — 5 chamadas seguidas viraram 2000 -> 2500 DP, o que
-- anulava todo o resto: nao adianta sortear o pacote no servidor se o jogador
-- imprime a moeda para compra-lo.
-- ============================================================================

-- --------------------------------------------------- parser .ydk por secao
-- `#main` / `#extra` / `!side`. Antes so' existia uma funcao que ignorava as
-- secoes, o que bastava para contar posse mas nao para conferir tamanho.
create or replace function public.ydk_por_secao(p_ydk text)
returns table(secao text, id bigint) language plpgsql immutable
set search_path = public as $$
declare l text; atual text := 'main';
begin
  foreach l in array regexp_split_to_array(coalesce(p_ydk, ''), E'\r?\n') loop
    l := trim(l);
    continue when l = '';
    if l ilike '#extra%'      then atual := 'extra'; continue; end if;
    if l ilike '!side%'       then atual := 'side';  continue; end if;
    if l ilike '#main%'       then atual := 'main';  continue; end if;
    if left(l, 1) in ('#', '!') then continue; end if;   -- comentario/diretiva
    if l ~ '^[0-9]{1,10}$' then
      secao := atual; id := l::bigint; return next;
    end if;
  end loop;
end;
$$;

/**
 * Salva o deck do jogador. Confere, nesta ordem: POSSE, TAMANHO, COPIAS,
 * BANLIST e LISTA (pool permitido).
 *
 * As tres ultimas viviam so' no cliente (`deck.js`, `banlist.js`, `lista1.js`),
 * onde o conferido e' quem confere.
 */
create or replace function public.salvar_deck(p_nome text, p_ydk text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  col jsonb; banlist jsonb; lista jsonb;
  n_main int; n_extra int; n_side int;
  falta text[] := '{}';
  problemas text[] := '{}';
  r record;
  teto int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'deck sem nome'; end if;
  if length(p_ydk) > 100000 then raise exception 'deck grande demais'; end if;

  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  -- 1. TAMANHO (regra oficial, a mesma de deck.js)
  if n_main < 40 or n_main > 60 then
    problemas := problemas || format('main tem %s cartas (precisa de 40 a 60)', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

  col := coalesce(public.carteira_minha()->'collection', '{}'::jsonb);
  select dados into banlist from public.conteudo where chave = 'banlist';
  select dados into lista   from public.conteudo where chave = 'lista1';

  for r in
    select id, count(*)::int as pedidas from public.ydk_por_secao(p_ydk) group by id
  loop
    -- 2. POSSE
    if coalesce((col->>r.id::text)::int, 0) < r.pedidas then
      falta := falta || format('%s (tem %s, pediu %s)',
                               r.id, coalesce((col->>r.id::text)::int, 0), r.pedidas);
    end if;

    -- 3. TETO DE COPIAS: 3 por padrao, menos se a banlist limitar esta carta.
    teto := least(3, coalesce((banlist->'cardLimits'->>r.id::text)::int, 3));
    if r.pedidas > teto then
      problemas := problemas || format('%s: %s copias (max %s)', r.id, r.pedidas, teto);
    end if;

    -- 4. POOL PERMITIDO. `lista1` e' publicado pelo tools/publicar-conteudo.mjs
    --    (a regra depende do banco de cartas, que nao vive aqui). Sem a chave
    --    publicada nao ha' o que conferir — e recusar tudo seria pior.
    if lista is not null and not (lista @> to_jsonb(r.id)) then
      problemas := problemas || format('%s nao esta na lista permitida', r.id);
    end if;
  end loop;

  if array_length(falta, 1) > 0 then
    raise exception 'cartas que voce nao possui: %', array_to_string(falta, ', ');
  end if;
  if array_length(problemas, 1) > 0 then
    raise exception 'deck invalido: %', array_to_string(problemas[1:5], '; ');
  end if;

  insert into public.decks_jogador (usuario_id, nome, ydk)
  values (uid, p_nome, p_ydk)
  on conflict (usuario_id, nome) do update
    set ydk = excluded.ydk, atualizado_em = now();

  return jsonb_build_object('ok', true, 'nome', p_nome,
                            'main', n_main, 'extra', n_extra, 'side', n_side);
end;
$$;


-- ------------------------------------------------------- duelo registrado
create table if not exists public.duelos (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  npc          text,
  iniciado_em  timestamptz not null default now(),
  premiado_em  timestamptz
);

comment on table public.duelos is
  'Um duelo aberto pelo jogador. O premio consome a linha, uma vez so.';

create index if not exists duelos_por_usuario on public.duelos (usuario_id, iniciado_em desc);

alter table public.duelos enable row level security;
revoke all on public.duelos from anon, authenticated;
grant select on public.duelos to authenticated;

create policy duelos_ler_proprio on public.duelos
  for select using (usuario_id = auth.uid());

/**
 * Abre um duelo. O cliente chama ANTES de comecar; o id volta e so' ele
 * destrava o premio depois.
 */
create or replace function public.iniciar_duelo(p_npc text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); novo uuid; abertos int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- Teto de duelos abertos na ultima hora: sem isto, abrir 500 duelos e
  -- premiar todos seria o mesmo laco de antes, com um passo a mais.
  select count(*) into abertos from public.duelos
   where usuario_id = uid and iniciado_em > now() - interval '1 hour';
  if abertos >= 60 then raise exception 'muitos duelos iniciados nesta hora'; end if;

  insert into public.duelos (usuario_id, npc) values (uid, p_npc) returning id into novo;
  return novo;
end;
$$;

/**
 * Premia a vitoria, consumindo o duelo.
 *
 * IMPORTANTE, e nao da' para disfarcar: isto NAO prova a vitoria. O duelo roda
 * no ocgcore da maquina do jogador e o servidor nao o ve'. O que estas travas
 * fazem e' transformar "laco no console" em trabalho:
 *
 *   - o premio exige um duelo REGISTRADO por este mesmo jogador;
 *   - cada duelo paga UMA vez (`premiado_em`);
 *   - um duelo nao acaba em menos de 30s, entao premiar antes disso e' recusado;
 *   - teto de 60 duelos por hora.
 *
 * A solucao de verdade e' o duelo rodar no servidor, que e' outro projeto.
 */
create or replace function public.premiar_vitoria(p_duelo uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  d record; w jsonb; npcs jsonb; npc jsonb;
  premio int; assinatura bigint; col jsonb;
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

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);
  if assinatura is not null then
    col := jsonb_set(col, array[assinatura::text],
                     to_jsonb(coalesce((col->>assinatura::text)::int, 0) + 1), true);
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  return jsonb_build_object('premio', premio, 'carta', assinatura, 'carteira', w);
end;
$$;

-- A versao antiga (premiar por NOME de npc, sem duelo) tem de sumir: enquanto
-- existisse, seria so' chama-la em vez desta.
drop function if exists public.premiar_vitoria(text);

revoke all on function public.ydk_por_secao(text) from public, anon, authenticated;
grant execute on function public.iniciar_duelo(text)    to authenticated;
grant execute on function public.premiar_vitoria(uuid)  to authenticated;
grant execute on function public.salvar_deck(text,text) to authenticated;
