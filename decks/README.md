# decks/

Decks guardados **no projeto**, em `.ydk` — o formato do ygopro, que é o mesmo
que o `ocgcore` consome. Ficam versionados no git, então acompanham o
repositório para qualquer máquina.

```
decks/
  npc/<npcId>/<nome>.ydk     decks dos adversários (conteúdo do jogo)
  player/<nome>.ydk          seus decks
```

## Por que aqui e não no navegador

O `localStorage` some quando você limpa os dados do site e não viaja entre
máquinas. Deck é conteúdo do jogo — do NPC **e do jogador** — então pertence ao
repositório.

Vale para os dois: salvar um deck no builder grava aqui na hora, e o boot da
página lê daqui de volta (`hydrateDecks` em `web/js/storage.js`). O
`localStorage` é só cópia de trabalho.

O que **continua** no navegador é só preferência local: qual deck está ativo
(o seu e o de cada NPC).

> Isso já foi diferente. Até então o deck do jogador só existia no navegador, e
> o sintoma era levar a pasta para outra máquina e continuar vendo os decks
> antigos DAQUELE navegador — os `.ydk` viajavam no git, mas nada os lia de
> volta. Se você tem um deck preso num navegador antigo, abra o builder lá uma
> vez com o servidor no ar: o `hydrateDecks` migra o que é local-only para cá
> antes de sincronizar, num arquivo novo, sem passar por cima de nada.

## Formato

É um `.ydk` comum. Os metadados nossos vão em comentários `#chave valor`, que
qualquer parser de `.ydk` ignora — o arquivo continua válido no YGOPro/EDOPro.

```
#created by yugi-game-v2
#name Yugi Chaos
#npc yugi
#signature 46986414        <- carta que o NPC dropa ao ser derrotado
#updated 2026-07-28T12:00:00.000Z
#main
46986414
...
#extra
...
!side
```

## Como gravar

Pelo Deck Builder, com o servidor de desenvolvimento no ar (`npm run dev` ou o
`classic-duels.exe`): salvar escreve o arquivo aqui direto. A gravação é feita
pelo endpoint `/__decks/save`, que só aceita conexões de localhost e só escreve
`.ydk` dentro desta pasta.

Sem o servidor, o Deck Builder baixa o `.ydk` e você o coloca aqui na mão.

Depois é só `git add decks/ && git commit`.
