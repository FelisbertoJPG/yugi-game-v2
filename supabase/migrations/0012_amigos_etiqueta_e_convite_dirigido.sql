-- ============================================================================
-- MULTIPLAYER, fase 2: identidade curta, amizades e convite de 1 clique.
-- ============================================================================

-- ------------------------------------------------------------ 1. ETIQUETA
-- Um numero curto ao lado do nome: [66432] Fulano.
--
-- Existe porque `usuario` e' unico mas nao e' pesquisavel na pratica — ninguem
-- lembra se o amigo e' "joao", "joao2" ou "joaozinho". A etiqueta e' curta,
-- ditavel por telefone e imune a acento e maiuscula.
alter table public.perfis add column if not exists etiqueta int;

create unique index if not exists perfis_etiqueta_unica on public.perfis (etiqueta);

/**
 * Numero livre entre 10000 e 999999 (990 mil combinacoes).
 *
 * Sorteio com repeticao em vez de sequencia de propósito: sequencial entregaria
 * quantas contas o jogo tem e em que ordem cada um entrou.
 */
create or replace function public.gerar_etiqueta()
returns int language plpgsql security definer
set search_path = public as $$
declare n int; tentativas int := 0;
begin
  loop
    n := 10000 + floor(random() * 989999)::int;
    exit when not exists (select 1 from public.perfis where etiqueta = n);
    tentativas := tentativas + 1;
    if tentativas > 200 then
      raise exception 'nao consegui achar uma etiqueta livre';
    end if;
  end loop;
  return n;
end;
$$;

-- Quem ja' existe tambem precisa de etiqueta.
update public.perfis set etiqueta = public.gerar_etiqueta() where etiqueta is null;
alter table public.perfis alter column etiqueta set not null;

-- Perfil novo nasce com ela.
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer
set search_path = public as $$
declare base text; nome text;
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

  insert into public.perfis (id, usuario, etiqueta)
  values (new.id, nome, public.gerar_etiqueta());
  return new;
end;
$$;

revoke all on function public.gerar_etiqueta() from public, anon, authenticated;
revoke all on function public.criar_perfil()   from public, anon, authenticated;


-- -------------------------------------------------------------- 2. BUSCA
/**
 * Procura jogador por ETIQUETA (numero exato) ou por NOME (comeca com).
 *
 * SECURITY DEFINER porque a RLS de `perfis` so' deixa cada um ver a propria
 * linha — e tem de continuar assim. Esta funcao e' a UNICA porta para os dados
 * dos outros, e devolve so' o que e' publico: nome e etiqueta. Nunca e-mail,
 * nunca `admin`, nunca data de criacao.
 */
create or replace function public.buscar_jogador(p_termo text)
returns table(id uuid, usuario text, etiqueta int)
language sql stable security definer
set search_path = public as $$
  select p.id, p.usuario, p.etiqueta
    from public.perfis p
   where p.id <> auth.uid()
     and char_length(trim(coalesce(p_termo, ''))) >= 2
     and (
       (trim(p_termo) ~ '^[0-9]+$' and p.etiqueta = trim(p_termo)::int)
       or p.usuario ilike trim(p_termo) || '%'
     )
   order by (p.usuario ilike trim(p_termo) || '%') desc, p.usuario
   limit 20;
$$;

grant execute on function public.buscar_jogador(text) to authenticated;


-- ----------------------------------------------------------- 3. AMIZADES
-- Linha DIRIGIDA (`de` pediu, `para` recebeu). Duas linhas para uma amizade
-- seria mais simetrico, mas complicaria o "quem pediu a quem" — que e'
-- justamente o que a tela de pedidos pendentes precisa mostrar.
create table if not exists public.amizades (
  de            uuid not null references auth.users(id) on delete cascade,
  para          uuid not null references auth.users(id) on delete cascade,
  estado        text not null default 'pendente'
                check (estado in ('pendente', 'aceito', 'recusado')),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (de, para),
  check (de <> para)
);

comment on table public.amizades is
  'Pedido de amizade dirigido. `aceito` nos dois sentidos = sao amigos.';

create index if not exists amizades_para on public.amizades (para, estado);

