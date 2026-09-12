-- ============================================================================
-- 0057 — as CENAS do Editor de Cena entram em `conteudo`
--
-- `conteudo_chave_check` e' uma lista branca de chaves, e `cena-*` nao estava
-- nela. O Editor de Cena publica por `pushFile('cena-<nome>')` como todo o
-- resto do conteudo -- e o banco recusava TODA gravacao dele desde o primeiro
-- dia, com um 400 de violacao de constraint.
--
-- O sintoma nao foi um erro: foi a faixa de pendencias grudada na tela
-- ("1 alteracao ainda nao publicada (cena-nova)"). Ela dizia a verdade. A fila
-- de `pendencias.js` so' larga a chave quando o banco ACEITA, e o banco nunca ia
-- aceitar -- entao o reenvio automatico batia na mesma parede a cada 20 s, para
-- sempre. O espelho em disco (`store/cena-*.json`) gravava, o que fez a cena
-- parecer salva na maquina de quem editou e nao existir para mais ninguem.
--
-- A lista branca continua sendo a decisao certa (ela e' o que impede uma chave
-- inventada de virar linha nova em `conteudo`); o que faltava era esta entrada.
--
-- O formato bate com `ehNomeDeCena` em `web/js/cena.js` -- slug de ate' 31
-- caracteres, porque ele tambem vira nome de arquivo em `store/`:
--
--     ehNomeDeCena  =  /^[a-z0-9][a-z0-9-]{0,30}$/
--     chaveDaCena   =  'cena-' + nome
--
-- Divergir os dois faria a tela aceitar um nome que o banco recusa, e o
-- resultado seria exatamente a faixa presa de novo -- so' que para um nome
-- estranho, o que e' pior de diagnosticar. `conferir-conteudo.mjs` guarda o par.
-- ============================================================================

alter table public.conteudo drop constraint if exists conteudo_chave_check;

alter table public.conteudo add constraint conteudo_chave_check
  check (
    chave = any (array['banlist', 'boosters', 'npcs', 'npc-base-meta',
                       'cardlists', 'npc-drops', 'npc-deck-ativo', 'npc-trilha'])
    or chave ~ '^lista[a-z0-9-]{0,31}$'
    or chave ~ '^cena-[a-z0-9][a-z0-9-]{0,30}$'
  );

comment on table public.conteudo is
  'store/*.json — banlist, boosters, npcs, npc-base-meta, cardlists, npc-drops, npc-deck-ativo, npc-trilha, as listas de cartas (lista*) e as cenas do Editor de Cena (cena-*). Um documento por linha.';
