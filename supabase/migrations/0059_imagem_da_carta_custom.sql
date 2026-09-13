-- ============================================================================
-- 0059 — a IMAGEM importada de uma carta do Card Builder
--
-- A carta do builder ganhou três visuais (`dados.visual`):
--
--   • `desenhada` — o layout desenhado pelo próprio builder (o de sempre);
--   • `moldura`   — o admin importa só a MOLDURA, e a arte e o texto são
--                   desenhados por cima, nas proporções da carta oficial;
--   • `completa`  — o admin importa a CARTA INTEIRA, usada como está.
--
-- A imagem importada (a moldura, ou a carta completa) mora AQUI, e não na
-- coluna `arte`: no modo `moldura` as duas existem juntas, e reaproveitar `arte`
-- faria a troca de visual apagar a arte crua que o layout desenhado precisa.
--
-- O teto é maior que o da arte (384 KB contra 256 KB) porque é a carta inteira
-- em pé, e não só a janela quadrada da ilustração. As duas travas são as mesmas
-- da arte, do ícone e do item: um `data:` que não é imagem vira quadrado vazio, e
-- uma foto sem redução viajaria para todo mundo que abrisse o Deck Builder.
--
-- O visual NUNCA muda o Lua: o motor não vê imagem nenhuma.
-- ============================================================================

alter table public.cartas_custom add column if not exists imagem text;

alter table public.cartas_custom drop constraint if exists cartas_custom_imagem_formato;
alter table public.cartas_custom add constraint cartas_custom_imagem_formato
  check (imagem is null or imagem ~ '^data:image/');

alter table public.cartas_custom drop constraint if exists cartas_custom_imagem_tamanho;
alter table public.cartas_custom add constraint cartas_custom_imagem_tamanho
  check (imagem is null or length(imagem) <= 384 * 1024);

comment on column public.cartas_custom.imagem is
  'Imagem importada: a MOLDURA (dados.visual = moldura) ou a CARTA COMPLETA '
  '(dados.visual = completa). A arte crua continua em `arte`.';
