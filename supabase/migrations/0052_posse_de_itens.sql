-- 0052 — A POSSE dos itens, e a entrega de um item de bônus num lugar só
--
-- A 0051 criou o CATÁLOGO (`itens`): sleeve, playmat, deck box e o genérico.
-- Faltava a outra metade, que é a que o jogador vê — **quem tem o quê**.
--
-- O ícone já tinha as três coisas separadas desde a 0035, e a separação é o
-- ponto (catálogo × posse × escolha). Aqui são só as duas primeiras: um item
-- ainda não é ESCOLHIDO em lugar nenhum do jogo (o que significa "equipar uma
-- sleeve" é a próxima decisão, não esta). Quando for, a coluna de escolha vai
-- para `perfis`, como a `icone_id` — e não para cá.

create table if not exists public.itens_do_jogador (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  item_id    text not null references public.itens(id) on delete cascade,
  obtido_em  timestamptz not null default now(),
  primary key (usuario_id, item_id)
);

alter table public.itens_do_jogador enable row level security;

-- Cada um vê a sua posse (e o admin vê todas, para conferir um prêmio que não
-- chegou). NINGUÉM escreve pela API: quem dá item é função `security definer`
-- — sem isto, um `POST /itens_do_jogador` no console daria a coleção inteira.
drop policy if exists itens_do_jogador_leitura on public.itens_do_jogador;
create policy itens_do_jogador_leitura on public.itens_do_jogador
  for select using (usuario_id = auth.uid() or public.eh_admin());

grant select on public.itens_do_jogador to authenticated;
revoke insert, update, delete on public.itens_do_jogador from anon, authenticated;

-- ---------------------------------------------------------------------------
-- O que EU tenho. Espelha `meus_icones()`: devolve o catálogo inteiro com um
-- `tenho`, e não só os meus — é o que deixa a mesma consulta servir ao
-- inventário (filtrando) e a uma vitrine (mostrando o que falta).
create or replace function public.meus_itens()
returns table(id text, tipo text, nome text, imagem text,
              preco int, na_loja boolean, ordem int, tenho boolean)
language sql
stable security definer
set search_path to 'public'
as $$
  select i.id, i.tipo, i.nome, i.imagem, i.preco, i.na_loja, i.ordem,
         (j.usuario_id is not null) as tenho
    from public.itens i
    left join public.itens_do_jogador j
           on j.item_id = i.id and j.usuario_id = auth.uid()
   -- Os que eu tenho primeiro, como no `meus_icones`: quem abre o inventário
   -- quer ver os seus, não rolar o catálogo inteiro.
   order by (j.usuario_id is not null) desc, i.ordem, i.nome;
$$;

revoke all on function public.meus_itens() from public, anon;
grant execute on function public.meus_itens() to authenticated;

-- ---------------------------------------------------------------------------
-- A ENTREGA de UM item de bônus, num lugar só.
--
-- Ela estava escrita dentro do laço de `premiar_vitoria` (0050), com um `if`
-- por tipo. Tirá-la de lá não é arrumação: é o que faz o **próximo tipo** ser
-- uma edição nesta função pequena, e não mais uma reescrita da função que paga
-- a vitória inteira — a que ninguém quer tocar sem motivo.
--
-- Devolve `null` quando não entregou (tipo desconhecido, item que não existe,
-- ou o jogador já tem). **Item repetido é pulado em silêncio**: vitória nenhuma
-- é negada por causa de um prêmio que a pessoa já tinha.
create or replace function public.entregar_item_bonus(p_uid uuid, p_tipo text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r jsonb;
begin
  if p_uid is null or p_tipo is null or p_id is null then return null; end if;

  if p_tipo = 'icone' then
    -- Ícone GRATUITO não é prêmio: todo mundo já o tem, e oferecê-lo seria
    -- prometer o impossível. Mesma regra do sorteio de ícone da 0038.
    if not exists (select 1 from public.icones x where x.id = p_id and not x.gratuito)
       or exists (select 1 from public.icones_do_jogador j
                   where j.icone_id = p_id and j.usuario_id = p_uid) then
      return null;
    end if;
    insert into public.icones_do_jogador (usuario_id, icone_id)
    values (p_uid, p_id) on conflict do nothing;
    select jsonb_build_object('tipo', 'icone', 'id', x.id, 'nome', x.nome,
                              'imagem', x.imagem, 'raridade', x.raridade)
      into r from public.icones x where x.id = p_id;
    return r;
  end if;

  if p_tipo = 'estrutural' then
    return public.entregar_estrutural(p_uid, p_id);
  end if;

  -- Os tipos da 0051 (sleeve, playmat, deckbox, generico). Repare que o TIPO
  -- pedido tem de bater com o tipo cadastrado: um bônus configurado como
  -- "playmat" apontando para uma sleeve é configuração errada, e entregar
  -- assim mesmo esconderia o engano do admin.
  if p_tipo in ('generico', 'sleeve', 'playmat', 'deckbox') then
    if not exists (select 1 from public.itens x where x.id = p_id and x.tipo = p_tipo)
       or exists (select 1 from public.itens_do_jogador j
                   where j.item_id = p_id and j.usuario_id = p_uid) then
      return null;
    end if;
    insert into public.itens_do_jogador (usuario_id, item_id)
    values (p_uid, p_id) on conflict do nothing;
    select jsonb_build_object('tipo', x.tipo, 'id', x.id, 'nome', x.nome,
                              'imagem', x.imagem)
      into r from public.itens x where x.id = p_id;
    return r;
  end if;

  -- Tipo que este banco não sabe pagar: `null`, sem erro. Um cliente novo
  -- configurando um tipo que o servidor antigo não conhece não pode derrubar a
  -- premiação inteira.
  return null;
end;
$$;

revoke all on function public.entregar_item_bonus(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dar um item na mão (admin) — a porta de serviço enquanto a Loja não vende,
-- igual ao `dar_icone` da 0035.
create or replace function public.dar_item(p_usuario uuid, p_item text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r jsonb;
begin
  if not public.eh_admin() then raise exception 'somente admin'; end if;
  if not exists (select 1 from public.itens where id = p_item) then
    raise exception 'item "%" nao existe', p_item;
  end if;
  insert into public.itens_do_jogador (usuario_id, item_id)
  values (p_usuario, p_item) on conflict do nothing;
  select jsonb_build_object('ok', true, 'id', x.id, 'nome', x.nome)
    into r from public.itens x where x.id = p_item;
  return r;
end;
$$;

revoke all on function public.dar_item(uuid, text) from public, anon;
grant execute on function public.dar_item(uuid, text) to authenticated;
