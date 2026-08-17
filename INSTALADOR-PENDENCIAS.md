# Instalador / Auto-Updater — o que faltou para concluir

Complemento de [`INSTALADOR.md`](./INSTALADOR.md), que descreve o que **existe**. Este lista
o que **falta**, com o porquê e onde mexer. Escrito em 2026-08-07, logo depois do primeiro
Release publicado (`release-20260807-0157`); revisado no mesmo dia, depois de fechar os itens
1, 3, 4, 5, 6, 7 e a parte testável do 2.

Estado de quem chega agora: a cadeia funciona ponta a ponta — publicar → o cliente busca
`/releases/latest` → baixa só a diferença → instala → o jogo abre. Testes:
`--test-update` 35/35, `--test-offline` 16/16, `--test-selfupdate` 15/15,
`--test-update-duelo` 13/13, `--test-release` 11/11, `--test-remote` 10/10 (a última é a
única que precisa de rede). E a cadeia foi exercitada de ponta a ponta: `release:build` →
`release:test` → `pack` → rodar o `dist\ClassicDuels.exe` empacotado, que instalou os dois
pacotes **com marcador** (`pacote 'game' embutido: 54 arquivos — game-e3ac821fb672`).

Ordenado por **impacto no jogador**, não por esforço.

---

## O que foi fechado (e como conferir)

| # | Item | Como se prova |
|---|---|---|
| 1 | Atualização fantasma na instalação nova | `--test-update` (2 casos novos) e `--test-release` (com os 25,7 MB reais) + `INSTALADOR.md` §11 |
| 3 | Update rodando durante um duelo | `--test-update-duelo` |
| 4 | `managedRoots` — `web/` saiu de `keep` | `tools/publish-release.ps1` |
| 5 | Backups crescendo sem limite | `UpdateEngine.PodarBackups` (mantém 3) |
| 6 | Caminho de volta | `POST /__update/restaurar` + botão em `web/atualizando.html` |
| 7 | Caminho offline sem teste | `--test-offline` |
| 2 | `SelfUpdater` nunca exercitado | `--test-selfupdate` — **metade**; ver §2 abaixo |
| 9 | Aviso do `npc-base-meta.json` | virou opcional explícito no `publish-release.ps1` |

`npm run update:test` roda as quatro suítes que não precisam de rede.

Detalhes que merecem ser lembrados, porque não são óbvios do código:

- **A trava do duelo precisa SOLTAR, não só recusar.** O `cards.cdb` fica aberto pelo SQLite
  desde `DuelSession`, e o objeto do duelo continuava vivo depois de acabar, até o próximo
  `/start`. Uma rota que só perguntasse "tem duelo?" deixaria atualizar impossível depois de
  jogar uma vez. `WebServer.LiberarDueloEncerrado()` faz as duas coisas: recusa (409) se há
  duelo em andamento, e descarta o duelo encerrado — o que fecha o banco, agora que o
  `DatabaseManager` tem `Dispose` determinístico (antes só havia finalizador, e ninguém sabe
  quando o coletor de lixo roda).
- **Restaurar leva os marcadores junto.** O backup guarda uma cópia de `.duelacademy/*`
  ANTES da atualização mexer em qualquer coisa. Sem isso, voltar devolveria o conteúdo antigo
  deixando os marcadores dizendo que a versão nova está instalada — o jogo rodaria arquivos
  velhos se achando em dia, que é pior que não ter como voltar.
- **`npm run pack` deixou de ser autossuficiente.** `npm run release:build` é pré-requisito.
  Era o preço do item 1, e estava anunciado.

---

## 2. O `SelfUpdater` nunca rodou **numa publicação real**

**O que já está coberto.** `--test-selfupdate` roda a coreografia inteira com um exe de
mentira no `%TEMP%`: baixar o `.new`, conferir o sha256, apagar o `Zone.Identifier`, escrever
o `.bat`, esperar um PID morrer, copiar por cima, apagar o `.new`, o `.bat` se autodeletar. O
`.bat` roda de verdade. Um sha256 errado não troca nada (senão o jogador fica sem NENHUMA
versão que abre, e sem log, porque o processo que escreveria o log é o que não sobe).

