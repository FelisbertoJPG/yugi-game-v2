/**
 * Mundo — o cenário andável em three.js, e o lugar onde os jogadores se
 * encontram.
 *
 * Ele nasceu como prova de conceito do mundo andável (ao lado de
 * `cidade.html`), com os adversários de `npcs.js` esperando na clareira. Hoje é
 * outra coisa: **um lugar de ENCONTRO**. Entra-se pelo menu da home, anda-se
 * pela floresta, vê-se quem mais está andando — e `Esc` volta. Não há duelo
 * aqui, nem conversa, nem esbarrão: quem duela contra o jogo é a Trilha, quem
 * duela contra gente é o Multiplayer.
 *
 * Divisão de trabalho, a mesma do mundo 2D: `floresta.js` decide (relevo, onde
 * nasce cada árvore, o que bloqueia), `floresta3d.js` e `boneco3d.js` desenham,
 * `mundovivo.js` cuida de quem mais está aqui, e este arquivo cuida do que muda
 * a cada quadro — entrada, câmera, colisão, etiquetas.
 *
 * Duas coisas erram CALADAS aqui e por isso estão comentadas onde acontecem:
 * o redimensionamento (feito no LAÇO, nunca num `ResizeObserver`) e o WebGL
 * que não sobe (que sem tratamento é uma tela preta sem uma linha no console).
 */
import * as THREE from '/web/vendor/three/three.module.min.js';
import { MUNDO, construirFloresta, alturaDoChao, mover } from '/web/js/floresta.js';
import { montarCena } from '/web/js/floresta3d.js';
import { criarBoneco, ALTURA } from '/web/js/boneco3d.js';
import { NPCS, loadNpcDecks, getNpcActiveDeck, hydrateCustomNpcs } from '/web/js/npcs.js';
import { SLOTS, NOME_DO_SLOT, PALETA, normalizar, pecasDoSlot, paraGravar } from '/web/js/aparencia.js';
import { getDP, hydrateWallet } from '/web/js/wallet.js';
import { YgoDB } from '/ygo-data/src/ygodb.js';
import { requireLogin } from '/web/js/auth.js';
import { SUPABASE_URL, SUPABASE_KEY, tokenValido, contaAtual, perfilAtual, req } from '/web/js/supabase.js';
import { baterPonto } from '/web/js/presenca.js';
import { entrarNoMundo, desvioDeEntrada, normalizarGiro } from '/web/js/mundovivo.js';
import { prepararModelos } from '/web/js/modelos.js';
import { nomeDoCenario, carregarCenario, assentar, colisoresDoCenario } from '/web/js/cenario.js';
import { montarCenario } from '/web/js/cenario3d.js';
import { coresPara } from '/web/js/actors.js';
import { catalogoDe } from '/web/js/personagens.js';
import { prepararPersonagens, estadoDosPersonagens } from '/web/js/personagens3d.js';
import { meusItens } from '/web/js/itens.js';

const $ = (id) => document.getElementById(id);
const ART = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;

/**
 * **Os adversários estão DESLIGADOS.**
 *
 * O Mundo virou um lugar de encontro entre pessoas, e um duelista de máquina
 * parado numa clareira ao lado disso responde a outra pergunta — a de "contra
 * quem eu jogo", que é da **Trilha de Duelos**, onde cada vitória libera o
 * próximo. Tê-los aqui também abriria a porta que a Trilha fecha: esta tela
 * mostra TODOS os adversários cadastrados, sem cadeado nenhum, e duelar por
 * aqui furaria a campanha inteira — a mesma armadilha que `adversario.html` e
 * `cidade.html` já são, e que é o motivo de as duas terem ido para a Área de
 * Teste.
 *
 * A máquina de habitantes continua servindo aos dois: ligar isto de volta é
 * mudar esta linha, e nada abaixo precisa saber a diferença. Por isso a lista
 * é montada por uma condição e não apagada — o que está desligado continua
 * exercitado pelo mesmo código que desenha as pessoas.
 */
const NPCS_NO_MUNDO = false;

/** Quanto tempo o corpo de outro jogador leva para alcançar a posição nova. */
const SUAVIZA_S = 0.10;

/**
 * Salto maior que isto não é caminhada, é reaparecimento — quem voltou de uma
 * aba escondida, ou de uma reconexão. Interpolar por cima disso faria o corpo
 * atravessar a floresta em linha reta, passando dentro das árvores.
 */
const TELETRANSPORTE = 6;

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- boot
// Tela de JOGADOR, e não mais da Área de Teste: ela entrou no menu da home no
// lugar do Multiplayer. `requireLogin` porque sem sessão não há nem identidade
// para mostrar aos outros — e é a sessão que o canal de tempo real exige.
const usuario = await requireLogin();
if (!usuario) throw new Error('sem sessão');

// Em paralelo: as duas são idas de rede independentes, e encadeá-las só
// atrasaria a abertura da floresta.
const [conta, perfil] = await Promise.all([
  contaAtual().catch(() => null),
  perfilAtual().catch(() => null),
]);

const meuId = conta?.id ?? null;

// A minha aparência sai da MINHA linha (a policy de `perfis` permite ler a
// própria), e não da `rpc/aparencias`, que existe para as dos OUTROS. Uma
// consulta pequena e direta aqui evita alargar o `perfilAtual`, que roda em
// toda página de admin e não tem nada a ver com roupa.
let aparenciaSalva = null;
if (meuId) {
  const r = await req(`perfis?select=aparencia&id=eq.${encodeURIComponent(meuId)}`)
    .catch(() => ({ ok: false }));
  if (r.ok && r.dados?.[0]) aparenciaSalva = r.dados[0].aparencia;
}

