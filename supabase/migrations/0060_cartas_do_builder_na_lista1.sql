-- 0060 — Toda carta do CARD BUILDER entra na Lista 1 sozinha.
--
-- Pedido do usuario (27/09/2026): "todo card criado pelo card maker seja
-- automaticamente anexado na Lista1, assim podendo ser adicionado na BANLIST".
-- Antes disto a carta do builder so' entrava num deck pelo caminho de ADMIN
-- (`p_livre` do `salvar_deck`, 0024) — para todo o resto ela estava FORA do pool,
-- e uma regra de banlist para ela nao governava deck nenhum.
--
-- O desenho e' o das OBTENIVEIS (0048), pelos mesmos motivos:
--
--   * calculada na LEITURA, nunca gravada em `conteudo/lista1`: o proximo
--     "salvar" do editor de listas republica o array resolvido inteiro e a
--     apagaria; e apagar a carta do builder tem de tira-la da lista no mesmo
--     instante, sem ninguem lembrar;
--   * uma implementacao so': o cliente LE `cartas_do_builder()` (cardlists.js)
--     em vez de refazer a conta — duas contas divergiriam e o Deck Builder
--     deixaria montar o que o banco recusa salvar.
--
-- Diferente das obteniveis, vale so' para a LISTA 1: e' ela que o pedido nomeia,
-- e uma lista restrita criada a' parte no editor continua restrita. A queda para
-- a Lista 1 (lista ativa sem resultado publicado) tambem conta como Lista 1.

create or replace function public.cartas_do_builder()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(to_jsonb(id) order by id), '[]'::jsonb)
    from public.cartas_custom;
$$;

grant execute on function public.cartas_do_builder() to anon, authenticated;

create or replace function public.lista_ativa()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare alvo text; dados_lista jsonb; eh_lista1 boolean;
begin
  select coalesce(dados->>'listId', 'lista1') into alvo
    from public.conteudo where chave = 'banlist';
  alvo := coalesce(alvo, 'lista1');
  eh_lista1 := alvo = 'lista1';

  select dados into dados_lista from public.conteudo where chave = alvo;
  if dados_lista is null and alvo <> 'lista1' then
    select dados into dados_lista from public.conteudo where chave = 'lista1';
    eh_lista1 := true;
  end if;

  -- Sem lista publicada, `null` continua querendo dizer "nao sei qual e' a
  -- lista". Devolver so' as obteniveis transformaria o desconhecido numa lista
  -- minuscula, que recusaria praticamente todo deck do jogo.
  if dados_lista is null then return null; end if;
  if jsonb_typeof(dados_lista) <> 'array' then return dados_lista; end if;

  return (
    select coalesce(jsonb_agg(distinct u.e order by u.e), '[]'::jsonb)
      from (select jsonb_array_elements(dados_lista) as e
            union all
            select jsonb_array_elements(public.cartas_obteniveis())
            union all
            select jsonb_array_elements(public.cartas_do_builder()) where eh_lista1) u
  );
end;
$$;
