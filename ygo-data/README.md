# ygo-data — banco local de cartas e regras

Dataset offline extraído do **ygopro-core (edo9300)** que estava embutido no
projeto Unity `duel_academy`. Serve como camada de dados para uma aplicação web,
sem Unity, sem `ocgcore.dll` e sem SQLite no cliente.

Este pacote **não altera nada** dentro de `duel_academy/` — só lê.

```
13.728 cartas   ·   12.702 scripts Lua   ·   577 arquétipos nomeados
```

---

## Estrutura

```
ygo-data/
├── data/                      ← gerado por tools/build.py
│   ├── cards.json             13,8 MB  dataset completo decodificado
│   ├── cards.index.json        2,0 MB  índice enxuto (busca no browser)
│   ├── constants.json           33 KB  constantes do motor
│   ├── archetypes.json                 setcode → nome do arquétipo
│   ├── scripts.index.json              id da carta → caminho do .lua
│   ├── cards.cdb               6,6 MB  SQLite original, intocado
│   └── scripts/
│       ├── official/                   12.702 scripts de carta (c<id>.lua)
│       ├── core/                       24 utilitários (constant.lua, proc_*.lua…)
│       └── COPYING.txt                 licença dos scripts
├── src/
│   ├── ygodb.js               API de consulta (ESM, zero dependências)
│   └── decode.js              decodificadores de bitfield (se ler o .cdb cru)
├── tools/
│   ├── build.py               gerador (Python, só stdlib)
│   └── serve.mjs              servidor estático mínimo
└── examples/
    ├── node-demo.mjs          demo + checagens de sanidade
    └── web-demo.html          navegador de cartas (estilo retrô)
```

## Uso

```bash
npm run build     # regenera data/ a partir do projeto Unity
npm run demo      # roda o demo em Node
npm run serve     # http://localhost:8080/examples/web-demo.html
```

O `build.py` aponta por padrão para `../duel_academy/Assets/StreamingAssets/YGODemo`.
Para outra origem: `python tools/build.py --source <pasta> --out <pasta>`.

```js
import { YgoDB } from './src/ygodb.js';

const db = await YgoDB.load('/data');          // browser
const db = await YgoDB.loadFromDisk('./data'); // node

db.byName('Blue-Eyes White Dragon');   // carta canônica (ignora artes alternativas)
db.search('dark magi', { limit: 10 });
db.filter({ cardType: 'Monster', race: 'Dragon', attribute: 'LIGHT', levelMin: 8 });
db.archetype('Blue Eyes');
db.random(5, { cardType: 'Monster', levelMax: 4 });
db.scriptPath(83764718);               // scripts/official/c83764718.lua
YgoDB.artUrl(89631139);                // arte (vem do ygoprodeck, não do cdb)
```

Para não carregar os 13,8 MB: `YgoDB.load('/data', { full: false })` puxa só o índice.

---

## O formato dos dados (as pegadinhas)

O `cards.cdb` guarda quase tudo como **bitfield compactado**. O `build.py` já
decodifica tudo; esta seção existe para quem for ler o `.cdb` direto.

| Campo | Pegadinha |
|---|---|
| `type` | Bitfield. `0x1` Monster, `0x2` Spell, `0x4` Trap + subtipos. |
| `level` | Empacota 3 valores: nível em `& 0xff`, **lscale** em `>>24 & 0xff`, **rscale** em `>>16 & 0xff`. |
| `def` | Em monstros **Link**, guarda os *link markers*, não a defesa. Link não tem DEF. |
| `setcode` | Até 4 arquétipos de 16 bits empacotados num inteiro de 64 bits. |
| `atk`/`def` | `-2` significa **"?"** (ATK variável), não zero. 104 cartas usam isso. |
| `alias` | `!= 0` ⇒ o **NOME** desta carta é tratado como o da carta `alias`. 298 cartas, e elas se dividem em DOIS casos que não podem ser confundidos: **mesmo nome** da base (283) é só outra arte — esconda, senão a listagem duplica; **nome diferente** (15) é uma **carta distinta**, com efeito e Lua próprios, que apenas conta como o outro nome nas regras (Harpie Lady 1/2/3 e Cyber Harpie Lady → Harpie Lady; A Legendary Ocean → Umi; Fusion Substitute → Polymerization). Use `isAlternateArt` (ou `alt` no índice), que já faz essa distinção — **não** teste `alias != 0` na mão: era assim que as 15 sumiam do Deck Builder e do editor de listas. |
| `ot` | Legalidade: `0x1` OCG, `0x2` TCG. `3` = ambos. |
| `category` | Dicas de efeito para a IA. **Pouco confiável** — Monster Reborn aparece como `RECOVER`. Não use como regra. |

