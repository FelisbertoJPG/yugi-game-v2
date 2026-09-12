/**
 * QUEM MAIS ESTÁ NA FLORESTA — `node web/js/mundovivo.test.mjs`
 *
 * O Mundo é um lugar de encontro: entra-se pelo menu da home, anda-se, e
 * vê-se quem mais está andando. Nada mais acontece — não há duelo, conversa
 * nem colisão entre pessoas.
 *
 * O que se vê julga-se OLHANDO, e por isso este arquivo não tenta julgar
 * aparência. Ele guarda as duas decisões que erram **caladas** e que, erradas,
 * dão exatamente a mesma tela de um mundo funcionando:
 *
 *  - **a CADÊNCIA.** Mandar a posição só quando ela muda é a economia óbvia e
 *    é o defeito principal desta feature: quem fica parado deixa de dar
 *    notícia, o prazo de sumiço vence, e o corpo **evapora da tela dos outros**
 *    enquanto a pessoa está claramente ali, de pé. O avesso custa igual —
 *    mandar a cada quadro são sessenta mensagens por segundo por pessoa, que o
 *    servidor passa a descartar, e o mundo engasga para todos ao mesmo tempo.
 *    Nenhum dos dois dá erro em lugar nenhum;
 *
 *  - **o recado que NINGUÉM validou.** Uma linha de tabela passou por policy,
 *    por tipo de coluna e por gatilho. Uma transmissão foi escrita pelo cliente
 *    do outro lado e chega crua. Um `x` que não é número vira `NaN` na matriz
 *    do boneco, e objeto com matriz NaN **simplesmente não aparece** — sem
 *    erro, sem console: a mesma armadilha que o `MUNDO-3D-HANDOFF.md` §5
 *    documenta para as instâncias. Por isso tudo passa por `limparRecado`, e o
 *    que não passa é DESCARTADO em vez de corrigido — um palpite sobre um dado
 *    torto é um corpo no lugar errado, que é pior que corpo nenhum.
 *
 * Cada recusa tem par CONTROLE: sem o recado BOM passando ao lado do torto,
 * um `limparRecado` que devolvesse `null` sempre passaria em todas as
 * asserções — e o mundo ficaria permanentemente vazio, com os testes verdes.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  ENVIO_MS, BATIDA_MS, SUMICO_MS,
  limparRecado, aplicar, sumidos, deveMandar, desvioDeEntrada, normalizarGiro,
} from './mundovivo.js';
import { MUNDO, construirFloresta, livre } from './floresta.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

/** Um recado bem-formado, para servir de par controle de cada recusa. */
const bom = (extra = {}) => ({ id: 'uuid-de-alguem', x: 3, z: -4, giro: 1.2, ...extra });

console.log('\n  ---- o recado que chega do outro lado ----\n');

t('o recado bom passa inteiro (o par CONTROLE de todas as recusas)', () => {
  const r = limparRecado(bom(), 'eu');
  assert.ok(r, 'o recado bom foi recusado — nada mais aqui provaria coisa alguma');
  assert.equal(r.id, 'uuid-de-alguem');
  assert.equal(r.x, 3);
  assert.equal(r.z, -4);
  assert.ok(Math.abs(r.giro - 1.2) < 1e-9);
});

t('coordenada que não é número é DESCARTADA, nunca consertada', () => {
  // Cada um destes vira `NaN` na matriz do boneco, e o corpo some sem erro.
  for (const torto of [
    { x: NaN }, { z: NaN }, { giro: NaN },
    { x: Infinity }, { z: -Infinity },
    { x: 'perto do lago' }, { z: null }, { giro: undefined },
    { x: {} }, { z: [] },
  ]) {
    assert.equal(limparRecado(bom(torto), 'eu'), null,
      `passou: ${JSON.stringify(torto)} — matriz NaN não desenha e não reclama`);
  }
});

