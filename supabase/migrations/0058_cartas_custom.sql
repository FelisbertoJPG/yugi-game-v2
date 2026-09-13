-- ============================================================================
-- 0058 — CARTAS CUSTOMIZADAS do Card Builder (Área de Teste)
--
-- O Card Builder (`web/cardbuilder.html`) monta uma carta nova em três passos:
-- a ARTE, o TIPO (que já traz o esqueleto Lua daquele tipo) e os EFEITOS
-- (adicionar, comprar, reviver, destruir, bônus). O resultado é o `c<id>.lua`
-- que o `ocgcore` roda — o motor não conhece regra nenhuma fora do Lua.
--
-- Nasce no BANCO, e não em `store/` ou no `localStorage`, pela regra da Área
-- de Teste: conteúdo criado ali e salvo só local nunca chega em quem joga.
--
-- **`dados` e `lua` moram lado a lado de propósito, e só um é a fonte.**
-- `dados` é o que o editor edita; `lua` é o DERIVADO, regenerado por
-- `gerarLua(dados)` (web/js/cardbuilder.js) em TODO salvar, na mesma gravação.
-- O motor é C# e não roda JavaScript: quando ele passar a carregar estas cartas,
-- é a coluna `lua` que ele lê. Ninguém escreve `lua` à mão — editar a coluna no
-- SQL Editor faria as duas divergirem, e o próximo salvar do editor desfaria a
-- edição em silêncio.
--
-- **A faixa de id é 950000000–999999999.** Acima de qualquer carta real (o
-- maior do `cards.cdb` é 99.995.595), dentro do uint32 do motor, e separada
-- da faixa 900000000+ do import local do card maker (`customcards.js`), que
-- vive só num navegador e por isso não pode colidir com o que é publicado.
-- ============================================================================

create table if not exists public.cartas_custom (
  id             bigint primary key
                 check (id between 950000000 and 999999999),
  nome           text not null
                 check (length(btrim(nome)) between 1 and 80),
  dados          jsonb not null
                 check (jsonb_typeof(dados) = 'object'),
  lua            text not null
                 check (length(lua) between 1 and 65536),
  -- A arte crua (reduzida a JPEG no navegador), não a carta desenhada: a
  -- moldura sai dos `dados` e pode ser redesenhada. Mesma trava do ícone e do
  -- item — um `data:` que não é imagem vira quadrado vazio, sem erro.
  arte           text
                 check (arte is null or arte ~ '^data:image/'),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid() references auth.users(id) on delete set null
);

alter table public.cartas_custom drop constraint if exists cartas_custom_arte_tamanho;
alter table public.cartas_custom add constraint cartas_custom_arte_tamanho
  check (arte is null or length(arte) <= 256 * 1024);

create or replace function public.cartas_custom_tocar()
returns trigger language plpgsql
-- O mesmo `search_path` fixo de toda função de gatilho do projeto
-- (0003_endurecer_funcoes). No banco entrou como um segundo passo,
-- `cartas_custom_search_path`, porque a 0058 já tinha sido aplicada sem ele.
set search_path = public
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end
$$;

drop trigger if exists cartas_custom_tocar on public.cartas_custom;
create trigger cartas_custom_tocar
  before update on public.cartas_custom
  for each row execute function public.cartas_custom_tocar();

alter table public.cartas_custom enable row level security;

-- Leitura ABERTA: o motor de cada jogador vai precisar do Lua para a carta
-- rodar num duelo, e não há nada secreto numa carta do jogo.
drop policy if exists cartas_custom_leitura on public.cartas_custom;
create policy cartas_custom_leitura on public.cartas_custom
  for select using (true);

-- Escrita só de admin — a mesma `eh_admin()` de `conteudo`, `itens`, `icones`.
drop policy if exists cartas_custom_admin on public.cartas_custom;
create policy cartas_custom_admin on public.cartas_custom for all
  using (public.eh_admin()) with check (public.eh_admin());

grant select on public.cartas_custom to anon, authenticated;
grant insert, update, delete on public.cartas_custom to authenticated;

comment on table public.cartas_custom is
  'Cartas criadas no Card Builder. `dados` e a fonte (o que o editor edita); '
  '`lua` e derivado de `dados` por gerarLua() a cada salvar — nunca editar a mao.';
