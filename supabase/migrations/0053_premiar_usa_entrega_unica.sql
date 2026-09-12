-- 0053 — o laço de itens de `premiar_vitoria` passa a chamar `entregar_item_bonus`
--
-- O corpo do laço era um `if` por tipo DENTRO da função que paga a vitória
-- inteira — a função que ninguém quer tocar sem motivo. Com a entrega num lugar
-- só (0052), o **próximo tipo** é uma edição numa função de 40 linhas, e não
-- mais uma reescrita desta.
--
-- Feito por SUBSTITUIÇÃO DE TEXTO sobre a definição viva, e não reescrevendo as
-- ~200 linhas à mão: reescrever tudo para trocar vinte é a chance de mudar
-- outra coisa sem querer. Se o trecho não for encontrado, a migration FALHA em
-- vez de aplicar pela metade — que é o único desfecho aceitável quando o alvo
-- mudou debaixo dela.
do $migra$
declare
  fonte text;
  velho text;
  novo  text;
begin
  select pg_get_functiondef(p.oid) into fonte
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'premiar_vitoria';

  velho := E'      if it.tipo = ''icone'' then\n'
        || E'        if exists (select 1 from public.icones x where x.id = it.id and not x.gratuito)\n'
        || E'           and not exists (select 1 from public.icones_do_jogador j\n'
        || E'                            where j.icone_id = it.id and j.usuario_id = uid) then\n'
        || E'          insert into public.icones_do_jogador (usuario_id, icone_id)\n'
        || E'          values (uid, it.id) on conflict do nothing;\n'
        || E'          itens := itens || (select jsonb_build_object(''tipo'', ''icone'', ''id'', x.id,\n'
        || E'                                                       ''nome'', x.nome, ''imagem'', x.imagem,\n'
        || E'                                                       ''raridade'', x.raridade)\n'
        || E'                               from public.icones x where x.id = it.id);\n'
        || E'        end if;\n'
        || E'      elsif it.tipo = ''estrutural'' then\n'
        || E'        entregue := public.entregar_estrutural(uid, it.id);\n'
        || E'        if entregue is not null then itens := itens || entregue; end if;\n'
        || E'      end if;';

  novo := E'      -- UMA entrega, todos os tipos (0052). Item repetido volta null\n'
       || E'      -- e e pulado em silencio: vitoria nenhuma e negada por causa de\n'
       || E'      -- um premio que a pessoa ja tinha.\n'
       || E'      entregue := public.entregar_item_bonus(uid, it.tipo, it.id);\n'
       || E'      if entregue is not null then itens := itens || entregue; end if;';

  if position(velho in fonte) = 0 then
    raise exception 'nao achei o laco de itens em premiar_vitoria — a funcao mudou; refaca a mao';
  end if;

  execute replace(fonte, velho, novo);
end
$migra$;
