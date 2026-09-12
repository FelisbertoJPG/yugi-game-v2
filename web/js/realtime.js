/**
 * **Supabase Realtime sem biblioteca nenhuma.**
 *
 * O `@supabase/realtime-js` é um pacote npm, e este front tem **zero
 * dependências** de propósito — não há build step, não há `node_modules`, os
 * módulos são servidos como estão. Então o cliente é escrito aqui, sobre o
 * `WebSocket` que o navegador já tem.
 *
 * O protocolo é o do **Phoenix Channels**, e cabe em poucas regras:
 *
 *   • toda mensagem é um JSON `{topic, event, payload, ref}`;
 *   • entrar num canal é mandar `phx_join` num tópico `realtime:<nome>`,
 *     dizendo na config o que se quer ouvir;
 *   • o servidor responde `phx_reply` com `status: "ok"` — e é só a partir daí
 *     que o canal está de pé;
 *   • um `heartbeat` no tópico `phoenix` a cada 30s mantém a conexão viva. Sem
 *     ele o servidor derruba o socket por inatividade, em silêncio;
 *   • as mudanças de tabela chegam como `postgres_changes`, com `record` (a
 *     linha nova) e `old_record` (a antiga, só quando a tabela tem `replica
 *     identity full`);
 *   • o que um cliente manda para os outros chega como `broadcast`, e **não
 *     passa pelo banco**.
 *
 * **São DUAS faces sobre UMA canalização.** `ouvirMudancas` é o canal das
 * tabelas (notificações e chat); `ouvirTransmissoes` é o canal de recado direto
 * entre clientes (as posições de quem anda no Mundo). O que elas dividem —
 * reconexão com espera dobrada, heartbeat, renovação de token, a hora exata em
 * que o canal está de pé — é o que erra calado, e é justamente por isso que não
 * pode existir em duas cópias: a segunda envelhece sem ninguém ver.
 *
 * **O RLS vale aqui igual** — para as TABELAS. O `access_token` vai no
 * `phx_join` e o servidor só entrega as linhas que aquele usuário poderia ler
 * por `select`. É por isso que a policy de `partidas` precisou enxergar o
 * `convidado` (migration 0012) e a de `amizades` já enxerga o destinatário: sem
 * isso a linha simplesmente não chega, e nada acusa.
 *
 * > **Transmissão não é linha de tabela, e nada a valida.** O que chega num
 * > `broadcast` foi escrito por outro cliente, não pelo banco — não passou por
 * > policy, por gatilho nem por tipo de coluna. Quem recebe **tem de conferir**
 * > antes de usar. Ver `mundovivo.js`, que é onde essa conferência mora.
 *
 * **O token expira** (~1h) e o canal não renova sozinho: o socket continua
 * aberto, aparentemente saudável, e para de entregar. Por isso este módulo
 * reenvia o `access_token` a cada batida de heartbeat.
 *
 * Este arquivo **não importa nada** — nem o `supabase.js`. A URL, a chave e o
 * token entram como parâmetro, no mesmo padrão de `planoRapido(…, raridadeDe)`
 * e `gavetasDoDeck(…, doBooster)`: é o que deixa a tradução do protocolo ser
 * testada em Node, e ela é justamente a parte que erra em silêncio.
 */

const HEARTBEAT_MS = 30_000;
/** Espera antes de tentar de novo, dobrando até o teto. */
const RECONEXAO_MS = 2_000;
const RECONEXAO_MAX_MS = 60_000;

/**
 * A canalização, sozinha. **Privada de propósito**: quem chama de fora usa uma
 * das duas faces abaixo, que já sabem montar a config do join e filtrar o que
 * não lhes diz respeito.
 *
 * @param {object} conf
 * @param {string} conf.url            a URL REST do projeto (https://…supabase.co)
 * @param {string} conf.apikey         a chave publicável
 * @param {() => Promise<string|null>} conf.token  devolve um JWT válido (renova)
 * @param {string} conf.topico         'realtime:<nome do canal>'
 * @param {object} conf.config         o bloco `config` do `phx_join`
 * @param {boolean} conf.esperaTabelas  ver `interpretar`
 * @param {(e: object) => void} aoEvento
 * @param {(ligado: boolean) => void} [aoEstado]
 * @returns {{enviar: (evento: string, carga: object) => void, fechar: () => void}}
 */
