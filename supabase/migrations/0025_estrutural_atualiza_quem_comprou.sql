-- ============================================================================
-- ATUALIZAR UM ESTRUTURAL ALCANCA QUEM JA' COMPROU
--
-- Ate aqui, editar um Deck Estrutural que ja' esta' a venda era uma armadilha
-- documentada (ver CONTEUDO-COMPRADO-E-ATUALIZADO.md): a trava de 1 por conta
-- (`compras_estruturais`, PK composta) e' permanente e nada registra QUAL
-- versao foi comprada. Quem ja' pagou ficava preso na versao velha para sempre,
-- e "comprar de novo" era impossivel — a unica saida era mexer no banco na mao,
-- que foi exatamente o que aconteceu em 16/08/2026.
--
-- A partir daqui, publicar uma versao nova EMPURRA a atualizacao para quem ja'
-- comprou: as cartas que entraram caem na Colecao dele e a copia do deck e'
-- trocada pela nova lista.
--
-- Por que um GATILHO e nao um passo do botao "publicar": o painel do admin
-- grava com um upsert direto na tabela (`estruturais.js: salvarEstrutural`),
-- nao por RPC. Regra no botao valeria so' para aquele caminho — um UPDATE feito
-- pelo SQL, por um script ou por uma tela futura passaria por fora e recriaria
-- o problema em silencio. No gatilho, a regra vale para todo caminho que
-- escreva na tabela, que e' o unico jeito de ela ser verdade.
--
-- DUAS DECISOES QUE NAO SAO OBVIAS, e o porque de cada uma:
--
--   1. So' CREDITA carta, nunca tira. Uma carta cortada da nova versao pode
--      estar em outro deck do jogador, ou ter vindo de booster — a Colecao e'
--      uma so' e nao sabe de onde veio cada copia. Tirar quebraria decks que
--      nao tem nada a ver com esta edicao. O jogador fica com o que ja' tinha:
--      e' o mesmo que qualquer jogo de carta faz numa errata.
--
--   2. So' SOBRESCREVE a copia do deck se ele nao mexeu nela. Se a lista do
--      jogador ainda e' identica a versao antiga, ele nunca editou e trocar e'
--      o favor que ele quer. Se ele customizou, sobrescrever apagaria o
--      trabalho dele sem aviso — ai as cartas novas sao creditadas do mesmo
--      jeito (ele monta como quiser) e o deck fica como esta'.
--      A comparacao e' pela LISTA DE CARTAS ordenada, nao pelo texto: o `.ydk`
--      do jogador ganha cabecalho (`#name`, `#cover`, `#updated`) ao ser salvo
--      pelo Deck Builder, entao comparar string diria "mexeu" para todo mundo.
-- ============================================================================

create or replace function public.sincronizar_estrutural()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  cp        record;
  delta     record;
  col       jsonb;
  v_ydk     text;
  a_jogador bigint[];
  a_antigo  bigint[];
begin
  -- So' a LISTA importa. Mudar nome, preco, capa ou raridade nao mexe em
  -- Colecao de ninguem.
  if new.ydk is not distinct from old.ydk then return new; end if;

  select array_agg(id order by id) into a_antigo from public.ydk_cartas(old.ydk);

  for cp in select * from public.compras_estruturais where deck_id = new.id loop

    -- 1. as cartas que ENTRARAM na nova versao
    select coalesce(dados->'collection', '{}'::jsonb) into col
      from public.carteiras where usuario_id = cp.usuario_id;

    if col is not null then
      for delta in
        with antes as (
          select id::text as carta, count(*)::int as qtd
            from public.ydk_cartas(old.ydk) group by 1),
        depois as (
          select id::text as carta, count(*)::int as qtd
            from public.ydk_cartas(new.ydk) group by 1)
        select d.carta, d.qtd - coalesce(a.qtd, 0) as quantas
          from depois d left join antes a on a.carta = d.carta
         where d.qtd - coalesce(a.qtd, 0) > 0
      loop
        col := jsonb_set(col, array[delta.carta],
                         to_jsonb(coalesce((col->>delta.carta)::int, 0) + delta.quantas),
                         true);
      end loop;

      update public.carteiras
         set dados = dados || jsonb_build_object('collection', col)
       where usuario_id = cp.usuario_id;
    end if;

    -- 2. a copia do deck, se ele nao customizou
    select dj.ydk into v_ydk
      from public.decks_jogador dj
     where dj.usuario_id = cp.usuario_id and dj.nome = cp.nome_do_deck;

    if v_ydk is not null then
      select array_agg(id order by id) into a_jogador from public.ydk_cartas(v_ydk);
      if a_jogador is not distinct from a_antigo then
        update public.decks_jogador
           set ydk = new.ydk
         where usuario_id = cp.usuario_id and nome = cp.nome_do_deck;
      end if;
    end if;

  end loop;

  return new;
end $$;

drop trigger if exists decks_estruturais_sincroniza on public.decks_estruturais;
create trigger decks_estruturais_sincroniza
  after update on public.decks_estruturais
  for each row execute function public.sincronizar_estrutural();

comment on function public.sincronizar_estrutural() is
  'Publicar versao nova de um estrutural credita as cartas que entraram e troca '
  'a copia do deck de quem ja comprou (so se ele nao customizou). Nunca remove carta.';

-- ------------------------------------------------------------- painel do admin
-- Quantas contas serao alcancadas por uma publicacao. A RLS de
-- `compras_estruturais` so' deixa cada um ver as PROPRIAS compras (e e' assim
-- que tem de ser), entao o painel nao consegue contar por PostgREST — dai esta
-- funcao, `security definer` e fechada em admin, so' para o aviso da tela.
create or replace function public.compradores_do_estrutural(p_id text)
returns int language plpgsql security definer
set search_path = public as $$
declare n int;
begin
  if not public.eh_admin() then raise exception 'somente admin'; end if;
  select count(*) into n from public.compras_estruturais where deck_id = p_id;
  return n;
end $$;

revoke all on function public.sincronizar_estrutural() from public, anon, authenticated;
revoke all on function public.compradores_do_estrutural(text) from public, anon;
grant execute on function public.compradores_do_estrutural(text) to authenticated;
