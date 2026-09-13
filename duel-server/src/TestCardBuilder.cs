using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// As cartas do **Card Builder** no motor — `--test-card-builder`.
    ///
    /// A carta criada em `web/cardbuilder.html` não mora no `cards.cdb` nem na
    /// pasta de scripts: ela chega no `/start` (`customCards`, dados + Lua) e o
    /// `DatabaseManager` e o `ScriptManager` do duelo passam a responder por ela.
    /// O buraco que isto guarda erra CALADO: sem o registro, a carta entra no deck
    /// com tipo 0, o motor não acha o script, e na tela ela simplesmente nunca é
    /// oferecida — nem "Ativar", nem "Invocar", e nenhum erro em lugar nenhum.
    ///
    /// O que se prova:
    ///   • a LEITURA do corpo recusa o que não é do builder (um id oficial, Lua
    ///     vazio, duplicata) — é essa trava que impede trocar o script do Pote da
    ///     Ganância por outro;
    ///   • o NPC lê os números da carta pelo `Stats` (senão decide por um 0/0);
    ///   • num duelo de verdade a Magia é ATIVADA pelo motor, COMPRA 2 e vai para
    ///     o Cemitério, e o Monstro aparece como invocável;
    ///   • a CATEGORIA COMPOSTA, com o Lua que o GERADOR escreve para a Multistrike
    ///     Dragon Dragias: o custo de Tipos diferentes, a Invocação, o "então
    ///     destrua" e os 2 ataques da MESMA carta;
    ///   • os pares CONTROLE: o mesmo deck sem `customCards` não oferece nada, e a
    ///     mesma Dragias com o ataque extra zerado ataca uma vez só;
    ///   • a Dragon's Inferno (Armadilha Contínua), também com o Lua do gerador: a
    ///     Invocação-Normal sem tributo, o destruir que depende de controlar um
    ///     Normal Dragão, a busca no Deck/Cemitério, o baixar de nomes diferentes e
    ///     a conta de CADA efeito (`{id,n}`), com um controle para cada troca.
    ///
    /// O Lua da Magia e do Monstro é escrito aqui (prova o ENCANAMENTO). O da
    /// Dragias é o que `web/js/cardbuilder.js` gera — e `cardbuilder.test.mjs`
    /// cobra que `LUA_DRAGIAS` continua igual à saída do gerador. Mudou o gerador,
    /// atualize a constante e rode este teste de novo.
    /// </summary>
    public static class TestCardBuilder
    {
        const uint MAGIA = 950000001;     // Magia Normal: compre 2
        const uint MONSTRO = 950000002;   // Monstro Normal Nv4 1850/1600, LUZ Guerreiro
        const uint DRAGIAS = 950000010;   // Monstro de Efeito Nv7 2500/1800, TREVAS Dragão
        const uint OX = 5053103;          // Battle Ox, o deck do NPC
        const uint POTE = 55144522;       // Pot of Greed: um id OFICIAL
        const uint OLHO = 7562372;        // Megasonic Eye — Normal Nv5 1500, Máquina
        const uint LEOGUN = 10538007;     // Leogun — Normal Nv5 1750, Besta
        const byte LOC_HAND = 0x02;
        const byte LOC_MZONE = 0x04;
        const byte LOC_ONFIELD = 0x0C;
        const byte LOC_GRAVE = 0x10;

        const string LUA_MAGIA =
@"--Teste do Card Builder: Magia Normal, comprar 2
local s,id=GetID()
function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)
  e1:SetCategory(CATEGORY_DRAW)
  e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetTarget(s.alvo1)
  e1:SetOperation(s.operacao1)
  c:RegisterEffect(e1)
end
function s.alvo1(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsPlayerCanDraw(tp,2) end
  Duel.SetTargetPlayer(tp)
  Duel.SetTargetParam(2)
  Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,2)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
  local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
  Duel.Draw(p,d,REASON_EFFECT)
end
";

        const string LUA_MONSTRO =
@"--Teste do Card Builder: Monstro Normal
local s,id=GetID()
function s.initial_effect(c)
end
";

        /// <summary>
        /// A saída de `gerarLua` para a Dragias de `cardbuilder.test.mjs`
        /// (comentários à parte, que a comparação ignora).
        /// </summary>
        const string LUA_DRAGIAS =
@"--Multistrike Dragon Dragias
--Classic Duels · Card Builder · Monstro de Efeito
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--da mão (Main Phase): Invocação-Especial (da mão ou do Cemitério) (esta carta)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DESTROY)
	e1:SetType(EFFECT_TYPE_IGNITION)
	e1:SetRange(LOCATION_HAND)
	e1:SetCountLimit(1,id)
	e1:SetCost(s.custo1)
	e1:SetTarget(s.alvo1)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
end
function s.custofiltro1(c)
	return (c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsLevelAbove(5) and c:IsAttackBelow(1900)) and c:IsDiscardable()
end
function s.custo1(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=Duel.GetMatchingGroup(s.custofiltro1,tp,LOCATION_HAND,0,e:GetHandler())
	if chk==0 then return g:GetClassCount(Card.GetRace)>=2 end
	local sg=Group.CreateGroup()
	for i=1,2 do
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DISCARD)
		local tc=g:Select(tp,1,1,nil):GetFirst()
		sg:AddCard(tc)
		g:Remove(Card.IsRace,nil,tc:GetRace())
	end
	Duel.SendtoGrave(sg,REASON_COST+REASON_DISCARD)
