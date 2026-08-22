-- ============================================================================
-- ICONES DE PERFIL: o catalogo, a posse e a escolha.
--
-- Tres tabelas de responsabilidade separada, e a separacao e' o ponto:
--
--   icones             o CATALOGO — que icones existem, quanto custam
--   icones_do_jogador  a POSSE    — quem tem cada um
--   perfis.icone_id    a ESCOLHA  — qual deles esta' em uso agora
--
-- Juntar posse e escolha num campo so' (o icone escolhido = o icone que tem)
-- perderia a colecao no momento em que a pessoa trocasse de icone, e nao
-- haveria como oferecer "os que voce tem" na hora de escolher.
--
-- A IMAGEM nao esta' aqui. Ela mora em `web/img/icones/<arquivo>` e viaja no
-- `game.zip` do Release — o banco guarda o NOME do arquivo. A consequencia e'
-- assumida e precisa ser dita: um icone cadastrado aqui cuja imagem nao foi
-- publicada aparece quebrado para quem joga, e nada no banco sabe disso. E'
-- para isso que existe o `npm run icones:check`, que cruza o catalogo com o
-- manifesto do repositorio — a mesma ideia do `boosters:check`.
-- ============================================================================

create table if not exists public.icones (
  -- Slug, nao uuid: e' ele que aparece no `web/img/icones/<id>.png` e no
  -- `icone_id` do perfil. Um id legivel deixa o arquivo do repositorio e a
  -- linha do banco se reconhecerem a olho.
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  nome       text not null check (length(btrim(nome)) between 1 and 60),
  -- O arquivo em `web/img/icones/`. Separado do id de proposito: dois icones
  -- podem compartilhar uma arte (uma edicao "dourada" do mesmo desenho), e
  -- renomear o arquivo no repositorio nao pode obrigar a trocar o id, que e' o
  -- que os perfis referenciam.
  arquivo    text not null check (arquivo ~ '^[A-Za-z0-9._-]{1,64}$'),
  preco      int  not null default 0 check (preco >= 0),
  raridade   text not null default 'N' check (raridade in ('UR','SR','R','N')),
  -- Todo mundo tem, sem comprar nem ganhar. E' o que impede um jogador novo de
  -- cair numa lista de escolha vazia.
  gratuito   boolean not null default false,
  na_loja    boolean not null default false,
  ordem      int not null default 0,
  criado_em  timestamptz not null default now()
);

comment on table public.icones is
  'Catalogo de icones de perfil. A imagem mora em web/img/icones/<arquivo>.';

alter table public.icones enable row level security;
revoke all on public.icones from anon, authenticated;
grant select on public.icones to anon, authenticated;

-- Leitura ABERTA, inclusive anonima: a vitrine da Loja carrega antes do login,
-- como ja' acontece com `decks_estruturais`.
create policy icones_leitura_aberta on public.icones for select using (true);

-- Escrita so' admin, pela mesma `eh_admin()` do resto do conteudo.
create policy icones_admin_escreve on public.icones
  for all using (public.eh_admin()) with check (public.eh_admin());
grant insert, update, delete on public.icones to authenticated;


create table if not exists public.icones_do_jogador (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  icone_id   text not null references public.icones(id) on delete cascade,
  obtido_em  timestamptz not null default now(),
  primary key (usuario_id, icone_id)
);

comment on table public.icones_do_jogador is
  'Quem tem cada icone. O gratuito NAO entra aqui — ver meus_icones().';

alter table public.icones_do_jogador enable row level security;
revoke all on public.icones_do_jogador from anon, authenticated;
grant select on public.icones_do_jogador to authenticated;

-- O jogador ve' o que tem, mas nao escreve: quem concede e' funcao (a compra,
-- o premio, o admin). Sem isto, dar-se um icone seria um insert no console.
create policy icones_do_dono on public.icones_do_jogador
  for select using (usuario_id = auth.uid());


-- A ESCOLHA. `on delete set null` porque apagar um icone do catalogo nao pode
-- derrubar o perfil de quem o usava — ele volta ao padrao.
alter table public.perfis
  add column if not exists icone_id text references public.icones(id) on delete set null;

comment on column public.perfis.icone_id is
  'Icone em uso. NULL = o padrao do jogo. Trocado so por escolher_icone().';


-- ---------------------------------------------------------------- consultas

