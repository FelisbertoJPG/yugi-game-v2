-- 0047 — A BANLIST TAMBEM VALE NA PORTA DO DUELO.
--
-- O relato: *"o player ta conseguindo duelar com um deck que possui mais de uma
-- copia de cards limitados"*. Estava certo, e o caminho e' curto de explicar:
--
--   `salvar_deck` sempre cobrou a banlist. Mas o duelo NAO passa por ele. O
--   `chosenDeck()` de `web/duel.html` le o deck do **localStorage** e manda as
--   cartas direto para o motor local; o unico servidor no caminho e'
--   `iniciar_duelo`, que recebia so' o NOME do deck — nunca as cartas.
--
-- Ou seja: o builder recusava salvar, o banco recusava gravar, e o deck ficava
-- so' naquele navegador... de onde o duelo o carregava normalmente. A regra
-- existia nas duas pontas erradas.
--
-- Sao tres mudancas:
--
--   1. **`problemas_de_banlist(ids)`** — as regras da banlist saem de dentro do
--      `salvar_deck` e viram funcao propria. Nao e' arrumacao: agora QUATRO
--      lugares fazem a mesma pergunta, e este projeto ja' pagou o preco de duas
--      copias da mesma conta divergindo caladas (`chancesDe` x
--      `chancesDoPacote`). Uma copia so'.
--
--   2. **`iniciar_duelo` ganha as CARTAS** (`p_cartas`) e recusa o deck fora da
--      regra. E' a fechadura: a tela tambem confere antes de acender o motor,
--      mas a tela e' a porta — quem a contorna abre o console.
--
--   3. **As cinco entradas do PvP** conferem o `.ydk` que ja' tinham em maos.
--      La' o buraco era outro e mais estreito: elas leem o deck de
--      `decks_jogador` pelo nome, entao um deck so' do navegador nem aparece —
--      mas um deck salvo ANTES de a carta virar Limitada continuava valendo
--      para sempre, porque `salvar_deck` so' confere na hora de salvar.
--
-- **ADMIN passa, e passa AVISADO.** Mesma decisao da 0042 (a parede de versao),
-- e pelo mesmo motivo: quem edita a banlist nao pode ser trancado por ela. Alem
-- disso `p_livre` (0024) existe justamente para o admin gravar deck que quebra
-- as regras, e um deck que nao pode ser jogado nao serve para testar nada. A
-- tela mostra o aviso do mesmo jeito para ele — barrar em silencio e liberar em
-- silencio sao os dois jeitos de a regra virar mentira.
--
-- **Cliente antigo** (sem `p_cartas`): em vez de deixar passar, confere o que
-- estiver SALVO com aquele nome, que e' a unica coisa que o servidor conhece
-- dele. Nao alcanca o deck que so' existe no navegador — para esse caso quem
-- responde e' a parede de versao (0041).
--
-- O que NAO entrou de proposito: a POSSE (a Colecao). Ela e' regra de outra
-- familia, mora em `copias_disponiveis`, e um falso positivo ali barraria o
-- jogador de duelar por causa de um cache de carteira. O pedido era a banlist.

-- ---------------------------------------------------------------------------
-- 1. As regras da banlist, num lugar so'.
--
-- Recebe os ids JA' EXPANDIDOS (uma entrada por copia), main + extra, sem o
-- side — a mesma fatia que `salvar_deck` sempre cobrou. Devolve a lista de
-- problemas, vazia quando o deck esta' em regra.
--
-- `security definer` porque le `conteudo` e chama `lista_ativa()`, que nao e'
-- executavel por `authenticated`.
-- ---------------------------------------------------------------------------
create or replace function public.problemas_de_banlist(p_ids bigint[])
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  banlist jsonb; lista jsonb;
  problemas text[] := '{}';
  orcamento int; gasto int := 0;
  teto int;
  r record; g record;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return problemas; end if;

  select dados into banlist from public.conteudo where chave = 'banlist';
  lista := public.lista_ativa();          -- ja' vem o CONTEUDO, com fallback
  orcamento := coalesce((banlist->>'pointBudget')::int, 0);

  for r in
    select t.id, count(*)::int as pedidas
      from unnest(p_ids) as t(id)
     group by t.id
  loop
    -- 1. TETO INDIVIDUAL: cada carta por si. O `least(3, ...)` e' o que faz o
    --    teto 0 (carta BANIDA) recusar a carta inteira, e nao virar um "L0".
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
      from (select t.id, count(*)::int as pedidas
              from unnest(p_ids) as t(id) group by t.id) c
     where (banlist->'cardGroups'->>c.id::text) is not null
     group by (banlist->'cardGroups'->>c.id::text)::int
  loop
    if g.grupo > 0 and g.total > g.grupo then
      problemas := problemas || format('as cartas %s dividem %s copias, mas o deck tem %s',
                                       g.cartas, g.grupo, g.total);
    end if;
  end loop;

  return problemas;