end
function s.passo1_1(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) or Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return false end
	return Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0
end
function s.filtro1_2(c)
	return true
end
function s.passo1_2(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectMatchingCard(tp,s.filtro1_2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler())
	if #g==0 then return false end
	return Duel.Destroy(g,REASON_EFFECT)>0
end
function s.passo1_3(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not (c:IsFaceup() and c:IsLocation(LOCATION_MZONE)) then return false end
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetCode(EFFECT_EXTRA_ATTACK)
	e1:SetValue(1)
	e1:SetReset(RESETS_STANDARD_PHASE_END)
	c:RegisterEffect(e1)
	return true
end
function s.alvo1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and e:GetHandler():IsCanBeSpecialSummoned(e,0,tp,false,false) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	if not s.passo1_1(e,tp,eg,ep,ev,re,r,rp) then return end
	Duel.BreakEffect()
	if not s.passo1_2(e,tp,eg,ep,ev,re,r,rp) then return end
	Duel.BreakEffect()
	s.passo1_3(e,tp,eg,ep,ev,re,r,rp)
end
";

        // ----------------------------------------------- Fusão e Ritual
        const uint FUSAO = 950000030;        // Monstro de Fusão Nv7 2600/2100, VENTO Dragão
        const uint RITUAL = 950000040;       // Monstro de Ritual Nv4 1800/1000, LUZ Guerreiro
        const uint MAGIA_RITUAL = 950000041; // Magia de Ritual que Invoca o RITUAL
        const uint POLY = 24094653;          // Polymerization
        const uint GAIA_KNIGHT = 6368038;    // Gaia The Fierce Knight — material 1
        const uint CURSE_DRAGON = 28279543;  // Curse of Dragon — material 2
        const byte LOC_EXTRA = 0x40;

        /// <summary>A saída de `gerarLua` para a Fusão de `cardbuilder.test.mjs`.</summary>
        const string LUA_FUSAO =
@"--Dragao de Fusao de Teste
--Classic Duels · Card Builder · Monstro de Fusão
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--Monstro de Fusão: sai do Extra Deck por Invocação-Fusão, com os materiais abaixo
	c:EnableReviveLimit()
	Fusion.AddProcMixN(c,true,true,s.material1,1,s.material2,1)
end
function s.material1(c,fc,sumtype,tp)
	return c:IsType(TYPE_MONSTER) and c:IsCode(6368038)
end
function s.material2(c,fc,sumtype,tp)
	return c:IsType(TYPE_MONSTER) and c:IsCode(28279543)
end
";

        /// <summary>A saída de `gerarLua` para o Monstro de Ritual de `cardbuilder.test.mjs`.</summary>
        const string LUA_RITUAL =
@"--Guerreiro do Ritual de Teste
--Classic Duels · Card Builder · Monstro de Ritual
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--Monstro de Ritual: só sai por Invocação-Ritual (a Magia de Ritual aponta o id desta carta)
	c:EnableReviveLimit()
end
";

        /// <summary>A saída de `gerarLua` para a Magia de Ritual de `cardbuilder.test.mjs`.</summary>
        const string LUA_MAGIA_RITUAL =
@"--Ritual de Teste
--Classic Duels · Card Builder · Magia Ritual
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--Magia de Ritual: Invoca por Ritual o monstro abaixo (Níveis iguais ou maiores)
	Ritual.AddProcGreater({handler=c,filter=aux.FilterBoolFunction(Card.IsCode,950000040)})
end
";

        // ----------------------------------------------- Dragon's Inferno
        const uint INFERNO = 950000050;   // Armadilha Contínua: sem tributo, destruir, buscar, baixar
        const uint STAMPING = 81385346;   // Stamping Destruction — uma das seis que ela baixa
        const uint AVANCO = 52112003;     // Card Advance — outra das seis
        const byte LOC_DECK = 0x01;
        const byte LOC_SZONE = 0x08;

        /// <summary>A saída de `gerarLua` para a Dragon's Inferno de `cardbuilder.test.mjs`.</summary>
        const string LUA_INFERNO =
@"--Dragon's Inferno
--Classic Duels · Card Builder · Armadilha Contínua
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--Ativar (a carta fica na zona)
	local e0=Effect.CreateEffect(c)
	e0:SetType(EFFECT_TYPE_ACTIVATE)
	e0:SetCode(EVENT_FREE_CHAIN)
	c:RegisterEffect(e0)
	--contínuo (enquanto estiver em campo): Invocação-Normal sem tributo
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_SUMMON_PROC)
	e1:SetRange(LOCATION_SZONE)
	e1:SetTargetRange(LOCATION_HAND,0)
	e1:SetCondition(s.condicao1)
	e1:SetTarget(aux.FieldSummonProcTg(s.filtro1))
	c:RegisterEffect(e1)
	--no campo (Main Phase): destruir (outra carta)
	local e2=Effect.CreateEffect(c)
	e2:SetCategory(CATEGORY_DESTROY)
	e2:SetType(EFFECT_TYPE_QUICK_O)
	e2:SetProperty(EFFECT_FLAG_CARD_TARGET)
	e2:SetCode(EVENT_FREE_CHAIN)
	e2:SetRange(LOCATION_SZONE)
	e2:SetCountLimit(1,{id,2})
	e2:SetCondition(s.condicao2)
	e2:SetTarget(s.alvo2)
	e2:SetOperation(s.operacao2)
	c:RegisterEffect(e2)
	--no campo (Main Phase): adicionar à mão (outra carta)
	local e3=Effect.CreateEffect(c)
	e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
	e3:SetType(EFFECT_TYPE_QUICK_O)
	e3:SetCode(EVENT_FREE_CHAIN)
	e3:SetRange(LOCATION_SZONE)
	e3:SetCountLimit(1,{id,3})
	e3:SetCost(Cost.Discard(nil,true,1))
	e3:SetTarget(s.alvo3)
	e3:SetOperation(s.operacao3)
	c:RegisterEffect(e3)
	--no campo (Main Phase): baixar Magia/Armadilha (Set) (outra carta)
	local e4=Effect.CreateEffect(c)
	e4:SetType(EFFECT_TYPE_QUICK_O)
	e4:SetCode(EVENT_FREE_CHAIN)
	e4:SetRange(LOCATION_SZONE)
	e4:SetCountLimit(1,{id,4})
	e4:SetTarget(s.alvo4)
	e4:SetOperation(s.operacao4)
	c:RegisterEffect(e4)
end
function s.condicao1(e,c,minc)
	if c==nil then return true end
	return minc==0 and Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0
end
function s.filtro1(e,c)
	return (c:IsType(TYPE_MONSTER) and c:IsRace(RACE_DRAGON) and c:IsLevelAbove(5) and c:IsLevelBelow(6)) and c:IsLevelAbove(5)
end
function s.condfiltro2(c)
	return c:IsFaceup() and (c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsRace(RACE_DRAGON) and c:IsLevelAbove(5) and c:IsLevelBelow(6))
end
function s.condicao2(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsExistingMatchingCard(s.condfiltro2,tp,LOCATION_MZONE,0,1,nil)
end
function s.filtro2(c)
	return true
end
function s.alvo2(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_ONFIELD) and chkc:IsControler(1-tp) and s.filtro2(chkc) end
	if chk==0 then return Duel.IsExistingTarget(s.filtro2,tp,0,LOCATION_ONFIELD,1,e:GetHandler()) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectTarget(tp,s.filtro2,tp,0,LOCATION_ONFIELD,1,1,e:GetHandler())
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
end
function s.operacao2(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)
	if not g then return end
	local tg=g:Filter(Card.IsRelateToEffect,nil,e)
	if #tg>0 then
		Duel.Destroy(tg,REASON_EFFECT)
	end
end
function s.filtro3(c)
	return (c:IsType(TYPE_MONSTER) and c:IsRace(RACE_DRAGON) and c:IsLevelAbove(5) and c:IsLevelBelow(6)) and c:IsAbleToHand()
end
function s.alvo3(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filtro3,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,e:GetHandler()) end
	Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)
end
function s.operacao3(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,s.filtro3,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,e:GetHandler())
	if #g>0 then
		Duel.SendtoHand(g,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,g)
	end
end
function s.filtro4(c)
	return ((c:IsCode(81385346))
		or (c:IsCode(92408984))
		or (c:IsCode(20140382))
		or (c:IsCode(55991637))
		or (c:IsCode(28596933))
		or (c:IsCode(52112003))) and c:IsSSetable()
end
function s.nomelivre4(c,sg)
	return not sg:IsExists(Card.IsCode,1,nil,c:GetCode())
end
function s.alvo4(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filtro4,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,e:GetHandler()) end
end
function s.operacao4(e,tp,eg,ep,ev,re,r,rp)
	local ft=math.min(2,Duel.GetLocationCount(tp,LOCATION_SZONE))
	if ft<=0 then return end
	local g=Duel.GetMatchingGroup(s.filtro4,tp,LOCATION_DECK|LOCATION_GRAVE,0,e:GetHandler())
	local sg=Group.CreateGroup()
	while #sg<ft do
		local livres=g:Filter(s.nomelivre4,sg,sg)
		if #livres==0 then break end
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
		local tc=livres:SelectUnselect(sg,tp,#sg>0,false,1,ft)
		if not tc then break end
		if sg:IsContains(tc) then sg:RemoveCard(tc) else sg:AddCard(tc) end
	end
	if #sg>0 then Duel.SSet(tp,sg) end
end
";

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: cartas do Card Builder no motor ===\n");
            Leitura();
            Stats(sa);
            Duelo(sa);
            Dragias(sa);
            FusaoERitual(sa);
            DragonsInferno(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static object Magia(uint id = MAGIA, string lua = LUA_MAGIA) =>
            new { id, nome = "Magia de Teste", type = 0x2, level = 0, attribute = 0, race = 0, atk = 0, def = 0, lua };

        static object Monstro() =>
            new { id = MONSTRO, nome = "Guerreiro de Teste", type = 0x11, level = 4, attribute = 0x10, race = 0x1, atk = 1850, def = 1600, lua = LUA_MONSTRO };

        static object CartaDragias(string lua) =>
            new { id = DRAGIAS, nome = "Multistrike Dragon Dragias", type = 0x21, level = 7, attribute = 0x20, race = 0x2000, atk = 2500, def = 1800, lua };

        /// <summary>O corpo do /start, montado como o `duel.html` o manda.</summary>
        static JsonElement Corpo(params object[] cartas) =>
            JsonSerializer.SerializeToElement(new { deck = new[] { MAGIA }, customCards = cartas });

        static CartaCustom[] Validas() => CartaCustom.Ler(Corpo(Magia(), Monstro()));

        static void Leitura()
        {
            Log.Info("-- a leitura do corpo --");
            var ok = Validas();
            Check("as duas cartas do builder foram lidas", ok.Length == 2 && ok.Any(c => c.Code == MAGIA) && ok.Any(c => c.Code == MONSTRO),
                  $"(leu {ok.Length})");
            var m = ok.FirstOrDefault(c => c.Code == MONSTRO);
            Check("os números do monstro chegaram", m != null && m.Type == 0x11 && m.Level == 4 && m.Atk == 1850 && m.Def == 1600
                                                   && m.Attribute == 0x10 && m.Race == 0x1);

            var ruim = CartaCustom.Ler(Corpo(Magia(POTE), Magia(MAGIA, ""), Magia(), Magia()));
            Check("id OFICIAL é recusado (não troca o script do Pote da Ganância)", ruim.All(c => c.Code != POTE));
            Check("Lua vazio é recusado e a duplicata entra uma vez só", ruim.Length == 1 && ruim[0].Code == MAGIA,
                  $"(leu {ruim.Length})");

            var semCampo = CartaCustom.Ler(JsonSerializer.SerializeToElement(new { deck = new[] { OX } }));
            Check("corpo sem customCards não inventa carta nenhuma", semCampo.Length == 0);
        }

        static void Stats(string sa)
        {
            Log.Info("\n-- o que o NPC lê --");
            using var db = new DatabaseManager(sa);
            Check("controle: sem registro, o banco não conhece a carta", db.Stats(MONSTRO).Type == 0);
            db.RegistrarCustom(Validas());
            var s = db.Stats(MONSTRO);
            Check("com registro, Stats devolve os números do builder",
                  s.IsMonster && s.Level == 4 && s.Atk == 1850 && s.Def == 1600 && s.Race == 0x1 && s.Attribute == 0x10,
                  $"(type={s.Type} lv={s.Level} atk={s.Atk} def={s.Def})");
            Check("com registro, Nome devolve o nome da carta", db.Nome(MONSTRO) == "Guerreiro de Teste", $"({db.Nome(MONSTRO)})");
        }

        static void Duelo(string sa)
        {
            Log.Info("\n-- num duelo --");
            var deck = Enumerable.Repeat(MAGIA, 20).Concat(Enumerable.Repeat(MONSTRO, 20)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            var com = Jogar(sa, deck, npc, Validas());
            Check("o motor OFERECEU ativar a Magia do builder", com.magiaAtivavel);
            Check("a Magia resolveu e COMPROU 2", com.comprou2);
            Check("a Magia foi para o Cemitério", com.magiaNoCemiterio);
            Check("o Monstro do builder apareceu como invocável", com.monstroInvocavel);
            Check("nada ficou 'unsupported'", !com.unsupported);

            var sem = Jogar(sa, deck, npc, null);
            Check("controle: SEM customCards a Magia nunca é oferecida", !sem.magiaAtivavel);
            Check("controle: SEM customCards o Monstro nunca é invocável", !sem.monstroInvocavel);
        }

        static void Dragias(string sa)
        {
            Log.Info("\n-- a categoria composta: Multistrike Dragon Dragias --");
            var com = JogarDragias(sa, LUA_DRAGIAS);
            Check("o motor ofereceu ativar a Dragias da mão (o custo de Tipos diferentes pôde ser pago)", com.ativou);
            Check("o custo descartou 2 Normais de Tipos DIFERENTES", com.descartouDoisTipos);
            Check("passo 1: a Dragias foi Invocada por Invocação-Especial", com.invocou);
            Check("passo 2 (se resolveu): destruiu 1 carta no campo", com.destruiu);
            Check("passo 3 (se resolveu): a MESMA Dragias atacou 2 vezes na Battle Phase", com.atacouDuasVezes);
            Check("nada ficou 'unsupported'", !com.unsupported);

            // O par CONTROLE: o mesmo script com o ataque extra zerado. Sem ele,
            // "atacou 2 vezes" poderia ser o motor deixando atacar à toa.
            var sem = JogarDragias(sa, LUA_DRAGIAS.Replace("e1:SetValue(1)", "e1:SetValue(0)"));
            Check("controle: com o ataque extra zerado a Dragias chega a atacar", sem.atacouUmaVez);
            Check("controle: e ataca UMA vez só", !sem.atacouDuasVezes);
        }

        /// <summary>
        /// Monstro de Fusão e de Ritual do builder, jogados de verdade com o Lua que
        /// o gerador escreve. A Fusão mora no EXTRA e só aparece por Polymerization
        /// se o `Fusion.AddProcMixN` dela foi registrado; o Ritual só sai pela
        /// Magia de Ritual do builder que o aponta. O controle das duas é o mesmo
        /// deck sem `customCards`: sem a carta registrada, a magia nunca é oferecida
        /// — sem ele, "ficou ativável" não provaria que foi a carta do builder.
        /// </summary>
        static void FusaoERitual(string sa)
        {
            Log.Info("\n-- Monstro de Fusão e Monstro de Ritual --");

            var fusao = JogarFusao(sa, comCartas: true);
            Check("a Polymerization ficou ativável com a Fusão do builder no Extra Deck", fusao.ativou);
            Check("a Fusão do builder saiu do Extra Deck para o campo", fusao.emCampo);
            Check("os dois materiais (Gaia + Curse of Dragon) foram para o Cemitério", fusao.materiais);
            Check("nada ficou 'unsupported' na Fusão", !fusao.unsupported);
            var semFusao = JogarFusao(sa, comCartas: false);
            Check("controle: SEM customCards a Polymerization nunca é oferecida", !semFusao.ativou);

            var ritual = JogarRitual(sa, comCartas: true);
            Check("a Magia de Ritual do builder ficou ativável", ritual.ativou);
            Check("o Monstro de Ritual do builder foi Invocado por Ritual", ritual.emCampo);
            Check("o tributo foi para o Cemitério", ritual.materiais);
            Check("nada ficou 'unsupported' no Ritual", !ritual.unsupported);
            var semRitual = JogarRitual(sa, comCartas: false);
            Check("controle: SEM customCards a Magia de Ritual nunca é oferecida", !semRitual.ativou);
        }

        struct ResultadoInvocacao
        {
            public bool ativou, emCampo, materiais, unsupported;
        }

        static InteractiveDuel.Result Padrao(InteractiveDuel duel, InteractiveDuel.Question q) => q.kind switch
        {
            "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
            "position" => duel.Respond("position", 0x1),
            "yesno" => duel.Respond("yes", 1),
            "option" => duel.Respond("option", 0),
            "battle" => duel.Respond("endbattle", 0),
            "chain" => duel.Respond("chain", -1),
            "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0, Selecao(q).ToList()),
            "selectunselect" => q.canFinish && q.choices.Count == 0
                ? duel.Respond("finishselect", 0)
                : duel.Respond("pick", q.choices[0].index),
            _ => duel.Respond("endturn", 0),
        };

        /// <summary>O mesmo arnês do `--test-fusion`, com a Fusão do builder no lugar da oficial.</summary>
        static ResultadoInvocacao JogarFusao(string sa, bool comCartas)
        {
            var res = new ResultadoInvocacao();
            var cartas = comCartas
                ? CartaCustom.Ler(Corpo(new
                {
                    id = FUSAO, nome = "Dragao de Fusao de Teste", type = 0x41, level = 7,
                    attribute = 0x8, race = 0x2000, atk = 2600, def = 2100, lua = LUA_FUSAO,
                }))
                : null;
            var deck = Enumerable.Repeat(POLY, 14)
                .Concat(Enumerable.Repeat(GAIA_KNIGHT, 13))
                .Concat(Enumerable.Repeat(CURSE_DRAGON, 13)).ToArray();

            foreach (ulong seed in new ulong[] { 2468, 7, 31337 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: false, npcDeck: null,
                                                     extra: new[] { FUSAO }, cartasCustom: cartas);
                var r = duel.Advance();
                int materiais = 0, idles = 0;

                for (int guard = 0; guard < 300 && !r.ended && !res.emCampo; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        if (code == FUSAO && loc == LOC_MZONE && de == LOC_EXTRA) res.emCampo = true;
                        if (loc == LOC_GRAVE && (code == GAIA_KNIGHT || code == CURSE_DRAGON)) materiais++;
                    }
                    if (res.emCampo) break;

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }
                    if (q.kind == "idle")
                    {
                        if (++idles > 12) break;
                        var poly = q.activatable.FirstOrDefault(a => a.code == POLY);
                        if (poly.code == POLY) { res.ativou = true; r = duel.Respond("activate", poly.index); continue; }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    r = Padrao(duel, q);
                }
                if (materiais >= 2) res.materiais = true;
                if (res.emCampo) break;
            }
            return res;
        }

        /// <summary>
        /// A Magia de Ritual do builder Invocando o Monstro de Ritual do builder,
        /// com Battle Ox (Nv4) de tributo — os dois Lua são os do gerador.
        /// </summary>
        static ResultadoInvocacao JogarRitual(string sa, bool comCartas)
        {
            var res = new ResultadoInvocacao();
            var cartas = comCartas
                ? CartaCustom.Ler(Corpo(
                    new
                    {
                        id = RITUAL, nome = "Guerreiro do Ritual de Teste", type = 0x81, level = 4,
                        attribute = 0x10, race = 0x1, atk = 1800, def = 1000, lua = LUA_RITUAL,
                    },
                    new
                    {
                        id = MAGIA_RITUAL, nome = "Ritual de Teste", type = 0x82, level = 0,
                        attribute = 0, race = 0, atk = 0, def = 0, lua = LUA_MAGIA_RITUAL,
                    }))
                : null;
            var deck = Enumerable.Repeat(MAGIA_RITUAL, 14)
                .Concat(Enumerable.Repeat(RITUAL, 13))
                .Concat(Enumerable.Repeat(OX, 13)).ToArray();

            foreach (ulong seed in new ulong[] { 2468, 7, 31337 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: false, npcDeck: null,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                int idles = 0;

                for (int guard = 0; guard < 300 && !r.ended && !res.emCampo; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        if (code == RITUAL && loc == LOC_MZONE && de == LOC_HAND) res.emCampo = true;
                        if (res.ativou && loc == LOC_GRAVE && de == LOC_HAND && (code == OX || code == RITUAL)) res.materiais = true;
                    }
                    if (res.emCampo) break;

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }
                    if (q.kind == "idle")
                    {
                        if (++idles > 12) break;
                        var magia = q.activatable.FirstOrDefault(a => a.code == MAGIA_RITUAL);
                        if (magia.code == MAGIA_RITUAL) { res.ativou = true; r = duel.Respond("activate", magia.index); continue; }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    r = Padrao(duel, q);
                }
                if (res.emCampo) break;
            }
            return res;
        }

        /// <summary>
        /// A Dragon's Inferno do builder, jogada com o Lua do gerador. Com ela ativa,
        /// Curse of Dragon (Normal Dragão Nv5) sai por Invocação-Normal SEM tributo
        /// com o campo vazio; com o Curse em campo o "destruir" passa a ser oferecido
        /// (um efeito a mais, no mesmo turno); a busca traz um Dragão Nv5/6 do
        /// Deck/Cemitério; o baixar põe 2 cartas de nomes diferentes na zona; e cada
        /// efeito conta sozinho.
        ///
        /// Os dois controles trocam UMA coisa no mesmo script: sem o alcance da mão,
        /// o Curse que a própria busca trouxe nunca fica invocável (então era o
        /// procedimento); com a conta dividida (`id`), usar um efeito apaga os outros
        /// (então era o `{id,n}`). Sem eles, "ficou invocável" e "os outros
        /// continuam" poderiam ser o motor deixando à toa.
        /// </summary>
        static void DragonsInferno(string sa)
        {
            Log.Info("\n-- Dragon's Inferno: sem tributo, condição, Deck/Cemitério, baixar --");
            var com = JogarInferno(sa, LUA_INFERNO,
                r => r.umaVezCada && r.destruiu && r.buscou && r.baixouDois && r.invocouSemTributo);
            Check("a Armadilha Contínua do builder foi ativada", com.ativou);
            Check("com ela ativa, Curse of Dragon (Nv5) ficou invocável com o campo vazio", com.invocavel);
            Check("e foi Invocado por Invocação-Normal sem tributo", com.invocouSemTributo);
            Check("o destruir só aparece com o Normal Dragão em campo (um efeito a mais depois da Invocação)",
                  com.antes >= 0 && com.depois == com.antes + 1, $"(antes={com.antes} depois={com.depois})");
            Check("destruiu 1 carta do oponente", com.destruiu);
            Check("descartou 1 e trouxe um Dragão Nv5/6 do Deck/Cemitério para a mão", com.buscou);
            Check("baixou 2 das cartas nomeadas", com.baixouDois);
            Check("e nunca duas com o mesmo nome", com.baixouDois && !com.repetiuNome);
            Check("usado um efeito, os outros continuam oferecidos (a conta é de cada um)",
                  com.mediuRestantes && com.outrosContinuam);
            Check("usados os três no turno, nenhum é oferecido de novo", com.umaVezCada);
            Check("nada ficou 'unsupported'", !com.unsupported);

            var semMao = JogarInferno(sa, LUA_INFERNO.Replace("e1:SetTargetRange(LOCATION_HAND,0)", "e1:SetTargetRange(0,0)"),
                                      r => r.idleDepoisDaBusca);
            Check("controle: sem o alcance da mão, o Curse que a busca trouxe nunca fica invocável",
                  semMao.idleDepoisDaBusca && !semMao.invocavel);

            var dividida = JogarInferno(sa, LUA_INFERNO.Replace("{id,2}", "id").Replace("{id,3}", "id").Replace("{id,4}", "id"),
                                        r => r.mediuRestantes);
            Check("controle: com a conta dividida (id), usado um efeito os outros somem",
                  dividida.mediuRestantes && !dividida.outrosContinuam);
        }

        sealed class ResultadoInferno
        {
            public bool ativou, invocavel, invocouSemTributo, destruiu, buscou, baixouDois, repetiuNome;
            public bool mediuRestantes, outrosContinuam, umaVezCada, idleDepoisDaBusca, unsupported;
            public int antes = -1, depois = -1;
        }

        /// <summary>
        /// Baixa a Inferno assim que der, ativa no turno seguinte e, com ela de pé,
        /// Invoca o Curse quando ele aparecer entre os invocáveis e usa os efeitos
        /// dela um a um. Cada efeito é reconhecido pelo que FEZ na resolução (a carta
        /// do oponente no Cemitério, o Dragão na mão, as cartas baixadas), porque os
        /// três chegam com o mesmo código e sem descrição.
        /// </summary>
        static ResultadoInferno JogarInferno(string sa, string lua, Func<ResultadoInferno, bool> pronto)
        {
            var res = new ResultadoInferno();
            var cartas = CartaCustom.Ler(Corpo(new
            {
                id = INFERNO, nome = "Dragon's Inferno", type = 0x20004, level = 0,
                attribute = 0, race = 0, atk = 0, def = 0, lua,
            }));
            var deck = Enumerable.Repeat(INFERNO, 12)
                .Concat(Enumerable.Repeat(CURSE_DRAGON, 14))
                .Concat(Enumerable.Repeat(STAMPING, 7))
                .Concat(Enumerable.Repeat(AVANCO, 7)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 99, 4242, 777 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                bool setou = false, ativando = false, resolvendo = false, invocando = false;
                int usosNoTurno = 0, idles = 0;
                var baixadas = new List<uint>();

                for (int guard = 0; guard < 900 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        byte deQuem = Convert.ToByte(t.GetProperty("fromCtrl")?.GetValue(e) ?? (byte)0);
                        // Lv5 com o campo vazio: sem o procedimento não haveria tributo possível.
                        if (invocando && code == CURSE_DRAGON && loc == LOC_MZONE && de == LOC_HAND) res.invocouSemTributo = true;
                        if (!resolvendo) continue;
                        bool doDeckOuCemiterio = de == LOC_DECK || de == LOC_GRAVE;
                        if (deQuem == 1 && loc == LOC_GRAVE && (de & LOC_ONFIELD) != 0) res.destruiu = true;
                        if (code == CURSE_DRAGON && loc == LOC_HAND && doDeckOuCemiterio) res.buscou = true;
                        if ((code == STAMPING || code == AVANCO) && loc == LOC_SZONE && doDeckOuCemiterio) baixadas.Add(code);
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        var infernos = q.activatable.Where(a => a.code == INFERNO).ToList();
                        if (ativando) { ativando = false; res.ativou = true; }
                        if (invocando) { invocando = false; if (res.invocouSemTributo) res.depois = infernos.Count; }
                        if (resolvendo)
                        {
                            resolvendo = false;
                            usosNoTurno++;
                            if (baixadas.Count >= 2) res.baixouDois = true;
                            if (baixadas.Distinct().Count() < baixadas.Count) res.repetiuNome = true;
                            baixadas.Clear();
                            if (!res.mediuRestantes) { res.mediuRestantes = true; res.outrosContinuam = infernos.Count > 0; }
                        }
                        if (res.buscou) res.idleDepoisDaBusca = true;
                        if (res.ativou && !res.invocouSemTributo && q.summonable.Any(a => a.code == CURSE_DRAGON)) res.invocavel = true;
                        if (pronto(res) || ++idles > 60) break;

                        if (!setou)
                        {
                            var baixar = q.settableST.FirstOrDefault(a => a.code == INFERNO);
                            if (baixar.code == INFERNO) { setou = true; r = duel.Respond("setspell", baixar.index); continue; }
                        }
                        else if (!res.ativou && infernos.Count > 0)
                        {
                            ativando = true;
                            r = duel.Respond("activate", infernos[0].index);
                            continue;
                        }
                        if (res.ativou)
                        {
                            var curse = q.summonable.FirstOrDefault(a => a.code == CURSE_DRAGON);
                            if (curse.code == CURSE_DRAGON && !res.invocouSemTributo)
                            {
                                res.antes = infernos.Count;
                                invocando = true;
                                r = duel.Respond("summon", curse.index);
                                continue;
                            }
                            if (infernos.Count > 0 && usosNoTurno < 6)
                            {
                                resolvendo = true;
                                r = duel.Respond("activate", infernos[0].index);
                                continue;
                            }
                            if (usosNoTurno >= 3 && infernos.Count == 0) res.umaVezCada = true;
                        }
                        if (pronto(res)) break;
                        usosNoTurno = 0;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    r = q.kind == "yesno" ? duel.Respond("yesno", 1) : Padrao(duel, q);
                }
                if (pronto(res)) break;
            }
            return res;
        }

        struct Resultado
        {
            public bool magiaAtivavel, comprou2, magiaNoCemiterio, monstroInvocavel, unsupported;
        }

        struct ResultadoDragias
        {
            public bool ativou, descartouDoisTipos, invocou, destruiu, atacouUmaVez, atacouDuasVezes, unsupported;
        }

        static IReadOnlyList<int> Selecao(InteractiveDuel.Question q) =>
            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList();

        static Resultado Jogar(string sa, uint[] deck, uint[] npc, CartaCustom[] cartas)
        {
            var res = new Resultado();
            foreach (ulong seed in new ulong[] { 7, 31337, 2024 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                bool esperandoCompra = false;
                int idles = 0;

                for (int guard = 0; guard < 200 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        if (tipo == "draw" && esperandoCompra)
                        {
                            int pl = Convert.ToInt32(t.GetProperty("player")?.GetValue(e) ?? -1);
                            int n = (t.GetProperty("cards")?.GetValue(e) as ICollection)?.Count ?? 0;
                            if (pl == 0 && n >= 2) res.comprou2 = true;
                        }
                        if (tipo == "move")
                        {
                            byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                            uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                            if (loc == LOC_GRAVE && code == MAGIA) res.magiaNoCemiterio = true;
                        }
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        if (++idles > 8) break;
                        if (q.summonable.Any(a => a.code == MONSTRO)) res.monstroInvocavel = true;
                        var pronta = q.activatable.FirstOrDefault(a => a.code == MAGIA);
                        if (pronta.code == MAGIA && !res.comprou2)
                        {
                            res.magiaAtivavel = true;
                            esperandoCompra = true;
                            r = duel.Respond("activate", pronta.index);
                            continue;
                        }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    r = q.kind switch
                    {
                        "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                        "position" => duel.Respond("position", 0x1),
                        "battle" => duel.Respond("endbattle", 0),
                        "chain" => duel.Respond("chain", -1),
                        "selectcard" or "selecttribute" => duel.Respond("select", 0, Selecao(q).ToList()),
                        _ => duel.Respond("endturn", 0),
                    };
                }
                if (res.comprou2 && res.magiaNoCemiterio && res.monstroInvocavel) break;
            }
            return res;
        }

        /// <summary>
        /// Joga a Dragias: ativa da mão sempre que o motor deixar (uma vez por
        /// turno), e no turno em que o "então destrua" resolveu vai para a Battle
        /// Phase atacando com ELA — a de zona conhecida, pela `sequence` do evento
        /// `move`. Contar qualquer atacante com o mesmo código daria "2 ataques"
        /// com duas Dragias diferentes em campo, e o teste passaria sem prova.
        /// </summary>
        static ResultadoDragias JogarDragias(string sa, string lua)
        {
            var res = new ResultadoDragias();
            var cartas = CartaCustom.Ler(Corpo(CartaDragias(lua)));
            var deck = Enumerable.Repeat(DRAGIAS, 14)
                .Concat(Enumerable.Repeat(OLHO, 13))
                .Concat(Enumerable.Repeat(LEOGUN, 13)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 99, 4242, 777 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                bool resolvendo = false, ativouNoTurno = false, destruiuNoTurno = false, batalhou = false;
                int zonaDaDragias = -1, ataquesDela = 0, idles = 0;
                var descartes = new HashSet<uint>();

                for (int guard = 0; guard < 800 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        if (!resolvendo) continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        int seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        if (loc == LOC_GRAVE && de == LOC_HAND && (code == OLHO || code == LEOGUN)) descartes.Add(code);
                        if (loc == LOC_MZONE && de == LOC_HAND && code == DRAGIAS)
                        {
                            res.invocou = true;
                            zonaDaDragias = seq;
                        }
                        if (loc == LOC_GRAVE && (de & LOC_ONFIELD) != 0)
                        {
                            res.destruiu = true;
                            destruiuNoTurno = true;
                        }
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        if (resolvendo)
                        {
                            resolvendo = false;
                            if (descartes.Count >= 2) res.descartouDoisTipos = true;
                        }
                        if (++idles > 40) break;

                        var pronta = q.activatable.FirstOrDefault(a => a.code == DRAGIAS);
                        if (pronta.code == DRAGIAS && !ativouNoTurno)
                        {
                            res.ativou = true;
                            resolvendo = true;
                            ativouNoTurno = true;
                            destruiuNoTurno = false;
                            descartes.Clear();
                            r = duel.Respond("activate", pronta.index);
                            continue;
                        }
                        if (q.canBattle && destruiuNoTurno && !batalhou)
                        {
                            batalhou = true;
                            ataquesDela = 0;
                            r = duel.Respond("battle", 0);
                            continue;
                        }
                        ativouNoTurno = false;
                        destruiuNoTurno = false;
                        batalhou = false;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    if (q.kind == "battle" && q.player == 0)
                    {
                        var ela = q.attackers.FirstOrDefault(a => a.code == DRAGIAS && a.sequence == zonaDaDragias);
                        if (ela.code == DRAGIAS)
                        {
                            ataquesDela++;
                            if (ataquesDela >= 1) res.atacouUmaVez = true;
                            if (ataquesDela >= 2) res.atacouDuasVezes = true;
                            r = duel.Respond("attack", ela.index);
                            continue;
                        }
                        r = duel.Respond("endbattle", 0);
                        continue;
                    }

                    r = q.kind switch
                    {
                        "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                        "position" => duel.Respond("position", 0x1),
                        "battle" => duel.Respond("endbattle", 0),
                        "chain" => duel.Respond("chain", -1),
                        "yesno" => duel.Respond("yesno", 0),
                        "option" => duel.Respond("option", 0),
                        "selectcard" or "selecttribute" => duel.Respond("select", 0, Selecao(q).ToList()),
                        _ => duel.Respond("endturn", 0),
                    };
                    if (res.atacouDuasVezes) break;
                }
                if (res.atacouDuasVezes) break;
                if (res.atacouUmaVez && batalhou && lua.Contains("e1:SetValue(0)")) break;
            }
            return res;
        }
    }
}