/**
 * O catalogo com `tenho` — a lista que a tela de escolha desenha.
 *
 * `tenho` e' gratuito OU estar na posse. Calcular isso no cliente exigiria
 * baixar as duas tabelas e cruzar, e o cliente e' a parte que o jogador
 * controla: quem responde "posso usar este icone?" tem de ser o mesmo que
 * grava a escolha.
 */
create or replace function public.meus_icones()
returns table(id text, nome text, arquivo text, preco int, raridade text,
              gratuito boolean, na_loja boolean, ordem int,
              tenho boolean, em_uso boolean)
language sql stable security definer
set search_path = public as $$
  select i.id, i.nome, i.arquivo, i.preco, i.raridade,
         i.gratuito, i.na_loja, i.ordem,
         (i.gratuito or j.usuario_id is not null) as tenho,
         (p.icone_id = i.id)                      as em_uso
    from public.icones i
    left join public.icones_do_jogador j
           on j.icone_id = i.id and j.usuario_id = auth.uid()
    left join public.perfis p on p.id = auth.uid()
   -- Os que voce tem primeiro, depois a ordem publicada, depois o nome: quem
   -- abre a tela quer escolher entre os seus, nao rolar a loja inteira.
   order by (i.gratuito or j.usuario_id is not null) desc, i.ordem, i.nome;
$$;

revoke all on function public.meus_icones() from public, anon;
grant execute on function public.meus_icones() to authenticated;

/**
 * Troca o icone em uso. Recusa o que nao e' seu.
 *
 * A trava mora AQUI e nao na tela: a tela so' mostra os que voce tem, mas
 * mostrar e' sugestao — um POST direto em `perfis` passaria por cima dela, e a
 * policy de update do perfil e' `id = auth.uid()`, isto e', o proprio dono
 * pode escrever. Sem esta funcao, qualquer um usaria o icone mais caro do
 * catalogo pelo console.
 */
create or replace function public.escolher_icone(p_id text)
returns text language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'precisa estar logado'; end if;

  -- NULL volta ao padrao do jogo, e e' sempre permitido: e' a saida de quem
  -- teve o icone apagado do catalogo.
  if p_id is null then
    update public.perfis set icone_id = null where id = auth.uid();
    return null;
  end if;

  if not exists (
    select 1 from public.icones i
     where i.id = p_id
       and (i.gratuito
            or exists (select 1 from public.icones_do_jogador j
                        where j.icone_id = i.id and j.usuario_id = auth.uid()))
  ) then
    raise exception 'voce nao tem este icone';
  end if;

  update public.perfis set icone_id = p_id where id = auth.uid();
  return p_id;
end;
$$;

revoke all on function public.escolher_icone(text) from public, anon;
grant execute on function public.escolher_icone(text) to authenticated;

/**
 * Da' um icone a alguem. So' admin — e' a porta de servico enquanto a venda na
 * Loja nao existe, e continua util depois (premio, correcao, cortesia).
 *
 * `on conflict do nothing`: dar duas vezes o mesmo icone nao e' erro, e nao
 * pode reescrever o `obtido_em` de quem ja' tinha.
 */
create or replace function public.dar_icone(p_usuario uuid, p_icone text)
returns boolean language plpgsql security definer
set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'so um admin pode dar icones'; end if;

  insert into public.icones_do_jogador (usuario_id, icone_id)
  values (p_usuario, p_icone)
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.dar_icone(uuid, text) from public, anon;
grant execute on function public.dar_icone(uuid, text) to authenticated;

-- ------------------------------------------------------------- a lateral
-- `meus_amigos` passa a devolver o icone de cada um: a lista da home mostra o
-- avatar ao lado do nome, e sem isto ela teria de perguntar o perfil de cada
-- amigo separadamente — o que a policy de `perfis` nem permitiria.
drop function if exists public.meus_amigos();

create function public.meus_amigos()
returns table(id uuid, usuario text, etiqueta int, direcao text,
              desde timestamptz, online boolean, icone_id text)
language sql stable security definer
set search_path = public as $$
  select p.id, p.usuario, p.etiqueta,
         case when a.estado = 'aceito' then 'amigo'
              when a.de = auth.uid()   then 'enviado'
              else 'recebido' end as direcao,
         a.atualizado_em,
         (p.visto_em > now() - public.janela_online()) as online,
         p.icone_id
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
