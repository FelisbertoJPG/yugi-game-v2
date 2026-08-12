# Onde cada regra é decidida

Auditoria de 2026-08-12: o que já é decidido pelo **servidor** (Supabase) e o que
ainda vive só no **cliente**.

A pergunta que este documento responde não é "onde o código está", é **"quem tem
a última palavra"**. Uma regra que existe apenas no navegador não é uma regra —
é uma sugestão, porque o navegador é a parte que o jogador controla. Ele pode
abrir o DevTools, editar um `.ydk` no bloco de notas, ou chamar a API direto.

> Regra de bolso: **toda checagem que vive só no cliente é uma checagem que não
> existe.** O cliente pode e deve continuar validando — mas por conveniência, para
> avisar antes de o jogador perder tempo, nunca como a trava.

---

## Já migrado — o banco é a verdade

| domínio | onde vive | o que o servidor garante |
|---|---|---|
| **Economia** | `abrir_pacote`, `vender_cartas`, `remover_cartas` | o sorteio do pacote acontece **no servidor**, com pity e `urSpend`; o preço de venda sai da raridade publicada |
| **Deck do jogador** | `salvar_deck` | tamanho (40–60 main, 15 extra/side), posse pela regra de raridade, teto individual da banlist, pool da lista ativa |
| **Deck estrutural** | `comprar_deck_estrutural`, `validar_deck_estrutural` | compra uma vez por conta |
| **Conteúdo do jogo** | tabela `conteudo` | `banlist`, `boosters`, `npcs`, `cardlists`, `lista1` — só admin escreve (RLS `eh_admin()`) |
| **Decks de NPC** | tabela `decks_npc` | os 8 estão publicados |
| **Tabuleiros** | tabela `tabuleiros` | os 2 estão publicados |
| **Multiplayer** | `fila`, `partidas`, `lances`, `amizades` | pareamento, salas, o canal da ponte e as amizades |

O `web/js/projectstore.js` é a peça que amarra isso: **lê do banco primeiro** e cai
para `/__store/` só como plano B offline. É por isso que `npcs.js`, `boosters.js` e
`banlist.js` não falam com o banco diretamente e mesmo assim leem de lá.

### O payload não é dívida

O `payload.zip` embutido no exe leva `store/` e `decks/` como **semente**. Isso não
é conteúdo por migrar: é o fallback offline. O jogo abre sem rede com o conteúdo
do dia do empacotamento, e o banco corrige na primeira conexão. É o desenho certo
e deve continuar assim.

---

## O que ainda não migrou

### 1. Banlist: Ponto e Lista compartilhada

O `salvar_deck` valida **só `cardLimits`**. As outras duas regras da banlist vivem
apenas em `validateBanlist` (`web/js/banlist.js`), chamado só pelo `builder.js`:

- **Ponto** — `cardPoints` (custo POR CÓPIA) somado contra `pointBudget`;
- **Lista compartilhada** — `cardGroups`: um número N em 2+ cartas faz elas
  **dividirem** N cópias no total entre si.

Hoje as duas estão vazias no banco, então **não há brecha aberta**. Mas no dia em
que a Lista compartilhada for usada, ela vale só na tela — e é justamente o
mecanismo que a Banlist normal não consegue expressar, ou seja, o mais provável de
você querer usar.

### 2. `premiar_vitoria` não prova a vitória

Conhecido e aceito. O duelo roda no `ocgcore` da máquina do jogador e o servidor
não o vê — quem diz "venci" é o cliente.

As travas de hoje transformam laço de console em trabalho: duelo registrado, uma
cobrança por duelo, mínimo de 30 s, teto de 60/hora, e (desde a `0018`) **um
duelo vivo por vez** — abrir um novo abandona o anterior, então não dá mais para
enfileirar 60 e premiar todos.

