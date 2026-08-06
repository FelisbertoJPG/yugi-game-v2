# tools/tagforce — leitura do ISO do Yu-Gi-Oh! GX Tag Force (PSP)

Ferramentas de **leitura** do ISO do Tag Force 1, escritas pra estudar como o
jogo monta as animações de duelo. Node puro, zero dependência, no mesmo espírito
do resto do projeto.

> **Os assets são da Konami.** Extrair pra estudar e referenciar é uma coisa;
> embutir no `dist/DuelAcademy.exe` é outra, e é decisão que ninguém tomou
> ainda. Por isso nenhum script escreve dentro do repo, e `tudo.mjs` recusa
> rodar sem um destino explícito.

## Uso

```bash
# 1. aponte o ISO (nao fica no codigo — cada maquina tem o seu).
#    SEMPRE no formato do Windows, com C:\ — inclusive no Git Bash: quem abre o
#    arquivo e o Node do Windows, que nao entende o /c/... do bash e morre com
#    ENOENT sem dizer por que.
$env:TF_ISO = "C:\...\Yu-Gi-Oh! GX Tag Force 1 PT-BR v3.0.0.iso"   # PowerShell
export TF_ISO='C:\...\Yu-Gi-Oh! GX Tag Force 1 PT-BR v3.0.0.iso'   # Git Bash (aspas simples)

node iso.mjs "$TF_ISO"                    # lista os 603 arquivos do ISO
node tudo.mjs ~/Desktop/tf-extraido       # ISO -> .ehp -> .gim -> .png (126 MB)
node ehp.mjs <arquivo.ehp>                # lista um pacote
node ehf.mjs <arquivo.ehf>                # despeja um script de animacao
node timing.mjs ~/Desktop/tf-extraido     # duracao de TODA animacao, em ms
node folha.mjs saida.png 150 a.gim b.gim  # folha de contato pra conferir no olho
```

## O que se descobriu

**O duelo do Tag Force 1 é 2D.** Não existe `.gmo` nem pasta de modelo no ISO
inteiro: são 4.585 `.gim` (textura), 199 `.ehp` (pacote), 47 `.pmf` (vídeo) e 48
`.prx` (código). Os monstros em campo são a arte da carta, e o "cut-in" é o
retrato do **duelista**, não do monstro.

### Formatos resolvidos

**EHP** — o pacote.

```
00  "EHP\x03"                     08  "NOT " (tag de compressao; "NOT " = cru)
04  uint32 tamanho total          12  uint32 quantidade
16  (uint32 offNome, uint32 offDado)[]
    em offNome: "<nome>\0" + uint32 tamanho     dados alinhados em 16
```

**GIM** — a textura (formato da Sony). Árvore de blocos de 16 bytes
(`uint16 tipo, uint16 -, uint32 tamanho, uint32 proximoIrmao, uint32 offDado`).

- **tipo 4 = imagem, tipo 5 = paleta.** É fácil trocar os dois e sair só lixo.
- No cabeçalho de 48 B: formato em `+4`, swizzle `+6`, largura `+8`, altura
  `+10`, bpp `+12`; os pixels começam em `+0x1C`.
- formato 4 = índice 4 bits, 5 = índice 8 bits, 3 = RGBA8888.
- Precisa de **unswizzle** (blocos de 16 bytes × 8 linhas) — sem isso a imagem
  sai picotada em blocos, não dá erro nenhum.

**EHF** — o script de animação. Depois de `"EHF\x1a"` + 12 zeros vêm **5 pares
(offset, tamanho) que ladrilham o arquivo inteiro** — cada `offset+tamanho` cai
exatamente no offset seguinte e o último fecha no tamanho do arquivo. Essa
propriedade vale nos **337 `.ehf` do jogo, sem uma exceção**, e é o que permite
confiar na leitura em vez de chutar; `timing.mjs` recusa qualquer arquivo que
não ladrilhe.

| seção | conteúdo |
|---|---|
| S0 (32 B) | `+0` duração em quadros, `+4` cor RGBA de fundo, `+20`/`+28` tela |
| S1 | zerado nos exemplares vistos (área de estado em tempo de execução?) |
| S2 | 12 B de cabeçalho + 12 B por textura |
| S3 | a animação: float32 no cabeçalho, depois offsets/contagens e um bloco denso |
| S4 | tabela de texturas — 16 B por nome ASCII, casa com os `.gim` numerados |

A unidade de coordenada é **1/20 de pixel**: S0 guarda `9600 = 480×20` e
`5440 = 272×20`, a tela do PSP.

**S3 não está resolvido.** Dá pra ver que mistura três codificações — float32 no
cabeçalho (`-640.0f`, `1.0f`), depois offsets/contagens, e um bloco denso com
cores RGBA (`ff ff ff 55` = branco a 33% de alfa) e ponto fixo de 16 bits
(`0x3ffc/16384 ≈ 1.0`, `0x8009 ≈ -1.0`) — mas o layout por quadro-chave ainda
não foi decifrado. Quem for atacar isso vai querer o MIPS do
`gmodule/libduel_draw.prx` do lado.

### Texturas aditivas

32 texturas (`blu_light`, `orang_light`, `sen_*`) têm **alfa 0 em todo pixel e
RGB presente**: são de blend **aditivo**, o jogo soma a cor no framebuffer.
Compor por alfa faz elas sumirem inteiras — no canvas o equivalente é
`globalCompositeOperation = 'lighter'`.

### Vocabulário (romaji + inglês, misturados)

`mahojin` 魔法陣 círculo mágico · `sord` espada (sic) · `sen_` 閃 flash ·
`s_cut` corte · `rai_BL` 雷 raio · `kemuri` 煙 fumaça · `bochi` 墓地 cemitério ·
`jyogai` 除外 banido · `dilect_atk` ataque direto (sic) · `jyanken` じゃんけん
jokenpô · `lp_pnl_*` painel de LP · `bustup`/`bu_*` retrato de personagem ·
`sdchr` boneco chibi do mapa

### Timing medido (30 fps)

| animação | quadros | ms |
|---|---:|---:|
| corrente (`chain01`) | 40 | 1333 |
| início do duelo (`start_duel10`) | 53 | 1767 |
| jokenpô (`jyanken10`) | 61 | 2033 |
| **ataque direto** (`dilect_atk01`) | **76** | **2533** |
| vitória / derrota / empate | 81 | 2700 |
| troca de turno (`next_player10`) | 99 | 3300 |
| cut-in do duelista (`ryusen01`) | 30 | 1000 |
| aviso de fase (`phase_t_10`) | 150 | 5000 |

O `phase_t_10` traz os 6 avisos de fase num arquivo só (12 `.gim` = 6 fases ×
2 camadas, texto + sombra), então **1 aviso ≈ 25 quadros ≈ 833 ms** — isso é
inferência pela divisão, não um número lido do arquivo. Os de 480+ quadros
(`score-atkdef10`, `score-phase10`) são loops ociosos do HUD, não one-shots.
