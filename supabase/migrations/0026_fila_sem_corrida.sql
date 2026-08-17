-- ============================================================================
-- PAREAMENTO SEM CORRIDA (o "multiplayer congelou")
--
-- Relato de 17/08/2026: os dois clicam em procurar partida e a tela trava. O
-- banco explicou sozinho — DUAS partidas nasceram com 3 segundos de diferenca,
-- entre as MESMAS duas pessoas, espelhadas:
--
--   1f4fbf82  00:46:06  jogador_a=gabby       jogador_b=Felisberto  host=gabby
--   b972a026  00:46:09  jogador_a=Felisberto  jogador_b=gabby       host=Felisberto
--
-- Zero lances nas duas. Cada cliente entrou na SUA partida, cada um se achando
-- anfitriao, e nenhum lance atravessava: ninguem congelou, os dois estavam em
-- mesas diferentes esperando um jogador que nunca ia chegar.
--
-- A causa e' `entrar_na_fila` ser um CHECAR-E-AGIR sem trava:
--
--   1. "ja' estou numa partida?"      <- SELECT sem lock
--   2. "tem alguem na fila?"          <- SELECT ... FOR UPDATE SKIP LOCKED
--   3. cria a partida e limpa a fila
--
-- O `SKIP LOCKED` do passo 2 protege a LINHA DA FILA, e' verdade — mas nao
-- protege o passo 1. Com as duas chamadas em voo ao mesmo tempo, nenhuma
-- enxerga a partida que a outra ainda nao commitou (READ COMMITTED), as duas
-- passam pela verificacao e as duas inserem. O `SKIP LOCKED` ate' ajuda a
-- desgracar: em vez de uma esperar a outra, ela pula a linha travada e segue.
--
-- Conserto: uma trava consultiva de transacao no comeco, que faz do pareamento
-- inteiro uma secao critica. Nao e' `LOCK TABLE` de proposito — a trava
-- consultiva nao bloqueia leitura de ninguem e some sozinha no fim da
-- transacao (inclusive se der erro), o que e' exatamente o que se quer aqui.
-- O custo e' serializar o pareamento, que acontece um punhado de vezes por
-- minuto no melhor dos casos.
--
-- Com a trava, os dois cenarios ficam certos:
--   * A chega primeiro: nao acha ninguem, entra na fila, devolve pareado=false.
--     B chega depois, acha A, cria UMA partida.
--   * A e B chegam juntos: B espera a trava. Quando entra, ou ve' A na fila
--     (pareia) ou ve' a partida ja' criada (a verificacao do passo 1 agora e'
--     confiavel, porque a outra transacao ja' commitou).
--
-- O resto do corpo e' o da migration 0009, inalterado.
-- ============================================================================

create or replace function public.entrar_na_fila(p_deck text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  meu_ydk text; outro record; nova uuid;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- A SECAO CRITICA comeca aqui. A chave e' fixa: o que se serializa e' o ato
  -- de parear, nao um usuario ou um deck.
  perform pg_advisory_xact_lock(hashtext('duel-academy:pareamento'));

  -- O deck tem de ser SEU e ter passado por `salvar_deck` (legalidade, posse,
  -- banlist, Lista 1). Entrar na fila nao e' porta dos fundos para deck ilegal.
  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  -- Ja' estou numa partida em andamento? Entao nao entro em outra. Com a trava
  -- acima, esta verificacao finalmente vale: nao ha' outra chamada no meio do
  -- caminho criando uma partida que eu ainda nao consigo ver.
  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  select f.*, d.ydk into outro
    from public.fila f
    join public.decks_jogador d
      on d.usuario_id = f.usuario_id and d.nome = f.deck
   where f.usuario_id <> uid
   order by f.entrou_em
   for update of f skip locked
   limit 1;

  if outro is null then
    insert into public.fila (usuario_id, deck) values (uid, p_deck)
      on conflict (usuario_id) do update set deck = excluded.deck, entrou_em = now();
    return jsonb_build_object('pareado', false);
  end if;

  -- O outro pode ter entrado numa partida enquanto esperava na fila (por outro
  -- caminho, ou por uma fila velha que nao foi limpa). Parear com ele criaria a
  -- segunda mesa dele — o mesmo sintoma pela porta de tras.
  if exists (select 1 from public.partidas
              where (jogador_a = outro.usuario_id or jogador_b = outro.usuario_id)
                and estado in ('aguardando','em_andamento')) then
    delete from public.fila where usuario_id = outro.usuario_id;
    insert into public.fila (usuario_id, deck) values (uid, p_deck)
      on conflict (usuario_id) do update set deck = excluded.deck, entrou_em = now();
    return jsonb_build_object('pareado', false);
  end if;

  -- Quem esperava mais vira o jogador A (comeca o duelo) — recompensa pequena
  -- por ter ficado na fila, e uma regra fixa e' melhor que sortear.
  insert into public.partidas (jogador_a, jogador_b, deck_a, deck_b, ydk_a, ydk_b, seed)
  values (outro.usuario_id, uid, outro.deck, p_deck, outro.ydk, meu_ydk,
          -- Seed do SERVIDOR. Vinda do cliente, daria para procurar uma mao boa.
          (random() * 9223372036854775807)::bigint)
  returning id into nova;

  delete from public.fila where usuario_id in (uid, outro.usuario_id);
  return jsonb_build_object('pareado', true, 'partida', nova);
end;
$$;

grant execute on function public.entrar_na_fila(text) to authenticated;
