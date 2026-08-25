-- 0042 — O ADMIN passa sempre, e isto SUBSTITUI uma porta dos fundos.
--
-- A 0041 nasceu com um furo que só apareceu ao provar o caso de desenvolvimento:
-- `versao_alcanca('dev', '0.16.0')` reprova (não há dígito nenhum em "dev"), então
-- com o modo em `bloquear` a máquina de quem ESCREVE o jogo ficava trancada — e
-- ela é, por definição, a versão mais nova que existe.
--
-- A primeira saída foi o cliente mandar a palavra `dev` e o banco aceitá-la. Isso
-- estava errado e foi desfeito: uma palavra combinada é forjável por qualquer um
-- que abra o console, e seria uma isenção permanente na única trava que o jogo
-- tem. **Um cliente não pode ser a fonte da própria isenção.**
--
-- `eh_admin()` o servidor verifica sozinho, e `perfis.admin` não é
-- auto-atribuível (gatilho `travar_admin`, migration 0021). E é a isenção certa
-- pelo motivo certo: admin é quem publica. Trancar do lado de fora justamente
-- quem pode desligar a trava deixaria o jogo sem saída.

create or replace function public.checar_versao(p_game text default '', p_exe text default '')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok',      public.eh_admin()
               or (public.versao_alcanca(p_game, v.game) and public.versao_alcanca(p_exe, v.exe)),
    'modo',    v.modo,
    'game',    v.game,
    'exe',     v.exe,
    'recado',  v.recado,
    'admin',   public.eh_admin(),
    'game_ok', public.eh_admin() or public.versao_alcanca(p_game, v.game),
    'exe_ok',  public.eh_admin() or public.versao_alcanca(p_exe, v.exe)
  )
  from public.versao_minima v where v.id = 1;
$$;

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

  -- A TRAVA vem ANTES de qualquer escrita: barrar depois de ja' ter marcado o
  -- duelo anterior como abandonado cobraria do jogador barrado o preco de uma
  -- partida que ele nem chegou a comecar.
  select * into v from public.versao_minima where id = 1;
  if found and v.modo = 'bloquear' and not public.eh_admin()
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

grant execute on function public.checar_versao(text, text)                   to anon, authenticated;
grant execute on function public.iniciar_duelo(text, text, text, text, text) to authenticated;