t('coordenada fora da parede do mundo é descartada', () => {
  const fora = MUNDO.raio + 50;
  assert.equal(limparRecado(bom({ x: fora, z: 0 }), 'eu'), null);
  assert.equal(limparRecado(bom({ x: 0, z: -fora }), 'eu'), null);
  // CONTROLE: rente ao muro ainda é lugar. A colisão de quem manda desliza
  // encostada nele, então recusar o limite exato apagaria quem anda pela borda.
  assert.ok(limparRecado(bom({ x: MUNDO.raio - 0.5, z: 0 }), 'eu'),
    'quem anda rente ao muro foi apagado');
});

t('o recado sem id, ou com id gigante, é descartado', () => {
  for (const torto of [{ id: '' }, { id: '   ' }, { id: 42 }, { id: null }, { id: 'x'.repeat(65) }]) {
    assert.equal(limparRecado(bom(torto), 'eu'), null, `passou: ${JSON.stringify(torto)}`);
  }
  assert.equal(limparRecado(null, 'eu'), null);
  assert.equal(limparRecado('texto solto', 'eu'), null);
});

/**
 * O servidor já manda `self: false`, mas uma SEGUNDA ABA da mesma conta é outro
 * cliente, e o recado dela volta com o meu próprio id. Sem esta linha, abrir o
 * jogo duas vezes põe um sósia andando em cima de você.
 */
t('o meu próprio id é descartado — o sósia da segunda aba', () => {
  assert.equal(limparRecado(bom({ id: 'eu' }), 'eu'), null);
  // CONTROLE: sem saber quem sou eu, tudo passa (é o caso de quem só observa).
  assert.ok(limparRecado(bom({ id: 'eu' }), null));
});

/**
 * **O recado carrega COORDENADA, e nada de identidade.**
 *
 * Isto já foi diferente: o NOME viajava aqui, dito pelo cliente que o mandava,
 * e o handoff registrava como limite conhecido que **no dia em que houvesse
 * interação ele teria de vir do servidor, senão a etiqueta viraria
 * credencial**. Esse dia chegou com a roupa comprável (migration 0054).
 *
 * Devolver qualquer letra de identidade para cá reabre o buraco **sem que nada
 * acuse** — a tela fica idêntica, e o cosmético de 500 DP passa a ser de graça
 * para quem edita o payload. Por isso o teste é sobre o que a função NÃO
 * devolve, e não sobre o que ela faz com um nome torto.
 */
t('o recado não carrega nome nem roupa — só onde a pessoa está', () => {
  const r = limparRecado(bom({ nome: 'Kaiba', aparencia: { roupa: { peca: 'roupa-jaqueta' } } }), 'eu');
  assert.deepEqual(Object.keys(r).sort(), ['giro', 'id', 'x', 'z'],
    'o recado voltou a carregar identidade — quem responde isso é a rpc/aparencias');

  // E a fonte também não pode voltar a MANDAR: o que não se envia não se lê.
  const src = readFileSync(new URL('mundovivo.js', import.meta.url), 'utf8');
  const onde = src.match(/transmitir\('onde',([\s\S]*?)\}\);/);
  assert.ok(onde, 'não achei o envio da posição');
  assert.ok(!/nome|usuario|aparencia/.test(onde[1]),
    'o envio da posição voltou a levar identidade junto');
});

t('o giro chega normalizado, para a interpolação não dar a volta', () => {
  // 7 rad é pouco mais que uma volta: cru, ele faria o corpo girar no eixo.
  const r = limparRecado(bom({ giro: 7 }), 'eu');
  assert.ok(r.giro >= -Math.PI && r.giro <= Math.PI, `giro fora da faixa: ${r.giro}`);
  assert.ok(Math.abs(normalizarGiro(3.1) - 3.1) < 1e-9);
  assert.ok(Math.abs(normalizarGiro(3.3) - (3.3 - 2 * Math.PI)) < 1e-9);
  // A volta curta entre 3,1 e -3,1 é de ~0,08 rad, e não de ~6,2.
  assert.ok(Math.abs(normalizarGiro(-3.1 - 3.1)) < 0.1);
});

console.log('\n  ---- guardar quem chegou ----\n');

