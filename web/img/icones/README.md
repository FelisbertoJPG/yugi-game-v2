# Ícones de perfil — as imagens

Aqui moram as artes dos ícones que o jogador escolhe como avatar. Elas viajam
no **`game.zip`** do Release; o banco (`public.icones`) guarda só o **nome do
arquivo**.

## Para acrescentar um ícone

```bash
# 1. ponha o PNG aqui (128x128, fundo transparente ou circular)
# 2. regere o manifesto
node tools/icones.mjs
# 3. cadastre em web/icones.html (Área de Teste), logado como admin
# 4. publique — a imagem só chega em quem joga por um Release
npm run icones:check     # confere que todo ícone cadastrado tem imagem
```

**O passo 4 não é opcional.** O banco não lê este disco e o navegador não lista
pastas: um ícone cadastrado cuja arte não foi publicada aparece como um
**quadrado vazio** para quem joga, sem erro em lugar nenhum. O
`npm run icones:check` existe exatamente para achar isso antes.

## `index.json` é gerado

Não edite à mão — `node tools/icones.mjs` o regenera a partir do que está na
pasta. Ele é o que o painel do admin oferece na lista de artes e o que o
`icones:check` cruza com o catálogo do banco.

É um arquivo estático de propósito: uma rota de listagem custaria implementação
nos **dois** back-ends (`tools/serve.mjs` e `duel-server/src/StaticServer.cs`),
e divergir ali faz a tela funcionar no `npm run dev` e falhar no jogo instalado.

## As sementes são código

`verso`, `ouro`, `azul`, `verde`, `roxo` e `vinho` são desenhadas por
`tools/icones.mjs` — não são binários sem fonte. É a mesma escolha do ícone do
jogo (`tools/gerar-icone.mjs`) e da pixel art do mundo andável: dois meses
depois, ninguém sabe refazer um PNG solto maior ou com outra cor.

Elas existem para a tela nascer com o que escolher. Podem sair quando houver
arte de verdade — mas o `verso` é o **gratuito** que todo jogador tem, e uma
lista de escolha vazia é pior que uma com uma opção só.

## Tamanho

O ícone é desenhado em **44px** no cartão do perfil e **26px** na lista de
amigos. Um desenho detalhado demais vira borrão nos 26px — o painel do admin
mostra os dois tamanhos lado a lado por isso.
