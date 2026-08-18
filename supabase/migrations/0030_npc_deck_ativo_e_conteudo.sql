-- ============================================================================
-- QUAL DECK O ADVERSARIO JOGA E' CONTEUDO, NAO PREFERENCIA DO NAVEGADOR
--
-- A lista de decks de cada NPC ja' vinha do banco (`decks_npc`, leitura aberta),
-- mas QUAL deles estava ativo morava no `localStorage` de quem escolheu. O
-- resultado: duas pessoas com o MESMO jogo, lendo a MESMA lista, viam
-- adversarios diferentes — quem nunca escolheu caia no primeiro da ordem
-- alfabetica. Relato que originou isto: "na maquina do meu amigo o Para & Dox
-- esta' com o deck de labirinto em vez do Gate Guardian".
--
-- A escolha passa a ser publicada em `conteudo/npc-deck-ativo`, no formato
-- `{ "<id do npc>": <indice> }` — mesmo molde do `npc-base-meta`. So' admin
-- publica (a RLS de `conteudo` ja' cuida disso); o localStorage continua como
-- cache e como fallback offline.
-- ============================================================================

alter table public.conteudo drop constraint if exists conteudo_chave_check;

alter table public.conteudo add constraint conteudo_chave_check
  check (
    chave = any (array['banlist', 'boosters', 'npcs', 'npc-base-meta',
                       'cardlists', 'npc-drops', 'npc-deck-ativo'])
    or chave ~ '^lista[a-z0-9-]{0,31}$'
  );

comment on table public.conteudo is
  'store/*.json — banlist, boosters, npcs, npc-base-meta, cardlists, npc-drops, '
  'npc-deck-ativo e as listas de cartas (lista*). Um documento por linha.';
