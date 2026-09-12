/**
 * **A APARÊNCIA do jogador** — o que ele veste, e quem decide isso.
 *
 * Este módulo é o catálogo do que EXISTE e a regra do que é VÁLIDO. Ele não
 * desenha nada (quem desenha é `boneco3d.js`) e não fala com o banco (quem fala
 * é `mundo3d.js`), justamente para poder ser provado em Node.
 *
 * ---
 *
 * ## A decisão que manda: o CÓDIGO diz o que existe, o BANCO diz o que se vende
 *
 * Um ícone de perfil é um PNG numa coluna — o banco consegue inventar um ícone
 * novo sozinho. Uma peça de roupa é **geometria**, e geometria mora em
 * `boneco3d.js`: uma peça que o código não sabe construir não existe, por mais
 * linhas que tenha no banco. Então:
 *
 * | quem | responde |
 * |---|---|
 * | `PECAS`, aqui | **quais peças existem** |
 * | `boneco3d.js` | **qual é a forma** de cada uma |
 * | a tabela `itens` | **quais custam DP** e quem as tem |
 *
 * Isso erra calado nas duas pontas, e as duas estão guardadas por teste:
 * uma peça aqui sem construtor lá vira um espaço vazio no boneco; um item no
 * banco com um id que não existe aqui é um cosmético **comprado e invisível**.
 *
 * ## A posse tem UMA regra, escrita duas vezes de propósito
 *
 * > *"Se a peça está no catálogo de venda, você precisa tê-la. Se não está, é
 * > de graça."*
 *
 * O cliente a aplica para saber o que OFERECER (`disponivel`), e o gatilho
 * `perfis_aparencia_valida` a aplica para saber o que ACEITAR. As duas são a
 * mesma frase, e a segunda é a que vale: sem ela, bastaria um `PATCH /perfis`
 * para vestir o cosmético mais caro da loja sem pagar. É exatamente o furo que
 * a migration 0036 fechou para o ícone.
 *
 * Note que **nenhuma lista de "peças grátis" é escrita em lugar nenhum**. Grátis
 * é a AUSÊNCIA no catálogo de venda, o que faz um admin pôr uma peça à venda (ou
 * tirar) sem que ninguém precise editar código dos dois lados.
 *
 * ## A COR é livre, a FORMA é que se compra
 *
 * Cor não custa nada para produzir e é o que faz alguém sem nenhum item parecer
 * uma pessoa em vez de um clone. Cobrar por ela transformaria a primeira
 * impressão do Mundo numa fileira de bonecos idênticos esperando para pagar.
 */
import { coresPara } from './actors.js';
import { PERSONAGEM_PADRAO, normalizarPersonagem } from './personagens.js';

/**
 * Os slots que têm FORMA, na ordem em que o vestiário os mostra.
 *
 * A PELE fica de fora de propósito: ela é só cor. Não existe "peça de pele" —
 * o corpo está sempre lá —, e enfiá-la aqui obrigaria toda regra de peça a
 * abrir uma exceção para ela.
 */
export const SLOTS = ['cabelo', 'roupa', 'calca', 'sapato'];

export const NOME_DO_SLOT = {
  cabelo: 'cabelo',
  roupa: 'blusa',
  calca: 'calça',
  sapato: 'calçado',
};

/**
 * O que existe. **O `id` é o mesmo id da tabela `itens`** quando a peça está à
 * venda — e é por isso que ele já vem com o slot no nome.
 *
 * Não é enfeite: se o id daqui fosse `moicano` e o do banco `cabelo-moicano`,
 * a regra de posse precisaria montar um a partir do outro **nos dois lados**, e
 * a hora em que o JS e o SQL discordassem sobre esse hífen seria a hora em que
 * todo mundo passaria a vestir de graça, em silêncio.
 *
 * A PRIMEIRA de cada slot é o padrão e o porto seguro: é para ela que cai uma
 * peça desconhecida. Por isso ela nunca pode estar à venda (o teste cobra).
 */
