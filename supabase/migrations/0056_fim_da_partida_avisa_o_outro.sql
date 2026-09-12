-- 0056 — O FIM DA PARTIDA AVISA O OUTRO LADO
--
-- Relato: *"quando a battle e' vencida por um jogador a batalha deve encerrar e
-- ambos devem ser redirecionados pra Home. Inclusive se um player desistir o
-- outro tbm... Hoje a sala fica aberta e o duelo n encerra"*.
--
-- A metade que faltava estava AQUI, e nao no front. `encerrar_partida` (0016)
-- fecha a linha em `partidas` — mas quem chamou e' o unico que sabe disso. O
-- adversario esta' com o `duel.html` aberto ouvindo `ler_lances`, e a
-- desistencia nao escreve lance nenhum: ele fica olhando um tabuleiro vivo de
-- uma partida que ja' acabou, para sempre, ate' apertar "estou preso".
--
-- A correcao e' escrever o fim NO MESMO CANAL por onde o duelo ja' anda. A
-- tabela `lances` existe exatamente para isso: e' a caixa de entrada da ponte,
-- ja' enderecada (`para`) e ja' consultada uma vez por segundo pelos dois lados.
-- Um terceiro tipo, `fim`, e o adversario recebe a noticia na mesma volta do
-- laco em que receberia uma jogada — sem consulta nova, sem canal novo.
--
-- Quem escreve o lance e' a PROPRIA `encerrar_partida`: quem decide o fim e' o
-- servidor, entao e' o servidor que avisa. Deixar o cliente publicar o proprio
-- "eu desisti" seria a mesma verdade em dois lugares — e o lado que fechasse o
-- navegador entre uma coisa e outra deixaria o outro preso de novo.
--
-- EMPATE — o buraco que so' apareceu quando o fim virou noticia. O `duel.html`
-- chamava `encerrar_partida(id, null)` para o empate, e `null` ali quer dizer
-- "eu desisti, o outro ganha" (o `coalesce` logo abaixo). O empate virava
-- vitoria de quem nao ganhou, e agora viraria tambem um *"seu adversario
-- desistiu"* na tela dele. Por isso entra `p_empate`.
--
-- A funcao de 2 argumentos e' DERRUBADA e recriada com o terceiro tendo DEFAULT:
-- o PostgREST casa pelo conjunto de nomes que chegam no corpo, entao um cliente
-- antigo, que manda so' `p_partida`/`p_vencedor`, continua funcionando igual.

-- ---------------------------------------------------------------- o tipo novo
--
-- `fim` e' o unico lance que NAO carrega estado de duelo: ele diz que nao ha'
-- mais duelo. `dados` guarda `{vencedor, motivo}` — o motivo e' o que deixa a
-- tela escrever "seu adversario desistiu" em vez de um "voce venceu" seco.
alter table public.lances drop constraint if exists lances_tipo_check;
alter table public.lances add constraint lances_tipo_check
  check (tipo in ('jogada', 'estado', 'fim'));

comment on table public.lances is
  'Mensagens da ponte. jogada = clique do convidado; estado = a visao que o '
  'anfitriao devolve; fim = a partida acabou (vencedor + motivo).';

-- ------------------------------------------------------------ encerrar_partida

drop function if exists public.encerrar_partida(uuid, uuid);

/**
 * Encerra a partida. Tres casos, e o terceiro e' o que a 0016 nao tinha:
 *
 *   - `p_vencedor` = quem ganhou, quando o duelo terminou de verdade (o
 *     `duel.html` chama ao receber o evento `end` do motor);
 *   - `p_vencedor` NULL = eu desisti, e o outro ganha;
 *   - `p_empate` = ninguem ganhou (os dois LP zeraram no mesmo golpe). Sem ele,
 *     um empate era gravado como vitoria do adversario.
 *
 * Qualquer um dos dois participantes pode chamar, e isso NAO e' descuido: no
 * modo ponte quem hospeda ja' roda o motor e decide tudo — uma trava aqui daria
 * trabalho sem dar seguranca, e e' por isso que partida de ponte nao paga DP nem
 * conta ranking. Quando a arena existir, so' o servidor dela encerrara.
 *
 * Idempotente: encerrar duas vezes nao reescreve o vencedor NEM avisa o outro
 * duas vezes. Isso importa mais do que parece — no fim normal os DOIS lados
 * chamam (cada um ao ver o `end` do motor), e sem a saida antecipada o vencedor
 * receberia um "a partida acabou" depois de ja' ter visto a propria vitoria.
 *
 * NOTA: a variavel do vencedor e' `v_vencedor`, com prefixo. Sem ele, o
 * `update ... set vencedor = vencedor` nao sabia se o lado direito era a
 * variavel ou a COLUNA — "column reference vencedor is ambiguous" — e a funcao
 * morria antes de encerrar nada. Armadilha classica de plpgsql.
 */
