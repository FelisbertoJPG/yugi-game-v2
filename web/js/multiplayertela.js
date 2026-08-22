/**
 * A tela do multiplayer (`web/multiplayer.html`).
 *
 * Só desenho e cliques — toda regra está no banco (`web/js/multiplayer.js` é a
 * camada fina que chama). Quando algo é recusado, a mensagem que aparece é a que
 * o Postgres escreveu, porque ela foi redigida para ser lida por gente.
 */
import { requireLogin } from '/web/js/auth.js';
import * as mp from '/web/js/multiplayer.js';
// Estar nesta tela conta como estar jogando: sem bater o ponto aqui, quem
// espera um adversario aparece OFFLINE na lista de amigos e ninguem o chama.
import { baterPonto } from '/web/js/presenca.js';

const $ = (id) => document.getElementById(id);
const texto = (s) => document.createTextNode(String(s ?? ''));

/**
 * Eu estou esperando alguém entrar na MINHA sala?
 *
 * Só nesse caso a tela entra no duelo sozinha quando a sala fecha. Chegando com
 * uma partida já em andamento, redirecionar viraria o laço que travou o
 * primeiro teste.
 */
let aguardavaSala = false;

/** Nunca monte HTML com nome de jogador por concatenação — nome vem de fora. */
function el(tag, cls, conteudo) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (conteudo != null) n.appendChild(texto(conteudo));
  return n;
}

function avisar(id, msg, tipo = 'erro') {
  const n = $(id);
  n.className = `aviso ${tipo}`;
  n.textContent = msg ?? '';
}

const deckEscolhido = () => $('deck').value || '';

function exigeDeck(idAviso) {
  if (deckEscolhido()) return true;
  avisar(idAviso, 'escolha um deck antes — e ele precisa estar salvo no Deck Builder');
  return false;
}

// ------------------------------------------------------------------ amigos

function itemJogador(j, botoes) {
  const li = el('div', 'item');
  const nome = el('div', 'nome');
  nome.appendChild(el('span', 'tag', `[${j.etiqueta}] `));
  nome.appendChild(texto(j.usuario));
  li.appendChild(nome);
  for (const b of botoes) li.appendChild(b);
  return li;
}

function botao(rotulo, aoClicar, cls) {
  const b = el('button', cls, rotulo);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await aoClicar(); } finally { b.disabled = false; }
  });
  return b;
}

async function pintarAmigos() {
  const r = await mp.amigos();
  const alvo = $('amigos');
  alvo.replaceChildren();

  if (!r.ok) { avisar('aviso-amigos', r.erro); return; }
  const lista = r.dados ?? [];
  if (!lista.length) {
    alvo.appendChild(el('div', 'vazio', 'sua lista esta vazia — procure alguem pela etiqueta acima'));
    return;
  }

  for (const a of lista) {
    let botoes;
    if (a.direcao === 'recebido') {
      botoes = [
        botao('aceitar', async () => {
          const x = await mp.responderAmizade(a.id, true);
          avisar('aviso-amigos', x.ok ? `${a.usuario} entrou na sua lista` : x.erro, x.ok ? 'ok' : 'erro');
          await pintarAmigos();
        }),
        botao('recusar', async () => {
          await mp.responderAmizade(a.id, false);
          await pintarAmigos();
        }, 'secundario'),
      ];
    } else if (a.direcao === 'enviado') {
      botoes = [el('span', 'aguardando', 'aguardando')];
    } else {
      botoes = [
        botao('desafiar', async () => {
          if (!exigeDeck('aviso-amigos')) return;
          const x = await mp.desafiar(a.id, deckEscolhido());
          if (!x.ok) { avisar('aviso-amigos', x.erro); return; }
          avisar('aviso-amigos', `desafio enviado para ${a.usuario} — esperando ele aceitar`, 'ok');
          await pintarPartida();
        }),
        botao('remover', async () => {
          if (!confirm(`Remover ${a.usuario} da sua lista?`)) return;
          await mp.removerAmigo(a.id);
          await pintarAmigos();
        }, 'secundario'),
      ];
    }
    alvo.appendChild(itemJogador(a, botoes));
  }
}