// Os atalhos para a Área de Teste nascem `hidden` e só aparecem para quem é
// admin — ao contrário, eles piscariam na tela de todo jogador no intervalo
// entre o boot e a resposta do perfil. É o mesmo guarda do botão "⚙ Área de
// Teste" da home, e continua sendo PORTA e não fechadura: quem barra de verdade
// é a RLS (as duas telas chamam `requireAdmin` por conta própria).
if (perfil?.admin) { $('btn-2d').hidden = false; $('btn-teste').hidden = false; }

await hydrateWallet();
$('dp').textContent = `${getDP()} DP`;

// A presença do BANCO — o "quem está jogando agora" que a home e a lista de
// amigos leem. Andar na floresta conta como estar jogando, como o Multiplayer e
// o duelo contam. Nada tem a ver com ver os outros aqui dentro (isso é
// `mundovivo.js`): são perguntas diferentes, com prazos diferentes.
baterPonto();

// A arte modelada, se houver. O `await` é de propósito e vem ANTES do primeiro
// boneco: `geometriaDe` é síncrona porque `criarBoneco` roda no meio do laço, a
// cada pessoa que entra na floresta — quem paga a espera é o boot, uma vez.
// Sem `web/modelos/modelos.json` isto é UMA requisição que dá 404 e segue
// procedural; falta de arquivo nunca derruba a tela. Ver `web/modelos/README.md`.
const arte = await prepararModelos();
if (arte.manifesto || arte.falhas.length) {
  // "Faltou" e' normal; "faltou e ninguem viu" nao e'. Quem acabou de largar
  // oito arquivos na pasta precisa saber que oito entraram.
  console.info('[mundo3d] modelos:', arte.ok + '/' + arte.pedidos, arte.carregadas.join(', ') || '(nenhum)');
  for (const f of arte.falhas) console.warn('[mundo3d] modelo recusado:', f.chave, '->', f.porque);
}

// QUEM cada um é. As variantes de personagem são pintadas a partir da textura
// que o `.glb` já trouxe (`personagens3d.js`), então isto não busca arquivo
// nenhum — e sem corpo modelado não faz nada, como todo o resto daqui.
//
// O elenco é hidratado mesmo com os NPCs DESLIGADOS no mundo: o catálogo de
// personagens sai dele, e ele tem de ser o MESMO da Página de Personagens.
// Fossem dois catálogos, alguém escolheria lá um personagem que aqui não
// existe, e o corpo dele voltaria ao padrão sem uma linha no console.
await hydrateCustomNpcs().catch(() => {});
const pintados = prepararPersonagens(catalogoDe(NPCS, coresPara));
if (pintados.base) {
  console.info('[mundo3d] personagens:', estadoDosPersonagens().variantes, 'variantes');
}

let db = null;
let nomeDaCarta = (id) => String(id);
if (NPCS_NO_MUNDO) {
  try { db = await YgoDB.load('/ygo-data/data', { full: false }); } catch { /* segue sem nomes */ }
  nomeDaCarta = (id) => db?.brief(id)?.name ?? String(id);
  await hydrateCustomNpcs();
  await loadNpcDecks();
}

// --------------------------------------------------------------- o renderer
const palco = $('palco');
const cv = $('cv');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  // Sem tratamento o defeito é uma tela preta: o `WebGLRenderer` levanta
  // quando não consegue contexto, e a exceção morre dentro do módulo.
  console.error('[mundo3d] WebGL recusado:', e);
  $('semwebgl').hidden = false;
  palco.hidden = true;
  // O `throw` é como toda página daqui para a corrente de `await` sem rodar o
  // resto — e a FRASE importa: `bootguard.js` só deixa passar sem faixa o que
  // casa com o `DE_PROPOSITO` dele. Sem isso a faixa genérica "esta tela nao
  // terminou de abrir" subiria POR CIMA do aviso que acabamos de mostrar, e o
  // jogador perderia a única linha que explica o que houve. Guardado por
  // `floresta.test.mjs`, que lê o regex do próprio bootguard.
  throw new Error('sem WebGL — indo para o aviso na tela');
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// O plano distante precisa alcançar o domo do céu (raio 3,2× o do mundo) DE
// UM CANTO do mapa, e não só do centro: recortado, o céu some e aparece a cor
// de fundo no lugar dele. O plano próximo não pode ser 0,1 junto de um `far`
// desses — a razão entre os dois é o que gasta a precisão do buffer de
// profundidade, e o sintoma é o relevo distante piscando contra si mesmo.
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.25, 700);

const mapa = construirFloresta();
const { scene, atualizar, seguirSol } = montarCena(mapa);

// ------------------------------------------------------------- o CENÁRIO
/**
 * Uma construção modelada dentro da clareira, quando existir uma.
 *
 * **DESLIGADO por padrão** (`CENARIO_PADRAO`, em `cenario.js`): o Mundo é a
 * floresta gerada em código, que é a que funciona. Ele chegou a nascer ligado
 * com o dormitório do Tag Force, e saiu em 07/09/2026 — *"o mundo que tem hoje
 * está bugado"*. Ligar é uma chave:
 * `localStorage['ygo:cenario'] = '<nome>'`.
 *
 * Não é código morto e não é pendência esquecida: é o caminho de quem
 * desenvolve um cenário, e o `web/cena.html` (Editor de Cena) é a ferramenta
 * que monta o próximo — peça a peça, em vez de um mapa inteiro importado de
 * uma vez.
 *
 * **Faltar é normal** — a mesma lei do `modelos.js`: sem cenário, a floresta,
 * e desligado nem a requisição acontece (`nomeDoCenario` responde `null` antes
 * dela). O que não pode é "faltou e ninguém viu", então pacote presente e torto
 * vira linha no console com o motivo; e os colisores entram em
 * `mapa.colisores`, que é a MESMA lista que barra as árvores — cenário
 * desenhado sem colisão seria uma casa atravessável, e quem joga leria isso
 * como bug do mundo, não como pendência.
 */
