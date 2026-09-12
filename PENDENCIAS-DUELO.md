# Pendências do duelo — bugs vistos em jogo

Fila de trabalho aberta em **30/08/2026**, a partir de uma sessão de teste real.
Cada item traz o relato como ele foi dito, o que já foi APURADO (com arquivo e
linha), o que ainda é hipótese, e o teste que decide. O par dele é o
`INSTALADOR-PENDENCIAS.md`: mesma ideia, outro assunto.

> A ordem é por **impacto em quem joga**, não por dificuldade.

---

## 1. ~~Magia de campo: só deixou SETAR, não ativar~~ ✅ FEITO (30/08/2026)

> **Era bug, e muito maior do que este item.** Nenhuma das duas hipóteses abaixo
> estava certa: a causa é que o motor **nunca recebeu os arquétipos das cartas**
> (`CardReaderCallback` mandava `setcodes = IntPtr.Zero`), então `Card.IsSetCard`
> respondia `false` para o jogo inteiro. A condição do Gateway to Chaos procura
> um Ritual do arquétipo "Black Luster Soldier" no deck — e nunca achava.
> A mesma linha destravou a **Super Soldier Synthesis**, que era um defeito em
> aberto. Coberto por `--test-campo` (3, com a magia de campo DELE injetada) e
> `--test-synthesis` (4, que era vermelho de propósito e ficou verde).
>
> **Fica aberto só o segundo defeito deste item**, que é de TELA e independe:
> a interface não diz **por que** uma carta não pode ser ativada. Continua
> valendo — foi ele que fez este relato chegar como "o campo dele bloqueou o
> meu", e vai fazer o próximo chegar torto do mesmo jeito.

**Relato:** *"tentei ativar o Gateway to Chaos enquanto o oponente tinha um
Mausoléu do Imperador no campo, e só foi permitido setar meu campo, não ativar."*

**O que já está apurado:**

- **não é a zona ocupada pelo oponente.** Cada lado tem a sua zona de campo:
  o `/start` não liga `DUEL_1_FACEUP_FIELD` (0x400) — os flags são
  `0x1000000` (`NO_HAND_LIMIT`) e mais nada (`WebServer.cs:571`). O
  `--test-fieldbonus` já prova que os dois campos convivem;
- **o Gateway to Chaos tem condição própria**, e ela é exigente
  (`ygo-data/data/scripts/official/c40089744.lua`):

  ```lua
  function s.target(...) if chk==0 then
      return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil) end
  -- s.filter: monstro RITUAL do arquétipo "Black Luster Soldier"
  --           OU monstro "Gaia the Fierce Knight", que possa ir para a MÃO
  ```

  Sem um desses **no DECK**, o motor não oferece a ativação — e o deck
  `Luster Soldier` leva 3 Black Luster Soldier: com os três já comprados, a
  condição cai sozinha. Mais `SetCountLimit(1,id,OATH)`: uma vez por turno.

**As duas hipóteses, e o teste que as separa:** montar o arnês de
`--test-synthesis` com o Gateway na mão e (a) um BLS ainda no deck, (b) nenhum.
Se (a) aparece em `activatable` e (b) não, a carta está certa e o caso está
encerrado; se nem (a) aparece, é bug do motor e vira tarefa própria.

**O defeito que existe DE QUALQUER JEITO — e que é o mais importante daqui:**
a tela oferece "setar" e não diz **por que** não dá para ativar. Hoje o jogador
não tem como distinguir *"esta carta está quebrada"* de *"esta carta ainda não
pode ser usada"*, e as duas se parecem exatamente com a mesma coisa. Isso vale
para toda carta, não só para esta — foi o que fez esta investigação começar do
lado errado, e é o que faz o jogador reportar bug onde não há.
*Tamanho: pequeno para o aviso na tela; a investigação é meia hora.*

---

## 2. ~~O NPC ataca o que não conhece, com um corpo de 0 de ATK~~ ✅ FEITO (30/08/2026)

> Fechado em `NpcBrain.DecideBattle` com o `PISO_ATAQUE_AS_CEGAS`, e coberto por
> `--test-cegas` (3 pares controle). O texto abaixo fica como registro do
> diagnóstico.

**Relato:** *"ele tentou me atacar com a Parede do Labirinto (0/3000) um monstro
meu em DEF face-down, sem ter ideia da defesa dele. Monstro abaixo de 500 de ATK
não devia atacar o que ele não conhece."*

**Mecanismo, achado:** `NpcBrain.DecideBattle` (`NpcBrain.cs:3309-3325`).

```csharp
var doOponente = MonstrosDele(foe);
...
if (doOponente.Count == 0)
    return new BattlePlay(true, maisForte.index,
        $"campo do oponente sem monstro — ataca com {maisForte.code}");
```

