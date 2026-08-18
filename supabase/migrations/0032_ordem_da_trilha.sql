-- ============================================================================
-- A ORDEM DA TRILHA E' CONTEUDO PUBLICADO
--
-- A Trilha de Duelos ordenava os adversarios pela ordem de CRIACAO, que ninguem
-- controla depois. A ordem passa a ser definida pelo admin (Area de Teste ->
-- "Ordenar Trilha") e publicada em `conteudo/npc-trilha`:
--
--     { "Reino dos Duelistas": ["wevil", "rex_raptor", "mako"] }
--
-- Por CAMPANHA e por ID. Nao por indice: indice muda de significado quando um
-- adversario novo entra, e trocaria a trilha de todo mundo sem ninguem mexer em
-- nada — foi exatamente o que aconteceu com o deck ativo (migration 0030).
--
-- Adversario que nao estiver na lista continua aparecendo, no fim, na ordem de
-- criacao: sumir da trilha por falta de configuracao seria pior que ficar fora
-- de ordem.
-- ============================================================================

alter table public.conteudo drop constraint if exists conteudo_chave_check;

alter table public.conteudo add constraint conteudo_chave_check
  check (
    chave = any (array['banlist', 'boosters', 'npcs', 'npc-base-meta',
                       'cardlists', 'npc-drops', 'npc-deck-ativo', 'npc-trilha'])
    or chave ~ '^lista[a-z0-9-]{0,31}$'
  );

comment on table public.conteudo is
  'store/*.json — banlist, boosters, npcs, npc-base-meta, cardlists, npc-drops, npc-deck-ativo, npc-trilha e as listas de cartas (lista*). Um documento por linha.';
