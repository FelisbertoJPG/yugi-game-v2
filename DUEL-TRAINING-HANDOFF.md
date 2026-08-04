# Handoff — Servidor de Duelo & Treino (Frente 3 / W2)

> Documento pra uma sessão nova do Claude Code (possivelmente em outra máquina)
> continuar o trabalho do **duelo jogável**. Autocontido: não depende de memória
> de sessão. Complementa o `continue.md` (que é local/gitignored e cobre o resto
> do projeto: Deck Builder, ygo-data, NPCs, cartas customizadas, Lista 1).

## 1. O que é

Mini-RPG de Yu-Gi-Oh com duelo **fiel às regras** (o motor é o `ocgcore` + os
scripts Lua oficiais). O duelo roda num **servidor C# (.NET 8)** que expõe o motor
via HTTP local; o front web (`web/duel.html`) desenha o estado e manda as jogadas.
O objetivo do "treino" é **validar a mecânica** — jogar contra o motor e ver o que
quebra.

> A IA dos NPCs é escrita **só em código**, no `NpcBrain.cs`, como regras
> explícitas. Houve um plano de gravar as jogadas do jogador (`localStorage:
> ygo:plays`) pra virar "memória" do NPC; foi **descartado**, e o botão "salvar
> jogada" saiu do `duel.html`. Não reintroduza.

## 1.1. NPC do Teste de Batalha

O oponente **joga** (`web/js/`… não: `duel-server/src/NpcBrain.cs`). Regras, em
ordem de prioridade — são exatamente as especificadas, nada além:

1. **Pote da Ganância antes de tudo.** Se dá para ativar, ativa antes de invocar.
2. **Nível maior tem precedência.** Se dá para invocar com tributo, é essa a jogada.
3. **Statline da própria carta decide o modo.** Só vai para ataque quem tem
   **ATK > DEF**. Um 1200/2000 é parede: mesmo podendo vencer o que está em campo,
   rende mais setado do que atacando.
4. **Depois, o campo.** Se a ameaça do oponente supera o melhor *atacante*
   disponível, seta o de maior DEF em vez de entregar o monstro.
5. Sem jogada possível, encerra o turno.

A ordem das duas comparações importa: **primeiro o statline da carta, depois o
campo**. É o que faz o NPC setar um Aqua Madoor (1200/2000) contra um 1100 em vez
de invocá-lo em ataque — ele venceria a batalha, mas 2000 de defesa segura muito
mais do que 1200 de ataque.

Detalhes que importam:
- **"Pôr em defesa" = Set.** Pelas regras oficiais a Invocação Normal é sempre em
  ataque com a face para cima; a única forma legal de pôr um monstro em defesa no
  próprio turno é setá-lo. Por isso as regras de defesa viram `setmonster`.
- O NPC só enxerga monstros **com a face para cima** (`FaceUpMonsters`) — ele não
  lê o ATK de uma carta setada, que não teria como conhecer.
- Cada jogada vira um evento `{type:"npc", action, why}`, que o front mostra no
  log com o motivo. É assim que se confere se ele está seguindo as regras.
- `POST /start {"npc": false}` volta ao oponente desligado (auto-passa), que é o
  modo de treinar sozinho.

Teste: `npm run duel:test` (ou `duel-server.exe --test-npc`) — 15 checagens, sendo
11 da decisão isolada (cada regra em situação controlada, incluindo o caso da
parede que venceria atacando) e 4 de um duelo real onde o NPC usa os Potes,
invoca por ATK, faz invocação com tributo e seta em defesa quando ameaçado.

> **Compile com o servidor parado.** O `.exe` fica travado enquanto roda e o
> `dotnet build` falha — mas o teste seguinte roda o binário ANTIGO e parece que
> a mudança não funcionou. Use `npm run duel:build` / `npm run duel:test`, que
> derrubam o servidor antes. Pelo mesmo motivo o launcher agora escolhe o build
> **mais recente** (antes preferia Release, e subia um binário de horas atrás) e
> imprime a data do que subiu.

## 2. Como rodar

