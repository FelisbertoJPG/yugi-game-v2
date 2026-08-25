-- 0041 — A VERSÃO MÍNIMA: ninguém joga com um cliente velho.
--
-- O PROBLEMA QUE ISTO RESOLVE, e por que ele não se resolve publicando nada:
-- quem decide baixar uma atualização é o CLIENTE. Um exe cujo updater quebrou
-- não vai consertar o próprio updater — ele recebe o manifesto, tenta, falha, e
-- na abertura seguinte tenta de novo, para sempre. Em 23/08/2026 dois jogadores
-- estavam nesse estado: um deles ainda via na tela o botão "voltar para a versão
-- anterior", que foi REMOVIDO naquele mesmo dia. Ou seja: nem o front chegava.
--
-- Publicar mais depressa não alcança essas máquinas. O único lugar que alcança
-- TODA versão do jogo — a de hoje e a de duas semanas atrás — é este banco, e é
-- por isso que a trava mora aqui e não no cliente. É a mesma regra que o resto do
-- projeto já segue: *cópia local nunca vence a nuvem*.
--
-- O QUE ELA NÃO CONSEGUE FAZER, e é importante dizer: ela não conserta o cliente
-- quebrado. Ela o impede de jogar e diz o que fazer (reinstalar). Para quem já
-- está travado, o desfecho prático é o mesmo de antes — não joga —, com a
-- diferença de que agora ele sabe por quê, em vez de olhar uma barra de progresso
-- que nunca anda.

create table if not exists public.versao_minima (
  -- Linha única. O `check` é o que impede uma segunda linha de aparecer e as
  -- duas discordarem — com duas, qual delas vale passa a ser sorte de `limit 1`,
  -- e o erro que isso produz (metade dos jogadores barrada) é indistinguível de
  -- um cliente velho de verdade.
  id            int primary key default 1 check (id = 1),

  -- O `gameVersion` do manifesto (`classic-duels-YYYYMMDD-HHMM`). Vazio = sem
  -- piso para o conteúdo.
  game          text not null default '',

  -- O `BuildConfig.InstallerVersion` do executável (`0.16.0`). Este é o que
  -- importa de verdade para o caso travado: um exe abaixo de 0.15.0 não aplica o
  -- pacote `engine` de jeito nenhum, então nenhuma publicação o alcança.
  exe           text not null default '0.0.0',

  -- 'avisar' = deixa jogar e o cliente mostra o aviso; 'bloquear' = não joga.
  --
  -- NASCE EM 'avisar', e isso não é timidez: no instante em que esta migration
  -- roda, TODO cliente no mundo é velho em relação ao piso — inclusive o de quem
  -- publicou. Subir já bloqueando trancaria todo mundo para fora, e o primeiro a
  -- descobrir seria o dono do jogo, sem conseguir entrar para desligar. Vira
  -- 'bloquear' com um update de uma linha, depois de conferir que o próprio
  -- cliente passa.
  modo          text not null default 'avisar' check (modo in ('avisar','bloquear')),

  -- O que o jogador barrado lê. Fica no BANCO e não no cliente de propósito: a
  -- instrução de "onde baixo o instalador" muda, e trocá-la não pode exigir
  -- publicar uma versão nova — justamente para quem não consegue receber uma.
  recado        text not null default 'Seu Classic Duels esta desatualizado. Feche o jogo e abra de novo para atualizar; se ele nao terminar, peca o instalador novo.',

  atualizado_em timestamptz not null default now()
);

insert into public.versao_minima (id) values (1) on conflict (id) do nothing;

alter table public.versao_minima enable row level security;

-- LER é aberto, e precisa ser: quem pergunta "eu sou velho?" é justamente o
-- cliente que talvez nem tenha sessão ainda. Esconder o piso de quem está
-- barrado deixaria a tela sem o que dizer.
drop policy if exists versao_minima_leitura on public.versao_minima;
create policy versao_minima_leitura on public.versao_minima
  for select using (true);

-- ESCREVER é só admin, como todo o resto do conteúdo do jogo.
drop policy if exists versao_minima_escrita on public.versao_minima;
create policy versao_minima_escrita on public.versao_minima
  for update using (public.eh_admin()) with check (public.eh_admin());

-- ------------------------------------------------------------ comparação

-- Compara duas versões deste projeto. Elas vêm em DOIS formatos e o mesmo
-- comparador atende os dois, porque os dois são "números separados por pontuação,
-- da esquerda para a direita":
--
--   exe   0.16.0                      → [0, 16, 0]
--   game  classic-duels-20260823-2308 → [20260823, 2308]
--
-- O texto não-numérico é descartado, e é isso que faz o prefixo `classic-duels-`
-- não atrapalhar. Comparar as strings direto seria um erro calado e clássico:
-- '0.9.0' > '0.16.0' em ordem alfabética, e o piso passaria a barrar justamente
-- quem está em dia.
create or replace function public.versao_partes(v text)
returns int[]
language sql
immutable
as $$
  select coalesce(
    array(select (m[1])::int from regexp_matches(coalesce(v, ''), '(\d+)', 'g') as m),
    array[]::int[]
  );