Para o NPC **iniciante**, `MonstrosDele` passa por `MonstrosHonestos`, que
**filtra as cartas viradas** (`.Where(m => (m.pos & POS_FACEUP) != 0)`). Então
um campo só com monstros SETADOS chega aqui como `Count == 0` — isto é,
**"campo vazio" e "campo que eu não consigo ler" são a mesma coisa para ele** —
e o ramo do campo vazio manda atacar, com a justificativa de dano de graça, que
ali não vale. O alvo é escolhido depois, e o único disponível é a carta virada.

O prejuízo é assimétrico e por isso o palpite é ruim: atacando um monstro em
defesa com ATK menor, quem ataca **não perde o corpo, mas leva a diferença como
dano** — 0 de ATK contra uma parede de 1500 de DEF são 1500 de dano de graça,
para o lado errado.

**Tarefa:** separar *campo vazio* de *campo ilegível*. O NPC iniciante sabe que
há alguma coisa ali (o próprio motor manda `canDirect = false`), então o ramo
tem de ser outro: contra alvo desconhecido, atacar só com corpo cujo ATK pague o
risco. O piso sugerido pelo relato (500) é um bom começo; melhor ainda é medi-lo
contra a DEF típica do que se seta.

**O par CONTROLE é obrigatório:** o MESMO campo com o monstro do jogador com a
face para CIMA — ali atacar continua sendo certo, e sem esse par "não atacou"
não prova critério nenhum. E o NPC **avançado** (que lê a carta virada pela DEF
real) não pode ser afetado: para ele a informação existe, e a regra atual está
certa. *Tamanho: pequeno-médio, com `--test-npc`/`--test-leitura` de guarda.*

---

## 3. ~~O NPC equipa um monstro e tributa ele em seguida~~ ✅ FEITO (30/08/2026)

> Fechado pela saída **(b)**, como recomendado: o preço do corpo
> (`ValorDoMeuCorpo`) passou a contar a carta que sai junto
> (`CUSTO_DA_CARTA_QUE_SAI_JUNTO`), então vale para todo atalho que cobra
> tributo — a invocação da regra 6, Tribute Doll, Metamorphosis, Monster Gate —
> sem reordenar nada. Coberto por `--test-cegas`, com o par controle do mesmo
> campo sem equipamento. O texto abaixo fica como registro.

**Relato:** *"o Wevil está equipando spell em monstros e tributando eles logo em
seguida — sendo que o ideal seria tributar e depois equipar no mais forte."*

**Mecanismo, achado — é a ORDEM das regras.** No `Decide` (`NpcBrain.cs`), a
fila é numerada e a numeração É o desempate:

| regra | linha | o que faz |
|---|---|---|
| 5.3 / 5.35 / **5.355** | 1336 / 1385 / **1411** | **equipa** (por id, do deck, e a genérica da mão) |
| **6.** | **2164** | *"Beatdown: monstros grandes (sacrificando os fracos)"* — **tributa** |

O equipamento sai **antes** da invocação por tributo, e a invocação escolhe o
corpo mais barato **pelo ATK** — que é justamente o que o equipamento acabou de
inflar ou não, sem ninguém perguntar. O reforço vai para o cemitério junto com o
corpo, e as duas cartas viram nada.

É a assinatura conhecida deste projeto: **duas respostas para a mesma pergunta**
("quanto vale este corpo?"), dadas em lugares que não se falam. O
`ValorDoMeuCorpo` já sabe que um **corpo condenado** (Instant/Ready Fusion) custa
zero — é o mesmo formato de conserto, com o sinal trocado: o corpo **equipado**
custa MAIS, porque leva o equipamento junto.

**Duas saídas, e elas não são equivalentes:**

- **(a) reordenar** — pôr o equipamento depois da regra 6. Resolve o caso do
  relato de vez e mexe na ordem, que é o desenho do cérebro: toda regra entre as
  duas passa a ver um campo diferente;
- **(b) fazer as duas concordarem** — o alvo de equipamento recusa um corpo que
  a invocação por tributo vai comer, e/ou o custo do tributo passa a contar o
  equipamento. Cirúrgico, e generaliza para os outros atalhos que cobram tributo
  (Tribute Doll, Metamorphosis, Monster Gate, Insect Imitation).

Recomendação: **(b)**, pelo mesmo motivo do corpo condenado — o problema não é
*quando* se equipa, é que a conta do preço está errada.
*Tamanho: médio. Guarda: `--test-weevil-npc` e `--test-alvos`.*

---

## O que estes três têm em comum

Nenhum deles dá erro. Em todos, o jogo faz uma coisa plausível e segue: um botão
que não aparece, um ataque que sai, um equipamento que some. É por isso que cada
tarefa acima só se dá por fechada com **par controle** — a mesma mesa, mudando
só o que a regra deveria olhar. Sem ele, "não atacou" e "não equipou" passam a
valer para uma regra que simplesmente parou de fazer as duas coisas.
