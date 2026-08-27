-- ============================================================================
-- "VISTO POR ULTIMO" na lista de amigos da home.
--
-- A lateral ja' dizia ONLINE/OFFLINE, e OFFLINE e' a resposta para quase todo
-- mundo quase o tempo todo — sem dizer se a pessoa saiu ha' cinco minutos ou
-- ha' tres semanas. Chamar para duelar, mandar mensagem ou remover um amigo
-- sao decisoes diferentes conforme essa resposta.
--
-- O carimbo JA' EXISTE (`perfis.visto_em`, migration 0034): o batimento de
-- presenca o escreve a cada 45s. O que faltava era um caminho para ele sair.
--
-- E precisa ser ESTE caminho. A policy de `perfis` e' `id = auth.uid() or
-- eh_admin()`, entao o navegador nao consegue ler o `visto_em` de ninguem —
-- nem do proprio amigo. Calcular no cliente tambem nao serve: `online` sai
-- daqui justamente para que dois relogios diferentes nao discordem sobre quem
-- esta' online (ver o cabecalho da 0034), e um "visto ha' 3 dias" calculado
-- contra o relogio da maquina teria o mesmo defeito, com o erro crescendo em
-- vez de expirar.
--
-- O QUE ISTO ALARGA, de proposito: ate' aqui a presenca de um amigo saia so'
-- como um BOOLEANO. Agora sai o instante. Continua valendo so' para quem e'
-- AMIGO (a funcao junta por `amizades`), e continua sem alcancar estranho
-- nenhum — `buscar_jogador` nao devolve isto e a policy de `perfis` segue
-- fechada.
--
-- Coluna nova nao quebra quem ja' le' esta funcao: as duas telas que a
-- consomem (home e Multiplayer) leem os campos pelo NOME.
-- ============================================================================

-- Mudar as colunas de um `returns table` nao e' um "create or replace": tem de
-- dropar antes.
drop function if exists public.meus_amigos();

create function public.meus_amigos()
returns table(id uuid, usuario text, etiqueta int, direcao text,
              desde timestamptz, online boolean, icone_id text,
              visto_em timestamptz)
language sql stable security definer
set search_path = public as $$
  select p.id, p.usuario, p.etiqueta,
         case when a.estado = 'aceito' then 'amigo'
              when a.de = auth.uid()   then 'enviado'
              else 'recebido' end as direcao,
         a.atualizado_em,
         (p.visto_em > now() - public.janela_online()) as online,
         p.icone_id,
         p.visto_em
    from public.amizades a
    join public.perfis p
      on p.id = case when a.de = auth.uid() then a.para else a.de end
   where (a.de = auth.uid() or a.para = auth.uid())
     and a.estado in ('aceito', 'pendente')
     -- Amizade aceita tem DUAS linhas (ida e volta); sem isto o amigo apareceria
     -- duas vezes na lista.
     and (a.estado <> 'aceito' or a.de = auth.uid())
   -- Pedido recebido primeiro (tem prazo), depois quem esta' ONLINE, depois o
   -- nome. A ordem e' do banco porque as duas telas que leem isto — a home e o
   -- Multiplayer — precisam concordar sobre quem aparece no topo.
   order by (a.estado = 'pendente' and a.para = auth.uid()) desc,
            (p.visto_em > now() - public.janela_online()) desc,
            p.usuario;
$$;

comment on function public.meus_amigos() is
  'Amigos e pedidos, com presenca (online + visto_em) e icone de cada um.';

revoke all on function public.meus_amigos() from public, anon;
grant execute on function public.meus_amigos() to authenticated;
