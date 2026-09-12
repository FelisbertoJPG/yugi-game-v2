/**
 * **Quem mais está andando na floresta.**
 *
 * O Mundo é um lugar de ENCONTRO: você vê as outras pessoas caminhando, e nada
 * além disso acontece — não há duelo, conversa, empurrão nem colisão entre
 * jogadores. Ver `mundo3d.js`.
 *
 * ---
 *
 * **Por que TRANSMISSÃO e não tabela.** Uma posição vale 120 milissegundos.
 * Gravá-la numa tabela seria escrever no banco umas oito vezes por segundo por
 * pessoa para guardar um dado que já nasceu velho — e ainda pagar o WAL, a
 * replicação e a policy de leitura. O canal de `broadcast` do Realtime vai de
 * cliente a cliente sem encostar no Postgres. Ver `realtime.js`.
 *
 * **Por que isto NÃO substitui `presenca.js`.** Aquilo responde *"quem está
 * jogando agora"* e é o BANCO quem decide, com um carimbo que expira sozinho —
 * é o que a lista de amigos e o contador da home leem. Isto responde *"quem
 * está nesta floresta, nesta coordenada, neste instante"*, e some junto com a
 * aba. São perguntas diferentes, com prazos diferentes; misturá-las faria a
 * lista de amigos depender de alguém ter aberto o Mundo.
 *
 * ---
 *
 * ## As duas coisas que erram CALADAS
 *
 * **1. A cadência.** Mandar a posição só quando ela MUDA parece a economia
 * óbvia e é o defeito principal desta feature: quem fica parado deixa de dar
 * notícia, o prazo de sumiço vence, e o corpo **evapora da tela dos outros**
 * enquanto a pessoa está claramente ali, de pé. O avesso custa igual — mandar a
 * cada quadro são 60 mensagens por segundo por pessoa, que o servidor passa a
 * descartar por excesso, e aí o mundo engasga para todo mundo ao mesmo tempo.
 * Por isso são DOIS ritmos: `ENVIO_MS` enquanto me mexo, `BATIDA_MS` parado. A
 * batida do parado não é enfeite — é ela que sustenta a presença.
 *
 * **2. O que chega não foi validado por ninguém.** Uma linha de tabela passou
 * por policy, por tipo de coluna e por gatilho. Uma transmissão foi escrita
 * pelo cliente do outro lado e chega crua. Um `x` que não é número vira um
 * `NaN` na matriz do boneco, e um objeto com matriz NaN **simplesmente não
 * aparece** — sem erro, sem console, exatamente a armadilha que
 * `MUNDO-3D-HANDOFF.md` §5 documenta para as instâncias. E uma coordenada a dez
 * quilômetros põe um corpo além da névoa, que ninguém alcança e ninguém vê
 * sumir. Por isso **tudo** passa por
 * `limparRecado`, e o que não passa é DESCARTADO em vez de corrigido: um
 * palpite sobre um dado torto é um corpo no lugar errado, que é pior que corpo
 * nenhum.
 *
 * ## O recado carrega COORDENADA, e nada de identidade
 *
 * Este arquivo já teve um limite conhecido escrito aqui: o NOME viajava no
 * próprio recado, dito pelo cliente que o mandava, e o aviso dizia que **no dia
 * em que houvesse interação isso teria de vir do servidor, senão a etiqueta
 * viraria credencial**.
 *
 * Esse dia chegou com a customização de personagem (migration 0054): cabelo e
 * roupa viram item comprável, e apresentação que o cliente escolhe sozinho é
 * exatamente uma credencial — qualquer um vestiria o cosmético mais caro sem
 * tê-lo. Hoje quem responde "quem é este e o que ele veste" é a
 * `rpc/aparencias`, e o recado voltou a ser só `{id, x, z, giro}`.
 *
 * **Não devolva o nome para cá.** Pôr de novo uma letra de identidade no
 * recado reabre o buraco sem que nada acuse — a tela fica idêntica. É por isso
 * que `limparRecado` não tem mais campo de nome nenhum, em vez de ter um que
 * ninguém lê: campo que existe é campo que alguém volta a usar.
 */
import { MUNDO } from './floresta.js';
import { ouvirTransmissoes } from './realtime.js';

/** O canal. Um só para o mundo todo — não há instâncias nem salas ainda. */
export const SALA = 'mundo';

