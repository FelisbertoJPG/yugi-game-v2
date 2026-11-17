/**
 * Card Builder — `node web/js/cardbuilder.test.mjs`
 *
 * O Card Builder ESCREVE Lua, e Lua errado não dá erro em lugar nenhum daqui:
 * o navegador mostra o código, o banco o grava, e só um duelo descobriria que
 * a carta nunca é oferecida. Por isso o que se prova é o que erra CALADO:
 *
 *   • toda CONSTANTE que o gerador escreve existe no `constant.lua` do MOTOR —
 *     uma constante inexistente vira `nil` em Lua, e `SetCode(nil)` registra um
 *     efeito que nunca dispara;
 *   • os NÚMEROS de tipo/raça/atributo batem com o `constant.lua` (lidos do
 *     arquivo, nunca copiados: número copiado envelhece calado);
 *   • toda função auxiliar usada (`Cost.*`, `aux.AddEquipProcedure`,
 *     `Ritual.AddProcGreater`) existe nos scripts que o motor carrega;
 *   • todo script sai BALANCEADO (`function`/`if` × `end`) em TODA combinação
 *     de tipo × momento × ação × alvo × custo × limite;
 *   • o nome da carta, único texto livre, não vira linha de código;
 *   • a Magia Contínua ganha a ativação que a põe na zona — sem ela o motor
 *     nunca oferece "Ativar", e nada acusa;
 *   • a faixa de id da tela é a mesma da CHECK da migration 0058.
 *
 * Nada aqui roda o motor: provar que a carta FUNCIONA num duelo é trabalho de
 * uma suíte do `duel-server`, no dia em que ele carregar cartas do builder.
 *
 * Os separadores Unicode de linha e parágrafo são montados com
 * `String.fromCharCode` e procurados por `\p{Zl}`/`\p{Zp}`, nunca escritos
 * literais: dentro de um regex eles terminam a linha e o arquivo nem carrega.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as CB from './cardbuilder.js';
import { isExtraDeck } from './deck.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const RAIZ = new URL('../../', import.meta.url);
const SCRIPTS = new URL('duel_academy/Assets/StreamingAssets/YGODemo/script/', RAIZ);
const ler = (url) => readFileSync(url, 'utf8');
const CONSTANT = ler(new URL('constant.lua', SCRIPTS));
const UTILITY = ler(new URL('utility.lua', SCRIPTS));
const PROC_EQUIP = ler(new URL('proc_equip.lua', SCRIPTS));
const PROC_RITUAL = ler(new URL('proc_ritual.lua', SCRIPTS));

const definida = (nome) => new RegExp(`^\\s*${nome}\\s*=`, 'm').test(CONSTANT);
const valorHex = (nome) => {
  const m = CONSTANT.match(new RegExp(`^\\s*${nome}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+)`, 'm'));
  return m ? Number(m[1]) : null;
};

/** Lua sem comentários — o nome da carta e os rótulos moram neles. */
const semComentarios = (lua) => lua.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const conta = (txt, palavra) => (txt.match(new RegExp(`\\b${palavra}\\b`, 'g')) ?? []).length;

const filtroCheio = () => ({
  categoria: 'qualquer', raca: 'Dragon', atributo: 'LIGHT', nivelMin: 3, nivelMax: 4,
  atkMin: 1000, atkMax: 1800, defMin: 0, defMax: 2000, codigo: 12345,
});

/** Toda combinação que a tela consegue montar. */
function todasAsCartas() {
  const fora = [];
  const bases = [];
  for (const [tipo] of CB.TIPOS) {
    const subs = CB.SUBTIPOS[tipo] ? CB.SUBTIPOS[tipo].map((s) => s[0]) : ['normal'];
    for (const subtipo of subs) bases.push({ tipo, subtipo });
  }
  const variantes = [
    {},
    { origem: 'cemiterio', lado: 'qualquer', zona: 'qualquer', duracao: 'permanente', atk: -200, def: 300 },
    { origem: 'cemiterio-ambos', lado: 'oponente', zona: 'magia-armadilha', destruirNegada: false, respondeA: ['monstro'] },
    // A categoria composta: custo filtrado de Tipos diferentes e três passos no
    // "e depois" — é a forma do efeito da Dragias, e a que mais escreve Lua.
    {
      custoQtd: 2, custoTiposDiferentes: true, ataques: 3, duracao: 'permanente',
      custoFiltros: [{ categoria: 'monstro-normal', nivelMin: 5, atkMax: 1900 }],
      depois: [
        { acao: 'destruir', alvo: 'outra', lado: 'qualquer', zona: 'qualquer', filtros: [] },
        { acao: 'ataques', alvo: 'esta', ataques: 2 },
        { acao: 'bonus', alvo: 'outra', lado: 'meus', atk: 300, filtros: [{ categoria: 'monstro', raca: 'Dragon' }] },
      ],
    },
    // A forma da Dragon's Inferno: condição de controlar, Deck E Cemitério, e o
    // "de nomes diferentes" que escreve o laço à mão do baixar.
    {
      origem: 'deck-cemiterio', nomesDiferentes: true, quantidade: 2,
      condicao: 'controla', condicaoFiltros: [{ categoria: 'monstro-normal', raca: 'Dragon', nivelMin: 5, nivelMax: 6 }],
      depois: [{ acao: 'baixar', alvo: 'outra', origem: 'deck-cemiterio', quantidade: 2, nomesDiferentes: true, filtros: [] }],
    },
    // O "(pode ser ativada neste turno)" e o filtro do GATILHO. Precisam estar
    // AQUI, e não só num teste próprio: as varreduras (constante inexistente,
    // `function`×`end` desbalanceado, função auxiliar que não existe) só enxergam
    // o que estas combinações geram, e as duas peças nascem desligadas — sem
    // esta variante, o `EFFECT_FLAG_SET_AVAILABLE` e o `aux.Next` do rider nunca
    // seriam conferidos contra o motor.
    {
      origem: 'deck-mao-cemiterio', ativaNoTurno: true, quantidade: 1,
      gatilhoFiltros: [{ categoria: 'monstro-normal', nivelMin: 5, nivelMax: 6, atkMax: 1900 }],
      depois: [{
        acao: 'baixar', alvo: 'outra', origem: 'deck-mao-cemiterio', quantidade: 1, ativaNoTurno: true,
        filtros: [{ categoria: 'qualquer', codigo: 950000003, codigoNome: 'Legado dos Guerreiros' }],
      }],
    },
  ];
  for (const base of bases) {
    const carta0 = {
      ...CB.novaCarta(), ...base, nome: 'Teste', efeitos: [],
      ritual: { codigo: 5405694 }, equipa: { lado: 'qualquer', filtros: [filtroCheio()] },
    };
    const qs = CB.quandoPermitidos(carta0);
    if (!qs.length) { fora.push(carta0); continue; }
    for (const quando of qs) {
      for (const acao of CB.acoesPermitidas(carta0, quando)) {
        const alvos = CB.alvosPermitidos(carta0, quando, acao);
        for (const alvo of (alvos.length ? alvos : [null])) {
          for (const custo of CB.custosPermitidos(carta0, quando)) {
            for (const limite of CB.limitesPermitidos(carta0, quando)) {
              for (const v of variantes) {
                const ef = CB.ajustarEfeito(carta0, {
                  ...CB.novoEfeito(), quando, acao, alvo, custo, limite, ...v,
                  filtros: [filtroCheio(), { categoria: 'monstro', raca: 'Warrior' }],
                });
                fora.push({ ...carta0, efeitos: [ef] });
              }
            }
          }
        }
      }
    }
  }
  return fora;
}

const CARTAS = todasAsCartas();
const SCRIPTS_GERADOS = CARTAS.map((c) => CB.gerarLua(c));

console.log(`cardbuilder — ${CARTAS.length} combinações`);

t('toda combinação gera um script com GetID e initial_effect', () => {
  assert.ok(CARTAS.length > 200, `só ${CARTAS.length} combinações — o gerador de casos quebrou?`);
  for (const lua of SCRIPTS_GERADOS) {
    assert.match(lua, /^local s,id=GetID\(\)$/m);
    assert.match(lua, /^function s\.initial_effect\(c\)$/m);
  }
});

t('toda CONSTANTE escrita existe no constant.lua do motor', () => {
  const faltam = new Set();
  for (const lua of SCRIPTS_GERADOS) {
    for (const m of semComentarios(lua).matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)) {
      if (!definida(m[0])) faltam.add(m[0]);
    }
  }
  assert.deepEqual([...faltam], []);
});

t('a varredura de constantes RECONHECE o caso ruim', () => {
  assert.equal(definida('EVENT_SUMMON_SUCCESS'), true);
  assert.equal(definida('EVENT_INVENTADO_SUCCESS'), false);
});

t('os números de tipo, raça e atributo são os do constant.lua', () => {
  for (const [nome, v] of Object.entries(CB.BITS_DE_TIPO)) assert.equal(v, valorHex(nome), nome);
  for (const r of CB.RACAS) assert.equal(r[3], valorHex(r[2]), r[2]);
  for (const a of CB.ATRIBUTOS) assert.equal(a[3], valorHex(a[2]), a[2]);
});

