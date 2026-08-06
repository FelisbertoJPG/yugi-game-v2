# Tag Force 1 — como a batalha dele funciona, e o que isso muda aqui

> Investigação do ISO do *Yu-Gi-Oh! GX Tag Force* (PSP, ULUS) para reproduzir as
> animações de batalha em `web/duel.html`. Autocontido: não depende de memória de
> sessão. O detalhe **byte a byte** dos formatos está em
> [`tools/tagforce/README.md`](tools/tagforce/README.md); aqui está o *porquê* e o
> que fazer com isso.

## 1. A pergunta que originou tudo

"Quero na batalha as animações iguais às do Tag Force 1 — fazer do zero ou
extrair de uma ROM?"

A resposta veio do próprio ISO, e é melhor do que qualquer das duas opções
sugeria.

## 2. O achado que decide o desenho

**O duelo do Tag Force 1 é 2D.** Não existe um único arquivo de modelo 3D no ISO
inteiro — nenhum `.gmo`, nenhuma pasta de modelo. Os 603 arquivos do disco são:

| extensão | quantidade | o que é |
|---|---:|---|
| `.gim` | 4.585 | textura 2D (formato da Sony) |
| `.ehp` | 199 | pacote (arquivo de arquivos) |
| `.prx` | 48 | código |
| `.pmf` | 47 | vídeo (as cutscenes) |
| `.cip` | 2 | a arte das cartas |

Os monstros em campo **são a arte da carta**, e o "cut-in" — aquele retrato que
entra deslizando quando alguém ataca — é do **duelista**, não do monstro
(`cutin_aska01`, `cutin_bmgirl01`, `cutin_da_boy_B/R/Y` pelos dormitórios).

Consequência prática: **fazer em 2D no `duel.html` não é uma aproximação do Tag
Force — é a mesma técnica.** Não há nada a "perder" por não ter modelo 3D, porque
o TF1 também não tem. E não é preciso quebrar o zero-dependência do front (um
renderizador 3D exigiria three.js).

## 3. O que foi extraído

126 MB, 253 pacotes, **4.584 de 4.585 texturas** convertidas para PNG (uma
falha). Fora do repo, de propósito.

```bash
# caminho no formato do Windows, inclusive no Git Bash — quem abre o arquivo e o
# Node do Windows, que nao entende /c/... e morre com ENOENT sem explicar
$env:TF_ISO = "C:\caminho\para\tagforce1.iso"
node tools/tagforce/tudo.mjs C:\Users\voce\Desktop\tf-extraido
node tools/tagforce/timing.mjs C:\Users\voce\Desktop\tf-extraido
```

As sete ferramentas (`iso`, `ehp`, `gim`, `ehf`, `timing`, `folha`, `tudo`) são
Node puro, zero dependência, no mesmo espírito do resto do projeto.

> **Os assets são da Konami.** Extrair para estudar e referenciar é uma coisa;
> embutir no `dist/DuelAcademy.exe` é outra, e é uma decisão que ninguém tomou —
> note que o jogo já busca arte de carta do ygoprodeck em runtime, que é situação
> diferente de redistribuir num executável. Por isso nenhum script escreve dentro
> do repo, `tudo.mjs` recusa rodar sem destino explícito, e `tagforce-extraido/`
> está no `.gitignore`.

## 4. O timing exato

O `.ehf` é o script de animação. Depois de `"EHF\x1a"` vêm **5 pares
(offset, tamanho) que ladrilham o arquivo inteiro** — cada `offset+tamanho` cai
exatamente no offset seguinte, e o último fecha no tamanho do arquivo. Essa
propriedade vale nos **337 `.ehf` do jogo, sem uma exceção**, e é o que permite
confiar na leitura em vez de chutar. O `timing.mjs` recusa qualquer arquivo que
não ladrilhe — sem esse teste, um arquivo de outro formato passaria batido
devolvendo um número inventado.

Duração de cada batida, a 30 fps:

| animação | arquivo | quadros | ms |
|---|---|---:|---:|
| corrente | `chain01` | 40 | 1333 |
| início do duelo | `start_duel10` | 53 | 1767 |
| jokenpô (quem começa) | `jyanken10` | 61 | 2033 |
| **ataque direto** | `dilect_atk01` | **76** | **2533** |
| vitória / derrota / empate | `duel_win10` etc. | 81 | 2700 |
| troca de turno | `next_player10` | 99 | 3300 |
| **cut-in do duelista** | `ryusen01` | **30** | **1000** |
| aviso de fase (os 6 juntos) | `phase_t_10` | 150 | 5000 |

