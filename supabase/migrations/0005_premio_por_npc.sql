-- Exportada de supabase_migrations.schema_migrations (versao 20260809194840).
-- Aplicada no banco em 2026-08-09; o arquivo so' foi gravado depois, na
-- retomada da maquina 1. Ver OQ-FALTOU.md item 0.

-- O premio de vitoria varia por adversario: `rewardDp` e a carta `signatureId`
-- do proprio NPC. Isso vinha do cliente (`active.rewardDp`), o que deixava o
-- jogador escolher quanto ganhava. Agora sai de `conteudo->npcs`, que so' admin
-- escreve; o cliente manda apenas QUAL adversario venceu.
--
-- Os 3 NPCs fixos nao estao em `conteudo` (sao array const no codigo), entao
-- eles caem no padrao — que e' o comportamento certo, nao um buraco.
create or replace function public.premiar_vitoria(p_npc text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  w jsonb; npcs jsonb; npc jsonb;
  premio int; assinatura bigint; col jsonb;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select dados into npcs from public.conteudo where chave = 'npcs';
  if npcs is not null then
    if jsonb_typeof(npcs) = 'array' then
      select value into npc from jsonb_array_elements(npcs)
        where value->>'id' = p_npc limit 1;
    else
      npc := npcs -> p_npc;
    end if;
  end if;

  premio := coalesce((npc->>'rewardDp')::int, (public.eco_const()->>'win_reward')::int);
  -- Um premio negativo num registro mal editado nao pode virar punicao.
  premio := greatest(0, premio);
  assinatura := nullif(npc->>'signatureId', '')::bigint;

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);
  if assinatura is not null then
    col := jsonb_set(col, array[assinatura::text],
                     to_jsonb(coalesce((col->>assinatura::text)::int, 0) + 1), true);
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);
  update public.carteiras set dados = w where usuario_id = uid;

  return jsonb_build_object('premio', premio, 'carta', assinatura, 'carteira', w);
end;
$$;

grant execute on function public.premiar_vitoria(text) to authenticated;