**Atalho (Windows):** duplo clique em `duel-academy.exe` na raiz — sobe os dois
servidores, confere 200 OK em cada um, abre a página e fecha sozinho.
`duel-academy-stop.exe` encerra tudo de forma limpa. Se os exes não existirem,
`npm run launcher:build`. Fonte em `launcher/` (um `Program.cs` gera os dois).

Na mão:
```bash
# 1) front estático (raiz do repo)
npm run dev                       # http://localhost:8080

# 2) servidor de duelo (noutro terminal)
cd duel-server
dotnet run -- --serve             # http://localhost:8770

# abrir: http://localhost:8080/web/duel.html  (ou Home → opção 5 "Treino de duelo")
```
Requisitos: .NET SDK 8, Node >=18, **Windows x64** (a `ocgcore.dll`/`sqlite3.dll` são
nativas Win-x64, ficam em `duel-server/native/`).

**Encerramento limpo:** `POST /shutdown` no duel-server (libera a memória nativa do
ocgcore via `Dispose` antes de sair) e `POST /__shutdown` no front (só aceita de
localhost). É o que o `duel-academy-stop.exe` usa; o kill por PID é só o último
recurso, se o servidor não responder em 8s.

Modos do exe: sem args = demo no console; `--serve` = servidor web; `--selfplay` =
harness de diagnóstico que joga sozinho e despeja as mensagens do motor (foi assim
que o protocolo abaixo foi decifrado — use pra achar novos formatos).

## 3. Arquitetura

**C# (`duel-server/src/`):**
- `YgoCoreAPI.cs` — P/Invoke da `ocgcore.dll` (edo9300).
- `DatabaseManager.cs` — lê `cards.cdb` (SQLite P/Invoke) no callback de carta.
- `ScriptManager.cs` — serve os `.lua` no callback; **e pré-carrega os globais**.
- `DuelSession.cs` — cria o duelo, **pré-carrega `constant.lua`+`utility.lua`**,
  **embaralha o deck** (o ocgcore NÃO embaralha), injeta, inicia. `Step()`/`Respond()`.
- `InteractiveDuel.cs` — **o coração**: `Advance()` dá passos até a SUA decisão,
  resolve o oponente (auto-passa) e as correntes (-1), e parseia as mensagens em
  eventos + a "pergunta pendente". `Respond(action,arg)` codifica a jogada.
- `WebServer.cs` — HttpListener, modelo **RPC**: `POST /start {deck,seed?,flags?}` e
  `POST /respond {action,arg}` → `{events:[...], question:{...}|null, ended}`.
  Default `flags = NO_HAND_LIMIT (0x1000000)`.
- `SelfPlay.cs` — harness de diagnóstico do protocolo.

**Web (`web/duel.html`):** carrega o deck escolhido, desenha o campo (zonas M/S/F dos
2 lados, cemitério clicável, LP), traduz eventos→estado e mostra as ações da carta
selecionada (Invocar/Utilizar/Setar).

## 4. Protocolo ocgcore (edo9300, DLL 11.0) — DECIFRADO empiricamente

Buffer de `OCG_DuelGetMessage`: sequência de `[int32 len][byte type][payload]`.
`OCG_DuelProcess` retorna 0=END, 1=AWAITING, 2=CONTINUE.

**SELECT_IDLECMD (11):** `type(1) player(1)` + **6 listas** nesta ordem:
summon, spsummon, **reposition**, mset (set monstro), sset (set magia/arm), activate.
Depois **3 bytes de flag** (to_bp, to_ep, shuffle).
- Resposta = `(índice << 16) | comando`. Comandos: **0** summon · **1** spsummon ·
  **2** mudar posição · **3** mset · **4** sset · **5** ativar · **6** ir pra Battle ·
  **7** End Phase. No `SELECT_BATTLECMD`: **0** atacar · **1** ativar · **2** ir pra
  Main 2 · **3** End Phase.
- Entradas de mão (summon/spsummon/mset/sset) = **10 bytes**: `code(4) ctrl(1) loc(1) seq(4)`.

> **As regras de "quando pode virar" são do motor, não nossas.** Um monstro
> invocado neste turno simplesmente não entra na lista `reposition`; uma
> armadilha baixada agora não entra em `activatable`, e uma magia normal entra.
> Basta desenhar o que o motor ofereceu — reimplementar isso do lado de fora
> seria duplicar regra e errar.
- Entradas de **reposition = 7 bytes** (`seq` de 1 byte, é carta no campo) ⚠️ (bug já
  corrigido — ler repos como 10 desalinhava tudo do turno 3 em diante).
