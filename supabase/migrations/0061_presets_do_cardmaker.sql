-- ============================================================================
-- 0061 — PRESETS do Card Maker (a carta-modelo que abre pronta)
--
-- O Card Maker (`web/cardmaker.html`) embute o ygocarder num iframe, e o
-- ygocarder guarda as imagens que se sobe do computador DENTRO da carta, como
-- data URL. Uma full art com fundo e degradê na borda passa de 2 MB — e isso
-- quebra os dois jeitos de reabri-la:
--
--   * a "última carta" que ele guarda no navegador tem uma reserva no
--     localStorage, e quando ela estoura a cota ele grava a carta SEM as
--     imagens (`saveCardLocally`, use-card.ts). Reaberta, a carta vem sem a
--     arte, sem o fundo e sem o degradê — o relato foi "ele abre sem a edição";
--   * a carta pode chegar pela URL (`?data=`), mas URL não leva 2 MB.
--
-- Com as imagens viradas LINK, as duas voltam a funcionar: o modelo cabe na
-- URL (poucos KB) e o iframe abre direto com ele. Daí as duas peças:
--
--   1. a chave `cardmaker-presets` em `conteudo` — a lista de modelos, no mesmo
--      esquema de todo conteúdo (todo mundo lê, só admin escreve);
--   2. o bucket PÚBLICO `cardmaker`, onde a tela sobe as imagens que estavam
--      embutidas. Público porque quem as busca é o ygocarder, de outro domínio
--      e sem sessão nenhuma; o Storage responde com CORS aberto, então o canvas
--      dele não fica "contaminado" e o Download do PNG continua funcionando.
--
-- O nome do arquivo é o SHA-256 do conteúdo (`cardmakerpresets.js`): a mesma
-- imagem salva duas vezes é o mesmo objeto, e um upload repetido volta como
-- "já existe" — que a tela trata como sucesso. Por isso não há policy de
-- UPDATE para o caminho comum; ela existe para o admin poder substituir na mão.
--
-- Escrever é só admin (`eh_admin()`), como em `conteudo`. LER não precisa de
-- policy: bucket público serve `/object/public/...` sem RLS. A policy de SELECT
-- abaixo é só para admin, de propósito — uma aberta deixaria qualquer um LISTAR
-- o bucket pela API.
-- ============================================================================

-- 1. A chave nova na lista branca de `conteudo` (a lista continua sendo a
--    decisão certa: ver o cabeçalho da 0057).
alter table public.conteudo drop constraint if exists conteudo_chave_check;

alter table public.conteudo add constraint conteudo_chave_check
  check (
    chave = any (array['banlist', 'boosters', 'npcs', 'npc-base-meta',
                       'cardlists', 'npc-drops', 'npc-deck-ativo', 'npc-trilha',
                       'cardmaker-presets'])
    or chave ~ '^lista[a-z0-9-]{0,31}$'
    or chave ~ '^cena-[a-z0-9][a-z0-9-]{0,30}$'
  );

comment on table public.conteudo is
  'store/*.json — banlist, boosters, npcs, npc-base-meta, cardlists, npc-drops, npc-deck-ativo, npc-trilha, os presets do Card Maker (cardmaker-presets), as listas de cartas (lista*) e as cenas do Editor de Cena (cena-*). Um documento por linha.';

-- 2. O bucket das imagens dos presets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cardmaker', 'cardmaker', true, 8388608,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. Quem escreve: só admin.
drop policy if exists cardmaker_admin_le on storage.objects;
create policy cardmaker_admin_le on storage.objects
  for select to authenticated
  using (bucket_id = 'cardmaker' and public.eh_admin());

drop policy if exists cardmaker_admin_insere on storage.objects;
create policy cardmaker_admin_insere on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cardmaker' and public.eh_admin());

drop policy if exists cardmaker_admin_atualiza on storage.objects;
create policy cardmaker_admin_atualiza on storage.objects
  for update to authenticated
  using (bucket_id = 'cardmaker' and public.eh_admin())
  with check (bucket_id = 'cardmaker' and public.eh_admin());

drop policy if exists cardmaker_admin_apaga on storage.objects;
create policy cardmaker_admin_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'cardmaker' and public.eh_admin());