async function porCenarioNaClareira() {
  const nome = nomeDoCenario(globalThis.localStorage);
  if (!nome) return;
  const r = await carregarCenario({ nome });
  if (!r) return;                                   // não existe: a floresta basta
  if (r.erro) { console.warn(`[cenario] "${nome}" recusado: ${r.erro}`); return; }

  const off = assentar(r.pacote, { x: 0, z: 0, chao: alturaDoChao(0, 0) });
  scene.add(montarCenario(r.pacote, off));

  // A ENTRADA nunca é bloqueada. O cenário do dormitório tem 23 m de fundo e a
  // clareira tem 26 de diâmetro, então a pegada dele passa por cima do ponto em
  // que o jogador nasce — e nascer dentro de um colisor não é "difícil de
  // sair": `livre()` é falso em volta inteira e não se anda para lado nenhum.
  // O Mundo abriria com o boneco imóvel, que é indistinguível de travado.
  const { x: ex, z: ez } = mapa.entrada;
  const folga = MUNDO.raioJogador + 1.2;
  const cs = colisoresDoCenario(r.pacote, off)
    .filter((c) => Math.hypot(c.x - ex, c.z - ez) > c.r + folga);
  mapa.colisores.push(...cs);
  console.log(`[cenario] "${nome}": ${r.triangulos} triangulos, ${cs.length} colisores`);
}

const camadaLabels = $('labels');

// ----------------------------------------------------------- os adversários
/**
 * Os duelistas de máquina — hoje uma lista VAZIA (ver `NPCS_NO_MUNDO`).
 *
 * Quando ligados, moram TODOS aqui, e não os de uma campanha: este cenário
 * nunca reservou nomes de campanha em `world.js`, e filtrar daria uma floresta
 * vazia em quem organizou tudo em campanhas.
 */
const gente = !NPCS_NO_MUNDO ? [] : NPCS.map((npc, i) => {
  const vaga = mapa.vagas[i % mapa.vagas.length] ?? { x: 0, z: 0, y: 0, giro: 0 };
  // Sobrando adversário, as voltas seguintes recuam para fora do anel. É feio
  // e é de propósito: melhor um duelista fora de lugar que um escondido.
  const recuo = Math.floor(i / mapa.vagas.length) * 1.7;
  const dist = Math.hypot(vaga.x, vaga.z) || 1;
  const x = vaga.x * (1 + recuo / dist);
  const z = vaga.z * (1 + recuo / dist);

  const ativo = getNpcActiveDeck(npc.id);
  const { grupo, andar } = criarBoneco({ id: npc.id });
  grupo.position.set(x, alturaDoChao(x, z), z);
  grupo.rotation.y = Math.atan2(-x, -z);
  grupo.userData.chao = grupo.position.y;
  andar(0, false);
  scene.add(grupo);

  const el = document.createElement('div');
  el.className = 'plabel';
  const chave = document.createElement('span');
  chave.className = 'key';
  chave.textContent = '␣ falar';
  const nm = document.createElement('span');
  nm.className = `nm${ativo && ativo.deck && ativo.deck.main.length > 0 ? '' : ' semdeck'}`;
  nm.textContent = npc.name;
  el.append(chave, nm);
  camadaLabels.appendChild(el);

  const p = {
    npc, ativo, grupo, x, z, el,
    temDeck: !!(ativo && ativo.deck && ativo.deck.main.length > 0),
    giroParado: grupo.rotation.y,
  };
  nm.onclick = () => abrePainel(p);
  return p;
});

// ------------------------------------------------------------- o jogador
// A minha aparência: o que está no meu perfil, ou o padrão deduzido do meu id
// (`padraoDe`, que cai em `coresPara` — a mesma cara que eu já tinha antes de
// existir vestiário). Quem nunca abriu o guarda-roupa não vira um clone.
let minhaAparencia = normalizar(aparenciaSalva, meuId);

const eu = criarBoneco({ id: meuId, aparencia: minhaAparencia });
scene.add(eu.grupo);

// Todo mundo entra pela MESMA porta, então duas pessoas que chegam juntas
// nasceriam uma dentro da outra. O desvio sai do id (determinístico, como toda
// a floresta) e passa pelo `mover` porque ele pode cair dentro de uma árvore —
// o deslize da colisão já resolve isso de graça.
// O cenário entra ANTES de decidir onde eu nasço: os colisores dele vão para a
// mesma lista das árvores, e `mover` abaixo já os respeita.
await porCenarioNaClareira();

const desvio = desvioDeEntrada(conta?.id ?? usuario);
const nasci = mover(mapa.colisores, mapa.entrada.x, mapa.entrada.z, desvio.dx, desvio.dz);

let px = nasci.x, pz = nasci.z;
let giro = Math.PI;          // olhando para o centro da clareira
let andado = 0;

// A câmera orbita o jogador: `theta` é o azimute (0 = atrás dele no início),
// `phi` a inclinação a partir de cima.
const orbita = { theta: 0, phi: 1.14, dist: 7.4 };
const LIMITE_PHI = [0.42, 1.44];

// ------------------------------------------------------- as outras pessoas
/** id → o corpo desenhado. Ver `mundovivo.js` para de onde a posição vem. */
const corpos = new Map();