$$;

-- `a` alcança o piso `b`?
--
-- Piso VAZIO libera — "não configurei piso" tem de significar "não barro
-- ninguém", nunca "barro todo mundo". Um piso perdido por engano não pode
-- trancar o jogo inteiro.
--
-- Versão do CLIENTE vazia NÃO libera: é o cliente velho, que não sabe mandar a
-- versão porque foi compilado antes desta trava existir. Tratar "não sei" como
-- "está em dia" seria abrir a porta exatamente para quem ela existe para barrar
-- — o mesmo raciocínio do `alcancou` do `pullFileEx`.
create or replace function public.versao_alcanca(a text, b text)
returns boolean
language plpgsql
immutable
as $$
declare
  pa int[]; pb int[]; i int; n int;
begin
  if coalesce(btrim(b), '') = '' then return true; end if;         -- sem piso
  if coalesce(btrim(a), '') = '' then return false; end if;        -- cliente que nao sabe dizer

  pa := public.versao_partes(a);
  pb := public.versao_partes(b);
  if array_length(pb, 1) is null then return true; end if;
  if array_length(pa, 1) is null then return false; end if;

  n := greatest(array_length(pa, 1), array_length(pb, 1));
  for i in 1..n loop
    -- Faltando um pedaço, ele vale zero: '0.16' alcança '0.16.0'.
    if coalesce(pa[i], 0) > coalesce(pb[i], 0) then return true;  end if;
    if coalesce(pa[i], 0) < coalesce(pb[i], 0) then return false; end if;
  end loop;
  return true;                                                     -- iguais
end;
$$;

-- ------------------------------------------------------------ a pergunta

-- O que o cliente chama no boot: "este é o piso; eu passo?".
--
-- Devolve o veredito PRONTO em vez dos números crus. Quem decide se um cliente
-- está velho é o servidor, não o cliente: deixar a conta para o navegador seria
-- deixá-la para o lado que a trava existe para barrar, e bastaria abrir o
-- console. E o recado vem junto, para a tela não ter texto próprio que envelhece.
create or replace function public.checar_versao(p_game text default '', p_exe text default '')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok',      public.versao_alcanca(p_game, v.game) and public.versao_alcanca(p_exe, v.exe),
    'modo',    v.modo,
    'game',    v.game,
    'exe',     v.exe,
    'recado',  v.recado,
    -- Qual das duas metades reprovou. A tela nao usa, o SUPORTE usa: "o front
    -- esta' em dia e o exe nao" e' exatamente o caso do congelamento de
    -- 19/08/2026, e ele pede reinstalar em vez de esperar.
    'game_ok', public.versao_alcanca(p_game, v.game),
    'exe_ok',  public.versao_alcanca(p_exe, v.exe)
  )
  from public.versao_minima v where v.id = 1;
$$;

grant execute on function public.versao_partes(text)          to anon, authenticated;
grant execute on function public.versao_alcanca(text, text)   to anon, authenticated;
grant execute on function public.checar_versao(text, text)    to anon, authenticated;

-- ------------------------------------------------------------ a trava
--
-- E aqui ela morde. `iniciar_duelo` e' o chokepoint certo: e' literalmente "vou
-- jogar", e e' o que o pedido dizia — *ou ficam na versao atual, ou nao jogam*.
--
-- O DROP nao e' descuido. Acrescentar parametros NAO substitui a funcao: cria
-- uma SOBRECARGA, e o PostgREST escolhe a candidata pelas chaves do corpo JSON.
-- Com as duas no ar, a chamada antiga (tres chaves) casa com as duas e o
-- servidor responde "could not choose the best candidate function" — todo mundo
-- para de duelar, inclusive quem esta' em dia. Uma funcao so'.
drop function if exists public.iniciar_duelo(text, text, text);

-- Os parametros novos tem DEFAULT, e e' isso que faz a trava alcancar o cliente
-- velho sem quebrar a chamada dele: ele continua mandando as tres chaves de
-- sempre, as duas novas chegam vazias, e vazio NAO alcanca piso nenhum
-- (`versao_alcanca` acima). Em 'bloquear', ele para aqui.
create or replace function public.iniciar_duelo(
  p_npc      text,
  p_deck     text default null,
  p_deck_npc text default null,
  p_game     text default '',
  p_exe      text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  novo uuid;
  abertos int;
  v public.versao_minima%rowtype;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  -- A TRAVA vem ANTES de qualquer escrita. Barrar depois de ja' ter marcado o
  -- duelo anterior como abandonado cobraria do jogador barrado o preco de uma
  -- partida que ele nem chegou a comecar.
  select * into v from public.versao_minima where id = 1;
  if found and v.modo = 'bloquear'
     and not (public.versao_alcanca(p_game, v.game) and public.versao_alcanca(p_exe, v.exe)) then
    raise exception '%', v.recado;
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

grant execute on function public.iniciar_duelo(text, text, text, text, text) to authenticated;
