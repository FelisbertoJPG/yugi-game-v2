# Handoff — Servidor de Duelo & Treino (Frente 3 / W2)

> Documento pra uma sessão nova do Claude Code (possivelmente em outra máquina)
> continuar o trabalho do **duelo jogável**. Autocontido: não depende de memória
> de sessão. Complementa o `continue.md` (que é local/gitignored e cobre o resto
> do projeto: Deck Builder, ygo-data, NPCs, cartas customizadas, Lista 1).

## 1. O que é

Mini-RPG de Yu-Gi-Oh com duelo **fiel às regras** (o motor é o `ocgcore` + os
scripts Lua oficiais). O duelo roda num **servidor C# (.NET 8)** que expõe o motor
via HTTP local; o front web (`web/duel.html`) desenha o estado e manda as jogadas.
Não existe IA — o oponente no treino fica **desligado** (auto-passa o turno). O
objetivo do "treino" é (a) validar a mecânica e (b) **gravar as jogadas do jogador**
pra virar a "memória"/script dos NPCs depois.

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
2 lados, cemitério clicável, LP), traduz eventos→estado, mostra as ações da carta
selecionada (Invocar/Utilizar/Setar), e grava jogadas em `localStorage: ygo:plays`.

## 4. Protocolo ocgcore (edo9300, DLL 11.0) — DECIFRADO empiricamente

Buffer de `OCG_DuelGetMessage`: sequência de `[int32 len][byte type][payload]`.
`OCG_DuelProcess` retorna 0=END, 1=AWAITING, 2=CONTINUE.

**SELECT_IDLECMD (11):** `type(1) player(1)` + **6 listas** nesta ordem:
summon, spsummon, **reposition**, mset (set monstro), sset (set magia/arm), activate.
Depois **3 bytes de flag** (to_bp, to_ep, shuffle).
- Entradas de mão (summon/spsummon/mset/sset) = **10 bytes**: `code(4) ctrl(1) loc(1) seq(4)`.
- Entradas de **reposition = 7 bytes** (`seq` de 1 byte, é carta no campo) ⚠️ (bug já
  corrigido — ler repos como 10 desalinhava tudo do turno 3 em diante).
- Entradas de **activate = 18 bytes** (as de 10 + `description(8)`).
- Resposta = **int32 `(índice << 16) | comando`**: 0=Normal Summon, 3=set monstro,
  4=set magia/arm, 5=ativar, **7=encerrar turno**, 6=ir pra Battle (provável).

**SELECT_PLACE (18):** `player(1) count(1) flag(4)`. No flag, bits 0-4 = zonas de
monstro proibidas, **bits 8-12 = zonas de magia/armadilha**. Zona de campo = SZONE
`seq=5`. Resposta = **3 bytes** `[player, location, sequence]` (loc 0x4=MZONE, 0x8=SZONE).

**SELECT_CHAIN (16):** resposta `int32 -1` (não encadear).
**SELECT_POSITION (19):** resposta `int32 posição` (POS_FACEUP_ATTACK=0x1).
**MSG_MOVE (50):** `code(4)` + prev`{ctrl(1)loc(1)seq(4)pos(4)}` + curr`{...}` + reason(4)`.
**MSG_DRAW (90):** `player(1) count(4)` + por carta `code(4) status(4)` (bit 0x80000000=oculta).
**MSG_DAMAGE(91)/RECOVER(92)/PAY_LPCOST(100):** `player(1) amount(4)`. LP começa 8000.
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
- **Gravar jogada** (`ygo:plays`): turno, mão, mão/campo do oponente, sequência de ações.

## 6. O que FALTA / bugs conhecidos (prioridade)

1. **Battle Phase / atacar / dano de batalha (W3)** — o grande passo. Precisa: ir
   pra Battle (idle cmd 6, confirmar), `SELECT_BATTLECMD (10)` (escolher atacante,
   formato a decifrar), `MSG_ATTACK`, resolução de dano (o LP já é rastreado), e
   `MSG_WIN` (achar o id) → tela de vitória.
2. **Invocação com TRIBUTO (`SELECT_TRIBUTE`, msg 20)** — hoje cai em "ação não
   suportada". Precisa parsear (parecido com SELECT_CARD) e uma UI de escolha de
   tributo (ou auto p/ oponente). **O formato de resposta do `SELECT_CARD (15)` NÃO
   foi decifrado** (8 formatos testados, todos RETRY) — usar o `--selfplay` pra sondar;
   provavelmente o mesmo formato serve pro TRIBUTE e pro descarte.
3. **Descarte por limite de mão do oponente** — contornado com NO_HAND_LIMIT. Se
   quiser o descarte "de verdade", depende de achar o formato do SELECT_CARD acima.
4. **`SELECT_YESNO/EFFECTYN/OPTION` (12/13/14)** — hoje "não suportado"; quando
   aparecer (efeitos opcionais/alvos), tratar.
5. **Ativar magia/armadilha JÁ SETADA no campo** (hoje só ativa da mão) e cartas com
   **alvo** (`SELECT_CARD` de alvo) — mesmo bloqueio do formato do SELECT_CARD.
6. **Usar as jogadas gravadas (`ygo:plays`) como script de IA dos NPCs** — o objetivo
   final do treino. Ainda não começado.
7. **Cartas customizadas do usuário** (Kuriboh etc.) — precisam de Lua manual
   (Estágio 2, ver `continue.md`); as cartas da **Lista 1** são reais e já funcionam.

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
