/**
 * **A VERSÃO DESTE CLIENTE, e o que o servidor acha dela.**
 *
 * A regra é uma só e é do dono do jogo: *o cliente obedece ao que servimos*. Um
 * `.exe` não decide ficar numa versão antiga — ou está em dia, ou não joga.
 *
 * **Por que a trava não mora aqui.** Este arquivo roda na máquina de quem joga,
 * e o cliente que precisa ser barrado é justamente o que foi compilado ANTES
 * desta regra existir: ele não tem este módulo, não faz esta pergunta e não se
 * barraria nunca. Quem barra é o banco (`iniciar_duelo`, migration 0041), onde
 * a ausência da versão já é resposta — *não sei* nunca vira *pode*.
 *
 * O que existe deste lado é a CORTESIA: dizer na tela o que está acontecendo,
 * em vez de deixar a pessoa levar um erro seco ao clicar em duelar.
 *
 * **De onde sai a versão.** Do servidor local (`/__versao`), que lê o marcador
 * em DISCO — o que está instalado. Não o que o manifesto oferece: o cliente
 * travado é exatamente aquele que recebeu a oferta e não conseguiu aplicá-la, e
 * perguntar ao manifesto o faria jurar estar em dia enquanto roda código de duas
 * semanas atrás. Foi assim que o congelamento de 19/08/2026 passou dias sem
 * ninguém ver.
 */
import { req } from './supabase.js';

/** A resposta de `/__versao`, lida uma vez por página. */
let minha = null;

/**
 * Quem é este cliente: `{exe, game, dev}`.
 *
 * `dev: true` é o `npm run dev` — o repositório não é uma instalação, ele É a
 * versão mais nova que existe.
 *
 * Devolve `null` quando não deu para perguntar. Isso é diferente de `dev` e de
 * uma versão vazia, e a diferença importa: "não consegui perguntar" não pode
 * virar um cadeado na cara de quem só teve um soluço de rede local. Quem decide
 * com rigor é o servidor, na hora de duelar.
 */
export async function minhaVersao() {
  if (minha !== null) return minha;
  try {
    const r = await fetch('/__versao', { cache: 'no-store' });
    minha = r.ok ? await r.json() : null;
  } catch {
    minha = null;
  }
  return minha;
}

/**
 * O que o servidor acha desta versão.
 *
 * `{ok, modo, recado, game_ok, exe_ok}` — o veredito vem PRONTO do banco, e não
 * os números para o navegador comparar. Comparar aqui seria deixar a conta com o
 * lado que a trava existe para barrar; e seriam duas implementações da mesma
 * regra, que divergem na primeira correção.
 */
export async function checarVersao() {
  const eu = await minhaVersao();
  if (eu?.dev) return { ok: true, modo: 'avisar', dev: true };

  const r = await req('rpc/checar_versao', {
    method: 'POST',
    body: { p_game: eu?.game ?? '', p_exe: eu?.exe ?? '' },
  });
  if (!r.ok || !r.dados) return null;      // sem resposta: ver `exigirVersao`
  return r.dados;
}

/**
 * Os campos que acompanham toda chamada de "vou jogar". `iniciar_duelo` os lê;
 * um cliente velho simplesmente não os manda, e é assim que o banco o reconhece.
 */
export async function selo() {
  const eu = await minhaVersao();
  // Em desenvolvimento não há marcador em disco, então isto vai VAZIO — e vazio
  // não alcança piso nenhum. Quem passa ali é o ADMIN, e a isenção é decidida
  // pelo servidor (`eh_admin()`), nunca por um campo que o cliente manda.
  //
  // Havia aqui uma palavra combinada (`dev`) e ela estava errada: qualquer um a
  // digitaria no console e teria uma porta dos fundos permanente na trava. Um
  // cliente NÃO pode ser a fonte da própria isenção.
  return { p_game: eu?.game ?? '', p_exe: eu?.exe ?? '' };
}

/**
 * A CORTESIA: se o servidor manda bloquear, cobre a tela e explica.
 *
 * Só bloqueia quando o servidor DIZ para bloquear. Sem resposta, não faz nada —
 * e não é frouxidão: quem recusa de verdade é `iniciar_duelo`, que trata a
 * ausência da versão como reprovação. Errar para o lado do cadeado aqui
 * trancaria o jogo inteiro no dia em que o Supabase piscasse.
 */