async function buscar() {
  const termo = $('busca').value.trim();
  const alvo = $('resultados');
  alvo.replaceChildren();
  avisar('aviso-amigos', '');

  if (termo.length < 2) { avisar('aviso-amigos', 'digite pelo menos 2 caracteres'); return; }

  const r = await mp.buscar(termo);
  if (!r.ok) { avisar('aviso-amigos', r.erro); return; }

  const achados = r.dados ?? [];
  if (!achados.length) {
    alvo.appendChild(el('div', 'vazio', `ninguem encontrado para "${termo}"`));
    return;
  }

  for (const j of achados) {
    alvo.appendChild(itemJogador(j, [
      botao('adicionar', async () => {
        const x = await mp.pedirAmizade(j.etiqueta);
        if (!x.ok) { avisar('aviso-amigos', x.erro); return; }
        avisar('aviso-amigos',
               x.dados?.estado === 'aceito'
                 ? `${j.usuario} ja tinha te adicionado — voces sao amigos agora`
                 : `pedido enviado para ${j.usuario}`, 'ok');
        $('resultados').replaceChildren();
        $('busca').value = '';
        await pintarAmigos();
      }),
    ]));
  }
}

// ---------------------------------------------------------------- desafios

function pintarDesafios(lista) {
  const alvo = $('desafios');
  alvo.replaceChildren();

  for (const d of lista) {
    const linha = el('div', 'desafio');
    const t = el('div', 'txt');
    const b = el('b', null, `[${d.etiqueta}] ${d.usuario}`);
    t.appendChild(b);
    t.appendChild(texto(' chamou voce para duelar'));
    linha.appendChild(t);

    linha.appendChild(botao('aceitar', async () => {
      if (!exigeDeck('aviso-sala')) return;
      const x = await mp.aceitarDesafio(d.partida, deckEscolhido());
      if (!x.ok) { avisar('aviso-sala', x.erro); return; }
      entrarNoDuelo(x.dados?.partida ?? d.partida);
    }));
    linha.appendChild(botao('recusar', async () => {
      await mp.recusarDesafio(d.partida);
      alvo.replaceChildren();
    }, 'secundario'));

    alvo.appendChild(linha);
  }
}

/** A sala fechou: os dois entram no mesmo duelo. */
function entrarNoDuelo(partida) {
  if (!partida) { avisar('aviso-sala', 'sala sem id — nao consegui abrir o duelo'); return; }
  location.href = `/web/duel.html?partida=${encodeURIComponent(partida)}`;
}

// ---------------------------------------------------------------- a partida

async function pintarPartida() {
  const p = await mp.minhaPartida();
  const bloco = $('bloco-partida');
  const cod = $('bloco-codigo');

  if (!p) {
    bloco.hidden = true;
    cod.hidden = true;
    $('btn-criar').disabled = false;
    return;
  }

  bloco.hidden = false;
  $('btn-criar').disabled = true;

  if (p.estado === 'em_andamento') {
    // Aqui NÃO se redireciona sozinho, e o motivo é um laço que travou o
    // primeiro teste: a partida não saía de 'em_andamento', a tela via isso e
    // mandava de volta para o duelo — abrir o Multiplayer virava um vaivém sem
    // fim, sem nenhuma forma de escapar.
    //
    // Só há auto-redirecionamento quando a sala fecha DIANTE DOS OLHOS de quem
    // está esperando (`aguardavaSala` abaixo). Chegando com uma partida já em
    // andamento, o jogador escolhe: voltar para ela ou desistir.
    if (aguardavaSala) { aguardavaSala = false; entrarNoDuelo(p.id); return; }

    $('estado-partida').textContent = 'você tem um duelo em andamento';
    $('btn-voltar-duelo').hidden = false;
    $('btn-abandonar').textContent = 'desistir do duelo';
    return;
  }

  aguardavaSala = true;   // estou esperando: quando fechar, entro sozinho
  $('btn-voltar-duelo').hidden = true;
  $('btn-abandonar').textContent = 'cancelar a sala';
  $('estado-partida').textContent =
    p.convidado ? 'desafio enviado, esperando o outro aceitar'
                : 'sala aberta, esperando alguem entrar com o codigo';

  if (p.convite) {
    cod.hidden = false;
    $('codigo').textContent = p.convite;
  }
}

// -------------------------------------------------------------------- boot

