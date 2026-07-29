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

Depois de mexer nesses (montar booster, comprar, ganhar duelo), é só
`git add store/ && git commit` para levar para outra máquina.
