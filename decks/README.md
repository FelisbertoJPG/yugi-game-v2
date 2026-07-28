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
máquinas. Deck de NPC é conteúdo do jogo — pertence ao repositório.

O que **continua** no navegador é só preferência local: qual deck de cada NPC
está ativo, e os decks do jogador em edição.

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
`duel-academy.exe`): salvar escreve o arquivo aqui direto. A gravação é feita
pelo endpoint `/__decks/save`, que só aceita conexões de localhost e só escreve
`.ydk` dentro desta pasta.

Sem o servidor, o Deck Builder baixa o `.ydk` e você o coloca aqui na mão.

Depois é só `git add decks/ && git commit`.