t('toda função auxiliar usada existe nos scripts do motor', () => {
  const usadas = new Set();
  for (const lua of SCRIPTS_GERADOS) {
    for (const m of lua.matchAll(/\bCost\.(\w+)/g)) usadas.add(`Cost.${m[1]}`);
  }
  assert.ok(usadas.size >= 4, 'os custos não apareceram nas combinações');
  for (const u of usadas) {
    const nome = u.split('.')[1];
    assert.match(UTILITY, new RegExp(`function Cost\\.${nome}\\(|^Cost\\.${nome}\\s*=`, 'm'), u);
  }
  assert.match(PROC_EQUIP, /function Auxiliary\.AddEquipProcedure\(/);
  assert.match(PROC_RITUAL, /Ritual\.AddProcGreater = /);
  assert.match(UTILITY, /function Auxiliary\.FilterBoolFunction\(/);
});

t('todo script sai balanceado (function + if = end) e sem valor vazado', () => {
  SCRIPTS_GERADOS.forEach((lua, i) => {
    const s = semComentarios(lua);
    // `do` conta o `for … do … end` do custo "de Tipos diferentes".
    assert.equal(conta(s, 'function') + conta(s, 'if') + conta(s, 'do'), conta(s, 'end'), `combinação ${i}:\n${lua}`);
    assert.doesNotMatch(s, /\b(undefined|null|NaN)\b/, `combinação ${i}`);
  });
});

t('o exemplo do pedido: descarta esta carta e busca "raça X OU Nível/ATK numa faixa"', () => {
  const carta = {
    ...CB.novaCarta(), nome: 'Batedor do Portão', tipo: 'monstro-efeito',
    efeitos: [{
      quando: 'mao', custo: 'descartar-esta', limite: 'por-nome', acao: 'adicionar', alvo: 'outra',
      origem: 'deck', quantidade: 1,
      filtros: [
        { categoria: 'monstro', raca: 'Dragon' },
        { categoria: 'monstro', nivelMin: 3, nivelMax: 4, atkMin: 1000, atkMax: 1800 },
      ],
    }],
  };
  assert.deepEqual(CB.problemasDaCarta(carta), []);
  const lua = CB.gerarLua(carta);
  assert.match(lua, /e1:SetType\(EFFECT_TYPE_IGNITION\)/);
  assert.match(lua, /e1:SetRange\(LOCATION_HAND\)/);
  assert.match(lua, /e1:SetCost\(Cost\.SelfDiscard\)/);
  assert.match(lua, /e1:SetCountLimit\(1,id\)/);
  assert.match(lua, /e1:SetCategory\(CATEGORY_TOHAND\+CATEGORY_SEARCH\)/);
  assert.ok(lua.includes('(c:IsType(TYPE_MONSTER) and c:IsRace(RACE_DRAGON))'), lua);
  assert.ok(lua.includes('or (c:IsType(TYPE_MONSTER) and c:IsLevelAbove(3) and c:IsLevelBelow(4) and c:IsAttackAbove(1000) and c:IsAttackBelow(1800))'), lua);
  assert.match(lua, /Duel\.SelectMatchingCard\(tp,s\.filtro1,tp,LOCATION_DECK,0,1,1,nil\)/);
  const texto = CB.textoDosEfeitos(carta);
  assert.match(texto, /descarte esta carta; adicione 1 monstro Dragão, ou monstro de Nível 3 a 4 com 1000 a 1800 de ATK do seu Deck/);
});

t('filtro por ATK sem categoria exige MONSTRO (senão a busca pega magia de ATK 0)', () => {
  const carta = {
    ...CB.novaCarta(), nome: 'x', tipo: 'magia', subtipo: 'normal',
    efeitos: [{ quando: 'ativacao', acao: 'adicionar', alvo: 'outra', origem: 'deck', filtros: [{ categoria: 'qualquer', atkMax: 1500 }] }],
  };
  assert.ok(CB.gerarLua(carta).includes('(c:IsType(TYPE_MONSTER) and c:IsAttackBelow(1500)) and c:IsAbleToHand()'));
});

t('o NOME não vira linha de código', () => {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const carta = { ...CB.novaCarta(), nome: `Carta\nDuel.Win(0,0x1)\r\nDuel.Win(1,0x1)${LS}Duel.Win(0,0x2)${PS}x` };
  const lua = CB.gerarLua(carta);
  assert.equal(lua.split('\n')[0].startsWith('--'), true);
  assert.doesNotMatch(lua, /^Duel\.Win/m);
  assert.doesNotMatch(lua, /[\p{Zl}\p{Zp}]/u);
});

t('Magia Contínua sem efeito de ativação ganha a ativação que a põe na zona', () => {
  const sem = { ...CB.novaCarta(), nome: 'x', tipo: 'magia', subtipo: 'continua',
    efeitos: [{ quando: 'continuo', acao: 'bonus', alvo: 'outra', lado: 'meus', atk: 300, filtros: [] }] };
  const lua = CB.gerarLua(sem);
  assert.match(lua, /e0:SetType\(EFFECT_TYPE_ACTIVATE\)/);
  assert.match(lua, /e1:SetRange\(LOCATION_SZONE\)/);
  // par CONTROLE: com um efeito na ativação, ele É a ativação — duas seriam duas ofertas
  const com = { ...sem, efeitos: [{ quando: 'ativacao', acao: 'comprar', quantidade: 1 }, ...sem.efeitos] };
  assert.doesNotMatch(CB.gerarLua(com), /local e0=/);
});

t('Magia de Campo mora na zona de Campo', () => {
  const carta = { ...CB.novaCarta(), nome: 'x', tipo: 'magia', subtipo: 'campo',
    efeitos: [{ quando: 'continuo', acao: 'bonus', alvo: 'outra', lado: 'qualquer', atk: 200, filtros: [{ categoria: 'monstro', raca: 'Insect' }] }] };
  const lua = CB.gerarLua(carta);
  assert.match(lua, /SetRange\(LOCATION_FZONE\)/);
  assert.match(lua, /SetTargetRange\(LOCATION_MZONE,LOCATION_MZONE\)/);
});

t('as combinações que não fecham viram PROBLEMA (e o controle passa)', () => {
  const monstro = (ef) => ({ ...CB.novaCarta(), nome: 'x', efeitos: [ef] });
  const temProblema = (c) => CB.problemasDaCarta(c).length > 0;

  assert.ok(temProblema(monstro({ quando: 'mao', custo: 'descartar-esta', acao: 'reviver', alvo: 'esta' })));
  assert.ok(!temProblema(monstro({ quando: 'mao', custo: 'nenhum', acao: 'reviver', alvo: 'esta' })), 'controle');

  assert.ok(temProblema(monstro({ quando: 'campo', acao: 'bonus', alvo: 'esta', atk: 0, def: 0 })));
  assert.ok(!temProblema(monstro({ quando: 'campo', acao: 'bonus', alvo: 'esta', atk: 500 })), 'controle');

  assert.ok(temProblema(monstro({ quando: 'mao', acao: 'adicionar', alvo: 'outra', filtros: [{ categoria: 'magia', atkMin: 100 }] })));
  assert.ok(temProblema(monstro({ quando: 'mao', acao: 'adicionar', alvo: 'outra', filtros: [{ categoria: 'monstro', nivelMin: 5, nivelMax: 2 }] })));

  assert.ok(temProblema({ ...CB.novaCarta(), nome: 'x', tipo: 'monstro-normal', efeitos: [CB.novoEfeito()] }));
  assert.ok(!temProblema({ ...CB.novaCarta(), nome: 'x', tipo: 'monstro-normal', efeitos: [] }), 'controle');

  assert.ok(temProblema({ ...CB.novaCarta(), nome: 'x', tipo: 'magia', subtipo: 'normal', efeitos: [] }));
  assert.ok(temProblema({ ...CB.novaCarta(), nome: '', efeitos: [CB.novoEfeito()] }));
  assert.ok(temProblema({ ...CB.novaCarta(), nome: 'x', tipo: 'magia', subtipo: 'ritual', efeitos: [], ritual: { codigo: null } }));
});

t('trocar o tipo reajusta o efeito para o que o tipo novo aceita', () => {
  const magia = { ...CB.novaCarta(), tipo: 'magia', subtipo: 'normal' };
  const ef = CB.ajustarEfeito(magia, { quando: 'mao', custo: 'descartar-esta', acao: 'reviver', alvo: 'esta', limite: 'por-copia' });
  assert.equal(ef.quando, 'ativacao');
  assert.equal(ef.custo, 'nenhum');
  assert.equal(ef.alvo, 'outra');
  assert.equal(ef.limite, 'nenhum');
});

t('dados do motor: tipo empacotado como no cards.cdb', () => {
  assert.equal(CB.dadosDoMotor({ ...CB.novaCarta(), tipo: 'monstro-efeito' }).type, 0x21);
  assert.equal(CB.dadosDoMotor({ ...CB.novaCarta(), tipo: 'magia', subtipo: 'rapida' }).type, 0x10002);
  assert.equal(CB.dadosDoMotor({ ...CB.novaCarta(), tipo: 'armadilha', subtipo: 'contra' }).type, 0x100004);
  const m = CB.dadosDoMotor({ ...CB.novaCarta(), raca: 'Dragon', atributo: 'LIGHT', nivel: 7 });
  assert.deepEqual([m.race, m.attribute, m.level], [0x2000, 0x10, 7]);
});

t('a faixa de id da tela é a mesma da CHECK da migration 0058', () => {
  const sql = ler(new URL('supabase/migrations/0058_cartas_custom.sql', RAIZ));
  const m = sql.match(/check \(id between (\d+) and (\d+)\)/);
  assert.ok(m, 'não achei a CHECK do id na migration');
  assert.deepEqual([Number(m[1]), Number(m[2])], [CB.ID_MIN, CB.ID_MAX]);
});

/**
 * A Multistrike Dragon Dragias, como o usuário a descreveu: *descarte Normais
 * Nv5+ com ATK ≤1900 de Tipos diferentes; Invoque esta carta por
 * Invocação-Especial, então destrua 1 carta no campo; se isso resolver, ela pode
 * atacar 2 vezes*. É a MESMA carta que o `--test-card-builder` joga no motor —
 * a comparação logo abaixo cobra que o Lua de lá é o que o gerador escreve.
 */
const DRAGIAS = {
  ...CB.novaCarta(), nome: 'Multistrike Dragon Dragias', tipo: 'monstro-efeito',
  raca: 'Dragon', atributo: 'DARK', nivel: 7, atk: 2500, def: 1800,
  efeitos: [{
    quando: 'mao', limite: 'por-nome',
    custo: 'descartar-filtro', custoQtd: 2, custoTiposDiferentes: true,
    custoFiltros: [{ categoria: 'monstro-normal', nivelMin: 5, atkMax: 1900 }],
    acao: 'reviver', alvo: 'esta',
    depois: [
      { acao: 'destruir', alvo: 'outra', lado: 'qualquer', zona: 'qualquer', quantidade: 1, filtros: [] },
      { acao: 'ataques', alvo: 'esta', ataques: 2, duracao: 'turno' },
    ],
  }],
};

t('a categoria da Dragias: custo de Tipos diferentes, então destruir, então 2 ataques', () => {
  assert.deepEqual(CB.problemasDaCarta(DRAGIAS), []);
  const lua = CB.gerarLua(DRAGIAS);
  assert.match(lua, /e1:SetCategory\(CATEGORY_SPECIAL_SUMMON\+CATEGORY_DESTROY\)/);
  assert.match(lua, /e1:SetRange\(LOCATION_HAND\)/);
  assert.match(lua, /e1:SetCost\(s\.custo1\)/);
  // o custo: Normais Nv5+ ATK<=1900, um de cada Tipo, escrito à mão (sem Group.Iter)
  assert.ok(lua.includes('c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsLevelAbove(5) and c:IsAttackBelow(1900)'), lua);
  assert.match(lua, /g:GetClassCount\(Card\.GetRace\)>=2/);
  assert.match(lua, /g:Remove\(Card\.IsRace,nil,tc:GetRace\(\)\)/);
  assert.doesNotMatch(lua, /SelectUnselectGroup/);
  // a sequência: cada passo só roda se o anterior resolveu, com BreakEffect entre eles
  assert.match(lua, /if not s\.passo1_1\(e,tp,eg,ep,ev,re,r,rp\) then return end/);
  assert.match(lua, /if not s\.passo1_2\(e,tp,eg,ep,ev,re,r,rp\) then return end/);
  assert.equal((lua.match(/Duel\.BreakEffect\(\)/g) ?? []).length, 2);
  assert.match(lua, /Duel\.SpecialSummon\(c,0,tp,tp,false,false,POS_FACEUP\)>0/);
  assert.match(lua, /Duel\.Destroy\(g,REASON_EFFECT\)>0/);
  // 2 ataques = UM ataque extra
  assert.match(lua, /SetCode\(EFFECT_EXTRA_ATTACK\)/);
  assert.match(lua, /SetValue\(1\)/);
  const texto = CB.textoDosEfeitos(DRAGIAS);
  assert.match(texto, /de Tipos diferentes/);
  assert.match(texto, /se fizer isso, .*destrua/);
  assert.match(texto, /pode atacar 2 vezes/);
});

t('o Lua que o --test-card-builder joga no motor é o que o gerador escreve (Dragias)', () => {
  // A prova tem duas metades em dois lugares: aqui, que o gerador escreve ESTE
  // Lua; no C#, que ESTE Lua funciona no motor. Sem a comparação, o gerador
  // mudaria e o teste do motor continuaria verde provando um script que ninguém
  // mais gera. Comentários ficam de fora: o motor não os lê.
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const m = cs.match(/const string LUA_DRAGIAS =\s*@"([\s\S]*?)";/);
  assert.ok(m, 'não achei o LUA_DRAGIAS em duel-server/src/TestCardBuilder.cs');
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(codigo(m[1]), codigo(CB.gerarLua(DRAGIAS)),
    'o gerador mudou: atualize LUA_DRAGIAS em TestCardBuilder.cs e rode --test-card-builder de novo');
});

t('"Invoque ESTE card" também num passo do "e depois", com a carta na mão', () => {
  // O relato: *"não consegui definir que quem ele vai invocar por especial após a
  // condição é ele mesmo"*. O banco mostrou a Dragias salva com a Invocação num
  // passo, onde só havia "outra carta".
  assert.deepEqual(CB.alvosDoPasso(DRAGIAS, 'reviver', 'mao'), ['outra', 'esta']);
  assert.deepEqual(CB.alvosDoPasso(DRAGIAS, 'reviver', 'campo'), ['outra'], 'controle: em campo não há o que Invocar');
  const ef = CB.ajustarEfeito(DRAGIAS, {
    quando: 'mao', acao: 'comprar', quantidade: 1,
    depois: [{ acao: 'reviver', alvo: 'esta' }, { acao: 'ataques', alvo: 'esta', ataques: 2 }],
  });
  assert.equal(ef.depois[0].alvo, 'esta', 'o ajuste trocou "esta" por "outra" — o momento não chegou ao passo');
  const lua = CB.gerarLua({ ...DRAGIAS, efeitos: [ef] });
  assert.ok(lua.includes([
    'function s.passo1_2(e,tp,eg,ep,ev,re,r,rp)',
    '\tlocal c=e:GetHandler()',
    '\tif not c:IsRelateToEffect(e) or Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return false end',
    '\treturn Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0',
  ].join('\n')), lua);
});

t('"Invocar esta carta" depois de o custo tirá-la da mão não fecha', () => {
  const ef = { quando: 'mao', custo: 'descartar-esta', acao: 'comprar', quantidade: 1, depois: [{ acao: 'reviver', alvo: 'esta' }] };
  assert.ok(CB.problemasDaCarta({ ...DRAGIAS, efeitos: [ef] }).some((p) => /esta carta/.test(p.texto)));
});

t('a Dragias completa: revele para buscar; descarte 3 de Tipos diferentes para Invocá-la e atacar 2 vezes', () => {
  const carta = {
    ...DRAGIAS,
    efeitos: [
      {
        quando: 'mao', custo: 'revelar-esta', limite: 'por-nome', acao: 'adicionar', alvo: 'outra', origem: 'deck',
        filtros: [{ categoria: 'monstro-normal', nivelMin: 5, atkMax: 1900 }],
      },
      {
        quando: 'mao', custo: 'descartar-filtro', custoQtd: 3, custoTiposDiferentes: true,
        custoFiltros: [{ categoria: 'monstro-normal', nivelMin: 5, atkMax: 1900 }],
        acao: 'reviver', alvo: 'esta',
        depois: [{ acao: 'ataques', alvo: 'esta', ataques: 2, duracao: 'permanente' }],
      },
    ],
  };
  assert.deepEqual(CB.problemasDaCarta(carta), []);
  const lua = CB.gerarLua(carta);
  assert.match(lua, /e1:SetCost\(Cost\.SelfReveal\)/);
  assert.match(lua, /e2:SetCost\(s\.custo2\)/);
  assert.match(lua, /g:GetClassCount\(Card\.GetRace\)>=3/);
  assert.match(lua, /e1:SetReset\(RESET_EVENT\|RESETS_STANDARD\)/);
  const texto = CB.textoDosEfeitos(carta);
  assert.match(texto, /revele esta carta; adicione 1 monstro Normal/);
  assert.match(texto, /Invoque esta carta por Invocação-Especial; se fizer isso, esta carta pode atacar 2 vezes em cada Battle Phase\./);
});

t('Invocação-Especial de outra carta: da mão, do Deck, do Cemitério e das banidas', () => {
  // O relato: *"não consigo definir uma especial summon sem ser do GY"*.
  const lugares = {
    mao: 'LOCATION_HAND,0', deck: 'LOCATION_DECK,0',
    'cemiterio-meu': 'LOCATION_GRAVE,0', 'cemiterio-ambos': 'LOCATION_GRAVE,LOCATION_GRAVE',
    'banidas-meu': 'LOCATION_REMOVED,0', 'banidas-ambos': 'LOCATION_REMOVED,LOCATION_REMOVED',
    'mao-deck-cemiterio': 'LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0',
  };
  assert.deepEqual(CB.ORIGENS.reviver.map((o) => o[0]).sort(), Object.keys(lugares).sort(), 'origem nova sem caso no teste');
  for (const [origem, locs] of Object.entries(lugares)) {
    const ef = { quando: 'campo', acao: 'reviver', alvo: 'outra', origem, filtros: [{ categoria: 'monstro', raca: 'Dragon' }] };
    const lua = CB.gerarLua({ ...DRAGIAS, efeitos: [ef] });
    assert.ok(lua.includes(`tp,${locs},1,`), `${origem} (ação): ${lua}`);
    const seq = CB.gerarLua({
      ...DRAGIAS,
      efeitos: [{ quando: 'campo', acao: 'comprar', quantidade: 1, depois: [{ acao: 'reviver', alvo: 'outra', origem, filtros: [] }] }],
    });
    assert.ok(seq.includes(`tp,${locs},1,1,e:GetHandler(),e,tp)`), `${origem} (passo): ${seq}`);
  }
  // Mão e Deck não se escolhem como ALVO; banida, só com a face para cima.
  const ef = (origem) => ({ ...DRAGIAS, efeitos: [{ quando: 'campo', acao: 'reviver', alvo: 'outra', origem, filtros: [] }] });
  assert.doesNotMatch(CB.gerarLua(ef('mao')), /EFFECT_FLAG_CARD_TARGET/);
  assert.doesNotMatch(CB.gerarLua(ef('deck')), /EFFECT_FLAG_CARD_TARGET/);
  assert.match(CB.gerarLua(ef('cemiterio-meu')), /EFFECT_FLAG_CARD_TARGET/, 'controle: do Cemitério continua sendo alvo');
  // As três zonas juntas seguem a mais restrita: com a mão e o Deck no meio, a
  // carta não está à vista, e escolher como ALVO o que ninguém vê é ilegal.
  assert.doesNotMatch(CB.gerarLua(ef('mao-deck-cemiterio')), /EFFECT_FLAG_CARD_TARGET/);
  assert.match(CB.textoDosEfeitos(ef('mao-deck-cemiterio')), /da sua mão, Deck ou Cemitério/);
  assert.match(CB.gerarLua(ef('banidas-meu')), /c:IsFaceup\(\)/);
  assert.match(CB.textoDosEfeitos(ef('deck')), /do seu Deck/);
  assert.match(CB.textoDosEfeitos(ef('banidas-ambos')), /entre as cartas banidas/);
  // carta salva antes das origens novas continua Invocando do Cemitério
  assert.equal(CB.ajustarEfeito(DRAGIAS, { quando: 'campo', acao: 'reviver', alvo: 'outra', origem: 'inventada' }).origem, 'cemiterio-meu');
});

t('adicionar monstros de Tipos e/ou Atributos diferentes', () => {
  // O pedido: *"monstros com tipos diferentes" e "monstros com atributos
  // diferentes", podendo mesclar os dois*.
  const base = {
    quando: 'mao', acao: 'adicionar', alvo: 'outra', origem: 'deck', quantidade: 3,
    filtros: [{ categoria: 'monstro-normal', nivelMin: 5 }],
  };
  const lua = (extra) => CB.gerarLua({ ...DRAGIAS, efeitos: [{ ...base, ...extra }] });

  const tipos = lua({ tiposDiferentes: true });
  assert.match(tipos, /g:Remove\(Card\.IsRace,nil,tc:GetRace\(\)\)/);
  assert.doesNotMatch(tipos, /Card\.IsAttribute,nil/);

  const atributos = lua({ atributosDiferentes: true });
  assert.match(atributos, /g:Remove\(Card\.IsAttribute,nil,tc:GetAttribute\(\)\)/);
  assert.doesNotMatch(atributos, /Card\.IsRace,nil/);

  const ambos = lua({ tiposDiferentes: true, atributosDiferentes: true });
  assert.match(ambos, /Card\.IsRace,nil/);
  assert.match(ambos, /Card\.IsAttribute,nil/);
  assert.match(ambos, /for i=1,3 do/);
  assert.doesNotMatch(lua({}), /for i=/, 'controle: sem "diferentes" a seleção continua a de sempre');

  const passo = CB.gerarLua({
    ...DRAGIAS,
    efeitos: [{ quando: 'mao', acao: 'comprar', quantidade: 1, depois: [{ ...base, tiposDiferentes: true }] }],
  });
  assert.match(passo, /g:Remove\(Card\.IsRace,nil,tc:GetRace\(\)\)/, 'no passo do "e depois" também');

  assert.match(CB.textoDosEfeitos({ ...DRAGIAS, efeitos: [{ ...base, tiposDiferentes: true, atributosDiferentes: true }] }),
    /de Tipos e Atributos diferentes/);
  assert.ok(CB.problemasDaCarta({ ...DRAGIAS, efeitos: [{ ...base, tiposDiferentes: true, filtros: [{ categoria: 'magia' }] }] })
    .some((p) => /diferentes/.test(p.texto)), 'magia não tem Tipo nem Atributo');
});

t('Monstro de Fusão: materiais, Extra Deck e o tipo que o motor lê', () => {
  const fusao = {
    ...CB.novaCarta(), nome: 'Dragão de Fusão', tipo: 'monstro-fusao', raca: 'Dragon', atributo: 'WIND',
    nivel: 7, atk: 2600, def: 2100, efeitos: [],
    fusao: { materiais: [
      { qtd: 1, filtros: [{ categoria: 'monstro', codigo: 6368038 }] },
      { qtd: 2, filtros: [{ categoria: 'monstro-normal', raca: 'Dragon' }] },
    ] },
  };
  assert.deepEqual(CB.problemasDaCarta(fusao), []);
  const lua = CB.gerarLua(fusao);
  assert.match(lua, /^\tc:EnableReviveLimit\(\)$/m);
  assert.match(lua, /Fusion\.AddProcMixN\(c,true,true,s\.material1,1,s\.material2,2\)/);
  assert.match(lua, /function s\.material1\(c,fc,sumtype,tp\)\n\treturn c:IsType\(TYPE_MONSTER\) and c:IsCode\(6368038\)/);
  assert.match(ler(new URL('proc_fusion.lua', SCRIPTS)), /function Fusion\.AddProcMixN\(/);

  assert.equal(CB.dadosDoMotor(fusao).type, 0x41, 'Fusão sem efeito = MONSTER|FUSION');
  const comEfeito = { ...fusao, efeitos: [{ quando: 'invocado', acao: 'comprar', quantidade: 1 }] };
  assert.equal(CB.dadosDoMotor(comEfeito).type, 0x61, 'com efeito entra o TYPE_EFFECT');
  assert.ok(!CB.quandoPermitidos(fusao).includes('mao'), 'Fusão mora no Extra Deck: não tem efeito da mão');
  assert.ok(isExtraDeck(CB.entradaDoIndice(fusao)), 'o índice precisa mandar a Fusão para o Extra Deck');
  assert.match(CB.textoDosEfeitos(fusao), /\+ 2 monstro Normal Dragão/);

  const umMaterial = { ...fusao, fusao: { materiais: [{ qtd: 1, filtros: [] }] } };
  assert.ok(CB.problemasDaCarta(umMaterial).some((p) => /pelo menos 2 materiais/.test(p.texto)));
});

t('Monstro de Ritual: só sai por Ritual, e a Magia de Ritual do builder o aponta', () => {
  const ritual = {
    ...CB.novaCarta(), nome: 'Guerreiro do Ritual', tipo: 'monstro-ritual', raca: 'Warrior', atributo: 'LIGHT',
    nivel: 4, atk: 1800, def: 1000, efeitos: [],
  };
  assert.deepEqual(CB.problemasDaCarta(ritual), []);
  assert.match(CB.gerarLua(ritual), /^\tc:EnableReviveLimit\(\)$/m);
  assert.equal(CB.dadosDoMotor(ritual).type, 0x81);
  assert.equal(CB.dadosDoMotor({ ...ritual, efeitos: [{ quando: 'mao', acao: 'comprar', quantidade: 1 }] }).type, 0xA1);
  assert.ok(CB.quandoPermitidos(ritual).includes('mao'), 'controle: o Ritual fica na mão e pode ter efeito de lá');
  assert.deepEqual(CB.limiteDeEfeitos(ritual), { min: 0, max: 4 });
  const magia = { ...CB.novaCarta(), nome: 'Ritual de Teste', tipo: 'magia', subtipo: 'ritual', efeitos: [], ritual: { codigo: 950000020 } };
  assert.match(CB.gerarLua(magia), /Ritual\.AddProcGreater\(\{handler=c,filter=aux\.FilterBoolFunction\(Card\.IsCode,950000020\)\}\)/);
});

t('o Lua de Fusão e de Ritual que o --test-card-builder joga é o que o gerador escreve', () => {
  // As mesmas três cartas do C#: a Fusão de Gaia The Fierce Knight + Curse of
  // Dragon, o Monstro de Ritual Nv4 e a Magia de Ritual que o aponta.
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  const constante = (nome) => {
    const m = cs.match(new RegExp(`const string ${nome} =\\s*@"([\\s\\S]*?)";`));
    assert.ok(m, `não achei ${nome} em TestCardBuilder.cs`);
    return codigo(m[1]);
  };
  const fusao = {
    ...CB.novaCarta(), tipo: 'monstro-fusao', raca: 'Dragon', atributo: 'WIND', nivel: 7, atk: 2600, def: 2100, efeitos: [],
    fusao: { materiais: [
      { qtd: 1, filtros: [{ categoria: 'monstro', codigo: 6368038 }] },
      { qtd: 1, filtros: [{ categoria: 'monstro', codigo: 28279543 }] },
    ] },
  };
  const ritual = { ...CB.novaCarta(), tipo: 'monstro-ritual', raca: 'Warrior', atributo: 'LIGHT', nivel: 4, atk: 1800, def: 1000, efeitos: [] };
  const magia = { ...CB.novaCarta(), tipo: 'magia', subtipo: 'ritual', efeitos: [], ritual: { codigo: 950000040 } };
  const aviso = (nome) => `o gerador mudou: atualize ${nome} em TestCardBuilder.cs e rode --test-card-builder de novo`;
  assert.deepEqual(constante('LUA_FUSAO'), codigo(CB.gerarLua(fusao)), aviso('LUA_FUSAO'));
  assert.deepEqual(constante('LUA_RITUAL'), codigo(CB.gerarLua(ritual)), aviso('LUA_RITUAL'));
  assert.deepEqual(constante('LUA_MAGIA_RITUAL'), codigo(CB.gerarLua(magia)), aviso('LUA_MAGIA_RITUAL'));
});

t('o custo com filtro recusa "Tipos diferentes" entre magias', () => {
  const carta = {
    ...DRAGIAS,
    efeitos: [{ ...DRAGIAS.efeitos[0], custoFiltros: [{ categoria: 'magia' }] }],
  };
  assert.ok(CB.problemasDaCarta(carta).some((p) => /Tipos diferentes/.test(p.texto)));
});

t('passo que o momento não aceita some no ajuste (contínuo não tem "e depois")', () => {
  const ef = CB.ajustarEfeito({ ...CB.novaCarta(), tipo: 'monstro-efeito' },
    { quando: 'continuo', acao: 'bonus', alvo: 'esta', atk: 100, depois: [{ acao: 'comprar' }] });
  assert.deepEqual(ef.depois, []);
});

t('o VISUAL não muda o Lua, e visual torto cai no layout do builder', () => {
  const base = { ...CB.novaCarta(), nome: 'x' };
  assert.equal(CB.normalizarCarta(base).visual, 'desenhada');
  assert.equal(CB.normalizarCarta({ ...base, visual: 'qualquer-coisa' }).visual, 'desenhada');
  assert.equal(CB.normalizarCarta({ ...base, visual: 'completa' }).visual, 'completa');
  const luas = CB.VISUAIS.map(([v]) => CB.gerarLua({ ...base, visual: v }));
  assert.ok(luas.every((l) => l === luas[0]), 'o Lua mudou com o visual');
});

t('a tela é de admin e está na Área de Teste', () => {
  const pagina = ler(new URL('web/cardbuilder.html', RAIZ));
  assert.match(pagina, /await requireAdmin\(\)/);
  assert.match(ler(new URL('web/teste.html', RAIZ)), /\/web\/cardbuilder\.html/);
});

/**
 * A Dragon's Inferno, como o usuário a descreveu (Armadilha Contínua): *Monstros
 * Dragão Nv5/6 podem ser Invocados por Invocação-Normal sem tributo. ● Se você
 * controlar um Normal Dragão Nv5/6 com a face para cima, destrua 1 card que o
 * oponente controla. ● Descarte 1 card; adicione 1 Dragão Nv5/6 do Deck ou do
 * Cemitério. ● Baixe até 2 dentre seis cartas nomeadas, do Deck e/ou do
 * Cemitério, só 1 de cada. Cada efeito, uma vez por turno.* É a MESMA carta que
 * o `--test-card-builder` joga no motor.
 */
const NOMEADAS = [81385346, 92408984, 20140382, 55991637, 28596933, 52112003];
const INFERNO = {
  ...CB.novaCarta(), nome: "Dragon's Inferno", tipo: 'armadilha', subtipo: 'continua',
  efeitos: [
    { quando: 'continuo', acao: 'sem-tributo', filtros: [{ categoria: 'monstro', raca: 'Dragon', nivelMin: 5, nivelMax: 6 }] },
    {
      quando: 'campo', limite: 'por-efeito',
      condicao: 'controla', condicaoFiltros: [{ categoria: 'monstro-normal', raca: 'Dragon', nivelMin: 5, nivelMax: 6 }],
      acao: 'destruir', alvo: 'outra', lado: 'oponente', zona: 'qualquer', quantidade: 1, filtros: [],
    },
    {
      quando: 'campo', limite: 'por-efeito', custo: 'descartar-1',
      acao: 'adicionar', alvo: 'outra', origem: 'deck-cemiterio', quantidade: 1,
      filtros: [{ categoria: 'monstro', raca: 'Dragon', nivelMin: 5, nivelMax: 6 }],
    },
    {
      quando: 'campo', limite: 'por-efeito',
      acao: 'baixar', alvo: 'outra', origem: 'deck-cemiterio', quantidade: 2, nomesDiferentes: true,
      filtros: NOMEADAS.map((codigo) => ({ categoria: 'qualquer', codigo })),
    },
  ],
};

t("a Dragon's Inferno: sem tributo, destruir com condição, buscar no Deck/Cemitério, baixar 2 de nomes diferentes", () => {
  assert.deepEqual(CB.problemasDaCarta(INFERNO), []);
  const lua = CB.gerarLua(INFERNO);
  assert.match(lua, /e0:SetType\(EFFECT_TYPE_ACTIVATE\)/, 'a Contínua precisa da ativação que a põe na zona');
  // 1: Invocação-Normal sem tributo para a SUA mão, enquanto ela estiver na zona
  assert.match(lua, /e1:SetCode\(EFFECT_SUMMON_PROC\)/);
  assert.match(lua, /e1:SetRange\(LOCATION_SZONE\)/);
  assert.match(lua, /e1:SetTargetRange\(LOCATION_HAND,0\)/);
  assert.match(lua, /e1:SetTarget\(aux\.FieldSummonProcTg\(s\.filtro1\)\)/);
  assert.ok(lua.includes('return minc==0 and Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0'), lua);
  assert.ok(lua.includes('(c:IsType(TYPE_MONSTER) and c:IsRace(RACE_DRAGON) and c:IsLevelAbove(5) and c:IsLevelBelow(6)) and c:IsLevelAbove(5)'), lua);
  assert.match(UTILITY, /function Auxiliary\.FieldSummonProcTg\(/);
  // 2: só com o Normal Dragão Nv5/6 com a face para cima
  assert.match(lua, /e2:SetCondition\(s\.condicao2\)/);
  assert.ok(lua.includes('return c:IsFaceup() and (c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsRace(RACE_DRAGON) and c:IsLevelAbove(5) and c:IsLevelBelow(6))'), lua);
  assert.ok(lua.includes('return Duel.IsExistingMatchingCard(s.condfiltro2,tp,LOCATION_MZONE,0,1,nil)'), lua);
  // 3: descarte 1; do Deck OU do Cemitério
  assert.match(lua, /e3:SetCost\(Cost\.Discard\(nil,true,1\)\)/);
  assert.match(lua, /e3:SetCategory\(CATEGORY_TOHAND\+CATEGORY_SEARCH\)/);
  assert.match(lua, /Duel\.SelectMatchingCard\(tp,s\.filtro3,tp,LOCATION_DECK\|LOCATION_GRAVE,0,1,1,e:GetHandler\(\)\)/);
  // 4: até 2, um de cada nome, sem Group.Iter
  assert.match(lua, /c:IsSSetable\(\)/);
  // Os parênteses cortam o 2º valor que o GetLocationCount devolve nesta dll —
  // sem eles o `ft` sai 0 com a zona vazia e o baixar não acontece, calado.
  assert.match(lua, /local ft=math\.min\(2,\(Duel\.GetLocationCount\(tp,LOCATION_SZONE\)\)\)/);
  assert.match(lua, /livres:SelectUnselect\(sg,tp,#sg>0,false,1,ft\)/);
  assert.match(lua, /return not sg:IsExists\(Card\.IsCode,1,nil,c:GetCode\(\)\)/);
  assert.match(lua, /Duel\.SSet\(tp,sg\)/);
  for (const id of NOMEADAS) assert.ok(lua.includes(`c:IsCode(${id})`), `falta ${id}`);
  assert.doesNotMatch(lua, /dncheck|SelectUnselectGroup|:Iter\(/);
  // cada efeito com a SUA conta
  for (const n of [2, 3, 4]) assert.ok(lua.includes(`e${n}:SetCountLimit(1,{id,${n}})`), `e${n}`);
  assert.doesNotMatch(lua, /SetCountLimit\(1,id\)/, 'nenhuma conta dividida');
});

t("o texto da Dragon's Inferno sai dos mesmos dados", () => {
  const texto = CB.textoDosEfeitos(INFERNO);
  assert.match(texto, /na sua mão pode ser Invocado por Invocação-Normal sem oferecer tributos/);
  assert.match(texto, /se você controlar um monstro Normal Dragão de Nível 5 a 6 com a face para cima, escolha 1 carta que o oponente controla/);
  assert.match(texto, /descarte 1 carta; adicione 1 monstro Dragão de Nível 5 a 6 do seu Deck ou Cemitério à sua mão/);
  assert.match(texto, /baixe até 2 .* com nomes diferentes do seu Deck e\/ou Cemitério/);
  assert.equal((texto.match(/Você só pode usar este efeito de "Dragon's Inferno" uma vez por turno/g) ?? []).length, 3);
});

t("o Lua que o --test-card-builder joga no motor é o que o gerador escreve (Dragon's Inferno)", () => {
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const m = cs.match(/const string LUA_INFERNO =\s*@"([\s\S]*?)";/);
  assert.ok(m, 'não achei o LUA_INFERNO em duel-server/src/TestCardBuilder.cs');
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(codigo(m[1]), codigo(CB.gerarLua(INFERNO)),
    'o gerador mudou: atualize LUA_INFERNO em TestCardBuilder.cs e rode --test-card-builder de novo');
});

t('"se você controlar" SOMA-SE à condição do momento, nunca a troca', () => {
  const carta = {
    ...CB.novaCarta(), nome: 'x', tipo: 'armadilha', subtipo: 'normal',
    efeitos: [{
      quando: 'ataque-oponente', condicao: 'controla', condicaoFiltros: [{ categoria: 'monstro', raca: 'Dragon' }],
      acao: 'destruir', alvo: 'gatilho', filtros: [],
    }],
  };
  const lua = CB.gerarLua(carta);
  assert.match(lua, /function s\.condicaobase1\(e,tp,eg,ep,ev,re,r,rp\)\n\treturn Duel\.GetTurnPlayer\(\)~=tp\nend/);
  assert.match(lua, /return s\.condicaobase1\(e,tp,eg,ep,ev,re,r,rp\) and Duel\.IsExistingMatchingCard\(s\.condfiltro1,tp,LOCATION_MZONE,0,1,nil\)/);
  assert.equal((lua.match(/^function s\.condicao1\(/gm) ?? []).length, 1, 'duas funções com o mesmo nome: a segunda apagaria a primeira');
  assert.doesNotMatch(CB.gerarLua({ ...carta, efeitos: [{ ...carta.efeitos[0], condicao: 'nenhuma' }] }), /condfiltro/, 'controle');
  // o contínuo VALE, não se ativa: a condição de ativação some no ajuste
  const continua = { ...CB.novaCarta(), tipo: 'armadilha', subtipo: 'continua' };
  assert.equal(CB.ajustarEfeito(continua, { quando: 'continuo', condicao: 'controla', acao: 'bonus', atk: 100 }).condicao, 'nenhuma');
  // "controlar um monstro" com filtro de magia nunca seria verdade
  const torta = { ...carta, efeitos: [{ ...carta.efeitos[0], condicaoFiltros: [{ categoria: 'magia' }] }] };
  assert.ok(CB.problemasDaCarta(torta).some((p) => /condição/.test(p.texto)));
});

t('Invocação sem tributo e baixar recusam o que não fecha (e os controles passam)', () => {
  const continua = { ...CB.novaCarta(), nome: 'x', tipo: 'armadilha', subtipo: 'continua' };
  const com = (ef) => ({ ...continua, efeitos: [ef] });
  assert.ok(CB.problemasDaCarta(com({ quando: 'continuo', acao: 'sem-tributo', filtros: [{ categoria: 'monstro', nivelMax: 4 }] }))
    .some((p) => /Nível 4 ou menos/.test(p.texto)));
  assert.ok(CB.problemasDaCarta(com({ quando: 'continuo', acao: 'sem-tributo', filtros: [{ categoria: 'magia' }] })).length > 0);
  assert.deepEqual(CB.problemasDaCarta(com({ quando: 'continuo', acao: 'sem-tributo', filtros: [] })), [], 'controle');
  assert.ok(CB.problemasDaCarta(com({ quando: 'campo', acao: 'baixar', alvo: 'outra', filtros: [{ categoria: 'monstro' }] }))
    .some((p) => /baixadas/.test(p.texto)));
  assert.deepEqual(CB.problemasDaCarta(com({ quando: 'campo', acao: 'baixar', alvo: 'outra', filtros: [{ categoria: 'armadilha' }] })), [], 'controle');
  assert.ok(!CB.acoesPermitidas(continua, 'campo').includes('sem-tributo'), 'sem tributo só no contínuo');
});

t('"pelo nome, só este efeito" é {id,n}; "pelo nome" continua sendo a conta dividida', () => {
  const monstro = {
    ...CB.novaCarta(), nome: 'x',
    efeitos: [
      { quando: 'mao', limite: 'por-nome', acao: 'comprar', quantidade: 1 },
      { quando: 'campo', limite: 'por-efeito', acao: 'comprar', quantidade: 1 },
    ],
  };
  const lua = CB.gerarLua(monstro);
  assert.match(lua, /e1:SetCountLimit\(1,id\)/);
  assert.match(lua, /e2:SetCountLimit\(1,\{id,2\}\)/);
  const magia = { ...CB.novaCarta(), nome: 'x', tipo: 'magia', subtipo: 'normal', efeitos: [{ quando: 'ativacao', limite: 'por-efeito', acao: 'comprar', quantidade: 1 }] };
  assert.match(CB.gerarLua(magia), /e1:SetCountLimit\(1,\{id,1\},EFFECT_COUNT_CODE_OATH\)/);
});

t('baixar sem "nomes diferentes" escolhe de uma vez; num passo do "e depois" também baixa', () => {
  const continua = { ...CB.novaCarta(), nome: 'x', tipo: 'armadilha', subtipo: 'continua' };
  const simples = CB.gerarLua({ ...continua, efeitos: [{ quando: 'campo', acao: 'baixar', alvo: 'outra', origem: 'cemiterio', quantidade: 3, filtros: [{ categoria: 'armadilha' }] }] });
  assert.match(simples, /local sg=Duel\.SelectMatchingCard\(tp,s\.filtro1,tp,LOCATION_GRAVE,0,1,ft,e:GetHandler\(\)\)/);
  assert.doesNotMatch(simples, /SelectUnselect/, 'controle: sem a caixa a seleção é a de sempre');
  const passo = CB.gerarLua({
    ...continua,
    efeitos: [{
      quando: 'campo', acao: 'comprar', quantidade: 1,
      depois: [{ acao: 'baixar', alvo: 'outra', origem: 'deck', quantidade: 2, nomesDiferentes: true, filtros: [{ categoria: 'magia' }] }],
    }],
  });
  assert.match(passo, /function s\.nomelivre1_2\(c,sg\)/);
  assert.match(passo, /return #sg>0 and Duel\.SSet\(tp,sg\)>0/);
  assert.match(passo, /if ft<=0 then return false end/);
});

t('o JSON do card maker vira carta NOVA do builder: tipo, subtipo e o texto com as quebras', () => {
  const json = {
    na: "Dragon's Inferno", fr: 'trap', sf: 'CONTINUOUS', ad: 'data:image/jpeg;base64,AAAA',
    ef: 'Primeira linha.\n● Segundo  efeito.\r\n● Terceiro.',
  };
  const c = CB.cartaDoCardmaker(json);
  assert.equal(c.id, null, 'importar nunca aponta para uma carta que já existe');
  assert.deepEqual([c.nome, c.tipo, c.subtipo], ["Dragon's Inferno", 'armadilha', 'continua']);
  assert.equal(c.texto, 'Primeira linha.\n● Segundo efeito.\n● Terceiro.');
  assert.equal(c.efeitos.length, 1, 'a Contínua precisa de um efeito para salvar');
  const monstro = CB.cartaDoCardmaker({ na: 'M', fr: 'normal', at: 'LIGHT', ta: ['Dragão'], atk: '2400', def: '?' });
  assert.deepEqual([monstro.tipo, monstro.raca, monstro.atributo, monstro.atk, monstro.def], ['monstro-normal', 'Dragon', 'LIGHT', 2400, 0]);
  assert.equal(CB.cartaDoCardmaker({ fr: 'spell', sf: 'QUICK-PLAY' }).subtipo, 'rapida');
  assert.equal(CB.cartaDoCardmaker(null).tipo, 'monstro-efeito', 'JSON torto não quebra');
});

t('o NÍVEL do card maker vem em `st` — sem isso todo monstro importado nascia Nível 4', () => {
  // O ygocarder guarda o Nível em `st` ("star", como o `codec.ts` dele abrevia)
  // — e é o MESMO campo do Rank num Xyz. Lendo só `level`/`lv`, que não existem
  // no arquivo dele, o campo chegava `null` e `normalizarCarta` caía no padrão:
  // a carta entrava com Nível 4 sem erro nenhum, e o único jeito de perceber
  // era conferir a carta no duelo.
  assert.equal(CB.cartaDoCardmaker({ na: 'M', fr: 'normal', at: 'LIGHT', ta: ['Dragon'], st: 8 }).nivel, 8);
  assert.equal(CB.cartaDoCardmaker({ na: 'X', fr: 'xyz', at: 'DARK', ta: ['Dragon'], st: '4' }).nivel, 4, 'no Xyz o mesmo campo é o Rank');
  assert.equal(CB.cartaDoCardmaker({ na: 'M', fr: 'normal', st: 12 }).nivel, 12);
  assert.equal(CB.cartaDoCardmaker({ na: 'M', fr: 'normal' }).nivel, 4, 'sem nível nenhum, o padrão do builder');
});

// ---------------------------------------------------------------------------
// A carta do usuário (19/09/2026): um monstro que é tratado como Normal, dá
// desconto de tributo por efeito rápido da mão, e volta do Cemitério quando um
// monstro Normal seu é tirado do campo pelo oponente.
// ---------------------------------------------------------------------------

t('"sempre tratado como um monstro Normal" é o BIT TYPE_NORMAL, e não um efeito', () => {
  const base = {
    ...CB.novaCarta(), tipo: 'monstro-efeito', nome: 'Guardiao',
    raca: 'Warrior', atributo: 'EARTH', nivel: 4, atk: 1500, def: 1200,
  };
  const TYPE_NORMAL = 0x10; const TYPE_EFFECT = 0x20;
  assert.equal(CB.dadosDoMotor(base).type & TYPE_NORMAL, 0, 'desligado, nada muda');
  const com = CB.dadosDoMotor({ ...base, tratadoComoNormal: true });
  assert.equal(com.type & TYPE_NORMAL, TYPE_NORMAL);
  // Sem TYPE_EFFECT o motor não roda o script: a carta perderia os efeitos dela
  // inteiros, e o único sintoma seria "ela nunca faz nada".
  assert.equal(com.type & TYPE_EFFECT, TYPE_EFFECT, 'continua sendo carta de efeito');
  // É um bit do BANCO, não uma linha de Lua.
  assert.equal(CB.gerarLua({ ...base, tratadoComoNormal: true }), CB.gerarLua(base));
  assert.match(CB.textoDosEfeitos({ ...base, tratadoComoNormal: true, efeitos: [] }),
    /sempre tratada como um monstro Normal/);
  // Magia não tem tipo de monstro para ganhar: a marca não pode vazar para ela.
  const magia = CB.dadosDoMotor({ ...CB.novaCarta(), tipo: 'magia', subtipo: 'normal', tratadoComoNormal: true });
  assert.equal(magia.type & TYPE_NORMAL, 0, 'TYPE_NORMAL numa Magia faria o motor lê-la como monstro');
});

t('efeito rápido da mão é QUICK_O — o IGNITION do `mao` só roda na SUA Main Phase', () => {
  const lua = CB.gerarLua({
    ...CB.novaCarta(), efeitos: [{ quando: 'mao-rapido', acao: 'comprar', quantidade: 1 }],
  });
  assert.match(lua, /e1:SetType\(EFFECT_TYPE_QUICK_O\)/);
  assert.match(lua, /e1:SetCode\(EVENT_FREE_CHAIN\)/);
  assert.match(lua, /e1:SetRange\(LOCATION_HAND\)/);
  const devagar = CB.gerarLua({ ...CB.novaCarta(), efeitos: [{ quando: 'mao', acao: 'comprar', quantidade: 1 }] });
  assert.match(devagar, /e1:SetType\(EFFECT_TYPE_IGNITION\)/, 'controle: o `mao` continua IGNITION');
});

t('"com 1 tributo a menos" é BITMASK, registrado no jogador, e morre no fim do turno', () => {
  const ef = {
    quando: 'mao-rapido', custo: 'descartar-esta', limite: 'por-efeito',
    acao: 'menos-tributo', quantidade: 1,
    filtros: [{ categoria: 'monstro-normal', nivelMin: 5, nivelMax: 6, atkMax: 1900 }],
  };
  const lua = CB.gerarLua({ ...CB.novaCarta(), efeitos: [ef] });
  assert.match(lua, /e1:SetCode\(EFFECT_DECREASE_TRIBUTE\)/);
  assert.match(lua, /e1:SetTargetRange\(LOCATION_HAND,0\)/);
  assert.match(lua, /e1:SetTarget\(s\.filtro1\)/);
  assert.match(lua, /function s\.filtro1\(e,c\)/, 'alvo de efeito de campo recebe (e,c)');
  assert.match(lua, /c:IsType\(TYPE_NORMAL\).*IsLevelAbove\(5\).*IsLevelBelow\(6\).*IsAttackBelow\(1900\)/);
  // Registrado no JOGADOR: a carta foi descartada como custo e não existe mais
  // para segurar o efeito.
  assert.match(lua, /Duel\.RegisterEffect\(e1,tp\)/);
  assert.match(lua, /e1:SetReset\(RESET_PHASE\|PHASE_END\)/);
  assert.match(lua, /e1:SetValue\(0x1\)/);
  // O bit, nunca o número: 0x3 o motor leria como "1 OU 2 a menos".
  assert.match(CB.gerarLua({ ...CB.novaCarta(), efeitos: [{ ...ef, quantidade: 2 }] }), /SetValue\(0x2\)/);
  assert.match(CB.gerarLua({ ...CB.novaCarta(), efeitos: [{ ...ef, quantidade: 3 }] }), /SetValue\(0x4\)/);
});

t('o gatilho "deixou o campo por carta do oponente" faz as TRÊS perguntas', () => {
  const lua = CB.gerarLua({
    ...CB.novaCarta(),
    efeitos: [{
      quando: 'saiu-do-campo', acao: 'reviver', alvo: 'esta', origem: 'cemiterio-meu',
      gatilhoFiltros: [{ categoria: 'monstro-normal', nivelMin: 5, nivelMax: 6, atkMax: 1900 }],
    }],
  });
  assert.match(lua, /e1:SetType\(EFFECT_TYPE_FIELD\+EFFECT_TYPE_TRIGGER_O\)/);
  assert.match(lua, /e1:SetCode\(EVENT_LEAVE_FIELD\)/);
  // A carta está no CEMITÉRIO quando isso acontece: com o range errado o efeito
  // nunca é oferecido, e nada acusa.
  assert.match(lua, /e1:SetRange\(LOCATION_GRAVE\)/);
  assert.match(lua, /c:IsPreviousLocation\(LOCATION_MZONE\)/, 'saiu do CAMPO, não do Deck');
  assert.match(lua, /c:IsPreviousControler\(tp\)/, 'era SEU monstro');
  assert.match(lua, /c:GetReasonPlayer\(\)~=tp/, 'foi o OPONENTE que o tirou de lá');
  assert.match(lua, /IsLevelAbove\(5\)/);
});

t('o filtro do GATILHO não é o filtro da AÇÃO — são cartas diferentes', () => {
  const lua = CB.gerarLua({
    ...CB.novaCarta(),
    efeitos: [{
      quando: 'saiu-do-campo', acao: 'adicionar', alvo: 'outra', origem: 'deck', quantidade: 1,
      gatilhoFiltros: [{ categoria: 'monstro-normal', nivelMin: 5 }],
      filtros: [{ categoria: 'magia' }],
    }],
  });
  assert.match(lua, /function s\.saiu1\(c,tp\)[\s\S]*?IsLevelAbove\(5\)/, 'o gatilho olha o monstro que saiu');
  assert.match(lua, /function s\.filtro1\(c\)[\s\S]*?TYPE_SPELL/, 'a busca olha a Magia');
  assert.doesNotMatch(lua, /function s\.filtro1\(c\)[\s\S]*?IsLevelAbove\(5\)/,
    'a busca herdando o filtro do gatilho seria uma carta buscando a coisa errada, calada');
});

t('baixar com "(pode ser ativada neste turno)" registra a trava das DUAS famílias', () => {
  const ef = {
    quando: 'ativacao', acao: 'baixar', alvo: 'outra', origem: 'deck-mao-cemiterio',
    quantidade: 1, ativaNoTurno: true,
    filtros: [{ categoria: 'qualquer', codigo: 950000003, codigoNome: 'Legado dos Guerreiros' }],
  };
  const carta = { ...CB.novaCarta(), tipo: 'magia', subtipo: 'normal', nome: 'Chamado', efeitos: [ef] };
  const lua = CB.gerarLua(carta);
  assert.match(lua, /LOCATION_DECK\|LOCATION_HAND\|LOCATION_GRAVE/, 'Deck, mão e Cemitério');
  assert.match(lua, /ea:SetCode\(EFFECT_TRAP_ACT_IN_SET_TURN\)/);
  // A trava tem uma constante por família, e o builder não sabe qual das duas a
  // carta baixada é — ela sai de um filtro. Registrar só uma deixaria metade dos
  // casos sem o "pode ser ativada", sem erro nenhum.
  assert.match(lua, /eb:SetCode\(EFFECT_QP_ACT_IN_SET_TURN\)/);
  // Sem ele o efeito não vale para carta virada para BAIXO — que é onde ele
  // precisa valer.
  assert.match(lua, /ea:SetProperty\(EFFECT_FLAG_SET_AVAILABLE\)/);
  const sem = CB.gerarLua({ ...carta, efeitos: [{ ...ef, ativaNoTurno: false }] });
  assert.doesNotMatch(sem, /ACT_IN_SET_TURN/, 'controle: desligado, o rider não sai');
  assert.match(sem, /if #sg>0 then Duel\.SSet\(tp,sg\) end/);
});

t('a referência a outra carta é o ID; o nome é só do texto e nunca entra no Lua', () => {
  const carta = {
    ...CB.novaCarta(), tipo: 'magia', subtipo: 'normal', nome: 'Chamado',
    efeitos: [{
      quando: 'ativacao', acao: 'baixar', alvo: 'outra', origem: 'deck-mao-cemiterio',
      quantidade: 1, ativaNoTurno: true,
      filtros: [{ categoria: 'qualquer', codigo: 950000003, codigoNome: 'Legado dos Guerreiros' }],
    }],
  };
  const lua = CB.gerarLua(carta);
  assert.match(lua, /c:IsCode\(950000003\)/, 'quem manda no motor é o id');
  assert.doesNotMatch(lua, /Legado/, 'nenhum texto do admin entra no código');
  // O texto escreve como uma carta oficial escreve.
  assert.match(CB.textoDosEfeitos(carta), /[Bb]aixe 1 "Legado dos Guerreiros"/);
  // Sem nome, sobra o id cru — e continua gerando.
  const semNome = { ...carta.efeitos[0], filtros: [{ categoria: 'qualquer', codigo: 950000003 }] };
  assert.match(CB.textoDosEfeitos({ ...carta, efeitos: [semNome] }), /com o código 950000003/);
});

t('toda ação que o gerador FILTRA é uma ação que a tela deixa filtrar', () => {
  // O relato: "não consigo selecionar o que vai reduzir — tá genérico". A tela
  // mostrava a caixa de OPÇÕES só quando a ação tinha ALVO (`outra`/`gatilho`),
  // e as Invocações com desconto não têm alvo nenhum: o filtro É a escolha
  // delas. A carta foi salva com a lista vazia e o Lua saiu valendo para
  // QUALQUER monstro — sem erro, sem aviso, e só um duelo mostraria.
  //
  // A varredura é pelo EFEITO no Lua, e não por uma lista escrita à mão: se
  // trocar o filtro muda o script, então aquele filtro conta, e a tela precisa
  // oferecê-lo. Uma ação nova nasce dentro desta conta.
  const carta0 = { ...CB.novaCarta(), tipo: 'monstro-efeito', nome: 'T', efeitos: [] };
  const COM = [{ categoria: 'monstro-normal', nivelMin: 5, nivelMax: 6, atkMax: 1900 }];
  const culpados = [];
  for (const quando of CB.quandoPermitidos(carta0)) {
    for (const acao of CB.acoesPermitidas(carta0, quando)) {
      const alvos = CB.alvosPermitidos(carta0, quando, acao);
      for (const alvo of (alvos.length ? alvos : [null])) {
        const faz = (filtros) => {
          const ef = CB.ajustarEfeito(carta0, { ...CB.novoEfeito(), quando, acao, alvo, filtros });
          return { ef, lua: CB.gerarLua({ ...carta0, efeitos: [ef] }) };
        };
        const cheio = faz(COM);
        if (faz([]).lua !== cheio.lua && !CB.usaFiltros(cheio.ef)) {
          culpados.push(`${quando} + ${acao} + ${alvo ?? 'sem alvo'}`);
        }
      }
    }
  }
  assert.deepEqual(culpados, [], `o gerador filtra e a tela não deixa escolher:\n        ${culpados.join('\n        ')}`);
});

t('a regra do filtro reconhece o caso ruim, e não acusa o inocente', () => {
  // A REGRA ANTIGA, que é o bug: só quem tinha alvo mostrava a caixa.
  const regraAntiga = (ef) => ef.alvo === 'outra' || ef.alvo === 'gatilho';
  assert.equal(regraAntiga({ acao: 'menos-tributo', alvo: null }), false,
    'era exatamente assim que a caixa de opções sumia');
  assert.equal(CB.usaFiltros({ acao: 'menos-tributo', alvo: null }), true);
  assert.equal(CB.usaFiltros({ acao: 'sem-tributo', alvo: null }), true);
  // E os inocentes: comprar não escolhe carta, e o bônus em "esta carta" já sabe
  // de quem fala.
  assert.equal(CB.usaFiltros({ acao: 'comprar', alvo: 'outra' }), false);
  assert.equal(CB.usaFiltros({ acao: 'bonus', alvo: 'esta' }), false);
  assert.equal(CB.usaFiltros(null), false);
});

/** A Max Rider como ela está no banco — a carta que o `--test-card-builder` joga. */
const ALVO_5_6 = [{ categoria: 'monstro-normal', nivelMin: 5, nivelMax: 6, atkMax: 1900 }];
const MAX_RIDER = {
  id: 950000003, nome: 'Max Rider',
  tipo: 'monstro-efeito', subtipo: 'normal', visual: 'completa',
  atributo: 'EARTH', raca: 'Warrior', nivel: 7, atk: 2400, def: 1400,
  tratadoComoNormal: true,
  efeitos: [
    {
      quando: 'mao-rapido', custo: 'descartar-esta', limite: 'por-efeito',
      acao: 'menos-tributo', quantidade: 1, filtros: ALVO_5_6,
    },
    {
      quando: 'saiu-do-campo', limite: 'por-efeito', gatilhoFiltros: ALVO_5_6,
      acao: 'reviver', alvo: 'esta', origem: 'cemiterio-meu',
      depois: [{
        acao: 'baixar', alvo: 'outra', origem: 'deck-mao-cemiterio',
        quantidade: 1, ativaNoTurno: true,
        filtros: [{ categoria: 'qualquer', codigo: 950000004, codigoNome: 'Revenge MAX' }],
      }],
    },
  ],
};

t('o gatilho "saiu do campo" conta a BATALHA e vale na Etapa de Dano', () => {
  // Os DOIS achados do `--test-card-builder`, e os dois erravam calados — a
  // carta parecia certa em toda leitura e simplesmente não era oferecida:
  //
  //   • `EFFECT_FLAG_DAMAGE_STEP`: sem ela um gatilho não pode ser ativado
  //     durante a Etapa de Dano, que é onde um monstro destruído em BATALHA
  //     deixa o campo. O efeito nunca acordava;
  //   • `REASON_BATTLE`: o motor não marca o oponente como "razão" de uma
  //     destruição em batalha, então `GetReasonPlayer()~=tp` sozinho dava falso.
  //     O idioma oficial pergunta as duas coisas.
  const lua = CB.gerarLua(MAX_RIDER);
  assert.match(lua, /SetProperty\(EFFECT_FLAG_DAMAGE_STEP\+EFFECT_FLAG_DELAY\)/);
  assert.match(lua, /c:IsReason\(REASON_BATTLE\) or \(c:IsReason\(REASON_EFFECT\) and c:GetReasonPlayer\(\)~=tp\)/);
  assert.match(lua, /c:IsPreviousLocation\(LOCATION_MZONE\) and c:IsPreviousControler\(tp\)/);
});

t('o Lua que o --test-card-builder joga no motor é o que o gerador escreve (Max Rider)', () => {
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const m = cs.match(/const string LUA_MAX_RIDER =\s*@"([\s\S]*?)";/);
  assert.ok(m, 'não achei o LUA_MAX_RIDER em duel-server/src/TestCardBuilder.cs');
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(codigo(m[1]), codigo(CB.gerarLua(MAX_RIDER)),
    'o gerador mudou: atualize LUA_MAX_RIDER em TestCardBuilder.cs e rode --test-card-builder de novo');
});

t('"sempre tratada como <outra carta>" é o EFFECT_ADD_CODE, e o nome só vai no comentário', () => {
  const DM = 46986414;
  const base = {
    ...CB.novaCarta(), nome: 'Sorcerer', tipo: 'monstro-efeito',
    raca: 'Spellcaster', atributo: 'DARK', nivel: 8, atk: 2900, def: 2400,
  };
  const com = CB.gerarLua({ ...base, tratadoComo: { codigo: DM, nome: 'Dark Magician' } });
  assert.match(com, /ec:SetCode\(EFFECT_ADD_CODE\)/);
  assert.match(com, /ec:SetValue\(46986414\)/);
  // Do oficial `c11082056`: o NOME de uma carta não é efeito que se negue ou copie.
  assert.match(com, /ec:SetProperty\(EFFECT_FLAG_CANNOT_DISABLE\+EFFECT_FLAG_UNCOPYABLE\)/);
  // O nome do admin só existe no comentário — nunca vira código.
  assert.match(com, /--sempre tratada como "Dark Magician" \(46986414\)/);
  assert.doesNotMatch(com.replace(/--.*$/gm, ''), /Dark Magician/);
  assert.match(CB.textoDosEfeitos({ ...base, tratadoComo: { codigo: DM, nome: 'Dark Magician' }, efeitos: [] }),
    /\(Esta carta é sempre tratada como "Dark Magician"\.\)/);
  // Controles: desligado não escreve nada, e nome sem id é recusado.
  assert.doesNotMatch(CB.gerarLua(base), /EFFECT_ADD_CODE/);
  assert.ok(CB.problemasDaCarta({ ...base, tratadoComo: { codigo: null, nome: 'Dark Magician' } })
    .some((x) => /falta o id/.test(x.texto ?? x)));
  // Magia não tem como ser "tratada como" um monstro por este caminho.
  assert.doesNotMatch(CB.gerarLua({ ...CB.novaCarta(), nome: 'M', tipo: 'magia', subtipo: 'normal', tratadoComo: { codigo: DM, nome: 'Dark Magician' } }),
    /EFFECT_ADD_CODE/);
});

t('"que lista a carta X" é o ListsCode — não é busca em texto', () => {
  const DM = 46986414;
  const carta = {
    ...CB.novaCarta(), nome: 'Sorcerer', tipo: 'monstro-efeito',
    efeitos: [{
      quando: 'mao', custo: 'revelar-esta', limite: 'por-efeito',
      acao: 'adicionar', alvo: 'outra', origem: 'deck', quantidade: 1,
      filtros: [{ categoria: 'magia', lista: DM, listaNome: 'Dark Magician' }],
    }],
  };
  const lua = CB.gerarLua(carta);
  assert.match(lua, /c:IsType\(TYPE_SPELL\) and c:ListsCode\(46986414\)/);
  assert.match(lua, /e1:SetCost\(Cost\.SelfReveal\)/, 'o custo "revelar esta carta" existe no momento da mão');
  assert.match(CB.textoDosEfeitos(carta), /adicione 1 Magia que lista "Dark Magician" do seu Deck à sua mão/);
  // Nome sem id é recusado aqui também.
  const semId = { ...carta.efeitos[0], filtros: [{ categoria: 'magia', listaNome: 'Dark Magician' }] };
  assert.ok(CB.problemasDaCarta({ ...carta, efeitos: [semId] }).some((x) => /falta o id da carta listada/.test(x.texto ?? x)));
});

/** O Dark Eradicator Sorcerer como ele está no banco — a carta que o `--test-card-builder` joga. */
const DARK_MAGICIAN = 46986414;
const SORCERER = {
  id: 950000005, nome: 'Dark Eradicator Sorcerer',
  tipo: 'monstro-efeito', subtipo: 'normal', visual: 'desenhada',
  atributo: 'DARK', raca: 'Spellcaster', nivel: 7, atk: 2500, def: 2100,
  invocacaoEspecial: {
    ligado: true, umaVezPorTurno: true,
    custoFiltros: [{ categoria: 'monstro', codigo: DARK_MAGICIAN, codigoNome: 'Dark Magician' }],
    destruir: [
      { filtros: [{ categoria: 'monstro', raca: 'Spellcaster', atributo: 'DARK' }] },
      { filtros: [{ categoria: 'magia' }] },
    ],
  },
  efeitos: [
    { quando: 'continuo', acao: 'nao-alvo', alvo: 'esta' },
    {
      quando: 'mao', custo: 'revelar-esta', limite: 'por-efeito',
      acao: 'ganhar-nome', alvo: 'esta', ganhaCodigo: DARK_MAGICIAN, ganhaNome: 'Dark Magician',
      depois: [{
        acao: 'adicionar', alvo: 'outra', origem: 'deck', quantidade: 1,
        filtros: [{ categoria: 'magia', lista: DARK_MAGICIAN, listaNome: 'Dark Magician' }],
      }],
    },
    {
      quando: 'esta-saiu-do-campo', limite: 'por-efeito',
      acao: 'adicionar', alvo: 'outra', origem: 'deck-cemiterio', quantidade: 1,
      filtros: [{ categoria: 'monstro', codigo: 29436665, codigoNome: 'Dark Eradicator Warlock' }],
    },
  ],
};

t('"ganhar o nome NESTE TURNO" nasce na OPERAÇÃO e morre no fim do turno — não é o de nascença', () => {
  const lua = CB.gerarLua(SORCERER);
  // O permanente mora no initial_effect; o ganho, não pode morar lá.
  const inicio = lua.split('function s.initial_effect(c)')[1].split('\nend\n')[0];
  assert.doesNotMatch(inicio, /EFFECT_ADD_CODE/, 'o nome ganho não pode nascer com a carta');
  assert.match(lua, /function s\.passo2_1[\s\S]*?en:SetCode\(EFFECT_ADD_CODE\)[\s\S]*?en:SetValue\(46986414\)[\s\S]*?en:SetReset\(RESETS_STANDARD_PHASE_END\)/);
  assert.match(lua, /e2:SetCost\(Cost\.SelfReveal\)/);
  // A busca é o "então": só roda se o 1º passo resolveu.
  assert.match(lua, /if not s\.passo2_1\(e,tp,eg,ep,ev,re,r,rp\) then return end/);
  assert.match(CB.textoDosEfeitos(SORCERER),
    /revele esta carta; neste turno, esta carta é tratada como "Dark Magician"; se fizer isso, adicione 1 Magia que lista "Dark Magician"/);
  // Sem o id, o passo "resolveria" sem renomear e a busca rodaria mesmo assim.
  const semId = { ...SORCERER, efeitos: SORCERER.efeitos.map((ef, i) => (i === 1 ? { ...ef, ganhaCodigo: null } : ef)) };
  assert.ok(CB.problemasDaCarta(semId).some((x) => /cujo nome esta carta ganha/.test(x.texto ?? x)));
  // E numa Magia a ação nem existe: o nome morreria com ela saindo da zona.
  assert.ok(!CB.acoesPermitidas({ ...CB.novaCarta(), tipo: 'magia', subtipo: 'normal' }, 'ativacao').includes('ganhar-nome'));
});

t('o procedimento só PAGA o preço; o "então destrua" é um gatilho obrigatório DEPOIS de entrar', () => {
  const lua = CB.gerarLua(SORCERER);
  assert.match(lua, /ei:SetCode\(EFFECT_SPSUMMON_PROC\)/);
  assert.match(lua, /ei:SetRange\(LOCATION_HAND\)/);
  assert.match(lua, /ei:SetValue\(1\)/, 'sem a marca o gatilho não sabe que ela entrou por aqui');
  assert.match(lua, /ei:SetCountLimit\(1,\{id,9\},EFFECT_COUNT_CODE_OATH\)/);
  // O erro de antes: a destruição dentro do procedimento acontecia ANTES de a
  // carta pisar no campo, sem resposta, e valia até com a Invocação negada.
  const op = lua.split('function s.invop(')[1].split('\nend\n')[0];
  assert.doesNotMatch(op, /Duel\.Destroy/);
  assert.match(lua, /ed:SetType\(EFFECT_TYPE_SINGLE\+EFFECT_TYPE_TRIGGER_F\)/);
  assert.match(lua, /ed:SetCode\(EVENT_SPSUMMON_SUCCESS\)/);
  assert.match(lua, /GetSummonType\(\)==SUMMON_TYPE_SPECIAL\+1/);
  assert.match(lua, /local fora=Group\.FromCards\(c\)/, 'ela é um Mago de TREVAS em campo: sem isto se ofereceria');
  // As condições de entrar são o preço E cada coisa a destruir.
  assert.match(lua, /IsExistingMatchingCard\(s\.invcusto,tp,LOCATION_HAND\|LOCATION_DECK,0,1,c\)/);
  assert.match(lua, /IsExistingMatchingCard\(s\.invdestruir1,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil\)/);
  assert.match(lua, /IsExistingMatchingCard\(s\.invdestruir2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil\)/);
  // Controles: sem "uma vez por turno" a conta some; sem nada a destruir, não há gatilho.
  const livre = { ...SORCERER, invocacaoEspecial: { ...SORCERER.invocacaoEspecial, umaVezPorTurno: false } };
  assert.doesNotMatch(CB.gerarLua(livre), /EFFECT_COUNT_CODE_OATH/);
  const semDestruir = { ...SORCERER, invocacaoEspecial: { ...SORCERER.invocacaoEspecial, destruir: [] } };
  assert.doesNotMatch(CB.gerarLua(semDestruir), /EVENT_SPSUMMON_SUCCESS/);
});

t('"esta carta não pode ser alvo" e "se ESTA carta deixar o campo" têm a forma da própria carta', () => {
  const lua = CB.gerarLua(SORCERER);
  assert.match(lua, /e1:SetCode\(EFFECT_CANNOT_BE_EFFECT_TARGET\)\s+e1:SetProperty\(EFFECT_FLAG_SINGLE_RANGE\)\s+e1:SetRange\(LOCATION_MZONE\)\s+e1:SetValue\(aux\.tgoval\)/);
  assert.match(lua, /e3:SetType\(EFFECT_TYPE_SINGLE\+EFFECT_TYPE_TRIGGER_O\)/);
  assert.match(lua, /e3:SetProperty\(EFFECT_FLAG_DAMAGE_STEP\+EFFECT_FLAG_DELAY\)/);
  // A condição pergunta ao HANDLER (a própria carta), não a `eg`.
  assert.match(lua, /function s\.condicao3[\s\S]*?local c=e:GetHandler\(\)[\s\S]*?c:IsReason\(REASON_BATTLE\)/);
  const texto = CB.textoDosEfeitos(SORCERER);
  assert.match(texto, /Esta carta não pode ser alvo de efeitos de cartas do oponente/);
  assert.match(texto, /Se esta carta deixar o campo por uma carta do oponente: adicione 1 "Dark Eradicator Warlock"/);
});

t('toda constante e função do Dark Eradicator Sorcerer existe no motor', () => {
  // O procedimento é peça de CARTA: a varredura combinatória não o liga, então
  // as constantes dele são conferidas aqui, contra o `constant.lua` do motor.
  const lua = CB.gerarLua(SORCERER);
  const faltam = [...new Set([...semComentarios(lua).matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)].map((m) => m[0]))]
    .filter((c) => !definida(c));
  assert.deepEqual(faltam, []);
  assert.match(UTILITY, /function Card\.ListsCode\(/);
  assert.match(UTILITY, /function Auxiliary\.tgoval\(/);
  assert.deepEqual(CB.problemasDaCarta(SORCERER), []);
});

t('o Lua que o --test-card-builder joga no motor é o que o gerador escreve (Dark Eradicator Sorcerer)', () => {
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const m = cs.match(/const string LUA_SORCERER =\s*@"([\s\S]*?)";/);
  assert.ok(m, 'não achei o LUA_SORCERER em duel-server/src/TestCardBuilder.cs');
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(codigo(m[1]), codigo(CB.gerarLua(SORCERER)),
    'o gerador mudou: atualize LUA_SORCERER em TestCardBuilder.cs e rode --test-card-builder de novo');
});

t('abrir a carta do banco no painel e salvar sem mexer não muda um byte do Lua', () => {
  // É o caminho do "editar o dele": `cartaDaLinha` (dados + id, em
  // cardbuilderbanco.js) → a tela → `salvarCarta` (normalizar → gerarLua). Se
  // normalizar o que JÁ foi normalizado mudasse algo, salvar sem mexer em nada
  // corromperia a carta, calado. O `cartaDaLinha` é reproduzido aqui porque o
  // módulo dele importa o `supabase.js`, que não roda em Node.
  const cartaDaLinha = (linha) => CB.normalizarCarta({ ...(linha?.dados ?? {}), id: Number(linha?.id) });
  for (const bruta of [SORCERER, MAX_RIDER]) {
    const dados = { ...CB.normalizarCarta(bruta) };
    delete dados.id;
    const linha = { id: bruta.id, dados: JSON.parse(JSON.stringify(dados)) };   // o jsonb do Supabase
    const aberta = cartaDaLinha(linha);
    assert.deepEqual(aberta, CB.normalizarCarta(bruta), `${bruta.nome}: normalizar de novo mudou a carta`);
    assert.equal(CB.gerarLua(aberta), CB.gerarLua(bruta), `${bruta.nome}: salvar sem mexer mudaria o Lua`);
  }
});

t('nome de carta sem o id é recusado — só o nome não aponta para nada', () => {
  // Aconteceu de verdade em DUAS cartas salvas (20/09/2026): a caixa "nome dela"
  // preenchida, a "carta (id)" vazia. O motor compara `IsCode`, então o filtro
  // casava com QUALQUER carta: "adicione 1 'The Warrior Returning Alive'" virava
  // "adicione 1 Magia qualquer", e o texto nem mostrava o nome. Sem erro nenhum.
  const com = (filtro) => ({
    ...CB.novaCarta(), tipo: 'armadilha', subtipo: 'continua', nome: 'T',
    efeitos: [{
      quando: 'campo', acao: 'adicionar', alvo: 'outra', origem: 'deck-cemiterio',
      quantidade: 1, filtros: [filtro],
    }],
  });
  const so_nome = CB.problemasDaCarta(com({ categoria: 'magia', codigoNome: 'The Warrior Returning Alive' }));
  assert.ok(so_nome.some((x) => /falta o id/.test(x.texto ?? x)), 'nome sem id tem de ser recusado');
  // Os dois controles: com o id passa, e sem nenhum dos dois também (filtro
  // genérico é uma escolha legítima).
  assert.deepEqual(CB.problemasDaCarta(com({ categoria: 'magia', codigo: 95281259, codigoNome: 'The Warrior Returning Alive' })), []);
  assert.deepEqual(CB.problemasDaCarta(com({ categoria: 'magia' })), []);
  // E a condição: o filtro dela também é conferido, em QUALQUER condição.
  const naCondicao = {
    ...CB.novaCarta(), tipo: 'armadilha', subtipo: 'continua', nome: 'T',
    efeitos: [{
      quando: 'campo', acao: 'comprar', quantidade: 1,
      condicao: 'invocado-neste-turno',
      condicaoFiltros: [{ categoria: 'monstro', codigoNome: 'MAX Rider' }],
    }],
  };
  assert.ok(CB.problemasDaCarta(naCondicao).some((x) => /falta o id/.test(x.texto ?? x)));
});

// A Revenge MAX (950000004) tem CINCO efeitos: os dois contínuos (Invocação sem
// tributo; Dragões em campo perdem 800 de ATK/DEF) e os três ativados. Com o teto
// em 4 o quinto não cabia — o botão ficava desligado e `normalizarCarta` cortava
// o que passasse, calado.
t('a Contínua aceita 5 efeitos: o "Dragões em campo perdem 800" da Revenge MAX', () => {
  const MAX_RIDER = { categoria: 'monstro', codigo: 950000003, codigoNome: 'MAX Rider' };
  const revenge = {
    ...CB.novaCarta(), tipo: 'armadilha', subtipo: 'continua', nome: 'Revenge MAX', id: 950000004,
    efeitos: [
      { quando: 'continuo', acao: 'sem-tributo',
        filtros: [{ categoria: 'monstro-normal', raca: 'Warrior', nivelMin: 5, nivelMax: 6, atkMax: 1900 }] },
      { quando: 'continuo', acao: 'bonus', alvo: 'outra', lado: 'qualquer', atk: -800, def: -800,
        filtros: [{ categoria: 'monstro', raca: 'Dragon' }] },
      { quando: 'campo', acao: 'destruir', alvo: 'outra', lado: 'qualquer', zona: 'qualquer', limite: 'por-efeito',
        condicao: 'controla', condicaoFiltros: [MAX_RIDER] },
      { quando: 'campo', acao: 'adicionar', alvo: 'outra', origem: 'deck-cemiterio', limite: 'por-efeito',
        filtros: [{ categoria: 'magia', codigo: 95281259, codigoNome: 'The Warrior Returning Alive' }] },
      { quando: 'saiu-do-campo', acao: 'reviver', alvo: 'outra', origem: 'mao-deck-cemiterio', limite: 'por-efeito',
        gatilhoFiltros: [MAX_RIDER],
        filtros: [{ categoria: 'monstro', codigo: 48305365, codigoNome: 'Axe Raider' }],
        depois: [{ acao: 'destruir', alvo: 'outra', lado: 'oponente', zona: 'qualquer' }] },
    ],
  };
  assert.deepEqual(CB.limiteDeEfeitos(revenge), { min: 1, max: 5 });
  assert.equal(CB.normalizarCarta(revenge).efeitos.length, 5, 'o quinto efeito não pode ser cortado');
  assert.deepEqual(CB.problemasDaCarta(revenge), []);
  const lua = CB.gerarLua(CB.normalizarCarta(revenge));
  // O debuff vale dos DOIS lados e só para Dragão, com o valor negativo.
  assert.match(lua, /e2:SetTargetRange\(LOCATION_MZONE,LOCATION_MZONE\)/);
  assert.match(lua, /e2:SetCode\(EFFECT_UPDATE_ATTACK\)[\s\S]*?e2:SetValue\(-800\)/);
  assert.match(lua, /e2b:SetCode\(EFFECT_UPDATE_DEFENSE\)[\s\S]*?e2b:SetValue\(-800\)/);
  assert.match(lua, /RACE_DRAGON/);
  // O último efeito ganhou a conta {id,5}, longe do {id,9} da Invocação própria.
  assert.match(lua, /e5:SetCountLimit\(1,\{id,5\}\)/);
  // A Armadilha Normal continua em 4.
  assert.equal(CB.limiteDeEfeitos({ ...revenge, subtipo: 'normal' }).max, 4);
});

// ---------------------------------------------------------- Shiny Medicine
//
// A Armadilha Normal do usuário (950000006, 24/09/2026), que trouxe quatro
// peças: o custo "envie 1 X e 1 Y" (`enviar-cada`), a ação "todo dano neste
// turno vira 0" (`sem-dano`), o gatilho "se você ativar 1 X e 1 Y com esta no
// Cemitério" (`ativou-cartas`) e o "adicione 1 X e 1 Y" (`umDeCada`) — mais os
// efeitos de CEMITÉRIO na Armadilha Normal, que antes só tinha a ativação.

const RED = 38199696;
const BLUE = 20871001;
const remedio = (codigo, codigoNome) => ({ categoria: 'magia', codigo, codigoNome });
const SHINY = {
  versao: 1, id: 950000006, nome: 'Shiny Medicine',
  tipo: 'armadilha', subtipo: 'normal', visual: 'completa',
  efeitos: [
    {
      quando: 'ativacao', custo: 'enviar-cada', limite: 'por-efeito', acao: 'sem-dano',
      custoFiltros: [remedio(RED, 'Red Medicine'), remedio(BLUE, 'Blue Medicine')],
    },
    {
      quando: 'ativou-cartas', limite: 'por-efeito', acao: 'adicionar', alvo: 'esta',
      gatilhoFiltros: [remedio(RED, 'Red Medicine'), remedio(BLUE, 'Blue Medicine')],
    },
    {
      quando: 'cemiterio', custo: 'banir-esta', limite: 'por-efeito',
      acao: 'adicionar', alvo: 'outra', origem: 'deck-cemiterio', umDeCada: true,
      filtros: [remedio(RED, 'Red Medicine'), remedio(BLUE, 'Blue Medicine')],
    },
  ],
};

t('"1 X e 1 Y" é uma carta de CADA opção, com volta atrás — e não a contagem por opção', () => {
  const lua = CB.gerarLua(SHINY);
  // O custo: da mão ou do Deck, como custo, e a carta nunca paga a si mesma.
  assert.match(lua, /function s\.custocada1_1\(c\)\s+return \(c:IsType\(TYPE_SPELL\) and c:IsCode\(38199696\)\) and c:IsAbleToGraveAsCost\(\)/);
  assert.match(lua, /s\.custocada1=\{s\.custocada1_1,s\.custocada1_2\}/);
  assert.match(lua, /GetMatchingGroup\(s\.custocada1\[i\],tp,LOCATION_HAND\|LOCATION_DECK,0,sg\)/);
  assert.match(lua, /if chk==0 then return s\.custocada1_resta\(tp,Group\.CreateGroup\(\),e:GetHandler\(\),1\) end/);
  assert.match(lua, /Duel\.SendtoGrave\(sg,REASON_COST\)/);
  // A escolha só oferece carta que deixa as opções seguintes possíveis — e sem
  // `Group.Iter`, que a dll daqui não tem.
  assert.match(lua, /sg:AddCard\(c\)\s+local ok=s\.custocada1_resta\(tp,sg,ex,i\+1\)/);
  assert.doesNotMatch(lua, /Group\.Iter|SelectUnselectGroup/);
  // A busca do 3º efeito: Deck E Cemitério, e as duas ou nenhuma.
  assert.match(lua, /e3:SetCost\(Cost\.SelfBanish\)/);
  assert.match(lua, /GetMatchingGroup\(s\.cada3\[i\],tp,LOCATION_DECK\|LOCATION_GRAVE,0,sg\)/);
  assert.match(lua, /if #g==0 then return Group\.CreateGroup\(\) end/);
  assert.match(CB.textoDosEfeitos(SHINY),
    /Envie 1 "Red Medicine" e 1 "Blue Medicine" da sua mão ou Deck ao Cemitério; todo dano que você sofreria neste turno se torna 0/);
  assert.match(CB.textoDosEfeitos(SHINY),
    /bana esta carta do seu Cemitério; adicione 1 "Red Medicine" e 1 "Blue Medicine" do seu Deck e\/ou Cemitério à sua mão/);
  // Controle: sem o "1 de cada", o mesmo filtro é o "ou" de sempre.
  const ou = { ...SHINY, efeitos: SHINY.efeitos.map((ef, i) => (i === 2 ? { ...ef, umDeCada: false } : ef)) };
  assert.doesNotMatch(CB.gerarLua(ou), /s\.cada3/);
});

t('"dano vira 0" são as DUAS peças do oficial, no jogador, até o fim do turno', () => {
  const lua = CB.gerarLua(SHINY);
  const op = lua.split('function s.operacao1(')[1].split('\nend\n')[0];
  // Uma sem a outra deixa passar metade do dano, calada.
  assert.match(op, /e1:SetCode\(EFFECT_CHANGE_DAMAGE\)[\s\S]*e1:SetTargetRange\(1,0\)[\s\S]*e1:SetValue\(0\)/);
  assert.match(op, /e2:SetCode\(EFFECT_NO_EFFECT_DAMAGE\)/);
  assert.equal(conta(op, 'RESET_PHASE'), 2);
  assert.equal(conta(op, 'Duel\\.RegisterEffect'), 2);
  // A ativação conta por efeito e é OATH: foi ativada, contou.
  assert.match(lua, /e1:SetCountLimit\(1,\{id,1\},EFFECT_COUNT_CODE_OATH\)/);
});

t('"se você ativar X e Y com esta no Cemitério": gatilho de Cemitério + um registro que morre com ela', () => {
  const lua = CB.gerarLua(SHINY);
  assert.match(lua, /e2:SetType\(EFFECT_TYPE_FIELD\+EFFECT_TYPE_TRIGGER_O\)\s+e2:SetProperty\(EFFECT_FLAG_DELAY\)\s+e2:SetCode\(EVENT_CHAINING\)\s+e2:SetRange\(LOCATION_GRAVE\)/);
  assert.match(lua, /e2r:SetType\(EFFECT_TYPE_FIELD\+EFFECT_TYPE_CONTINUOUS\)\s+e2r:SetCode\(EVENT_CHAINING\)\s+e2r:SetRange\(LOCATION_GRAVE\)/);
  // A marca morre no fim do turno E quando ela sai do Cemitério: é o "enquanto".
  assert.match(lua, /RegisterFlagEffect\(id\+200\+i,RESET_EVENT\|RESETS_STANDARD\|RESET_PHASE\|PHASE_END,0,1\)/);
  // A condição soma a ativação de AGORA às marcas: não depende de quem roda
  // primeiro entre o registro e o gatilho no mesmo evento.
  const cond = lua.split('function s.condicao2(')[1].split('\nend\n')[0];
  assert.match(cond, /rp~=tp/);
  assert.match(cond, /if s\.ativou2\[i\]\(rc\) then agora=true\s+elseif c:GetFlagEffect\(id\+200\+i\)==0 then return false end/);
  assert.match(CB.textoDosEfeitos(SHINY),
    /Se você ativar 1 "Red Medicine" e 1 "Blue Medicine" enquanto esta carta estiver no seu Cemitério: adicione esta carta à sua mão/);
  // "Adicionar ESTA carta" do Cemitério vale para Armadilha também — antes só monstro.
  assert.deepEqual(CB.alvosPermitidos(SHINY, 'cemiterio', 'adicionar'), ['outra', 'esta']);
  assert.deepEqual(CB.alvosPermitidos(SHINY, 'ativacao', 'adicionar'), ['outra']);
});

t('Armadilha Normal com efeito de Cemitério precisa da ativação; listas "1 de cada" vazias são recusadas', () => {
  assert.deepEqual(CB.problemasDaCarta(SHINY), []);
  const texto = (bruta) => CB.problemasDaCarta(bruta).map((x) => x.texto).join(' | ');
  // Só efeitos de Cemitério: a carta nunca sairia da mão.
  const semAtivacao = { ...SHINY, efeitos: SHINY.efeitos.slice(1) };
  assert.match(texto(semAtivacao), /precisa de um efeito de ativação/);
  // Cada lista vazia deixaria o Lua pedindo nada, calado.
  const vazio = (i, campo) => ({ ...SHINY, efeitos: SHINY.efeitos.map((ef, k) => (k === i ? { ...ef, [campo]: [] } : ef)) });
  assert.match(texto(vazio(0, 'custoFiltros')), /custo: diga quais cartas/);
  assert.match(texto(vazio(1, 'gatilhoFiltros')), /diga quais cartas você precisa ativar/);
  assert.match(texto(vazio(2, 'filtros')), /"1 de cada" precisa de uma opção por carta/);
  // E a Magia Normal de sempre, com um efeito só, continua valendo.
  assert.deepEqual(CB.problemasDaCarta({
    ...CB.novaCarta(), nome: 'M', tipo: 'magia', subtipo: 'normal',
    efeitos: [{ quando: 'ativacao', acao: 'comprar', quantidade: 2 }],
  }), []);
});

t('toda constante e função da Shiny Medicine existe no motor', () => {
  const lua = CB.gerarLua(SHINY);
  const faltam = [...new Set([...semComentarios(lua).matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)].map((m) => m[0]))]
    .filter((c) => !definida(c));
  assert.deepEqual(faltam, []);
  assert.match(UTILITY, /function Cost\.SelfBanish\(/);
});

t('o Lua que o --test-card-builder joga no motor é o que o gerador escreve (Shiny Medicine)', () => {
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const m = cs.match(/const string LUA_SHINY =\s*@"([\s\S]*?)";/);
  assert.ok(m, 'não achei o LUA_SHINY em duel-server/src/TestCardBuilder.cs');
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(codigo(m[1]), codigo(CB.gerarLua(SHINY)),
    'o gerador mudou: atualize LUA_SHINY em TestCardBuilder.cs e rode --test-card-builder de novo');
});

t('abrir a Shiny do banco e salvar sem mexer não muda o Lua', () => {
  const dados = { ...CB.normalizarCarta(SHINY) };
  delete dados.id;
  const aberta = CB.normalizarCarta({ ...JSON.parse(JSON.stringify(dados)), id: 950000006 });
  assert.deepEqual(aberta, CB.normalizarCarta(SHINY));
  assert.equal(CB.gerarLua(aberta), CB.gerarLua(SHINY));
});

// ------------------------------------------------ Evil Dragon of Darkness
//
// A carta do usuário (id REAL 950000008). Três peças de PASSO — `fundir`, o
// `opcional` e a condição sobre o passo anterior (`seFiltros`) — e uma da
// CARTA, `normalNoCemiterio`. O `--test-card-builder` joga este Lua no motor.

const EVIL = {
  ...CB.novaCarta(), id: 950000008, nome: 'Evil Dragon of Darkness', tipo: 'monstro-efeito',
  atributo: 'DARK', raca: 'Dragon', nivel: 4, atk: 1100, def: 500, visual: 'completa',
  normalNoCemiterio: true,
  efeitos: [{
    ...CB.novoEfeito(), quando: 'campo', custo: 'nenhum', limite: 'por-efeito',
    acao: 'adicionar', alvo: 'outra', origem: 'deck-cemiterio', quantidade: 1,
    filtros: [{ ...CB.novoFiltro(), categoria: 'monstro-normal', nivelMin: 5, atkMax: 1900 }],
    depois: [{
      acao: 'fundir', fusaoCodigo: 950000011, fusaoNome: 'Evil Dragon Knight of Darkness',
      opcional: true, seDoCemiterio: true,
      seFiltros: [{ ...CB.novoFiltro(), categoria: 'monstro', codigo: 950000009, codigoNome: 'Dragon Knight of Darkness' }],
    }],
  }],
};
const cartaPorId = (codigo, codigoNome) => ({ ...CB.novoFiltro(), categoria: 'monstro', codigo, codigoNome });
const F_DK = cartaPorId(950000009, 'Dragon Knight of Darkness');
const F_EVIL = cartaPorId(950000008, 'Evil Dragon of Darkness');
const EVIL_KNIGHT = {
  ...CB.novaCarta(), id: 950000011, nome: 'Evil Dragon Knight of Darkness', tipo: 'monstro-fusao', visual: 'completa',
  atributo: 'DARK', raca: 'Dragon', nivel: 9, atk: 2900, def: 1100, tratadoComoNormal: true,
  fusao: { materiais: [{ qtd: 1, filtros: [F_DK] }, { qtd: 1, filtros: [F_EVIL] }] },
  efeitos: [
    { ...CB.novoEfeito(), quando: 'invocado-especial', obrigatorio: true, limite: 'por-efeito',
      acao: 'destruir', alvo: 'outra', todas: true, lado: 'meus', zona: 'qualquer', filtros: [],
      depois: [{ acao: 'enviar-cemiterio', alvo: 'outra', lado: 'qualquer', zona: 'qualquer', quantidade: 2, opcional: true, filtros: [] }] },
    { ...CB.novoEfeito(), quando: 'campo', limite: 'por-efeito', condicao: 'nada-mais',
      condicaoFiltros: [{ ...CB.novoFiltro(), categoria: 'qualquer' }],
      acao: 'baixar', alvo: 'outra', origem: 'deck-cemiterio', quantidade: 1, ativaNoTurno: true,
      filtros: [{ ...CB.novoFiltro(), categoria: 'qualquer', codigo: 950000002, codigoNome: "Dragon's Inferno" }] },
    { ...CB.novoEfeito(), quando: 'esta-deixou-campo', obrigatorio: true, limite: 'por-efeito',
      acao: 'reviver', alvo: 'outra', origem: 'mao-deck-cemiterio', umDeCada: true, filtros: [F_DK, F_EVIL] },
  ],
};
const DESTROI_MEU = {
  ...CB.novaCarta(), id: 950000061, nome: 'Destrua um monstro seu (teste)', tipo: 'magia', subtipo: 'normal',
  efeitos: [{ ...CB.novoEfeito(), quando: 'ativacao', acao: 'destruir', alvo: 'outra', lado: 'meus', zona: 'monstro', quantidade: 1, filtros: [] }],
};
const BUSCA_NORMAL = {
  ...CB.novaCarta(), id: 950000060, nome: 'Busca Normal no Cemiterio (teste)', tipo: 'magia', subtipo: 'normal',
  efeitos: [{ ...CB.novoEfeito(), quando: 'ativacao', acao: 'adicionar', alvo: 'outra', origem: 'cemiterio',
    filtros: [{ ...CB.novoFiltro(), categoria: 'monstro-normal' }] }],
};

t('"Normal no Cemitério" é o par ADD_TYPE/REMOVE_TYPE do Gemini, com alcance só do Cemitério', () => {
  const lua = CB.gerarLua(EVIL);
  assert.match(lua, /etn:SetProperty\(EFFECT_FLAG_SINGLE_RANGE\+EFFECT_FLAG_IGNORE_IMMUNE\)\s+etn:SetCode\(EFFECT_ADD_TYPE\)\s+etn:SetRange\(LOCATION_GRAVE\)\s+etn:SetValue\(TYPE_NORMAL\)/);
  // Só a primeira metade deixaria a carta Normal E de Efeito no Cemitério.
  assert.match(lua, /etn2:SetCode\(EFFECT_REMOVE_TYPE\)\s+etn2:SetValue\(TYPE_EFFECT\)/);
  // Não é o bit: na mão e em campo ela continua de Efeito.
  assert.equal(CB.dadosDoMotor(EVIL).type, CB.BITS_DE_TIPO.TYPE_MONSTER | CB.BITS_DE_TIPO.TYPE_EFFECT);
  // Controle: sem a opção, nenhuma linha.
  assert.doesNotMatch(CB.gerarLua({ ...EVIL, normalNoCemiterio: false }), /EFFECT_ADD_TYPE|EFFECT_REMOVE_TYPE/);
  // Com o "sempre" junto, é redundante — e recusado.
  const texto = CB.problemasDaCarta({ ...EVIL, tratadoComoNormal: true }).map((p) => p.texto).join(' | ');
  assert.match(texto, /não soma nada/);
  assert.match(CB.textoDosEfeitos(EVIL), /Enquanto estiver no Cemitério, esta carta é tratada como um monstro Normal/);
});

t('passo "Invocação-Fusão usando esta carta": a forma manual da Polymerization', () => {
  assert.deepEqual(CB.problemasDaCarta(EVIL), []);
  const lua = CB.gerarLua(EVIL);
  const passo = lua.split('function s.passo1_2(')[1].split('\nend\n')[0];
  // Esta carta é o material obrigatório (`gc`), e sobrar zona é o `chkf=tp`.
  assert.match(lua, /c:IsCode\(950000011\)[\s\S]*c:CheckFusionMaterial\(mg,gc,tp\)/);
  assert.match(lua, /return mg:IsContains\(c\) and Duel\.IsExistingMatchingCard\(s\.fusao1_2,tp,LOCATION_EXTRA,0,1,nil,e,tp,mg,c\)/);
  assert.match(passo, /Duel\.SelectFusionMaterial\(tp,fc,mg,c,tp\)[\s\S]*fc:SetMaterial\(mat\)[\s\S]*REASON_EFFECT\+REASON_MATERIAL\+REASON_FUSION/);
  // Sem o `CompleteProcedure` o EnableReviveLimit prende a Fusão no Cemitério depois.
  assert.match(passo, /Duel\.SpecialSummon\(fc,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP\)==0 then return false end\s+fc:CompleteProcedure\(\)/);
  assert.match(lua, /SetCategory\(CATEGORY_TOHAND\+CATEGORY_SEARCH\+CATEGORY_SPECIAL_SUMMON\+CATEGORY_FUSION_SUMMON\)/);
  // Só num monstro — ele é o material.
  assert.ok(CB.acoesDoPasso(EVIL).includes('fundir'));
  assert.ok(!CB.acoesDoPasso(BUSCA_NORMAL).includes('fundir'));
  // Do Cemitério o passo nunca acharia a carta: recusado, e não um Lua mudo.
  const texto = (bruta) => CB.problemasDaCarta(bruta).map((p) => p.texto).join(' | ');
  const doCemiterio = { ...EVIL, efeitos: [{ ...EVIL.efeitos[0], quando: 'cemiterio' }] };
  assert.match(texto(doCemiterio), /a Fusão usa esta carta/);
  const semId = { ...EVIL, efeitos: [{ ...EVIL.efeitos[0], depois: [{ ...EVIL.efeitos[0].depois[0], fusaoCodigo: null }] }] };
  assert.match(texto(semId), /informe o id do monstro de Fusão/);
});

t('"se você adicionou X do Cemitério POR ESTE EFEITO": o passo anterior guarda o que moveu', () => {
  const lua = CB.gerarLua(EVIL);
  const busca = lua.split('function s.passo1_1(')[1].split('\nend\n')[0];
  assert.match(busca, /SendtoHand\(g,nil,REASON_EFFECT\)==0 then return false end\s+s\.moveu1=g/);
  assert.match(lua, /function s\.se1_2\(c\)\s+return \(c:IsType\(TYPE_MONSTER\) and c:IsCode\(950000009\)\) and c:IsLocation\(LOCATION_HAND\) and c:IsPreviousLocation\(LOCATION_GRAVE\)/);
  const passo = lua.split('function s.passo1_2(')[1].split('\nend\n')[0];
  // A condição vem ANTES da pergunta: não se oferece o que não vai acontecer.
  assert.match(passo, /^e,tp,eg,ep,ev,re,r,rp\)\n\tif not \(s\.moveu1 and s\.moveu1:IsExists\(s\.se1_2,1,nil\)\) then return false end\n\tif not \(s\.podefundir1_2\(e,tp\)\) or not Duel\.SelectYesNo\(tp,aux\.Stringid\(id,0\)\) then return false end/);
  // Uma resolução nunca herda o que a anterior guardou.
  assert.match(lua, /function s\.operacao1\(e,tp,eg,ep,ev,re,r,rp\)\n\ts\.moveu1=nil/);
  // Controle: sem a condição, nada é guardado — o Lua das cartas já salvas não muda.
  const sem = { ...EVIL, efeitos: [{ ...EVIL.efeitos[0], depois: [{ ...EVIL.efeitos[0].depois[0], seFiltros: [], opcional: false }] }] };
  assert.doesNotMatch(CB.gerarLua(sem), /s\.moveu1|SelectYesNo/);
  // Sem um passo anterior que MOVA outra carta, a condição nunca seria verdade.
  const texto = CB.problemasDaCarta({ ...EVIL, efeitos: [{ ...EVIL.efeitos[0], acao: 'comprar', alvo: null }] })
    .map((p) => p.texto).join(' | ');
  assert.match(texto, /só existe depois de adicionar ou Invocar OUTRA carta/);
  assert.match(CB.textoDosEfeitos(EVIL),
    /à sua mão\. Se você adicionou 1 "Dragon Knight of Darkness" do seu Cemitério por este efeito, se quiser, Invoque por Invocação-Fusão 1 "Evil Dragon Knight of Darkness"/);
});

t('toda constante da Evil Dragon existe no motor, e a Fusão manual usa só o que a dll tem', () => {
  const lua = CB.gerarLua(EVIL);
  const faltam = [...new Set([...semComentarios(lua).matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)].map((m) => m[0]))]
    .filter((c) => !definida(c));
  assert.deepEqual(faltam, []);
  assert.doesNotMatch(lua, /Group\.Iter|SelectUnselectGroup/);
});

t('o Lua que o --test-card-builder joga no motor é o que o gerador escreve (Evil Dragon)', () => {
  const cs = ler(new URL('duel-server/src/TestCardBuilder.cs', RAIZ));
  const codigo = (lua) => lua.replace(/""/g, '"').split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
  for (const [nome, carta] of [['LUA_EVIL', EVIL], ['LUA_EVIL_KNIGHT', EVIL_KNIGHT], ['LUA_BUSCA_NORMAL', BUSCA_NORMAL],
    ['LUA_DESTROI_MEU', DESTROI_MEU]]) {
    const m = cs.match(new RegExp(`const string ${nome} =\\s*@"([\\s\\S]*?)";`));
    assert.ok(m, `não achei o ${nome} em duel-server/src/TestCardBuilder.cs`);
    assert.deepEqual(codigo(m[1]), codigo(CB.gerarLua(carta)),
      `o gerador mudou: atualize ${nome} em TestCardBuilder.cs e rode --test-card-builder de novo`);
  }
});

t('abrir a Evil Dragon e a Fusão do banco e salvar sem mexer não muda o Lua', () => {
  for (const carta of [EVIL, EVIL_KNIGHT]) {
    const dados = { ...CB.normalizarCarta(carta) };
    delete dados.id;
    const aberta = CB.normalizarCarta({ ...JSON.parse(JSON.stringify(dados)), id: carta.id });
    assert.deepEqual(aberta, CB.normalizarCarta(carta));
    assert.equal(CB.gerarLua(aberta), CB.gerarLua(carta));
  }
});

// ------------------------------------------ Evil Dragon Knight of Darkness

t('"ao ser Invocado por Invocação-Especial" é só o SPSUMMON, e o gatilho obrigatório é TRIGGER_F', () => {
  assert.deepEqual(CB.problemasDaCarta(EVIL_KNIGHT), []);
  const lua = CB.gerarLua(EVIL_KNIGHT);
  const e1 = lua.split('local e1=')[1].split('c:RegisterEffect(e1)')[0];
  assert.match(e1, /SetType\(EFFECT_TYPE_SINGLE\+EFFECT_TYPE_TRIGGER_F\)/);
  assert.match(e1, /SetCode\(EVENT_SPSUMMON_SUCCESS\)/);
  // O `invocado` de antes tem o clone de SUMMON — este não.
  assert.doesNotMatch(lua, /EVENT_SUMMON_SUCCESS/);
  // Controle: sem "obrigatório", é o opcional de sempre.
  const opcional = { ...EVIL_KNIGHT, efeitos: EVIL_KNIGHT.efeitos.map((ef) => ({ ...ef, obrigatorio: false })) };
  assert.doesNotMatch(CB.gerarLua(opcional), /TRIGGER_F/);
  // Fora dos gatilhos, "obrigatório" não sobra no JSON.
  assert.equal(CB.normalizarCarta({ ...EVIL_KNIGHT, efeitos: [{ ...EVIL_KNIGHT.efeitos[1], obrigatorio: true }] }).efeitos[0].obrigatorio, false);
});

t('destruir TODAS do seu lado sempre resolve, e o "então" manda até 2 ao Cemitério', () => {
  const lua = CB.gerarLua(EVIL_KNIGHT);
  const passo1 = lua.split('function s.passo1_1(')[1].split('\nend\n')[0];
  // Sem escolha, só do seu lado, exceto esta — e resolve mesmo sem nada a destruir.
  assert.match(passo1, /Duel\.GetMatchingGroup\(s\.filtro1_1,tp,LOCATION_ONFIELD,0,e:GetHandler\(\)\)\s+if #g>0 then Duel\.Destroy\(g,REASON_EFFECT\) end\s+return true/);
  assert.match(lua, /if chk==0 then return true end\s+Duel\.SetOperationInfo\(0,CATEGORY_DESTROY/);
  const passo2 = lua.split('function s.passo1_2(')[1].split('\nend\n')[0];
  assert.match(passo2, /SelectYesNo/);
  assert.match(passo2, /SelectMatchingCard\(tp,s\.filtro1_2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,2,e:GetHandler\(\)\)[\s\S]*Duel\.SendtoGrave\(g,REASON_EFFECT\)>0/);
  assert.match(lua, /SetCategory\(CATEGORY_DESTROY\+CATEGORY_TOGRAVE\)/);
  // O destruir com alvo passou a entender "suas".
  const alvo = CB.gerarLua(DESTROI_MEU);
  assert.match(alvo, /chkc:IsControler\(tp\)/);
  assert.match(alvo, /SelectTarget\(tp,s\.filtro1,tp,LOCATION_MZONE,0,1,1,e:GetHandler\(\)\)/);
  assert.match(CB.textoDosEfeitos(EVIL_KNIGHT),
    /Se esta carta for Invocada por Invocação-Especial: destrua todas as cartas que você controla, exceto esta; se fizer isso, se quiser, escolha até 2 cartas em campo e envie essas cartas ao Cemitério/);
});

t('"se você não controlar nenhuma OUTRA carta": ausência no campo inteiro, viradas incluídas', () => {
  const lua = CB.gerarLua(EVIL_KNIGHT);
  assert.match(lua, /function s\.condicao2\(e,tp,eg,ep,ev,re,r,rp\)\s+return not Duel\.IsExistingMatchingCard\(s\.condfiltro2,tp,LOCATION_ONFIELD,0,1,e:GetHandler\(\)\)/);
  assert.doesNotMatch(lua.split('function s.condfiltro2(')[1].split('\nend\n')[0], /IsFaceup/);
  assert.match(lua, /e2:SetCondition\(s\.condicao2\)/);
  // A Inferno baixada pode ser ativada no mesmo turno (pedido de 27/09/2026).
  const op2 = lua.split('function s.operacao2(')[1].split('\nend\n')[0];
  assert.match(op2, /Duel\.SSet\(tp,sg\)>0 then[\s\S]*EFFECT_TRAP_ACT_IN_SET_TURN[\s\S]*EFFECT_FLAG_SET_AVAILABLE/);
  assert.match(CB.textoDosEfeitos(EVIL_KNIGHT), /baixe 1 "Dragon's Inferno" do seu Deck ou Cemitério \(ela pode ser ativada neste turno\)/);
  // Magia/Armadilha no filtro não é recusada aqui (é "nenhuma CARTA").
  const comMagia = { ...EVIL_KNIGHT, efeitos: EVIL_KNIGHT.efeitos.map((ef, i) => (i === 1
    ? { ...ef, condicaoFiltros: [{ ...CB.novoFiltro(), categoria: 'magia' }] } : ef)) };
  assert.deepEqual(CB.problemasDaCarta(comMagia), []);
});

t('"se esta carta deixar o campo": qualquer motivo, e Invoca 1 X E 1 Y com zonas para os dois', () => {
  const lua = CB.gerarLua(EVIL_KNIGHT);
  const e3 = lua.split('local e3=')[1].split('c:RegisterEffect(e3)')[0];
  assert.match(e3, /SetProperty\(EFFECT_FLAG_DAMAGE_STEP\+EFFECT_FLAG_DELAY\)/);
  assert.match(e3, /SetCode\(EVENT_LEAVE_FIELD\)/);
  const cond = lua.split('function s.condicao3(')[1].split('\nend\n')[0];
  // Diferente do irmão "por carta do oponente": nada de GetReasonPlayer.
  assert.doesNotMatch(cond, /GetReasonPlayer|REASON_BATTLE/);
  assert.match(lua, /function s\.cada3_1_1\(c,e,tp\)[\s\S]*c:IsCanBeSpecialSummoned\(e,0,tp,false,false\)/);
  assert.match(lua, /Duel\.GetLocationCount\(tp,LOCATION_MZONE\)>=#s\.cada3_1 and s\.cada3_1_resta\(tp,Group\.CreateGroup\(\),e:GetHandler\(\),1,e\)/);
  assert.match(lua, /Duel\.SpecialSummon\(sg,0,tp,tp,false,false,POS_FACEUP\)>0/);
  // Os filtros de sempre (sem `e,tp`) continuam iguais — a Shiny depende disso.
  assert.match(CB.gerarLua(SHINY), /function s\.custocada1_resta\(tp,sg,ex,i\)/);
  // "1 de cada" de qualquer lado não existe: a busca olha um lado só.
  const texto = CB.problemasDaCarta({ ...EVIL_KNIGHT, efeitos: EVIL_KNIGHT.efeitos.map((ef, i) => (i === 2
    ? { ...ef, origem: 'cemiterio-ambos' } : ef)) }).map((p) => p.texto).join(' | ');
  assert.match(texto, /só Invoca do seu lado/);
  assert.match(CB.textoDosEfeitos(EVIL_KNIGHT),
    /Se esta carta deixar o campo: Invoque por Invocação-Especial 1 "Dragon Knight of Darkness" e 1 "Evil Dragon of Darkness" da sua mão, Deck e\/ou Cemitério/);
});

t('toda constante da Evil Dragon Knight existe no motor', () => {
  for (const carta of [EVIL_KNIGHT, DESTROI_MEU]) {
    const lua = CB.gerarLua(carta);
    const faltam = [...new Set([...semComentarios(lua).matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)].map((m) => m[0]))]
      .filter((c) => !definida(c));
    assert.deepEqual(faltam, []);
  }
});

// ------------------------------------------------ arquétipo (Bickuribox, 950000012)

t('"sempre tratada como um card Toon": EFFECT_ADD_SETCODE permanente, com o setcode em número', () => {
  const BICKURI = {
    ...CB.novaCarta(), id: 950000012, nome: 'Bickuribox', tipo: 'monstro-normal',
    atributo: 'DARK', raca: 'Fiend', nivel: 7, atk: 2300, def: 2000, efeitos: [],
    arquetipo: { setcode: '0x62', nome: 'Toon' },
  };
  assert.deepEqual(CB.problemasDaCarta(BICKURI), []);
  // O texto "0x62" vira o número; a normalização é idempotente.
  assert.deepEqual(CB.normalizarCarta(BICKURI).arquetipo, { setcode: 0x62, nome: 'Toon' });
  assert.deepEqual(CB.normalizarCarta(CB.normalizarCarta(BICKURI)).arquetipo, { setcode: 0x62, nome: 'Toon' });
  const lua = CB.gerarLua(BICKURI);
  // SINGLE sem alcance: vale em toda zona, inclusive no Deck (é onde uma busca procura).
  assert.match(lua, /ea:SetType\(EFFECT_TYPE_SINGLE\)\s+ea:SetCode\(EFFECT_ADD_SETCODE\)\s+ea:SetProperty\(EFFECT_FLAG_CANNOT_DISABLE\+EFFECT_FLAG_UNCOPYABLE\)\s+ea:SetValue\(0x62\)/);
  assert.doesNotMatch(lua, /ea:SetRange/);
  // O arquétipo não é o TIPO Toon: nenhum bit novo nos dados do motor.
  assert.equal(CB.dadosDoMotor(BICKURI).type, CB.BITS_DE_TIPO.TYPE_MONSTER | CB.BITS_DE_TIPO.TYPE_NORMAL);
  assert.deepEqual(CB.entradaDoIndice(BICKURI).a, ['Toon']);
  assert.match(CB.textoDosEfeitos(BICKURI), /\(Esta carta é sempre tratada como um card "Toon"\.\)/);
  // O setcode bate com o do motor (lido do arquivo, não copiado).
  const arq = ler(new URL('archetype_setcode_constants.lua', SCRIPTS));
  assert.match(arq, /^SET_TOON\s*=\s*0x62\b/m);
  // Controle: sem arquétipo, nenhuma linha; nome sem setcode é recusado.
  assert.doesNotMatch(CB.gerarLua({ ...BICKURI, arquetipo: { setcode: null, nome: '' } }), /ADD_SETCODE/);
  assert.match(CB.problemasDaCarta({ ...BICKURI, arquetipo: { setcode: null, nome: 'Toon' } }).map((p) => p.texto).join(' | '),
    /falta o setcode/);
  assert.equal(CB.normalizarCarta({ ...BICKURI, arquetipo: { setcode: '0x10000' } }).arquetipo.setcode, null);
});

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
