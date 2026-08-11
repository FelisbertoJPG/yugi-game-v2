-- ============================================================================
-- DECK ESTRUTURAL — deck pronto, comprado na Loja, que ja' nasce montado.
--
-- Diferenca para o booster: o booster da' CARTAS soltas e o jogador monta; o
-- estrutural entra direto em `decks_jogador`, pronto para escolher no PvP/PvE.
--
-- Criado no painel de teste e gravado AQUI, nao em store/*.json: e' a regra que
-- vale para toda ferramenta nova da Area de Teste — o admin publica, todo mundo
-- recebe no proximo boot, sem Release.
-- ============================================================================

create table if not exists public.decks_estruturais (
  id              text primary key check (char_length(id) between 1 and 64),
  nome            text not null check (char_length(nome) between 1 and 128),
  preco           int  not null default 300 check (preco >= 0),
  capa            bigint,                    -- id da carta usada como arte
  ydk             text not null,
  na_loja         boolean not null default true,
  ordem           int not null default 0,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null
);

comment on table public.decks_estruturais is
  'Decks prontos a venda na Loja. Comprar entrega o deck montado em decks_jogador.';

create trigger decks_estruturais_atualizado_em
  before update on public.decks_estruturais
  for each row execute function public.tocar_atualizado_em();

alter table public.decks_estruturais enable row level security;
revoke all on public.decks_estruturais from anon, authenticated;
grant select on public.decks_estruturais to anon, authenticated;
grant insert, update, delete on public.decks_estruturais to authenticated;

-- Conteudo do jogo: todo mundo le' (a Loja mostra antes do login), so' admin
-- escreve. Mesmo par de policies de `conteudo`/`decks_npc`.
create policy decks_estruturais_ler_todos on public.decks_estruturais
  for select using (true);
create policy decks_estruturais_escrever_admin on public.decks_estruturais
  for all using (public.eh_admin()) with check (public.eh_admin());


-- ------------------------------------------------------------------ compras
-- Registro de quem ja' comprou o que. A chave primaria composta E' o limite de
-- 1 por conta: um segundo insert do mesmo par colide, entao a regra e'
-- estrutural em vez de depender de alguem lembrar de conferir.
create table if not exists public.compras_estruturais (
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  deck_id      text not null references public.decks_estruturais(id) on delete cascade,
  nome_do_deck text not null,
  comprado_em  timestamptz not null default now(),
  primary key (usuario_id, deck_id)
);

alter table public.compras_estruturais enable row level security;
revoke all on public.compras_estruturais from anon, authenticated;
grant select on public.compras_estruturais to authenticated;

-- O jogador precisa ver o que ja' comprou (a Loja marca "adquirido"), mas nao
-- escreve: quem registra a compra e' a funcao, junto com o desconto do DP.
create policy compras_do_dono on public.compras_estruturais
  for select using (usuario_id = auth.uid());


/**
 * Compra um deck estrutural.
 *
 * Faz as quatro coisas numa transacao so': cobra o DP, credita as CARTAS na
 * colecao, grava o deck em `decks_jogador` e registra a compra.
 *
 * Creditar as cartas nao e' detalhe: `salvar_deck` confere posse carta a carta.
 * Sem isso o jogador receberia um deck que ele nao consegue reeditar nem
 * salvar de volta — funcionaria uma vez e travaria na primeira mudanca.
 *
 * (Esta versao foi substituida pela 0018 — `nome` era variavel E coluna — e
 * depois pela 0019, que revalida o deck no ato da compra.)
 */
create or replace function public.comprar_deck_estrutural(p_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid   uuid := auth.uid();
  d     record;
  w     jsonb;
  dp    int;
  col   jsonb;
  r     record;
  nome  text;
  n     int := 1;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select * into d from public.decks_estruturais where id = p_id and na_loja;
  if d is null then raise exception 'deck estrutural "%" nao esta a venda', p_id; end if;

  if exists (select 1 from public.compras_estruturais
              where usuario_id = uid and deck_id = p_id) then
    raise exception 'voce ja tem este deck (limite de 1 por conta)';
  end if;

  w  := public.carteira_minha();
  dp := (w->>'dp')::int;
  if dp < d.preco then raise exception 'DP insuficiente'; end if;

  -- As cartas do deck entram na colecao. Um estrutural pode trazer 3 copias da
  -- mesma carta, entao a soma e' por carta, nao por linha.
  col := coalesce(w->'collection', '{}'::jsonb);
  for r in select id, count(*)::int as qtd from public.ydk_cartas(d.ydk) group by id loop
    col := jsonb_set(col, array[r.id::text],
                     to_jsonb(coalesce((col->>r.id::text)::int, 0) + r.qtd), true);
  end loop;

  w := w || jsonb_build_object('dp', dp - d.preco)
         || jsonb_build_object('collection', col);
  update public.carteiras set dados = w where usuario_id = uid;

  nome := d.nome;
  while exists (select 1 from public.decks_jogador where usuario_id = uid and nome = decks_jogador.nome) loop
    n := n + 1;
    nome := d.nome || ' ' || n;
  end loop;

  insert into public.decks_jogador (usuario_id, nome, ydk) values (uid, nome, d.ydk);
  insert into public.compras_estruturais (usuario_id, deck_id, nome_do_deck)
  values (uid, p_id, nome);

  return jsonb_build_object('ok', true, 'deck', nome, 'preco', d.preco, 'carteira', w);
end;
$$;

/**
 * Confere se um .ydk serve como deck estrutural: tamanho oficial e teto de
 * copias. NAO confere posse (o estrutural existe justamente para dar as cartas)
 * nem banlist/Lista, que sao regras de uso e podem mudar depois da publicacao.
 */
create or replace function public.validar_deck_estrutural(p_ydk text)
returns jsonb language plpgsql immutable
set search_path = public as $$
declare
  n_main int; n_extra int; n_side int; problemas text[] := '{}'; r record;
begin
  select count(*) filter (where secao = 'main'),
         count(*) filter (where secao = 'extra'),
         count(*) filter (where secao = 'side')
    into n_main, n_extra, n_side
  from public.ydk_por_secao(p_ydk);

  if n_main < 40 or n_main > 60 then
    problemas := problemas || format('main tem %s cartas (precisa de 40 a 60)', n_main);
  end if;
  if n_extra > 15 then problemas := problemas || format('extra tem %s (max 15)', n_extra); end if;
  if n_side  > 15 then problemas := problemas || format('side tem %s (max 15)', n_side);  end if;

  for r in select id, count(*)::int as q from public.ydk_por_secao(p_ydk) group by id loop
    if r.q > 3 then problemas := problemas || format('%s: %s copias (max 3)', r.id, r.q); end if;
  end loop;

  return jsonb_build_object('ok', array_length(problemas, 1) is null,
                            'main', n_main, 'extra', n_extra, 'side', n_side,
                            'problemas', to_jsonb(problemas));
end;
$$;

revoke all on function public.validar_deck_estrutural(text) from public, anon;
grant execute on function public.validar_deck_estrutural(text)  to authenticated;
grant execute on function public.comprar_deck_estrutural(text)  to authenticated;
