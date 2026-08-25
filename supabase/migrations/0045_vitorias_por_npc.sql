-- 0045 — QUANTAS VEZES venci cada adversario.
--
-- Nao precisam ser consecutivas: e' a contagem TOTAL de vitorias contra aquele
-- NPC, que e' o numero que o jogador reconhece ("ja' ganhei 7 do Weevil"). Um
-- contador de sequencia zeraria numa derrota e apagaria o historico de quem
-- esta' treinando.
--
-- Por que um RPC e nao uma consulta da tela: `duelos` tem RLS por dono, entao um
-- `select` direto funcionaria — mas traria TODAS as linhas de duelo para o
-- navegador contar no laco. Quem tem 300 duelos baixaria 300 registros para
-- desenhar meia duzia de numeros. O `group by` e' do banco.
--
-- Devolve tambem as DERROTAS porque a mesma varredura ja' as tem; pedir de novo
-- seria uma segunda ida de rede pelo mesmo dado.
--
-- E' a base do que vem depois: a garantia de UR a cada N vitorias contra o mesmo
-- adversario. Esta funcao responde "quantas" — quem decidir o premio le daqui, e
-- nao de um contador novo, que seria uma segunda verdade para a mesma coisa.

create or replace function public.vitorias_por_npc()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    jsonb_object_agg(npc, jsonb_build_object('vitorias', v, 'derrotas', d)),
    '{}'::jsonb)
  from (
    select d.npc,
           count(*) filter (where d.resultado = 'vitoria') as v,
           count(*) filter (where d.resultado = 'derrota') as d
      from public.duelos d
     where d.usuario_id = auth.uid()
       and coalesce(d.npc, '') <> ''
     group by d.npc
  ) t;
$$;

grant execute on function public.vitorias_por_npc() to authenticated;
