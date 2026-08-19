/**
 * Ponte para a config versionada no projeto (store/*.json via o dev-server).
 *
 * O localStorage é a cópia de trabalho (rápida, síncrona, funciona offline), mas
 * ele NÃO viaja entre máquinas nem sobrevive a uma limpeza do navegador. Isto
 * espelha os dados em arquivos `store/<name>.json`, que vão no git — do mesmo
 * jeito que os decks vivem em `decks/`. Sem o dev-server no ar, tudo continua
 * funcionando só com o localStorage (o espelhamento é best-effort).
 *
 * Uso: no boot de cada página, `await pullFileEx(nome)` para trazer o arquivo do
 * disco; a cada gravação, `pushFile(nome, v)` para devolver (fire-and-forget).
 *
 * Quem chama deve só espelhar DEPOIS de ter lido — ver a trava em wallet.js e
 * boosters.js. Gravar antes de ler é como um estado vazio sobrescreve dados bons.
 */

// RELATIVO, e isto não é estilo: `banlist.js` importa este arquivo, e
// `banlist.test.mjs` roda em Node — que não resolve `/web/js/...` (vira
// `C:\web\js\...`). No browser os dois caminhos dão na mesma URL; em Node só
// este funciona. Trocar por absoluto quebra `node web/js/banlist.test.mjs`.
import { cabecalhoAuth, req } from './supabase.js';
import {
  memoriaFalsa, enfileirar, desenfileirar, listar, resumo,
} from './pendencias.js';

/**
 * Lê `store/<name>.json` distinguindo os dois "vazios":
 *   { alcancou: true,  data: {...} }  arquivo existe
 *   { alcancou: true,  data: null  }  servidor respondeu, arquivo ainda não existe
 *   { alcancou: false, data: null }  não deu para falar com o servidor
 *
 * A diferença importa: sem servidor, gravar por cima é arriscado (o disco pode
 * ter dados que não conseguimos ler). Com servidor e sem arquivo, criar é o certo.
 */
export async function pullFileEx(name) {
  // 1. Supabase primeiro. É o que faz publicar uma banlist ou um booster novo
  //    chegar ao jogador SEM Release nenhum — antes esses arquivos só viajavam
  //    dentro do `.exe`, então reequilibrar o deck do Kaiba obrigava todo mundo
  //    a atualizar o jogo inteiro.
  //
  //    A leitura é aberta (a policy `conteudo_ler_todos` usa `true`), então
  //    funciona até sem login — a tela inicial não pode depender de sessão.
  const remoto = await req(`conteudo?select=dados&chave=eq.${encodeURIComponent(name)}`);
  if (remoto.ok && Array.isArray(remoto.dados)) {
    if (remoto.dados.length > 0) return { alcancou: true, data: remoto.dados[0].dados };
    // Respondeu e não tem a chave: para o conteúdo global isso não é "vazio
    // confirmado", é "ainda não publiquei". Cai no disco em vez de devolver
    // null, senão o primeiro boot sobrescreveria o arquivo local com nada.
  }

  // 2. Disco (dev-server ou o `.exe`). Continua sendo o caminho offline.
  try {
    const r = await fetch(`/__store/${name}.json`, {
      cache: 'no-store',
      headers: await cabecalhoAuth(),
    });
    if (r.status === 404) return { alcancou: true, data: null };
    if (!r.ok) return { alcancou: false, data: null };
    return { alcancou: true, data: await r.json() };
  } catch {
    return { alcancou: false, data: null };
  }
}

/** Lê `store/<name>.json`. Devolve o objeto, ou null se não existe / sem server. */
export async function pullFile(name) {
  return (await pullFileEx(name)).data;
}

/**
 * Uma gravação em voo por arquivo; se chegarem outras enquanto isso, só a
 * ÚLTIMA é enviada depois. As demais são descartadas de propósito: cada envio
 * carrega o estado inteiro, então o mais novo já contém o que os anteriores
 * diriam.
 *
 * Sem isso, uma ação como abrir um pacote (que grava DP, coleção, pity e o
 * contador da UR em sequência) dispara quatro POSTs simultâneos. Além de
 * inútil, eles chegam fora de ordem — um estado velho podia sobrescrever um
 * novo — e concorriam pelo mesmo arquivo no disco.
 */
const emVoo = new Map();     // name -> Promise
const pendente = new Map();  // name -> último payload aguardando

/**
 * Grava nos DOIS lugares: no banco (para os outros jogadores receberem) e no
 * disco (para o arquivo continuar versionado no git).
 *
 * A gravação no banco só passa para admin — a RLS de `conteudo` exige
 * `eh_admin()`. Para o jogador comum ela leva 403 e é ignorada, que é o
 * comportamento certo: quem edita banlist/boosters é quem administra o jogo.
 */
