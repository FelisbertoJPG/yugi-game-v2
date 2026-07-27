# yugi-game-v2

Projeto de um mini RPG de Yu-Gi-Oh! com duelo fiel às regras oficiais, usando o
motor **ygopro-core (edo9300)**. Front web em estilo retrô de jogo de navegador.

## Estrutura

| Pasta | O que é |
|---|---|
| **`ygo-data/`** | Banco local de dados — 13.728 cartas decodificadas e 12.702 scripts Lua, extraídos do `cards.cdb` e prontos para consumo web. Zero dependências. |
| **`duel_academy/`** | Protótipo Unity que provou a integração com o `ocgcore.dll`: cria duelo, carrega os scripts Lua, compra cartas e responde ao motor. Fonte de onde os dados foram extraídos. |

Comece por [`ygo-data/README.md`](ygo-data/README.md) — ele documenta o formato
dos dados, as pegadinhas de decodificação e os caminhos possíveis para rodar o
motor de regras na web.

## Estado atual

**Funciona:** a ponte com o `ocgcore` está provada no protótipo Unity — o motor
cria o duelo, carrega os Lua, distribui as cartas, emite mensagens de estado e
aceita respostas (invocar, setar, entrar em battle phase, passar turno). O banco
local está completo e validado.

**Falta:** o servidor de duelo web, a cobertura das ~50 mensagens do motor (o
protótipo trata 6), a IA dos NPCs e a camada de RPG (progressão e recompensas).

> As regras do Yu-Gi-Oh! **são** o `ocgcore` mais os 12.702 scripts Lua — não há
> caminho viável de reimplementá-las em JavaScript. O `ygo-data` resolve os
> *dados*; o motor de regras precisa rodar em algum lugar. Os três caminhos
> possíveis estão comparados no README do `ygo-data`.

## Licença e proveniência

`cards.cdb` e os scripts Lua vêm do projeto **ygopro / ygopro-core (edo9300)** —
ver `ygo-data/data/scripts/COPYING.txt`. Yu-Gi-Oh! é marca registrada da Konami;
este é material de fã, sem fins comerciais. As artes das cartas não estão no
repositório: são carregadas sob demanda do ygoprodeck.com.
