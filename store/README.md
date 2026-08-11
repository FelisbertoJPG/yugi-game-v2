# store/

> **Estes `.json` PRECISAM ser commitados.** Eles não são ignorados pelo git —
> só é fácil esquecer de adicioná-los, porque nascem sozinhos enquanto você joga.
> Foi assim que a primeira carteira e o booster "Origem do Caos" quase se
> perderam numa troca de máquina: os arquivos existiam no disco, mas continuavam
> como *untracked*. Depois de mexer na Loja ou no Booster Builder, confira o
> `git status`.


Config do jogo em **JSON versionado** — para sobreviver a `git commit` e a
transferências entre máquinas, em vez de morrer no `localStorage` de um navegador
(mesma ideia de `decks/`).

Gravado/lido pelo dev-server (`tools/serve.mjs`) via `/__store/<name>.json`
(só localhost). O front espelha aqui a cada gravação e lê daqui no boot
(`web/js/projectstore.js`); sem o servidor, tudo continua no localStorage.

Arquivos (criados no primeiro save com o servidor no ar):

- `boosters.json` — os boosters (raridades, capa, preço, se está na Loja).
- `wallet.json` — `{ dp, collection, pity }` do jogador (DP, cartas possuídas,
  contador da SR garantida por booster).
- `npcs.json` — os adversários CRIADOS na Área de Teste (além dos 3 fixos do
  código): `[{ id, name, theme, signatureId, custom: true, level, campaign,
  board }]`. Os decks deles continuam em `decks/npc/<id>/`, como os NPCs fixos.
  `level` é a dificuldade (`iniciante` — o padrão, e o que vale para quem não
  tem o campo — ou `avancado`, que LÊ a mão e as cartas baixadas do jogador).
- `npc-base-meta.json` — o mesmo `{ level, campaign, board }` dos **3 NPCs
  fixos**, que não têm registro próprio (são um array const no código). Só
  isso: nome/tema/deck deles continuam de onde sempre vieram.
- `cardlists.json` — a **fonte** das listas de cartas (o pool permitido),
  editada em `web/listas.html`: `{ listas: [{ id, label, tipos, ids }] }`.
  `tipos` são os `tl` que entram por REGRA (`Normal Monster`, `Fusion
  Monster`), `ids` são as cartas escolhidas uma a uma. O padrão de fábrica
  mora em `web/js/lista1.js`; este arquivo passa a mandar assim que existir.
  O **resultado** resolvido (o array de ids que o servidor confere) NÃO vem
  para cá: ele é derivado, e só o Supabase precisa dele (`conteudo/<id>`).

Depois de mexer nesses (montar booster, comprar, ganhar duelo, criar adversário), é só
`git add store/ && git commit` para levar para outra máquina.