create or replace function public.encerrar_partida(
  p_partida uuid, p_vencedor uuid default null, p_empate boolean default false)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  m record;
  v_vencedor uuid;
  v_outro uuid;
  v_motivo text;
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

  -- O `motivo` sai do que o cliente mandou, e nao do estado do tabuleiro:
  -- vencedor NULO sem empate so' acontece quando alguem apertou "desistir".
  if coalesce(p_empate, false) then
    v_vencedor := null;
    v_motivo   := 'empate';
  else
    v_vencedor := coalesce(
      p_vencedor,
      case when m.jogador_a = uid then m.jogador_b else m.jogador_a end);
    v_motivo   := case when p_vencedor is null then 'desistencia' else 'duelo' end;
  end if;

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

  -- A NOTICIA. Vai para o OUTRO, porque quem chamou ja' sabe — e so' quando ha'
  -- outro: numa sala que nunca formou, `jogador_b` e' nulo e a FK de `para`
  -- recusaria a linha.
  v_outro := case when m.jogador_a = uid then m.jogador_b else m.jogador_a end;
  if v_outro is not null then
    insert into public.lances (partida, tipo, autor, para, dados)
    values (p_partida, 'fim', uid, v_outro,
            jsonb_build_object('vencedor', v_vencedor, 'motivo', v_motivo));
  end if;

  return jsonb_build_object('ok', true, 'vencedor', v_vencedor, 'motivo', v_motivo);
end;
$$;

-- ---------------------------------------------------------------- sair_de_tudo

/**
 * Solta quem ficou preso: encerra TUDO que este jogador tem em aberto e o tira
 * da fila.
 *
 * E' a valvula de escape da tela de multiplayer. Sem ela, uma partida que travou
 * (o outro fechou o navegador, a maquina caiu) tranca o jogador para sempre,
 * porque toda porta de entrada recusa quem ja' esta' numa partida.
 *
 * Avisa o adversario pelo mesmo canal, e pelo mesmo motivo: apertar "estou
 * preso" e' desistir. Se o outro ainda estiver com o duelo aberto, ele ve a
 * tela de fim em vez de continuar jogando sozinho contra um tabuleiro parado.
 */
create or replace function public.sair_de_tudo()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); n int := 0; p record;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- Uma a uma, e nao num `update` so': cada partida precisa do lance de aviso
  -- para o SEU adversario, e um comando em lote nao tem onde escrever isso.
  -- Sao no maximo duas linhas na pratica (a fila recusa quem ja' esta' jogando).
  for p in
    select id, jogador_a, jogador_b from public.partidas
     where (jogador_a = uid or jogador_b = uid)
       and estado in ('aguardando', 'em_andamento')
     for update
  loop
    update public.partidas
       set estado = 'abandonada', encerrada_em = now(),
           vencedor = case when p.jogador_a = uid then p.jogador_b else p.jogador_a end
     where id = p.id;
    n := n + 1;

    if (case when p.jogador_a = uid then p.jogador_b else p.jogador_a end) is not null then
      insert into public.lances (partida, tipo, autor, para, dados)
      values (p.id, 'fim', uid,
              case when p.jogador_a = uid then p.jogador_b else p.jogador_a end,
              jsonb_build_object(
                'vencedor', case when p.jogador_a = uid then p.jogador_b else p.jogador_a end,
                'motivo', 'desistencia'));
    end if;
  end loop;

  delete from public.fila where usuario_id = uid;
  return jsonb_build_object('ok', true, 'encerradas', n);
end;
$$;

-- O furo da 0013 VOLTA a cada funcao nova, e a `encerrar_partida` aqui e' NOVA
-- (assinatura diferente): o Postgres da' EXECUTE ao role PUBLIC em
-- `create function`, e `grant ... to authenticated` soma em vez de restringir.
revoke all on function public.encerrar_partida(uuid, uuid, boolean) from public, anon;
revoke all on function public.sair_de_tudo()                        from public, anon;

grant execute on function public.encerrar_partida(uuid, uuid, boolean) to authenticated;
grant execute on function public.sair_de_tudo()                       to authenticated;