export const PECAS = {
  cabelo: [
    { id: 'cabelo-curto', nome: 'Curto' },
    { id: 'cabelo-careca', nome: 'Raspado' },
    { id: 'cabelo-espetado', nome: 'Espetado' },
    { id: 'cabelo-rabo', nome: 'Rabo de cavalo' },
    { id: 'cabelo-moicano', nome: 'Moicano' },
    { id: 'cabelo-longo', nome: 'Longo' },
    // os cortes COLEGIAIS: a franja é o que os separa dos genéricos acima
    { id: 'cabelo-chanel', nome: 'Chanel com franja' },
    { id: 'cabelo-chiquinhas', nome: 'Maria-chiquinha' },
    { id: 'cabelo-reparticao', nome: 'Repartido de lado' },
  ],
  roupa: [
    { id: 'roupa-camiseta', nome: 'Camiseta' },
    { id: 'roupa-jaqueta', nome: 'Jaqueta' },
    { id: 'roupa-colete', nome: 'Colete' },
    { id: 'roupa-tunica', nome: 'Túnica' },
    // O UNIFORME. As campanhas são "Academia de Duelo" e "Reino dos
    // Duelistas", e o elenco é colegial — a cor do slot é o que faz a mesma
    // forma servir às duas (azul e vermelho) sem um segundo modelo.
    { id: 'roupa-blazer', nome: 'Blazer' },
    { id: 'roupa-uniforme', nome: 'Uniforme (gravata)' },
    { id: 'roupa-uniforme-laco', nome: 'Uniforme (laço)' },
    { id: 'roupa-sueter', nome: 'Suéter com gravata' },
  ],
  calca: [
    { id: 'calca-comprida', nome: 'Calça' },
    { id: 'calca-bermuda', nome: 'Bermuda' },
    { id: 'calca-saia', nome: 'Saia' },
    { id: 'calca-saia-pregueada', nome: 'Saia pregueada' },
  ],
  sapato: [
    { id: 'sapato-tenis', nome: 'Tênis' },
    { id: 'sapato-bota', nome: 'Bota' },
    { id: 'sapato-colegial', nome: 'Sapato com meia alta' },
  ],
};

/** A paleta que o vestiário oferece. A cor guardada pode ser qualquer hexa. */
export const PALETA = {
  pele: ['#f0c9a0', '#e6b78b', '#d9a273', '#c08a5e', '#a8724a', '#8a5a3a', '#6b432a', '#4e3020'],
  cabelo: ['#2a2118', '#4a3320', '#6b5230', '#a98850', '#d8cba0', '#1f2430', '#5a2a2a', '#8f4a70',
           '#3a5f8a', '#2f7a72', '#7a2f2f', '#e8e8e8'],
  roupa: ['#7d3f45', '#3d6b45', '#5b4a7d', '#2f7a72', '#8a5a2b', '#8f4a70', '#4a5a2f', '#2f5f8a',
          '#c94f4f', '#e8c46a', '#d8dce8', '#262e42'],
  calca: ['#3c4665', '#4c4030', '#3c4a41', '#262e42', '#5a4a5a', '#7a6a4a', '#2a2a2a', '#8a8a90'],
  sapato: ['#262e42', '#3a2a1a', '#1a1a1a', '#7d3f45', '#d8dce8', '#4a5a2f'],
};

/** Uma cor de verdade: seis dígitos hexa com `#`. Nada mais entra. */
const CORDEVERDADE = /^#[0-9a-fA-F]{6}$/;

/**
 * Quantos bytes o JSON pode ter. **Tem de bater com o `check` da coluna**
 * (migration 0054) — do contrário a tela deixa montar e o banco recusa, cada
 * lado certo pela sua conta.
 */
export const LIMITE_JSON = 1024;

/**
 * A aparência de fábrica de UM jogador — deduzida do id dele, e não fixa.
 *
 * É a mesma `coresPara(id)` que já pinta os adversários e os bonecos do mundo
 * 2D, então **quem nunca abriu o vestiário continua com exatamente a cara que
 * já tinha**, e o Mundo não vira uma fileira de clones no dia em que a
 * customização entrar. Ela é a mesma em toda tela sem guardar nada em lugar
 * nenhum, que é a razão de `coresPara` existir.
 */
export function padraoDe(id) {
  const c = coresPara(id);
  return {
    pele: c.s,
    cabelo: { peca: PECAS.cabelo[0].id, cor: c.h },
    roupa: { peca: PECAS.roupa[0].id, cor: c.c },
    calca: { peca: PECAS.calca[0].id, cor: c.p },
    sapato: { peca: PECAS.sapato[0].id, cor: c.b },
    // QUEM eu sou, ao lado do que eu visto. Guardado na MESMA forma dos slots
    // (`{ peca }`) de propósito: é assim que o gatilho `perfis_aparencia_valida`
    // enxerga a chave, então no dia em que um personagem for vendido em `itens`
    // a regra de posse já vale para ele sem uma linha nova de SQL. Ver
    // `personagens.js`.
    personagem: { peca: PERSONAGEM_PADRAO },
  };
}

