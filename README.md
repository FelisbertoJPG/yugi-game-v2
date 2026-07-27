# yugi-game-v2

Projeto de um mini RPG de Yu-Gi-Oh! com duelo fiel às regras oficiais, usando o
motor **ygopro-core (edo9300)**. Front web em estilo retrô de jogo de navegador.

## Como rodar

```bash
npm run dev        # http://localhost:8080
```

Sem `npm install` — o projeto tem **zero dependências**. Só precisa de Node >= 18.
Python 3 é necessário apenas para regenerar o banco de cartas (`npm run data:build`).

## Estrutura

| Pasta | O que é |
|---|---|
| **`web/`** | O jogo: Home e Deck Builder. HTML/CSS/JS puro, sem framework. |
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
