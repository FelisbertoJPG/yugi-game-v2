-- ============================================================================
-- ADMIN CREDITA DP (Area de Teste)
--
-- A migration 0004 tirou o botao "+ Adicionar DP" da Area de Teste e o
-- `teste.html` passou a dizer "para testar com saldo alto, credite pelo SQL
-- Editor". O motivo era certo — nao adianta o servidor sortear o pacote se o
-- cliente imprime a moeda para compra-lo — mas a conclusao foi longe demais:
-- quem administra o jogo PRECISA de saldo para testar Loja, booster e
-- estrutural, e mandar o admin abrir o SQL Editor a cada teste e' atrito puro.
--
-- O que muda: o credito volta a existir, mas como funcao do SERVIDOR guardada
-- por `eh_admin()`. Jogador comum leva "apenas admin credita DP" e a carteira
-- dele continua decidida so' por abrir pacote e vencer duelo, exatamente como
-- a 0004 estabeleceu. O poder e' de quem ja' podia publicar booster e banlist.
-- ============================================================================

/**
 * Credita (ou debita, com valor negativo) DP na carteira do PROPRIO admin.
 *
 * O teto por chamada nao e' desconfianca: e' o dedo escorregando num zero a
 * mais. 1.000.000 cobre qualquer teste e um engano fica facil de desfazer.
 * O saldo nunca fica negativo — debitar demais para em zero.
 */
create or replace function public.creditar_dp(p_valor int)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  w   jsonb;
  antes int;
  depois int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if not public.eh_admin() then raise exception 'apenas admin credita DP'; end if;
  if p_valor is null or p_valor = 0 then raise exception 'informe um valor diferente de zero'; end if;
  if abs(p_valor) > 1000000 then raise exception 'valor fora do limite (max 1.000.000 por vez)'; end if;

  -- `carteira_minha` cria a carteira na primeira chamada, entao serve tambem
  -- para o admin que nunca abriu um pacote.
  w := public.carteira_minha();
  antes := coalesce((w->>'dp')::int, 0);
  depois := greatest(0, antes + p_valor);

  update public.carteiras
     set dados = jsonb_set(dados, '{dp}', to_jsonb(depois)),
         atualizado_em = now()
   where usuario_id = uid;

  return jsonb_build_object('ok', true, 'antes', antes, 'depois', depois,
                            'delta', depois - antes);
end;
$$;

revoke all on function public.creditar_dp(int) from public, anon;
grant execute on function public.creditar_dp(int) to authenticated;
