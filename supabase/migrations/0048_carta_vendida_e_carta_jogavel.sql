-- 0048 — O QUE O JOGO ENTREGA, O JOGO ACEITA.
--
-- O pedido: *"quando um card for adicionado a um booster, estrutural ou drop de
-- NPC, automaticamente ele tem que contar na lista1"*.
--
-- E' a metade que faltava de um estrago que o `CLAUDE.md` ja' descrevia: *"o
-- Booster Builder monta do banco INTEIRO, nao do pool da lista"*. Nada impedia
-- pôr num booster uma carta que a Lista 1 nao conhece — e o prejuizo e'
-- silencioso e caro: o jogador paga DP, abre a carta, ela entra na Colecao e
-- aparece no Deck Builder; so' na hora de SALVAR o deck e' que `salvar_deck`
-- diz "nao esta' na lista permitida".
--
-- A resposta ate' hoje era um relatorio (`npm run boosters:check`) e a
-- disciplina de rodar ele. Nao funcionou: no dia desta migration havia **10
-- cartas** obteniveis e injogaveis no banco, e nove delas sao justamente as dos
-- pacotes de NPC (Shifting Shadows, Dark Factory of More Production,
-- Multiplication of Ants, Insect Neglect, Swarm of Locusts, Reaper of the
-- Cards…) — configuradas como drop e nunca acrescentadas a' lista. O jogador
-- vencia o Panik, ganhava a carta, e nao conseguia montar deck com ela.
--
-- A regra vira INVARIANTE em vez de tarefa: **carta que o jogo entrega e' carta
-- que o jogo aceita**. Quem entrega e' o booster, o Deck Estrutural e o pool de
-- drop de NPC — os tres ja' estao no banco, e os tres sao listas EXPLICITAS de
-- id. Nao precisam do indice de cartas para serem resolvidas (ao contrario de
-- "todo monstro Normal", que e' por que a lista resolvida e' publicada pelo
-- navegador).
--
-- **Uma implementacao so'.** `cartas_obteniveis()` e' a unica conta; a tela nao
-- a refaz, ela a LE (`rpc/cartas_obteniveis`, em `web/js/cardlists.js`). Uma
-- segunda conta no navegador divergiria em silencio, e o jeito de errar seria o
-- pior possivel: as duas telas continuariam plausiveis, uma deixando montar o
-- deck e a outra recusando salva-lo. E' o mesmo erro que este projeto ja' pagou
-- com `chancesDe` x `chancesDoPacote`.
--
-- **Calculada na hora, e nao gravada.** Materializar isto dentro de
-- `conteudo/lista1` criaria um estado que pode ficar velho — e que o proximo
-- "salvar" do editor de listas apagaria, porque ele republica o array resolvido
-- inteiro. Assim ela e' auto-curativa: tirar a carta do booster tira ela da
-- lista no mesmo instante, sem ninguem rodar nada.
--
-- **NAO entra na FONTE da lista** (`conteudo/cardlists`, o que o editor edita).
-- La' ficam so' as escolhas de quem administra. Misturar as duas carimbaria a
-- carta como escolha a' mao, e tirar ela do booster deixaria de tirar ela da
-- lista — a fonte viraria um deposito que so' cresce.

