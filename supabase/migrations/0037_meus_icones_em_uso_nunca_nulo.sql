-- `em_uso` voltava NULL, e nao false, para quem ainda nao escolheu icone
-- nenhum: `p.icone_id = i.id` com `icone_id` nulo da' nulo, nao falso.
--
-- Hoje nao quebra nada — a tela faz `i.em_uso ? ... : ...` e nulo e' falsy —,
-- mas e' uma mina esperando: a primeira leitura que use `=== false`, ou que
-- conte `where not em_uso` (que descarta NULL em SQL), some com a linha sem
-- dizer nada. Um booleano que as vezes e' nulo e' um booleano em que nao se
-- pode confiar, e o custo de fecha-lo agora e' um coalesce.
create or replace function public.meus_icones()
returns table(id text, nome text, arquivo text, preco int, raridade text,
              gratuito boolean, na_loja boolean, ordem int,
              tenho boolean, em_uso boolean)
language sql stable security definer
set search_path = public as $$
  select i.id, i.nome, i.arquivo, i.preco, i.raridade,
         i.gratuito, i.na_loja, i.ordem,
         (i.gratuito or j.usuario_id is not null) as tenho,
         coalesce(p.icone_id = i.id, false)       as em_uso
    from public.icones i
    left join public.icones_do_jogador j
           on j.icone_id = i.id and j.usuario_id = auth.uid()
    left join public.perfis p on p.id = auth.uid()
   -- Os que voce tem primeiro, depois a ordem publicada, depois o nome: quem
   -- abre a tela quer escolher entre os seus, nao rolar a loja inteira.
   order by (i.gratuito or j.usuario_id is not null) desc, i.ordem, i.nome;
$$;

revoke all on function public.meus_icones() from public, anon;
grant execute on function public.meus_icones() to authenticated;
