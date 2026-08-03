# Roadmap — cartas próprias no duelo

> Guia para trabalhar sozinho, em etapas pequenas. Cada uma entrega algo que
> funciona por si, tem como conferir, e destrava a seguinte. Feito para ser
> seguido fora de ordem só quando o texto disser que dá.

## A boa notícia primeiro

Você pediu cartas que possam ser **invocadas, bater e ser destruídas**, mesmo sem
efeito. Isso **não precisa de Lua nenhum.**

Monstro Normal (vanilla) não tem efeito, logo não tem script — e isso é o
comportamento correto, não uma limitação: das 13.728 cartas oficiais, 1.146 não
têm `.lua` justamente por serem Normais. O `ScriptManager` já lida com isso:
quando o motor pede um script que não existe, ele devolve 0 e loga um aviso
(`ScriptManager.cs:99`). O duelo segue.

Ou seja: o "Estágio 2 / Lua manual" que aparece como bloqueio no
`DUEL-TRAINING-HANDOFF.md` vale só para **efeito**. Invocar, atacar, morrer e ir
para o cemitério é de graça.

## O que realmente falta

Uma coisa só, e é pequena: **os dados da sua carta nunca chegam ao motor.**

O caminho hoje:

1. Você cria a carta → ela vive em `localStorage` (`web/js/customcards.js`), com
   id a partir de 900000000
2. Ela já aparece no Deck Builder, com selo `CST` (`builder.js:187`)
3. Você duela → `web/duel.html:460` manda só `{ deck: ids }` — **os IDs, e nada
   mais**
4. O servidor procura o id no `cards.cdb` (`DatabaseManager.cs:113`), não acha,
   avisa `"A carta X nao existe no cards.cdb!"` e entrega ao motor uma struct
   **zerada**: type 0, ATK 0, sem nível, sem atributo

Uma carta com `type = 0` não é monstro nem magia. O motor não tem o que fazer com ela.

**A ponte que falta é o passo 3→4.** É a Etapa 1.

---

## Etapa 0 — suas cartas param de morrer no navegador

**Por quê primeiro:** hoje as cartas que você cadastrar somem se você limpar os
dados do site, e não acompanham você para a outra máquina. Antes de investir
horas cadastrando, garanta que o cadastro sobrevive. Também é o que faz elas
viajarem no git como os decks e os boosters.

**Onde mexer:** só no front. `web/js/customcards.js` guarda em `localStorage`
sob a chave `ygo:customCards`. Copie o padrão que `web/js/wallet.js` e
`web/js/boosters.js` já usam: `pullFileEx`/`pushFile` de
`web/js/projectstore.js`, espelhando em `store/cards.json`.

**Detalhe que economiza tempo:** o dev-server já aceita qualquer
`store/<nome>.json` — `safeStorePath` em `tools/serve.mjs:212` valida o nome e
pronto. **Você não precisa mexer no servidor.** É trabalho só de front.

**A armadilha:** hidrate antes de gravar. `pushFile` antes do `pullFileEx` faz um
estado vazio sobrescrever o arquivo bom — já aconteceu neste projeto e está
documentado no cabeçalho do `projectstore.js`. Siga a trava que o `wallet.js` usa.

**Como saber que funcionou:** cadastre uma carta, rode `git status` e veja
`store/cards.json` aparecer. Limpe o `localStorage` do navegador, recarregue: a
carta continua lá.

**Cuidado com o peso:** a arte vai em base64 dentro do JSON. O `customcards.js`
já reduz a imagem no import justamente por isso. Se `store/cards.json` começar a
passar de alguns MB, é sinal de guardar as artes em arquivos separados.

**Custo:** pequeno. É copiar um padrão que existe em dois lugares.

---

## Etapa 1 — o motor aceita sua carta ← *a que você pediu*

**O objetivo:** cadastrar um monstro Normal seu, colocar no deck, e ele ser
invocado, atacar, ser destruído e ir para o cemitério. Sem escrever uma linha de Lua.

### 1a. Mandar as cartas junto com o deck

`web/duel.html:460` monta `const body = { deck: ids }`. Acrescente as
customizadas do deck:

```js
const body = { deck: ids, customCards: [...] };
```

Do lado C#, `WebServer.StartDuel` (`WebServer.cs:116`) lê os campos do corpo —
é onde `deck`, `npcDeck`, `seed`, `flags` e `npc` já são lidos. Acrescente
`customCards` na mesma forma e repasse ao `InteractiveDuel`.

### 1b. O overlay no DatabaseManager