end;
$$;

-- A mesma pergunta, a partir do texto do `.ydk` — a forma em que as cinco
-- entradas do PvP e o `salvar_deck` ja' tem o deck em maos.
create or replace function public.problemas_do_ydk(p_ydk text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.problemas_de_banlist(
           array(select y.id from public.ydk_por_secao(p_ydk) y where y.secao <> 'side'));
$$;

-- A tela chama `problemas_de_banlist` para conferir ANTES de acender o motor —
-- e' o unico jeito de o aviso dizer O QUE esta' errado em vez de o duelo
-- simplesmente nao comecar. Ela nao escreve nada e nao conta segredo nenhum: a
-- resposta e' sobre as cartas que o proprio chamador mandou.
-- `revoke from public` NAO alcanca a concessao direta que o Supabase da' a
-- `anon` e `authenticated` em toda funcao nova de `public` — por isso os dois
-- aparecem por nome. `problemas_do_ydk` nao e' chamada pela tela: ela existe
-- para as entradas do PvP e para o `salvar_deck`, que rodam como `definer`.
revoke all on function public.problemas_de_banlist(bigint[]) from public, anon;
revoke all on function public.problemas_do_ydk(text) from public, anon, authenticated;
grant execute on function public.problemas_de_banlist(bigint[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. `salvar_deck` passa a usar a copia unica.
--
-- Some daqui: teto individual, pontos, lista permitida e lista compartilhada.
-- Fica: TAMANHO (vale ate' no modo livre) e POSSE (regra de outra familia).
-- ---------------------------------------------------------------------------
create or replace function public.salvar_deck(p_nome text, p_ydk text, p_livre boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  col jsonb; rar jsonb; banlist jsonb;
  n_main int; n_extra int; n_side int;
  falta text[] := '{}';
  problemas text[] := '{}';
  r record;
  pode int;
  gasto int := 0;
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

    -- POSSE, pela mesma regra da tela (Normal vale 3; R/SR/UR copia a copia).
    for r in
      select y.id, count(*)::int as pedidas
        from public.ydk_por_secao(p_ydk) y
       where y.secao <> 'side'
       group by y.id
    loop
      pode := public.copias_disponiveis(r.id::text, col, rar);
      if r.pedidas > pode then
        falta := falta || format('%s (pode levar %s, pediu %s)', r.id, pode, r.pedidas);
      end if;
    end loop;

    -- BANLIST: teto individual, pontos, lista compartilhada e lista permitida.
    -- A conta mora em `problemas_de_banlist` porque a porta do duelo e o PvP
    -- fazem a MESMA pergunta — duas copias divergiriam caladas.
    problemas := problemas || public.problemas_do_ydk(p_ydk);

    select dados into banlist from public.conteudo where chave = 'banlist';
    select coalesce(sum(coalesce((banlist->'cardPoints'->>c.id::text)::int, 0) * c.pedidas), 0)
      into gasto
      from (select y.id, count(*)::int as pedidas
              from public.ydk_por_secao(p_ydk) y
             where y.secao <> 'side' group by y.id) c;
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

-- ---------------------------------------------------------------------------
-- 3. A PORTA DO DUELO.
--
-- `p_cartas` chega com main + extra, uma entrada por copia — exatamente o que o
-- motor vai receber. Sem ele (cliente antigo), confere o deck SALVO com aquele
-- nome; o que so' existe no navegador fica fora do alcance, e para esse caso
-- quem responde e' a parede de versao (0041).
-- ---------------------------------------------------------------------------
-- **`create or replace` NAO substitui quando o parametro e' novo.** Acrescentar
-- `p_cartas` cria uma SOBRECARGA: a versao de 5 argumentos continua viva, sem
-- trava nenhuma, e o PostgREST roteia para ela toda chamada no formato de
-- ontem — a trava viraria enfeite e nada acusaria. A nova tem default em tudo
-- menos `p_npc`, entao ela atende sozinha as chamadas antigas.
--
-- O `drop` vem DEPOIS do `create`: entre um e outro nao pode existir instante
-- sem `iniciar_duelo` nenhuma.
create or replace function public.iniciar_duelo(
  p_npc text,
  p_deck text default null,
  p_deck_npc text default null,
  p_game text default '',
  p_exe text default '',
  p_cartas bigint[] default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  novo uuid;
  abertos int;
  v public.versao_minima%rowtype;
  probs text[] := '{}';
  salvo text;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- AS TRAVAS vem ANTES de qualquer escrita: barrar depois de ja' ter marcado o
  -- duelo anterior como abandonado cobraria do jogador barrado o preco de uma
  -- partida que ele nem chegou a comecar.
  select * into v from public.versao_minima where id = 1;
  if found and v.modo = 'bloquear' and not public.eh_admin()
     and not (public.versao_alcanca(p_game, v.game) and public.versao_alcanca(p_exe, v.exe)) then
    raise exception '%', v.recado;
  end if;

  -- A BANLIST. Admin passa (ver o cabecalho): ele edita a lista e o `p_livre`
  -- existe para gravar deck que a quebra de proposito. A conferencia so' e'
  -- pulada para ele — a tela avisa dos dois lados.
  if not public.eh_admin() then
    if p_cartas is not null then
      probs := public.problemas_de_banlist(p_cartas);
    else
      select ydk into salvo from public.decks_jogador
       where usuario_id = uid and nome = p_deck;
      if salvo is not null then probs := public.problemas_do_ydk(salvo); end if;
    end if;
    if array_length(probs, 1) > 0 then
      raise exception 'este deck nao pode duelar: %; ajuste-o no Deck Builder',
                      array_to_string(probs[1:5], '; ');
    end if;
  end if;

  update public.duelos
     set resultado = 'abandonado', encerrado_em = now()
   where usuario_id = uid and resultado is null;

  select count(*) into abertos from public.duelos
   where usuario_id = uid and iniciado_em > now() - interval '1 hour';
  if abertos >= 60 then raise exception 'muitos duelos iniciados nesta hora'; end if;

  insert into public.duelos (usuario_id, npc, deck, deck_npc)
  values (uid, p_npc, p_deck, nullif(btrim(coalesce(p_deck_npc, '')), ''))
  returning id into novo;
  return novo;
end;
$$;

drop function if exists public.iniciar_duelo(text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 4. AS CINCO ENTRADAS DO PvP.
--
-- Todas ja' carregam `meu_ydk` de `decks_jogador` — entao o deck que so' existe
-- no navegador nunca chegou la'. O que faltava e' o deck salvo ANTES de a carta
-- virar Limitada, que continuava valendo para sempre.
--
-- Aqui o admin NAO e' isento: do outro lado da mesa tem gente.
-- ---------------------------------------------------------------------------
create or replace function public.criar_sala(p_deck text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid(); meu_ydk text; codigo text; nova uuid; probs text[];
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  probs := public.problemas_do_ydk(meu_ydk);
  if array_length(probs, 1) > 0 then
    raise exception 'este deck nao pode duelar: %; ajuste-o no Deck Builder',
                    array_to_string(probs[1:5], '; ');
  end if;

  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  codigo := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.partidas (jogador_a, deck_a, ydk_a, seed, modo, host, convite)
  values (uid, p_deck, meu_ydk, (random() * 9223372036854775807)::bigint,
          'ponte', uid, codigo)
  returning id into nova;

  return jsonb_build_object('partida', nova, 'convite', codigo);
end;
$$;

create or replace function public.entrar_na_sala(p_convite text, p_deck text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid(); meu_ydk text; sala record; probs text[];
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  probs := public.problemas_do_ydk(meu_ydk);
  if array_length(probs, 1) > 0 then
    raise exception 'este deck nao pode duelar: %; ajuste-o no Deck Builder',
                    array_to_string(probs[1:5], '; ');
  end if;

  select * into sala from public.partidas
   where convite = p_convite and estado = 'aguardando'
   for update;

  if sala is null then raise exception 'convite invalido ou ja usado'; end if;
  if sala.jogador_b is not null then raise exception 'esta sala ja esta cheia'; end if;
  if sala.jogador_a = uid then raise exception 'voce nao pode duelar contra si mesmo'; end if;

  update public.partidas
     set jogador_b = uid, deck_b = p_deck, ydk_b = meu_ydk,
         convite = null,                       -- queima o link
         estado = 'em_andamento'
   where id = sala.id;

  return jsonb_build_object('partida', sala.id);
end;
$$;

create or replace function public.aceitar_desafio(p_partida uuid, p_deck text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid(); meu_ydk text; sala record; probs text[];
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  probs := public.problemas_do_ydk(meu_ydk);
  if array_length(probs, 1) > 0 then
    raise exception 'este deck nao pode duelar: %; ajuste-o no Deck Builder',
                    array_to_string(probs[1:5], '; ');
  end if;

  select * into sala from public.partidas
   where id = p_partida and convidado = uid and estado = 'aguardando'
   for update;
  if sala is null then raise exception 'desafio nao encontrado ou ja respondido'; end if;
  if sala.jogador_b is not null then raise exception 'esta sala ja esta cheia'; end if;

  update public.partidas
     set jogador_b = uid, deck_b = p_deck, ydk_b = meu_ydk,
         convite = null, estado = 'em_andamento'
   where id = sala.id;

  return jsonb_build_object('partida', sala.id);
end;
$$;

create or replace function public.desafiar_amigo(p_amigo uuid, p_deck text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid(); meu_ydk text; nova uuid; probs text[];
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  if not exists (select 1 from public.amizades
                  where de = uid and para = p_amigo and estado = 'aceito') then
    raise exception 'voce so pode desafiar quem esta na sua lista de amigos';
  end if;

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  probs := public.problemas_do_ydk(meu_ydk);
  if array_length(probs, 1) > 0 then
    raise exception 'este deck nao pode duelar: %; ajuste-o no Deck Builder',
                    array_to_string(probs[1:5], '; ');
  end if;

  if exists (select 1 from public.partidas
              where (jogador_a = uid or jogador_b = uid)
                and estado in ('aguardando','em_andamento')) then
    raise exception 'voce ja esta numa partida';
  end if;

  -- Desafio anterior ainda aberto para o MESMO amigo vira lixo: cancela.
  update public.partidas set estado = 'abandonada', encerrada_em = now()
   where jogador_a = uid and convidado = p_amigo and estado = 'aguardando';

  insert into public.partidas (jogador_a, deck_a, ydk_a, seed, modo, host, convidado)
  values (uid, p_deck, meu_ydk, (random() * 9223372036854775807)::bigint,
          'ponte', uid, p_amigo)
  returning id into nova;

  return jsonb_build_object('partida', nova);
end;
$$;

create or replace function public.entrar_na_fila(p_deck text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  meu_ydk text; outro record; nova uuid; probs text[];
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  perform pg_advisory_xact_lock(hashtext('duel-academy:pareamento'));

  select ydk into meu_ydk from public.decks_jogador
   where usuario_id = uid and nome = p_deck;
  if meu_ydk is null then raise exception 'deck "%" nao existe', p_deck; end if;

  probs := public.problemas_do_ydk(meu_ydk);
  if array_length(probs, 1) > 0 then
    raise exception 'este deck nao pode duelar: %; ajuste-o no Deck Builder',
                    array_to_string(probs[1:5], '; ');
  end if;

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

  -- Quem estava na fila foi conferido ao ENTRAR nela; se a banlist mudou desde
  -- entao, o deck dele pode ter ficado ilegal no meio da espera. Tirar da fila e
  -- seguir e' melhor que parear uma partida invalida — e melhor que recusar a
  -- MINHA entrada por um problema que nao e' meu.
  if array_length(public.problemas_do_ydk(outro.ydk), 1) > 0 then
    delete from public.fila where usuario_id = outro.usuario_id;
    insert into public.fila (usuario_id, deck) values (uid, p_deck)
      on conflict (usuario_id) do update set deck = excluded.deck, entrou_em = now();
    return jsonb_build_object('pareado', false);
  end if;

  if exists (select 1 from public.partidas
              where (jogador_a = outro.usuario_id or jogador_b = outro.usuario_id)
                and estado in ('aguardando','em_andamento')) then
    delete from public.fila where usuario_id = outro.usuario_id;
    insert into public.fila (usuario_id, deck) values (uid, p_deck)
      on conflict (usuario_id) do update set deck = excluded.deck, entrou_em = now();
    return jsonb_build_object('pareado', false);
  end if;

  insert into public.partidas (jogador_a, jogador_b, deck_a, deck_b, ydk_a, ydk_b, seed)
  values (outro.usuario_id, uid, outro.deck, p_deck, outro.ydk, meu_ydk,
          (random() * 9223372036854775807)::bigint)
  returning id into nova;

  delete from public.fila where usuario_id in (uid, outro.usuario_id);
  return jsonb_build_object('pareado', true, 'partida', nova);
end;
$$;