function nasceJogador(p) {
  // Nasce com o PADRÃO do id — a cara que essa pessoa teria sem vestiário — e a
  // roupa de verdade chega depois, pelo servidor (`pedirAparencia`). Esperar a
  // resposta para desenhar deixaria um corpo faltando na clareira por meio
  // segundo a cada chegada, que é justamente quando se olha para lá.
  const { grupo, andar, descartar, vestir } = criarBoneco({ id: p.id, aparencia: conhecidos.get(p.id)?.aparencia });
  const chao = alturaDoChao(p.x, p.z);
  grupo.position.set(p.x, chao, p.z);
  grupo.userData.chao = chao;
  grupo.rotation.y = p.giro;
  andar(0, false);
  scene.add(grupo);

  const el = document.createElement('div');
  el.className = 'plabel jogador';
  const nm = document.createElement('span');
  nm.className = 'nm';
  // `textContent`, nunca `innerHTML`: este texto foi digitado por outra pessoa.
  // Ele vem do SERVIDOR (`rpc/aparencias`) e não mais do recado de posição — mas
  // continua sendo texto de terceiro numa tela de terceiros, e a regra do chat
  // vale igual.
  const sabido = conhecidos.get(p.id)?.usuario ?? '';
  nm.textContent = sabido;
  // Sem nome CONHECIDO a etiqueta não aparece — nem vazia. Ela é uma caixa com
  // moldura: em branco ela vira um retângulo pairando sobre a cabeça de alguém,
  // que é pior que etiqueta nenhuma. E ela some inteira, e não só o texto,
  // porque a moldura é do elemento. Acontece enquanto a resposta do servidor
  // não chega — e continua acontecendo, honestamente, num cliente cujo servidor
  // ainda não tem a `rpc/aparencias` (migration 0054).
  if (!sabido) el.classList.add('semnome');
  el.appendChild(nm);
  camadaLabels.appendChild(el);

  corpos.set(p.id, { p, grupo, andar, descartar, vestir, el, andado: 0, nome: null });
  pedirAparencia(p.id);
  contar();
}

function morreJogador(id) {
  const c = corpos.get(id);
  if (!c) return;
  // `scene.remove` tira do grafo e NÃO devolve nada à GPU. Com gente entrando e
  // saindo a sessão inteira, isso é memória de vídeo subindo até o contexto se
  // perder — e a tela apaga sem um erro que aponte para cá.
  c.descartar();
  c.el.remove();
  corpos.delete(id);
  contar();
}

/**
 * Nome e roupa de quem está por aqui, do SERVIDOR.
 *
 * A policy de `perfis` é `id = auth.uid()` — ninguém lê a linha de mais
 * ninguém —, então quem responde é a `rpc/aparencias` (migration 0054), uma
 * porta estreita que devolve só nome e aparência.
 *
 * **É isto que fecha o buraco que o handoff registrava**: até aqui o nome sobre
 * a cabeça vinha no recado de posição, dito pelo cliente que o mandava. Com
 * roupa comprável, apresentação que o cliente escolhe sozinho vira credencial —
 * qualquer um vestiria o cosmético mais caro sem tê-lo.
 */
const conhecidos = new Map();      // id → { usuario, aparencia }
let aPedir = new Set();
let pedido = null;

function pedirAparencia(id, forcar = false) {
  if (!id || (!forcar && conhecidos.has(id))) return;
  if (forcar) conhecidos.delete(id);
  aPedir.add(id);
  // Junta os pedidos de um quarto de segundo numa consulta só. Chegando cinco
  // pessoas juntas (o caso de quem abre o Mundo cheio), sem isto seriam cinco
  // idas de rede para a mesma resposta.
  if (pedido) return;
  pedido = setTimeout(async () => {
    pedido = null;
    const ids = [...aPedir];
    aPedir = new Set();
    if (!ids.length) return;

    const r = await req('rpc/aparencias', { method: 'POST', body: { p_ids: ids } })
      .catch(() => ({ ok: false }));
    // Falha de rede não vira decisão sobre a cara de ninguém: o corpo fica com
    // o padrão do id, que é uma aparência legítima, e a próxima entrada dele
    // tenta de novo. Marcar como "já perguntei" aqui congelaria o palpite.
    if (!r.ok || !Array.isArray(r.dados)) return;

    for (const linha of r.dados) {
      const dados = {
        usuario: typeof linha.usuario === 'string' ? linha.usuario.slice(0, 24) : '',
        aparencia: normalizar(linha.aparencia, linha.id),
      };
      conhecidos.set(linha.id, dados);
      const c = corpos.get(linha.id);
      if (!c) continue;
      c.vestir(dados.aparencia);
      c.el.querySelector('.nm').textContent = dados.usuario;
      c.el.classList.toggle('semnome', !dados.usuario);
    }
  }, 250);
}

/**
 * O corpo caminha ATÉ a posição recebida, em vez de saltar para ela: as
 * notícias chegam uma a cada 120 ms e a tela desenha sessenta vezes por
 * segundo, então copiar a posição crua daria um boneco andando em degraus.
 */
function moverJogadores(dt) {
  const k = 1 - Math.exp(-dt / SUAVIZA_S);

  for (const c of corpos.values()) {
    const p = c.p;
    const dx = p.alvoX - p.x, dz = p.alvoZ - p.z;
    const d = Math.hypot(dx, dz);

    if (d > TELETRANSPORTE) { p.x = p.alvoX; p.z = p.alvoZ; p.giro = p.alvoGiro; }
    else { p.x += dx * k; p.z += dz * k; p.giro += normalizarGiro(p.alvoGiro - p.giro) * k; }

    const andando = d > 0.05;
    c.andado = andando ? c.andado + dt : 0;

    // A altura sai de `alturaDoChao`, como a do terreno e a minha. Uma segunda
    // conta aqui daria um jogador flutuando ou enterrado conforme o pedaço do
    // mapa, e nada acusaria. Ver §6 do MUNDO-3D-HANDOFF.
    const chao = alturaDoChao(p.x, p.z);
    c.grupo.userData.chao = chao;
    c.grupo.position.set(p.x, chao, p.z);
    c.grupo.rotation.y = p.giro;
    // o `dt` alimenta o AnimationMixer quando há animação de arquivo; sem ele
    // o clipe fica parado no primeiro quadro, que parece "não carregou"
    c.andar(c.andado, andando, dt);
  }
}

