-- ============================================================================
-- Duel Academy — esquema inicial
--
-- Duas metades com posturas de seguranca OPOSTAS, e e' importante nao mistura-las:
--
--   CONTEUDO DO JOGO  (conteudo, decks_npc, tabuleiros)
--     o admin escreve, TODO MUNDO le' — inclusive sem login. E' o espelho de
--     `store/*.json`, `decks/npc/**.ydk` e `boards/*.json`. Serve pro painel de
--     teste publicar uma banlist ou um deck de NPC novo e o jogador receber sem
--     precisar de Release nenhum (hoje `decks/npc/*.ydk` so' viajam dentro do
--     exe, entao editar o deck do Kaiba nunca chegava em quem ja' instalou).
--
--   DADO DE CONTA  (perfis, carteiras, decks_jogador)
--     cada jogador so' enxerga o proprio. E' a mesma regra que o `UpdateEngine`
--     ja' aplica por codigo com `Intocaveis` — aqui ela vira RLS.
--
-- REGRA QUE NAO PODE SER QUEBRADA: isto e' ESPELHO, nao fonte da verdade. O jogo
-- roda como servidor local e tem que abrir offline (mesma regra do updater:
-- "offline nunca trava o jogo"). O login local continua valendo pra jogar; o
-- Supabase sobe quando ha' rede e desce ao entrar noutra maquina.
--
-- Rodar: SQL Editor -> New query -> colar tudo -> Run.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ------------------------------------------------------------- utilidades

create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;


-- ============================================================================
-- PERFIS — a ponte entre auth.users e o resto
-- ============================================================================

create table public.perfis (
  id             uuid primary key references auth.users(id) on delete cascade,
  usuario        text not null unique
                 check (char_length(usuario) between 3 and 32),
  admin          boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.perfis is
  'Perfil publico de cada conta. `admin` decide quem pode escrever conteudo do jogo.';

create trigger perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.tocar_atualizado_em();

-- Quem e' admin.
--
-- SECURITY DEFINER nao e' frescura aqui: sem ele, uma policy de `perfis` que
-- chamasse esta funcao leria `perfis` de novo, que dispararia a policy de novo —
-- recursao infinita, e o erro que aparece ("infinite recursion detected in
-- policy") nao aponta pra causa.
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select admin from public.perfis where id = auth.uid()), false);
$$;

grant execute on function public.eh_admin() to anon, authenticated;

-- Perfil nasce junto com a conta.
--
-- O laco do nome nao e' preciosismo: se o insert falhasse por nome repetido, o
-- CADASTRO INTEIRO falharia (o trigger roda dentro da transacao do signup), e o
-- sintoma seria "nao consigo criar conta" sem nenhuma pista do motivo.
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  nome text;
begin
  base := coalesce(
            nullif(new.raw_user_meta_data->>'usuario', ''),
            nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
            'duelista');
  base := left(regexp_replace(base, '[^a-zA-Z0-9_-]', '', 'g'), 24);
  if char_length(base) < 3 then base := 'duelista'; end if;

  nome := base;
  while exists (select 1 from public.perfis where usuario = nome) loop
    nome := left(base, 24) || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.perfis (id, usuario) values (new.id, nome);
  return new;
end;
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- Ninguem se promove sozinho. Sem isto, um `PATCH /perfis?id=eq.<meu>` com
-- {"admin":true} pelo DevTools daria a qualquer jogador o poder de reescrever a
-- banlist de todo mundo.
create or replace function public.travar_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.admin is distinct from old.admin and not public.eh_admin() then
    raise exception 'so um admin pode mudar o campo admin';
  end if;
  return new;
end;
$$;

create trigger perfis_travar_admin
  before update on public.perfis
  for each row execute function public.travar_admin();


-- ============================================================================
-- CONTEUDO DO JOGO — admin escreve, todo mundo le'
-- ============================================================================

-- Espelho de `store/*.json`. Documento inteiro por linha, de proposito: e' assim
-- que o front ja' trata esses arquivos (`hydrateBoosters`, `loadNpcDecks` leem o
-- JSON todo), entao normalizar aqui so' criaria uma traducao pra manter.
create table public.conteudo (
  chave           text primary key
                  check (chave in ('banlist', 'boosters', 'npcs', 'npc-base-meta')),
  dados           jsonb not null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null
);

comment on table public.conteudo is
  'store/*.json — banlist, boosters, npcs, npc-base-meta. Um documento por linha.';

create trigger conteudo_atualizado_em
  before update on public.conteudo
  for each row execute function public.tocar_atualizado_em();

-- Espelho de `decks/npc/<npc>/<nome>.ydk`. Guarda o .ydk CRU: e' o formato do
-- ygopro, o mesmo que o ocgcore consome, e nossos metadados vao em comentarios
-- `#chave valor` que qualquer parser ignora. Converter pra colunas aqui seria
-- inventar um segundo formato pra manter em sincronia com o primeiro.
create table public.decks_npc (
  npc             text not null check (char_length(npc) between 1 and 64),
  nome            text not null check (char_length(nome) between 1 and 128),
  ydk             text not null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null,
  primary key (npc, nome)
);

