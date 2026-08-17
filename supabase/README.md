# `supabase/` — o espelho na nuvem

Projeto: `shclhlbfkdnnqxboiuqc` · `https://shclhlbfkdnnqxboiuqc.supabase.co`

Isto **não** é a fonte da verdade do jogo. O Classic Duels roda como servidor
local e tem que abrir offline — é a mesma regra que rege o instalador
(`offline nunca trava o jogo`, `INSTALADOR.md` §5). O Supabase é **espelho**:
sobe quando há rede, desce ao entrar noutra máquina.

## As duas metades

Elas têm posturas de segurança opostas, e misturá-las é o erro caro:

| | Tabelas | Quem lê | Quem escreve |
|---|---|---|---|
| **Conteúdo do jogo** | `conteudo`, `decks_npc`, `tabuleiros` | todo mundo, **sem login** | só admin |
| **Dado de conta** | `perfis`, `carteiras`, `decks_jogador` | só o dono | só o dono |

A primeira metade é o espelho de `store/*.json`, `decks/npc/**.ydk` e
`boards/*.json`. É o que faz o painel de teste publicar uma banlist ou um deck
de NPC novo e o jogador receber **sem gerar Release nenhum** — que resolve a
pendência §11 do `INSTALADOR-PENDENCIAS.md` (hoje `decks/npc/*.ydk` só viajam
dentro do exe, então editar o deck do Kaiba nunca chega em quem já instalou).

A segunda é o espelho de `store/users/<usuário>/wallet.json` e
`decks/users/<usuário>/player/*.ydk` — a mesma separação que o `UpdateEngine`
já aplica por código com `Intocaveis`, aqui virando RLS.

## As chaves

| Chave | O que é | Onde pode aparecer |
|---|---|---|
| **publishable** (`sb_publishable_…`) | pública **por design** — quem protege é a RLS | dentro do exe, no front, no git |
| **secret / service_role** | ignora toda a RLS | **em lugar nenhum deste repositório** |

A secret é do mesmo naipe do `gho_…` do `gh` que o `INSTALADOR.md` manda nunca
embutir. Se vazar, vazou o banco inteiro.

> O endpoint raiz do PostgREST (`/rest/v1/`) responde **401** com a chave
> publishable — `"Only secret API keys can be used for this endpoint"`. Isso é
> normal e não indica chave inválida: consultas a tabelas funcionam. Para testar
> a chave, consulte uma tabela, não a raiz.

## Rodar as migrations

Não há CLI configurado — as migrations são aplicadas à mão, na ordem numérica:

1. **SQL Editor → New query**
2. colar o conteúdo de `migrations/000N_*.sql`
3. **Run**

Cada arquivo é idempotente no que dá para ser (`create extension if not exists`,
`create or replace function`), mas os `create table` não são: rodar duas vezes dá
`relation already exists`. Isso é proposital — é melhor errar barulhento que
apagar tabela por engano.

## Depois da `0001`

O primeiro admin precisa ser promovido à mão, porque `travar_admin` impede que
alguém se promova sozinho:

```sql
-- 1. crie a conta pelo app (ou em Authentication -> Users -> Add user)
-- 2. rode isto no SQL Editor, trocando o e-mail:
update public.perfis set admin = true
where id = (select id from auth.users where email = 'voce@exemplo.com');
```

Confira depois:

```sql
select p.usuario, p.admin, u.email
from public.perfis p join auth.users u on u.id = p.id;
```