create trigger amizades_atualizado_em
  before update on public.amizades
  for each row execute function public.tocar_atualizado_em();

alter table public.amizades enable row level security;
revoke all on public.amizades from anon, authenticated;
grant select on public.amizades to authenticated;

-- Cada um ve' so' o que o envolve. Escrita e' pelas funcoes abaixo.
create policy amizades_minhas on public.amizades
  for select using (de = auth.uid() or para = auth.uid());

/**
 * Pede amizade pela ETIQUETA. Aceita automaticamente se o outro ja' tinha
 * pedido — senao os dois ficariam com um pedido pendente um do outro, esperando
 * cada um pelo outro.
 */
create or replace function public.pedir_amizade(p_etiqueta int)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); alvo uuid; pendentes int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select id into alvo from public.perfis where etiqueta = p_etiqueta;
  if alvo is null then raise exception 'ninguem com a etiqueta %', p_etiqueta; end if;
  if alvo = uid then raise exception 'voce nao pode se adicionar'; end if;

  -- Teto de pedidos: sem isto, um script varre as etiquetas de 10000 a 999999.
  select count(*) into pendentes from public.amizades
   where de = uid and estado = 'pendente' and criado_em > now() - interval '1 hour';
  if pendentes >= 30 then raise exception 'muitos pedidos nesta hora'; end if;

  -- Ele ja' tinha pedido? Entao isto e' um aceite.
  if exists (select 1 from public.amizades
              where de = alvo and para = uid and estado = 'pendente') then
    update public.amizades set estado = 'aceito' where de = alvo and para = uid;
    insert into public.amizades (de, para, estado) values (uid, alvo, 'aceito')
      on conflict (de, para) do update set estado = 'aceito';
    return jsonb_build_object('ok', true, 'estado', 'aceito');
  end if;

  insert into public.amizades (de, para) values (uid, alvo)
    on conflict (de, para) do update set estado = 'pendente', atualizado_em = now();
  return jsonb_build_object('ok', true, 'estado', 'pendente');
end;
$$;

/**
 * Responde a um pedido recebido. Aceitar grava a volta, para a amizade valer
 * nos dois sentidos sem a consulta ter de testar as duas direcoes toda vez.
 */