t('a primeira notícia CRIA o corpo, as seguintes só o miram', () => {
  const mundo = new Map();
  assert.equal(aplicar(mundo, limparRecado(bom()), 1000), 'entrou');
  assert.equal(aplicar(mundo, limparRecado(bom({ x: 9 })), 1200), 'moveu');
  assert.equal(mundo.size, 1, 'a mesma pessoa virou duas');

  const p = mundo.get('uuid-de-alguem');
  // A posição recebida vira ALVO e não posição: oito notícias por segundo
  // desenhadas em sessenta quadros dariam um boneco andando em degraus.
  assert.equal(p.alvoX, 9, 'o alvo não acompanhou');
  assert.equal(p.x, 3, 'a posição saltou para o alvo — quem desenha é que caminha até ele');
  assert.equal(p.visto, 1200);
});

t('quem para de dar notícia sai, e quem deu há pouco fica', () => {
  const mundo = new Map();
  aplicar(mundo, limparRecado(bom({ id: 'sumido' })), 0);
  aplicar(mundo, limparRecado(bom({ id: 'presente' })), 10_000);

  const fora = sumidos(mundo, 10_000);
  assert.deepEqual(fora, ['sumido']);
  // CONTROLE: um `sumidos` que devolvesse todo mundo esvaziaria a floresta a
  // cada quadro, e a tela ficaria igualzinha à de um mundo sem ninguém.
  assert.equal(sumidos(mundo, 10_000).includes('presente'), false);
});

console.log('\n  ---- a cadência (o defeito principal) ----\n');

/**
 * A prova de que **parado ainda dá notícia**.
 *
 * Este é o teste que justifica o arquivo: sem a batida do parado, quem fica de
 * pé some da tela de todo mundo depois de `SUMICO_MS`, e do lado de quem olha
 * isso é indistinguível de a pessoa ter saído do jogo.
 */
t('parado ainda manda — só devagar', () => {
  const parado = { ultimo: 0, x: 1, z: 1, giro: 0 };
  const mesmoLugar = { x: 1, z: 1, giro: 0 };

  assert.equal(deveMandar(parado, ENVIO_MS + 1, mesmoLugar), false,
    'parado mandou no ritmo de quem anda — sessenta mensagens por segundo à toa');
  assert.equal(deveMandar(parado, BATIDA_MS + 1, mesmoLugar), true,
    'parado nunca manda — o corpo evapora da tela dos outros em SUMICO_MS');
});

t('andando manda no ritmo de andar, e não antes', () => {
  const estado = { ultimo: 0, x: 1, z: 1, giro: 0 };
  const adiante = { x: 3, z: 1, giro: 0 };

  assert.equal(deveMandar(estado, ENVIO_MS - 1, adiante), false, 'mandou antes da hora');
  assert.equal(deveMandar(estado, ENVIO_MS, adiante), true, 'andou e não deu notícia');
});

t('a primeira notícia sai sempre — é ela que faz o corpo existir', () => {
  assert.equal(deveMandar({ ultimo: null }, 0, { x: 0, z: 0, giro: 0 }), true);
  assert.equal(deveMandar(null, 0, { x: 0, z: 0, giro: 0 }), true);
});

t('girar conta como se mexer, mas o tremor do mouse não', () => {
  const estado = { ultimo: 0, x: 1, z: 1, giro: 0 };
  assert.equal(deveMandar(estado, ENVIO_MS, { x: 1, z: 1, giro: 0.9 }), true,
    'virar-se para alguém não é notícia — o corpo fica olhando para o lado errado');
  // Um milímetro e um centésimo de radiano não são movimento: contá-los faria
  // todo quadro virar mensagem, que é o avesso do defeito de cima.
  assert.equal(deveMandar(estado, ENVIO_MS, { x: 1.001, z: 1, giro: 0.001 }), false);
});

/**
 * A folga entre a batida e o prazo é o que impede a pessoa de PISCAR entre
 * existir e não existir por causa de um atraso de rede qualquer. É a mesma
 * conta que `presenca.js` faz contra a janela do banco — lá 45s contra 2min.
 */