function abrirCanal(conf, aoEvento, aoEstado = () => {}) {
  const { url, apikey, token, topico, config, esperaTabelas } = conf ?? {};
  let vivo = true;
  let ws = null;
  let ref = 0;
  let batida = null;
  let religar = null;
  let espera = RECONEXAO_MS;
  // O canal só está DE PÉ depois do `phx_reply` — antes disso o socket está
  // aberto mas não entrega nada. Anunciar "ligado" no `onopen` faria a tela
  // desligar a reserva cedo demais, e um join recusado (token inválido)
  // passaria por conexão boa.
  let dePe = false;

  const proximoRef = () => String(++ref);

  function mandar(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function anunciar(novoEstado) {
    if (dePe === novoEstado) return;
    dePe = novoEstado;
    try { aoEstado(novoEstado); } catch { /* a tela não pode derrubar o canal */ }
  }

  async function conectar() {
    if (!vivo) return;

    const jwt = await token?.();
    // Sem sessão não há o que ouvir — e insistir num socket que o servidor vai
    // recusar só gastaria reconexão. Quem chama continua com a reserva.
    if (!jwt || !vivo) return void agendarReconexao();

    const alvo = `${String(url).replace(/^http/, 'ws')}/realtime/v1/websocket`
               + `?apikey=${encodeURIComponent(apikey)}&vsn=1.0.0`;

    try {
      ws = new WebSocket(alvo);
    } catch {
      return void agendarReconexao();
    }

    ws.onopen = () => {
      mandar({
        topic: topico,
        event: 'phx_join',
        payload: { config, access_token: jwt },
        ref: proximoRef(),
      });

      batida = setInterval(async () => {
        mandar({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: proximoRef() });
        // O token de uma hora atrás continua sendo aceito pelo socket já
        // aberto, mas o servidor para de entregar as linhas que dependem dele.
        // Reenviar é barato e é o que impede o canal de virar um cano mudo.
        const t = await token?.();
        if (t) mandar({ topic: topico, event: 'access_token', payload: { access_token: t }, ref: proximoRef() });
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const evento = interpretar(msg, { esperaTabelas });
      if (!evento) return;
      if (evento.tipo === '__join_ok') { espera = RECONEXAO_MS; return void anunciar(true); }
      if (evento.tipo === '__join_erro') return void fecharSocket();
      try { aoEvento(evento); } catch { /* idem */ }
    };

    ws.onerror = () => { /* o `onclose` vem logo atrás e é lá que se reconecta */ };
    ws.onclose = () => { anunciar(false); pararBatida(); if (vivo) agendarReconexao(); };
  }

  function pararBatida() { if (batida) { clearInterval(batida); batida = null; } }

  function fecharSocket() {
    pararBatida();
    try { ws?.close(); } catch { /* já estava fechado */ }
    ws = null;
  }

  function agendarReconexao() {
    if (!vivo || religar) return;
    religar = setTimeout(() => { religar = null; conectar(); }, espera);
    // Dobra até o teto: uma queda do serviço não pode virar um cliente
    // martelando o servidor a cada 2 segundos.
    espera = Math.min(espera * 2, RECONEXAO_MAX_MS);
  }

  conectar();

  return {
    // Mandar com o socket fechado **não enfileira**: some. Para uma posição de
    // jogador isso é o certo — a próxima chega em 120 ms e é mais verdadeira
    // que a que ficou na fila. Quem precisar de entrega garantida não usa
    // transmissão; usa tabela, que é o que a outra face faz.
    enviar: (evento, carga) => mandar({ topic: topico, event: evento, payload: carga, ref: proximoRef() }),
    fechar: () => {
      vivo = false;
      if (religar) { clearTimeout(religar); religar = null; }
      fecharSocket();
      anunciar(false);
    },
  };
}

/**
 * Abre um canal de TABELAS e chama `aoMudar(evento)` a cada linha que muda.
 *
 * `evento` é `{tabela, tipo, novo, antigo}` — `tipo` é 'INSERT'/'UPDATE'/
 * 'DELETE', `novo` é a linha depois e `antigo` a linha antes (só em
 * UPDATE/DELETE de tabela com `replica identity full`).
 *
 * @param {object} conf
 * @param {string} conf.url      a URL REST do projeto (https://…supabase.co)
 * @param {string} conf.apikey   a chave publicável
 * @param {() => Promise<string|null>} conf.token  devolve um JWT válido (renova)
 * @param {Array<{table: string, event?: string, filter?: string}>} conf.tabelas
 * @param {(e: {tabela, tipo, novo, antigo}) => void} aoMudar
 * @param {(ligado: boolean) => void} [aoEstado] avisado quando o canal sobe/cai
 * @returns {() => void} chame para fechar. Fechar é definitivo: não reconecta.
 */
export function ouvirMudancas(conf, aoMudar, aoEstado = () => {}) {
  const { url, apikey, token, tabelas } = conf ?? {};

  const canal = abrirCanal(
    {
      url, apikey, token,
      topico: 'realtime:classic-duels',
      esperaTabelas: true,
      config: {
        broadcast: { self: false },
        presence: { key: '' },
        postgres_changes: (tabelas ?? []).map((t) => ({
          event: t.event ?? '*',
          schema: 'public',
          table: t.table,
          ...(t.filter ? { filter: t.filter } : {}),
        })),
      },
    },
    // Este canal não transmite nada, mas filtrar é de graça e impede que um
    // recado de outro cliente vire "alguma tabela mudou, releia" aqui dentro.
    (e) => { if (e.tipo !== 'BROADCAST') aoMudar(e); },
    aoEstado,
  );

  return canal.fechar;
}

/**
 * Abre um canal de TRANSMISSÃO — cliente falando com cliente, sem passar pelo
 * banco. É o que carrega as posições de quem anda no Mundo.
 *
 * `self: false` faz o servidor **não** devolver o que eu mesmo mandei; sem
 * isso, cada um veria um sósia seu parado em cima de si.
 *
 * @param {object} conf  `url`, `apikey`, `token` como acima, mais:
 * @param {string} conf.sala  o nome do canal (vira `realtime:<sala>`)
 * @param {(evento: string, carga: any) => void} aoReceber
 * @param {(ligado: boolean) => void} [aoEstado]
 * @returns {{transmitir: (evento: string, carga: any) => void, fechar: () => void}}
 */
export function ouvirTransmissoes(conf, aoReceber, aoEstado = () => {}) {
  const { url, apikey, token, sala } = conf ?? {};

  const canal = abrirCanal(
    {
      url, apikey, token,
      topico: `realtime:${sala}`,
      // Este join não pede tabela nenhuma, então a resposta dele pode vir sem a
      // chave `postgres_changes`. Ver `interpretar`.
      esperaTabelas: false,
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: '' },
        postgres_changes: [],
      },
    },
    (e) => { if (e.tipo === 'BROADCAST') aoReceber(e.evento, e.carga); },
    aoEstado,
  );

  return {
    transmitir: (evento, carga) => canal.enviar('broadcast', {
      type: 'broadcast', event: evento, payload: carga,
    }),
    fechar: canal.fechar,
  };
}

/**
 * Traduz uma mensagem crua do canal.
 *
 * Separada e exportada porque é a parte que erra **calada**: um campo lido do
 * lugar errado devolve `undefined`, a notificação não aparece e não há erro
 * nenhum — nem no console. É a mesma razão de o protocolo binário do ocgcore
 * ter teste.
 *
 * Devolve `null` para o que não interessa (o `phx_reply` do heartbeat, os
 * `presence_state` que o servidor manda sozinho), e dois tipos internos para o
 * resultado do join, que quem chama usa para saber se o canal subiu.
 *
 * `esperaTabelas` diz se o join PEDIU `postgres_changes`. Ele existe porque a
 * marca de "este é o reply do join, e não o do `access_token`" é a presença
 * dessa chave na resposta — e num canal só de transmissão ela pode não vir.
 * Assumir que vem faria o canal do Mundo nunca se declarar de pé; assumir que
 * não vem faria o canal das tabelas tratar cada renovação de token como um join
 * novo. As duas erram caladas, em direções opostas.
 */
export function interpretar(msg, { esperaTabelas = true } = {}) {
  if (!msg || typeof msg !== 'object') return null;

  if (msg.event === 'phx_reply' && String(msg.topic ?? '').startsWith('realtime:')) {
    const status = msg.payload?.status;
    // "ok" sem `postgres_changes` na resposta é o reply do `access_token`, não
    // o do join — tratá-lo como join faria a tela desligar a reserva cedo.
    if (status === 'ok' && (!esperaTabelas || msg.payload?.response?.postgres_changes)) {
      return { tipo: '__join_ok', tabela: null, novo: null, antigo: null };
    }
    if (status === 'error') return { tipo: '__join_erro', tabela: null, novo: null, antigo: null };
    return null;
  }

  // Recado de outro cliente. A carga vem ANINHADA (`payload.payload`): o nível
  // de fora é o envelope do Phoenix, com o nome do evento; o de dentro é o que
  // o outro cliente escreveu. Ler o de fora devolve um objeto plausível e
  // errado, sem erro nenhum.
  if (msg.event === 'broadcast') {
    const env = msg.payload;
    if (!env?.event) return null;
    return {
      tipo: 'BROADCAST', evento: String(env.event),
      carga: env.payload ?? null, tabela: null, novo: null, antigo: null,
    };
  }

  if (msg.event !== 'postgres_changes') return null;

  const d = msg.payload?.data;
  if (!d?.table || !d?.type) return null;

  return {
    tabela: d.table,
    tipo: d.type,
    // `record`/`old_record` vêm `{}` (e não `null`) quando não se aplicam, o
    // que faz um `?.` sobre eles devolver undefined em silêncio. Normalizo para
    // null aqui, uma vez, em vez de em cada leitor.
    novo: d.record && Object.keys(d.record).length ? d.record : null,
    antigo: d.old_record && Object.keys(d.old_record).length ? d.old_record : null,
  };
}