/** De quanto em quanto tempo mando a posição enquanto estou me mexendo. */
export const ENVIO_MS = 120;

/**
 * Parado, mando assim mesmo. É esta linha que impede o corpo de quem está de pé
 * de evaporar da tela dos outros — ver o cabeçalho.
 */
export const BATIDA_MS = 2_000;

/**
 * Sem notícia por isto, o corpo sai da tela.
 *
 * Tem de ser confortavelmente MAIOR que `BATIDA_MS`, senão um atraso de rede
 * qualquer faz a pessoa piscar entre existir e não existir. Quatro batidas de
 * folga: três podem se perder inteiras sem ninguém ver diferença. É a mesma
 * conta que `presenca.js` faz com a janela do banco.
 */
export const SUMICO_MS = 8_000;


/** Quanto o corpo tem de se mexer para valer um envio fora de hora. */
const PASSO_MINIMO = 0.02;
const GIRO_MINIMO = 0.04;

/**
 * Normaliza um ângulo para [-PI, PI].
 *
 * Exportada porque quem DESENHA precisa dela pela mesma razão que quem decide:
 * interpolar de 3,0 rad para -3,0 rad pelo caminho cru gira o boneco quase uma
 * volta inteira para chegar a um lugar que estava a poucos graus de distância.
 * O corpo roda no próprio eixo, uma vez, a cada notícia que atravessa o ±PI —
 * e nada acusa.
 */
export const normalizarGiro = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** A menor distância angular entre dois ângulos, já com a volta descontada. */
const distanciaAngular = (a, b) => Math.abs(normalizarGiro(a - b));

/**
 * Confere um recado cru e devolve `{id, x, z, giro}` — ou **`null`**, que é o
 * que se faz com o que não dá para confiar. Ver o cabeçalho: NOME não vem por
 * aqui, e não deve voltar.
 *
 * `meuId` é descartado de propósito: o servidor já manda `self: false`, mas uma
 * SEGUNDA ABA da mesma conta é outro cliente e o recado dela volta com o meu
 * próprio id. Sem esta linha, abrir o jogo duas vezes põe um sósia andando em
 * cima de você.
 */
export function limparRecado(carga, meuId = null) {
  if (!carga || typeof carga !== 'object') return null;

  const id = typeof carga.id === 'string' ? carga.id.trim() : '';
  if (!id || id.length > 64) return null;
  if (meuId && id === meuId) return null;

  const { x, z, giro } = carga;
  // `Number.isFinite` sobre o valor CRU, e nunca `Number(valor)` antes: a
  // conversão inventa coordenada em silêncio, que é o defeito que esta função
  // existe para impedir. `Number(null)`, `Number('')` e `Number([])` são todos
  // **0** — um `z` ausente viraria a coordenada zero, que é um lugar legítimo
  // no meio da clareira, e o corpo apareceria plantado ali com toda a
  // naturalidade. `Number.isFinite` é estrito quanto ao tipo (recusa `'3'`
  // também) e recusa NaN e Infinity de uma vez, que é o que impede a matriz do
  // boneco de virar NaN — e objeto com matriz NaN não desenha e não reclama.
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(giro)) return null;

  // Fora da parede do mundo não existe lugar. Uma folga pequena porque a
  // colisão de quem manda desliza rente ao muro e pode passar por um fio.
  if (Math.hypot(x, z) > MUNDO.raio + 2) return null;

  return { id, x, z, giro: normalizarGiro(giro) };
}

/**
 * Guarda o recado no mundo. Devolve `'entrou'` na primeira notícia de alguém e
 * `'moveu'` nas seguintes — é o que diz à tela se ela precisa CRIAR um corpo ou
 * só mirar o que já existe.
 *
 * A posição recebida vira ALVO, não posição: quem desenha caminha até ela. Sem
 * isso, oito notícias por segundo desenhadas em sessenta quadros dariam um
 * boneco teleportando em degraus.
 *
 * @param {Map<string, object>} mundo
 */
export function aplicar(mundo, dados, agora) {
  const antes = mundo.get(dados.id);

  if (!antes) {
    mundo.set(dados.id, {
      id: dados.id,
      x: dados.x, z: dados.z, giro: dados.giro,
      alvoX: dados.x, alvoZ: dados.z, alvoGiro: dados.giro,
      visto: agora,
    });
    return 'entrou';
  }

  antes.alvoX = dados.x;
  antes.alvoZ = dados.z;
  antes.alvoGiro = dados.giro;
  antes.visto = agora;
  return 'moveu';
}