`CardReaderCallback` (`DatabaseManager.cs:104`) hoje vai direto ao SQLite. Faça
ele consultar **primeiro** um dicionário em memória das cartas customizadas, e
só cair no `cards.cdb` se não achar.

> **Não escreva no `cards.cdb`.** Ele é dado de terceiro (ygopro/edo9300),
> está duplicado em dois lugares do repositório (byte a byte idêntico, conferido)
> e é o arquivo que o `build.py` usa como fonte da verdade. Sujar ele contamina
> o `ygo-data` inteiro e some no próximo `npm run data:build`.

**Não esqueça o `Stats()`** (`DatabaseManager.cs:78`). É por ele que o `NpcBrain`
lê ATK/DEF para decidir a jogada. Com overlay só no `CardReaderCallback`, o NPC
enxerga sua carta como 0/0 e joga errado — invocaria em ataque um monstro que
deveria setar. Os dois precisam do mesmo overlay.

### 1c. Traduzir a carta para os números do motor

Suas cartas guardam texto (`typeLabel`, `race`, `attribute` em string). O motor
quer bitfield. As constantes estão em `ygo-data/data/constants.json` (41 delas só
de atributo e raça):

| Campo | Valor para Monstro Normal |
|---|---|
| `type` | `TYPE_MONSTER (0x1) \| TYPE_NORMAL (0x10)` = **0x11** |
| `attribute` | `ATTRIBUTE_EARTH`=1, `WATER`=2, `FIRE`=4, `WIND`=8, `LIGHT`=16, `DARK`=32 |
| `race` | ver `RACE_*` em `constants.json` |
| `level` | o nível cru em `& 0xff` (as escalas de Pêndulo ocupam os bits altos) |
| `atk`/`def` | número normal; **`-2` significa "?"**, não zero |
| `alias` | **0** — `alias != 0` é arte alternativa, e o motor trata como outra carta |

**Comece só por Monstro Normal.** Magia e armadilha, mesmo "sem efeito", precisam
de script para fazer qualquer coisa — uma magia sem Lua é uma carta que você
ativa e nada acontece. Monstro Normal é o único tipo que é completo sem script.

**Como saber que funcionou:** o log do servidor **para de imprimir**
`"A carta X nao existe no cards.cdb!"`. Em campo: a carta invoca, tem o ATK que
você cadastrou, ataca, e morre para um ATK maior. Vale escrever um
`--test-custom` no molde do `TestSummons.cs`, que joga de verdade e confere o
resultado — é assim que as outras funcionalidades do duelo são testadas.

**Custo:** esta é a etapa que muda o jogo. Ainda assim é modesta: um dicionário,
um campo no JSON e uma tabela de conversão.

---

## Etapa 2 — cadastrar pela tela, não só importar

Hoje a entrada de carta é o import do *card maker* (`parseCardmaker`), que traz
nome, arte e stats mas não a lógica. Para cadastrar em série você quer um
formulário próprio: nome, atributo, raça, nível, ATK, DEF, arte — com **Monstro
Normal como padrão**, porque é o tipo que funciona inteiro.

O `customcards.js` já tem as peças: `buildCard`, `saveCustom`, `RACES`,
`ATTRIBUTES`, `MONSTER_KINDS` e o `renderFramedCard` que desenha a moldura.
Falta a tela. O `booster.html` é um bom molde de página de cadastro.

Nesta etapa vale marcar na interface **quais tipos entram em duelo** — depois da
Etapa 1, um Monstro Normal seu joga; uma magia sua ainda não faz nada. A dica
atual (`"carta customizada — sem efeito em duelo"`, `builder.js:184`) fica
imprecisa e merece virar algo por tipo.

---

## Etapa 3 — a carta vira conteúdo do jogo

Com a carta jogável, ela pode entrar na economia que já existe: aparecer em
booster com raridade (`boosters.js`), cair na coleção do jogador (`wallet.js`),
ser a carta-assinatura que um NPC dropa (`decks/npc/<id>/*.ydk`, campo
`#signature`).

Boa parte disso já funciona — o `builder.js` e o `boosterbuilder.js` já importam
`listCustom`. É mais conferir e ajustar do que construir.

---

## Fusões — exemplo trabalhado (FEITO)

> Esta seção documenta uma etapa **já implementada**, como modelo para você
> repetir o raciocínio em Sincro/Xyz/Link. O teste é `--test-fusion`.

### A descoberta: você não escreve Lua nenhum

A intuição natural é "a Polymerization precisa saber quais são as matérias".
Está invertido. Abra os dois scripts oficiais:

```lua
-- scripts/official/c24094653.lua  (Polymerization)
function s.initial_effect(c)
	Fusion.RegisterSummonEff(c)          -- gancho genérico. Só isso.
end

-- scripts/official/c66889139.lua  (Gaia the Dragon Champion)
function s.initial_effect(c)
	c:EnableReviveLimit()
	Fusion.AddProcMix(c,true,true,6368038,28279543)
	--                            ^Gaia Nv7  ^Curse of Dragon
end
```

**A receita mora na carta fundida, não na Poly.** A Poly é um gancho genérico
que pergunta ao motor "alguma fusão é possível com o que está aí?". Cada monstro
de fusão responde por si.

Consequência prática: as duas cartas já vêm do ocgcore com script pronto, então
**não há Lua a escrever** — nem para a Poly, nem para as fusões. O que faltava
era mecânico.

### O que realmente faltava: o Extra Deck

`DuelSession.InjectDeck` mandava tudo para `loc = 1` (LOCATION_DECK). Não existia
Extra Deck. Uma fusão colocada no deck seria embaralhada no Main e **comprada
como carta comum** — o sintoma é "botei a fusão no deck e ela nunca aparece para
invocar".

O que foi mexido, nesta ordem:

| Onde | O quê |
|---|---|
| `DuelSession.cs` | `InjectExtra()` — mesma injeção, `loc = 0x40` (LOCATION_EXTRA). Não embaralha: o Extra é aberto |
| `InteractiveDuel.cs` | construtor recebe `extra` / `npcExtra` e repassa |
| `WebServer.cs` | `/start` lê `extra` e `npcExtra` do corpo |
| `web/duel.html` | manda `deck.extra` junto (antes mandava só `deck.main`) |
| `web/js/lista1.js` | Poly na lista de magias + fusões vanilla em `inLista1` |

### O detalhe que prova o argumento

No log do `--test-fusion`:

```
[WARN] [ScriptManager] Script nao encontrado: c6368038.lua
[WARN] [ScriptManager] Script nao encontrado: c28279543.lua
  > Polymerization ativavel: o motor achou uma fusao possivel
  > selectunselect: 3 opcoes [28279543,28279543,6368038]
  > Gaia the Dragon Champion entrou em campo (veio de loc 0x40)
```

As **duas matérias não têm script** (são monstros Normais) e a fusão sai mesmo
assim. O aviso é esperado, não é erro.

Repare também no `selectunselect`: o motor ofereceu as 3 cartas elegíveis e foi
perguntando uma a uma. Quem valida a receita é ele — o host só devolve o que foi
oferecido. **Não implemente validação de matéria do lado de fora**; seria
duplicar regra e errar.

### E as outras 57?

Não há "as outras". A regra em `inLista1` é por **formato**, não por lista:

```js
return card.tl === 'Normal Monster' || card.tl === 'Fusion Monster';
```

`'Fusion Monster'` sem `/Effect` é exatamente a fusão vanilla. São **58 cartas,
todas com script** (conferido contra a pasta de scripts) — entre elas o Black
Skull Dragon (Red-Eyes + Summoned Skull), que serve ao Joey.

Se um dia quiser **curar** em vez de liberar tudo, troque a regra por um `Set`
de ids, como já é feito com as magias. A decisão é de design, não técnica.

### O mesmo raciocínio para Sincro/Xyz/Link

O caminho é idêntico e o Extra Deck já está pronto. O que muda:

- **Sincro** precisa de Tuner (é um subtipo de monstro, `TYPE_TUNER`), e a
  receita está no Lua do Sincro, como na fusão
- **Xyz** empilha materiais em `LOCATION_OVERLAY` (0x80) — o front precisaria
  desenhar a pilha embaixo do monstro
- **Link** usa marcadores, e lembre que em Link o campo `def` guarda os
  *link markers*, não a defesa (ver `ygo-data/README.md`)

Nos três, a invocação vem pela lista **spsummon** do `SELECT_IDLECMD` — que hoje
é **lida e descartada** em `InteractiveDuel.cs:608` (a leitura existe só para
manter o alinhamento dos bytes). Expor essa lista como `q.spsummonable` é o
próximo passo natural, e é ela que a fusão por Poly **não** usa: a Poly entra
pela lista de `activate`, que já é exposta. Foi por isso que Gaia funcionou sem
tocar nesse ponto.

---

## Aula: como se escreve uma carta de BUSCA

> Aprendida comparando duas cartas oficiais que já estão no projeto. Se for
> escrever Lua um dia, comece por aqui — busca é a família mais fácil.

### As duas cartas são o MESMO arquivo

Ponha lado a lado a Fusion Sage e a Reinforcement of the Army:

```lua
-- c26902560.lua (Fusion Sage)          -- c32807846.lua (ROTA)
function s.initial_effect(c)            function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)         local e1=Effect.CreateEffect(c)
  e1:SetCategory(CATEGORY_TOHAND          e1:SetCategory(CATEGORY_TOHAND
                +CATEGORY_SEARCH)                       +CATEGORY_SEARCH)
  e1:SetType(EFFECT_TYPE_ACTIVATE)        e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetCode(EVENT_FREE_CHAIN)            e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetTarget(s.target)                  e1:SetTarget(s.target)
  e1:SetOperation(s.activate)             e1:SetOperation(s.activate)
  c:RegisterEffect(e1)                    c:RegisterEffect(e1)
end                                     end
```

Idênticos. `target` e `activate` também. **A diferença inteira entre as duas
cartas é uma linha:**

```lua
-- Fusion Sage: busca por NOME
function s.filter(c)
  return c:IsCode(CARD_POLYMERIZATION) and c:IsAbleToHand()
end

-- ROTA: busca por CARACTERÍSTICA
function s.filter(c)
  return c:IsLevelBelow(4) and c:IsRace(RACE_WARRIOR) and c:IsAbleToHand()
end
```

### O que cada parte faz

| Parte | Papel |
|---|---|
| `SetCategory(TOHAND+SEARCH)` | dica para IA e para o motor: "isto busca" |
| `SetType(EFFECT_TYPE_ACTIVATE)` | é a ativação de uma magia (não ignição de monstro) |
| `SetCode(EVENT_FREE_CHAIN)` | pode ser ativada a qualquer momento em que magia possa |
| `s.target` com `chk==0` | **a condição**: só oferece a carta se houver alvo no deck |
| `s.activate` | **o efeito**: escolhe e move para a mão |
| `s.filter` | **o que muda de carta para carta** |

O `chk==0` é a parte que importa entender: é ele que faz a carta aparecer (ou
não) na lista de ativáveis. Sem alvo no deck, a magia nem é oferecida — e é por
isso que o host nunca precisa validar nada.

### Receita para uma busca customizada

1. Copie `ygo-data/data/scripts/official/c32807846.lua`
2. Renomeie para `c<seu id>.lua` (a faixa customizada começa em 900000000)
3. Troque **só** o `s.filter`
4. Deixe o resto intacto

Predicados úteis no filtro: `IsCode(id)`, `IsRace(RACE_*)`, `IsAttribute(ATTRIBUTE_*)`,
`IsLevelBelow(n)`, `IsType(TYPE_*)`, `IsSetCard(arquétipo)`. Combine com `and`.

> **Antes de escrever, procure.** A ROTA parecia carta a criar e já existia
> pronta, com script. São 12.702 scripts oficiais no repositório; `db.search()`
> do `ygodb.js` acha por nome. Escrever Lua é o último recurso, não o primeiro.

### Do lado do NPC

Toda busca deve entrar no `BUSCA_ESPECIFICA` do `NpcBrain.cs`. É o conjunto que
faz o NPC buscar **antes** de comprar — comprar primeiro pode trazer a carta que
a busca traria, e aí a busca vira carta morta.

---

## Etapa 4 — efeitos (o Lua de verdade)

Só aqui entra o custo alto, e por isso é a última.

Ordem sugerida, do mais fácil ao mais difícil:

1. **Ganho fixo de ATK/DEF contínuo** — o efeito mais simples que existe em Lua
2. **Destruir algo ao ser invocado** — envolve alvo
3. **Comprar carta** — mexe com o baralho
4. Qualquer coisa com corrente, custo ou condição

**Não escreva do zero.** Ache uma carta oficial que faz o que você quer, abra o
script dela em `ygo-data/data/scripts/official/c<id>.lua` e adapte. São 12.702
exemplos prontos e funcionando; o `scriptPath()` do `ygodb.js` acha o arquivo
pelo id.

**O que já custou caro e está resolvido:** o `constant.lua` e o `utility.lua`
precisam ser pré-carregados à mão — a DLL não os pede pelo callback, e sem eles
os efeitos falham ao se registrar (a carta fica setável mas nunca ativável). O
`DuelSession.cs` já faz isso. Está no `DUEL-TRAINING-HANDOFF.md`, seção 4,
"Descobertas-chave".

---

## Se for fazer só uma coisa

**Etapa 1.** A 0 protege o trabalho e a 2 o torna agradável, mas é a 1 que
transforma "desenho de carta guardado no navegador" em "carta que entra em campo
e bate". E ela é bem menor do que parece: o motor já sabe lidar com monstro sem
script — só nunca recebeu os dados da sua carta.