-- ---------------------------------------------------------------------------
-- As cartas que o jogo ENTREGA, de qualquer uma das tres portas.
--
-- Cada `where` de tipo existe porque este dado e' editado a' mao por um painel
-- e uma unica entrada torta derruba a funcao — e ela roda dentro de
-- `salvar_deck` e da porta do duelo. Preferir devolver de menos a estourar.
-- ---------------------------------------------------------------------------
create or replace function public.cartas_obteniveis()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(distinct t.id order by t.id), '[]'::jsonb)
  from (
    -- BOOSTER: `conteudo/boosters` = [{ cards: { N:[…], R:[…], SR:[…], UR:[…] } }].
    -- Booster fora da vitrine (`inShop: false`) conta igual: quem comprou antes
    -- de ele sair de cartaz continua com as cartas na Colecao.
    select (e)::text::bigint as id
      from public.conteudo c
      cross join lateral jsonb_array_elements(c.dados) b
      cross join lateral jsonb_each(
        case when jsonb_typeof(b->'cards') = 'object' then b->'cards' else '{}'::jsonb end
      ) r(raridade, ids)
      cross join lateral jsonb_array_elements(ids) e
     where c.chave = 'boosters'
       and jsonb_typeof(c.dados) = 'array'
       and jsonb_typeof(ids) = 'array'
       and jsonb_typeof(e) = 'number'

    union

    -- DROP DE NPC: o pool do NPC e o pool de cada DECK dele. Os dois, porque a
    -- resolucao do premio tambem olha os dois (`dropsDoDeck`: deck primeiro, NPC
    -- como reserva). `icones` fica de fora sozinho — ele e' irmao de `pool`, e
    -- so' o que esta' DENTRO de `pool` e' carta.
    select (e)::text::bigint
      from public.conteudo c
      cross join lateral jsonb_each(c.dados) npc(nome, cfg)
      cross join lateral (
        select cfg->'pool' as p
        union all
        select d.value->'pool'
          from jsonb_each(
            case when jsonb_typeof(cfg->'decks') = 'object' then cfg->'decks' else '{}'::jsonb end
          ) d
      ) pools
      cross join lateral jsonb_each(
        case when jsonb_typeof(pools.p) = 'object' then pools.p else '{}'::jsonb end
      ) r(raridade, ids)
      cross join lateral jsonb_array_elements(ids) e
     where c.chave = 'npc-drops'
       and jsonb_typeof(c.dados) = 'object'
       and jsonb_typeof(ids) = 'array'
       and jsonb_typeof(e) = 'number'

    union

    -- DECK ESTRUTURAL: o `.ydk` inteiro, side incluso — quem compra recebe tudo.
    select y.id
      from public.decks_estruturais d
      cross join lateral public.ydk_por_secao(d.ydk) y
  ) t;
$$;

-- A tela LE esta resposta (nunca a recalcula), entao ela precisa ser chamavel.
-- Nao conta segredo nenhum: booster, estrutural e drop sao conteudo publico do
-- jogo, e a propria `conteudo` tem leitura aberta.
revoke all on function public.cartas_obteniveis() from public;
grant execute on function public.cartas_obteniveis() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- A lista ativa passa a ser a UNIAO: o que o admin escolheu + o que o jogo
-- entrega. Quem le nao muda em nada — `salvar_deck`, `problemas_de_banlist` e
-- as entradas do PvP continuam perguntando a mesma coisa.
-- ---------------------------------------------------------------------------
create or replace function public.lista_ativa()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare alvo text; dados_lista jsonb;
begin
  select coalesce(dados->>'listId', 'lista1') into alvo
    from public.conteudo where chave = 'banlist';
  alvo := coalesce(alvo, 'lista1');

  select dados into dados_lista from public.conteudo where chave = alvo;
  if dados_lista is null and alvo <> 'lista1' then
    select dados into dados_lista from public.conteudo where chave = 'lista1';
  end if;

  -- Sem lista publicada, `null` continua querendo dizer "nao sei qual e' a
  -- lista", e quem le trata isso como "nao confere pool nenhum". Devolver aqui
  -- so' as obteniveis transformaria o desconhecido numa lista minuscula, que
  -- recusaria praticamente todo deck do jogo — o oposto do que a ausencia de
  -- lista sempre significou.
  if dados_lista is null then return null; end if;
  if jsonb_typeof(dados_lista) <> 'array' then return dados_lista; end if;

  return (
    select coalesce(jsonb_agg(distinct u.e order by u.e), '[]'::jsonb)
      from (select jsonb_array_elements(dados_lista) as e
            union all
            select jsonb_array_elements(public.cartas_obteniveis())) u
  );
end;
$$;