function contar() {
  const n = corpos.size;
  $('quantos').textContent = n === 0 ? 'só você por aqui'
    : n === 1 ? 'mais 1 pessoa por aqui'
    : `mais ${n} pessoas por aqui`;
}

/**
 * Liga a presença.
 *
 * **Sem sessão utilizável, o mundo continua andável — sozinho.** Não ver
 * ninguém é o desfecho normal de uma floresta vazia, então "não consegui ligar"
 * e "não tem ninguém" são indistinguíveis na tela: é por isso que existe o selo
 * de estado ao lado do contador, e não porque alguém precise saber de socket.
 */
let presenca = null;
if (conta?.id) {
  presenca = entrarNoMundo(
    {
      url: SUPABASE_URL, apikey: SUPABASE_KEY, token: tokenValido,
      eu: { id: conta.id, nome: perfil?.usuario || usuario },
    },
    {
      aoEntrar: nasceJogador,
      aoMover: () => {},   // a posição já virou alvo em `mundovivo`; nada a fazer aqui
      aoSair: morreJogador,
      // Alguém saiu do vestiário: a aparência que eu tenho em cache envelheceu.
      aoTrocarDeRoupa: (id) => pedirAparencia(id, true),
      aoEstado: (ligado) => {
        $('vivo').textContent = ligado ? '● ao vivo' : '○ sem conexão';
        $('vivo').classList.toggle('frio', !ligado);
        // O canal caiu: quem estava desenhado não vai mais dar notícia, e
        // deixá-lo na tela seria mostrar gente que pode ter ido embora há
        // minutos. O prazo de sumiço limparia isso sozinho em oito segundos —
        // isto só torna a queda visível na hora.
        if (!ligado) for (const id of [...corpos.keys()]) morreJogador(id);
      },
    },
  );
} else {
  $('vivo').textContent = '○ sem conexão';
  $('vivo').classList.add('frio');
}
contar();

// ----------------------------------------------------------------- painel
// Só existe com os adversários ligados (`NPCS_NO_MUNDO`). Continua aqui, e não
// apagado, porque é a metade desta tela que a `cidade.js` também tem — a
// duplicação conhecida do §9.1 do handoff, que se resolve extraindo um módulo,
// não deletando um dos dois lados.
let alvoPainel = null;

function abrePainel(p) {
  alvoPainel = p;
  const sig = p.ativo?.signatureId ?? p.npc.signatureId;
  const capa = p.ativo?.coverId ?? sig;

  $('panel-title').textContent = p.npc.name;
  $('panel-sub').textContent = p.npc.theme || '';
  $('panel-art').style.backgroundImage = capa ? `url('${ART(capa)}')` : '';
  $('panel-campanha').innerHTML = `campanha: <b>${p.npc.campaign || 'nenhuma'}</b>`;
  $('panel-deck').innerHTML = p.temDeck
    ? `deck: <b>${p.ativo.name}</b> (${p.ativo.deck.main.length} cartas)`
    : 'deck: <b>nenhum montado</b>';
  $('panel-reward').innerHTML = `recompensa: <b>${sig ? nomeDaCarta(sig) : '—'}</b>`
    + (p.ativo ? ` · <b>${p.ativo.rewardDp} DP</b>` : '');

  const botao = $('btn-duelar');
  botao.disabled = !p.temDeck;
  botao.textContent = p.temDeck ? 'duelar' : 'sem deck (monte na Área de Teste)';
  $('overlay').classList.add('show');
  teclas.clear();       // senão a tecla presa continua andando por baixo
  arrastando = null;
}

const painelAberto = () => $('overlay').classList.contains('show');
function fechaPainel() { $('overlay').classList.remove('show'); alvoPainel = null; }

$('btn-close').onclick = fechaPainel;
$('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') fechaPainel(); });
$('btn-duelar').onclick = () => {
  if (alvoPainel?.temDeck) location.href = `/web/duel.html?npc=${alvoPainel.npc.id}`;
};

// ------------------------------------------------------------- vestiário
/**
 * O guarda-roupa, numa gaveta lateral — e não num modal por cima da tela.
 *
 * A razão é a mesma da MIRA do ataque em `duel.html`: no único momento em que o
 * que importa é ver o boneco, cobri-lo com um vidro seria escolher às cegas. A
 * gaveta ocupa a direita, a câmera se aproxima e desloca o olhar para a
 * esquerda, e continua dando para arrastar e girar para ver de todos os lados.
 *
 * A prova é AO VIVO: cada clique veste o boneco de verdade (`eu.vestir`), sem
 * salvar nada. Sair sem salvar devolve o que estava — daí o `antesDeVestir`.
 */
const abaDeCor = 'pele';
const ABAS = [...SLOTS, abaDeCor];

let abaAtual = SLOTS[0];
let antesDeVestir = null;
/** id da peça → `{ preco, tenho }`. Vazio = nada à venda, tudo liberado. */
let catalogo = new Map();

const vestiarioAberto = () => !$('vestiario').hidden;

async function abrirVestiario() {
  if (!meuId) return void toast('entre na sua conta para usar o vestiário');
  antesDeVestir = minhaAparencia;
  $('vestiario').hidden = false;
  $('vest-erro').textContent = '';
  teclas.clear();                 // senão a tecla presa continua andando por baixo
  desenharVestiario();

  // O catálogo chega DEPOIS e só muda os cadeados: abrir esperando a rede
  // deixaria a gaveta em branco no clique, e o que a pessoa quer ver primeiro
  // é o próprio boneco.
  const itens = await meusItens().catch(() => []);
  catalogo = new Map(itens
    .filter((i) => SLOTS.includes(i.tipo))
    .map((i) => [i.id, { preco: i.preco, tenho: !!i.tenho }]));
  if (vestiarioAberto()) desenharVestiario();
}