t('o prazo de sumiço tem folga de sobra sobre a batida', () => {
  assert.ok(SUMICO_MS >= BATIDA_MS * 3,
    `SUMICO_MS (${SUMICO_MS}) precisa aguentar várias batidas de ${BATIDA_MS} perdidas`);
  assert.ok(ENVIO_MS < BATIDA_MS, 'andar tem de dar notícia mais amiúde que ficar parado');
  assert.ok(ENVIO_MS >= 60, 'ritmo de quadro vira enxurrada de mensagem e o servidor descarta');
});

console.log('\n  ---- o ponto de nascimento ----\n');

t('duas pessoas não nascem uma dentro da outra, e o desvio é determinístico', () => {
  const a = desvioDeEntrada('uuid-a');
  const b = desvioDeEntrada('uuid-b');

  // Determinístico como toda a floresta: sortear por boot faria a mesma conta
  // dar respostas diferentes a cada abertura, e um relato de bug deixaria de
  // ser reproduzível.
  assert.deepEqual(desvioDeEntrada('uuid-a'), a, 'o desvio mudou entre duas chamadas');
  assert.notDeepEqual(a, b, 'ids diferentes nasceram no mesmo ponto');

  for (const id of ['a', 'b', 'c', 'uuid-longo-de-verdade-0000', '']) {
    const d = desvioDeEntrada(id);
    assert.ok(Number.isFinite(d.dx) && Number.isFinite(d.dz), `desvio NaN para "${id}"`);
    const r = Math.hypot(d.dx, d.dz);
    // Perto o bastante para continuar sendo a porta de entrada, longe o
    // bastante para dois corpos não se sobreporem.
    assert.ok(r > 0.5 && r < 3.2, `desvio de ${r.toFixed(2)}m para "${id}"`);
  }
});

t('o ponto de entrada continua alcançável depois do desvio', () => {
  const mapa = construirFloresta();
  // O desvio pode cair dentro de uma árvore — quem o aplica passa pelo `mover`,
  // e é o deslize da colisão que resolve. Aqui se prova que a clareira tem onde
  // pousar, que é a premissa disso funcionar.
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    const d = desvioDeEntrada(id);
    const x = mapa.entrada.x + d.dx, z = mapa.entrada.z + d.dz;
    assert.ok(Math.hypot(x, z) < MUNDO.raio, `nasceu fora do mundo com "${id}"`);
  }
  assert.ok(livre(mapa.colisores, mapa.entrada.x, mapa.entrada.z, MUNDO.raioJogador),
    'a própria porta de entrada está dentro de um obstáculo');
});

console.log('\n  ---- o que a tela precisa ter ----\n');

/**
 * A varredura. O módulo é inútil se ninguém o chamar, e "ninguém o chama" não
 * dá erro nenhum: o Mundo abre, a floresta monta, e simplesmente não aparece
 * pessoa nenhuma — que é exatamente a aparência de um mundo vazio.
 */
