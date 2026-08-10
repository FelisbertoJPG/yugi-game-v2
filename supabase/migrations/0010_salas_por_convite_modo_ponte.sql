-- Exportada de supabase_migrations.schema_migrations (versao 20260810022855).
-- Aplicada no banco em 2026-08-10; arquivo gravado depois. Ver OQ-FALTOU.md item 0.

-- ============================================================================
-- MODO PONTE: sala por link, sem fila.
--
-- Um jogador cria a sala e manda o link; o outro entra. Enquanto a arena nao
-- existe, quem hospeda roda o duelo na propria maquina e o navegador dele faz a
-- ponte com o Supabase Realtime — o convidado nunca precisa alcancar o PC do
-- host (nada de NAT, nada de tunel).
--
-- O PRECO, e nao da' para disfarcar: no modo ponte o host executa o motor, logo
-- ve' a mao do adversario na propria memoria e decide o resultado. Por isso
-- `modo` fica gravado na partida: partida de ponte NAO pode valer DP nem
-- ranking. Quando a arena entrar, ela grava 'arena' e ai' sim vale.
-- ============================================================================

alter table public.partidas
  add column if not exists modo text not null default 'arena'
    check (modo in ('arena', 'ponte')),
  add column if not exists host uuid references auth.users(id) on delete set null,
  add column if not exists convite text unique;

comment on column public.partidas.modo is
  'arena = servidor autoritativo (vale premio). ponte = um jogador hospeda (nao vale).';
comment on column public.partidas.convite is
  'Codigo curto do link. Fica NULL assim que alguem entra, para o link nao ser reutilizavel.';

-- O jogador_b so' e' conhecido quando o convidado entra.
alter table public.partidas alter column jogador_b drop not null;
alter table public.partidas alter column deck_b   drop not null;
alter table public.partidas alter column ydk_b    drop not null;

-- O check de "jogadores diferentes" precisa tolerar b nulo.
alter table public.partidas drop constraint if exists partidas_check;
alter table public.partidas add constraint partidas_jogadores_diferentes
  check (jogador_b is null or jogador_a <> jogador_b);

/**
 * Cria uma sala por convite e devolve o codigo do link.
 */
create or replace function public.criar_sala(p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid(); meu_ydk text; codigo text; nova uuid;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  -- 8 hex = 4 bilhoes de combinacoes. O link nao e' segredo de longa duracao:
  -- vira NULL no primeiro que entrar.
  codigo := encode(gen_random_bytes(4), 'hex');

  insert into public.partidas (jogador_a, deck_a, ydk_a, seed, modo, host, convite)
  values (uid, p_deck, meu_ydk, (random() * 9223372036854775807)::bigint,
          'ponte', uid, codigo)
  returning id into nova;

  return jsonb_build_object('partida', nova, 'convite', codigo);
end;
$$;

/**
 * Entra numa sala pelo codigo do link.
 *
 * O `for update` + a checagem de `jogador_b is null` fecham a corrida de duas
 * pessoas abrindo o mesmo link ao mesmo tempo: a segunda encontra a vaga ja
 * tomada em vez de sobrescrever a primeira.
 */
create or replace function public.entrar_na_sala(p_convite text, p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid(); meu_ydk text; sala record;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  select * into sala from public.partidas
   where convite = p_convite and estado = 'aguardando'
   for update;

  if sala is null then raise exception 'convite invalido ou ja usado'; end if;
  if sala.jogador_b is not null then raise exception 'esta sala ja esta cheia'; end if;
  if sala.jogador_a = uid then raise exception 'voce nao pode duelar contra si mesmo'; end if;

  update public.partidas
     set jogador_b = uid, deck_b = p_deck, ydk_b = meu_ydk,
         convite = null,                       -- queima o link
         estado = 'em_andamento'
   where id = sala.id;

  return jsonb_build_object('partida', sala.id);
end;
$$;

-- Ler a sala pelo CONVITE, antes de entrar: quem recebeu o link precisa ver
-- contra quem vai jogar. So' o codigo exato serve — nao da' para listar salas.
create or replace function public.espiar_sala(p_convite text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare sala record; nome text;
begin
  select p.id, p.jogador_a, p.estado, p.jogador_b into sala
    from public.partidas p where p.convite = p_convite;
  if sala is null then return jsonb_build_object('existe', false); end if;

  select usuario into nome from public.perfis where id = sala.jogador_a;
  return jsonb_build_object('existe', true, 'anfitriao', nome,
                            'cheia', sala.jogador_b is not null,
                            'estado', sala.estado);
end;
$$;

grant execute on function public.criar_sala(text)            to authenticated;
grant execute on function public.entrar_na_sala(text, text)  to authenticated;
grant execute on function public.espiar_sala(text)           to anon, authenticated;