O que a `0018` acrescentou não é prova, é **rastro**: todo desfecho fica gravado,
inclusive derrota e abandono. Isso não impede a trapaça, mas a torna *visível* —
um jogador com 40 vitórias, nenhuma derrota e 31 segundos de média aparece numa
consulta. Antes não havia o que consultar.

**Só a arena resolve de verdade**, e é outro projeto.

### 3. `openPack` é resquício

`web/js/boosters.js` ainda tem um sorteio local completo (`openPack`, com
`Math.random`). Ele **não é chamado em lugar nenhum** do fluxo do jogador — quem
sorteia é o servidor. É código morto que parece caminho válido, e o risco é
alguém replugá-lo achando que é por ali.

---

## Checklist

- [x] **1. Banlist: Ponto e Grupo no servidor, e publicação automática** ✅ 12/08
  - [x] `salvar_deck` valida `cardPoints`/`pointBudget` e `cardGroups`
        (migration `0017`). Conferido contra o banco com uma banlist de teste:
        ponto no limite salva e estourado recusa; teto individual recusa; e o
        grupo recusa `2+1` mesmo com cada carta dentro do próprio teto — que é o
        caso que só a Lista compartilhada expressa.
  - [x] O editor publica **a cada mudança**, com 700 ms de espera (o campo de
        orçamento dispara a cada tecla). O autosave mora no `markDirty()`, por
        onde toda edição já passava — um lugar para lembrar em vez de seis para
        esquecer.
  - [x] De quebra: `projectstore.enviar` engolia o erro do banco
        (`req(...).catch(() => {})`). O disco gravava, o banco não, e a tela
        dizia "salvo" — o mesmo bug que o deck do jogador tinha. Agora
        `aoGravar(chave, cb)` entrega o veredito, e o editor só diz "publicado"
        quando o **banco** aceitou.

- [ ] **2. Apagar (ou isolar) o `openPack` local**
  - [ ] Remover de `boosters.js`, ou deixar explícito que é simulação do Booster
        Builder e não o caminho de compra.

- [x] **3. O desfecho do duelo mora no banco** ✅ 12/08 (migration `0018`)
  - [x] `duelos` ganhou `resultado` (vitoria/derrota/empate/abandonado),
        `encerrado_em` e `deck`. Antes só a vitória deixava rastro — os 5 duelos
        que existiam estavam todos "em aberto", sem saber se foram derrotas ou
        abas fechadas.
  - [x] `encerrar_duelo(id, resultado)` registra e, na vitória, paga junto: o fim
        do duelo é UMA chamada. Idempotente, então duplo-clique não conta duas
        vezes. Prêmio recusado **não apaga** o resultado.
  - [x] Fechou uma brecha: dava para abrir 60 duelos e premiar os 60 em
        sequência. Agora começar um duelo abandona o anterior — que é o que
        acontece de fato.
  - [ ] **Continua sem prova de vitória.** Quem diz "venci" é o cliente. Só a
        arena resolve — ver abaixo.

- [ ] **3b. Arena: o motor no servidor**
  - [ ] É o único jeito de o resultado ser provado. `b0a023b1` (salas
        concorrentes) é a base. Quando existir, ela grava na MESMA coluna
        `duelos.resultado` — sem migração nova.

- [ ] **4. Varredura periódica**
  - [ ] A cada regra nova, perguntar: "isto existe no servidor?". O erro é sempre
        o mesmo — a regra nasce na tela porque é onde ela é visível.

---

## Como conferir de novo

```sql
-- que regras da banlist o salvar_deck conhece hoje
select case when prosrc like '%cardPoints%' then 'sim' else 'NAO' end as pontos,
       case when prosrc like '%cardGroups%' then 'sim' else 'NAO' end as grupos,
       case when prosrc like '%cardLimits%' then 'sim' else 'NAO' end as limites
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'salvar_deck';
```

```bash
# conteúdo local que ainda não subiu
ls store/*.json boards/*.json
# contra: select chave from public.conteudo;  e  select nome from public.tabuleiros;
```
