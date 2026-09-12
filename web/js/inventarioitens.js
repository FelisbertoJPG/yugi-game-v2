/**
 * **Os ITENS GERAIS do inventário** — o que o jogador tem fora das cartas e dos
 * decks.
 *
 * Eles vêm de DUAS fontes, e não de uma:
 *
 *   • `meus_icones()` — o ícone de perfil, que tem tabela e regras próprias
 *     desde a migration 0035 (é ele que `perfis.icone_id` aponta);
 *   • `meus_itens()` — sleeve, playmat, deck box e o genérico (0051/0052).
 *
 * Juntar as duas no SERVIDOR seria uma terceira verdade sobre posse, e ela
 * envelheceria calada no dia em que uma das duas ganhasse uma regra (o ícone
 * gratuito, por exemplo, que ninguém "ganha" e todo mundo tem). Aqui elas são
 * lidas separadas e só a APRESENTAÇÃO é comum — que é o que o inventário pede.
 *
 * Sem DOM: é o que deixa `inventarioitens.test.mjs` rodar em Node. Quem
 * desenha é `inventario.js`.
 */

/**
 * A etiqueta de cada tipo, como ela aparece ao lado do nome —
 * *"Kuriboh (Ícone)"*, *"Inseto Devorador de Homens (sleeve)"*.
 *
 * Tipo que este cliente não conhece cai no próprio texto vindo do banco, e não
 * num "desconhecido": um item novo cadastrado por um admin com o servidor mais
 * novo tem de aparecer no inventário de quem ainda não atualizou — com o nome
 * cru, mas aparecendo. Sumir seria pior.
 */
export const ETIQUETA = {
  icone: 'Ícone',
  sleeve: 'Sleeve',
  playmat: 'Playmat',
  deckbox: 'Deck Box',
  generico: 'Item',
};

export const etiquetaDe = (tipo) => ETIQUETA[tipo] ?? String(tipo ?? 'Item');

/**
 * Uma lista só, na ordem em que se lê: ícones primeiro (é o cosmético que o
 * jogo já usa), depois os demais por tipo e nome.
 *
 * **Só o que a pessoa TEM.** As duas consultas devolvem o catálogo inteiro com
 * um `tenho` — é o que permite a mesma consulta servir a uma vitrine —, e o
 * inventário é justamente a tela onde o que ela não tem não interessa.
 *
 * O ícone GRATUITO entra: `meus_icones()` já o marca como `tenho`, e ele é de
 * verdade um item do jogador — some da lista só quem ele não tem.
 */
export function itensDoJogador(icones, itens) {
  const dos = (lista, tipo) => (Array.isArray(lista) ? lista : [])
    .filter((x) => x && x.tenho)
    .map((x) => ({
      id: x.id,
      tipo: tipo ?? x.tipo ?? 'generico',
      nome: x.nome ?? x.id,
      imagem: x.imagem ?? null,
      // O ícone é redondo em toda tela em que aparece; os outros não. Quem
      // desenha precisa saber disso, e o TIPO é a resposta — não uma coluna
      // nova no banco.
      redonda: (tipo ?? x.tipo) === 'icone',
    }));

  const ordem = ['icone', 'sleeve', 'playmat', 'deckbox', 'generico'];
  const posto = (t) => {
    const i = ordem.indexOf(t);
    return i < 0 ? ordem.length : i;   // tipo novo vai para o fim, mas aparece
  };

  return [...dos(icones, 'icone'), ...dos(itens, null)]
    .sort((a, b) => posto(a.tipo) - posto(b.tipo)
                 || String(a.nome).localeCompare(String(b.nome), 'pt', { sensitivity: 'base' }));
}
