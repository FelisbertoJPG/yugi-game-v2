/**
 * Onde a SESSÃO do jogador é guardada — a caixa "manter login nesta máquina".
 *
 *     node web/js/sessao.test.mjs
 *
 * A regra é de uma linha ("marcou = localStorage, não marcou = sessionStorage")
 * e erra CALADA nas duas direções, sempre a favor de quem não devia entrar:
 *
 *   • ler os dois armazenamentos "para não perder a sessão" faz uma sessão
 *     antiga esquecida no `localStorage` manter a pessoa entrada para sempre —
 *     a caixa desmarcada promete exatamente o contrário, e nada acusa, porque
 *     do lado de fora "continuou logado" é indistinguível de "funcionou";
 *   • gravar sem apagar a cópia do outro lado deixa uma sessão fantasma, que
 *     ressuscita no dia em que a escolha mudar de lado;
 *   • e `sair()` que limpa só um dos dois é um "sair" que não sai — o pior
 *     desfecho possível num PC compartilhado.
 *
 * O módulo é importado de verdade (`supabase.js`), nunca copiado: os dois
 * armazenamentos são dublês, mas as funções são as que o jogo chama.
 */

// Dublês dos dois armazenamentos do navegador. Precisam existir ANTES do
// import: o módulo os lê por nome global, como no navegador.
function storeFalso() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: (k) => dados.delete(k),
    get tamanho() { return dados.size; },
    cru: dados,
  };
}

globalThis.localStorage = storeFalso();
globalThis.sessionStorage = storeFalso();

const {
  manterLogin, definirManterLogin, sessao, limparSessao, atualizarSessao,
} = await import('./supabase.js');

let ok = 0, falhou = 0;
const t = (nome, cond) => {
  if (cond) { ok++; console.log('  OK   ' + nome); }
  else { falhou++; console.log('  FALHOU ' + nome); }
};

const CHAVE = 'ygo:sb-session';
const umaSessao = (marca) => JSON.stringify({ access_token: marca, expires_at: 0 });

function limparTudo() {
  localStorage.cru.clear();
  sessionStorage.cru.clear();
}

// ---------------------------------------------------- a escolha em si

limparTudo();
t('sem escolha nenhuma, o padrão é NÃO manter', manterLogin() === false);

definirManterLogin(true);
t('marcar a caixa fica gravado', manterLogin() === true);

definirManterLogin(false);
t('desmarcar apaga a escolha', manterLogin() === false);

// A escolha mora no localStorage MESMO quando a resposta é não — é ela que faz
// a caixa aparecer do jeito que a pessoa deixou. Só a SESSÃO muda de lugar.
definirManterLogin(true);
t('a escolha mora no localStorage (é preferência, não sessão)',
  localStorage.getItem('ygo:manter-login') === '1');

// ------------------------------------------- onde a sessão é guardada

limparTudo();
definirManterLogin(false);
atualizarSessaoDoZero('sem-manter');
t('sem manter: a sessão vai para o sessionStorage (morre com a janela)',
  sessionStorage.getItem(CHAVE) !== null);
t('e NÃO sobra nada no localStorage',
  localStorage.getItem(CHAVE) === null);

limparTudo();
definirManterLogin(true);
atualizarSessaoDoZero('com-manter');
t('com manter: a sessão vai para o localStorage (sobrevive ao fechar)',
  localStorage.getItem(CHAVE) !== null);
t('e NÃO sobra nada no sessionStorage',
  sessionStorage.getItem(CHAVE) === null);

// --------------------------------- a sessão do outro lado não vale

// O caso que a caixa desmarcada existe para impedir: alguém entrou com "manter"
// ligado um dia, e hoje entra com ele desligado. A sessão antiga continua no
// localStorage — e não pode valer, senão a escolha de hoje não muda nada.
limparTudo();
localStorage.setItem(CHAVE, umaSessao('sessao-velha'));
definirManterLogin(false);
t('sessão esquecida no localStorage NÃO vale com a caixa desmarcada',
  sessao() === null);

