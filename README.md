# yugi-game-v2

Projeto de um mini RPG de Yu-Gi-Oh! com duelo fiel às regras oficiais, usando o
motor **ygopro-core (edo9300)**. Front web em estilo retrô de jogo de navegador.

## Como rodar

Jeito fácil, sem linha de comando (Windows) — dois executáveis na raiz:

| Duplo clique em | O que faz |
|---|---|
| **`duel-academy.exe`** | sobe o front (8080), sobe o duel-server (8770), confere cada um com 200 OK, abre a página e fecha sozinho |
| **`duel-academy-stop.exe`** | encerra os dois de forma limpa e confirma que as portas caíram |

Se ainda não existirem, gere com `npm run launcher:build` (precisa do SDK .NET).
O launcher compila o `duel-server` sozinho na primeira vez, é idempotente (não
sobe servidor duplicado) e deixa os servidores rodando ocultos depois de sair.

Na mão:

```bash
npm run dev                            # front em http://localhost:8080
cd duel-server && dotnet run -- --serve # duel-server em http://localhost:8770
```

Sem `npm install` — o front tem **zero dependências**. Precisa de Node >= 18;
o duelo precisa de .NET 8 e **Windows x64** (as DLLs nativas do ocgcore).
Python 3 só é necessário para regenerar o banco de cartas (`npm run data:build`).

## Estrutura

| Pasta | O que é |
|---|---|
| **`web/`** | O jogo: Home, Deck Builder, NPCs e o treino de duelo. HTML/CSS/JS puro, sem framework. |
| **`duel-server/`** | Servidor .NET que hospeda o `ocgcore` e expõe o duelo por HTTP. |
| **`launcher/`** | Fonte dos dois executáveis de liga/desliga. Um só `Program.cs` gera ambos. |
| **`ygo-data/`** | Banco local de dados — 13.728 cartas decodificadas e 12.702 scripts Lua, extraídos do `cards.cdb` e prontos para consumo web. |
| **`duel_academy/`** | Protótipo Unity que provou a integração com o `ocgcore.dll`: cria duelo, carrega os scripts Lua, compra cartas e responde ao motor. Fonte de onde os dados foram extraídos. |
| **`tools/`** | Servidor estático de desenvolvimento. Andaime, não faz parte do produto. |

Comece por [`ygo-data/README.md`](ygo-data/README.md) — ele documenta o formato
dos dados, as pegadinhas de decodificação e os caminhos possíveis para rodar o
motor de regras na web.

## Estado atual

**Funciona:**

- **Deck Builder** com as regras oficiais de construção — Main 40–60, Extra 0–15,
  máximo de 3 cópias, sem side. Fusion/Synchro/Xyz/Link vão para o Extra
  automaticamente; Pendulum puro fica no Main. Interface em duas colunas no
  estilo Master Duel, com filtros por nome, tipo, atributo, raça, arquétipo,
  nível e ATK. Adicionar e remover por clique **ou** arrastando.
  Sem banlist, por decisão de projeto.
- **Persistência** em `localStorage` (vários decks, um ativo) com export/import
  em **`.ydk`** — o formato do ygopro, que é o que o `ocgcore` vai consumir
  quando o motor entrar.
- **Banco de dados** completo e validado (ver `ygo-data/README.md`).
- **Integração com o `ocgcore`** provada no protótipo Unity: o motor cria o duelo,
  carrega os Lua, distribui as cartas, emite mensagens e aceita respostas.

**Falta:** o servidor de duelo web, a cobertura das ~50 mensagens do motor (o
protótipo trata 6), a IA dos NPCs e a camada de RPG (progressão e recompensas).
O botão "Duelar" na Home está desabilitado até o motor existir.

### Testes

```bash
node web/js/deck.test.mjs      # 23 testes das regras de construção
npm run data:check             # integridade do banco de cartas
```

> As regras do Yu-Gi-Oh! **são** o `ocgcore` mais os 12.702 scripts Lua — não há
> caminho viável de reimplementá-las em JavaScript. O `ygo-data` resolve os
> *dados*; o motor de regras precisa rodar em algum lugar. Os três caminhos
> possíveis estão comparados no README do `ygo-data`.

## Licença e proveniência

`cards.cdb` e os scripts Lua vêm do projeto **ygopro / ygopro-core (edo9300)** —
ver `ygo-data/data/scripts/COPYING.txt`. Yu-Gi-Oh! é marca registrada da Konami;
este é material de fã, sem fins comerciais. As artes das cartas não estão no
repositório: são carregadas sob demanda do ygoprodeck.com.
