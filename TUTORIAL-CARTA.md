# Tutorial — pôr uma carta para funcionar no projeto

> Passo a passo para fazer sozinho. O exercício do fim é **The Warrior Returning
> Alive**; as respostas não estão aqui de propósito.

## Primeiro, desfaça o modelo mental errado

Você está procurando por "criar arquivo → inserir bloco → chamar em algum
lugar". **Para carta oficial esse fluxo não existe** — e é por isso que você não
achava por onde começar.

O que acontece quando o duel-server sobe:

```
[ScriptManager] Mapeando arquivos em: .../StreamingAssets/YGODemo/script
[ScriptManager] 20945 scripts mapeados com sucesso.
```

Os 20.945 `.lua` já foram indexados **por nome de arquivo**. Quando uma carta
entra no duelo, o motor pede `c<id>.lua` pelo callback e o `ScriptManager` acha
sozinho (`ScriptManager.cs:74`). Não há nada a criar nem a registrar.

Ou seja: **o efeito da ROTA já estava funcionando antes de você mexer em
qualquer coisa.** O que faltava não era o efeito — era a carta estar
*disponível* para você montar um deck com ela.

O projeto não implementa efeito. O projeto decide **quais cartas existem no
jogo**. São coisas diferentes, e essa é a virada de chave.

---

## Os passos

### Passo 1 — achar o id

O nome no jogo é sempre em inglês. Use o `ygodb`:

```bash
node -e "
const {YgoDB} = await import('./ygo-data/src/ygodb.js');
const db = await YgoDB.loadFromDisk('./ygo-data/data');
console.log(db.search('warrior returning', {limit:5}));
"
```

Ou, mais direto, um grep no índice por nome. Anote o **id da carta canônica**:
se aparecerem várias com o mesmo nome, a boa é a de `alt: 0` — as outras são
artes alternativas e **não têm script**.

**Checkpoint:** você tem um número de 8 dígitos.

### Passo 2 — confirmar que ela tem script

```bash
ls ygo-data/data/scripts/official/c<ID>.lua
```

Existe? Então o efeito está pronto e você não vai escrever Lua nenhum.

Não existe? Duas possibilidades: ou é monstro Normal (correto, não tem efeito),
ou você pegou o id de uma arte alternativa — volte ao passo 1.

**Checkpoint:** o arquivo existe, e abrir ele mostra o efeito que você espera.

### Passo 3 — deixar a carta aparecer no Deck Builder

Este é o único passo obrigatório, e é **uma linha**.

Abra `web/js/lista1.js`. Perto do fim está a regra que decide o que entra no
pool:

```js
export function inLista1(card) {
  if (SET.has(card.id)) return true;
  ...
}
```

Monstro Normal e Fusão vanilla entram por formato. Qualquer outra carta precisa
estar no `LISTA1_SPELLTRAP`, que é a lista de ids no topo do arquivo. Acrescente
o seu id na seção que fizer sentido, com um comentário dizendo o que a carta faz.

**Checkpoint:** `npm run dev`, abra o Deck Builder, ligue o filtro "Lista 1" e
procure a carta pelo nome. Ela tem de aparecer.

> Se não aparecer: confira o id (erro de digitação é o motivo em 9 de 10 vezes)
> e recarregue a página — o navegador guarda o `.js` antigo.

### Passo 4 — jogar com ela

Monte um deck com a carta, salve, e abra o Treino de Duelo. Ative a carta e veja
o efeito acontecer.

**Checkpoint:** o efeito aconteceu na tela e apareceu no log do duelo.

> O Deck Builder normal te dá 3 cópias de tudo. A restrição por coleção só vale
> no modo `?owned=1`, e mesmo lá carta sem raridade conta como farta
> (`availableCopies` em `builder.js:79`). Para o jogo "de verdade", coloque a
> carta num booster pelo Booster Builder — aí ela ganha raridade e precisa ser
> obtida na Loja.

### Passo 5 (opcional) — ensinar o NPC a usar

Sem isto a carta funciona para você, mas o adversário nunca a joga.

Em `duel-server/src/NpcBrain.cs` existem conjuntos por tipo de jogada:
`BURN`, `REMOCAO_MONSTRO`, `REMOCAO_ST`, `FUSAO`, `BUSCA_ESPECIFICA`,
`ALVO_ST_ABERTO`. Ache o que descreve a sua carta e acrescente o id.

Se nenhum servir, é regra nova no `Decide()` — e aí vale olhar como a regra da
fusão (5.1) ou a do Mago do Tempo (5.6) foram escritas.

```bash
npm run duel:build      # SEMPRE com o servidor parado; o script já derruba
```

**Checkpoint:** num duelo, o log mostra `🤖 NPC: activate — <seu motivo>`.

### Passo 6 (opcional) — travar com teste

Os testes vivem em `duel-server/src/Test*.cs` e cada um é uma flag do binário.
Copie o teste mais parecido, troque os ids, e registre a flag no `Program.cs`.

```bash
npm run duel:test
```

---

## Exercício: The Warrior Returning Alive

**Id: 95281259.** Magia Normal: "Escolha 1 monstro Guerreiro no seu Cemitério;
adicione-o à sua mão."

Escolhi ela porque é irmã da ROTA — mesma família, uma diferença importante:

| | ROTA | Warrior Returning Alive |
|---|---|---|
| filtro | `IsRace(RACE_WARRIOR)` + `IsLevelBelow(4)` | `IsRace(RACE_WARRIOR)` |
| **de onde** | `LOCATION_DECK` | `LOCATION_GRAVE` |

Faça os passos 1 a 4. Depois, se quiser, o 5 e o 6.

Três coisas para reparar enquanto testa:

1. **A carta só fica ativável se houver Guerreiro no seu cemitério.** Isso é o
   `chk==0` do script decidindo — o mesmo mecanismo que faz o Chamado dos
   Assombrados não aparecer com o cemitério vazio. Você não escreve essa
   condição em lugar nenhum.
2. **O caminho cemitério → mão** é o que consertamos no front há pouco. Se a
   carta sumir da pilha e não aparecer na mão, é regressão daquilo — e vale
   avisar.
3. **No passo 5**, ela é busca. Já existe conjunto pronto para isso.

### Se travar

| Sintoma | Onde olhar |
|---|---|
| não aparece no Deck Builder | id errado, ou falta recarregar a página |
| aparece mas não ativa | condição do script não atendida (falta alvo) |
| ativa e nada acontece | log do duel-server: `Script nao encontrado` = id de arte alternativa |
| some da tela | o front não trata o movimento; veja o `case 'move'` em `duel.html` |

---

## E quando a carta NÃO existir?

Aí sim entra "criar arquivo". Duas coisas precisam ser verdade, e hoje só uma
está pronta:

1. **O script** — você escreve `c<id>.lua` e põe em
   `duel_academy/Assets/StreamingAssets/YGODemo/script/`. O `ScriptManager`
   mapeia a pasta inteira no boot, então basta **reiniciar o servidor**. Isto
   funciona hoje.
2. **Os dados da carta** (tipo, ATK, DEF, nível, atributo) — hoje eles só saem
   do `cards.cdb`, e a sua carta não está lá. O motor recebe uma struct zerada e
   a carta não é nem monstro nem magia. **Isto ainda não funciona** — é a Etapa 1
   do `ROADMAP.md`.

Por isso o caminho honesto continua sendo: **procure antes de escrever.** São
12.702 scripts oficiais, e até agora toda carta que parecia precisar ser criada
já existia pronta — a fusão, o Chamado, o King of the Swamp e a ROTA.