function fecharVestiario({ desfazendo }) {
  if (desfazendo && antesDeVestir) {
    minhaAparencia = antesDeVestir;
    eu.vestir(minhaAparencia);
  }
  $('vestiario').hidden = true;
  antesDeVestir = null;
}

function trocar(campo, valor) {
  minhaAparencia = normalizar({ ...minhaAparencia, [campo]: valor }, meuId);
  eu.vestir(minhaAparencia);
  desenharVestiario();
}

function desenharVestiario() {
  // --- as abas
  const abas = $('vest-abas');
  abas.replaceChildren(...ABAS.map((a) => {
    const b = document.createElement('button');
    b.textContent = a === abaDeCor ? 'pele' : NOME_DO_SLOT[a];
    b.className = a === abaAtual ? 'ativa' : '';
    b.onclick = () => { abaAtual = a; desenharVestiario(); };
    return b;
  }));

  // --- as peças (a aba da pele não tem forma, só cor)
  const grade = $('vest-pecas');
  if (abaAtual === abaDeCor) {
    grade.replaceChildren();
    grade.hidden = true;
  } else {
    grade.hidden = false;
    const escolhida = minhaAparencia[abaAtual].peca;
    grade.replaceChildren(...pecasDoSlot(abaAtual, catalogo).map((p) => {
      const b = document.createElement('button');
      b.className = 'peca' + (p.id === escolhida ? ' ativa' : '') + (p.liberada ? '' : ' presa');

      const nome = document.createElement('span');
      nome.className = 'nome';
      nome.textContent = p.nome;
      b.appendChild(nome);

      // O cadeado mostra o PREÇO em vez de esconder a peça: cosmético que
      // ninguém vê é cosmético que ninguém quer comprar.
      if (!p.liberada) {
        const selo = document.createElement('span');
        selo.className = 'preco';
        selo.textContent = p.preco > 0 ? `${p.preco} DP` : 'bloqueado';
        b.appendChild(selo);
      }

      b.onclick = () => {
        if (!p.liberada) {
          return void toast(p.preco > 0 ? `${p.nome} custa ${p.preco} DP na Loja` : `${p.nome} ainda não é seu`);
        }
        trocar(abaAtual, { peca: p.id, cor: minhaAparencia[abaAtual].cor });
      };
      return b;
    }));
  }

  // --- as cores. Livres de propósito: é o que faz quem não tem item nenhum
  // parecer uma pessoa em vez de um clone. Ver o cabeçalho de `aparencia.js`.
  const atual = abaAtual === abaDeCor ? minhaAparencia.pele : minhaAparencia[abaAtual].cor;
  $('vest-cores').replaceChildren(...(PALETA[abaAtual] ?? []).map((cor) => {
    const b = document.createElement('button');
    b.className = 'cor' + (cor.toLowerCase() === String(atual).toLowerCase() ? ' ativa' : '');
    b.style.background = cor;
    b.title = cor;
    b.onclick = () => trocar(
      abaAtual === abaDeCor ? abaDeCor : abaAtual,
      abaAtual === abaDeCor ? cor : { peca: minhaAparencia[abaAtual].peca, cor },
    );
    return b;
  }));
}

async function salvarVestiario() {
  const botao = $('vest-salvar');
  botao.disabled = true;
  $('vest-erro').textContent = '';
  try {
    const corpo = paraGravar(minhaAparencia, meuId);
    const r = await req(`perfis?id=eq.${encodeURIComponent(meuId)}`, {
      method: 'PATCH', body: { aparencia: corpo },
    });
    // A recusa que importa vem do gatilho `perfis_aparencia_valida` (0054): a
    // peça não é sua. A tela já não a oferece, mas o catálogo pode ter chegado
    // vazio por falha de rede — e aí é o servidor quem tem a palavra.
    if (!r.ok) { $('vest-erro').textContent = r.erro || 'não consegui salvar'; return; }

    antesDeVestir = null;
    fecharVestiario({ desfazendo: false });
    toast('visual salvo');
    // Quem está na clareira tem a minha roupa velha em cache; sem este aviso,
    // eles só a veriam na próxima vez que eu entrasse no mundo.
    presenca?.avisarQueTrocouDeRoupa();
  } catch (e) {
    // Nada aqui deve levantar (`paraGravar` só recusa uma forma impossível),
    // mas isto roda num `onclick`: uma rejeição solta viraria a faixa do
    // `bootguard` por cima de um mundo que abriu inteiro, e o jogador leria
    // "esta tela não terminou de abrir" depois de dez minutos jogando.
    console.error('[vestiario] falhou ao salvar:', e);
    $('vest-erro').textContent = 'não consegui salvar';
  } finally {
    botao.disabled = false;
  }
}

$('btn-vestiario').onclick = abrirVestiario;
$('vest-fechar').onclick = () => fecharVestiario({ desfazendo: true });
$('vest-cancelar').onclick = () => fecharVestiario({ desfazendo: true });
$('vest-salvar').onclick = salvarVestiario;

// ---------------------------------------------------------------- a saída
/**
 * `Esc` volta para a home.
 *
 * Com o painel aberto ele fecha o painel primeiro — sair da tela inteira por
 * causa de um `Esc` que só queria fechar uma caixa é a surpresa clássica, e
 * aqui ela custaria o caminho de volta ao ponto onde a pessoa estava.
 */
function sairDoMundo() {
  presenca?.sair();
  location.href = '/web/index.html';
}

// ---------------------------------------------------------------- entrada
const teclas = new Set();
const MAPA_TECLAS = {
  ArrowUp: 'frente', KeyW: 'frente',
  ArrowDown: 'tras', KeyS: 'tras',
  ArrowLeft: 'esquerda', KeyA: 'esquerda',
  ArrowRight: 'direita', KeyD: 'direita',
  KeyQ: 'giraEsq', KeyE: 'giraDir',
  ShiftLeft: 'correr', ShiftRight: 'correr',
};

