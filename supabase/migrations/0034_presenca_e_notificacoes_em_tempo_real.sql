-- ============================================================================
-- PRESENCA (quem esta online) e o que a home precisa para notificar na hora.
--
-- Ate' aqui nao havia nenhuma nocao de "online": a lista de amigos mostrava
-- todo mundo igual, e nao havia como saber quantas pessoas estao jogando.
--
-- O mecanismo e' um BATIMENTO: cada cliente aberto chama `bater_ponto()` de
-- tempos em tempos, e quem bateu ha' menos de `JANELA` conta como online. E'
-- de proposito que a verdade seja "visto recentemente" e nao um booleano
-- `online` gravado no login: um booleano fica preso em `true` para sempre
-- quando o navegador e' fechado, a maquina cai ou a rede some — e nao ha'
-- evento nenhum para desliga-lo. Um carimbo de tempo expira sozinho.
-- ============================================================================

alter table public.perfis
  add column if not exists visto_em timestamptz not null default now();

comment on column public.perfis.visto_em is
  'Ultimo batimento do cliente (bater_ponto). Online = visto ha menos de 2 min.';

-- A consulta de presenca e' sempre "visto_em > agora - janela", entao o indice
-- e' por ele. Sem indice, contar os online varre a tabela inteira a cada
-- batimento de cada jogador.
create index if not exists perfis_visto_em on public.perfis (visto_em desc);

-- A janela mora numa funcao so': o cliente NAO decide o que e' estar online.
-- Se decidisse, dois clientes com relogios diferentes discordariam sobre quem
-- esta' online, cada um "certo" pela sua conta.
create or replace function public.janela_online()
returns interval language sql immutable as $$ select interval '2 minutes' $$;

comment on function public.janela_online() is
  'Quanto tempo depois do ultimo batimento o jogador ainda conta como online.';

/**
 * O batimento. Marca que estou vivo e devolve QUANTOS estao online agora.
 *
 * As duas coisas na mesma chamada de proposito: a home precisa das duas, e
 * separa-las seria uma segunda ida de rede a cada 45 segundos, por jogador
 * aberto, para saber um numero que acabou de ser calculado.
 *
 * `security definer` porque conta perfis dos OUTROS, e a policy de `perfis` so'
 * deixa cada um ver o proprio. O que sai daqui e' um numero agregado — nunca
 * quem sao, nunca quando cada um foi visto.
 */
create or replace function public.bater_ponto()
returns int language plpgsql security definer
set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;

  update public.perfis set visto_em = now() where id = auth.uid();

  select count(*) into n
    from public.perfis
   where visto_em > now() - public.janela_online();

  return n;
end;
$$;

comment on function public.bater_ponto() is
  'Marca presenca e devolve quantos jogadores estao online agora.';

revoke all on function public.bater_ponto() from public, anon;
grant execute on function public.bater_ponto() to authenticated;

-- ---------------------------------------------------------------- amigos
-- `meus_amigos` ganha `online`. E' preciso DROPAR antes: mudar as colunas de
-- um `returns table` nao e' um "create or replace".
--
-- A coluna nova nao quebra quem ja' consome esta funcao (a tela de
-- Multiplayer le' os campos pelo NOME), e a presenca do amigo sai por aqui —
-- e nao por um select em `perfis` — porque `perfis` so' deixa cada um ver o
-- proprio. Quem e' seu amigo voce pode saber que esta' online; um estranho,
-- nao.
drop function if exists public.meus_amigos();

create function public.meus_amigos()
returns table(id uuid, usuario text, etiqueta int, direcao text,
              desde timestamptz, online boolean)
language sql stable security definer
set search_path = public as $$
  select p.id, p.usuario, p.etiqueta,
         case when a.estado = 'aceito' then 'amigo'
              when a.de = auth.uid()   then 'enviado'
              else 'recebido' end as direcao,
         a.atualizado_em,
         (p.visto_em > now() - public.janela_online()) as online
    from public.amizades a
    join public.perfis p
      on p.id = case when a.de = auth.uid() then a.para else a.de end
   where (a.de = auth.uid() or a.para = auth.uid())
     and a.estado in ('aceito', 'pendente')
     -- Amizade aceita tem DUAS linhas (ida e volta); sem isto o amigo apareceria
     -- duas vezes na lista.
     and (a.estado <> 'aceito' or a.de = auth.uid())
   -- Pedido recebido primeiro (tem prazo), depois quem esta' ONLINE, depois o
   -- nome. A ordem e' do banco porque as duas telas que leem isto — a home e o
   -- Multiplayer — precisam concordar sobre quem aparece no topo.
   order by (a.estado = 'pendente' and a.para = auth.uid()) desc,
            (p.visto_em > now() - public.janela_online()) desc,
            p.usuario;
$$;

revoke all on function public.meus_amigos() from public, anon;
grant execute on function public.meus_amigos() to authenticated;

-- ------------------------------------------------------------- tempo real
-- `partidas` ja' estava publicada (e' assim que o desafio chega). `amizades`
-- nao estava, entao um PEDIDO DE AMIZADE so' aparecia na proxima consulta.
--
-- A policy de select ja' cobre o destinatario (`de = auth.uid() or para =
-- auth.uid()`), que e' o que o Realtime respeita — sem ela, a linha nao seria
-- entregue a ninguem e nada acusaria.
do $$
begin
  if not exists (
    select 1 from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
     where p.pubname = 'supabase_realtime' and c.relname = 'amizades')
  then
    alter publication supabase_realtime add table public.amizades;
  end if;
end $$;

-- O Realtime entrega a linha ANTIGA de um update/delete so' quando a tabela
-- tem replica identity full. Sem isto, "o pedido foi aceito" chega sem dizer
-- de quem era — e a tela nao consegue tirar a notificacao certa da lista.
alter table public.amizades replica identity full;