/** Quem não dá notícia há tempo demais. Devolve os ids, sem remover nada. */
export function sumidos(mundo, agora, prazo = SUMICO_MS) {
  const fora = [];
  for (const p of mundo.values()) if (agora - p.visto > prazo) fora.push(p.id);
  return fora;
}

/**
 * Está na hora de mandar a minha posição?
 *
 * `estado` é `{ultimo, x, z, giro}` — o que foi mandado da última vez. `ultimo`
 * nulo significa "ainda não mandei nada", e aí manda-se sempre: é a primeira
 * notícia, a que faz o corpo existir para os outros.
 */
export function deveMandar(estado, agora, pos, { envio = ENVIO_MS, batida = BATIDA_MS } = {}) {
  if (!estado || estado.ultimo == null) return true;

  const desde = agora - estado.ultimo;
  const mexeu = Math.hypot(pos.x - estado.x, pos.z - estado.z) > PASSO_MINIMO
             || distanciaAngular(pos.giro, estado.giro) > GIRO_MINIMO;

  // Parado ainda manda — só que devagar. Ver o cabeçalho: é o que impede o
  // corpo de quem está de pé de sumir da tela dos outros.
  return desde >= (mexeu ? envio : batida);
}

/**
 * O empurrãozinho no ponto de nascimento.
 *
 * Todo mundo entra pela MESMA porta (`mapa.entrada`), então duas pessoas que
 * chegam juntas nascem uma dentro da outra. O desvio sai do id — determinístico,
 * como toda a floresta: sortear por boot faria a mesma conta dar respostas
 * diferentes a cada abertura, e um relato de bug deixaria de ser reproduzível.
 *
 * Devolve um DESLOCAMENTO, e não uma posição, porque quem o aplica tem de
 * passá-lo pelo `mover()` da floresta: o desvio pode cair dentro de uma árvore,
 * e o deslize já resolve isso de graça.
 */
export function desvioDeEntrada(id) {
  let h = 2166136261;
  for (const c of String(id ?? '')) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const angulo = (h % 3600) / 3600 * Math.PI * 2;
  const raio = 0.8 + ((h >>> 12) % 1000) / 1000 * 2.2;
  return { dx: Math.cos(angulo) * raio, dz: Math.sin(angulo) * raio };
}

/**
 * Liga a presença. Devolve o que a tela chama no laço.
 *
 * **O relógio é o do LAÇO, e não um `setInterval`.** Duas razões: um timer a
 * mais é um vazamento a mais quando a tela troca, e — a que importa — uma aba
 * escondida tem os timers estrangulados pelo navegador (cai para um por
 * minuto), o que é bem mais lento que `SUMICO_MS`. Com o `requestAnimationFrame`
 * o comportamento fica honesto: aba escondida para de dar notícia, o corpo sai
 * da tela dos outros (a pessoa não está mais olhando o mundo mesmo), e voltar
 * para a aba a repõe no quadro seguinte, sozinho.
 *
 * @param {object} conf  `url`, `apikey`, `token` (ver `realtime.js`), mais
 *   `eu: {id, nome}`.
 * @param {object} ganchos  `aoEntrar(p)`, `aoMover(p)`, `aoSair(id)`,
 *   `aoEstado(ligado)`, `aoTrocarDeRoupa(id)`.
 * @returns {{passar(agora, pos), mundo: Map, avisarQueTrocouDeRoupa(), sair()}}
 */
