-- 0040 — CHAT: o global e a conversa com um amigo.
--
-- Uma tabela só para os dois, e a diferença é uma coluna: `para` nulo = mensagem
-- do chat GLOBAL, `para` preenchido = conversa com aquela pessoa. Duas tabelas
-- exigiriam duas policies, dois RPCs de envio e dois caminhos de Realtime para a
-- mesma coisa — e elas divergiriam no primeiro ajuste, que é o erro que este
-- projeto já pagou.
--
-- QUEM PODE FALAR COM QUEM é decidido AQUI, e não na tela: a conversa privada só
-- existe entre AMIGOS (`amizades` aceita). Um cliente é código na máquina de
-- quem joga; se a trava morasse lá, bastaria abrir o console para mandar
-- mensagem a qualquer id do jogo.

create table if not exists public.mensagens (
  id          bigint generated always as identity primary key,
  de          uuid not null references auth.users(id) on delete cascade,
  -- NULO = chat global. É a coluna que separa os dois chats.
  para        uuid references auth.users(id) on delete cascade,
  texto       text not null,
  criado_em   timestamptz not null default now(),

  -- O TETO do texto mora no banco, não no `maxlength` do input: o `maxlength` é
  -- uma gentileza com quem digita, e não uma trava — ele não existe para quem
  -- chama o endpoint direto. 500 dá para conversar e não dá para despejar um
  -- livro no chat de todo mundo.
  constraint mensagens_texto_ok check (char_length(btrim(texto)) between 1 and 500),
  -- Falar sozinho não é conversa, e a linha ainda ocuparia a tela dos dois lados
  -- da consulta de conversa (que casa `de` OU `para`).
  constraint mensagens_nao_e_monologo check (para is null or para <> de)
);

-- As duas leituras que a tela faz: "as últimas do global" e "as últimas com
-- fulano". Sem estes índices as duas viram varredura da tabela inteira, e ela
-- só cresce.
create index if not exists mensagens_global_idx
  on public.mensagens (criado_em desc) where para is null;
create index if not exists mensagens_conversa_idx
  on public.mensagens (de, para, criado_em desc) where para is not null;

alter table public.mensagens enable row level security;

-- LER. O global é de todo mundo que está autenticado — é o ponto dele. A
-- conversa é só dos dois lados: `de = eu` OU `para = eu`, sem exceção nem para
-- admin (ler conversa alheia não é administrar nada).
drop policy if exists mensagens_leitura on public.mensagens;
create policy mensagens_leitura on public.mensagens
  for select using (
    para is null
    or de = auth.uid()
    or para = auth.uid()
  );

-- ESCREVER só passa pelo RPC abaixo (`security definer`), que é onde a regra de
-- amizade e o limite de ritmo vivem. Sem policy de INSERT, um `POST /mensagens`
-- direto é recusado — e é assim que a trava não pode ser contornada.

-- ---------------------------------------------------------------- enviar

create or replace function public.enviar_mensagem(p_para uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  corpo text := btrim(coalesce(p_texto, ''));
  recentes int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if char_length(corpo) = 0 then raise exception 'mensagem vazia'; end if;
  if char_length(corpo) > 500 then raise exception 'mensagem longa demais (máx. 500)'; end if;

  -- A conversa privada exige AMIZADE ACEITA. Um pedido pendente não basta:
  -- mandar mensagem para quem ainda não aceitou seria usar o pedido como canal.
  if p_para is not null then
    if p_para = uid then raise exception 'nao da para conversar consigo mesmo'; end if;
    if not exists (
      select 1 from public.amizades a
       where a.estado = 'aceito'
         and ((a.de = uid and a.para = p_para) or (a.de = p_para and a.para = uid))
    ) then
      raise exception 'so da para conversar com amigos';
    end if;
  end if;

  -- LIMITE DE RITMO. Não é proteção contra um atacante decidido — é o que
  -- impede que um dedo preso na tecla, ou um laço mal escrito numa tela nossa,
  -- encha o chat de todo mundo. 15 mensagens em 10 segundos é folgado para quem
  -- conversa e curto para quem despeja.
  select count(*) into recentes
    from public.mensagens m
   where m.de = uid and m.criado_em > now() - interval '10 seconds';
  if recentes >= 15 then raise exception 'devagar — muitas mensagens seguidas'; end if;

  insert into public.mensagens (de, para, texto) values (uid, p_para, corpo);
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------ ler

-- O nome de quem falou vem JUNTO. A policy de `perfis` só deixa cada um ver o
-- próprio registro, então a tela não tem como cruzar id → nome sozinha: sem esta
-- junção (que roda como `definer`), o chat global mostraria uuids.
--
-- `p_desde` é o id da última mensagem que a tela já tem. Zero traz o histórico
-- inicial; qualquer outro valor traz só o que chegou depois — que é o que o
-- Realtime e a consulta de reserva pedem a cada aviso.
create or replace function public.chat_global(p_desde bigint default 0, p_limite int default 60)
returns table (id bigint, de uuid, usuario text, etiqueta int, icone_id text,
               texto text, criado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.de, p.usuario, p.etiqueta, p.icone_id, m.texto, m.criado_em
    from public.mensagens m
    join public.perfis p on p.id = m.de
   where m.para is null
     and m.id > greatest(coalesce(p_desde, 0), 0)
   order by m.id desc
   limit least(greatest(coalesce(p_limite, 60), 1), 200);
$$;

create or replace function public.chat_com(p_amigo uuid, p_desde bigint default 0, p_limite int default 60)
returns table (id bigint, de uuid, usuario text, etiqueta int, icone_id text,
               texto text, criado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.de, p.usuario, p.etiqueta, p.icone_id, m.texto, m.criado_em
    from public.mensagens m
    join public.perfis p on p.id = m.de
   where m.para is not null
     -- Os DOIS sentidos da mesma conversa. E sempre com `auth.uid()` de um dos
     -- lados: o `security definer` desliga a RLS, então a restrição de quem pode
     -- ler precisa estar escrita aqui dentro.
     and ((m.de = auth.uid() and m.para = p_amigo)
       or (m.de = p_amigo    and m.para = auth.uid()))
     and m.id > greatest(coalesce(p_desde, 0), 0)
   order by m.id desc
   limit least(greatest(coalesce(p_limite, 60), 1), 200);
$$;

grant execute on function public.enviar_mensagem(uuid, text) to authenticated;
grant execute on function public.chat_global(bigint, int)     to authenticated;
grant execute on function public.chat_com(uuid, bigint, int)  to authenticated;

-- ------------------------------------------------------------- realtime

-- A mensagem chega em menos de um segundo pelo Realtime; a consulta de reserva
-- (a mesma mecânica das notificações) garante a entrega com o socket caído. O
-- evento é usado só como "chegou algo, leia de novo" — quem monta a lista é o
-- RPC acima, com o nome de quem falou.
--
-- A RLS VALE NO REALTIME: o servidor só entrega a linha a quem poderia lê-la por
-- `select`. É por isso que a policy de leitura acima precisa enxergar `para =
-- auth.uid()` — sem isso a mensagem recebida não chegaria, e nada acusaria.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens'
  ) then
    alter publication supabase_realtime add table public.mensagens;
  end if;
end $$;