let perto = null;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const t = MAPA_TECLAS[e.code];
  if (t) { teclas.add(t); e.preventDefault(); }
  if ((e.code === 'Space' || e.code === 'Enter') && !painelAberto()) {
    if (perto) abrePainel(perto);
    e.preventDefault();
  }
  if (e.code === 'KeyV' && !painelAberto() && !vestiarioAberto()) {
    abrirVestiario();
    e.preventDefault();
  }
  // `Esc` em CAMADAS: ele fecha o que estiver por cima antes de sair da tela.
  // Sem isso, quem só queria fechar o vestiário perderia o lugar onde estava e
  // voltaria para o começo da floresta — e ainda descartaria a roupa escolhida.
  if (e.code === 'Escape') {
    if (vestiarioAberto()) fecharVestiario({ desfazendo: true });
    else if (painelAberto()) fechaPainel();
    else sairDoMundo();
  }
});
window.addEventListener('keyup', (e) => {
  const t = MAPA_TECLAS[e.code];
  if (t) teclas.delete(t);
});
// Sair da janela não pode deixar uma tecla "presa" andando sozinha.
window.addEventListener('blur', () => { teclas.clear(); arrastando = null; });

let arrastando = null;
cv.addEventListener('pointerdown', (e) => {
  // O painel é modal; a gaveta do vestiário NÃO é — arrastar ali é como se vê
  // o boneco de trás, que é metade do motivo de a câmera se aproximar.
  if (painelAberto()) return;
  arrastando = { id: e.pointerId, x: e.clientX, y: e.clientY, andou: 0 };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (!arrastando || e.pointerId !== arrastando.id) return;
  const dx = e.clientX - arrastando.x, dy = e.clientY - arrastando.y;
  arrastando.x = e.clientX; arrastando.y = e.clientY;
  arrastando.andou += Math.abs(dx) + Math.abs(dy);
  orbita.theta -= dx * 0.005;
  orbita.phi = Math.min(LIMITE_PHI[1], Math.max(LIMITE_PHI[0], orbita.phi - dy * 0.004));
});
cv.addEventListener('pointerup', (e) => {
  if (!arrastando || e.pointerId !== arrastando.id) return;
  // Arrastar é girar a câmera; só o clique PARADO seleciona. Sem esse limiar,
  // toda vez que se soltasse o botão depois de girar a vista abriria o painel
  // de quem estivesse por baixo do cursor.
  const clique = arrastando.andou < 6;
  arrastando = null;
  if (clique) cliqueNoMundo(e);
});
cv.addEventListener('wheel', (e) => {
  orbita.dist = Math.min(17, Math.max(3.2, orbita.dist + e.deltaY * 0.01));
  e.preventDefault();
}, { passive: false });

const raio = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function cliqueNoMundo(e) {
  if (!gente.length) return;   // sem adversário não há nada clicável na mesa
  const r = cv.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raio.setFromCamera(ndc, camera);
  const alvos = raio.intersectObjects(gente.map((g) => g.grupo), true);
  if (!alvos.length) return;
  // O boneco é um Group de caixas: sobe até achar de quem é a caixa clicada.
  let no = alvos[0].object;
  while (no && !gente.some((g) => g.grupo === no)) no = no.parent;
  const dono = gente.find((g) => g.grupo === no);
  if (dono) abrePainel(dono);
}

// -------------------------------------------------------------- o tamanho
/**
 * O redimensionamento é conferido no LAÇO, e não por `ResizeObserver`. Não é
 * preguiça: mexer no layout dentro da entrega de um observer deixa notificação
 * pendente no fim do quadro, o navegador dispara "ResizeObserver loop
 * completed with undelivered notifications", isso chega como `ErrorEvent` na
 * window e o `bootguard` cobre o jogo com a faixa de tela quebrada. Já
 * aconteceu neste projeto (ver a serpentina da Trilha). Comparar dois inteiros
 * por quadro custa nada.
 */