async function copiar(txt, idAviso, msg) {
  try {
    await navigator.clipboard.writeText(txt);
    avisar(idAviso, msg, 'ok');
  } catch {
    // Sem permissão de área de transferência o texto continua na tela para
    // seleção manual — avisar é melhor que um botão que não faz nada.
    avisar(idAviso, 'nao consegui copiar — selecione o texto e copie na mao');
  }
}

async function boot() {
  if (!(await requireLogin())) return;

  const perfil = await mp.meuPerfil();
  $('eu-rotulo').textContent = mp.rotulo(perfil);
  $('btn-copiar-tag').addEventListener('click', () =>
    copiar(String(perfil?.etiqueta ?? ''), 'aviso-amigos', 'etiqueta copiada'));

  const decks = await mp.meusDecks();
  const sel = $('deck');
  sel.replaceChildren();
  if (!decks.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'nenhum deck salvo — monte um no Deck Builder';
    sel.appendChild(o);
  } else {
    for (const nome of decks) {
      const o = document.createElement('option');
      o.value = nome;
      o.textContent = nome;
      sel.appendChild(o);
    }
  }

  $('btn-buscar').addEventListener('click', buscar);
  $('busca').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });

  $('btn-criar').addEventListener('click', async () => {
    if (!exigeDeck('aviso-sala')) return;
    const r = await mp.criarSala(deckEscolhido());
    if (!r.ok) { avisar('aviso-sala', r.erro); return; }
    avisar('aviso-sala', 'sala criada — mande o codigo para quem voce quer duelar', 'ok');
    await pintarPartida();
  });

  $('btn-copiar-codigo').addEventListener('click', () =>
    copiar($('codigo').textContent, 'aviso-sala', 'codigo copiado'));

  $('btn-entrar').addEventListener('click', async () => {
    const c = $('convite').value.trim();
    if (!c) { avisar('aviso-sala', 'cole o codigo do convite'); return; }
    if (!exigeDeck('aviso-sala')) return;

    // Mostra contra quem é ANTES de entrar: o código queima no primeiro que usa.
    const espiada = await mp.espiarSala(c);
    if (espiada.ok && espiada.dados?.existe === false) {
      avisar('aviso-sala', 'codigo invalido ou ja usado');
      return;
    }

    const r = await mp.entrarNaSala(c, deckEscolhido());
    if (!r.ok) { avisar('aviso-sala', r.erro); return; }
    entrarNoDuelo(r.dados?.partida);
  });

  $('btn-voltar-duelo').addEventListener('click', async () => {
    const p = await mp.minhaPartida();
    if (p) entrarNoDuelo(p.id);
  });

  $('btn-abandonar').addEventListener('click', async () => {
    const p = await mp.minhaPartida();
    if (!p) return;

    // Sala que ainda não formou é só cancelar. Duelo em andamento é DESISTIR —
    // o outro ganha, e por isso pergunta antes.
    if (p.estado === 'em_andamento') {
      if (!confirm('Desistir do duelo? Seu adversário vence.')) return;
      const r = await mp.encerrar(p.id);
      avisar('aviso-sala', r.ok ? 'você desistiu do duelo' : r.erro, r.ok ? 'ok' : 'erro');
    } else {
      await mp.abandonar(p.id);
      avisar('aviso-sala', 'sala cancelada');
    }
    aguardavaSala = false;
    await pintarPartida();
  });

  $('btn-destravar').addEventListener('click', async () => {
    if (!confirm('Encerrar TUDO que você tem em aberto?\n\n'
               + 'Use se um duelo travou e você não consegue começar outro.')) return;
    const r = await mp.sairDeTudo();
    avisar('aviso-sala',
           r.ok ? `pronto — ${r.dados?.encerradas ?? 0} partida(s) encerrada(s)` : r.erro,
           r.ok ? 'ok' : 'erro');
    aguardavaSala = false;
    await pintarPartida();
  });

  $('btn-voltar').addEventListener('click', () => { location.href = '/web/index.html'; });

  await pintarAmigos();
  await pintarPartida();

  // Um amigo pode te chamar a qualquer momento enquanto esta tela está aberta.
  mp.vigiarDesafios(pintarDesafios);

  // E a minha própria sala pode fechar a qualquer momento — quando o convidado
  // aceitar, `pintarPartida` leva os dois para o duelo.
  setInterval(pintarPartida, 3000);

  baterPonto();
}

boot();