- Entradas de **activate = 19 bytes**: `code(4) ctrl(1) loc(1) seq(4) description(8)
  client_mode(1)`. ⚠️ O `client_mode` é fácil de esquecer: com 18 bytes a lista
  desalinha a partir da **segunda** carta, e o sintoma é "só a primeira magia da mão
  pode ser ativada" — sem erro nenhum. Confirmado na fonte e medido com `--probe-idle`.

> **Como medir isso sem chutar:** a mensagem termina em 3 bytes de flag, então o
> cursor tem de parar exatamente em `fim - 3`. `--probe-idle` testa as combinações
> de tamanho e diz qual fecha a conta; ele só é conclusivo quando as listas em
> questão não estão vazias (por isso ele joga, em vez de só passar o turno).
> O `ParseIdle` agora faz essa verificação sozinho e grita no log se desalinhar.
- Resposta = **int32 `(índice << 16) | comando`**: 0=Normal Summon, 3=set monstro,
  4=set magia/arm, 5=ativar, **7=encerrar turno**, 6=ir pra Battle (provável).

**SELECT_PLACE (18):** `player(1) count(1) flag(4)`. No flag, bits 0-4 = zonas de
monstro proibidas, **bits 8-12 = zonas de magia/armadilha**. Zona de campo = SZONE
`seq=5`. Resposta = **3 bytes** `[player, location, sequence]` (loc 0x4=MZONE, 0x8=SZONE).

**Seleção de cartas — SELECT_CARD (15), SELECT_TRIBUTE (20), SELECT_SUM (23):**
resposta `[int32 tipo][uint32 quantidade][índices…]`.
`tipo` 0 = índices uint32, 1 = uint16, 2 = uint8, 3 = bitfield, **-1 = cancelar**.
> **O prefixo de tipo era o que faltava.** Sem ele o motor devolve MSG_RETRY para
> qualquer buffer, por mais correto que o resto pareça — foi por isso que as 8
> tentativas anteriores (e mais 30 minhas) falharam. Fonte: `parse_response_cards`
> em `playerop.cpp` do edo9300/ygopro-core. `returns.at<T>(i)` indexa por
> ELEMENTO, então os índices sempre começam no byte 8, seja qual for a largura.

Mensagem dos três: `type(1) player(1) cancelable(1) min(4) max(4) count(4)` +
entradas. Entrada = 10 bytes no SELECT_CARD, **11** no SELECT_TRIBUTE (o byte
extra é quantos tributos a carta vale), **14** no SELECT_CARD de alvo de ataque
(as 10 usuais + posição) e **18** no SELECT_SUM (`code(4) + info_location(10) +
sum_param(4)`). **Deduza o tamanho pelo comprimento da mensagem** em vez de
assumir — ele varia com o contexto, como a lista acima mostra.

**SELECT_UNSELECT_CARD (26):** o seletor incremental do core novo — é ele que o
tributo usa de fato. Escolhe-se UMA carta por vez e o motor repergunta.
Mensagem: `type(1) player(1) finishable(1) cancelable(1) min(4) max(4)` +
`count(4)`+entradas de **14 bytes** (selecionáveis) + `count(4)`+entradas (já
escolhidas, para desmarcar).
Resposta: **`[int32 1][int32 índice]`** — o primeiro campo tem que ser
**exatamente 1**; `0` ou `>1` devolve RETRY. `[int32 -1]` encerra/cancela.

**SELECT_SUM (23):** ritual. As cartas escolhidas têm de **somar exatamente** o
`acc` pedido (nível), descontando as obrigatórias. Precisa de subconjunto-soma,
não de escolha gulosa. Entrada da mensagem = 18 bytes (`code(4) +
info_location(10) + sum_param(4)`), e o `sum_param` é o nível que a carta soma.

Quem escolhe os tributos é o **jogador**: a pergunta vai para o front com o nível
de cada carta e um contador de "somados / alvo". Só resolvemos sozinho quando há
uma única combinação possível — aí perguntar seria uma etapa sem decisão.

