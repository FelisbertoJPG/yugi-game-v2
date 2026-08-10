-- Exportada de supabase_migrations.schema_migrations (versao 20260810015341).
-- Aplicada no banco em 2026-08-10; arquivo gravado depois. Ver OQ-FALTOU.md item 0.

-- ============================================================================
-- ONLINE, fase 1: fila de pareamento e salas.
--
-- Decisao de arquitetura (para quem chegar depois): o duelo vai rodar num
-- SERVIDOR AUTORITATIVO. Nenhum dos dois clientes hospeda o ocgcore, porque o
-- host enxergaria a mao do adversario na propria memoria e decidiria o
-- resultado — o que jogaria fora as travas das migrations 0004-0007.
--
-- Isto aqui NAO roda duelo: e' so' quem-joga-com-quem. O motor entra na fase 2.
-- ============================================================================

-- ------------------------------------------------------------------ fila
create table if not exists public.fila (
  usuario_id  uuid primary key references auth.users(id) on delete cascade,
  deck        text not null,
  entrou_em   timestamptz not null default now()
);

comment on table public.fila is
  'Quem esta procurando duelo. Uma linha por jogador — entrar duas vezes so troca o deck.';

alter table public.fila enable row level security;
revoke all on public.fila from anon, authenticated;
grant select on public.fila to authenticated;

-- Ve' so' a propria linha: a fila nao e' lista publica de quem esta online.
create policy fila_propria on public.fila
  for select using (usuario_id = auth.uid());


-- --------------------------------------------------------------- partidas
create table if not exists public.partidas (
  id            uuid primary key default gen_random_uuid(),
  jogador_a     uuid not null references auth.users(id) on delete cascade,
  jogador_b     uuid not null references auth.users(id) on delete cascade,
  deck_a        text not null,
  deck_b        text not null,
  -- O .ydk e' CONGELADO na criacao. Sem isto, trocar o deck depois do
  -- pareamento mudaria o baralho no meio do caminho.
  ydk_a         text not null,
  ydk_b         text not null,
  seed          bigint not null,
  estado        text not null default 'aguardando'
                check (estado in ('aguardando','em_andamento','encerrada','abandonada')),
  vencedor      uuid references auth.users(id) on delete set null,
  servidor      text,
  criado_em     timestamptz not null default now(),
  encerrada_em  timestamptz,
  check (jogador_a <> jogador_b)
);

comment on table public.partidas is
  'Uma sala de duelo online. O servidor autoritativo pega as que estao aguardando.';

create index if not exists partidas_por_jogador
  on public.partidas (jogador_a, criado_em desc);
create index if not exists partidas_por_jogador_b
  on public.partidas (jogador_b, criado_em desc);
create index if not exists partidas_aguardando
  on public.partidas (estado, criado_em) where estado = 'aguardando';

alter table public.partidas enable row level security;
revoke all on public.partidas from anon, authenticated;
grant select on public.partidas to authenticated;

-- So' os dois participantes. Escrita nenhuma pelo cliente: quem muda o estado
-- e declara vencedor e' o servidor de duelo (fase 4), nunca quem joga.
create policy partidas_dos_participantes on public.partidas
  for select using (jogador_a = auth.uid() or jogador_b = auth.uid());

-- Realtime: e' assim que quem esta esperando na fila descobre que foi pareado.
-- A RLS acima vale para o Realtime tambem, entao ninguem recebe partida alheia.
do $$
begin
  alter publication supabase_realtime add table public.partidas;
exception when duplicate_object then null;
end $$;


-- ------------------------------------------------------------ entrar na fila
/**
 * Entra na fila e, se houver alguem esperando, JA' cria a partida.
 *
 * Devolve `{pareado: true, partida: <id>}` ou `{pareado: false}`.
 *
 * O `for update skip locked` e' o que impede dois jogadores de fisgarem o mesmo
 * oponente ao entrarem no mesmo instante: quem chegar segundo simplesmente nao
 * enxerga a linha travada e continua procurando, em vez de criar uma partida
 * duplicada com um jogador que ja' esta em outra.
 */
create or replace function public.entrar_na_fila(p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  meu_ydk text; outro record; nova uuid;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- O deck tem de ser SEU e ter passado por `salvar_deck` (legalidade, posse,
  -- banlist, Lista 1). Entrar na fila nao e' porta dos fundos para deck ilegal.
  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  -- Ja' estou numa partida em andamento? Entao nao entro em outra.
  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  select f.*, d.ydk into outro
    from public.fila f
    join public.decks_jogador d
      on d.usuario_id = f.usuario_id and d.nome = f.deck
   where f.usuario_id <> uid
   order by f.entrou_em
   for update of f skip locked
   limit 1;

  if outro is null then
    insert into public.fila (usuario_id, deck) values (uid, p_deck)
      on conflict (usuario_id) do update set deck = excluded.deck, entrou_em = now();
    return jsonb_build_object('pareado', false);
  end if;

  -- Quem esperava mais vira o jogador A (comeca o duelo) — recompensa pequena
  -- por ter ficado na fila, e uma regra fixa e' melhor que sortear.
  insert into public.partidas (jogador_a, jogador_b, deck_a, deck_b, ydk_a, ydk_b, seed)
  values (outro.usuario_id, uid, outro.deck, p_deck, outro.ydk, meu_ydk,
          -- Seed do SERVIDOR. Vinda do cliente, daria para procurar uma mao boa.
          (random() * 9223372036854775807)::bigint)
  returning id into nova;

  delete from public.fila where usuario_id in (uid, outro.usuario_id);
  return jsonb_build_object('pareado', true, 'partida', nova);
end;
$$;

create or replace function public.sair_da_fila()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  delete from public.fila where usuario_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

/**
 * Desiste de uma partida ainda nao jogada. Nao serve para fugir de derrota:
 * `em_andamento` so' o servidor de duelo encerra.
 */
create or replace function public.abandonar_partida(p_partida uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  update public.partidas
     set estado = 'abandonada', encerrada_em = now(),
         vencedor = case when jogador_a = uid then jogador_b else jogador_a end
   where id = p_partida
     and estado = 'aguardando'
     and (jogador_a = uid or jogador_b = uid);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

grant execute on function public.entrar_na_fila(text)     to authenticated;
grant execute on function public.sair_da_fila()           to authenticated;
grant execute on function public.abandonar_partida(uuid)  to authenticated;
