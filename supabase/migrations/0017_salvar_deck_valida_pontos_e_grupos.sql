-- ============================================================================
-- As TRES regras da banlist passam a valer no SERVIDOR.
--
-- `salvar_deck` conhecia so' `cardLimits` (o teto individual). As outras duas
-- viviam apenas em `validateBanlist` (web/js/banlist.js), chamado so' pelo
-- builder — ou seja, valiam so' na tela, e um `.ydk` montado no bloco de notas
-- passava direto por elas:
--
--   PONTO                `cardPoints` e' o custo POR COPIA; a soma do deck
--                        inteiro nao pode passar de `pointBudget`.
--                        Orcamento 0 = regra desligada.
--
--   LISTA COMPARTILHADA  um numero N em 2+ cartas faz elas DIVIDIREM N copias no
--                        total entre si (ex.: Pote da Ganancia e Foolish Burial
--                        os dois em "2" = 2 copias somando os dois, nao 2 de
--                        cada). E' o que a Banlist normal nao consegue
--                        expressar — e por isso o mais provavel de ser usado.
--
-- Os dois eixos estavam vazios quando isto foi escrito, entao nao havia brecha
-- ABERTA. Mas no dia em que a regra fosse usada, ninguem descobriria: o deck
-- simplesmente entraria.
--
-- Main e Extra contam JUNTOS (a mesma carta em zonas diferentes continua sendo a
-- mesma carta, mesmo espirito da banlist oficial). O `where secao <> 'side'`
-- exclui o Side, que nao vai para o duelo e nao deve consumir orcamento.
--
-- NOTA: `lista_ativa()` devolve o CONTEUDO da lista (jsonb), nao o nome da
-- chave — e ja' faz o fallback para 'lista1'. Usa-la como nome
-- (`where chave = public.lista_ativa()`) compara text com jsonb e derruba a
-- funcao inteira com "operator does not exist: text = jsonb".
-- ============================================================================

create or replace function public.salvar_deck(p_nome text, p_ydk text)
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
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'deck sem nome'; end if;
  if length(p_ydk) > 100000 then raise exception 'deck grande demais'; end if;

  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  if n_main < 40 or n_main > 60 then
    problemas := problemas || format('main tem %s cartas (precisa de 40 a 60)', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

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
                            'pontos', gasto);
end;
$$;

revoke all on function public.salvar_deck(text, text) from public, anon;
grant execute on function public.salvar_deck(text, text) to authenticated;

-- Conferido com uma conta e uma banlist de teste (restaurada depois):
--   PONTO   2x de uma carta de 5 pts com orcamento 10  -> salva ("pontos": 10)
--           3x = 15 > 10                               -> "deck custa 15 pontos (o limite e 10)"
--   TETO    2x de uma carta limitada a 1               -> "46986414: 2 copias (max 1)"
--   GRUPO   2+0 e 1+1 num grupo "2"                    -> salvam
--           2+1 = 3 > 2                                -> "as cartas ... dividem 2 copias, mas o deck tem 3"
--                                                         (cada uma sozinha estaria dentro do teto)
