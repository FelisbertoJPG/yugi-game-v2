-- ============================================================================
-- LISTAS DE CARTAS EDITAVEIS (editor `web/listas.html`, Area de Teste)
--
-- Ate aqui, acrescentar uma carta a' Lista 1 era: editar `web/js/lista1.js`,
-- rodar `tools/publicar-conteudo.mjs` e publicar um Release. O pool restrito da
-- fase 1 e' conteudo do JOGO, nao codigo — e conteudo do jogo mora no banco,
-- como a banlist, os boosters e os decks de NPC.
--
-- Duas coisas mudam aqui:
--
--   1) `conteudo.chave` aceitava so' uma lista FECHADA de 5 chaves. O editor
--      grava `cardlists` (a fonte: tipos por regra + cartas avulsas) e uma
--      chave por lista com o RESULTADO resolvido — inclusive de listas que
--      ainda nao existem. Sem isto, salvar uma "Lista 2" levava 23514 e o
--      motivo nao aparecia em lugar nenhum da tela.
--
--   2) `salvar_deck` conferia o deck contra `lista1`, escrito na mao. A banlist
--      ja' carrega `listId` desde que `cardlists.js` existe, entao criar uma
--      Lista 2 e apontar a banlist para ela conferia contra o pool ERRADO — e
--      em silencio, que e' o pior jeito: o deck e' aceito ou recusado por uma
--      regra que ninguem escolheu.
-- ============================================================================

-- --------------------------------------------------------------- 1) a chave
alter table public.conteudo drop constraint if exists conteudo_chave_check;

alter table public.conteudo add constraint conteudo_chave_check check (
  chave = any (array['banlist', 'boosters', 'npcs', 'npc-base-meta', 'cardlists'])
  -- Uma chave por lista de cartas, com o array de ids resolvido. O prefixo
  -- obrigatorio (e o editor gera o slug assim) mantem a trava fazendo o que ela
  -- sempre fez: barrar chave inventada por engano, sem virar um balde aberto.
  or chave ~ '^lista[a-z0-9-]{0,31}$'
);

comment on constraint conteudo_chave_check on public.conteudo is
  'Conteudo global conhecido, mais uma chave por lista de cartas (lista1, lista2, lista-torneio...).';


-- ------------------------------------------------- 2) o pool que vale e' o escolhido
/**
 * Qual lista de cartas rege a construcao de deck hoje.
 *
 * Vem do `listId` da banlist publicada — o MESMO campo que o Deck Builder e o
 * editor de banlist ja' leem no cliente. Sem banlist publicada, ou com um
 * `listId` que nao aponta para lista nenhuma, cai em `lista1`: recusar todo
 * deck do jogo por causa de uma chave faltando seria bem pior.
 */
create or replace function public.lista_ativa()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare alvo text; dados_lista jsonb;
begin
  select coalesce(dados->>'listId', 'lista1') into alvo
    from public.conteudo where chave = 'banlist';
  alvo := coalesce(alvo, 'lista1');

  select dados into dados_lista from public.conteudo where chave = alvo;
  if dados_lista is null and alvo <> 'lista1' then
    select dados into dados_lista from public.conteudo where chave = 'lista1';
  end if;
  return dados_lista;
end;
$$;

create or replace function public.salvar_deck(p_nome text, p_ydk text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  col jsonb; banlist jsonb; lista jsonb; rar jsonb;
  n_main int; n_extra int; n_side int;
  falta text[] := '{}';
  problemas text[] := '{}';
  r record;
  teto int; pode int;
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
  lista := public.lista_ativa();   -- era `where chave = 'lista1'`, na mao

  for r in
    select id, count(*)::int as pedidas from public.ydk_por_secao(p_ydk) group by id
  loop
    -- POSSE, pela MESMA regra da tela (ver 0015).
    pode := public.copias_disponiveis(r.id::text, col, rar);
    if r.pedidas > pode then
      falta := falta || format('%s (pode levar %s, pediu %s)', r.id, pode, r.pedidas);
    end if;

    teto := least(3, coalesce((banlist->'cardLimits'->>r.id::text)::int, 3));
    if r.pedidas > teto then
      problemas := problemas || format('%s: %s copias (max %s)', r.id, r.pedidas, teto);
    end if;

    if lista is not null and not (lista @> to_jsonb(r.id)) then
      problemas := problemas || format('%s nao esta na lista permitida', r.id);
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
                            'main', n_main, 'extra', n_extra, 'side', n_side);
end;
$$;

revoke all on function public.lista_ativa()           from public, anon, authenticated;
revoke all on function public.salvar_deck(text, text) from public, anon;
grant execute on function public.salvar_deck(text, text) to authenticated;
