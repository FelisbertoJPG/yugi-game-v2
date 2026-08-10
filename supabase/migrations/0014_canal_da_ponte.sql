-- ============================================================================
-- O FIO da ponte: por onde a jogada do convidado vai e a visao dele volta.
--
-- Desenho, e o motivo de ser assim:
--
--   convidado --(jogada)--> Supabase --> navegador do ANFITRIAO --> motor local
--   convidado <--(estado)-- Supabase <-- navegador do ANFITRIAO <-- motor local
--
-- O convidado NUNCA alcanca a maquina do anfitriao. Nada de abrir porta no
-- roteador, nada de tunel, nada de IP fixo — e' por isso que o modo ponte custa
-- zero. O preco esta' anotado em `partidas.modo`: quem hospeda roda o motor,
-- entao partida de ponte nao paga DP nem conta ranking.
--
-- Toda linha e' ENDERECADA (`para`). Sem isso a RLS nao teria como deixar o
-- anfitriao ler a jogada do convidado sem abrir a tabela para os dois lados.
-- ============================================================================

create table if not exists public.lances (
  id         bigint generated always as identity primary key,
  partida    uuid not null references public.partidas(id) on delete cascade,
  tipo       text not null check (tipo in ('jogada', 'estado')),
  autor      uuid not null references auth.users(id) on delete cascade,
  para       uuid not null references auth.users(id) on delete cascade,
  dados      jsonb not null,
  criado_em  timestamptz not null default now()
);

comment on table public.lances is
  'Mensagens da ponte. jogada = clique do convidado; estado = a visao que o anfitriao devolve.';

-- A leitura e' sempre "o que chegou depois do id N": este indice e' o caminho
-- quente, consultado a cada segundo pelos dois lados.
create index if not exists lances_caixa on public.lances (para, partida, id);

alter table public.lances enable row level security;
revoke all on public.lances from anon, authenticated;
grant select on public.lances to authenticated;

-- So' quem mandou ou quem recebeu. Escrita e' pelas funcoes abaixo.
create policy lances_meus on public.lances
  for select using (autor = auth.uid() or para = auth.uid());

/**
 * Quem e' o OUTRO nesta partida? Null se voce nao esta nela.
 */
create or replace function public.adversario_em(p_partida uuid)
returns uuid language sql stable security definer
set search_path = public as $$
  select case when m.jogador_a = auth.uid() then m.jogador_b
              when m.jogador_b = auth.uid() then m.jogador_a
         end
    from public.partidas m
   where m.id = p_partida and m.estado = 'em_andamento';
$$;

/**
 * O convidado manda o que clicou. `p_dados` e' o corpo do /respond:
 * {action, arg, args}.
 *
 * NAO valida a jogada — quem valida e' o ocgcore do outro lado, e essa e' a
 * unica validacao que vale. Aqui so' se confere QUEM esta' mandando.
 */
create or replace function public.enviar_jogada(p_partida uuid, p_dados jsonb)
returns bigint language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); outro uuid; novo bigint;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  outro := public.adversario_em(p_partida);
  if outro is null then raise exception 'voce nao esta nesta partida (ou ela nao comecou)'; end if;

  insert into public.lances (partida, tipo, autor, para, dados)
  values (p_partida, 'jogada', uid, outro, p_dados)
  returning id into novo;
  return novo;
end;
$$;

/**
 * O anfitriao devolve ao convidado a visao dele (eventos + pergunta + ended).
 *
 * So' o ANFITRIAO publica estado. Sem esta trava o convidado escreveria o
 * proprio "estado" e mandaria ao anfitriao eventos inventados — nao mudaria o
 * motor (que roda do outro lado), mas sujaria a tela dele com cartas que nao
 * existem.
 */
create or replace function public.publicar_estado(p_partida uuid, p_dados jsonb)
returns bigint language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); outro uuid; anfitriao uuid; novo bigint;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select host into anfitriao from public.partidas where id = p_partida;
  if anfitriao is null or anfitriao <> uid then
    raise exception 'so o anfitriao publica o estado do duelo';
  end if;

  outro := public.adversario_em(p_partida);
  if outro is null then raise exception 'partida nao esta em andamento'; end if;

  insert into public.lances (partida, tipo, autor, para, dados)
  values (p_partida, 'estado', uid, outro, p_dados)
  returning id into novo;
  return novo;
end;
$$;

/**
 * A caixa de entrada: o que chegou para mim depois do id `p_desde`.
 *
 * Devolve os dois tipos porque cada lado so' recebe o que lhe cabe — o
 * convidado nunca e' `para` de uma 'jogada', e o anfitriao nunca e' `para` de um
 * 'estado'. Filtrar por tipo aqui seria redundancia que envelhece.
 */
create or replace function public.ler_lances(p_partida uuid, p_desde bigint default 0)
returns table(id bigint, tipo text, dados jsonb, criado_em timestamptz)
language sql stable security definer
set search_path = public as $$
  select l.id, l.tipo, l.dados, l.criado_em
    from public.lances l
   where l.partida = p_partida
     and l.para = auth.uid()
     and l.id > coalesce(p_desde, 0)
   order by l.id
   limit 200;
$$;

-- O furo da 0013 VOLTA a cada funcao nova: o Postgres da' EXECUTE ao role PUBLIC
-- em `create function`, e `grant ... to authenticated` soma em vez de restringir.
-- As tres funcoes acima nasceram chamaveis sem sessao (conferido, e corrigido).
--
-- REGRA PERMANENTE: toda migration que cria funcao revoga do PUBLIC ANTES de
-- conceder. Esta foi a segunda vez; que seja a ultima.
revoke all on function public.adversario_em(uuid)          from public, anon, authenticated;
revoke all on function public.enviar_jogada(uuid, jsonb)   from public, anon;
revoke all on function public.publicar_estado(uuid, jsonb) from public, anon;
revoke all on function public.ler_lances(uuid, bigint)     from public, anon;

grant execute on function public.enviar_jogada(uuid, jsonb)   to authenticated;
grant execute on function public.publicar_estado(uuid, jsonb) to authenticated;
grant execute on function public.ler_lances(uuid, bigint)     to authenticated;