async function enviar(name, data) {
  const cabecalho = await cabecalhoAuth();
  let banco = { ok: false, erro: 'sem sessão' };

  if (cabecalho.authorization) {
    // Esperar em vez de disparar e esquecer. Antes era `.catch(() => {})`: o
    // 403 de quem não é admin, a rede caída e a RLS recusando davam todos no
    // mesmo silêncio — o disco gravava, o banco não, e a tela dizia "salvo".
    // Quem edita conteúdo precisa saber se ele SAIU daqui.
    const r = await req('conteudo?on_conflict=chave', {
      method: 'POST',
      body: { chave: name, dados: data },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    banco = r.ok ? { ok: true, erro: null } : { ok: false, erro: r.error };
  }

  const disco = await fetch(`/__store/${name}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalho },
    body: JSON.stringify(data),
  }).then((r) => ({ ok: r.ok }), () => ({ ok: false }));

  return { banco, disco };
}

/** Quem quer saber como terminou cada gravação. `name -> callback`. */
const ouvintes = new Map();

/**
 * **A publicação que falhou aparece na tela — em QUALQUER página.**
 *
 * Só a Banlist e o editor de drop registravam um ouvinte; todo o resto publicava
 * fire-and-forget. Quando o banco recusava (403 de quem não é admin, sessão
 * vencida, rede caída), o disco gravava, a tela dizia "salvo" e a edição
 * simplesmente não existia para mais ninguém — que é o pior desfecho possível
 * para conteúdo compartilhado: quem editou continua vendo o certo.
 *
 * O aviso mora aqui, e não em cada página, por isso mesmo: são nove chaves e
 * quatro telas, e a próxima nasceria sem ele. Injeta o próprio elemento, no
 * mesmo padrão do `carddetail.js`.
 */
function avisoDePublicacao() {
  try {
    if (typeof document === 'undefined') return;   // Node (os testes)
    const texto = resumo(deposito());
    let caixa = document.getElementById('publicacao-falhou');

    // Fila vazia = está tudo na nuvem. O aviso some sozinho, sem ninguém
    // precisar fechá-lo — um aviso que sobra depois de resolvido ensina a
    // ignorar avisos.
    if (!texto) { caixa?.remove(); return; }

    if (!caixa) {
      caixa = document.createElement('div');
      caixa.id = 'publicacao-falhou';
      caixa.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;'
        + 'background:#3a0d14;color:#ffd9de;border:2px solid #e8455e;border-radius:4px;'
        + 'padding:10px 14px;font:12px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px #000a;'
        + 'max-width:640px;margin:0 auto;cursor:pointer';
      caixa.title = 'clique para tentar publicar agora';
      caixa.onclick = () => reenviarPendentes();
      document.body?.append(caixa);
    }
    caixa.textContent = `⚠ ${texto} — guardadas nesta máquina; estou tentando`
      + ' publicar sozinho. Clique para tentar agora.';
  } catch { /* um aviso não pode derrubar a gravação */ }
}

function avisar(name, r, data) {
  if (r && r.banco && r.banco.ok === false) {
    console.error(`[conteudo] "${name}" nao foi publicado:`, r.banco.erro);
    // Não some mais: fica na fila e o `reenviarPendentes` tenta sozinho até o
    // banco aceitar. Antes o aviso pedia "salve de novo" — o conserto era
    // manual, e quem fechasse a aba perdia a edição para todo mundo menos si.
    enfileirar(deposito(), name, data, r.banco.erro);
    avisoDePublicacao();
  } else if (r && r.banco && r.banco.ok === true) {
    desenfileirar(deposito(), name);
    avisoDePublicacao();
  }
  const cb = ouvintes.get(name);
  if (cb) { try { cb(r); } catch { /* a tela não pode derrubar a gravação */ } }
}

/** O `localStorage` do navegador, ou uma memória de mentira em Node/modo restrito. */
let memoria = null;
function deposito() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* modo privativo pode lançar só de tocar */ }
  return (memoria ??= memoriaFalsa());
}

/**
 * **Publica, e se não der, GUARDA para tentar de novo.**
 *
 * É o caminho das seis chaves com trava `leu*Disco` (`banlist`, `boosters`,
 * `cardlists`, `npcs`, `npc-base-meta`, `npc-deck-ativo`). A trava existe por
 * um bug real: uma máquina que não conseguiu LER a fonte não pode publicar por
 * cima do banco um estado que ela mesma inventou por padrão.
 *
 * O que estava errado não era a trava — era o que ela fazia com a edição:
 * descartava, e em quatro das seis sem dizer nada. Agora a edição vai para a
 * fila e sobe assim que a fonte estiver ao alcance.
 *
 * @param {boolean} fonteLida a hidratação desta chave alcançou banco ou disco?
 */
export function pushFileGuardado(name, data, fonteLida) {
  if (fonteLida) return void pushFile(name, data);
  enfileirar(deposito(), name, data, 'ainda não li a versão publicada desta chave');
  avisoDePublicacao();
  agendarReenvio();
}

/**
 * Tenta subir tudo o que ficou para trás. Sai calado quando não há nada.
 *
 * Roda sozinho: no boot de qualquer página que importe este módulo, quando a
 * conexão volta, e de tempos em tempos enquanto sobrar pendência. Uma chave só
 * sai da fila quando o BANCO aceita — o disco não conta, porque é justamente o
 * disco que já tinha e o banco que não.
 */
export async function reenviarPendentes() {
  const store = deposito();
  const fila = listar(store);
  if (!fila.length) return { tentadas: 0, subiram: 0 };

  let subiram = 0;
  for (const { name, data } of fila) {
    // Em voo agora: o `drenar` vai publicar a versão mais nova de qualquer
    // jeito, e insistir aqui só duplicaria o POST.
    if (emVoo.has(name)) continue;
    try {
      const r = await enviar(name, data);
      if (r?.banco?.ok) { desenfileirar(store, name); subiram++; }
    } catch { /* segue para a próxima; a fila continua guardando esta */ }
  }
  avisoDePublicacao();
  return { tentadas: fila.length, subiram };
}

/** Quais chaves ainda não chegaram ao banco. Para a tela poder mostrar. */
export const pendentes = () => listar(deposito()).map((x) => x.name);

let timerReenvio = null;
function agendarReenvio() {
  if (typeof setTimeout === 'undefined' || timerReenvio) return;
  timerReenvio = setTimeout(async () => {
    timerReenvio = null;
    await reenviarPendentes();
    // Sobrou alguma? Continua tentando. Sem pendência, o timer morre — nada de
    // um laço eterno batendo no banco à toa.
    if (listar(deposito()).length) agendarReenvio();
  }, 20000);
}

function drenar(name) {
  if (!pendente.has(name)) { emVoo.delete(name); return; }
  const proximo = pendente.get(name);
  pendente.delete(name);
  emVoo.set(name, enviar(name, proximo)
    .then((r) => { avisar(name, r, proximo); return r; })
    .finally(() => drenar(name)));
}

/**
 * Grava `store/<name>.json` no disco E a chave `<name>` no banco.
 *
 * Continua sem `await` para quem chama — as telas gravam a cada tecla e não
 * podem esperar a rede. Mas o RESULTADO deixou de se perder: registre um
 * ouvinte com {@link aoGravar} para saber se o banco aceitou.
 */
export function pushFile(name, data) {
  try {
    if (emVoo.has(name)) { pendente.set(name, data); return; }
    emVoo.set(name, enviar(name, data)
      .then((r) => { avisar(name, r, data); return r; })
      .finally(() => drenar(name)));
  } catch { /* sem servidor: só o localStorage guarda */ }
}

/**
 * Escuta o fim de cada `pushFile` desta chave.
 *
 * `cb({ banco: {ok, erro}, disco: {ok} })`. Um só ouvinte por chave — quem
 * registra depois substitui, o que basta: é a tela aberta que quer saber.
 */
export function aoGravar(name, cb) {
  if (cb) ouvintes.set(name, cb); else ouvintes.delete(name);
}

/**
 * Traz o arquivo do disco para uma chave do localStorage (se existir). Chame no
 * boot, ANTES de ler o estado. Não sobrescreve o localStorage quando o arquivo
 * não existe ainda (primeira vez), preservando o que já houver no navegador.
 */
export async function hydrate(name, storageKey) {
  const data = await pullFile(name);
  if (data === null || data === undefined) return false;
  try { localStorage.setItem(storageKey, JSON.stringify(data)); return true; }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// O REENVIO AUTOMÁTICO
//
// "Instantaneamente na nuvem" não pode depender de a rede estar boa no exato
// segundo em que o admin digitou. Três gatilhos, todos baratos:
//
//   • o BOOT de qualquer página que importe este módulo — é o que recupera a
//     edição feita ontem numa máquina offline;
//   • a CONEXÃO voltando (`online`), que é o caso comum do notebook que dormiu;
//   • o TIMER, enquanto sobrar pendência (ver `agendarReenvio`).
//
// Nada disto roda em Node: `window` não existe lá, e os testes importam este
// módulo de carona (`banlist.test.mjs` → `banlist.js` → aqui).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { reenviarPendentes(); });
  // Um respiro antes do primeiro: o boot já tem hidratação e banco de cartas
  // para carregar, e a fila quase sempre está vazia.
  setTimeout(() => {
    if (listar(deposito()).length) { reenviarPendentes(); agendarReenvio(); }
  }, 3000);
}
