# boards/

Layouts de campo desenhados no **editor de campo** (`web/campo.html`), em
`.json`. Ficam versionados no git, então acompanham o repositório para
qualquer máquina — mesmo motivo dos `decks/*.ydk`.

```
boards/
  <nome>.json   um tabuleiro
```

## Formato

```json
{
  "name": "Clássico 1v1",
  "canvas": { "w": 1600, "h": 900 },
  "background": "data:image/jpeg;base64,...",
  "fieldSpell": 87430998,
  "zones": {
    "p0:m0": { "x": 620, "y": 520, "size": 90 },
    "p0:hand": { "x": 300, "y": 780, "w": 1000, "h": 110 },
    "mid": { "x": 500, "y": 430, "w": 600, "h": 40 }
  }
}
```

- `canvas` é o espaço lógico onde as coordenadas vivem (resolução de
  referência) — o front escala isso pro tamanho real da janela, então o board
  não precisa saber de viewport nenhum.
- `background` é opcional (`null` quando não há) — uma imagem de fundo em
  data URI, recomprimida em JPEG e limitada à largura do `canvas` na hora do
  upload (mesmo motivo do `customcards.js`: base64 cru de uma foto estoura o
  arquivo à toa). Cobre o `canvas` inteiro (`background-size: cover`).
- `fieldSpell` é opcional (`null` quando não há) — o **código real** de uma
  das 6 magias de campo da Lista 1 (Yami/Forest/Mountain/Sogen/Umi/Wasteland).
  Se setado, o `duel-server` bota essa carta virada pra cima na zona de campo
  ANTES do duelo começar (`DuelSession.InjectField`) — é a carta de verdade
  fazendo o efeito dela (Lua da própria carta), nada reimplementado do lado
  de fora. Estilo "campo de Floresta do Weevil": você entra no duelo e o
  bônus já está lá. Ver `--test-fieldbonus`.
- `zones` é um mapa `id → retângulo`. O `id` segue a mesma convenção que o
  `duel.html` já usa internamente para as zonas do campo: `p{jogador}:{zona}`,
  onde `{zona}` é `m0`–`m4` (monstro), `s0`–`s4` (magia/armadilha), `f`
  (campo), `deck`, `extra`, `gy` (cemitério) ou `hand` (mão) — mais um item
  só, sem prefixo de jogador: `mid` (LP e indicador de fase). `mid` não é uma
  zona do motor (LP não tem localização pro `ocgcore`), mas é editável do
  mesmo jeito; sem ele no board, o `duel.html` recentraliza sozinho.
- A maioria das zonas é um "slot" de carta com proporção fixa (a mesma que o
  `duel.html` já usa, 59:86) — por isso só têm `size` (a largura; a altura
  segue sozinha). `hand` e `mid` são áreas livres, com `w`/`h` de verdade.
- Não existe zona "inventada" além dessas: todo `id` tem que corresponder a
  uma zona que o `ocgcore` realmente entende (ou `mid`, a única exceção de
  UI). O editor não deixa criar `id` fora dessa lista.

## Como grava

Pelo editor de campo, com o servidor de desenvolvimento no ar (`npm run dev`
ou o `duel-academy.exe`): salvar escreve o arquivo aqui direto, pelo endpoint
`/__boards/save` — só aceita conexões de localhost e só escreve `.json`
dentro desta pasta. Sem servidor no ar, o editor baixa o arquivo para você
colocar aqui na mão.

## Duplicar

O ⧉ ao lado de cada tabuleiro na lista do editor grava uma cópia num arquivo
**novo** (`oficial.json` → `oficial_copia.json`, depois `oficial_copia_2.json`…)
e já passa a editar a cópia. O original não é tocado — é para isso que serve:
testar um layout à vontade sem estragar o que já está bom. O nome livre é
escolhido comparando o **arquivo**, não o nome, porque é o arquivo que seria
sobrescrito.

## Qual tabuleiro está "ativo"

Isso **não** é conteúdo do jogo — é preferência de quem está testando, então
fica só no `localStorage` (`ygo:activeBoard`, chave lida por `web/js/boards.js`),
igual a "qual deck de cada NPC está ativo". O `duel.html` lê essa chave no
boot: se apontar para um tabuleiro salvo aqui, desenha o campo com aquele
layout; se não, usa o layout padrão (o de sempre).

Depois é só `git add boards/ && git commit`.