export function entrarNoMundo(conf, ganchos = {}) {
  const { url, apikey, token, eu, sala = SALA } = conf ?? {};
  const {
    aoEntrar = () => {}, aoMover = () => {}, aoSair = () => {},
    aoEstado = () => {}, aoTrocarDeRoupa = () => {},
  } = ganchos;

  const mundo = new Map();
  const estado = { ultimo: null, x: 0, z: 0, giro: 0 };
  let vivo = true;

  const canal = ouvirTransmissoes(
    { url, apikey, token, sala },
    (evento, carga) => {
      if (!vivo) return;

      // "cheguei" — quem já estava aqui responde na hora, em vez de deixar o
      // recém-chegado olhando uma floresta vazia até a próxima batida. Zerar o
      // relógio de envio é a resposta inteira: o laço manda no quadro seguinte,
      // e a própria cadência serve de limite (ninguém consegue ser obrigado a
      // mandar mais que uma vez a cada `ENVIO_MS`).
      if (evento === 'cheguei') { estado.ultimo = null; return; }

      // Alguém saiu do vestiário. O recado não traz a roupa nova — traz só o
      // aviso de que a que está em cache envelheceu; quem responde o que ele
      // veste continua sendo o servidor. Mandar a roupa aqui seria devolver a
      // credencial ao cliente pela porta dos fundos.
      if (evento === 'vesti') {
        const id = typeof carga?.id === 'string' ? carga.id : null;
        if (id && id !== eu?.id) aoTrocarDeRoupa(id);
        return;
      }

      if (evento === 'sai') {
        const id = typeof carga?.id === 'string' ? carga.id : null;
        if (id && mundo.delete(id)) aoSair(id);
        return;
      }

      if (evento !== 'onde') return;

      const dados = limparRecado(carga, eu?.id);
      if (!dados) return;              // ver o cabeçalho: descartar, nunca adivinhar

      const houve = aplicar(mundo, dados, Date.now());
      const p = mundo.get(dados.id);
      if (houve === 'entrou') aoEntrar(p); else aoMover(p);
    },
    /**
     * O "cheguei" sai QUANDO O CANAL SOBE, e não aqui embaixo.
     *
     * Isto foi um defeito de verdade na primeira versão: `entrarNoMundo` mandava
     * o ping na última linha, com o `WebSocket` ainda em `CONNECTING`. Mandar
     * com o socket fechado **não enfileira — some** (ver `realtime.js`), então o
     * ping se perdia sempre, calado, e quem chegava esperava até dois segundos
     * de floresta vazia até a batida de alguém. Vale igual na volta de uma
     * reconexão, que é quando mais importa.
     *
     * Zerar o `ultimo` junto manda a MINHA posição no quadro seguinte: sem
     * isso, quem acabou de conectar e está parado só apareceria para os outros
     * na batida seguinte.
     */
    (ligado) => {
      if (ligado) {
        estado.ultimo = null;
        canal.transmitir('cheguei', { id: eu?.id ?? null });
      }
      aoEstado(ligado);
    },
  );

  // A saída EDUCADA. Ela não substitui o prazo de `SUMICO_MS` — substituí-lo
  // seria confiar num evento que não acontece quando a aba morre, a máquina
  // dorme ou a rede cai. É só a diferença entre o corpo sumir na hora e sumir
  // em oito segundos, que é a diferença que se vê.
  const despedir = () => { if (vivo) canal.transmitir('sai', { id: eu?.id ?? null }); };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', despedir);

  return {
    mundo,

    /**
     * Chame uma vez por quadro, com o relógio e a minha posição de agora.
     *
     * O relógio entra por parâmetro e é UM só (`Date.now()`, passado pela
     * tela) porque as duas contas daqui — há quanto tempo mandei e há quanto
     * tempo ouvi — se comparam com ele. Misturar `performance.now()` numa e
     * `Date.now()` na outra dá duas linhas do tempo com a mesma cara e origens
     * diferentes, e o sintoma seria gente sumindo na hora ou não sumindo nunca,
     * conforme há quanto tempo a aba está aberta.
     */
    passar(agora, pos) {
      if (!vivo) return;

      if (deveMandar(estado, agora, pos)) {
        estado.ultimo = agora;
        estado.x = pos.x; estado.z = pos.z; estado.giro = pos.giro;
        canal.transmitir('onde', {
          id: eu?.id ?? null,
          // Meio centímetro de precisão é bem mais do que se enxerga a sete
          // metros, e corta o tamanho da mensagem quase pela metade.
          x: Math.round(pos.x * 100) / 100,
          z: Math.round(pos.z * 100) / 100,
          giro: Math.round(pos.giro * 1000) / 1000,
        });
      }

      for (const id of sumidos(mundo, agora)) { mundo.delete(id); aoSair(id); }
    },

    /** Avisa a clareira que a minha roupa mudou. Ver o `vesti`, acima. */
    avisarQueTrocouDeRoupa() {
      if (vivo) canal.transmitir('vesti', { id: eu?.id ?? null });
    },

    sair() {
      despedir();
      vivo = false;
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', despedir);
      canal.fechar();
    },
  };
}
