# Quando um conteúdo COMPRADO é atualizado

O que fazer com quem já pagou por um Deck Estrutural (ou qualquer conteúdo com
"1 por conta") no dia em que esse conteúdo muda.

> **Estado hoje (16/08/2026): resolvido, por EMPURRÃO.** Publicar uma versão nova
> de um estrutural alcança na hora quem já comprou — migration
> `0025_estrutural_atualiza_quem_comprou.sql`. O resto do documento continua
> valendo: a §1 é o caso real que originou tudo, a §2 explica por que a trava
> existe e §3–§4 são a decisão editorial (errata × nova edição), que nenhum
> código resolve. O que mudou é a §5: ela era o desenho recomendado e virou
> comparação — ver **§5.0**.

---

## 1. O caso que originou

| quando | o quê |
|---|---|
| 12/08/2026 20:08 | a conta compra o "Deck Estrutural — Ataque das Profundezas" por 300 DP |
| 15/08/2026 04:16 | o deck é **editado** no painel da Área de Teste |
| depois | a Loja mostra "adquirido" e recusa a compra: o jogador está preso à versão velha |

Resolvido na mão apagando a linha de `compras_estruturais` (§6). Com um jogador
isso é um `delete`; com cinquenta, é uma decisão de produto.

---

## 2. Por que trava

A trava é **estrutural, e de propósito** — `supabase/migrations/0017_decks_estruturais.sql`:

```sql
primary key (usuario_id, deck_id)
```

A chave composta É o limite de 1 por conta: um segundo `insert` do mesmo par
colide, então a regra não depende de alguém lembrar de conferir. Ótimo desenho
para o problema que ela resolve.

O buraco é outro: **o `deck_id` é estável e o conteúdo é mutável.**
`decks_estruturais.ydk` pode ser reescrito a qualquer momento, e nada em lugar
nenhum registra *qual versão* aquela linha de compra pagou. Para o banco,
"comprei o Ataque das Profundezas" é um fato atemporal — a linha de 12/08 e a de
depois de qualquer errata são idênticas.

Ou seja: não existe pergunta que o banco saiba responder para "este jogador tem
a versão atual?".

---

## 3. Por que "é só comprar de novo" não é a resposta

Lendo `comprar_deck_estrutural()` (a função inteira, não a intenção dela), uma
recompra faz **quatro** coisas, e só a primeira é a desejada:

1. entrega o deck novo em `decks_jogador`; **mas**
2. **cobra o preço cheio de novo** — o jogador paga duas vezes por um produto que
   ele já tinha, porque nós mexemos nele;
3. **soma as cartas na Coleção de novo**, cumulativamente:
   ```sql
   col := jsonb_set(col, array[r.id::text],
                    to_jsonb(coalesce((col->>r.id::text)::int, 0) + r.qtd), true);
   ```
   Quem tinha 3 cópias de uma carta fica com 6. Numa Coleção que decide quantas
   cópias você pode pôr no deck (`copias_disponiveis`), isso não é cosmético — é
   inflação da economia toda, pela porta dos fundos;
4. **cria um deck com sufixo numérico** se o antigo ainda existir:
   ```sql
   while exists (... where dj.nome = v_nome) loop v_nome := d.nome || ' ' || n; end loop;
   ```
   O jogador fica com "Ataque das Profundezas" e "Ataque das Profundezas 2" e
   nenhuma pista de qual é o atual. Se ele tiver *editado* a cópia dele — que é o
   ponto de receber um deck montado — pior ainda: as duas são "dele".

E há um quinto efeito, que só aparece no pior momento: `comprar_deck_estrutural`
chama `validar_deck_estrutural(d.ydk)` **na hora da compra**. Uma edição que
deixe o deck ilegal (menos de 40, carta fora da lista) não dá erro nenhum ao
salvar no painel — o erro nasce na cara do próximo jogador que tentar comprar.

---

## 4. A pergunta editorial vem antes do código

Não existe uma regra técnica única, porque "atualizei o deck" são duas coisas
diferentes com respostas opostas:

| | **Errata** | **Nova edição** |
|---|---|---|
| o que é | trocou 2 cartas, ajustou a curva, corrigiu um id errado | virou outro produto: outro tema, outro preço, outra proposta |
| o jogador esperava? | não — ele acha que tem "o" deck | sim — é um lançamento |
| deve pagar? | **não** | **sim** |
| o que ele recebe | só a **diferença** | o produto inteiro |
| custo de implementar | precisa de versão + delta (§5) | **zero** (§4.1) |

