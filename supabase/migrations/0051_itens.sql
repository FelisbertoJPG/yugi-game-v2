-- 0051 — ITENS (sleeve, playmat, deckbox, e o genérico)
--
-- O ÍCONE de perfil (0035/0036/0039) foi o primeiro cosmético do jogo, e por
-- isso ganhou tabela com nome próprio. Ele continua onde está: quem escolhe um
-- ícone é `escolher_icone`, quem valida a posse é o gatilho `perfis_icone_valido`
-- e a coluna `perfis.icone_id` — mexer nisso para "generalizar" seria trocar um
-- caminho que funciona por um que ainda não existe.
--
-- Esta tabela é para os OUTROS: sleeve, playmat, deckbox, e o "item genérico"
-- que existe justamente para não precisar de migration na próxima ideia. Eles
-- ainda não são USADOS em lugar nenhum do jogo — hoje eles existem para serem
-- cadastrados, postos na Loja e dados como bônus (migration 0050). O que cada
-- tipo faz na tela de quem joga é a próxima decisão, não esta.
--
-- **`tipo` é uma coluna livre com CHECK, e não um enum**: acrescentar um tipo
-- num enum do Postgres é `alter type`, que não roda dentro de transação com
-- outras coisas e vira uma migration só para isso. Com o CHECK é um `alter
-- table ... drop constraint / add constraint` normal — e enquanto o conjunto é
-- pequeno e editorial, o CHECK ainda protege contra o texto digitado errado.

create table if not exists public.itens (
  id         text primary key
             check (id ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  tipo       text not null default 'generico'
             check (tipo in ('generico', 'sleeve', 'playmat', 'deckbox')),
  nome       text not null,
  preco      int  not null default 0 check (preco >= 0),
  na_loja    boolean not null default false,
  ordem      int  not null default 0,
  -- A imagem mora AQUI, como a do ícone desde a 0039, e pelo mesmo motivo: a
  -- rota que grava arquivo só existe no `tools/serve.mjs`, então para quem roda
  -- o .exe subir uma imagem viraria "mova o arquivo à mão e publique um
  -- Release". As duas travas são as mesmas — e as duas erram calado sem elas.
  imagem     text
             check (imagem is null or imagem ~ '^data:image/'),
  criado_em  timestamptz not null default now()
);

-- Um engano (a foto de 12 MB sem redimensionar) viajaria para todo jogador que
-- abrisse a lista, para sempre. O teto do ícone é 256 KB; aqui é o dobro,
-- porque uma sleeve/playmat não é um círculo de 128px — é uma imagem que se
-- olha inteira.
alter table public.itens drop constraint if exists itens_imagem_tamanho;
alter table public.itens add constraint itens_imagem_tamanho
  check (imagem is null or length(imagem) <= 512 * 1024);

alter table public.itens enable row level security;

-- Leitura ABERTA, como o catálogo de ícones: a vitrine e a tela de bônus
-- precisam dela, e não há nada secreto num cosmético à venda.
drop policy if exists itens_leitura on public.itens;
create policy itens_leitura on public.itens for select using (true);

-- Escrita só de admin — a mesma `eh_admin()` de `conteudo`, `decks_npc`,
-- `tabuleiros` e `icones`. A tela é a porta; a fechadura é esta.
drop policy if exists itens_admin on public.itens;
create policy itens_admin on public.itens for all
  using (public.eh_admin()) with check (public.eh_admin());

grant select on public.itens to anon, authenticated;
grant insert, update, delete on public.itens to authenticated;

comment on table public.itens is
  'Cosmeticos que NAO sao icone de perfil (sleeve, playmat, deckbox, generico). '
  'O icone tem tabela propria desde a 0035 porque ele ja e usado por '
  'perfis.icone_id e escolher_icone().';
