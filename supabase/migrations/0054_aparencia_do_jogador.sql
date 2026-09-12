-- ============================================================================
-- A APARENCIA do jogador — o que ele veste no Mundo.
--
-- Ate aqui a aparencia de um boneco era DEDUZIDA do id (`coresPara`, no
-- cliente): pura, igual em toda tela, e por isso nunca precisou viajar nem ser
-- guardada. Customizacao acaba com isso — a aparencia vira DADO, e dado
-- precisa (a) ser gravado, (b) chegar aos outros e (c) ser conferido.
--
-- As tres metades estao aqui, e a terceira e' a que importa.
--
-- ---------------------------------------------------------------------------
-- POR QUE A CONFERENCIA NAO PODE FICAR SO' NO CLIENTE
--
-- Cabelo e roupa viram ITEM (tabela `itens`, 0051), comprado com DP ou ganho
-- numa vitoria. Se a posse fosse decidida na tela, bastaria um
-- `PATCH /perfis?id=eq.<meu>` com a peca mais cara da loja: a policy
-- `perfis_atualizar_proprio` deixa o dono escrever na propria linha. O
-- cosmetico que se vende por DP seria de graca para quem abre o console.
--
-- E' literalmente o furo que a 0035 tinha e a 0036 fechou para o icone, e a
-- resposta e' a mesma: um gatilho cuja regra e' do **dono da linha**, e nao de
-- quem esta' escrevendo. Assim ela vale igual para o jogador, para o admin
-- editando outra pessoa e para qualquer funcao futura.
--
-- ---------------------------------------------------------------------------
-- A REGRA DA POSSE, em uma frase
--
--   "Se a peca esta' no catalogo de venda, voce precisa te-la.
--    Se nao esta', e' de graca."
--
-- Repare no que ela NAO tem: uma lista de pecas gratuitas. Gratis e' a
-- AUSENCIA em `itens` — o que faz um admin por uma peca a' venda (ou tira-la)
-- sem ninguem precisar editar codigo nos dois lados. Uma lista de gratuitos
-- aqui e outra em `aparencia.js` se desencontrariam na primeira peca nova, e o
-- sintoma seria a tela deixar vestir e o banco recusar o salvamento inteiro.
--
-- O id da peca no JSON e' o MESMO id de `itens` (`cabelo-moicano`), e nao um
-- nome curto que alguem monta com um prefixo. Montar o id nos dois lados seria
-- a mesma regra escrita duas vezes; no dia em que o JS e o SQL discordassem
-- sobre um hifen, todo mundo passaria a vestir de graca, em silencio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A coluna.
alter table public.perfis add column if not exists aparencia jsonb;

comment on column public.perfis.aparencia is
  'O que este jogador veste. Forma em web/js/aparencia.js; null = o padrao deduzido do id.';

-- O teto existe pela mesma razao que o dos 256 KB do icone: um engano (um
-- objeto inteiro postado aqui) viajaria para todo mundo que abrisse o Mundo,
-- para sempre. A forma e' fechada e cabe folgado em 1 KB — `LIMITE_JSON`, em
-- `aparencia.js`, e' o mesmo numero, e o cliente recusa antes de tentar.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_aparencia_tamanho') then
    alter table public.perfis add constraint perfis_aparencia_tamanho
      check (aparencia is null or length(aparencia::text) <= 1024);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Os tipos novos de item.
--
-- Um por SLOT, e nao um `cosmetico` guarda-chuva: e' o `tipo` que deixa a Loja
-- e o Inventario agruparem ("cabelos", "blusas"), e um tipo unico obrigaria uma
-- SEGUNDA coluna dizendo em que slot a peca entra — dois campos para o mesmo
-- fato, que e' como eles se desencontram.
alter table public.itens drop constraint if exists itens_tipo_check;
alter table public.itens add constraint itens_tipo_check
  check (tipo in ('generico', 'sleeve', 'playmat', 'deckbox',
                  'cabelo', 'roupa', 'calca', 'sapato'));