Decidir isso é de quem edita o deck, não do código. O código só precisa oferecer
os dois caminhos.

### 4.1 Nova edição: resolvido hoje, sem escrever nada

A trava é por `deck_id`. **Um `id` novo é um produto novo** e ninguém fica preso:

```
deck-estrutural-ataque-das-profundezas     ← continua existindo, `na_loja = false`
deck-estrutural-ataque-das-profundezas-2   ← o novo, à venda
```

Tirar o antigo da Loja (`na_loja = false`) em vez de apagá-lo importa: a linha de
`compras_estruturais` tem `on delete cascade` no `deck_id`, então **apagar o deck
apaga o histórico de compra de todo mundo em silêncio**.

Regra de bolso: **mudou o que o jogador acha que comprou? é `id` novo.**

---

## 5.0 O que foi IMPLEMENTADO (16/08/2026)

Um gatilho no banco, `decks_estruturais_sincroniza` → `sincronizar_estrutural()`
(migration 0025). Em todo `update` que mude o `ydk` de um estrutural, para cada
conta que já o comprou:

- **credita as cartas que ENTRARAM** na versão nova (`delta = novo − antigo`, só
  o positivo);
- **troca a cópia do deck** em `decks_jogador` pela lista nova — **e só se o
  jogador não tiver customizado**. A comparação é pela lista de cartas ordenada,
  não pelo texto do `.ydk`: o Deck Builder acrescenta cabeçalho (`#name`,
  `#cover`, `#updated`) ao salvar, então comparar string diria "mexeu" para todo
  mundo.

Por que **gatilho** e não um passo do botão "publicar": o painel grava com um
upsert direto na tabela (`estruturais.js: salvarEstrutural`), não por RPC. Regra
no botão valeria só para aquele caminho — um `update` por SQL, por script ou por
uma tela futura passaria por fora e recriaria o problema em silêncio.

**Diferenças para o desenho da §5, e por quê:**

| §5 (desenhado) | 0025 (feito) |
|---|---|
| **puxar**: o jogador vê "atualização disponível" e pede | **empurrar**: chega junto com a publicação |
| guarda `ydk_comprado` para saber o que cada um recebeu | não precisa: a versão antiga é o `old.ydk` do próprio `update` |
| **nunca** escreve em `decks_jogador` | escreve, mas só quando a cópia ainda é idêntica à versão antiga |

A §5 estava certa em recear o `update` por cima — *"destruição de dado, e
silenciosa"*. A guarda de customização é a resposta a esse receio: quem mexeu no
deck fica com o dele e recebe as cartas do mesmo jeito, para montar como quiser.
O que se perde indo de "puxar" para "empurrar" é o aviso na Loja (§5.3): o
jogador recebe sem ser avisado. Se isso incomodar, o caminho é o `ydk_comprado`
da §5.1 — o gatilho pode gravá-lo sem mudar mais nada.

O que **continua valendo** da §5.2: carta REMOVIDA do estrutural **não** é tomada
de volta. Uma cópia pode estar em outro deck do jogador ou ter vindo de booster,
e a Coleção não sabe (nem deve saber) de onde cada uma veio.

Provado no banco antes de publicar: um estrutural descartável, uma compra, e as
duas metades — a cópia intacta é trocada e recebe as cartas novas; a cópia
customizada recebe as cartas e **não** é sobrescrita.

---

## 5. Errata: o desenho recomendado (superado pela §5.0, mantido pelo raciocínio)

Três peças. A ordem importa — a primeira sozinha já paga o próprio custo, porque
transforma "não sei" em "sei".

### 5.1 Guardar o que foi entregue

```sql
alter table public.compras_estruturais
  add column ydk_comprado  text,        -- a CÓPIA exata que esta conta recebeu
  add column atualizado_em timestamptz; -- quando ela pegou a errata (null = nunca)
```

O snapshot do `.ydk` (algumas centenas de bytes) em vez de um `versao int` é de
propósito: com ele a diferença é **calculável e exata**, sem precisar de um
histórico de versões nem de alguém lembrar de incrementar um número. Para as
linhas que já existem, `ydk_comprado` fica `null` — trate `null` como "versão
desconhecida, entrega o deck inteiro se ele pedir a errata".