function ajustarTamanho() {
  const w = palco.clientWidth, h = palco.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // `Math.floor`, e não `round`, porque é o que o `setSize` do three faz. Com
  // `round` os dois nunca batem em DPR fracionário (1,25 / 1,5 — o padrão de
  // um monitor com escala do Windows) e o canvas seria reconstruído a CADA
  // quadro. Não dá erro: dá um jogo mais lento sem motivo aparente.
  if (cv.width === Math.floor(w * dpr) && cv.height === Math.floor(h * dpr)) return;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ o laço
const alvoCam = new THREE.Vector3();
const posCam = new THREE.Vector3();
const naTela = new THREE.Vector3();
const lado = new THREE.Vector3();

/**
 * A câmera de perto, do vestiário. Ela se APROXIMA e empurra o olhar para o
 * lado, para o boneco não ficar atrás da gaveta — é um deslocamento do ALVO,
 * e não `setViewOffset`, porque mexer na projeção obrigaria a refazer a conta
 * do `aspect` e do redimensionamento, que é onde esta tela já erra calado.
 *
 * Tudo interpolado: um corte seco entre 7,4 m e 2,4 m parece a tela ter
 * trocado de lugar.
 */
const CAM_VESTIARIO = { dist: 2.6, phi: 1.28, desvio: 0.62, altura: 1.05 };
let deVestiario = 0;

function posicionarCamera(dt) {
  const querido = vestiarioAberto() ? 1 : 0;
  deVestiario += (querido - deVestiario) * (1 - Math.exp(-dt / 0.18));

  const altura = 1.35 + (CAM_VESTIARIO.altura - 1.35) * deVestiario;
  alvoCam.set(px, alturaDoChao(px, pz) + altura, pz);
  const phi = orbita.phi + (CAM_VESTIARIO.phi - orbita.phi) * deVestiario;
  const dist = orbita.dist + (CAM_VESTIARIO.dist - orbita.dist) * deVestiario;
  const sp = Math.sin(phi);
  posCam.set(
    alvoCam.x + dist * sp * Math.sin(orbita.theta),
    alvoCam.y + dist * Math.cos(phi),
    alvoCam.z + dist * sp * Math.cos(orbita.theta),
  );
  // A câmera não pode afundar no morro: sem este piso ela entra no terreno e a
  // tela fica com a cor do chão, o que parece o jogo ter travado.
  posCam.y = Math.max(posCam.y, alturaDoChao(posCam.x, posCam.z) + 0.9);
  camera.position.copy(posCam);

  // Empurra o olhar para a direita, o que joga o boneco para a esquerda da
  // tela — para fora da gaveta. O vetor é o "lado" da câmera: a horizontal
  // perpendicular à direção de visão.
  if (deVestiario > 0.001) {
    lado.subVectors(alvoCam, posCam).cross(camera.up).normalize();
    alvoCam.addScaledVector(lado, CAM_VESTIARIO.desvio * deVestiario);
  }
  camera.lookAt(alvoCam);
}

function atualizarProximidade() {
  let melhor = null, menor = Infinity;
  for (const g of gente) {
    const d = Math.hypot(g.x - px, g.z - pz);
    if (d <= MUNDO.raioInteracao && d < menor) { melhor = g; menor = d; }
    // Vira para quem chega perto — dá vida de graça, como no mundo 2D.
    g.grupo.rotation.y = d < 9 ? Math.atan2(px - g.x, pz - g.z) : g.giroParado;
  }
  perto = melhor;
}

/**
 * As etiquetas de nome, projetadas do 3D para a tela. Vale para os dois tipos
 * de habitante: os adversários (quando ligados) e as pessoas.
 */
function sincronizarLabels() {
  const r = cv.getBoundingClientRect();
  for (const g of [...gente, ...corpos.values()]) {
    naTela.set(g.grupo.position.x, g.grupo.position.y + ALTURA + 0.3, g.grupo.position.z);
    naTela.project(camera);
    // `z > 1` é o que está ATRÁS da câmera. Sem esta linha o rótulo de quem
    // ficou para trás reaparece espelhado na frente, e o jogador clica num
    // duelista que está às costas dele.
    const visivel = naTela.z < 1 && Math.abs(naTela.x) < 1.15 && Math.abs(naTela.y) < 1.15
      && !g.el.classList.contains('semnome');
    g.el.style.display = visivel ? '' : 'none';
    if (!visivel) continue;
    g.el.style.left = `${(naTela.x * 0.5 + 0.5) * r.width}px`;
    g.el.style.top = `${(-naTela.y * 0.5 + 0.5) * r.height}px`;
    g.el.classList.toggle('near', g === perto);
  }
}

const VEL = 4.4, VEL_CORRIDA = 8.2;

let anterior = performance.now();
function quadro(agora) {
  const dt = Math.min(0.05, (agora - anterior) / 1000);
  anterior = agora;
  const t = agora / 1000;

  let andando = false;
  if (!painelAberto() && !vestiarioAberto()) {
    if (teclas.has('giraEsq')) orbita.theta += dt * 1.8;
    if (teclas.has('giraDir')) orbita.theta -= dt * 1.8;

    // O andar é relativo à CÂMERA (W vai para onde se está olhando), que é o
    // que todo mundo espera de terceira pessoa. Relativo ao BONECO daria um
    // "tanque" que gira no lugar.
    const sinT = Math.sin(orbita.theta), cosT = Math.cos(orbita.theta);
    let fx = 0, fz = 0;
    if (teclas.has('frente')) { fx -= sinT; fz -= cosT; }
    if (teclas.has('tras')) { fx += sinT; fz += cosT; }
    if (teclas.has('direita')) { fx += cosT; fz -= sinT; }
    if (teclas.has('esquerda')) { fx -= cosT; fz += sinT; }

    const norma = Math.hypot(fx, fz);
    if (norma > 0.001) {
      const v = (teclas.has('correr') ? VEL_CORRIDA : VEL) * dt;
      // A colisão é contra a FLORESTA, nunca contra as outras pessoas: sem
      // dono, dois clientes empurrando o mesmo corpo discordariam sobre onde
      // ele parou, e cada tela ficaria certa pela sua conta. Atravessar é a
      // escolha honesta enquanto não houver interação nenhuma aqui.
      const passo = mover(mapa.colisores, px, pz, (fx / norma) * v, (fz / norma) * v);
      px = passo.x; pz = passo.z;
      giro = Math.atan2(fx, fz);
      andado += dt;
      andando = true;
    } else {
      andado = 0;
    }
  }

  const chao = alturaDoChao(px, pz);
  eu.grupo.userData.chao = chao;
  eu.grupo.position.set(px, chao, pz);
  eu.grupo.rotation.y = giro;
  eu.andar(andado, andando, dt);

  // Uma leitura de relógio por quadro, e é a MESMA para mandar e para expirar.
  // Ver o `passar` de `mundovivo.js`: duas linhas do tempo ali dariam gente
  // sumindo na hora ou não sumindo nunca.
  presenca?.passar(Date.now(), { x: px, z: pz, giro });
  moverJogadores(dt);

  atualizar(t);
  seguirSol(px, pz);
  posicionarCamera(dt);
  atualizarProximidade();
  ajustarTamanho();
  renderer.render(scene, camera);
  sincronizarLabels();

  requestAnimationFrame(quadro);
}

ajustarTamanho();
requestAnimationFrame(quadro);

if (NPCS_NO_MUNDO && !gente.length) toast('nenhum adversário cadastrado ainda');

$('btn-2d').onclick = () => (location.href = '/web/cidade.html');
$('btn-teste').onclick = () => (location.href = '/web/teste.html');
$('btn-personagens').onclick = () => { location.href = '/web/personagens.html'; };
$('btn-home').onclick = sairDoMundo;
