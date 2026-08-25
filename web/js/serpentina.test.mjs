/**
 * **A serpentina da Trilha de Duelos** — `node web/js/serpentina.test.mjs`.
 *
 * O relato: *"as conexões ficam quebradas visualmente quando a tela fica cheia
 * ou o tamanho da janela muda"*. O desenho antigo fixava QUATRO quadros por
 * linha, escrito à mão, e o comentário do CSS dizia com todas as letras que ele
 * não media nada por JS — "o layout é o desenho". Só que a linha invertida é
 * `row-reverse`: sem uma largura própria, ela encosta os quadros na borda
 * direita da TELA. Numa janela larga, a linha de cima ficava à esquerda, a de
 * baixo do outro lado do monitor, e o conector vertical descia para o vazio.
 *
 * O que se prova aqui é o pouco que erra CALADO:
 *
 *   • a CONTA de quantos cabem — para mais, a linha transborda e a serpentina
 *     inteira sai do lugar; para menos, sobra um buraco que ninguém identifica
 *     como defeito. Nenhum dos dois dá erro;
 *   • que ela nunca devolve ZERO — o laço que fatia a lista avança de `cols` em
 *     `cols`, então um zero é a tela congelada com o navegador a 100% de CPU;
 *   • que as duas metades são INVERSAS: a largura que o CSS calcula com
 *     `--cols` nunca pode passar do espaço que o JS mediu;
 *   • e a FONTE ÚNICA das medidas — `--no`/`--gap` moram no CSS e o JS os lê de
 *     volta. Uma cópia em JS envelheceria no primeiro ajuste, e o sintoma seria
 *     o traço parando antes do quadro seguinte.
 *
 * O que este arquivo NÃO prova é a aparência: para isso é preciso abrir a tela
 * e arrastar a borda da janela. É a mesma regra do resto do projeto — mudança
 * visual não se prova em teste de lógica.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { quantosCabem, larguraDaLinha } from './serpentina.js';

let ok = 0;
const t = (nome, fn) => { fn(); console.log(`  ok   ${nome}`); ok++; };

const QUADRO = 96, VAO = 46;

// ---------------------------------------------------------------- a conta

t('4 quadros pedem 522px e 4 cabem em 522px', () => {
  assert.equal(larguraDaLinha(4, QUADRO, VAO), 4 * 96 + 3 * 46);
  assert.equal(larguraDaLinha(4, QUADRO, VAO), 522);
  assert.equal(quantosCabem(522, QUADRO, VAO), 4);
});

t('um pixel a menos e sao 3 — o vao conta n-1 vezes, nao n', () => {
  assert.equal(quantosCabem(521, QUADRO, VAO), 3);
});

t('um quadro a mais so entra com o vao dele junto', () => {
  // 5 quadros = 522 + 46 + 96 = 664. Em 663 ainda sao 4.
  assert.equal(larguraDaLinha(5, QUADRO, VAO), 664);
  assert.equal(quantosCabem(663, QUADRO, VAO), 4);
  assert.equal(quantosCabem(664, QUADRO, VAO), 5);
});

t('a janela larga do relato (1560px de trilha) cabe 11, nao 4', () => {
  // 11 quadros = 11*96 + 10*46 = 1516, e o 12o pediria 1658.
  assert.equal(quantosCabem(1560, QUADRO, VAO), 11);
  assert.equal(larguraDaLinha(11, QUADRO, VAO), 1516);
});

t('NUNCA devolve zero — nem numa largura menor que um quadro', () => {
  for (const w of [0, 1, 50, 95, -300, NaN, undefined, null]) {
    assert.equal(quantosCabem(w, QUADRO, VAO), 1, `largura ${w}`);
  }
});

t('nem com medidas tortas vindas do CSS', () => {
  assert.equal(quantosCabem(800, 0, VAO), 1);
  assert.equal(quantosCabem(800, NaN, VAO), 1);
  // Vao ausente ou negativo: os quadros ficam colados, mas a conta segue de pe.
  assert.equal(quantosCabem(800, 100, 0), 8);
  assert.equal(quantosCabem(800, 100, -20), 8);
});

t('as duas metades sao INVERSAS: a linha nunca passa do espaco medido', () => {
  for (let w = 60; w <= 3000; w += 7) {
    const n = quantosCabem(w, QUADRO, VAO);
    const largura = larguraDaLinha(n, QUADRO, VAO);
    // Cabe...
    if (w >= QUADRO) assert.ok(largura <= w, `${n} quadros (${largura}px) nao cabem em ${w}px`);
    // ...e nao caberia mais um: senao a tela ficaria com um buraco a direita.
    assert.ok(larguraDaLinha(n + 1, QUADRO, VAO) > w,
              `cabia mais um quadro em ${w}px e a conta parou em ${n}`);
  }
});

// ------------------------------------------------- a fonte unica das medidas

const html = readFileSync(new URL('../trilha.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('./trilha.js', import.meta.url), 'utf8');

t('o CSS declara --no, --gap e --cols em .trilha', () => {
  const bloco = html.match(/\.trilha\s*\{[^}]*\}/s);
  assert.ok(bloco, 'nao achei a regra .trilha');
  for (const v of ['--no:', '--gap:', '--cols:']) {
    assert.ok(bloco[0].includes(v), `.trilha nao declara ${v}`);
  }
});

t('a .linha tem LARGURA propria, calculada com --cols', () => {
  const bloco = html.match(/\.linha\s*\{[^}]*\}/s);
  assert.ok(bloco, 'nao achei a regra .linha');
  assert.ok(/width:\s*calc\(/.test(bloco[0]),
            'sem largura propria a linha invertida encosta na borda da TELA — o bug do relato');
  assert.ok(bloco[0].includes('--cols'), 'a largura da linha nao depende de --cols');
});

t('os conectores usam o vao, e nao um numero escrito a mao', () => {
  const lado = html.match(/\.no\.liga-lado::after\s*\{[^}]*\}/s);
  const baixo = html.match(/\.no\.liga-baixo::before\s*\{[^}]*\}/s);
  assert.ok(lado && baixo, 'nao achei os conectores');
  assert.ok(lado[0].includes('var(--gap)'), 'o conector horizontal nao usa --gap');
  assert.ok(baixo[0].includes('var(--gap)'), 'o conector vertical nao usa --gap');
});

t('o JS LE as medidas do CSS em vez de ter as suas', () => {
  assert.ok(js.includes("getPropertyValue('--no')"), 'trilha.js nao le --no do CSS');
  assert.ok(js.includes("getPropertyValue('--gap')"), 'trilha.js nao le --gap do CSS');
  // O par CONTROLE do teste acima: a constante antiga tem de ter sumido.
  assert.ok(!/POR_LINHA/.test(js),
            'trilha.js ainda tem a constante fixa de quadros por linha');
});

t('o palco reserva o vao da barra de rolagem — senao a trilha PISCA', () => {
  const bloco = html.match(/\.palco\s*\{[^}]*\}/s);
  assert.ok(bloco, 'nao achei a regra .palco');
  assert.ok(/scrollbar-gutter:\s*stable/.test(bloco[0]),
            'sem o vao reservado, a barra aparecendo tira ~15px da trilha, cai um quadro '
            + 'por linha, a trilha fica mais alta, a barra continua... e o desenho oscila '
            + 'entre dois estados para sempre, a 100% de CPU');
});

t('e a trilha se refaz sozinha quando o espaco muda', () => {
  assert.ok(js.includes('ResizeObserver'),
            'sem observador, mudar o tamanho da janela deixa a serpentina como estava');
  assert.ok(/porLinha\(\)\s*===\s*colsDesenhadas/.test(js),
            'sem a comparacao, redesenhar acorda o observador de novo — laco fechado');
});

console.log(`\n  ${ok} passaram, 0 falharam`);