const achar = (slot, pecaId) => PECAS[slot]?.find((p) => p.id === pecaId) ?? null;

/**
 * Uma aparência **sempre válida**, custe o que custar.
 *
 * Ela é a porta por onde passa tudo: o que veio do banco, o que veio da tela e
 * o que veio de um cliente mais NOVO que o meu. Cada recusa cai no padrão
 * daquele jogador, nunca em erro e nunca em nada:
 *
 *  - **peça desconhecida** é o caso comum e o mais importante. Um admin
 *    cadastra um cabelo novo hoje; quem ainda não atualizou o jogo não tem a
 *    geometria dele. Cair no padrão mostra a pessoa de cabelo curto; deixar
 *    passar mandaria um id sem construtor para o `boneco3d`, e ali ele vira uma
 *    cabeça careca sem aviso — ou, pior, um `undefined` no meio da montagem;
 *  - **cor torta** (vazia, `'vermelho'`, `null`, um número) chega a
 *    `new THREE.Color()`, que resmunga no console e deixa a peça BRANCA. Uma
 *    peça branca no meio de um boneco é indistinguível de uma escolha ruim;
 *  - **chave a mais** é descartada: é o que mantém o JSON dentro do
 *    `LIMITE_JSON` mesmo que alguém poste um objeto inteiro na coluna.
 */
export function normalizar(cru, id) {
  const padrao = padraoDe(id);
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return padrao;

  const cor = (v, queda) => (typeof v === 'string' && CORDEVERDADE.test(v) ? v : queda);
  const saida = { pele: cor(cru.pele, padrao.pele) };

  for (const slot of SLOTS) {
    const bruto = cru[slot];
    const dele = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    const peca = achar(slot, dele.peca) ? dele.peca : padrao[slot].peca;
    saida[slot] = { peca, cor: cor(dele.cor, padrao[slot].cor) };
  }

  // O personagem não é validado contra uma LISTA como as peças, e sim contra a
  // FORMA: o catálogo é dado (sai do elenco de adversários), não código, então
  // uma lista aqui envelheceria a cada adversário novo. Id desconhecido cai no
  // padrão — que é a textura como veio no arquivo, e não a ausência de textura.
  const dp = cru.personagem;
  saida.personagem = {
    peca: normalizarPersonagem((dp && typeof dp === 'object' && !Array.isArray(dp) ? dp.peca : null)),
  };
  return saida;
}

/**
 * Posso usar esta peça?
 *
 * `catalogo` é um Map de `id → { tenho }` montado do `meus_itens()` — o
 * catálogo INTEIRO de itens à venda, com um booleano de posse por linha.
 *
 * A regra é a do cabeçalho, e a ordem dela importa: **fora do catálogo é
 * grátis**. Inverter isso (só o que está no catálogo é permitido) deixaria todo
 * jogador pelado no dia em que a consulta de itens falhasse — e falha de rede
 * não pode virar uma decisão sobre o que alguém veste.
 */
export function disponivel(pecaId, catalogo) {
  const linha = catalogo?.get?.(pecaId);
  return !linha || !!linha.tenho;
}

/**
 * As peças de um slot, cada uma dizendo se está liberada e quanto custa.
 * É o que o vestiário desenha — inclusive o que a pessoa ainda não tem, porque
 * esconder o cosmético que se quer vender é o avesso de vendê-lo.
 */
export function pecasDoSlot(slot, catalogo) {
  return (PECAS[slot] ?? []).map((p) => {
    const linha = catalogo?.get?.(p.id) ?? null;
    return {
      ...p,
      preco: linha?.preco ?? 0,
      aVenda: !!linha,
      liberada: !linha || !!linha.tenho,
    };
  });
}

/**
 * O que vai para o banco. Só as chaves conhecidas, na ordem conhecida — o
 * `normalizar` já garante a forma, e isto garante o TAMANHO.
 */
export function paraGravar(aparencia, id) {
  const a = normalizar(aparencia, id);
  const txt = JSON.stringify(a);
  // Não deveria acontecer: a forma é fechada e cabe folgado. Se acontecer, é
  // porque alguém acrescentou slot demais — e mandar assim mesmo faria o banco
  // recusar o salvamento inteiro com uma mensagem que ninguém liga a isto.
  if (txt.length > LIMITE_JSON) throw new Error('aparencia grande demais');
  return a;
}
