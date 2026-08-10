-- ============================================================================
-- BUG DE PRODUCAO: a partida nunca saia de 'em_andamento'.
--
-- `abandonar_partida` (0009) so' aceitava 'aguardando' — serve para desistir de
-- uma sala que ainda nao formou. Depois que o duelo comecava, NADA o encerrava:
-- o resultado nao voltava do motor, e nao havia botao de desistir.
--
-- O efeito era pior que uma linha velha no banco: `entrar_na_fila`, `criar_sala`
-- e `desafiar_amigo` recusam quem ja' esta' numa partida, entao os DOIS
-- jogadores ficavam trancados para sempre. E a tela de multiplayer, ao ver a
-- partida 'em_andamento', mandava de volta para o duelo — era o "clico em
-- multiplayer e volto pro duelo infinitamente" que o teste relatou.
-- ============================================================================

/**
 * Encerra a partida. Serve para os dois casos:
 *
 *   - `p_vencedor` = quem ganhou, quando o duelo terminou de verdade (o
 *     `duel.html` chama ao receber o evento `end` do motor);
 *   - `p_vencedor` NULL = eu desisti, e o outro ganha.
 *
 * Qualquer um dos dois participantes pode chamar, e isso NAO e' descuido: no
 * modo ponte quem hospeda ja' roda o motor e decide tudo — uma trava aqui daria
 * trabalho sem dar seguranca, e e' por isso que partida de ponte nao paga DP nem
 * conta ranking. Quando a arena existir, so' o servidor dela encerrara.
 *
 * Idempotente: encerrar duas vezes nao reescreve o vencedor. Sem isso, os dois
 * clientes vendo o `end` ao mesmo tempo poderiam gravar resultados diferentes.
 *
 * NOTA: a variavel do vencedor e' `v_vencedor`, com prefixo. Sem ele, o
 * `update ... set vencedor = vencedor` nao sabia se o lado direito era a
 * variavel ou a COLUNA — "column reference vencedor is ambiguous" — e a funcao
 * morria antes de encerrar nada. Armadilha classica de plpgsql.
 */
create or replace function public.encerrar_partida(p_partida uuid, p_vencedor uuid default null)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); m record; v_vencedor uuid;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select * into m from public.partidas where id = p_partida for update;
  if m is null then raise exception 'partida nao encontrada'; end if;
  if m.jogador_a <> uid and coalesce(m.jogador_b, '00000000-0000-0000-0000-000000000000') <> uid then
    raise exception 'voce nao esta nesta partida';
  end if;

  if m.estado in ('encerrada', 'abandonada') then
    return jsonb_build_object('ok', true, 'ja_estava', true, 'vencedor', m.vencedor);
  end if;

  v_vencedor := coalesce(
    p_vencedor,
    case when m.jogador_a = uid then m.jogador_b else m.jogador_a end);

  -- O vencedor tem de ser um dos dois: um id qualquer viraria "ganhou" para
  -- alguem que nem jogou.
  if v_vencedor is not null
     and v_vencedor <> m.jogador_a
     and v_vencedor is distinct from m.jogador_b then
    raise exception 'vencedor invalido para esta partida';
  end if;

  update public.partidas
     set estado = 'encerrada', vencedor = v_vencedor, encerrada_em = now()
   where id = p_partida;

  return jsonb_build_object('ok', true, 'vencedor', v_vencedor);
end;
$$;

/**
 * Solta quem ficou preso: encerra TUDO que este jogador tem em aberto e o tira
 * da fila.
 *
 * E' a valvula de escape da tela de multiplayer. Sem ela, uma partida que travou
 * (o outro fechou o navegador, a maquina caiu) tranca o jogador para sempre,
 * porque toda porta de entrada recusa quem ja' esta' numa partida.
 */
create or replace function public.sair_de_tudo()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  update public.partidas
     set estado = 'abandonada', encerrada_em = now(),
         vencedor = case when jogador_a = uid then jogador_b else jogador_a end
   where (jogador_a = uid or jogador_b = uid)
     and estado in ('aguardando', 'em_andamento');
  get diagnostics n = row_count;

  delete from public.fila where usuario_id = uid;
  return jsonb_build_object('ok', true, 'encerradas', n);
end;
$$;

revoke all on function public.encerrar_partida(uuid, uuid) from public, anon;
revoke all on function public.sair_de_tudo()               from public, anon;
grant execute on function public.encerrar_partida(uuid, uuid) to authenticated;
grant execute on function public.sair_de_tudo()               to authenticated;

-- Solta as partidas que JA' estavam presas quando isto foi aplicado. Sem esta
-- linha a correcao valeria so' para partidas futuras, e quem estava travado
-- continuaria travado.
update public.partidas
   set estado = 'abandonada', encerrada_em = now()
 where estado in ('aguardando', 'em_andamento')
   and criado_em < now() - interval '10 minutes';
