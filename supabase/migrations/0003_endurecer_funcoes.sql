-- ============================================================================
-- Duas coisas que o `get_advisors` (o linter de seguranca do proprio Supabase)
-- pegou depois da 0001. Vale rodar esse linter DEPOIS DE TODA migration de DDL.
-- ============================================================================

-- 1. search_path mutavel em `tocar_atualizado_em`.
--
-- Sem `set search_path`, quem chama a funcao escolhe em que schema os nomes
-- dentro dela sao resolvidos — e um objeto plantado num schema que venha antes
-- no caminho passa a ser executado no lugar do esperado. Nas outras tres eu ja'
-- tinha posto; nesta escapou.
alter function public.tocar_atualizado_em() set search_path = public;

-- 2. Funcoes de TRIGGER expostas como RPC.
--
-- O PostgREST publica toda funcao do schema `public`, e o Postgres da' EXECUTE
-- ao role PUBLIC por padrao. Resultado: `criar_perfil` e `travar_admin`
-- apareciam em `/rest/v1/rpc/...` para qualquer visitante. Chamar uma funcao de
-- trigger direto falha ("can only be called as triggers"), entao o risco real e'
-- baixo — mas nao ha' motivo nenhum para elas existirem na superficie da API, e
-- superficie que nao precisa existir e' superficie que nao precisa ser defendida.
revoke all on function public.criar_perfil()        from public, anon, authenticated;
revoke all on function public.travar_admin()        from public, anon, authenticated;
revoke all on function public.tocar_atualizado_em() from public, anon, authenticated;

-- `eh_admin()` CONTINUA executavel, e isso e' proposital.
--
-- As policies chamam ela, e uma policy e' avaliada com os privilegios de QUEM
-- CONSULTA. Sem EXECUTE, a leitura anonima de `conteudo` morreria com
-- "permission denied for function public.eh_admin" — porque a policy de escrita
-- e' `for all`, entao entra na avaliacao do SELECT tambem.
--
-- E ela nao vaza nada: responde apenas se QUEM PERGUNTA e' admin, via auth.uid().
-- Nao aceita parametro, entao nao da' para perguntar sobre outra pessoa.
grant execute on function public.eh_admin() to anon, authenticated;

-- NOTA: o linter tambem aponta `public.rls_auto_enable()`. Essa funcao NAO e'
-- nossa — e' do proprio Supabase (dono `postgres`, `search_path=pg_catalog`), e
-- serve para ligar RLS automaticamente em tabelas novas. Nao mexa nela.
