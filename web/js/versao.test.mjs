/**
 * A VERSÃO MÍNIMA, do lado do cliente — `node web/js/versao.test.mjs`
 *
 * A regra é do dono do jogo: *o cliente obedece ao que servimos*. Quem barra de
 * verdade é o banco (`iniciar_duelo`, migration 0041) — este lado só relata qual
 * versão está rodando e, por cortesia, explica na tela.
 *
 * As duas decisões deste arquivo erram CALADAS e nas duas direções opostas:
 *
 *   • **relatar de menos** — mandar vazio onde havia versão faz o banco barrar
 *     quem está em dia. O jogo para de funcionar para todo mundo, e a mensagem
 *     que aparece é "seu jogo está desatualizado" para quem acabou de atualizar;
 *   • **relatar de mais** — inventar uma versão onde não se sabe qual é (o
 *     `dev`, o servidor local fora do ar) abre a porta exatamente para o cliente
 *     que a trava existe para barrar.
 *
 * E a PAREDE só pode subir quando o servidor mandou. Trancar a tela por falta de
 * resposta transformaria um soluço do Supabase num cadeado no jogo inteiro — o
 * oposto do que se quer, e sem ninguém para desligar.
 *
 * A COMPARAÇÃO de versões não é testada aqui, e é de propósito: ela mora só no
 * banco (`versao_alcanca`). Uma segunda implementação neste arquivo divergiria
 * da primeira, e as duas estariam certas cada uma pela sua conta — o erro que
 * este projeto já pagou com `chancesDe` × `chancesDoPacote`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(AQUI, '..');

let pass = 0, fail = 0;
const ta = async (nome, fn) => {
  try { await fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};
const t = (nome, fn) => ta(nome, fn);

// ------------------------------------------------------------- o ambiente

/**
 * Carrega o módulo com `/__versao` e o Supabase de mentira. `?v=` força uma
 * instância nova a cada caso: o módulo guarda a resposta (`minha`) de propósito,
 * e o cache do primeiro caso responderia pelos outros.
 */
async function comServidor({ versao, rpc }) {
  const chamadas = [];
  const antes = { fetch: global.fetch, document: global.document };

  global.fetch = async (url) => {
    chamadas.push(String(url));
    if (versao === 'caiu') throw new Error('sem servidor local');
    if (!versao) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => versao };
  };

  const fake = () => ({
    style: { cssText: '' }, children: [], textContent: '', id: '',
    append(...x) { this.children.push(...x); },
  });
  const corpo = fake();
  global.document = { createElement: fake, body: corpo, documentElement: corpo };

  // O `req` do supabase.js é substituído por um de mentira: este teste não fala
  // com o banco (e não deve — ele prova a decisão do cliente, não a do servidor).
  const mod = await import(`./versao.js?v=${Math.random()}`);
  const supa = await import(`./supabase.js?v=${Math.random()}`);
  void supa;

  return { mod, corpo, chamadas, restaurar: () => Object.assign(global, antes) };
}

// A prova mais direta que dá para fazer sem subir servidor: o CONTRATO do que
// `selo()` monta a partir do que `/__versao` respondeu.
//
// `selo()` chama `minhaVersao()`, que só usa `fetch` — nada de Supabase. Então
// ele é testável inteiro aqui, e é ele que decide o que o banco vai comparar.

await ta('o selo leva a versão INSTALADA que o servidor local informou', async () => {
  const { mod, restaurar } = await comServidor({
    versao: { exe: '0.16.0', game: 'classic-duels-20260823-2308', dev: false },
  });
  try {
    assert.deepEqual(await mod.selo(),
      { p_game: 'classic-duels-20260823-2308', p_exe: '0.16.0' });
  } finally { restaurar(); }
});

await ta('o cliente NÃO carrega isenção própria — nem em desenvolvimento', async () => {
  // Houve aqui uma palavra combinada (`dev`) que o cliente mandava para passar
  // pelo piso, e ela era uma porta dos fundos permanente: qualquer um a digita
  // no console e nunca mais é barrado. Um cliente não pode ser a fonte da
  // própria isenção — quem passa em desenvolvimento é o ADMIN, e quem decide
  // isso é o servidor (`eh_admin()`), que o navegador não tem como forjar.
  const { mod, restaurar } = await comServidor({ versao: { exe: '', game: '', dev: true } });
  try {
    const s = await mod.selo();
    assert.deepEqual(s, { p_game: '', p_exe: '' });
    assert.equal(JSON.stringify(s).includes('dev'), false,
      'o selo voltou a carregar uma senha de isencao');
  } finally { restaurar(); }
});

await ta('e o módulo inteiro não contém senha de isenção', async () => {
  // Par de controle do caso acima: a asserção de cima olha só o que `selo()`
  // monta, e a porta dos fundos poderia voltar por outro caminho.
  const fonte = fs.readFileSync(path.join(WEB, 'js', 'versao.js'), 'utf8');
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(codigo, /p_exe:\s*'(?!')/,
    'p_exe recebeu um literal — a versao tem de vir do servidor local, nunca escrita aqui');
});