E `comprar_deck_estrutural` passa a gravar `ydk_comprado = d.ydk` no `insert`
final. É uma linha.

### 5.2 Entregar só a diferença, de graça

```sql
create or replace function public.atualizar_deck_estrutural_comprado(p_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
-- Dá ao DONO deste estrutural as cartas que a versão nova tem A MAIS que a
-- cópia entregue a ele. Não cobra, não cria deck, não toca no deck dele.
--
--   delta = multiset(ydk atual) − multiset(ydk_comprado)   (só o positivo)
--
-- Carta REMOVIDA do estrutural não é tomada de volta: tirar carta de uma
-- Coleção é pior que deixar alguém com uma a mais, e a Coleção não sabe (nem
-- deve saber) de onde cada cópia veio.
$$;
```

O que ela **não** faz é tão importante quanto o que faz:

- **não escreve em `decks_jogador`.** O deck entregue virou propriedade do
  jogador no instante em que ele o recebeu; ele pode ter trocado cartas. Um
  update por cima é destruição de dado, e silenciosa;
- **não cobra nada.** Errata é conserto nosso;
- **é idempotente**: depois de rodar, `ydk_comprado` passa a ser o ydk atual, e a
  segunda chamada não tem delta.

### 5.3 Dizer ao jogador

A Loja já sabe quem comprou o quê (`estruturais.js`, `compras_estruturais?select=deck_id`).
Basta trazer `ydk_comprado` junto e, quando ele diferir do atual, o card na Loja
troca "adquirido" por **"atualização disponível — pegar"**. Sem isso o jogador
nunca descobre que a errata existe, e a função da §5.2 fica esperando alguém
chamá-la.

---

## 6. A válvula de admin (o que foi feito hoje)

Enquanto a §5 não existe, a saída é apagar a compra. Isto **libera a recompra e
cobra o preço cheio de novo, com todos os efeitos da §3** — serve para uma conta
de teste, não para jogador de verdade:

```sql
delete from public.compras_estruturais
 where usuario_id = '<uuid>'
   and deck_id    = '<id do deck>'
returning *;                     -- SEMPRE com returning: é o seu backup
```

O `returning` não é enfeite. Ele é a única cópia da linha que você acabou de
destruir; guarde a saída antes de fechar o terminal.

Quando isto acontecer uma segunda vez, vire função em vez de repetir SQL na mão:

```sql
-- liberar_recompra(p_deck_id, p_usuario_id default null)
--   null no usuário = todo mundo que comprou (pense duas vezes: são N cobranças)
--   exige eh_admin(); registra quem liberou e por quê
```

O motivo de virar função não é conveniência — é que `delete` manual em produção
não deixa rastro de quem fez nem de por quê, e a diferença entre "liberei a
recompra do deck X" e "sumiu a compra de alguém" é exatamente esse rastro.

---

## 7. O que não fazer

- **Sobrescrever `decks_jogador` do dono.** Destrói a edição dele sem aviso.
- **Reentregar o deck inteiro na Coleção.** Infla a economia (§3.3). Sempre delta.
- **Apagar `compras_estruturais` em massa para "liberar geral".** É recobrar todo
  mundo por um conserto nosso.
- **Apagar a linha de `decks_estruturais` para "recomeçar".** O `on delete
  cascade` leva o histórico de compra de todos junto. Use `na_loja = false`.
- **Editar um estrutural sem decidir a §4 antes.** É o passo que faltou aqui.

---

## 8. Vale para além do estrutural

O mesmo par "produto com trava de 1 por conta + conteúdo mutável" já existe em
outro lugar do jogo, e a pergunta é a mesma:

- **Boosters** (`conteudo/boosters`) — mudar a lista de um pacote muda o que uma
  compra futura entrega, mas não há trava de posse, então ninguém fica preso. O
  risco ali é outro e está no `CLAUDE.md`: pôr no pacote carta fora da lista
  permitida (`npm run boosters:check`).
- **Prêmio de NPC** (`decks_npc`, assinatura) — a carta que um adversário dropa
  pode mudar; como não há "1 por conta", também não trava.

Hoje **só o Deck Estrutural tem a trava permanente**, e é por isso que só ele
tem este problema. Antes de dar trava de posse a um conteúdo novo, decida no
mesmo dia o que acontece quando ele for editado — é muito mais barato que
descobrir depois, com gente do outro lado.
