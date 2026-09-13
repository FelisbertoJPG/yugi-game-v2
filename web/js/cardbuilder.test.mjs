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
  assert.match(lua, /local ft=math\.min\(2,Duel\.GetLocationCount\(tp,LOCATION_SZONE\)\)/);
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

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
