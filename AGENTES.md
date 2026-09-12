# AGENTES

Quem é quem em `.claude/agents/`, e quando chamar cada um. Este arquivo é a
lista; o que cada agente **sabe** está no `.md` dele.

Um agente é um `.md` com frontmatter (`name` + `description`) e um corpo de
instruções. O `description` não é enfeite: é por ele que se decide qual agente
atende o pedido — escreva-o dizendo **o assunto e a pasta**, não a qualidade do
agente.

> **Um agente começa FRIO.** Ele não herda a conversa: recebe o `CLAUDE.md` da
> raiz e mais nada, e por isso o corpo de cada um manda ler o CLAUDE.md da
> camada dele antes de editar qualquer coisa. Trabalho que já está mastigado na
> sessão sai mais barato feito ali mesmo — abrir agente para uma pergunta de uma
> linha é pagar para redescobrir o que já se sabe.

---

## Os três agentes

| agente | especialidade | pastas | lê antes de editar |
|---|---|---|---|
| **`frontend`** | as telas e o que se desenha | `web/` | `web/CLAUDE.md` |
| **`backend`** | o motor, o banco e a distribuição | `duel-server/`, `supabase/migrations/`, `tools/`, `ygo-data/` | `duel-server/CLAUDE.md` (+ `DUEL-TRAINING-HANDOFF.md`, `INSTALADOR.md`) |
| **`arquiteto`** | onde uma verdade mora | as três, e a documentação | os três CLAUDE.md |

### `frontend` — o front

Telas, módulos ESM de `web/js/`, CSS de `web/css/`, os testes em Node
(`web/js/*.test.mjs`) e as bancadas visuais (`tools/bancada-*.mjs`). Cobre o
Deck Builder, a Loja, o duelo **desenhado** (a mesa, a seta, a revelação), a
trilha, a home social, os drops e o **Mundo** — a floresta 3D onde os jogadores
se encontram, com aparência de personagem e presença ao vivo.

Ele já chega sabendo o que erra **calado** aqui: `hidden` que não esconde
porque existe um `display` seu com mais especificidade, `svg.hidden = false`
que não faz nada (um `<svg>` não é `HTMLElement`), o atalho `{ nomeDe }` que é
leitura de variável e só estoura no caminho raro, e duas contas para o mesmo
número. Sabe também que a prova de mudança visual é a **bancada**, não o teste
de lógica — a seta de ataque foi publicada invisível com 13 testes verdes.

**Não use para:** regra de jogo. O `ocgcore` responde o que pode ser ativado,
invocado ou reposicionado; o front desenha o que ele ofereceu. Se a resposta
está errada, o assunto é do `backend`.

### `backend` — o motor, o banco e a distribuição

O duelo (`duel-server/`, `ocgcore`, `NpcBrain`, o protocolo binário), o Supabase
(migrations, RLS, RPCs) e o caminho até a máquina de quem joga (instalador,
auto-updater, Release).

Ele já chega sabendo: compilar com o servidor parado (senão o teste roda o
binário antigo e a mudança parece não ter funcionado), que um tamanho errado de
entrada no protocolo **desalinha o parse sem erro nenhum** e o sintoma aparece
turnos depois, que regra do `NpcBrain` se lê do Lua da carta e não de uma lista
de ids escrita à mão, e que quem decide o que o jogador pode é o servidor —
guarda de tela é a porta, a fechadura é a RLS.

**Não use para:** aparência. E cuidado com as suítes pesadas — o pacote inteiro
custa minutos; para uma mudança pontual, roda-se a suíte daquele assunto.

### `arquiteto` — onde uma verdade mora

Para quando a mudança atravessa as camadas, quando a pergunta é de projeto e não
de código, ou para revisar uma decisão **antes** de implementá-la. É também quem
escreve documentação: CLAUDE.md, handoffs, READMEs.

Ele carrega as leis do projeto — uma verdade num lugar só, o conferidor como
única duplicação legítima, cópia local nunca vence a nuvem, *o que o jogo
entrega o jogo aceita*, invariante > tarefa — e o modo de escrever daqui:
documenta-se **o que erra calado**, com o relato de quem jogou nas palavras
dele e a causa **medida**, dizendo o que foi decidido de propósito para ninguém
"consertar" depois.

**Não use para:** escrever a implementação. Ele decide e documenta; quem edita a
camada é o agente dela.

---

## O que os três já sabem, sem precisar ser lembrado

- **Não subir servidor** (8080/8770) nem pedir teste manual: isso derruba o
  `.exe` de quem está jogando. A prova é teste automatizado e bancada; o teste
  ao vivo é do usuário.
- **Par CONTROLE** em todo teste novo — a mesma situação sem o motivo, onde a
  coisa NÃO pode acontecer. E varredura precisa **reconhecer o caso ruim**:
  a que nunca acusa nada deixa de ser lida.
- Falhou alguma coisa? **Registra o que e onde, e segue** — nada de ciclo de
  tentativas.
- Documentação e comentários em **português**, seguindo a língua do arquivo.
- Commits em Conventional Commits com escopo, no imperativo e **sem acentos no
  assunto**.

---

## Os dois MODOS (que não são agentes)

Vivem em `.claude/commands/` e se chamam com `/`. A diferença: um agente é
**quem** faz; um modo é **como** se faz — vale para qualquer um deles, inclusive
para uma sessão sem agente nenhum.

| modo | para quê |
|---|---|
| **`/agent1`** | implementar sem rodar teste, build nem publicação — e terminar com a lista numerada do que falta para a mudança chegar em produção |
| **`/bug`** | caçar defeito **pelo artefato** (log, tabuleiro, script, print medido), nunca por palpite, fechando com teste que reconhece o caso ruim |

O `/bug` existe por um preço já pago: reconhecer um relato como "ah, aquele
problema conhecido" custou três correções erradas seguidas, com teste verde no
fim de cada uma. Quando quem relata oferece um diagnóstico junto do sintoma, **o
sintoma é o dado; o diagnóstico é palpite, igual ao seu**.

---

## Os de fábrica, e quando ainda servem

- **`Explore`** — varredura ampla e só de leitura, quando a resposta é "onde
  isto está" em muitos arquivos e você quer a conclusão, não o despejo.
- **`Plan`** — desenhar a estratégia de uma implementação grande antes de
  escrever a primeira linha.
- **`general-purpose`** / **`claude`** — o que não couber em nenhum acima.

Os três de fábrica não conhecem este projeto além do `CLAUDE.md` da raiz. Para
trabalho dentro de `web/` ou `duel-server/`, os nossos chegam sabendo mais.

---

## Acrescentar um agente

Um `.md` novo em `.claude/agents/`:

```markdown
---
name: <slug em minúsculas>
description: <o assunto e as pastas — é isto que decide se ele é chamado>
---

<as instruções: o que ler antes de editar, o que não se negocia, como se prova
uma mudança nessa área, e o que erra CALADO ali>
```

Um agente novo se justifica quando existe um **corpo de conhecimento** que ele
carregaria e os outros não. Agente que só repete a raiz não é especialista: é
uma partida a mais paga para redescobrir o que já estava carregado.