create or replace function public.responder_amizade(p_de uuid, p_aceita boolean)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  update public.amizades set estado = case when p_aceita then 'aceito' else 'recusado' end
   where de = p_de and para = uid and estado = 'pendente';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'nao ha pedido pendente desse jogador'; end if;

  if p_aceita then
    insert into public.amizades (de, para, estado) values (uid, p_de, 'aceito')
      on conflict (de, para) do update set estado = 'aceito';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.remover_amigo(p_amigo uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  delete from public.amizades
   where (de = uid and para = p_amigo) or (de = p_amigo and para = uid);
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * A lista da tela: amigos aceitos e pedidos pendentes, com nome e etiqueta.
 *
 * `direcao` diz o que a tela deve mostrar:
 *   'amigo'    — ja' aceito, cabe o botao de desafiar;
 *   'recebido' — ele pediu, cabem os botoes aceitar/recusar;
 *   'enviado'  — voce pediu, cabe apenas "aguardando".
 */
create or replace function public.meus_amigos()
returns table(id uuid, usuario text, etiqueta int, direcao text, desde timestamptz)
language sql stable security definer
set search_path = public as $$
  select p.id, p.usuario, p.etiqueta,
         case when a.estado = 'aceito' then 'amigo'
              when a.de = auth.uid()   then 'enviado'
              else 'recebido' end as direcao,
         a.atualizado_em
    from public.amizades a
    join public.perfis p
      on p.id = case when a.de = auth.uid() then a.para else a.de end
   where (a.de = auth.uid() or a.para = auth.uid())
     and a.estado in ('aceito', 'pendente')
     -- Amizade aceita tem DUAS linhas (ida e volta); sem isto o amigo apareceria
     -- duas vezes na lista.
     and (a.estado <> 'aceito' or a.de = auth.uid())
   order by (a.estado = 'pendente' and a.para = auth.uid()) desc, p.usuario;
$$;

grant execute on function public.pedir_amizade(int)            to authenticated;
grant execute on function public.responder_amizade(uuid, bool) to authenticated;
grant execute on function public.remover_amigo(uuid)           to authenticated;
grant execute on function public.meus_amigos()                 to authenticated;


-- ------------------------------------------------- 4. CONVITE DIRIGIDO
-- Sala endereçada a UMA pessoa, para o desafio de 1 clique. O convite por link
-- (`convite`) continua existindo para quem nao e' amigo.
alter table public.partidas
  add column if not exists convidado uuid references auth.users(id) on delete cascade;

comment on column public.partidas.convidado is
  'Desafio dirigido: so este jogador pode aceitar. NULL = sala por link.';

create index if not exists partidas_convidado
  on public.partidas (convidado, estado) where convidado is not null;

-- SEM ISTO A NOTIFICACAO NAO CHEGA: a policy antiga so' enxergava jogador_a e
-- jogador_b, e num desafio o `jogador_b` ainda e' NULL — o convidado nao veria a
-- propria sala nem pelo Realtime.
drop policy if exists partidas_dos_participantes on public.partidas;
create policy partidas_dos_participantes on public.partidas
  for select using (jogador_a = auth.uid()
                    or jogador_b = auth.uid()
                    or convidado = auth.uid());

/**
 * Desafia um AMIGO. Um clique: cria a sala e o outro recebe pelo Realtime.
 *
 * Exige amizade aceita de proposito — sem isso, o desafio vira porta de spam
 * para qualquer etiqueta sorteada.
 */
create or replace function public.desafiar_amigo(p_amigo uuid, p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); meu_ydk text; nova uuid;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  if not exists (select 1 from public.amizades
                  where de = uid and para = p_amigo and estado = 'aceito') then
    raise exception 'voce so pode desafiar quem esta na sua lista de amigos';
  end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  -- Desafio anterior ainda aberto para o MESMO amigo vira lixo: cancela.
  update public.partidas set estado = 'abandonada', encerrada_em = now()
   where jogador_a = uid and convidado = p_amigo and estado = 'aguardando';

  insert into public.partidas (jogador_a, deck_a, ydk_a, seed, modo, host, convidado)
  values (uid, p_deck, meu_ydk, (random() * 9223372036854775807)::bigint,
          'ponte', uid, p_amigo)
  returning id into nova;

  return jsonb_build_object('partida', nova);
end;
$$;

/**
 * Aceita um desafio dirigido a voce.
 */
create or replace function public.aceitar_desafio(p_partida uuid, p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); meu_ydk text; sala record;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  select * into sala from public.partidas
   where id = p_partida and convidado = uid and estado = 'aguardando'
   for update;
  if sala is null then raise exception 'desafio nao encontrado ou ja respondido'; end if;
  if sala.jogador_b is not null then raise exception 'esta sala ja esta cheia'; end if;

  update public.partidas
     set jogador_b = uid, deck_b = p_deck, ydk_b = meu_ydk,
         convite = null, estado = 'em_andamento'
   where id = sala.id;

  return jsonb_build_object('partida', sala.id);
end;
$$;

create or replace function public.recusar_desafio(p_partida uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  update public.partidas set estado = 'abandonada', encerrada_em = now()
   where id = p_partida and convidado = uid and estado = 'aguardando';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

/**
 * Os desafios que EU recebi e ainda nao respondi, com o nome de quem chamou.
 * O Realtime avisa que mudou; esta funcao diz o que mostrar.
 */
create or replace function public.meus_desafios()
returns table(partida uuid, de uuid, usuario text, etiqueta int, criado_em timestamptz)
language sql stable security definer
set search_path = public as $$
  select m.id, m.jogador_a, p.usuario, p.etiqueta, m.criado_em
    from public.partidas m
    join public.perfis p on p.id = m.jogador_a
   where m.convidado = auth.uid()
     and m.estado = 'aguardando'
     and m.criado_em > now() - interval '10 minutes'
   order by m.criado_em desc;
$$;

grant execute on function public.desafiar_amigo(uuid, text)  to authenticated;
grant execute on function public.aceitar_desafio(uuid, text) to authenticated;
grant execute on function public.recusar_desafio(uuid)       to authenticated;
grant execute on function public.meus_desafios()             to authenticated;