t('o Mundo liga a presença e desenha as pessoas com a paleta de sempre', () => {
  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  assert.ok(/from '\/web\/js\/mundovivo\.js'/.test(modulo),
    'o Mundo não importa a presença — a floresta fica sempre vazia, sem erro nenhum');
  assert.ok(/entrarNoMundo\(/.test(modulo), 'a presença é importada e nunca ligada');
  assert.ok(/padraoDe|aparencia\.js/.test(modulo),
    'a aparência de fábrica deixou de sair do id — sem ela, quem nunca abriu o vestiário vira clone');
});

/**
 * O nome de outra pessoa é a ÚNICA coisa nesta tela que alguém digita e que
 * aparece na tela de terceiros, e ele chega por um canal que ninguém valida.
 * Montar a etiqueta com `innerHTML` seria pôr um `<script>` de um jogador na
 * floresta de todos os outros. É a mesma regra do chat.
 */
t('a etiqueta de outra pessoa entra por textContent, nunca innerHTML', () => {
  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  const nasce = modulo.match(/function nasceJogador\([\s\S]*?\n\}/);
  assert.ok(nasce, 'não achei o nasceJogador');
  assert.ok(/\.textContent = /.test(nasce[0]), 'o nome não entra por textContent');
  assert.ok(/conhecidos\.get/.test(nasce[0]),
    'a etiqueta voltou a sair do recado em vez da rpc/aparencias');
  // A âncora é a ATRIBUIÇÃO, e não a palavra: ela aparece no comentário logo
  // acima da linha certa, explicando por que não se usa. Varredura que grita
  // por causa da própria explicação deixa de ser lida.
  assert.ok(!/\.innerHTML\s*=/.test(nasce[0]), 'innerHTML com texto de outro jogador');
});

/**
 * Um `Group` de treze geometrias e sete materiais por pessoa. `scene.remove()`
 * tira do grafo e **não** devolve nada à GPU — o navegador não coleta buffer de
 * vídeo por alcançabilidade. Com gente entrando e saindo a sessão inteira, a
 * memória sobe até o contexto de WebGL se perder, e a tela apaga sem um erro
 * que aponte para cá.
 */
t('o corpo de quem sai é devolvido à GPU', () => {
  const boneco = readFileSync(new URL('boneco3d.js', import.meta.url), 'utf8');
  assert.ok(/function descartar\(\)/.test(boneco), 'o boneco não sabe se descartar');
  assert.ok(/dispose/.test(boneco), 'descartar sem dispose não devolve nada');

  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  const morre = modulo.match(/function morreJogador\([\s\S]*?\n\}/);
  assert.ok(morre, 'não achei o morreJogador');
  assert.ok(/descartar\(\)/.test(morre[0]),
    'quem sai é tirado da cena sem devolver a geometria — a memória de vídeo sobe sozinha');
  assert.ok(/\.el\.remove\(\)/.test(morre[0]),
    'a etiqueta de quem saiu fica pendurada no DOM para sempre');
});

/**
 * O "cheguei" tem de sair QUANDO O CANAL SOBE, e não na hora de montar.
 *
 * Isto foi um defeito de verdade: `entrarNoMundo` mandava o ping na última
 * linha, com o `WebSocket` ainda em `CONNECTING`. Mandar com o socket fechado
 * **não enfileira — some** (ver `realtime.js`), então o ping se perdia SEMPRE,
 * calado, e quem chegava olhava uma floresta vazia até a próxima batida de
 * alguém. Vale igual na volta de uma reconexão, que é quando mais importa.
 *
 * A asserção é sobre o TEXTO porque a alternativa seria injetar o canal só para
 * poder espioná-lo — e aí o teste provaria a injeção, não o código que roda.
 */
t('o "cheguei" só é mandado com o canal de pé', () => {
  const src = readFileSync(new URL('mundovivo.js', import.meta.url), 'utf8');
  const pings = [...src.matchAll(/transmitir\('cheguei'/g)];
  assert.equal(pings.length, 1, 'mais de um lugar manda o "cheguei"');
  assert.ok(/if \(ligado\) \{[^}]*transmitir\('cheguei'/.test(src),
    'o "cheguei" sai fora do `if (ligado)` — com o socket ainda conectando, ele some');
  assert.ok(/if \(ligado\) \{\s*estado\.ultimo = null;/.test(src),
    'conectar não repõe a minha posição — parado, eu só apareceria na batida seguinte');
});

/**
 * "Não tem ninguém aqui" e "não consegui ligar" são a MESMA floresta vazia na
 * tela. Sem uma linha dizendo qual dos dois é, a primeira conclusão de quem
 * abre um mundo deserto é que a feature não funciona — e a segunda é parar de
 * abrir.
 */
t('a tela diz se o canal está de pé, senão o mundo vazio é ambíguo', () => {
  const html = readFileSync(new URL('../mundo3d.html', import.meta.url), 'utf8');
  assert.ok(/id="vivo"/.test(html), 'não há selo de estado do canal');
  assert.ok(/id="quantos"/.test(html), 'não há contador de quem está por perto');

  const modulo = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  assert.ok(/aoEstado:/.test(modulo), 'o selo existe e nunca é atualizado — pior que não existir');
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
