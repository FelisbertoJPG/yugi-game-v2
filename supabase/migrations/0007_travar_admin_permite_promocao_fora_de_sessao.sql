-- Exportada de supabase_migrations.schema_migrations (versao 20260810001312).
-- Aplicada no banco em 2026-08-10; arquivo gravado depois. Ver OQ-FALTOU.md item 0.

-- BUG achado ao promover o primeiro admin: o procedimento documentado no
-- supabase/README.md ("rode este UPDATE no SQL Editor") NAO funcionava.
--
-- `travar_admin` recusava porque `eh_admin()` devolve false quando
-- `auth.uid()` e' NULL — que e' exatamente o caso de um UPDATE rodado fora de
-- qualquer sessao (SQL Editor, service_role, MCP). Ou seja: a trava que existe
-- para impedir autopromocao tambem impedia a UNICA forma prevista de criar o
-- primeiro admin. Ninguem nunca seria admin.
--
-- Deixar passar quando `auth.uid()` e' NULL nao abre buraco: quem chega sem
-- sessao ja' esbarra antes na RLS (`perfis_atualizar_proprio` exige
-- `id = auth.uid() or eh_admin()`, e nenhuma linha casa com uid nulo) e no
-- grant (o role `anon` nao tem UPDATE em `perfis`). Quem realmente chega aqui
-- com uid nulo e' o service_role, que ignora RLS de qualquer jeito — a trava
-- nunca foi obstaculo para ele, so' dava a impressao de ser.
create or replace function public.travar_admin()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.admin is distinct from old.admin
     and auth.uid() is not null
     and not public.eh_admin() then
    raise exception 'so um admin pode mudar o campo admin';
  end if;
  return new;
end;
$$;

revoke all on function public.travar_admin() from public, anon, authenticated;