// E a simétrica: com a caixa marcada, uma sessão de janela não é promovida.
limparTudo();
sessionStorage.setItem(CHAVE, umaSessao('so-desta-janela'));
definirManterLogin(true);
t('sessão de janela NÃO vale com a caixa marcada', sessao() === null);

// ------------------------------------------------- gravar não deixa cópia

// A troca de lado é o momento perigoso: gravar no lado novo sem apagar o velho
// deixa uma sessão fantasma esperando a próxima vez que a escolha mudar.
limparTudo();
definirManterLogin(true);
atualizarSessaoDoZero('primeira');
definirManterLogin(false);
atualizarSessaoDoZero('segunda');
t('trocar de lado não deixa cópia no armazenamento antigo',
  localStorage.getItem(CHAVE) === null && sessionStorage.getItem(CHAVE) !== null);

// ------------------------------------------------------------- sair

// "Sair" que limpa só um dos dois é um sair que não sai.
limparTudo();
localStorage.setItem(CHAVE, umaSessao('a'));
sessionStorage.setItem(CHAVE, umaSessao('b'));
limparSessao();
t('sair limpa os DOIS armazenamentos',
  localStorage.getItem(CHAVE) === null && sessionStorage.getItem(CHAVE) === null);

// -------------------------------------------- atualizarSessao não emigra

// `me()` grava o nome no jogo por aqui. Antes ele escrevia no `localStorage` na
// mão — o que, com a caixa desmarcada, plantava a sessão no lugar de onde
// ninguém a apaga.
limparTudo();
definirManterLogin(false);
atualizarSessaoDoZero('x');
atualizarSessao({ usuario: 'Yugi' });
t('atualizarSessao grava do lado certo',
  JSON.parse(sessionStorage.getItem(CHAVE)).usuario === 'Yugi'
  && localStorage.getItem(CHAVE) === null);

t('atualizarSessao sem sessão nenhuma devolve null (não inventa uma)',
  (limparTudo(), atualizarSessao({ usuario: 'ninguem' })) === null);

// ------------------------------- a faxina do carregamento do módulo

// Ela roda uma vez, no `import` — então aqui se prova a REGRA dela, com o mesmo
// teste que ela faz, mais o par controle. O caso real é o dia da atualização:
// todo jogador logado tinha a sessão no `localStorage` e nenhuma escolha
// gravada, e ela ficaria ali com um refresh token bom para sempre.
{
  limparTudo();
  definirManterLogin(false);
  localStorage.setItem(CHAVE, umaSessao('de-antes-da-caixa'));
  // (a mesma condição da faxina em `supabase.js`)
  if (!manterLogin()) localStorage.removeItem(CHAVE);
  t('sessão de antes da caixa existir é varrida quando a escolha é NÃO',
    localStorage.getItem(CHAVE) === null);

  limparTudo();
  definirManterLogin(true);
  localStorage.setItem(CHAVE, umaSessao('escolheu-manter'));
  if (!manterLogin()) localStorage.removeItem(CHAVE);
  t('par CONTROLE: quem escolheu manter NÃO é varrido',
    localStorage.getItem(CHAVE) !== null);
}

console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);

/**
 * Põe uma sessão pelo caminho do módulo. `guardar` não é exportada de
 * propósito (quem grava sessão é o login), então o caminho público equivalente
 * é escrever no armazenamento que a escolha manda e deixar `atualizarSessao`
 * fazer a gravação de verdade — que é exatamente o `guardar` interno.
 */
function atualizarSessaoDoZero(marca) {
  const store = manterLogin() ? localStorage : sessionStorage;
  store.setItem(CHAVE, umaSessao(marca));
  atualizarSessao({});   // reescreve pelo módulo: é ele quem limpa o outro lado
}
