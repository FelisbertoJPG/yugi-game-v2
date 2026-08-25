/**
 * **O selo da banlist e a lista permitida** — `node web/js/selobanlist.test.mjs`.
 *
 * Dois relatos do mesmo dia, e uma causa só:
 *
 *   • *"no deck builder aparece a tag do card limitado, porém nos booster não"*;
 *   • *"o deck builder tá permitindo salvar localmente o deck fora da lista;
 *     se tiver cards banidos/limitados ou semi, o jogo não pode deixar salvar"*,
 *     e *"tá sem a tagzinha [L1] no card"*.
 *
 * A causa: as duas coisas — o selo e a validação — dependiam do checkbox
 * **"Lista 1"** do Deck Builder. Aquele checkbox é um FILTRO DO POOL ("só as
 * cartas jogáveis nesta fase") e nasce DESMARCADO. Com ele desligado o builder
 * dizia "deck válido" para um deck com três cópias de uma Limitada, deixava
 * salvar, e o banco recusava — o deck ficava só naquele navegador.
 *
 * A banlist nunca esteve desligada: quem a cobra é `salvar_deck` no Postgres,
 * pela lista ativa (`lista_ativa()`, migration 0020). O checkbox não desligava
 * regra nenhuma; só escondia a regra de quem precisava dela.
 *
 * O que se prova aqui é o que erra CALADO:
 *
 *   • o DESENHO do selo — um selo que não sai não dá erro, e quem olha vê uma
 *     carta comum. É a mesma classe de falha do `hidden` que não escondia;
 *   • a pergunta "esta carta está na lista?" — errar para MAIS bloqueia um deck
 *     legítimo (o jogador não consegue salvar e não sabe por quê); errar para
 *     MENOS é o bug do relato, e volta a deixar salvar o que o servidor recusa;
 *   • e a VARREDURA de quem aplica a regra: se o gate do checkbox voltar a
 *     qualquer uma das duas, tudo isto passa e o bug volta.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selosDaBanlist, textoDaBanlist, rotuloDoLimite } from './selobanlist.js';
import { foraDaLista } from './cardlists.js';
import { validateBanlist, addRule, defaultBanlist } from './banlist.js';

let ok = 0;
const t = (nome, fn) => { fn(); console.log(`  ok   ${nome}`); ok++; };

// Uma banlist de mentira: uma Limitada, uma Semilimitada, uma que custa pontos
// e uma numa lista compartilhada.
const BL = {
  cardLimits: { 100: 1, 200: 2, 500: 0 },
  cardPoints: { 300: 5 },
  cardGroups: { 400: 2 },
};

// ------------------------------------------------------------------ o selo

t('a carta Limitada ganha o selo [L1]', () => {
  const html = selosDaBanlist(BL, 100);
  assert.match(html, /bl-limit/);
  assert.match(html, />L1</);
});

t('a Semilimitada ganha [L2]', () => {
  assert.match(selosDaBanlist(BL, 200), />L2</);
});

t('os pontos saem em azul, no canto DIREITO', () => {
  const html = selosDaBanlist(BL, 300);
  assert.match(html, /bl-points/);
  assert.match(html, />5p</);
});

t('a lista compartilhada sai como o numero do grupo', () => {
  assert.match(selosDaBanlist(BL, 400), /bl-group/);
});

t('carta sem regra nenhuma nao ganha selo — nem string vazia com espaco', () => {
  assert.equal(selosDaBanlist(BL, 999), '');
});

t('sem banlist (ainda carregando, ou sem rede) nao inventa selo', () => {
  // `null` e' o "nao sei" honesto: a tela fica como estava antes. Desenhar um
  // selo aqui prometeria uma regra que ninguem conferiu.
  assert.equal(selosDaBanlist(null, 100), '');
  assert.equal(textoDaBanlist(null, 100), '');
  assert.equal(selosDaBanlist(undefined, 100), '');
});

t('o id e comparado como TEXTO — a chave do mapa vem de JSON', () => {
  // Os mapas vem de `conteudo/banlist`, onde toda chave e' string. Comparar
  // 100 (numero) com "100" (chave) sem converter devolveria "sem regra" para
  // TODA carta — o selo sumia inteiro, calado.
  assert.match(selosDaBanlist(BL, 100), />L1</);
  assert.match(selosDaBanlist(BL, '100'), />L1</);
});

t('o selo fica COLADO no canto — sem respiro entre a borda e a etiqueta', () => {
  // Ele nasceu com 2px de folga, para acompanhar os vizinhos da miniatura, e do
  // lado de quem olha aquilo virou um respiro estranho. Colado e' tambem o que
  // a contagem de copias (`.thumb .count`) sempre fez.
  assert.match(selosDaBanlist(BL, 100, {}), /top:0px/);
  assert.match(selosDaBanlist(BL, 300, {}), /top:0px/);
});

t('com o canto do limite ocupado, ele TROCA DE LADO — e continua colado', () => {
  // O caso real e' a carta revelada da Loja: o `NEW!!` mora no canto esquerdo.
  // Empilhar debaixo dele espremeria a etiqueta do limite justamente na carta
  // que o jogador acabou de ganhar; trocar de lado a mantem colada.
  const trocado = selosDaBanlist(BL, 100, { hasTopLeft: true });
  assert.match(trocado, /bl-dir/);
  assert.match(trocado, /top:0px/);
});

t('com os DOIS cantos ocupados nao ha para onde trocar: desce pelo desvio', () => {
  const desce = selosDaBanlist(BL, 100, { hasTopLeft: true, hasTopRight: true, desvio: 17 });
  assert.doesNotMatch(desce, /bl-dir/, 'trocou para um lado que tambem esta ocupado');
  assert.match(desce, /top:17px/);
});

t('o DESVIO e da tela: o vizinho da Loja e maior que o do builder', () => {
  // Na miniatura o selo de cima vai de 2px a 14px; na carta revelada o NEW!! vai
  // de 3px a 16px. Um numero so' serviria para uma das duas, e o erro e' mudo —
  // as duas etiquetas se sobrepoem e a de baixo fica ilegivel.
  const dois = { hasTopLeft: true, hasTopRight: true };
  assert.match(selosDaBanlist(BL, 100, { ...dois }), /top:14px/);
  assert.match(selosDaBanlist(BL, 100, { ...dois, desvio: 17 }), /top:17px/);
});

t('limite e grupo se empilham pelo PASSO, nao pelo desvio', () => {
  // A primeira versao multiplicava a linha pelo desvio, e o SEGUNDO selo de um
  // canto livre saia a 14px em vez de 11 — tres pixels de buraco no meio de
  // duas etiquetas que deviam estar coladas uma na outra.
  const dois = selosDaBanlist({ cardLimits: { 7: 1 }, cardGroups: { 7: 2 } }, 7);
  assert.match(dois, /top:0px/);
  assert.match(dois, /top:11px/);
  assert.doesNotMatch(dois, /top:14px/);
});

t('limite e grupo trocam de lado JUNTOS', () => {
  // Separa-los deixaria "2 copias somando as duas cartas" num canto e o "L1" da
  // mesma carta no outro.
  const dois = selosDaBanlist({ cardLimits: { 7: 1 }, cardGroups: { 7: 2 } }, 7,
                              { hasTopLeft: true });
  assert.equal((dois.match(/bl-dir/g) ?? []).length, 2);
  assert.match(dois, /top:0px/);
  assert.match(dois, /top:11px/);
});

t('limite a esquerda e pontos a direita nao se atrapalham', () => {
  // Sao COLUNAS diferentes: os dois podem estar colados no topo sem colidir.
  const html = selosDaBanlist({ cardLimits: { 9: 1 }, cardPoints: { 9: 5 } }, 9, {});
  assert.match(html, /bl-limit[^>]*top:0px/);
  assert.match(html, /bl-points[^>]*top:0px/);
  assert.doesNotMatch(html, /bl-points[^>]*bl-dir/, 'os pontos nunca trocam de lado');
});

t('o rotulo humano: 0 e BANIDA, 1 Limitada, 2 Semilimitada', () => {
  // Sao os nomes pelos quais o jogador reconhece a regra no jogo de verdade.
  assert.equal(rotuloDoLimite(0), 'BANIDA');
  assert.equal(rotuloDoLimite(1), 'Limitada');
  assert.equal(rotuloDoLimite(2), 'Semilimitada');
  assert.equal(rotuloDoLimite(3), 'máx 3');
  assert.equal(rotuloDoLimite(undefined), '');
});

t('a carta BANIDA ganha selo, e ele NAO e um "L0"', () => {
  // O zero passava por "sem regra" nas duas pontas do cliente — a carta
  // proibida era a unica da mesa sem selo nenhum. E ele nao pode parecer o
  // degrau seguinte de L1/L2: banida nao e' "menos uma copia", e' nenhuma.
  const html = selosDaBanlist(BL, 500);
  assert.match(html, /bl-ban/);
  assert.match(html, />BAN</);
  assert.doesNotMatch(html, />L0</);
  assert.match(textoDaBanlist(BL, 500), /BANIDA/);
});

t('o tooltip diz a regra por extenso, atras do nome', () => {
  const txt = textoDaBanlist(BL, 100);
  assert.match(txt, /^\n/, 'o tooltip entra atras do nome da carta');
  assert.match(txt, /Limitada/);
  assert.equal(textoDaBanlist(BL, 999), '');
});

// -------------------------------------------------- a banida na validacao

t('UMA copia de uma carta BANIDA ja e um problema', () => {
  // A conta era `lim > 0 && n > lim`, entao o teto 0 nunca entrava. O SERVIDOR
  // sempre a cobrou (`least(3, coalesce(cardLimits[id], 3))` da' 0 e recusa),
  // e as duas pontas discordavam calado: o builder dizia "deck valido", o banco
  // recusava, e o deck ficava so' no navegador.
  const r = validateBanlist({ main: [500], extra: [] }, BL);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].type, 'limit');
  assert.equal(r.problems[0].limit, 0);
});

t('par CONTROLE: a carta sem regra nenhuma continua passando', () => {
  assert.equal(validateBanlist({ main: [999, 999, 999], extra: [] }, BL).ok, true);
});

t('par CONTROLE: duas copias de uma Semilimitada continuam passando', () => {
  assert.equal(validateBanlist({ main: [200, 200], extra: [] }, BL).ok, true);
  assert.equal(validateBanlist({ main: [200, 200, 200], extra: [] }, BL).ok, false);
});

t('a regra de teto 0 pode ser CRIADA pelo editor', () => {
  // `addRule` exigia `value > 0`, entao "banida" era inexpressavel: o admin nao
  // tinha como escrever a regra que o servidor ja' sabia cobrar.
  const b = addRule(defaultBanlist(), 'limit', 0);
  assert.ok(b.rules.some((x) => x.type === 'limit' && x.value === 0),
            'o editor continua sem conseguir criar a regra de BANIDA');
  // Mas so' no eixo do TETO: 0 ponto nao cobra nada e "grupo 0" nao e' grupo.
  assert.equal(addRule(defaultBanlist(), 'points', 0).rules.length, 0);
  assert.equal(addRule(defaultBanlist(), 'group', 0).rules.length, 0);
});

// ------------------------------------------------------- a lista permitida

// Uma lista de mentira com a mesma forma da de verdade: um `filter(card)` sobre
// a entrada do indice.
const LISTA = { id: 'lista1', filter: (c) => c.t === 'M' || c.id === 55 };
const INDICE = {
  1: { id: 1, t: 'M', name: 'um monstro' },
  2: { id: 2, t: 'S', name: 'uma magia qualquer' },
  55: { id: 55, t: 'S', name: 'a magia escolhida a mao' },
};
const brief = (id) => INDICE[Number(id)] ?? null;

t('deck todo dentro da lista: nada fora', () => {
  assert.deepEqual(foraDaLista([1, 1, 55], LISTA, brief), []);
});

t('a carta fora da lista e apontada', () => {
  assert.deepEqual(foraDaLista([1, 2, 55], LISTA, brief), [2]);
});

t('a mesma carta repetida aparece UMA vez', () => {
  // Tres copias da mesma carta proibida sao UM problema, nao tres — a mensagem
  // da tela diria "e mais 2" falando da mesma carta.
  assert.deepEqual(foraDaLista([2, 2, 2], LISTA, brief), [2]);
});

t('carta que o indice nao conhece conta como FORA', () => {
  // Carta customizada (id >= 900000000, sem Lua) ou id digitado errado: o
  // servidor recusa as duas, e dizer "esta' tudo certo" aqui e' a mentira que
  // termina em deck preso no navegador.
  assert.deepEqual(foraDaLista([900000001], LISTA, brief), [900000001]);
});

t('SEM lista (ainda carregando) nao acusa nada', () => {
  // "Nao sei qual e' a lista" nunca pode virar "o seu deck esta' errado" — seria
  // travar o salvar de todo mundo no primeiro segundo de boot, ou sem rede.
  assert.deepEqual(foraDaLista([1, 2], null, brief), []);
  assert.deepEqual(foraDaLista([1, 2], {}, brief), []);
  assert.deepEqual(foraDaLista([1, 2], { filter: 'nao sou funcao' }, brief), []);
});

t('deck vazio nao acusa nada', () => {
  assert.deepEqual(foraDaLista([], LISTA, brief), []);
  assert.deepEqual(foraDaLista(null, LISTA, brief), []);
});

// ------------------------------------------------------------- a varredura

const builder = readFileSync(new URL('./builder.js', import.meta.url), 'utf8');
const loja = readFileSync(new URL('./loja.js', import.meta.url), 'utf8');

t('o Deck Builder aplica a banlist SEM olhar o checkbox do pool', () => {
  // O bug do relato, em uma linha: `$('f-lista1').checked && !ignoreBanlist`.
  // Aquele checkbox filtra o POOL e nasce desmarcado — usa-lo como interruptor
  // da banlist e' o que deixava salvar um deck invalido.
  const status = builder.match(/function deckStatus\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(status, 'nao achei o deckStatus');
  assert.ok(!/f-lista1/.test(status[0]),
            'a validacao voltou a depender do filtro do pool — o deck invalido salva de novo');
  assert.ok(/validateBanlist/.test(status[0]), 'o deckStatus nao confere a banlist');
  assert.ok(/foraDaLista/.test(status[0]), 'o deckStatus nao confere a lista permitida');
});

t('e o SELO tambem nao depende dele', () => {
  assert.ok(/const banlistBadges = \(id, cantos\) => selosDaBanlist\(banlist,/.test(builder),
            'o selo voltou a depender do checkbox — o jogador monta o deck sem ver [L1]');
});

t('a Loja desvia o selo do NEW!!, que ocupa o MESMO canto', () => {
  // `.rev-nova` e' `top:3px; left:3px` — exatamente onde o [L1] vai. Sem olhar
  // o `nova` de cada carta, a etiqueta do limite ficava por baixo do NEW!!
  // justamente na carta que o jogador acabou de ganhar.
  assert.ok(/hasTopLeft: !!item\?\.nova/.test(loja),
            'a Loja nao desvia o selo quando a carta e NOVA — as duas etiquetas se sobrepoem');
  assert.ok(/hasTopRight: !!item\?\.raridade/.test(loja),
            'a Loja da a raridade como sempre presente — numa carta sem ela o selo '
            + 'desceria a toa em vez de encostar no canto');
  const css = readFileSync(new URL('../css/revelacao.css', import.meta.url), 'utf8');
  const nova = css.match(/\.rev-nova\s*\{[^}]*\}/s);
  assert.ok(nova && /left:\s*3px/.test(nova[0]),
            'o NEW!! saiu do canto esquerdo — o desvio da Loja precisa ser revisto');
});

t('a Loja desenha o selo nas cartas reveladas e nas gavetas', () => {
  assert.ok(/selosDaBanlist/.test(loja), 'a Loja nao desenha selo nenhum');
  // Nas duas telas dela, e nao so' numa: quem abre o pacote e quem olha
  // "ver as cartas" fazem a MESMA pergunta.
  assert.ok(/selos,/.test(loja), 'a revelacao nao recebe os selos');
  assert.ok(/selos: \(id\) => selosDaBanlist/.test(loja), 'as gavetas nao recebem os selos');
});

t('e o CSS do selo e' + ' compartilhado, nao copia de uma tela', () => {
  const ui = readFileSync(new URL('../css/ui.css', import.meta.url), 'utf8');
  for (const c of ['.bl-badge', '.bl-limit', '.bl-group', '.bl-points', '.bl-dir']) {
    assert.ok(ui.includes(c), `${c} nao esta' em ui.css`);
  }
  // A folha da Loja e a da Trilha nao redefinem o selo: duas copias da mesma
  // cor se desencontram, e a mesma regra apareceria vermelha numa tela e
  // dourada na outra.
  // A ORDEM importa: `.bl-dir` e `.bl-limit` tem a MESMA especificidade (0,2,0),
  // entao quem vem por ULTIMO ganha. Com o `.bl-dir` antes, o `left: 0` do
  // `.bl-limit` sobrescreve o `left: auto` dele — a etiqueta fica com `left` E
  // `right` ao mesmo tempo e estica pela largura inteira da carta. Nada acusa:
  // e' CSS valido, e so' aparece na carta NOVA de um pacote.
  assert.ok(ui.indexOf('.bl-badge.bl-dir') > ui.indexOf('.bl-badge.bl-limit  {'),
            '.bl-dir esta ANTES das regras de lado — a troca nao pega e o selo estica');

  const deckHtml = readFileSync(new URL('../deck.html', import.meta.url), 'utf8');
  assert.ok(!/\.thumb\s+\.bl-badge\s*\{/.test(deckHtml),
            'o deck.html voltou a ter a sua propria copia do selo');
});

console.log(`\n  ${ok} passaram, 0 falharam`);