create trigger decks_npc_atualizado_em
  before update on public.decks_npc
  for each row execute function public.tocar_atualizado_em();

-- Espelho de `boards/*.json` (editor de campo).
create table public.tabuleiros (
  nome            text primary key check (char_length(nome) between 1 and 128),
  dados           jsonb not null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null
);

create trigger tabuleiros_atualizado_em
  before update on public.tabuleiros
  for each row execute function public.tocar_atualizado_em();


-- ============================================================================
-- DADO DE CONTA — cada um so' enxerga o seu
-- ============================================================================

create table public.carteiras (
  usuario_id     uuid primary key references auth.users(id) on delete cascade,
  dados          jsonb not null default '{}'::jsonb,
  atualizado_em  timestamptz not null default now()
);

comment on table public.carteiras is
  'Espelho de store/users/<usuario>/wallet.json — DP + colecao.';

create trigger carteiras_atualizado_em
  before update on public.carteiras
  for each row execute function public.tocar_atualizado_em();

create table public.decks_jogador (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  nome           text not null check (char_length(nome) between 1 and 128),
  ydk            text not null,
  atualizado_em  timestamptz not null default now(),
  unique (usuario_id, nome)
);

comment on table public.decks_jogador is
  'Espelho de decks/users/<usuario>/player/*.ydk.';

create index decks_jogador_por_usuario on public.decks_jogador (usuario_id);

create trigger decks_jogador_atualizado_em
  before update on public.decks_jogador
  for each row execute function public.tocar_atualizado_em();


-- ============================================================================
-- RLS
--
-- Ligada em TODAS as tabelas. Sem policy, RLS ligada = ninguem le' nada — e' o
-- padrao seguro: uma tabela nova esquecida fica muda em vez de aberta.
-- ============================================================================

alter table public.perfis          enable row level security;
alter table public.conteudo        enable row level security;
alter table public.decks_npc       enable row level security;
alter table public.tabuleiros      enable row level security;
alter table public.carteiras       enable row level security;
alter table public.decks_jogador   enable row level security;

-- --- perfis
create policy perfis_ler_proprio on public.perfis
  for select using (id = auth.uid() or public.eh_admin());

create policy perfis_atualizar_proprio on public.perfis
  for update using (id = auth.uid() or public.eh_admin())
             with check (id = auth.uid() or public.eh_admin());

-- --- conteudo do jogo: leitura aberta (inclusive anon), escrita so' admin
create policy conteudo_ler_todos on public.conteudo
  for select using (true);
create policy conteudo_escrever_admin on public.conteudo
  for all using (public.eh_admin()) with check (public.eh_admin());

create policy decks_npc_ler_todos on public.decks_npc
  for select using (true);
create policy decks_npc_escrever_admin on public.decks_npc
  for all using (public.eh_admin()) with check (public.eh_admin());

create policy tabuleiros_ler_todos on public.tabuleiros
  for select using (true);
create policy tabuleiros_escrever_admin on public.tabuleiros
  for all using (public.eh_admin()) with check (public.eh_admin());

-- --- dado de conta: so' o dono
create policy carteiras_do_dono on public.carteiras
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create policy decks_jogador_do_dono on public.decks_jogador
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());


-- ============================================================================
-- GRANTS
--
-- RLS e grant sao travas INDEPENDENTES: as duas precisam liberar. O grant diz
-- "esta role pode tentar"; a policy diz "nestas linhas". Faltando o grant, o
-- erro e' "permission denied for table", que nao parece problema de RLS e
-- manda todo mundo depurar a policy errada.
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant select on public.conteudo, public.decks_npc, public.tabuleiros to anon, authenticated;
grant insert, update, delete on public.conteudo, public.decks_npc, public.tabuleiros to authenticated;

grant select, insert, update, delete on public.perfis to authenticated;
grant select, insert, update, delete on public.carteiras to authenticated;
grant select, insert, update, delete on public.decks_jogador to authenticated;


-- ============================================================================
-- CARIMBO — "mudou alguma coisa?" numa consulta so'
--
-- Evita baixar todo o conteudo a cada boot. `security_invoker` porque, sem ele,
-- uma view roda com os direitos do DONO e IGNORA a RLS das tabelas de baixo —
-- aqui nao vazaria nada (o conteudo e' publico mesmo), mas o dia em que alguem
-- copiar este padrao pra uma view de carteira, vaza.
-- ============================================================================

create or replace view public.conteudo_carimbo
with (security_invoker = true) as
select
  max(t.ultimo) as atualizado_em,
  sum(t.n)::bigint as itens
from (
  select max(atualizado_em) as ultimo, count(*) as n from public.conteudo
  union all
  select max(atualizado_em), count(*) from public.decks_npc
  union all
  select max(atualizado_em), count(*) from public.tabuleiros
) t;

grant select on public.conteudo_carimbo to anon, authenticated;