O cut-in em 30 quadros cravados é **uniforme em todo personagem do jogo** — só
Kagemaru e Psycho Shocker rodam em 25. Já o `phase_t_10` traz os 6 avisos num
arquivo só (12 `.gim` = 6 fases × 2 camadas, texto + sombra), então "≈833 ms por
aviso" é divisão, **não** número lido do arquivo. Os de 480+ quadros
(`score-atkdef10`, `score-phase10`) são loops ociosos do HUD, não one-shots.

## 5. O vocabulário da batalha

Nomes misturam romaji e inglês (às vezes com erro de grafia do próprio original):

`mahojin` 魔法陣 círculo mágico · `sord` espada (sic) · `sen_` 閃 flash ·
`s_cut` corte · `rai_BL` 雷 raio · `kemuri` 煙 fumaça · `bochi` 墓地 cemitério ·
`jyogai` 除外 banido · `dilect_atk` ataque direto (sic) · `lp_pnl_*` painel de LP
· `lp_pnl_nmb01_a` os dígitos do LP · `field_fusion` fusão · `spel_mark` marca de
magia

A animação de invocação está decomposta em estágios, nos nomes dos `.tmt`:
`field_card-single02h-` **`rise01`** → **`rise02`** → **`rise03`** →
**`invoke01`**.

### Texturas aditivas — a pegadinha que mais custa

32 texturas (`blu_light`, `orang_light`, `sen_*`) têm **alfa 0 em todo pixel, com
RGB presente**. São de blend **aditivo**: o jogo soma a cor no framebuffer.
Compondo por alfa elas somem inteiras, sem erro nenhum — foi exatamente o que
aconteceu na primeira folha de contato, que saiu preta. No canvas o equivalente é
`globalCompositeOperation = 'lighter'`; em CSS, `mix-blend-mode: screen`.

## 6. O que isso significa para o `web/duel.html`

A camada de animação já existe e a arquitetura está certa: `#fx` (`duel.html:113`)
é um overlay fixo, tudo roda dentro de `try/catch` para animação nunca derrubar o
duelo, e `prefersReduced` é respeitado. O que falta é corpo:

- `duel.html:1131` — o ataque hoje é: fantasma avança 170 ms, alvo treme, volta.
  ~650 ms, sem impacto. O TF1 gasta **2533 ms** no ataque direto.
- `duel.html:1268` — o evento `battle` (quem morreu) **só escreve no log**.
  Destruição não tem visual nenhum.
- `duel.html:1351` — `lp` só troca o número. Sem rolagem de dígito, sem tremor,
  sem cor.

A coreografia do TF1, na ordem: vinheta escurece → câmera aproxima → **cut-in do
duelista (1000 ms)** → investida → flash branco no impacto → estilhaço →
**LP rolando dígito a dígito** → volta. Tudo isso é transform em 2D sobre a arte
que já baixamos — nenhuma dependência nova.

## 7. O que não caiu

- **S3 do `.ehf`** — a animação em si. Mistura três codificações: float32 no
  cabeçalho (`-640.0f`, `1.0f`), depois offsets/contagens, depois um bloco denso
  com cores RGBA (`ff ff ff 55` = branco a 33% de alfa) e ponto fixo de 16 bits
  (`0x3ffc/16384 ≈ 1.0`, `0x8009 ≈ -1.0`). O layout por quadro-chave não foi
  decifrado — daria a curva de posição/escala/alfa de cada elemento, em vez de só
  a duração total. Quem atacar vai querer o MIPS de `gmodule/libduel_draw.prx` do
  lado; é trabalho de horas, não de minutos.
- **`.tms` / `.tma` / `.tmt`** (magics `TGMS`/`TGMA`/`TGMT`) — são justamente as
  animações de carta (`rise01/02/03`, `invoke01`). Intocados.
- **`.cip`** (`CPM\x1a`, 15 MB) — a arte das cartas. Intocado; e aqui não faz
  falta, já que o projeto busca arte do ygoprodeck.

## 8. Ordem de trabalho sugerida

1. Abrir a sequência de ataque em beats de verdade no `duel.html`, usando os
   tempos da tabela acima (o ataque direto de 2533 ms com o cut-in de 1000 ms
   dentro dele já é uma coreografia concreta).
2. Dar corpo ao `battle` e ao `lp`, que hoje só logam.
3. Só então, se a fidelidade quadro a quadro importar, atacar o S3 do `.ehf`.
