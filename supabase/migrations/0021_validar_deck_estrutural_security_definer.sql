-- ============================================================================
-- BUG DE PERDA DE DADO: publicar um Deck Estrutural NUNCA gravou.
--
-- `validar_deck_estrutural` (0017) e' a PRIMEIRA coisa que o botao "publicar"
-- chama, e ela nao e' SECURITY DEFINER — roda como `authenticated`. Por dentro
-- ela chama `public.ydk_por_secao`, de quem a 0013 revogou o EXECUTE publico.
--
--   set local role authenticated;
--   select public.validar_deck_estrutural('#main' || repeat(E'\n46986414', 40));
--   ERROR: 42501: permission denied for function ydk_por_secao
--
-- O cliente traduzia isso para "deck invalido: permission denied..." e abortava
-- ANTES do insert. Nada era gravado, e o builder so' tinha o deck em memoria —
-- fechar a aba perdia o trabalho inteiro. Foi o que aconteceu.
--
-- Vale para QUALQUER conta, inclusive admin: admin tambem e' `authenticated`,
-- e a RLS de `decks_estruturais` nunca chegava a ser consultada.
--
-- O conserto e' o mesmo padrao de `salvar_deck` e `comprar_deck_estrutural`:
-- SECURITY DEFINER com `search_path` fixo. A funcao nao le nem escreve tabela
-- nenhuma — recebe um texto, conta as cartas e devolve os problemas — entao
-- rodar como dona nao da' acesso a dado de ninguem.
-- ============================================================================

create or replace function public.validar_deck_estrutural(p_ydk text)
returns jsonb language plpgsql immutable security definer
set search_path = public as $$
declare
  n_main int; n_extra int; n_side int; problemas text[] := '{}'; r record;
begin
  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  if n_main < 40 then
    problemas := problemas || format('o deck tem %s cartas — o minimo e 40', n_main);
  elsif n_main > 60 then
    problemas := problemas || format('o deck tem %s cartas — o maximo e 60', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

  for r in select id, count(*)::int as q from public.ydk_por_secao(p_ydk) group by id loop
    if r.q > 3 then problemas := problemas || format('%s: %s copias (max 3)', r.id, r.q); end if;
  end loop;

  return jsonb_build_object('ok', array_length(problemas, 1) is null,
                            'main', n_main, 'extra', n_extra, 'side', n_side,
                            'problemas', to_jsonb(problemas));
end;
$$;

revoke all on function public.validar_deck_estrutural(text) from public, anon;
grant execute on function public.validar_deck_estrutural(text) to authenticated;