-- ---------------------------------------------------------------------------
-- 3. O gatilho — a fechadura.
create or replace function public.perfis_valida_aparencia()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_peca text;
begin
  if new.aparencia is null then return new; end if;

  -- Nao mexeu na aparencia: nada a conferir. Sem esta saida, TODO update de
  -- perfil pagaria a varredura — inclusive o `visto_em` do batimento, que roda
  -- a cada 45s para cada jogador com o jogo aberto.
  if tg_op = 'UPDATE' and new.aparencia is not distinct from old.aparencia then
    return new;
  end if;

  -- A forma tem de ser um objeto. `jsonb_each` sobre um array ou um escalar
  -- levanta erro cru do Postgres, que chegaria na tela como "cannot call
  -- jsonb_each on a scalar" — verdadeiro e inutil.
  if jsonb_typeof(new.aparencia) <> 'object' then
    raise exception 'aparencia precisa ser um objeto';
  end if;

  for v_peca in
    select value ->> 'peca'
      from jsonb_each(new.aparencia)
     where jsonb_typeof(value) = 'object'
  loop
    continue when v_peca is null;

    -- Fora do catalogo de venda = de graca. Esta ordem e' a regra inteira, e
    -- inverte-la (so' o que esta' no catalogo e' permitido) recusaria as pecas
    -- basicas, que sao justamente as que ninguem cadastra em `itens`.
    continue when not exists (select 1 from public.itens where id = v_peca);

    if not exists (
      select 1 from public.itens_do_jogador j
       where j.item_id = v_peca and j.usuario_id = new.id
    ) then
      raise exception 'este perfil nao tem a peca %', v_peca;
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.perfis_valida_aparencia() is
  'Recusa peca que o dono do perfil nao possui, venha por onde vier.';

drop trigger if exists perfis_aparencia_valida on public.perfis;
create trigger perfis_aparencia_valida
  before insert or update of aparencia on public.perfis
  for each row execute function public.perfis_valida_aparencia();

-- ---------------------------------------------------------------------------
-- 4. Ler a aparencia dos OUTROS.
--
-- A policy de `perfis` e' `perfis_ler_proprio` — ninguem le a linha de mais
-- ninguem. Isso esta' certo e continua valendo; o que falta e' uma porta
-- estreita, porque um mundo compartilhado precisa saber a cara de quem esta'
-- nele.
--
-- **E ela conserta um buraco que ja' existia.** Ate aqui o NOME que aparece
-- sobre a cabeca de cada um viajava no proprio recado de posicao, dito pelo
-- cliente que o manda — o `MUNDO-3D-HANDOFF.md` registra isso como limite
-- conhecido, aceitavel *"enquanto o Mundo for so' um lugar de andar"*, e avisa
-- que **no dia em que houver interacao o nome tem de vir do servidor**. Roupa
-- comprada e' esse dia: apresentacao que o cliente escolhe sozinho vira
-- credencial. Com esta funcao, nome e aparencia passam a sair daqui, e o recado
-- de posicao volta a carregar so' coordenada.
--
-- O que ela devolve e' o que qualquer um ja' podia obter por `buscar_jogador`
-- (nome) mais o que e' publico por natureza (a roupa que a pessoa esta' usando
-- na frente dos outros). O que ela NAO devolve e' o resto da linha: nada de
-- `dp`, `etiqueta`, `visto_em`, `admin` ou e-mail.
--
-- O teto de 60 ids nao e' medo de enumeracao — uuid nao se adivinha, e sem
-- sessao nem se chama. E' o mesmo teto do mundo: mais de 60 pessoas na mesma
-- clareira e' outro problema (salas), nao uma consulta maior.
create or replace function public.aparencias(p_ids uuid[])
returns table(id uuid, usuario text, aparencia jsonb)
language sql stable security definer
set search_path = public as $$
  select p.id, p.usuario, p.aparencia
    from public.perfis p
   where p.id = any (p_ids[1:60]);
$$;

comment on function public.aparencias(uuid[]) is
  'Nome e aparencia de quem esta no Mundo. So isso: o resto do perfil continua fechado.';

revoke all on function public.aparencias(uuid[]) from public, anon;
grant execute on function public.aparencias(uuid[]) to authenticated;