**Os passos 1 e 2 foram feitos em 14/08/2026** (`release-20260814-1028`, `InstallerVersion`
`0.1.0` → `0.2.0`): é o primeiro Release da história do projeto com `"installer"` preenchido
em vez de `null`. Os 11 anteriores subiram só `game.zip`/`cards.zip`.

**E isso não era só uma pendência de instalador — era um buraco de entrega.** O
`duel-server` (motor, `NpcBrain`, `InteractiveDuel`) viaja **só dentro do exe**. Sem
`-ComExe`, publicar um Release entrega o front e **descarta em silêncio toda mudança em
C#**. Descoberto do jeito ruim: a varredura de ATK/DEF que faz a magia de campo aparecer na
tela foi publicada, os testes passavam, e o jogador continuou vendo o Umi sem efeito —
porque o `duel.html` novo conversava com um motor antigo. Toda mudança em C# agora exige
`npm run pack` antes de publicar (registrado no `CLAUDE.md`).

**O que continua faltando, e não dá para testar localmente.**

1. rodar um exe **da versão 0.1.0** e ver a troca para a 0.2.0 acontecer de verdade;
2. baixar o exe **pelo navegador** e confirmar que reabre — é o único jeito de ele vir com a
   Marca da Web de verdade, que é o que produz o erro 1223. Copiar o arquivo localmente não
   reproduz o cenário.

---

## 4. Duas `managedRoots` ainda em `"keep"`

`web/` virou `"backup"` — é a raiz que o inventário do pacote `game` cobre inteira, então
"órfão" ali quer dizer mesmo "sobra de uma versão anterior", e um `.js` velho que fica no
disco para sempre é justamente o tipo de coisa que carrega em silêncio e quebra a página.

Continuam em `keep`, de propósito: `ygo-data` e `duel_academy/Assets/StreamingAssets`. As
duas são **compartilhadas** entre os pacotes `game` e `cards`, e têm arquivos que o
`npm run data:build` gera localmente. Virar uma de cada vez, depois de ver uma atualização
real rodando limpa com `web/` em `backup`.

Onde: o bloco `managedRoots` em `tools/publish-release.ps1`.

---

## 8. Rotação do PAT

O token fine-grained expira. **Anote a data agora** — quando ele vencer, todo cliente
instalado para de ver atualizações, e o sintoma é silencioso: o log diz "nao consegui buscar o
manifesto" e o jogo abre normalmente.

Quando renovar: gerar o novo, substituir `duel-server/token.txt`, `npm run release:build`,
`npm run pack`, publicar com `-ComExe`. Os clientes precisam do exe novo para receber o token
novo — ou seja, **se o token expirar antes de você publicar, ninguém consegue atualizar
automaticamente** e a atualização tem que ser manual. Renove com folga.

> Enquanto isso: `duel-server/bin/` está no `.gitignore` porque o build embute o token dentro
> do `duel-server.dll`. Não tire essa linha.

---

## 11. `decks/npc/*.ydk` nunca chegam a quem já instalou (NOVO)

**Achado ao mexer no `pack.ps1`.** Os decks dos adversários são conteúdo do JOGO —
`decks/npc/{joey,kaiba,wevil,yugi}/*.ydk`, 8 arquivos hoje — e viajam **só** dentro do
`payload.zip` embutido no exe. Nenhum pacote do Release os carrega: `game.zip` é
`web/` + `ygo-data/src` + os índices, `cards.zip` é o banco, e os `files[]` avulsos são
exatamente três `store/*.json`.

Consequência: editar o deck de um NPC e publicar uma atualização **não** muda nada na máquina
de quem já instalou. Só um exe novo levaria a mudança — e nem isso, porque o `Payload`
preserva `decks/` quando o arquivo já existe (correto: é onde moram os decks do jogador).