/**
 * A REGRA, sem DOM e sem rede — é ela que `versao.test.mjs` prova.
 *
 * Duas decisões, e as duas erram CALADAS em direções opostas:
 *
 *   • **bloquear de menos** e a trava vira enfeite: o cliente velho continua
 *     jogando e ninguém percebe, porque "funcionou" é o estado normal;
 *   • **bloquear demais** e a tela é coberta na cara de quem não devia ser
 *     barrado — inclusive no meio de um duelo, que é onde dói.
 *
 * **A PARTIDA EM ANDAMENTO NÃO É INTERROMPIDA. Nunca.** A parede é
 * `position: fixed; inset: 0`; subi-la sobre um duelo vivo tira o tabuleiro da
 * tela de quem está no meio de uma jogada, e o duelo morre ali — o motor segue
 * rodando no servidor local, esperando uma resposta que ninguém tem mais como
 * dar.
 *
 * E não se ganha nada com isso: quem barra de verdade é `iniciar_duelo`
 * (migrations 0041/0042), e ele barra na **porta**. Um cliente velho não
 * CONSEGUE começar uma partida, então todo duelo em andamento já foi
 * autorizado — deixá-lo terminar não abre brecha nenhuma.
 *
 * É a mesma regra que o updater já segue: `/__update/aplicar` responde 409
 * ("termine o duelo") em vez de trocar os arquivos debaixo de quem joga. Duas
 * telas com a mesma pergunta precisam da mesma resposta.
 */
export function deveBloquear(veredito, caminho) {
  const p = String(caminho ?? '');
  if (p.endsWith('/duel.html')) return false;

  // **A TELA DE LOGIN TAMBÉM NÃO.** Barrar aqui não protege nada e cria um
  // beco sem saída, por dois motivos que se somam:
  //
  //   • quem barra de verdade é `iniciar_duelo`, e ele barra na PORTA — ninguém
  //     chega a jogar por ter visto o formulário de login;
  //   • a isenção de ADMIN (migration 0042) é `eh_admin()`, que lê `auth.uid()`.
  //     Sem sessão ela é sempre `false`. Com a parede subindo ANTES do login, o
  //     admin de cliente velho é barrado antes de poder se autenticar para ser
  //     isento — exatamente o "trancar do lado de fora quem pode desligar a
  //     trava" que a 0042 foi escrita para impedir, um passo mais cedo.
  //
  // Foi assim que o relato chegou em 24/08/2026: *"fica travado numa home sem
  // interação e sem informações da conta, e no banco o login nem é realizado"*.
  // Não era o login falhando — era esta parede, `position: fixed; inset: 0`, por
  // cima do formulário. Sem erro em lugar nenhum.
  if (p.endsWith('/login.html') || p.endsWith('/recuperar.html')) return false;

  // Sem veredito (o Supabase piscou) NÃO bloqueia: quem recusa com rigor é o
  // banco, na hora de duelar. Errar para o lado do cadeado aqui trancaria o
  // jogo inteiro num soluço de rede, e sem ninguém para desligar.
  if (!veredito || veredito.ok || veredito.modo !== 'bloquear') return false;
  return true;
}

/**
 * A CORTESIA: se o servidor manda bloquear, cobre a tela e explica — em vez de
 * deixar a pessoa levar um erro seco ao clicar em duelar.
 */
export async function exigirVersao() {
  let v;
  try { v = await checarVersao(); } catch { return true; }
  if (!deveBloquear(v, location.pathname)) return true;

  parede(v);
  return false;
}
function parede(v) {
  const fundo = document.createElement('div');
  fundo.id = 'versao-parede';
  fundo.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99998', 'background:#0b0b10',
    'color:#e8e8f0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:14px',
    'font:14px/1.6 monospace', 'text-align:center', 'padding:24px',
  ].join(';');

  const t = document.createElement('div');
  t.style.cssText = 'font-size:20px;color:#e5c46a;letter-spacing:2px';
  t.textContent = 'CLASSIC DUELS DESATUALIZADO';

  const p = document.createElement('div');
  p.style.cssText = 'max-width:560px';
  // `textContent`: o recado vem do banco, editável sem publicar nada.
  p.textContent = v.recado || 'Atualize o jogo para continuar.';

  const detalhe = document.createElement('div');
  detalhe.style.cssText = 'opacity:.6;font-size:11px';
  // QUAL das duas metades reprovou. É o que separa "feche e abra" de
  // "reinstale": o front vem no `game.zip` e chega sozinho; o executável, não —
  // um exe abaixo de 0.15.0 não aplica pacote nenhum, e esperar não resolve.
  detalhe.textContent = v.exe_ok === false
    ? 'o executavel esta antigo demais para se atualizar sozinho — peca o instalador novo'
    : 'feche o jogo e abra de novo para receber a atualizacao';

  fundo.append(t, p, detalhe);
  (document.body ?? document.documentElement).append(fundo);
}