**Nem toda carta tem script Lua**, e isso é correto: monstros Normais (vanilla)
não têm efeito, logo não têm `.lua`. São 994 vanillas, das quais só 36 têm script.
No total, 12.582 das 13.728 cartas têm script.

As constantes **não são hardcoded no build**: saem de `script/constant.lua` e
`script/archetype_setcode_constants.lua`, que são a fonte de verdade do motor.
O `src/decode.js` tem uma cópia em JS — as duas implementações foram cruzadas
nas 13.728 cartas com **zero divergências**.

Idioma: **só inglês**. O `cards.cdb` não traz PT-BR; para traduzir seria preciso
uma fonte externa.

---

## Como isso se encaixa no mini RPG

O objetivo é um duelo **exato e fiel**. Vale ser explícito sobre o que isso implica:

> **As regras do Yu-Gi-Oh! *são* o `ocgcore` + os 12.702 scripts Lua.**
> Não existe caminho realista de reimplementar isso em JavaScript. Este banco
> local resolve os **dados** (cartas, textos, scripts); ele não é o motor de
> regras. Para um duelo fiel, o `ocgcore` precisa rodar em algum lugar.

Três caminhos para rodar o motor:

**A. Servidor .NET reaproveitando o código da Unity** — *o mais barato para vocês.*
`YgoCoreAPI.cs`, `DatabaseManager.cs`, `ScriptManager.cs` e `MessageParser.cs` já
funcionam e já foram depurados. Portados para um console app .NET 8 (basta trocar
`UnityEngine.Debug` por `Console`), viram um servidor de duelo com WebSocket.
O front web só desenha o estado. Menor risco, aproveita o que já existe.

**B. Node + FFI** — chamar a `ocgcore.dll` do Node via `koffi`. Stack única em JS,
mas é refazer do zero a camada de P/Invoke com callbacks, que é justamente a parte
chata que já está pronta no caminho A.

**C. ocgcore em WebAssembly** — compilar o core com Emscripten e rodar tudo no
browser, sem backend. Deploy estático em qualquer lugar. Mas exige o **código-fonte**
do ocgcore (o repositório só tem a DLL compilada), toolchain emsdk, e religar os
callbacks através do WASM. Mais trabalho inicial, melhor resultado final.

Em todos os casos a `ocgcore.dll` do repo é **Windows x64** — para hospedar em
Linux, é preciso recompilar o core para a plataforma alvo.

### O que falta além do motor

1. **Cobertura de mensagens.** O `MessageParser.cs` da Unity trata 6 tipos de
   mensagem. Um duelo completo precisa de ~50: `SELECT_CARD`, `SELECT_CHAIN`,
   `SELECT_OPTION`, `SELECT_POSITION`, `SELECT_BATTLECMD`, `SELECT_TRIBUTE`,
   `ATTACK`, `DAMAGE`, `WIN`… É trabalho mecânico, mas é o grosso do que falta.

2. **IA dos NPCs.** O `ocgcore` **não** inclui IA — ele só pergunta "o que você
   faz?". A IA do ygopro (*windbot*) é um projeto C# separado, com lógica por deck.
   Para 3 NPCs com decks fixos, uma heurística simples (invocar o maior monstro,
   atacar quando vantajoso, passar o turno) já entrega um oponente jogável.

3. **Curadoria das "cartas seletas".** É aqui que este banco entra direto: filtrar
   um pool com `db.filter(...)`, exigindo `hasScript: true` e evitando mecânicas
   pesadas (Pendulum/Link/Xyz) no começo. Um pool tipo *Goat Format* — só Normal,
   Effect, Fusion e Ritual — cobre um RPG inteiro e reduz muito a superfície de bugs.

4. **Camada de RPG.** Progressão, decks dos NPCs e recompensa por vitória são
   estado seu, fora do motor. O `ocgcore` só sabe duelar; quem guarda "o jogador
   ganhou a carta X do NPC Y" é a sua aplicação.

---

## Licença e proveniência

Os scripts Lua e o `cards.cdb` vêm do projeto **ygopro / ygopro-core (edo9300)** —
ver `data/scripts/COPYING.txt`. Yu-Gi-Oh! é marca registrada da Konami; isto é
material de fã, para uso não comercial. As artes das cartas **não** estão neste
banco: são carregadas sob demanda do ygoprodeck.com.