**Por que não consertei sozinho.** O conserto natural — pôr `decks/npc/**` no `game.zip` —
esbarra numa trava deliberada: `UpdateEngine.Intocaveis` recusa por CÓDIGO qualquer escrita
em `store/` e `decks/`, com uma exceção nomeada (`ConteudoGlobalPermitido`, hoje três
`store/*.json`). A trava existe para um manifesto publicado por engano não ter poder de
deslogar todo mundo nem apagar a coleção de ninguém, e `decks/users/` mora ali do lado.
Abrir `decks/npc/` é uma decisão sua, não uma limpeza de rotina.

Se for abrir, o desenho que mantém a trava honesta é: `ConteudoGlobalPermitido` passa a
aceitar o **prefixo** `decks/npc/` (que não pode colidir com `decks/users/`), o
`publish-release.ps1` põe esses `.ydk` no `game.zip`, e o `--test-update` ganha um caso
provando que `decks/users/…` continua intocável no mesmo zip.

---

## 12. Pontas menores

- **O `HashCache` mal é exercitado.** Só os 3 `files[]` passam por ele; os pacotes usam
  marcador. Está correto e é barato, só não faz o que foi feito para fazer. Se um dia `web/`
  virar `files[]` individuais, ele passa a valer.
- **O app `mobile/` não sabe de atualização nenhuma.** Ele é cliente fino do `duel-server`, e
  quem atualiza é o PC — o que faz sentido. Mas se o PC atualizar para uma versão com protocolo
  diferente, o app fica incompatível sem avisar.
- **A poda de Releases é opt-in.** `npm run release:publish -- -PodarReleases 5` apaga os
  antigos; sem a flag, nada é apagado e um aviso aparece quando passam de 10. Apagar Release
  é irreversível e o cliente só busca `/releases/latest`, então acumular custa apenas
  legibilidade — não vale automatizar.
- **A restauração volta uma versão só.** `UpdateEngine.Restaurar()` pega o backup mais
  recente; `ListarBackups()` já devolve os 3 guardados, mas a rota `/__update/restaurar` não
  aceita escolher qual. Se um dia precisar, é um parâmetro.

---

## 13. Git — resolvido fora daqui, **não** faça `git init` nesta pasta

O documento original marcava isto como o bloqueio nº 1: a pasta não tem `.git`, logo nada
teria cópia versionada. O diagnóstico técnico continua certo — `C:\Users\suporteti2\Desktop\duel academy`
realmente não tem `.git` —, mas a conclusão não: **esta pasta é uma cópia de trabalho**, e o
repositório de verdade (`FelisbertoJPG/yugi-game-v2`) já está inicializado na pasta original.
O histórico existe; só não é aqui que ele mora.

> O texto original descrevia ainda outra máquina (`C:\Users\Mestre\…`, com uma cópia em
> `classic duels v4\yugi-game-v2` 31 commits atrás). Nada disso existe aqui — desconsidere.

**Consequência prática, que continua valendo:** o que for editado NESTA pasta não está
versionado enquanto não voltar para a cópia com `.git`. Não é um bloqueio do instalador, é
uma nota de fluxo de trabalho.

> Confirmado na revisão original que o token **não** vazou: o último commit no GitHub é de
> 06/08 15:44 UTC e o token nasceu em 07/08 04:41 UTC; `duel-server/bin` e `token.txt` não
> estão na árvore (55.074 caminhos varridos). O `.gitignore` daqui cobre
> `duel-server/token.txt`, `duel-server/bin/`, `dist/`, `store/accounts/`, `store/users/`,
> `store/sessions.json` e `decks/users/` — vale conferir que a cópia versionada tem o mesmo.

---

## Ordem sugerida

| # | Item | Por quê primeiro |
|---|---|---|
| 1 | §2 — publicar com `-ComExe` e provar a troca do exe | é o que sobrou do caminho mais frágil |
| 2 | §11 — decidir sobre `decks/npc/` | conteúdo que hoje não alcança quem já instalou |
| 3 | §4 — virar as outras duas `managedRoots` | depois de uma atualização real rodando limpa |
| 4 | §8, §12 | manutenção, sem pressa |

> §13 saiu da lista: o git já existe na cópia original desta pasta.
