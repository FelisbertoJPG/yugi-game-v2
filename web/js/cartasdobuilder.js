/**
 * **As cartas do Card Builder nas telas que as USAM** — o Deck Builder (pool e
 * deck) e o duelo (nome, arte, texto e o `customCards` do `/start`).
 *
 * O editor (`cardbuilder.html`) grava em `cartas_custom` (migrations 0058/0059);
 * isto lê de lá. Não passa pelo `localStorage`: a carta é conteúdo do jogo, e
 * uma cópia local velha faria o Deck Builder mostrar um efeito e o duelo rodar
 * outro — o mesmo "cada tela certa pela sua conta" que o projeto já pagou.
 *
 * **O motor não lê o Supabase.** Quem leva a carta até ele é a página, no corpo
 * do `/start` (`cartasCustomDoDuelo`), e o `WebServer` só aceita isso de uma
 * chamada local. O Lua enviado é a coluna `lua` — o derivado que o editor
 * regenera a cada salvar —, e não um `gerarLua` refeito aqui: assim o duelo roda
 * exatamente o código que o admin viu na tela ao salvar.
 *
 * Uma leitura por página (`emCurso`), e a falha não fica guardada: sem rede
 * agora, a próxima chamada tenta de novo.
 */
import { req } from './supabase.js';
import { renderFramedCard, renderCardOnFrame } from './customcards.js';
import {
  ehIdDoBuilder, entradaDoIndice, camposDaPrevia, dadosDoMotor, gerarLua, normalizarCarta,
} from './cardbuilder.js';
import { cartaDaLinha } from './cardbuilderbanco.js';

/**
 * **A carta como ela aparece**, pelo visual escolhido no Card Builder:
 * `completa` usa a imagem importada como está; `moldura` desenha a arte e o texto
 * sobre a moldura importada; `desenhada` é o layout do próprio builder.
 *
 * Visual que pede imagem e não tem nenhuma cai no layout do builder — carta sem
 * desenho nenhum seria um quadrado vazio no pool, sem erro.
 *
 * É a ÚNICA função que decide isso: o editor (prévia e lista), o Deck Builder e
 * o duelo passam todos por aqui, senão a carta apareceria diferente em cada tela.
 *
 * @returns {Promise<string>} data URL
 */
export async function desenharCarta(bruta, { arte = null, imagem = null } = {}) {
  const carta = normalizarCarta(bruta);
  const campos = camposDaPrevia(carta);
  if (carta.visual === 'completa' && imagem) return imagem;
  if (carta.visual === 'moldura' && imagem) return renderCardOnFrame(campos, arte, imagem);
  return renderFramedCard(campos, arte);
}

let emCurso = null;

/**
 * Todas as cartas do builder, prontas para o índice.
 * @returns {Promise<Array<{ carta: object, lua: string, entrada: object }>>}
 *   `entrada` tem a forma de `ygodb.addCustom`, com `art` (a carta como ela
 *   aparece) e `desc` (o texto).
 */
export function carregarCartasDoBuilder() {
  if (emCurso) return emCurso;
  emCurso = (async () => {
    const r = await req('cartas_custom?select=id,dados,lua,arte,imagem&order=id.asc');
    if (!r.ok || !Array.isArray(r.dados)) {
      console.warn('[card-builder] não consegui ler as cartas:', r.error);
      emCurso = null;
      return [];
    }
    const fora = [];
    for (const linha of r.dados) {
      const carta = cartaDaLinha(linha);
      if (!carta.id) continue;
      let desenho = null;
      try {
        desenho = await desenharCarta(carta, { arte: linha.arte || null, imagem: linha.imagem || null });
      } catch { /* sem desenho a carta continua jogável: só a miniatura fica vazia */ }
      fora.push({
        carta,
        lua: typeof linha.lua === 'string' && linha.lua ? linha.lua : gerarLua(carta),
        entrada: entradaDoIndice(carta, desenho),
      });
    }
    return fora;
  })();
  return emCurso;
}

/**
 * O `customCards` do `/start` para os ids de um duelo (deck, Extra e o deck do
 * adversário). `faltam` são ids da faixa do builder que o banco não devolveu —
 * a carta foi apagada, ou não houve rede —, e a tela deve recusar o duelo com
 * esse aviso: sem os dados, o motor a trataria como carta inexistente, e o
 * sintoma seria uma carta que nunca faz nada, sem erro nenhum.
 */
export async function cartasCustomDoDuelo(ids) {
  const pedidas = [...new Set((ids ?? []).map(Number).filter(ehIdDoBuilder))];
  if (!pedidas.length) return { cartas: [], faltam: [] };

  const porId = new Map((await carregarCartasDoBuilder()).map((x) => [x.carta.id, x]));
  const cartas = [];
  const faltam = [];
  for (const id of pedidas) {
    const x = porId.get(id);
    if (!x) { faltam.push(id); continue; }
    cartas.push({ ...dadosDoMotor(x.carta), nome: x.carta.nome, lua: x.lua });
  }
  return { cartas, faltam };
}
