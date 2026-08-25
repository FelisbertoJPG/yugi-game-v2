/**
 * Toda tela do jogo BATE? — `node web/js/vivo.test.mjs`
 *
 * O `ClassicDuels.exe` não abre mais janela de terminal, e era ela o botão de
 * fechar. Quem diz ao servidor que o jogo ainda está na tela é a batida de
 * `vivo.js`: cada página pinga `/__vivo` a cada 5s, e o servidor se encerra
 * depois de 15s sem nenhuma.
 *
 * O modo de falha disso é conhecido e é o motivo deste arquivo existir: **uma
 * página que esqueça a batida faz o servidor fechar debaixo de quem está
 * jogando.** E o sintoma seria dos piores — não é erro, não é log, é o jogo
 * sumindo da tela depois de quinze segundos parado numa tela específica. Quem
 * escrevesse a página nova testaria clicando, veria tudo funcionar, e o defeito
 * só apareceria para quem ficasse ali um pouco mais.
 *
 * Por isso a regra é de VARREDURA e não de revisão: toda página em `web/`
 * precisa da linha, e a lista de páginas é lida do disco — não escrita aqui —,
 * senão uma tela nova nasceria fora do teste.
 *
 * É o mesmo molde de `esconder.test.mjs`, que acabou de provar o valor: quando
 * os furos DELE foram tapados, sete telas com bug apareceram de uma vez.
 */
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { INTERVALO_MS } from './vivo.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const DIR = new URL('../', import.meta.url);
const PAGINAS = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort();

t('toda página de web/ liga a batida', () => {
  const faltando = PAGINAS.filter((p) => {
    const html = readFileSync(new URL(p, DIR), 'utf8');
    // O `manterVivo()` junto: importar sem chamar não bate em nada, e é
    // exatamente o tipo de meia-linha que passa numa revisão de olho.
    return !(/\/web\/js\/vivo\.js/.test(html) && /manterVivo\s*\(\s*\)/.test(html));
  });

  assert.deepEqual(faltando, [],
    'estas telas não avisam que estão vivas — o jogo se fecharia sozinho nelas:\n        '
    + faltando.join('\n        '));
});

// A varredura não pode passar por ter parado de achar as telas.
t('a varredura encontrou as telas de verdade', () => {
  assert.ok(PAGINAS.length >= 20, `so' ${PAGINAS.length} pagina(s) em web/`);
  for (const obrigatoria of ['index.html', 'duel.html', 'deck.html', 'atualizando.html']) {
    assert.ok(PAGINAS.includes(obrigatoria), `${obrigatoria} ficou de fora da varredura`);
  }
});

// E que ela reconhece o caso ruim — senão "nenhuma faltando" não prova nada.
t('a varredura reconhece a página que esqueceu', () => {
  const bom = `<script type="module">import { manterVivo } from '/web/js/vivo.js'; manterVivo();</script>`;
  const soImporta = `<script type="module">import { manterVivo } from '/web/js/vivo.js';</script>`;
  const nada = `<script type="module">console.log('oi');</script>`;

  const ok = (h) => /\/web\/js\/vivo\.js/.test(h) && /manterVivo\s*\(\s*\)/.test(h);
  assert.ok(ok(bom));
  assert.ok(!ok(soImporta), 'importar sem chamar teria passado');
  assert.ok(!ok(nada));
});

// O intervalo tem de caber VÁRIAS vezes na janela do servidor: com uma batida
// por janela, um único pacote perdido — ou uma navegação entre telas caindo na
// hora errada — encerraria o jogo.
//
// A janela é do OUTRO LADO (C#), e por isso ela é LIDA do fonte em vez de
// copiada para cá. Dois números escritos à mão em linguagens diferentes se
// desencontram no primeiro ajuste, e o desencontro aqui não dá erro: ele
// encurta a folga até o dia em que o jogo começa a se fechar sozinho.
t('a batida cabe pelo menos 3x na janela do servidor', () => {
  // `DIR` e' `web/`; um nivel acima e' a raiz do repositorio.
  const cs = readFileSync(new URL('../duel-server/src/WebServer.cs', DIR), 'utf8');
  const m = cs.match(/JANELA_VIVO\s*=\s*TimeSpan\.FromSeconds\((\d+)\)/);
  assert.ok(m, 'nao achei JANELA_VIVO em duel-server/src/WebServer.cs');

  const janelaMs = Number(m[1]) * 1000;
  assert.ok(INTERVALO_MS > 0, 'intervalo tem de ser positivo');
  assert.ok(janelaMs / INTERVALO_MS >= 3,
    `janela de ${janelaMs}ms / batida de ${INTERVALO_MS}ms = ${janelaMs / INTERVALO_MS} batida(s) por janela`);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
