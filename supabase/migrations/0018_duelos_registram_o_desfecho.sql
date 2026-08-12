-- ============================================================================
-- O RESULTADO do duelo passa a viver no banco.
--
-- Ate' aqui `duelos` sabia duas coisas: que comecou (`iniciado_em`) e que pagou
-- (`premiado_em`). Perder e empatar nao deixavam rastro nenhum — os 5 duelos que
-- existiam quando isto foi escrito estavam TODOS "sem desfecho", e nao havia
-- como saber se foram derrotas, empates ou abas fechadas no meio.
--
-- O QUE ISTO NAO RESOLVE, e' bom deixar escrito: continua sem PROVA de vitoria.
-- O duelo roda no ocgcore da maquina do jogador e o servidor nao o ve'. Quem diz
-- "venci" e' o cliente. So' a arena (motor no servidor) resolve isso, e e' outro
-- projeto.
--
-- O QUE ISTO RESOLVE:
--   1. historico de verdade — vitorias, derrotas, empates e abandonos, que e' a
--      base de estatistica e de qualquer ranking futuro;
--   2. AUDITORIA: um jogador que so' tem vitorias, todas com 31 segundos, fica
--      visivel numa consulta. Antes nao havia o que consultar;
--   3. quando a arena existir, ela grava na MESMA coluna — sem migracao nova.
--
-- E fecha uma brecha real: dava para abrir 60 duelos e premiar os 60 em
-- sequencia. Agora comecar um duelo ABANDONA o anterior, que e' o que acontece
-- de fato — ninguem joga dois ao mesmo tempo.
-- ============================================================================

alter table public.duelos
  add column if not exists resultado text
    check (resultado in ('vitoria', 'derrota', 'empate', 'abandonado')),
  add column if not exists encerrado_em timestamptz,
  add column if not exists deck text;

comment on column public.duelos.resultado is
  'Desfecho informado pelo cliente. NAO e prova — o motor roda na maquina dele.';

create index if not exists duelos_por_resultado
  on public.duelos (usuario_id, resultado, iniciado_em desc);

/**
 * Registra o desfecho. Se for vitoria, paga junto — assim o fim do duelo e' UMA
 * chamada, e nao ha' como registrar a vitoria sem cobrar o premio nem o
 * contrario.
 *
 * Idempotente: um duelo ja' encerrado devolve o que ficou gravado. Sem isso, um
 * duplo-clique no botao de fim contaria duas vitorias.
 */
create or replace function public.encerrar_duelo(p_duelo uuid, p_resultado text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); d record; premio jsonb;
begin
  if uid is null then raise exception 'nao autenticado'; end if;
  if p_resultado not in ('vitoria','derrota','empate','abandonado') then
    raise exception 'resultado invalido: %', p_resultado;
  end if;

  select * into d from public.duelos where id = p_duelo and usuario_id = uid for update;
  if d is null then raise exception 'duelo nao encontrado'; end if;

  if d.resultado is not null then
    return jsonb_build_object('ok', true, 'ja_estava', true, 'resultado', d.resultado);
  end if;

  update public.duelos
     set resultado = p_resultado, encerrado_em = now()
   where id = p_duelo;

  -- A vitoria paga pelo caminho de sempre, com todas as travas dele (uma vez por
  -- duelo, minimo de 30s, premio vindo de `conteudo->npcs`).
  if p_resultado = 'vitoria' then
    begin
      premio := public.premiar_vitoria(p_duelo);
    exception when others then
      -- O desfecho fica registrado mesmo que o premio seja recusado (duelo curto
      -- demais, por exemplo). Perder o dado permanente por causa do efeito
      -- colateral seria a troca errada.
      return jsonb_build_object('ok', true, 'resultado', p_resultado,
                                'premio_recusado', SQLERRM);
    end;
  end if;

  return jsonb_build_object('ok', true, 'resultado', p_resultado, 'premio', premio);
end;
$$;

/**
 * Abrir um duelo novo ABANDONA o anterior que ficou em aberto.
 *
 * Antes dava para abrir 60 e premiar os 60 em sequencia. Agora existe no maximo
 * um duelo vivo por jogador — que e' a realidade: ninguem joga dois ao mesmo
 * tempo. E nao tranca ninguem, ao contrario da trava das partidas online: o
 * duelo velho e' fechado sozinho, nao vira obstaculo.
 *
 * ATENCAO: `create or replace` NAO substitui quando a lista de parametros muda —
 * cria uma SOBRECARGA. A `iniciar_duelo(text)` antiga continuou existindo e o
 * PostgREST, escolhendo pela forma da chamada, mandava o cliente ja' publicado
 * (que passa so' `p_npc`) para a versao velha. A correcao valeria para ninguem.
 * Por isso o `drop` explicito abaixo. Trocar assinatura e' DROP + CREATE.
 */
drop function if exists public.iniciar_duelo(text);

create or replace function public.iniciar_duelo(p_npc text, p_deck text default null)
returns uuid language plpgsql security definer
set search_path = public as $$
declare uid uuid := auth.uid(); novo uuid; abertos int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  update public.duelos
     set resultado = 'abandonado', encerrado_em = now()
   where usuario_id = uid and resultado is null;

  -- O teto por hora continua: e' o que impede o laco de abrir-e-premiar, agora
  -- que cada volta custa um abandono registrado.
  select count(*) into abertos from public.duelos
   where usuario_id = uid and iniciado_em > now() - interval '1 hour';
  if abertos >= 60 then raise exception 'muitos duelos iniciados nesta hora'; end if;

  insert into public.duelos (usuario_id, npc, deck) values (uid, p_npc, p_deck)
  returning id into novo;
  return novo;
end;
$$;

revoke all on function public.encerrar_duelo(uuid, text)  from public, anon;
revoke all on function public.iniciar_duelo(text, text)   from public, anon;
grant execute on function public.encerrar_duelo(uuid, text) to authenticated;
grant execute on function public.iniciar_duelo(text, text)  to authenticated;

-- Os duelos antigos nao tem como saber o desfecho: ficam 'abandonado', que e'
-- honesto — comecaram e nao se sabe o fim.
update public.duelos set resultado = 'abandonado', encerrado_em = iniciado_em
 where resultado is null and premiado_em is null;

-- Conferido com uma conta de teste:
--   cliente ANTIGO (so p_npc) continua funcionando (o default cobre);
--   derrota registra ("resultado": "derrota") — antes nao deixava rastro;
--   encerrar de novo devolve "ja_estava", sem contar duas vezes;
--   resultado invalido e' recusado;
--   abrir 3 duelos deixa os 2 primeiros 'abandonado' sozinhos;
--   premio recusado (menos de 30s) NAO apaga o resultado.
--
-- A consulta de auditoria que antes nao existia:
--   select p.usuario, count(*) filter (where d.resultado='vitoria') as vitorias,
--          count(*) filter (where d.resultado='derrota') as derrotas,
--          avg(extract(epoch from (d.encerrado_em - d.iniciado_em))) as seg_medio
--     from public.duelos d join public.perfis p on p.id = d.usuario_id
--    group by p.usuario;
