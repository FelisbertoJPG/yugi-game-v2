-- ============================================================================
-- ADMIN GRAVA DECK LIVRE (Area de Teste)
--
-- O Deck Builder da Area de Teste (`deck.html` SEM `?owned=1`) mostra o banco
-- INTEIRO — e' a ferramenta de montar deck de teste, sem limite de Colecao.
-- So' que `salvar_deck` confere POSSE carta a carta, entao o deck montado ali
-- nunca chegava ao banco: ficava so' no `localStorage` daquele navegador, com
-- o alerta "cartas que voce nao possui". Sem abrir booster antes, nao dava
-- para testar duelo online, nem o proprio caminho de gravar/excluir deck.
--
-- `p_livre` desliga as conferencias que sao de JOGO — posse, teto de copias,
-- pontos, lista compartilhada e pool permitido — e SO' para admin. O que
-- continua valendo para todo mundo e' o TAMANHO: um main de 12 cartas nao e'
-- "deck de teste", e' deck que o ocgcore recusa na hora de comecar o duelo.
--
-- A funcao de 2 argumentos e' DERRUBADA de proposito. `create or replace` com
-- um argumento a mais criaria uma SOBRECARGA, e o PostgREST passaria a recusar
-- toda chamada de 2 argumentos com "could not choose the best candidate
-- function" — ou seja, quebraria o fluxo do jogador, que e' quem menos tem a
-- ver com isto. Com `default false`, quem chama com 2 argumentos continua
-- caindo aqui, exatamente com o comportamento de antes.
--
-- O resto do corpo e' o da migration 0017, inalterado.
-- ============================================================================

drop function if exists public.salvar_deck(text, text);

create or replace function public.salvar_deck(p_nome text, p_ydk text,
                                              p_livre boolean default false)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  col jsonb; banlist jsonb; lista jsonb; rar jsonb;
  n_main int; n_extra int; n_side int;
  falta text[] := '{}';
  problemas text[] := '{}';
  r record; g record;
  teto int; pode int;
  orcamento int; gasto int := 0;
  livre boolean := false;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'deck sem nome'; end if;
  if length(p_ydk) > 100000 then raise exception 'deck grande demais'; end if;

  -- A trava do modo livre. Recusar em vez de ignorar em silencio: um cliente
  -- que peca "livre" e receba uma gravacao NORMAL acharia que salvou algo que
  -- nao salvou, e o deck sumiria de novo no navegador.
  if p_livre then
    if not public.eh_admin() then
      raise exception 'so um admin pode gravar deck livre (sem conferir a Colecao)';
    end if;
    livre := true;
  end if;

  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  -- TAMANHO vale sempre, inclusive no modo livre (ver o cabecalho).
  if n_main < 40 or n_main > 60 then
    problemas := problemas || format('main tem %s cartas (precisa de 40 a 60)', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

  if not livre then
    col := coalesce(public.carteira_minha()->'collection', '{}'::jsonb);
    rar := public.raridade_das_cartas();
    select dados into banlist from public.conteudo where chave = 'banlist';
    lista := public.lista_ativa();          -- ja' vem o CONTEUDO, com fallback

    orcamento := coalesce((banlist->>'pointBudget')::int, 0);

    for r in
      select id, count(*)::int as pedidas
        from public.ydk_por_secao(p_ydk)
       where secao <> 'side'
       group by id
    loop
      -- POSSE, pela mesma regra da tela (Normal vale 3; R/SR/UR copia a copia).
      pode := public.copias_disponiveis(r.id::text, col, rar);
      if r.pedidas > pode then
        falta := falta || format('%s (pode levar %s, pediu %s)', r.id, pode, r.pedidas);
      end if;

      -- 1. TETO INDIVIDUAL: cada carta por si.
      teto := least(3, coalesce((banlist->'cardLimits'->>r.id::text)::int, 3));
      if r.pedidas > teto then
        problemas := problemas || format('%s: %s copias (max %s)', r.id, r.pedidas, teto);
      end if;

      -- 2. PONTO: custo POR COPIA, somado no deck inteiro.
      gasto := gasto + coalesce((banlist->'cardPoints'->>r.id::text)::int, 0) * r.pedidas;

      if lista is not null and not (lista @> to_jsonb(r.id)) then
        problemas := problemas || format('%s nao esta na lista permitida', r.id);
      end if;
    end loop;

    if orcamento > 0 and gasto > orcamento then
      problemas := problemas || format('deck custa %s pontos (o limite e %s)', gasto, orcamento);
    end if;

    -- 3. LISTA COMPARTILHADA: soma TODAS as cartas do mesmo grupo. O numero do
    --    grupo E' o teto — grupo "2" significa 2 copias somando os membros.
    for g in
      select (banlist->'cardGroups'->>c.id::text)::int as grupo,
             sum(c.pedidas)::int as total,
             string_agg(c.id::text, ', ' order by c.id) as cartas
        from (select id, count(*)::int as pedidas
                from public.ydk_por_secao(p_ydk)
               where secao <> 'side'
               group by id) c
       where (banlist->'cardGroups'->>c.id::text) is not null
       group by (banlist->'cardGroups'->>c.id::text)::int
    loop
      if g.grupo > 0 and g.total > g.grupo then
        problemas := problemas || format('as cartas %s dividem %s copias, mas o deck tem %s',
                                         g.cartas, g.grupo, g.total);
      end if;
    end loop;
  end if;

  if array_length(falta, 1) > 0 then
    raise exception 'cartas que voce nao possui: %', array_to_string(falta[1:5], ', ');
  end if;
  if array_length(problemas, 1) > 0 then
    raise exception 'deck invalido: %', array_to_string(problemas[1:5], '; ');
  end if;

  insert into public.decks_jogador (usuario_id, nome, ydk)
  values (uid, p_nome, p_ydk)
  on conflict (usuario_id, nome) do update
    set ydk = excluded.ydk, atualizado_em = now();

  return jsonb_build_object('ok', true, 'nome', p_nome,
                            'main', n_main, 'extra', n_extra, 'side', n_side,
                            'pontos', gasto, 'livre', livre);
end;
$$;

revoke all on function public.salvar_deck(text, text, boolean) from public, anon;
grant execute on function public.salvar_deck(text, text, boolean) to authenticated;

-- `apagar_deck(p_nome)` (migration 0006) ja' apaga so' o deck da PROPRIA conta
-- (`where usuario_id = uid`), entao a exclusao pedida na Area de Teste nao
-- precisa de funcao nova — precisa de tela, que e' `web/teste.html`.