await ta('servidor local fora do ar: o selo vai VAZIO (e o banco recusa)', async () => {
  // "Não consegui perguntar" não pode virar uma versão inventada: seria abrir a
  // porta para o cliente que a trava existe para barrar. Vazio é a resposta
  // honesta, e do lado do banco vazio não alcança piso nenhum.
  const { mod, restaurar } = await comServidor({ versao: 'caiu' });
  try {
    assert.deepEqual(await mod.selo(), { p_game: '', p_exe: '' });
  } finally { restaurar(); }
});

await ta('a resposta de /__versao é lida UMA vez por página', async () => {
  const { mod, chamadas, restaurar } = await comServidor({
    versao: { exe: '0.16.0', game: 'g', dev: false },
  });
  try {
    await mod.selo(); await mod.selo(); await mod.minhaVersao();
    const n = chamadas.filter((u) => u.includes('/__versao')).length;
    assert.equal(n, 1, `perguntou ${n} vezes; e' uma consulta por clique de duelo`);
  } finally { restaurar(); }
});

// --------------------------------------------------- a partida em andamento

const { deveBloquear } = await import('./versao.js');

const REPROVADO = { ok: false, modo: 'bloquear', recado: 'atualize' };

await t('a parede NÃO sobe no meio de um duelo', () => {
  // Ela é `position: fixed; inset: 0`: por cima de um duelo vivo, o tabuleiro
  // some da tela de quem está no meio de uma jogada e a partida morre ali — o
  // motor segue no servidor local esperando uma resposta que ninguém pode dar.
  //
  // Nada se perde deixando terminar: quem barra é `iniciar_duelo`, na PORTA.
  // Todo duelo em andamento já foi autorizado.
  assert.equal(deveBloquear(REPROVADO, '/web/duel.html'), false);
});

await t('a parede NÃO sobe na tela de LOGIN', () => {
  // Ela cobria o formulário inteiro (`position: fixed; inset: 0`), e o sintoma
  // era o relato de 24/08/2026: *"trava numa home sem interação e sem
  // informações da conta, e no banco o login nem é realizado"*. Não era o login
  // falhando; era esta parede por cima dele.
  //
  // E o preço não era só cosmético: a isenção de admin (`eh_admin()`, migration
  // 0042) lê `auth.uid()`, que sem sessão é nulo. Barrando ANTES do login, o
  // admin de cliente velho não consegue se autenticar para ser isento — o
  // "trancar do lado de fora quem pode desligar a trava" que a 0042 existe para
  // impedir, um passo mais cedo.
  assert.equal(deveBloquear(REPROVADO, '/web/login.html'), false);
  assert.equal(deveBloquear(REPROVADO, '/web/recuperar.html'), false);
});

await t('mas sobe em qualquer outra tela — senão a trava vira enfeite', () => {
  // O PAR DE CONTROLE. Sem ele, um `return false` no topo passaria no teste de
  // cima e desligaria a checagem no jogo inteiro, em silêncio.
  assert.equal(deveBloquear(REPROVADO, '/web/index.html'), true);
  assert.equal(deveBloquear(REPROVADO, '/web/loja.html'), true);
  // E uma tela cujo nome TERMINA parecido, para a isencao ser por caminho e nao
  // por pedaco solto: `/web/js/login.html` nao existe, mas `deslogin.html` um
  // dia pode — a regra e' o arquivo, nao o sufixo de qualquer palavra.
  assert.equal(deveBloquear(REPROVADO, '/web/trilha.html'), true);
});

await t('cliente aprovado nunca é barrado', () => {
  assert.equal(deveBloquear({ ok: true, modo: 'bloquear' }, '/web/index.html'), false);
});

await t('no modo avisar não bloqueia, mesmo reprovado', () => {
  assert.equal(deveBloquear({ ok: false, modo: 'avisar' }, '/web/index.html'), false);
});

await t('sem veredito (o Supabase piscou) não bloqueia', () => {
  // Quem recusa com rigor é o banco, na hora de duelar. Errar para o lado do
  // cadeado aqui trancaria o jogo inteiro numa falha de rede — e sem ninguém
  // que pudesse entrar para desligar.
  assert.equal(deveBloquear(null, '/web/index.html'), false);
  assert.equal(deveBloquear(undefined, '/web/index.html'), false);
});
// ------------------------------------------------------------- a varredura

await t('toda página do jogo faz a checagem de versão', () => {
  const paginas = fs.readdirSync(WEB).filter((f) => f.endsWith('.html'));
  assert.ok(paginas.length >= 15, 'a varredura vazia passaria sozinha');
  const sem = paginas.filter((f) => !/versao\.js/.test(fs.readFileSync(path.join(WEB, f), 'utf8')));
  assert.deepEqual(sem, [], 'paginas sem a checagem:\n        ' + sem.join('\n        '));
});

await t('e o selo viaja na chamada de DUELAR, que é onde o banco confere', () => {
  const w = fs.readFileSync(path.join(WEB, 'js', 'wallet.js'), 'utf8');
  const corpo = w.slice(w.indexOf('export async function iniciarDuelo'));
  assert.match(corpo.slice(0, 600), /selo\(\)/,
    'iniciarDuelo parou de mandar a versao — o banco passa a ver todo mundo como cliente velho');
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