**SELECT_BATTLECMD (10):** `type(1) player(1)` + lista de **ativáveis** (19 bytes,
igual ao idle) + lista de **atacantes** (**8 bytes**: `code(4) ctrl(1) loc(1)
seq(1) podeAtacarDireto(1)`) + **2 flags** (pode Main 2, pode End).
⚠️ Como a lista de ativáveis vem primeiro, **ativar é o comando 0 e ATACAR é o 1**
— o contrário do que a intuição sugere. Atacar com `0` dá RETRY silencioso.

Fluxo do ataque: `attack (índice<<16|1)` → o motor pede o **alvo** num
`SELECT_CARD (15)` (entradas de **14 bytes** aqui: as 10 usuais + posição) →
responde-se com o formato normal de seleção → o combate resolve.

**MSG_ATTACK (110):** atacante`{ctrl(1)loc(1)seq(4)pos(4)}` + alvo`{...}`.
**MSG_BATTLE (111):** por lado, `loc(10) atk(4) def(4) destruido(1)` = 19 bytes.
Traz ATK/DEF dos dois e quem morreu — o motor já resolveu tudo, isto é só relato.
Dano, destruição e ida ao cemitério vêm de graça (MSG_DAMAGE + MSG_MOVE).

**SELECT_CHAIN (16):** resposta `int32 -1` (não encadear).
**SELECT_POSITION (19):** resposta `int32 posição` (POS_FACEUP_ATTACK=0x1).
**MSG_MOVE (50):** `code(4)` + prev`{ctrl(1)loc(1)seq(4)pos(4)}` + curr`{...}` + reason(4)`.
**MSG_POS_CHANGE (53):** `code(4) ctrl(1) loc(1) seq(1) posAnterior(1) posAtual(1)`.
⚠️ O `seq` aqui tem **1 byte**, ao contrário do MSG_MOVE, onde tem 4. Mudança de
posição NÃO emite MSG_MOVE — sem tratar o 53, a carta vira no motor e não na tela.
Medido com `--probe-pos`.
**MSG_DRAW (90):** `player(1) count(4)` + por carta `code(4) status(4)` (bit 0x80000000=oculta).
**MSG_DAMAGE(91)/RECOVER(92)/PAY_LPCOST(100):** `player(1) amount(4)`. LP começa 8000.
**MSG_TOSS_COIN (115):** `player(1) count(1) res(count bytes)` (1 = Cara / Heads, 0 = Coroa / Tails). Emitido em efeitos como o Mago do Tempo.
**MSG_TOSS_DICE (116):** `player(1) count(1) res(count bytes)` (resultados de 1 a 6).
NEW_TURN=40, NEW_PHASE=41 (int16), SUMMONING=60, SUMMONED=61.

**Constantes (`.../YGODemo/script/constant.lua`):** LOCATION_MZONE=0x4, SZONE=0x8,
HAND=0x2, GRAVE=0x10, FZONE=0x100; POS_FACEUP_ATTACK=0x1, FACEDOWN_DEFENSE=0x8;
PHASE_MAIN1=0x4, BATTLE=0x80, END=0x200.

### Descobertas-chave (não óbvias, custaram caro)
1. **Efeitos só funcionam se pré-carregar `constant.lua` e `utility.lua`** — a DLL
   NÃO os pede pelo callback; sem eles `aux`/constantes ficam nil e os efeitos das
   cartas falham ao se registrar (a carta fica só *setável*, nunca *ativável*).
2. **O ocgcore não embaralha o deck** — a seed não muda a mão. Embaralhamos nós.
3. **RNG usa 4 seeds** (seed0..3) — derivadas via splitmix64.
4. **Deck de teste precisa de monstros Nv≤4** (Nv5+ exige tributo → nada invocável
   no turno 1). Vanilla Nv4: Battle Ox 5053103, Mystical Elf 15025844, La Jinn 97590747.

## 5. O que FUNCIONA (validado)

- Criar duelo com o deck do jogador, **mão aleatória** por partida.
- **Invocar** monstro (clicar carta → Invocar → escolher zona), regra "1 summon/turno"
  aplicada pelo motor.
- **Setar** monstro (deita, horizontal) e magia/armadilha (em pé, vertical).
- **Utilizar** magia da mão quando a condição está OK (o motor decide) → resolve o
  efeito. Ex.: **Pot of Greed compra 2**, **Tremendous Fire tira 1000/500 de LP**.
- **Zona de campo**, **cemitério** (pilha clicável mostrando as cartas).
- **LP** dos dois lados (8000 → atualiza no dano; log diz quem venceu).
- **Turnos rodam sem travar** (NO_HAND_LIMIT evita o descarte por limite de mão).
- **Parse correto do turno 3+** (bug do reposition 7-byte corrigido).
- Erros de JS agora aparecem numa barra vermelha (não trava mais em silêncio).

## 6. O que FALTA / bugs conhecidos (prioridade)

1. **Replicar a batalha para o NPC** — hoje ele invoca e defende, mas nunca ataca.
   A decisão vai no `NpcBrain`, na mesma forma das outras regras.
2. **Tela de vitória** — falta achar o id do `MSG_WIN`; hoje o fim é detectado
   pelo status END e o vencedor é inferido pelos LP.
3. **`SELECT_YESNO/EFFECTYN/OPTION` (12/13/14)** — hoje "não suportado"; quando
   aparecer (efeitos opcionais), tratar.
4. **Ativar magia/armadilha JÁ SETADA no campo** (hoje só ativa da mão).
5. **Cartas customizadas do usuário** (Kuriboh etc.) — precisam de Lua manual
   (Estágio 2, ver `continue.md`); as cartas da **Lista 1** são reais e já funcionam.

### Resolvido (era o item 2 e 3 desta lista)

**Invocação por TRIBUTO e RITUAL funcionam.** O bloqueio era o formato de resposta
da seleção de cartas, agora decifrado (seção 4) a partir da fonte do ocgcore em vez
de tentativa e erro. Com isso vieram juntos o descarte por limite de mão e a base
para cartas com alvo — todos usam o mesmo `parse_response_cards`.

Teste de aceitação: `duel-server.exe --test-summons` (6 checagens; joga de verdade
pelo `InteractiveDuel`, confirma que os tributos vão ao cemitério e que o monstro
entra em campo). As sondas `--probe-tribute` e `--brute-tribute` ficaram no
repositório para quando aparecer a próxima mensagem desconhecida.

> Lição: **força bruta contra biblioteca nativa não presta.** Depois de ~785
> respostas malformadas o ocgcore estourou com SEHException — ou seja, o estado
> dele já estava corrompido e os RETRYs anteriores não eram confiáveis. Ler a
> fonte resolveu em duas consultas o que a busca não resolveria nunca.

## 6.1. Onde os decks moram (mudou)

Decks agora são **arquivos `.ydk` em `decks/`**, versionados no git — não mais
localStorage. `decks/npc/<npcId>/*.ydk` para os adversários, `decks/player/*.ydk`
para os seus. Metadados nossos (nome, npc, carta que dropa) vão em comentários
`#chave valor`, que qualquer parser de `.ydk` ignora — o arquivo segue válido no
EDOPro.

A gravação é feita pelo servidor de desenvolvimento (`/__decks/save`, só
localhost, só `.ydk` dentro de `decks/`). Sem ele no ar, o Deck Builder baixa o
arquivo para você mover na mão. `web/js/projectdecks.js` é a camada cliente;
`web/js/npcs.js` hidrata um cache em memória com `loadNpcDecks()` no boot, para
os consumidores seguirem síncronos.

No `localStorage` restaram só preferências locais: qual deck de cada NPC está
ativo, e os decks do jogador em edição. Decks antigos que ficaram presos no
navegador aparecem na página de NPCs com um botão **"migrar para o projeto"**.

## 7. Onde mexer

- Novo tipo de pergunta do motor não tratado → aparece como "unsupported" no front.
  Rode `duel-server.exe --selfplay` (ou adicione o tipo ao dump em `SelfPlay.cs`),
  ache o formato de resposta, e trate em `InteractiveDuel.Parse()` + `Advance()`.
- A Lista 1 (pool jogável) está em `web/js/lista1.js`. Todas são cartas reais com
  script no ocgcore — funcionam sem Lua custom.
