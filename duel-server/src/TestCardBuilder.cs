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

        // ------------------------------------------------------- Max Rider
        // A carta do usuário, com os ids REAIS do banco: provar a carta que ele
        // joga vale mais que provar uma de laboratório, e foi esta que falhou
        // num duelo de verdade.
        const uint MAX_RIDER = 950000003; // Nv7 2400/1400 TERRA Guerreiro, tratado como NORMAL
        const uint REVENGE = 950000004;   // a Armadilha Contínua que ela baixa

        /// <summary>A saída de `gerarLua` para a Max Rider de `cardbuilder.test.mjs`.</summary>
        const string LUA_MAX_RIDER =
@"--Max Rider
--Classic Duels · Card Builder · Monstro de Efeito
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--da mão (efeito rápido, a qualquer momento): Invocação-Normal com menos tributo
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_QUICK_O)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetRange(LOCATION_HAND)
	e1:SetCountLimit(1,{id,1})
	e1:SetCost(Cost.SelfDiscard)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
	--quando um monstro seu deixa o campo por carta do oponente: Invocação-Especial (esta carta)
	local e2=Effect.CreateEffect(c)
	e2:SetCategory(CATEGORY_SPECIAL_SUMMON)
	e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
	e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)
	e2:SetCode(EVENT_LEAVE_FIELD)
	e2:SetRange(LOCATION_GRAVE)
	e2:SetCountLimit(1,{id,2})
	e2:SetCondition(s.condicao2)
	e2:SetTarget(s.alvo2)
	e2:SetOperation(s.operacao2)
	c:RegisterEffect(e2)
end
function s.filtro1(e,c)
	return c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsLevelAbove(5) and c:IsLevelBelow(6) and c:IsAttackBelow(1900)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_DECREASE_TRIBUTE)
	e1:SetTargetRange(LOCATION_HAND,0)
	e1:SetTarget(s.filtro1)
	e1:SetValue(0x1)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
end
function s.saiu2(c,tp)
	return c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp)
		and (c:IsReason(REASON_BATTLE) or (c:IsReason(REASON_EFFECT) and c:GetReasonPlayer()~=tp))
		and (c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsLevelAbove(5) and c:IsLevelBelow(6) and c:IsAttackBelow(1900))
end
function s.condicao2(e,tp,eg,ep,ev,re,r,rp)
	return eg:IsExists(s.saiu2,1,nil,tp)
end
function s.passo2_1(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) or Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return false end
	return Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0
end
function s.filtro2_2(c)
	return (c:IsCode(950000004)) and c:IsSSetable()
end
function s.passo2_2(e,tp,eg,ep,ev,re,r,rp)
	local ft=math.min(1,(Duel.GetLocationCount(tp,LOCATION_SZONE)))
	if ft<=0 then return false end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
	local sg=Duel.SelectMatchingCard(tp,s.filtro2_2,tp,LOCATION_DECK|LOCATION_HAND|LOCATION_GRAVE,0,1,ft,e:GetHandler())
	if #sg==0 or Duel.SSet(tp,sg)==0 then return false end
	for tc in aux.Next(sg) do
		local ea=Effect.CreateEffect(e:GetHandler())
		ea:SetType(EFFECT_TYPE_SINGLE)
		ea:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)
		ea:SetProperty(EFFECT_FLAG_SET_AVAILABLE)
		ea:SetReset(RESET_EVENT|RESETS_STANDARD)
		tc:RegisterEffect(ea)
		local eb=ea:Clone()
		eb:SetCode(EFFECT_QP_ACT_IN_SET_TURN)
		tc:RegisterEffect(eb)
	end
	return true
end
function s.alvo2(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and e:GetHandler():IsCanBeSpecialSummoned(e,0,tp,false,false) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)
end
function s.operacao2(e,tp,eg,ep,ev,re,r,rp)
	if not s.passo2_1(e,tp,eg,ep,ev,re,r,rp) then return end
	Duel.BreakEffect()
	s.passo2_2(e,tp,eg,ep,ev,re,r,rp)
end
";

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
	local ft=math.min(2,(Duel.GetLocationCount(tp,LOCATION_SZONE)))
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
            MaxRider(sa);
            Sorcerer(sa);
            ShinyMedicine(sa);
            EvilDragon(sa);
            EvilKnight(sa);
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

        /// <summary>
        /// A Revenge MAX aqui é só o ALVO do baixar: o que se prova é que a Max
        /// Rider a encontra **pelo id**. O Lua é a ativação mínima de uma Contínua
        /// — os efeitos dela têm prova própria, à parte.
        /// </summary>
        const string LUA_REVENGE_MINIMA =
@"--Revenge MAX (mínima: só a ativação que a deixa na zona)
local s,id=GetID()
function s.initial_effect(c)
	local e0=Effect.CreateEffect(c)
	e0:SetType(EFFECT_TYPE_ACTIVATE)
	e0:SetCode(EVENT_FREE_CHAIN)
	c:RegisterEffect(e0)
end
";

        // ------------------------------------------------------- Max Rider
        static void MaxRider(string sa)
        {
            Log.Info("\n-- Max Rider: efeito rápido da mão, desconto de tributo, gatilho do Cemitério --");
            var com = JogarMaxRider(sa, LUA_MAX_RIDER, true, r => r.baixouRevenge);
            Check("o efeito RÁPIDO é oferecido com a carta na MÃO", com.ofertaNaMao);
            Check("descartada como custo, ela foi para o Cemitério", com.foiAoCemiterio);
            Check("com o desconto, o Normal Nv5 ficou invocável com o campo VAZIO", com.invocavelSemTributo);
            Check("e foi Invocado por Invocação-Normal sem oferecer tributo", com.invocouSemTributo);
            Check("o Normal saindo do campo PELO OPONENTE acordou a carta no Cemitério", com.gatilhou);
            Check("ela se Invocou por Invocação-Especial do Cemitério", com.invocouDoCemiterio);
            Check("nada ficou 'unsupported'", !com.unsupported);

            // O "então baixe" ACONTECE, também quando o gatilho vem de uma batalha.
            //
            // Até 26/09/2026 esta seção afirmava o contrário, como "regra do jogo":
            // na Etapa de Dano não se baixaria carta. Estava errado, e a medida que
            // o sustentava (forçar `ft=1` fazia baixar) apontava para a causa real
            // sem que se percebesse: `Duel.GetLocationCount` devolve DOIS valores
            // nesta dll, e como último argumento do `math.min` os dois entravam na
            // conta — o segundo vale 0 com a zona de Magia/Armadilha vazia. O `ft`
            // saía 0 e o passo não fazia nada, calado. O gerador passou a escrever
            // `(Duel.GetLocationCount(...))`, que corta para um valor só.
            //
            // O CONTROLE é a linha antiga, sem os parênteses: ela não baixa.
            var semParenteses = JogarMaxRider(sa,
                LUA_MAX_RIDER.Replace("math.min(1,(Duel.GetLocationCount(tp,LOCATION_SZONE)))",
                                      "math.min(1,Duel.GetLocationCount(tp,LOCATION_SZONE))"),
                true, r => r.baixouRevenge);
            Check("então baixou a Revenge MAX — mesmo com o gatilho vindo de uma batalha",
                  com.invocouDoCemiterio && com.baixouRevenge);
            Check("controle: sem os parênteses em volta do GetLocationCount, o baixar não acontece",
                  semParenteses.invocouDoCemiterio && !semParenteses.baixouRevenge,
                  $"(invocou={semParenteses.invocouDoCemiterio} baixou={semParenteses.baixouRevenge})");

            // CONTROLES. Sem eles, um efeito que não fizesse NADA passaria em tudo
            // acima: a carta Nv5 poderia estar invocável por outro motivo, e o
            // gatilho poderia estar disparando para qualquer monstro.
            var sem = JogarMaxRider(sa, LUA_MAX_RIDER, false, r => r.mediuSemDesconto);
            Check("controle: sem ativar o efeito, o Normal Nv5 NÃO é invocável com o campo vazio",
                  sem.mediuSemDesconto && !sem.invocavelSemTributo);

            var doOutroLado = JogarMaxRider(sa,
                LUA_MAX_RIDER.Replace("c:IsPreviousControler(tp)", "c:IsPreviousControler(1-tp)"),
                true, r => r.mediuGatilho);
            Check("controle: pedindo que o monstro fosse DELE, o gatilho não acorda",
                  doOutroLado.mediuGatilho && !doOutroLado.gatilhou);
        }

        /// <summary>Liga o despejo das perguntas do motor depois que o monstro sai
        /// do campo — é como se descobre o que ele está (ou não) oferecendo.</summary>
        static readonly bool DIAG = Environment.GetEnvironmentVariable("CB_DIAG") == "1";

        sealed class ResultadoMaxRider
        {
            public bool ofertaNaMao, foiAoCemiterio, invocavelSemTributo, invocouSemTributo;
            public bool gatilhou, invocouDoCemiterio, baixouRevenge, unsupported;
            public bool mediuSemDesconto, mediuGatilho;
        }

        /// <summary>
        /// O duelo que reproduz o combo: ativa o efeito rápido DA MÃO (o custo a
        /// manda ao Cemitério), Invoca o Normal Nv5 que o desconto destravou, passa
        /// o turno, e deixa o Battle Ox do NPC (1700) atropelar o Nv5 (1500) — é
        /// essa saída de campo, causada pelo OPONENTE, que acorda a carta lá do
        /// Cemitério para se Invocar e baixar a Revenge MAX.
        ///
        /// Nada aqui é decidido por dedução: cada peça é reconhecida pelo MOVIMENTO
        /// que o motor emitiu (de onde para onde foi cada carta).
        /// </summary>
        static ResultadoMaxRider JogarMaxRider(string sa, string lua, bool usarEfeito, Func<ResultadoMaxRider, bool> pronto)
        {
            var res = new ResultadoMaxRider();
            var cartas = CartaCustom.Ler(Corpo(
                new { id = MAX_RIDER, nome = "Max Rider", type = 0x31, level = 7, attribute = 0x1, race = 0x1, atk = 2400, def = 1400, lua },
                new { id = REVENGE, nome = "Revenge MAX", type = 0x20004, level = 0, attribute = 0, race = 0, atk = 0, def = 0, lua = LUA_REVENGE_MINIMA }));
            var deck = Enumerable.Repeat(MAX_RIDER, 12)
                .Concat(Enumerable.Repeat(OLHO, 16))
                .Concat(Enumerable.Repeat(REVENGE, 12)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 11, 404, 2718, 31337, 7, 99 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                bool usou = false, invocou = false, invocando = false;
                int idles = 0;

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

                        if (code == MAX_RIDER && loc == LOC_GRAVE && de == LOC_HAND) res.foiAoCemiterio = true;
                        if (invocando && code == OLHO && loc == LOC_MZONE && de == LOC_HAND) res.invocouSemTributo = true;
                        // O MEU Normal deixando o campo: é o que o gatilho espera.
                        if (code == OLHO && deQuem == 0 && (de & LOC_MZONE) != 0 && loc == LOC_GRAVE) res.mediuGatilho = true;
                        if (code == MAX_RIDER && loc == LOC_MZONE && de == LOC_GRAVE) res.invocouDoCemiterio = true;
                        if (code == REVENGE && loc == LOC_SZONE
                            && (de == LOC_DECK || de == LOC_HAND || de == LOC_GRAVE)) res.baixouRevenge = true;
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    if (DIAG && res.mediuGatilho)
                        Log.Info($"  [diag] pergunta={q.kind} p={q.player} ativaveis=[{string.Join(",", q.activatable.Select(a => a.code))}]");

                    // O gatilho OPCIONAL não chega como janela de corrente: o motor
                    // pergunta "quer ativar?" (`yesno`). E a ação é `yesno` — um
                    // `yes` é recusado e a MESMA pergunta volta, em laço.
                    if (q.kind == "yesno")
                    {
                        if (res.mediuGatilho) res.gatilhou = true;
                        r = duel.Respond("yesno", 1);
                        continue;
                    }

                    if (q.kind == "chain")
                    {
                        var meu = q.activatable.FirstOrDefault(a => a.code == MAX_RIDER);
                        if (meu.code == MAX_RIDER) { res.gatilhou = true; r = duel.Respond("chain", meu.index); continue; }
                        r = duel.Respond("chain", -1);
                        continue;
                    }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        res.mediuSemDesconto = true;
                        invocando = false;
                        var nv5 = q.summonable.FirstOrDefault(a => a.code == OLHO);
                        // Nv5 com o campo vazio: sem o desconto não há tributo possível.
                        if (!invocou && nv5.code == OLHO) res.invocavelSemTributo = true;
                        if (pronto(res) || ++idles > 40) break;

                        if (usarEfeito && !usou)
                        {
                            var rider = q.activatable.FirstOrDefault(a => a.code == MAX_RIDER);
                            if (rider.code == MAX_RIDER)
                            {
                                res.ofertaNaMao = true;
                                usou = true;
                                r = duel.Respond("activate", rider.index);
                                continue;
                            }
                        }
                        if (!invocou && nv5.code == OLHO)
                        {
                            invocou = true;
                            invocando = true;
                            r = duel.Respond("summon", nv5.index);
                            continue;
                        }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    r = Padrao(duel, q);
                }
                if (pronto(res)) break;
            }
            return res;
        }

        // ------------------------------------------ Dark Eradicator Sorcerer
        const uint SORCERER = 950000005;  // o boss de Dark Magician do usuário (id REAL do banco)
        const uint ANCIENT = 36821538;    // Ancient Sorcerer — Mago de TREVAS Normal Nv4 1000/1300
        const uint YAMI = 59197169;       // Yami — Magia de Campo: a "Magia com a face para cima"
        const uint KNIVES = 63391643;     // Thousand Knives — uma Magia que LISTA o Dark Magician
        const uint WARLOCK = 29436665;    // Dark Eradicator Warlock — o que ela busca ao sair

        /// <summary>A saída de `gerarLua` para o Dark Eradicator Sorcerer de `cardbuilder.test.mjs`.</summary>
        const string LUA_SORCERER =
@"--Dark Eradicator Sorcerer
--Classic Duels · Card Builder · Monstro de Efeito
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--Invocação-Especial própria: sai da mão pagando o preço abaixo
	local ei=Effect.CreateEffect(c)
	ei:SetType(EFFECT_TYPE_FIELD)
	ei:SetCode(EFFECT_SPSUMMON_PROC)
	ei:SetProperty(EFFECT_FLAG_UNCOPYABLE)
	ei:SetRange(LOCATION_HAND)
	ei:SetCountLimit(1,{id,9},EFFECT_COUNT_CODE_OATH)
	ei:SetCondition(s.invcon)
	ei:SetOperation(s.invop)
	ei:SetValue(1)
	c:RegisterEffect(ei)
	--então destrua (depois de entrar pelo procedimento acima)
	local ed=Effect.CreateEffect(c)
	ed:SetCategory(CATEGORY_DESTROY)
	ed:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)
	ed:SetCode(EVENT_SPSUMMON_SUCCESS)
	ed:SetCondition(s.invdcon)
	ed:SetTarget(s.invdtg)
	ed:SetOperation(s.invdop)
	c:RegisterEffect(ed)
	--contínuo (enquanto estiver em campo): não pode ser alvo de efeitos do oponente (esta carta)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
	e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
	e1:SetRange(LOCATION_MZONE)
	e1:SetValue(aux.tgoval)
	c:RegisterEffect(e1)
	--da mão (Main Phase): ganhar o nome de outra carta (neste turno) (esta carta)
	local e2=Effect.CreateEffect(c)
	e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
	e2:SetType(EFFECT_TYPE_IGNITION)
	e2:SetRange(LOCATION_HAND)
	e2:SetCountLimit(1,{id,2})
	e2:SetCost(Cost.SelfReveal)
	e2:SetTarget(s.alvo2)
	e2:SetOperation(s.operacao2)
	c:RegisterEffect(e2)
	--quando ESTA carta deixa o campo por carta do oponente: adicionar à mão (outra carta)
	local e3=Effect.CreateEffect(c)
	e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
	e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
	e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)
	e3:SetCode(EVENT_LEAVE_FIELD)
	e3:SetCountLimit(1,{id,3})
	e3:SetCondition(s.condicao3)
	e3:SetTarget(s.alvo3)
	e3:SetOperation(s.operacao3)
	c:RegisterEffect(e3)
end
function s.invcusto(c)
	return (c:IsType(TYPE_MONSTER) and c:IsCode(46986414)) and c:IsAbleToGrave()
end
function s.invdestruir1(c)
	return (c:IsType(TYPE_MONSTER) and c:IsRace(RACE_SPELLCASTER) and c:IsAttribute(ATTRIBUTE_DARK)) and c:IsFaceup()
end
function s.invdestruir2(c)
	return (c:IsType(TYPE_SPELL)) and c:IsFaceup()
end
function s.invcon(e,c)
	if c==nil then return true end
	local tp=c:GetControler()
	return Duel.IsExistingMatchingCard(s.invcusto,tp,LOCATION_HAND|LOCATION_DECK,0,1,c)
		and Duel.IsExistingMatchingCard(s.invdestruir1,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)
		and Duel.IsExistingMatchingCard(s.invdestruir2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)
end
function s.invop(e,tp,eg,ep,ev,re,r,rp,c)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
	local g=Duel.SelectMatchingCard(tp,s.invcusto,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,c)
	Duel.SendtoGrave(g,REASON_COST)
end
function s.invdcon(e,tp,eg,ep,ev,re,r,rp)
	return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1
end
function s.invdtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,2,PLAYER_ALL,LOCATION_ONFIELD)
end
function s.invdop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local dg=Group.CreateGroup()
	local fora=Group.FromCards(c)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g1=Duel.SelectMatchingCard(tp,s.invdestruir1,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,fora)
	dg:Merge(g1)
	fora:Merge(g1)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g2=Duel.SelectMatchingCard(tp,s.invdestruir2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,fora)
	dg:Merge(g2)
	fora:Merge(g2)
	if #dg>0 then Duel.Destroy(dg,REASON_EFFECT) end
end
function s.passo2_1(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) then return false end
	local en=Effect.CreateEffect(c)
	en:SetType(EFFECT_TYPE_SINGLE)
	en:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
	en:SetCode(EFFECT_ADD_CODE)
	en:SetValue(46986414)
	en:SetReset(RESETS_STANDARD_PHASE_END)
	c:RegisterEffect(en)
	return true
end
function s.filtro2_2(c)
	return (c:IsType(TYPE_SPELL) and c:ListsCode(46986414)) and c:IsAbleToHand()
end
function s.passo2_2(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,s.filtro2_2,tp,LOCATION_DECK,0,1,1,nil)
	if #g==0 or Duel.SendtoHand(g,nil,REASON_EFFECT)==0 then return false end
	Duel.ConfirmCards(1-tp,g)
	return true
end
function s.alvo2(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
end
function s.operacao2(e,tp,eg,ep,ev,re,r,rp)
	if not s.passo2_1(e,tp,eg,ep,ev,re,r,rp) then return end
	Duel.BreakEffect()
	s.passo2_2(e,tp,eg,ep,ev,re,r,rp)
end
function s.condicao3(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	return c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp)
		and (c:IsReason(REASON_BATTLE) or (c:IsReason(REASON_EFFECT) and c:GetReasonPlayer()~=tp))
end
function s.filtro3(c)
	return (c:IsType(TYPE_MONSTER) and c:IsCode(29436665)) and c:IsAbleToHand()
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
";

        static void Sorcerer(string sa)
        {
            Log.Info("\n-- Dark Eradicator Sorcerer: revelar e ganhar o nome, entrar pelo procedimento, buscar ao sair --");
            var com = JogarSorcerer(sa, LUA_SORCERER, true, r => r.buscouWarlock);
            Check("revelada, ela buscou a Magia que LISTA o Dark Magician (Thousand Knives)", com.buscouFacas);
            Check("antes de revelar, nenhuma cópia entrava pelo procedimento (não havia Dark Magician)",
                  com.mediuAntes && !com.ofertadoAntes);
            Check("revelada, a cópia na MÃO virou um 'Dark Magician' — e a OUTRA ficou invocável", com.ofertadoDepois);
            Check("o procedimento pagou com a revelada: ela foi da mão ao Cemitério", com.pagouComARevelada);
            Check("e a outra entrou em campo pelo procedimento", com.entrou);
            Check("ENTÃO destruiu o Mago de TREVAS em campo", com.destruiuMago);
            Check("e a Magia com a face para cima", com.destruiuMagia);
            Check("sem se oferecer à própria destruição (ela também é um Mago de TREVAS em campo)",
                  com.entrou && !com.seDestruiu);
            Check("destruída pelo oponente, buscou o Dark Eradicator Warlock", com.buscouWarlock);
            Check("nada ficou 'unsupported'", !com.unsupported);

            // CONTROLE. A escolha do usuário foi "só pode invocar se puder destruir
            // os dois": sem a Magia com a face para cima, o nome ganho não basta.
            // Sem este par, uma condição que ignorasse o campo passaria em tudo acima.
            var sem = JogarSorcerer(sa, LUA_SORCERER, false, r => r.revelou && r.mediuDepois);
            Check("controle: sem Magia com a face para cima em campo, revelar não basta — ela não entra",
                  sem.revelou && sem.mediuDepois && !sem.ofertadoDepois);
        }

        sealed class ResultadoSorcerer
        {
            public bool buscouFacas, mediuAntes, ofertadoAntes, revelou, mediuDepois, ofertadoDepois;
            public bool pagouComARevelada, entrou, destruiuMago, destruiuMagia, seDestruiu, buscouWarlock, unsupported;
        }

        /// <summary>
        /// O combo que o usuário desenhou, jogado de verdade: a Yami em campo (a
        /// Magia com a face para cima), o Ancient Sorcerer invocado (o Mago de
        /// TREVAS), uma cópia REVELADA — que vira "Dark Magician" na mão e busca a
        /// Thousand Knives — e a OUTRA entrando pelo procedimento, pagando com a
        /// revelada. O deck não tem Dark Magician nenhum: se a Invocação acontece,
        /// foi o nome ganho que pagou.
        ///
        /// Os números da carta aqui são de TESTE (ATK 1000): é para o Battle Ox do
        /// NPC (1700) a destruir em batalha e acordar o 3º efeito. O Lua é o da
        /// carta de verdade — número nenhum entra nele.
        /// </summary>
        static ResultadoSorcerer JogarSorcerer(string sa, string lua, bool usarYami, Func<ResultadoSorcerer, bool> pronto)
        {
            var res = new ResultadoSorcerer();
            var cartas = CartaCustom.Ler(Corpo(new
            {
                id = SORCERER, nome = "Dark Eradicator Sorcerer", type = 0x21, level = 7,
                attribute = 0x20, race = 0x2, atk = 1000, def = 1000, lua,
            }));
            var deck = Enumerable.Repeat(SORCERER, 16)
                .Concat(Enumerable.Repeat(ANCIENT, 8))
                .Concat(Enumerable.Repeat(YAMI, 8))
                .Concat(Enumerable.Repeat(KNIVES, 4))
                .Concat(Enumerable.Repeat(WARLOCK, 4)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 3, 17, 404, 2718, 31337, 7, 99, 123, 555, 8080, 42, 1001 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                bool yamiNoCampo = false, magoNoCampo = false, invoqueiNoTurno = false;
                bool revelouNoTurno = false, depoisDoCombo = false;
                int idles = 0;

                for (int guard = 0; guard < 1500 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);

                        if (code == YAMI && (loc & LOC_SZONE) != 0 && de == LOC_HAND) yamiNoCampo = true;
                        if (code == YAMI && (de & LOC_SZONE) != 0 && loc == LOC_GRAVE)
                        {
                            yamiNoCampo = false;
                            if (res.entrou) res.destruiuMagia = true;
                        }
                        if (code == ANCIENT && loc == LOC_MZONE && de == LOC_HAND) magoNoCampo = true;
                        if (code == ANCIENT && (de & LOC_MZONE) != 0 && loc == LOC_GRAVE)
                        {
                            magoNoCampo = false;
                            if (res.entrou && !depoisDoCombo) res.destruiuMago = true;
                        }
                        if (res.revelou && code == KNIVES && loc == LOC_HAND && de == LOC_DECK) res.buscouFacas = true;
                        if (revelouNoTurno && code == SORCERER && loc == LOC_GRAVE && de == LOC_HAND) res.pagouComARevelada = true;
                        if (res.pagouComARevelada && code == SORCERER && loc == LOC_MZONE && de == LOC_HAND) res.entrou = true;
                        if (res.entrou && !depoisDoCombo && code == SORCERER && (de & LOC_MZONE) != 0 && loc == LOC_GRAVE)
                            res.seDestruiu = true;
                        if (depoisDoCombo && code == WARLOCK && loc == LOC_HAND && (de == LOC_DECK || de == LOC_GRAVE))
                            res.buscouWarlock = true;
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }
                    // O 3º efeito é OPCIONAL: chega como `yesno` (e a ação é `yesno`).
                    if (q.kind == "yesno") { r = duel.Respond("yesno", 1); continue; }
                    if (q.kind == "chain") { r = duel.Respond("chain", -1); continue; }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        if (pronto(res) || ++idles > 60) break;
                        // Cada cópia na mão oferece o revelar — é assim que se conta a mão.
                        int naMao = q.activatable.Count(a => a.code == SORCERER);

                        // A Yami primeiro, assim que aparecer: ela fica em campo.
                        if (usarYami && !yamiNoCampo)
                        {
                            var yami = q.activatable.FirstOrDefault(a => a.code == YAMI);
                            if (yami.code == YAMI) { r = duel.Respond("activate", yami.index); continue; }
                        }
                        bool combo = !depoisDoCombo && naMao >= 2 && (yamiNoCampo || !usarYami);
                        // O Mago de TREVAS só entra no turno do combo: antes, o Battle Ox o atropela.
                        if (combo && !magoNoCampo && !invoqueiNoTurno)
                        {
                            var anc = q.summonable.FirstOrDefault(a => a.code == ANCIENT);
                            if (anc.code == ANCIENT) { invoqueiNoTurno = true; r = duel.Respond("summon", anc.index); continue; }
                        }
                        if (combo && magoNoCampo && !revelouNoTurno)
                        {
                            // Medido ANTES de revelar: sem Dark Magician, ninguém entra.
                            res.mediuAntes = true;
                            if (q.spSummonable.Any(a => a.code == SORCERER)) res.ofertadoAntes = true;
                            var rev = q.activatable.First(a => a.code == SORCERER);
                            revelouNoTurno = true;
                            res.revelou = true;
                            r = duel.Respond("activate", rev.index);
                            continue;
                        }
                        if (revelouNoTurno && !res.entrou)
                        {
                            res.mediuDepois = true;
                            var sp = q.spSummonable.FirstOrDefault(a => a.code == SORCERER);
                            if (sp.code == SORCERER) { res.ofertadoDepois = true; r = duel.Respond("spsummon", sp.index); continue; }
                        }
                        if (res.entrou) depoisDoCombo = true;
                        invoqueiNoTurno = false;
                        revelouNoTurno = false;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    r = Padrao(duel, q);
                }
                if (pronto(res)) break;
            }
            return res;
        }

        // ---------------------------------------------------- Shiny Medicine
        const uint SHINY = 950000006;     // a Armadilha Normal do usuário (id REAL do banco)
        const uint RED = 38199696;        // Red Medicine — Magia Normal, ganha 500 LP
        const uint BLUE = 20871001;       // Blue Medicine — Magia Normal, ganha 400 LP
        const uint ELFA = 15025844;       // Mystical Elf — Normal Nv4 800/2000: bate no Battle Ox e perde
        const byte LOC_REMOVED = 0x20;

        /// <summary>A saída de `gerarLua` para a Shiny Medicine de `cardbuilder.test.mjs`.</summary>
        const string LUA_SHINY =
@"--Shiny Medicine
--Classic Duels · Card Builder · Armadilha Normal
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--ao ativar a carta: você não sofre dano neste turno
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetCountLimit(1,{id,1},EFFECT_COUNT_CODE_OATH)
	e1:SetCost(s.custo1)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
	--quando você ativa estas cartas (com esta no Cemitério): adicionar à mão (esta carta)
	local e2=Effect.CreateEffect(c)
	e2:SetCategory(CATEGORY_TOHAND)
	e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
	e2:SetProperty(EFFECT_FLAG_DELAY)
	e2:SetCode(EVENT_CHAINING)
	e2:SetRange(LOCATION_GRAVE)
	e2:SetCountLimit(1,{id,2})
	e2:SetCondition(s.condicao2)
	e2:SetTarget(s.alvo2)
	e2:SetOperation(s.operacao2)
	c:RegisterEffect(e2)
	--registro: o que você ativa enquanto esta carta está no Cemitério
	local e2r=Effect.CreateEffect(c)
	e2r:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e2r:SetCode(EVENT_CHAINING)
	e2r:SetRange(LOCATION_GRAVE)
	e2r:SetOperation(s.registro2)
	c:RegisterEffect(e2r)
	--do Cemitério (Main Phase): adicionar à mão (outra carta)
	local e3=Effect.CreateEffect(c)
	e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
	e3:SetType(EFFECT_TYPE_IGNITION)
	e3:SetRange(LOCATION_GRAVE)
	e3:SetCountLimit(1,{id,3})
	e3:SetCost(Cost.SelfBanish)
	e3:SetTarget(s.alvo3)
	e3:SetOperation(s.operacao3)
	c:RegisterEffect(e3)
end
function s.custocada1_1(c)
	return (c:IsType(TYPE_SPELL) and c:IsCode(38199696)) and c:IsAbleToGraveAsCost()
end
function s.custocada1_2(c)
	return (c:IsType(TYPE_SPELL) and c:IsCode(20871001)) and c:IsAbleToGraveAsCost()
end
s.custocada1={s.custocada1_1,s.custocada1_2}
function s.custocada1_resta(tp,sg,ex,i)
	if i>#s.custocada1 then return true end
	local g=Duel.GetMatchingGroup(s.custocada1[i],tp,LOCATION_HAND|LOCATION_DECK,0,sg)
	if ex then g:RemoveCard(ex) end
	local tc=g:GetFirst()
	while tc do
		sg:AddCard(tc)
		local ok=s.custocada1_resta(tp,sg,ex,i+1)
		sg:RemoveCard(tc)
		if ok then return true end
		tc=g:GetNext()
	end
	return false
end
function s.custocada1_escolhe(tp,ex,hint)
	local sg=Group.CreateGroup()
	for i=1,#s.custocada1 do
		local g=Duel.GetMatchingGroup(s.custocada1[i],tp,LOCATION_HAND|LOCATION_DECK,0,sg)
		if ex then g:RemoveCard(ex) end
		g=g:Filter(function(c)
			sg:AddCard(c)
			local ok=s.custocada1_resta(tp,sg,ex,i+1)
			sg:RemoveCard(c)
			return ok
		end,nil)
		if #g==0 then return Group.CreateGroup() end
		Duel.Hint(HINT_SELECTMSG,tp,hint)
		sg:Merge(g:Select(tp,1,1,nil))
	end
	return sg
end
function s.custo1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return s.custocada1_resta(tp,Group.CreateGroup(),e:GetHandler(),1) end
	local sg=s.custocada1_escolhe(tp,e:GetHandler(),HINTMSG_TOGRAVE)
	Duel.SendtoGrave(sg,REASON_COST)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_CHANGE_DAMAGE)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e1:SetTargetRange(1,0)
	e1:SetValue(0)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
	local e2=e1:Clone()
	e2:SetCode(EFFECT_NO_EFFECT_DAMAGE)
	e2:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e2,tp)
end
function s.ativou2_1(c)
	return c:IsType(TYPE_SPELL) and c:IsCode(38199696)
end
function s.ativou2_2(c)
	return c:IsType(TYPE_SPELL) and c:IsCode(20871001)
end
s.ativou2={s.ativou2_1,s.ativou2_2}
function s.registro2(e,tp,eg,ep,ev,re,r,rp)
	if rp~=tp or not (re:IsHasType(EFFECT_TYPE_ACTIVATE) or re:IsActiveType(TYPE_MONSTER)) then return end
	local c=e:GetHandler()
	local rc=re:GetHandler()
	for i=1,#s.ativou2 do
		if s.ativou2[i](rc) then c:RegisterFlagEffect(id+200+i,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_END,0,1) end
	end
end
function s.condicao2(e,tp,eg,ep,ev,re,r,rp)
	if rp~=tp or not (re:IsHasType(EFFECT_TYPE_ACTIVATE) or re:IsActiveType(TYPE_MONSTER)) or #s.ativou2==0 then return false end
	local c=e:GetHandler()
	local rc=re:GetHandler()
	local agora=false
	for i=1,#s.ativou2 do
		if s.ativou2[i](rc) then agora=true
		elseif c:GetFlagEffect(id+200+i)==0 then return false end
	end
	return agora
end
function s.alvo2(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	if chk==0 then return c:IsAbleToHand() end
	Duel.SetOperationInfo(0,CATEGORY_TOHAND,c,1,0,0)
end
function s.operacao2(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) then
		Duel.SendtoHand(c,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,c)
	end
end
function s.cada3_1(c)
	return (c:IsType(TYPE_SPELL) and c:IsCode(38199696)) and c:IsAbleToHand()
end
function s.cada3_2(c)
	return (c:IsType(TYPE_SPELL) and c:IsCode(20871001)) and c:IsAbleToHand()
end
s.cada3={s.cada3_1,s.cada3_2}
function s.cada3_resta(tp,sg,ex,i)
	if i>#s.cada3 then return true end
	local g=Duel.GetMatchingGroup(s.cada3[i],tp,LOCATION_DECK|LOCATION_GRAVE,0,sg)
	if ex then g:RemoveCard(ex) end
	local tc=g:GetFirst()
	while tc do
		sg:AddCard(tc)
		local ok=s.cada3_resta(tp,sg,ex,i+1)
		sg:RemoveCard(tc)
		if ok then return true end
		tc=g:GetNext()
	end
	return false
end
function s.cada3_escolhe(tp,ex,hint)
	local sg=Group.CreateGroup()
	for i=1,#s.cada3 do
		local g=Duel.GetMatchingGroup(s.cada3[i],tp,LOCATION_DECK|LOCATION_GRAVE,0,sg)
		if ex then g:RemoveCard(ex) end
		g=g:Filter(function(c)
			sg:AddCard(c)
			local ok=s.cada3_resta(tp,sg,ex,i+1)
			sg:RemoveCard(c)
			return ok
		end,nil)
		if #g==0 then return Group.CreateGroup() end
		Duel.Hint(HINT_SELECTMSG,tp,hint)
		sg:Merge(g:Select(tp,1,1,nil))
	end
	return sg
end
function s.alvo3(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return s.cada3_resta(tp,Group.CreateGroup(),e:GetHandler(),1) end
	Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,#s.cada3,tp,LOCATION_DECK|LOCATION_GRAVE)
end
function s.operacao3(e,tp,eg,ep,ev,re,r,rp)
	local sg=s.cada3_escolhe(tp,e:GetHandler(),HINTMSG_ATOHAND)
	if #sg>0 then
		Duel.SendtoHand(sg,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,sg)
	end
end
";

        enum ModoShiny { Gatilho, Busca, SemProtecao }

        static void ShinyMedicine(string sa)
        {
            Log.Info("\n-- Shiny Medicine: custo 1 de cada, dano zero, volta do Cemitério, banir e buscar --");
            var com = JogarShiny(sa, ModoShiny.Gatilho, r => r.voltou && r.bateu);
            Check("baixada e ativada no turno seguinte (o custo 1 Red + 1 Blue pôde ser pago)", com.ativou);
            Check("o custo mandou 1 Red Medicine E 1 Blue Medicine ao Cemitério", com.custoRed && com.custoBlue);
            Check("com ela resolvida, o Elfo bateu no Battle Ox, morreu — e o dano foi ZERO", com.bateu && !com.levouDano,
                  $"(bateu={com.bateu} dano={com.levouDano})");
            Check("no Cemitério, ativar só a Red Medicine NÃO a trouxe de volta", com.ativouRed && !com.voltouSoComRed);
            Check("ativada a Blue Medicine também, ela voltou do Cemitério para a mão", com.ativouBlue && com.voltou);
            Check("nada ficou 'unsupported'", !com.unsupported);

            var busca = JogarShiny(sa, ModoShiny.Busca, r => r.baniu && r.buscouRed && r.buscouBlue);
            Check("do Cemitério, ela se baniu como custo", busca.baniu);
            Check("e trouxe 1 Red Medicine E 1 Blue Medicine do Deck/Cemitério para a mão", busca.buscouRed && busca.buscouBlue);

            // CONTROLE. O mesmo Elfo no mesmo Battle Ox, sem a Shiny resolvida:
            // sem este par, "o dano foi zero" passaria com um arnês que nunca
            // chegasse a bater em nada.
            var sem = JogarShiny(sa, ModoShiny.SemProtecao, r => r.bateu);
            Check("controle: sem ela, o mesmo ataque TIRA LP", sem.bateu && sem.levouDano,
                  $"(bateu={sem.bateu} dano={sem.levouDano})");
        }

        sealed class ResultadoShiny
        {
            public bool ativou, custoRed, custoBlue, bateu, levouDano;
            public bool ativouRed, voltouSoComRed, ativouBlue, voltou, baniu, buscouRed, buscouBlue, unsupported;
        }

        /// <summary>
        /// A Shiny jogada pelo jogador, contra o Battle Ox do NPC. Ela é baixada
        /// assim que aparece e ativada no turno seguinte (Armadilha não ativa no
        /// turno em que foi baixada). No MESMO turno, o Mystical Elf (800) ataca o
        /// Battle Ox (1700): a diferença é dano de batalha, e é ela que tem de sair
        /// zero. Depois, conforme o modo:
        ///   • `Gatilho` — ativa uma Red Medicine, confere que a Shiny ficou no
        ///     Cemitério, e ativa uma Blue: aí o gatilho a traz para a mão;
        ///   • `Busca` — ativa o efeito dela no Cemitério (banir, buscar 1 de cada);
        ///   • `SemProtecao` — o CONTROLE: o mesmo ataque sem ela.
        /// O LP só conta na MINHA Battle Phase: os ataques diretos do NPC no turno
        /// dele tiram LP de verdade e não dizem nada sobre a carta.
        /// </summary>
        static ResultadoShiny JogarShiny(string sa, ModoShiny modo, Func<ResultadoShiny, bool> pronto)
        {
            var res = new ResultadoShiny();
            var cartas = CartaCustom.Ler(Corpo(new
            {
                id = SHINY, nome = "Shiny Medicine", type = 0x4, level = 0,
                attribute = 0, race = 0, atk = 0, def = 0, lua = LUA_SHINY,
            }));
            var deck = Enumerable.Repeat(SHINY, 10)
                .Concat(Enumerable.Repeat(RED, 10))
                .Concat(Enumerable.Repeat(BLUE, 10))
                .Concat(Enumerable.Repeat(ELFA, 10)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 99, 4242, 777, 3, 17, 404, 2718, 8080, 42 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     cartasCustom: cartas);
                var r = duel.Advance();
                bool setou = false, setouNoTurno = false, ativando = false, resolvida = false, ativouNoTurno = false;
                bool invocouNoTurno = false, atacouNoTurno = false, emBatalha = false, elfaMorreu = false, danoNaBatalha = false;
                bool ativandoRed = false, ativandoBlue = false, buscando = false, naMao = false;
                int idles = 0;
                // Só vale o ataque que COLIDIU e perdeu: é aí que existe dano de
                // batalha a zerar. Fecha no próximo idle meu OU na virada de turno —
                // com o Elfo morto a Battle Phase acaba sem idle nenhum no meio.
                void FecharAtaque()
                {
                    emBatalha = false;
                    if (elfaMorreu && (modo == ModoShiny.SemProtecao || ativouNoTurno))
                    {
                        res.bateu = true;
                        if (danoNaBatalha) res.levouDano = true;
                    }
                }

                for (int guard = 0; guard < 1500 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        // O dano só conta na MINHA Battle Phase: a virada de turno fecha a
                        // janela, senão os ataques diretos do NPC entram na conta.
                        if (tipo == "turn" && emBatalha) FecharAtaque();
                        if (tipo == "lp" && emBatalha)
                        {
                            int pl = Convert.ToInt32(t.GetProperty("player")?.GetValue(e) ?? -1);
                            int delta = Convert.ToInt32(t.GetProperty("delta")?.GetValue(e) ?? 0);
                            if (pl == 0 && delta < 0) danoNaBatalha = true;
                        }
                        if (DIAG && (ativouNoTurno || modo == ModoShiny.SemProtecao)) Log.Info($"  [diag] {modo} seed={seed} ev={JsonSerializer.Serialize(e)}");
                        if (tipo != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);

                        if (ativando && code == RED && loc == LOC_GRAVE && (de == LOC_HAND || de == LOC_DECK)) res.custoRed = true;
                        if (ativando && code == BLUE && loc == LOC_GRAVE && (de == LOC_HAND || de == LOC_DECK)) res.custoBlue = true;
                        if (ativando && code == SHINY && loc == LOC_GRAVE && (de & LOC_SZONE) != 0) { res.ativou = true; resolvida = true; }
                        if (emBatalha && code == ELFA && (de & LOC_MZONE) != 0 && loc == LOC_GRAVE) elfaMorreu = true;
                        if (resolvida && code == SHINY && de == LOC_GRAVE && loc == LOC_HAND)
                        {
                            // A volta chega na MESMA resposta que ativou a Medicine — antes
                            // do idle que a registraria —, então quem conta é a ativação em curso.
                            if (ativandoRed) res.voltouSoComRed = true;
                            if (ativandoBlue || res.ativouBlue) res.voltou = true;
                            naMao = true;
                        }
                        if (buscando && code == SHINY && de == LOC_GRAVE && loc == LOC_REMOVED) res.baniu = true;
                        bool doDeckOuCemiterio = de == LOC_DECK || de == LOC_GRAVE;
                        if (buscando && code == RED && loc == LOC_HAND && doDeckOuCemiterio) res.buscouRed = true;
                        if (buscando && code == BLUE && loc == LOC_HAND && doDeckOuCemiterio) res.buscouBlue = true;
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    // O gatilho OPCIONAL do Cemitério chega como `yesno` ou numa
                    // janela de corrente — e a ação do primeiro é `yesno`.
                    if (q.kind == "yesno") { r = duel.Respond("yesno", 1); continue; }
                    if (q.kind == "chain")
                    {
                        var gat = q.activatable.FirstOrDefault(a => a.code == SHINY && a.location == LOC_GRAVE);
                        r = duel.Respond("chain", gat.code == SHINY && modo == ModoShiny.Gatilho ? gat.index : -1);
                        continue;
                    }

                    if (q.kind == "battle" && q.player == 0)
                    {
                        var elfa = q.attackers.FirstOrDefault(a => a.code == ELFA && !a.canDirect);
                        if (!atacouNoTurno && elfa.code == ELFA)
                        {
                            atacouNoTurno = true;
                            emBatalha = true;
                            r = duel.Respond("attack", elfa.index);
                            continue;
                        }
                        r = duel.Respond("endbattle", 0);
                        continue;
                    }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        if (emBatalha) FecharAtaque();
                        ativando = false;
                        if (ativandoRed) { ativandoRed = false; res.ativouRed = true; }
                        if (ativandoBlue) { ativandoBlue = false; res.ativouBlue = true; }
                        buscando = false;
                        if (pronto(res) || ++idles > 80) break;

                        // 1) baixar a Shiny assim que aparecer
                        if (!setou && modo != ModoShiny.SemProtecao)
                        {
                            var baixar = q.settableST.FirstOrDefault(a => a.code == SHINY);
                            if (baixar.code == SHINY) { setou = true; setouNoTurno = true; r = duel.Respond("setspell", baixar.index); continue; }
                        }
                        // 2) ativá-la no turno seguinte (do campo)
                        if (setou && !setouNoTurno && !resolvida)
                        {
                            var at = q.activatable.FirstOrDefault(a => a.code == SHINY && (a.location & LOC_SZONE) != 0);
                            if (at.code == SHINY) { ativando = true; ativouNoTurno = true; r = duel.Respond("activate", at.index); continue; }
                        }
                        // 3) o ataque que perde: com ela resolvida neste turno, ou no controle
                        bool querBater = !res.bateu && (modo == ModoShiny.SemProtecao || ativouNoTurno);
                        if (querBater && !invocouNoTurno)
                        {
                            var elfa = q.summonable.FirstOrDefault(a => a.code == ELFA);
                            if (elfa.code == ELFA) { invocouNoTurno = true; r = duel.Respond("summon", elfa.index); continue; }
                        }
                        if (querBater && !atacouNoTurno && q.canBattle) { r = duel.Respond("battle", 0); continue; }
                        // 4) com ela no Cemitério
                        if (resolvida && !naMao && modo == ModoShiny.Gatilho)
                        {
                            var red = q.activatable.FirstOrDefault(a => a.code == RED && a.location == LOC_HAND);
                            var blue = q.activatable.FirstOrDefault(a => a.code == BLUE && a.location == LOC_HAND);
                            // As duas na mão ao mesmo tempo: a Red primeiro, e a pergunta
                            // "voltou só com ela?" é feita antes da Blue existir.
                            if (!res.ativouRed && red.code == RED && blue.code == BLUE)
                            { ativandoRed = true; r = duel.Respond("activate", red.index); continue; }
                            if (res.ativouRed && !res.ativouBlue && blue.code == BLUE)
                            { ativandoBlue = true; r = duel.Respond("activate", blue.index); continue; }
                        }
                        if (resolvida && modo == ModoShiny.Busca && !res.baniu)
                        {
                            var gy = q.activatable.FirstOrDefault(a => a.code == SHINY && a.location == LOC_GRAVE);
                            if (gy.code == SHINY) { buscando = true; r = duel.Respond("activate", gy.index); continue; }
                        }
                        setouNoTurno = false;
                        ativouNoTurno = false;
                        invocouNoTurno = false;
                        atacouNoTurno = false;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    r = Padrao(duel, q);
                }
                if (pronto(res)) break;
            }
            return res;
        }

        // ------------------------------------------------ Evil Dragon of Darkness
        //
        // A carta do usuário (id REAL 950000008), com três peças novas do gerador:
        // o passo "Invocação-Fusão usando esta carta" (`fundir`), o passo OPCIONAL
        // ("você pode" — `Duel.SelectYesNo`) e a condição sobre o que o passo
        // ANTERIOR moveu ("se você adicionou 1 'Dragon Knight of Darkness' do seu
        // Cemitério por este efeito"). E uma propriedade da carta: tratada como
        // monstro Normal SÓ no Cemitério (o par ADD_TYPE/REMOVE_TYPE do Gemini).

        const uint EVIL = 950000008;        // Evil Dragon of Darkness — Efeito Nv4 1100/500, TREVAS Dragão
        const uint KNIGHT_DK = 950000009;   // Dragon Knight of Darkness — Normal Nv5 1600/1100, TREVAS Dragão
        const uint EVIL_KNIGHT = 950000011; // Evil Dragon Knight of Darkness — a Fusão (Extra Deck)
        const uint BUSCA_NORMAL = 950000060; // Magia de TESTE: "adicione 1 monstro Normal do seu Cemitério"
        const uint FOOLISH = 81439173;      // Foolish Burial — manda 1 monstro do Deck ao Cemitério

        /// <summary>A saída de `gerarLua` para a Evil Dragon of Darkness (comentários à parte).</summary>
        const string LUA_EVIL =
@"--Evil Dragon of Darkness
--Classic Duels · Card Builder · Monstro de Efeito
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--no Cemitério: tratada como um monstro Normal
	local etn=Effect.CreateEffect(c)
	etn:SetType(EFFECT_TYPE_SINGLE)
	etn:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_IGNORE_IMMUNE)
	etn:SetCode(EFFECT_ADD_TYPE)
	etn:SetRange(LOCATION_GRAVE)
	etn:SetValue(TYPE_NORMAL)
	c:RegisterEffect(etn)
	local etn2=etn:Clone()
	etn2:SetCode(EFFECT_REMOVE_TYPE)
	etn2:SetValue(TYPE_EFFECT)
	c:RegisterEffect(etn2)
	--no campo (Main Phase): adicionar à mão (outra carta)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)
	e1:SetType(EFFECT_TYPE_IGNITION)
	e1:SetRange(LOCATION_MZONE)
	e1:SetCountLimit(1,{id,1})
	e1:SetTarget(s.alvo1)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
end
function s.filtro1_1(c)
	return (c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL) and c:IsLevelAbove(5) and c:IsAttackBelow(1900)) and c:IsAbleToHand()
end
function s.passo1_1(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,s.filtro1_1,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,e:GetHandler())
	if #g==0 or Duel.SendtoHand(g,nil,REASON_EFFECT)==0 then return false end
	s.moveu1=g
	Duel.ConfirmCards(1-tp,g)
	return true
end
function s.fusao1_2(c,e,tp,mg,gc)
	return c:IsType(TYPE_FUSION) and c:IsCode(950000011)
		and c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false) and c:CheckFusionMaterial(mg,gc,tp)
end
function s.podefundir1_2(e,tp)
	local c=e:GetHandler()
	local mg=Duel.GetFusionMaterial(tp)
	return mg:IsContains(c) and Duel.IsExistingMatchingCard(s.fusao1_2,tp,LOCATION_EXTRA,0,1,nil,e,tp,mg,c)
end
function s.se1_2(c)
	return (c:IsType(TYPE_MONSTER) and c:IsCode(950000009)) and c:IsLocation(LOCATION_HAND) and c:IsPreviousLocation(LOCATION_GRAVE)
end
function s.passo1_2(e,tp,eg,ep,ev,re,r,rp)
	if not (s.moveu1 and s.moveu1:IsExists(s.se1_2,1,nil)) then return false end
	if not (s.podefundir1_2(e,tp)) or not Duel.SelectYesNo(tp,aux.Stringid(id,0)) then return false end
	local c=e:GetHandler()
	if not s.podefundir1_2(e,tp) then return false end
	local mg=Duel.GetFusionMaterial(tp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local fc=Duel.SelectMatchingCard(tp,s.fusao1_2,tp,LOCATION_EXTRA,0,1,1,nil,e,tp,mg,c):GetFirst()
	if not fc then return false end
	local mat=Duel.SelectFusionMaterial(tp,fc,mg,c,tp)
	if #mat==0 then return false end
	fc:SetMaterial(mat)
	Duel.SendtoGrave(mat,REASON_EFFECT+REASON_MATERIAL+REASON_FUSION)
	Duel.BreakEffect()
	if Duel.SpecialSummon(fc,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP)==0 then return false end
	fc:CompleteProcedure()
	return true
end
function s.alvo1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filtro1_1,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,e:GetHandler()) end
	Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	s.moveu1=nil
	if not s.passo1_1(e,tp,eg,ep,ev,re,r,rp) then return end
	Duel.BreakEffect()
	s.passo1_2(e,tp,eg,ep,ev,re,r,rp)
end
";

        /// <summary>
        /// A saída de `gerarLua` para a Evil Dragon Knight of Darkness (id REAL
        /// 950000011): materiais "Dragon Knight" + "Evil Dragon", tratada como
        /// Normal, e os três efeitos — destruir tudo o que é seu ao ser Invocada
        /// por Invocação-Especial (então, se quiser, até 2 ao Cemitério), baixar a
        /// Dragon's Inferno sem outra carta sua, e trazer os dois materiais de volta
        /// ao deixar o campo. Os dois gatilhos são OBRIGATÓRIOS (`TRIGGER_F`).
        /// </summary>
        const string LUA_EVIL_KNIGHT =
@"--Evil Dragon Knight of Darkness
--Classic Duels · Card Builder · Monstro de Fusão
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--Monstro de Fusão: sai do Extra Deck por Invocação-Fusão, com os materiais abaixo
	c:EnableReviveLimit()
	Fusion.AddProcMixN(c,true,true,s.material1,1,s.material2,1)
	--ao ser Invocado por Invocação-Especial: destruir (outra carta)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_DESTROY+CATEGORY_TOGRAVE)
	e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)
	e1:SetProperty(EFFECT_FLAG_DELAY)
	e1:SetCode(EVENT_SPSUMMON_SUCCESS)
	e1:SetCountLimit(1,{id,1})
	e1:SetTarget(s.alvo1)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
	--no campo (Main Phase): baixar Magia/Armadilha (Set) (outra carta)
	local e2=Effect.CreateEffect(c)
	e2:SetType(EFFECT_TYPE_IGNITION)
	e2:SetRange(LOCATION_MZONE)
	e2:SetCountLimit(1,{id,2})
	e2:SetCondition(s.condicao2)
	e2:SetTarget(s.alvo2)
	e2:SetOperation(s.operacao2)
	c:RegisterEffect(e2)
	--quando ESTA carta deixa o campo (por qualquer motivo): Invocação-Especial (outra carta)
	local e3=Effect.CreateEffect(c)
	e3:SetCategory(CATEGORY_SPECIAL_SUMMON)
	e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)
	e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)
	e3:SetCode(EVENT_LEAVE_FIELD)
	e3:SetCountLimit(1,{id,3})
	e3:SetCondition(s.condicao3)
	e3:SetTarget(s.alvo3)
	e3:SetOperation(s.operacao3)
	c:RegisterEffect(e3)
end
function s.material1(c,fc,sumtype,tp)
	return c:IsType(TYPE_MONSTER) and c:IsCode(950000009)
end
function s.material2(c,fc,sumtype,tp)
	return c:IsType(TYPE_MONSTER) and c:IsCode(950000008)
end
function s.filtro1_1(c)
	return true
end
function s.passo1_1(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.filtro1_1,tp,LOCATION_ONFIELD,0,e:GetHandler())
	if #g>0 then Duel.Destroy(g,REASON_EFFECT) end
	return true
end
function s.filtro1_2(c)
	return c:IsAbleToGrave()
end
function s.passo1_2(e,tp,eg,ep,ev,re,r,rp)
	if not (Duel.IsExistingMatchingCard(s.filtro1_2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,e:GetHandler())) or not Duel.SelectYesNo(tp,aux.Stringid(id,0)) then return false end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
	local g=Duel.SelectMatchingCard(tp,s.filtro1_2,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,2,e:GetHandler())
	if #g==0 then return false end
	return Duel.SendtoGrave(g,REASON_EFFECT)>0
end
function s.alvo1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,0,0,LOCATION_ONFIELD)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	if not s.passo1_1(e,tp,eg,ep,ev,re,r,rp) then return end
	Duel.BreakEffect()
	s.passo1_2(e,tp,eg,ep,ev,re,r,rp)
end
function s.condfiltro2(c)
	return true
end
function s.condicao2(e,tp,eg,ep,ev,re,r,rp)
	return not Duel.IsExistingMatchingCard(s.condfiltro2,tp,LOCATION_ONFIELD,0,1,e:GetHandler())
end
function s.filtro2(c)
	return (c:IsCode(950000002)) and c:IsSSetable()
end
function s.alvo2(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filtro2,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,e:GetHandler()) end
end
function s.operacao2(e,tp,eg,ep,ev,re,r,rp)
	local ft=math.min(1,(Duel.GetLocationCount(tp,LOCATION_SZONE)))
	if ft<=0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
	local sg=Duel.SelectMatchingCard(tp,s.filtro2,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,ft,e:GetHandler())
	if #sg>0 and Duel.SSet(tp,sg)>0 then
		for tc in aux.Next(sg) do
			local ea=Effect.CreateEffect(e:GetHandler())
			ea:SetType(EFFECT_TYPE_SINGLE)
			ea:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)
			ea:SetProperty(EFFECT_FLAG_SET_AVAILABLE)
			ea:SetReset(RESET_EVENT|RESETS_STANDARD)
			tc:RegisterEffect(ea)
			local eb=ea:Clone()
			eb:SetCode(EFFECT_QP_ACT_IN_SET_TURN)
			tc:RegisterEffect(eb)
		end
	end
end
function s.condicao3(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp)
end
function s.cada3_1_1(c,e,tp)
	return (c:IsType(TYPE_MONSTER) and c:IsCode(950000009)) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
end
function s.cada3_1_2(c,e,tp)
	return (c:IsType(TYPE_MONSTER) and c:IsCode(950000008)) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
end
s.cada3_1={s.cada3_1_1,s.cada3_1_2}
function s.cada3_1_resta(tp,sg,ex,i,e)
	if i>#s.cada3_1 then return true end
	local g=Duel.GetMatchingGroup(s.cada3_1[i],tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,sg,e,tp)
	if ex then g:RemoveCard(ex) end
	local tc=g:GetFirst()
	while tc do
		sg:AddCard(tc)
		local ok=s.cada3_1_resta(tp,sg,ex,i+1,e)
		sg:RemoveCard(tc)
		if ok then return true end
		tc=g:GetNext()
	end
	return false
end
function s.cada3_1_escolhe(tp,ex,hint,e)
	local sg=Group.CreateGroup()
	for i=1,#s.cada3_1 do
		local g=Duel.GetMatchingGroup(s.cada3_1[i],tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,sg,e,tp)
		if ex then g:RemoveCard(ex) end
		g=g:Filter(function(c)
			sg:AddCard(c)
			local ok=s.cada3_1_resta(tp,sg,ex,i+1,e)
			sg:RemoveCard(c)
			return ok
		end,nil)
		if #g==0 then return Group.CreateGroup() end
		Duel.Hint(HINT_SELECTMSG,tp,hint)
		sg:Merge(g:Select(tp,1,1,nil))
	end
	return sg
end
function s.passo3_1(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<#s.cada3_1 then return false end
	local sg=s.cada3_1_escolhe(tp,e:GetHandler(),HINTMSG_SPSUMMON,e)
	return #sg>0 and Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)>0
end
function s.alvo3(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>=#s.cada3_1 and s.cada3_1_resta(tp,Group.CreateGroup(),e:GetHandler(),1,e) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,#s.cada3_1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE)
end
function s.operacao3(e,tp,eg,ep,ev,re,r,rp)
	s.passo3_1(e,tp,eg,ep,ev,re,r,rp)
end
";

        /// <summary>Magia de TESTE, saída do gerador: "destrua 1 monstro que você controla" (tira o Cavaleiro do campo).</summary>
        const string LUA_DESTROI_MEU =
@"--Destrua um monstro seu (teste)
--Classic Duels · Card Builder · Magia Normal
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--ao ativar a carta: destruir (outra carta)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_DESTROY)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetProperty(EFFECT_FLAG_CARD_TARGET)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.alvo1)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
end
function s.filtro1(c)
	return c:IsType(TYPE_MONSTER)
end
function s.alvo1(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(tp) and s.filtro1(chkc) end
	if chk==0 then return Duel.IsExistingTarget(s.filtro1,tp,LOCATION_MZONE,0,1,e:GetHandler()) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectTarget(tp,s.filtro1,tp,LOCATION_MZONE,0,1,1,e:GetHandler())
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)
	if not g then return end
	local tg=g:Filter(Card.IsRelateToEffect,nil,e)
	if #tg>0 then
		Duel.Destroy(tg,REASON_EFFECT)
	end
end
";

        /// <summary>
        /// Magia de TESTE, também saída do gerador: "adicione 1 monstro Normal do seu
        /// Cemitério à mão". Com a Evil Dragon sozinha no Cemitério, ela só fica
        /// ativável se lá a Evil for mesmo um monstro Normal.
        /// </summary>
        const string LUA_BUSCA_NORMAL =
@"--Busca Normal no Cemiterio (teste)
--Classic Duels · Card Builder · Magia Normal
--Gerado a partir dos dados da carta: edite no Card Builder, não aqui.
local s,id=GetID()
function s.initial_effect(c)
	--ao ativar a carta: adicionar à mão (outra carta)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_TOHAND)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.alvo1)
	e1:SetOperation(s.operacao1)
	c:RegisterEffect(e1)
end
function s.filtro1(c)
	return (c:IsType(TYPE_MONSTER) and c:IsType(TYPE_NORMAL)) and c:IsAbleToHand()
end
function s.alvo1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filtro1,tp,LOCATION_GRAVE,0,1,e:GetHandler()) end
	Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)
end
function s.operacao1(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,s.filtro1,tp,LOCATION_GRAVE,0,1,1,e:GetHandler())
	if #g>0 then
		Duel.SendtoHand(g,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,g)
	end
end
";

        /// <summary>O Lua da Evil SEM o "Normal no Cemitério" — o controle da propriedade.</summary>
        static string EvilSemNormalNoCemiterio() =>
            LUA_EVIL.Substring(0, LUA_EVIL.IndexOf("\t--no Cemitério", StringComparison.Ordinal))
            + LUA_EVIL.Substring(LUA_EVIL.IndexOf("\t--no campo", StringComparison.Ordinal));

        static CartaCustom[] CartasEvil(string luaEvil) => CartaCustom.Ler(Corpo(
            new { id = EVIL, nome = "Evil Dragon of Darkness", type = 0x21, level = 4, attribute = 0x20, race = 0x2000, atk = 1100, def = 500, lua = luaEvil },
            new { id = KNIGHT_DK, nome = "Dragon Knight of Darkness", type = 0x11, level = 5, attribute = 0x20, race = 0x2000, atk = 1600, def = 1100, lua = LUA_MONSTRO },
            new { id = EVIL_KNIGHT, nome = "Evil Dragon Knight of Darkness", type = 0x71, level = 9, attribute = 0x20, race = 0x2000, atk = 2900, def = 1100, lua = LUA_EVIL_KNIGHT },
            new { id = BUSCA_NORMAL, nome = "Busca Normal no Cemiterio (teste)", type = 0x2, level = 0, attribute = 0, race = 0, atk = 0, def = 0, lua = LUA_BUSCA_NORMAL }));

        // ------------------------------------------ Evil Dragon Knight of Darkness
        //
        // A Fusão do usuário (id REAL 950000011), jogada a partir do MESMO combo da
        // Evil (Foolish no Dragon Knight → a Evil busca do Cemitério → Fusão). Peças
        // novas do gerador que ela exercita: o momento "ao ser Invocado por
        // Invocação-Especial", o gatilho OBRIGATÓRIO, o destruir TODAS do seu lado,
        // a ação "enviar ao Cemitério", a condição "nenhuma outra carta", o momento
        // "deixou o campo por qualquer motivo" e a Invocação "1 X e 1 Y".

        const uint INFERNO_REAL = 950000002;  // Dragon's Inferno com o id do banco (a Fusão a baixa por ESTE id)
        const uint DESTROI_MEU = 950000061;   // Magia de TESTE: "destrua 1 monstro que você controla"

        static CartaCustom[] CartasCavaleiro(string luaKnight) => CartaCustom.Ler(Corpo(
            new { id = EVIL, nome = "Evil Dragon of Darkness", type = 0x21, level = 4, attribute = 0x20, race = 0x2000, atk = 1100, def = 500, lua = LUA_EVIL },
            new { id = KNIGHT_DK, nome = "Dragon Knight of Darkness", type = 0x11, level = 5, attribute = 0x20, race = 0x2000, atk = 1600, def = 1100, lua = LUA_MONSTRO },
            new { id = EVIL_KNIGHT, nome = "Evil Dragon Knight of Darkness", type = 0x71, level = 9, attribute = 0x20, race = 0x2000, atk = 2900, def = 1100, lua = luaKnight },
            new { id = INFERNO_REAL, nome = "Dragon's Inferno", type = 0x20004, level = 0, attribute = 0, race = 0, atk = 0, def = 0, lua = LUA_INFERNO },
            new { id = DESTROI_MEU, nome = "Destrua um monstro seu (teste)", type = 0x2, level = 0, attribute = 0, race = 0, atk = 0, def = 0, lua = LUA_DESTROI_MEU }));

        static void EvilKnight(string sa)
        {
            Log.Info("\n-- Evil Dragon Knight of Darkness: limpar o campo, baixar a Inferno, voltar com os materiais --");
            var com = JogarCavaleiro(sa, LUA_EVIL_KNIGHT, r => r.dkVoltou && r.evilVoltou);
            Check("a Fusão saiu do Extra Deck (pelo combo da Evil)", com.chegou);
            Check("ao chegar, destruiu a carta que era sua em campo — sem perguntar (obrigatório)", com.destruiuPropria);
            Check("então perguntou se quer mandar cartas ao Cemitério, e mandou o Battle Ox do NPC", com.perguntouEnvio && com.enviouOx,
                  $"(perguntou={com.perguntouEnvio} enviou={com.enviouOx})");
            Check("sem outra carta sua, baixou a Dragon's Inferno do Deck/Cemitério", com.baixou);
            Check("ao deixar o campo, trouxe o Dragon Knight E a Evil de volta", com.dkVoltou && com.evilVoltou,
                  $"(dk={com.dkVoltou} evil={com.evilVoltou})");
            Check("nada ficou 'unsupported'", !com.unsupported);

            // CONTROLE: o mesmo script sem REGISTRAR o 1º efeito. A carta baixada
            // antes da Fusão continua em campo — e com ela o "baixar a Inferno"
            // não pode ser oferecido. Sem isto, "baixou" não provaria a condição.
            var semE1 = LUA_EVIL_KNIGHT.Replace("\te1:SetOperation(s.operacao1)\n\tc:RegisterEffect(e1)\n", "\te1:SetOperation(s.operacao1)\n")
                                       .Replace("\te1:SetOperation(s.operacao1)\r\n\tc:RegisterEffect(e1)\r\n", "\te1:SetOperation(s.operacao1)\r\n");
            var ctrl = JogarCavaleiro(sa, semE1, r => r.chegou && r.idlesComKnight >= 2);
            Check("controle: com outra carta sua em campo, o \"baixar a Inferno\" nunca é oferecido",
                  ctrl.chegou && ctrl.setouAntes && ctrl.idlesComKnight >= 2 && !ctrl.ofereceuBaixar,
                  $"(chegou={ctrl.chegou} setou={ctrl.setouAntes} idles={ctrl.idlesComKnight} ofereceu={ctrl.ofereceuBaixar})");
        }

        sealed class ResultadoCavaleiro
        {
            public bool chegou, setouAntes, destruiuPropria, perguntouEnvio, enviouOx, baixou, ofereceuBaixar;
            public bool saiu, dkVoltou, evilVoltou, unsupported;
            public int idlesComKnight;
        }

        /// <summary>
        /// Monta o combo da Evil até a Fusão chegar, com uma Magia/Armadilha BAIXADA
        /// antes (é ela que o 1º efeito destrói) e só com um Battle Ox do NPC em campo
        /// (é ele que vai ao Cemitério). Depois: o baixar da Inferno, e a Magia de
        /// teste destruindo a própria Fusão — o gatilho de saída traz os materiais.
        /// </summary>
        static ResultadoCavaleiro JogarCavaleiro(string sa, string luaKnight, Func<ResultadoCavaleiro, bool> pronto)
        {
            var res = new ResultadoCavaleiro();
            var cartas = CartasCavaleiro(luaKnight);
            var deck = Enumerable.Repeat(EVIL, 12)
                .Concat(Enumerable.Repeat(FOOLISH, 10))
                .Concat(Enumerable.Repeat(KNIGHT_DK, 9))
                .Concat(Enumerable.Repeat(DESTROI_MEU, 6))
                .Concat(Enumerable.Repeat(INFERNO_REAL, 3)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 99, 4242, 777, 3, 17, 404, 2718, 8080, 42, 5, 11, 23 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     extra: new[] { EVIL_KNIGHT }, cartasCustom: cartas);
                var r = duel.Advance();
                var parcial = new ResultadoCavaleiro();
                bool enterrando = false, buscando = false, baixando = false, destruindo = false;
                bool invocouNoTurno = false, usouNoTurno = false, dkNoCemiterio = false, knightEmCampo = false;
                uint setada = 0;
                int oxEmCampo = 0, idles = 0;

                for (int guard = 0; guard < 2000 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if (DIAG) Log.Info($"  [diag] cav seed={seed} ev={JsonSerializer.Serialize(e)}");
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        if (code == OX && (loc & LOC_MZONE) != 0 && (de & LOC_MZONE) == 0) oxEmCampo++;
                        if (code == OX && (de & LOC_MZONE) != 0 && (loc & LOC_MZONE) == 0)
                        {
                            oxEmCampo--;
                            if (knightEmCampo && loc == LOC_GRAVE && parcial.perguntouEnvio) parcial.enviouOx = true;
                        }
                        if (enterrando && code == KNIGHT_DK && de == LOC_DECK && loc == LOC_GRAVE) dkNoCemiterio = true;
                        if (code == EVIL_KNIGHT && de == LOC_EXTRA && (loc & LOC_MZONE) != 0) { parcial.chegou = true; knightEmCampo = true; }
                        if (knightEmCampo && setada != 0 && code == setada && (de & LOC_SZONE) != 0 && loc == LOC_GRAVE) parcial.destruiuPropria = true;
                        if (baixando && code == INFERNO_REAL && (loc & LOC_SZONE) != 0) parcial.baixou = true;
                        if (code == EVIL_KNIGHT && (de & LOC_MZONE) != 0 && (loc & LOC_MZONE) == 0) { parcial.saiu = true; knightEmCampo = false; }
                        if (parcial.saiu && code == KNIGHT_DK && (loc & LOC_MZONE) != 0) parcial.dkVoltou = true;
                        if (parcial.saiu && code == EVIL && (loc & LOC_MZONE) != 0) parcial.evilVoltou = true;
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { parcial.unsupported = true; break; }
                    if (DIAG && knightEmCampo)
                        Log.Info($"  [diag] cav seed={seed} pergunta={q.kind} p={q.player} escolhas=[{string.Join(", ", q.choices.Select(c => $"{c.code}@{c.location}"))}]");

                    if (q.kind == "yesno" && q.player == 0)
                    {
                        // Antes da Fusão é o "você pode" da Evil; depois, o "então" do Cavaleiro.
                        if (knightEmCampo) parcial.perguntouEnvio = true;
                        r = duel.Respond("yesno", 1);
                        continue;
                    }
                    if (q.kind == "selectcard" && q.player == 0)
                    {
                        InteractiveDuel.Sel? quer = null;
                        if (enterrando || buscando)
                        {
                            var dk = q.choices.Where(c => c.code == KNIGHT_DK).OrderByDescending(c => c.location == LOC_GRAVE).FirstOrDefault();
                            if (dk.code == KNIGHT_DK && (enterrando || q.choices.Any(c => c.location != LOC_HAND))) quer = dk;
                        }
                        // O envio ao Cemitério: o monstro DELE, nunca a própria carta.
                        if (knightEmCampo && parcial.perguntouEnvio && !parcial.enviouOx)
                        {
                            var ox = q.choices.FirstOrDefault(c => c.code == OX);
                            if (ox.code == OX) quer = ox;
                        }
                        if (destruindo)
                        {
                            var k = q.choices.FirstOrDefault(c => c.code == EVIL_KNIGHT);
                            if (k.code == EVIL_KNIGHT) quer = k;
                        }
                        if (quer is InteractiveDuel.Sel s) { r = duel.Respond("select", 0, new List<int> { s.index }); continue; }
                    }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        enterrando = buscando = baixando = destruindo = false;
                        if (knightEmCampo) parcial.idlesComKnight++;
                        if (DIAG && knightEmCampo)
                            Log.Info($"  [diag] cav seed={seed} idle ativaveis=[{string.Join(", ", q.activatable.Select(a => $"{a.code}@{a.location}"))}]");
                        if (pronto(parcial) || ++idles > 70) break;

                        if (knightEmCampo)
                        {
                            // 1) o baixar da Inferno (só sem outra carta sua)
                            var bx = q.activatable.FirstOrDefault(a => a.code == EVIL_KNIGHT && (a.location & LOC_MZONE) != 0);
                            if (bx.code == EVIL_KNIGHT) parcial.ofereceuBaixar = true;
                            if (bx.code == EVIL_KNIGHT && !parcial.baixou) { baixando = true; r = duel.Respond("activate", bx.index); continue; }
                            // 2) tirar o Cavaleiro do campo com a Magia de teste
                            var d = q.activatable.FirstOrDefault(a => a.code == DESTROI_MEU && a.location == LOC_HAND);
                            if (parcial.baixou && d.code == DESTROI_MEU) { destruindo = true; r = duel.Respond("activate", d.index); continue; }
                        }
                        else if (!parcial.chegou)
                        {
                            if (!dkNoCemiterio)
                            {
                                var fb = q.activatable.FirstOrDefault(a => a.code == FOOLISH);
                                if (fb.code == FOOLISH) { enterrando = true; r = duel.Respond("activate", fb.index); continue; }
                            }
                            // Uma carta SUA baixada antes: é ela que o 1º efeito tem de destruir.
                            if (dkNoCemiterio && setada == 0)
                            {
                                // A Foolish primeiro: a Magia de teste fica na mão para tirar o Cavaleiro depois.
                                var st = q.settableST.FirstOrDefault(a => a.code == FOOLISH);
                                if (st.code == 0) st = q.settableST.FirstOrDefault(a => a.code == DESTROI_MEU);
                                if (st.code != 0) { setada = st.code; parcial.setouAntes = true; r = duel.Respond("setspell", st.index); continue; }
                            }
                            // A Evil em campo busca e funde — com um Ox do NPC para o envio.
                            var ef = q.activatable.FirstOrDefault(a => a.code == EVIL && (a.location & LOC_MZONE) != 0);
                            if (dkNoCemiterio && setada != 0 && oxEmCampo > 0 && !usouNoTurno && ef.code == EVIL)
                            {
                                usouNoTurno = true; buscando = true;
                                r = duel.Respond("activate", ef.index);
                                continue;
                            }
                            var inv = q.summonable.FirstOrDefault(a => a.code == EVIL);
                            if (dkNoCemiterio && setada != 0 && !invocouNoTurno && inv.code == EVIL)
                            {
                                invocouNoTurno = true;
                                r = duel.Respond("summon", inv.index);
                                continue;
                            }
                        }
                        invocouNoTurno = false;
                        usouNoTurno = false;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    if (q.kind == "battle" && q.player == 0) { r = duel.Respond("endbattle", 0); continue; }
                    r = Padrao(duel, q);
                }
                // Um seed só vale INTEIRO: juntar pedaços de duelos diferentes
                // provaria cada peça em separado, nunca a carta.
                if (pronto(parcial) || !res.chegou) res = parcial;
                if (pronto(parcial)) break;
            }
            return res;
        }

        enum ModoEvil { Fusao, Recusa, DoDeck }

        static void EvilDragon(string sa)
        {
            Log.Info("\n-- Evil Dragon of Darkness: busca, Fusão opcional se veio do Cemitério, Normal no Cemitério --");
            var com = JogarEvil(sa, ModoEvil.Fusao, r => r.fundiu);
            Check("a Foolish Burial pôs o Dragon Knight no Cemitério", com.dkNoCemiterio);
            Check("em campo, a Evil buscou o Dragon Knight DO CEMITÉRIO", com.buscouDoCemiterio);
            Check("o motor perguntou se quer a Fusão (o \"você pode\")", com.perguntou);
            Check("a Evil Dragon Knight of Darkness saiu do Extra Deck para o campo", com.fundiu);
            Check("os materiais foram a Evil e o Dragon Knight que acabou de chegar", com.materialEvil && com.materialDk,
                  $"(evil={com.materialEvil} dk={com.materialDk})");
            Check("nada ficou 'unsupported'", !com.unsupported);

            // CONTROLE 1: o MESMO caminho respondendo "não". Sem ele, "fundiu"
            // poderia ser o passo acontecendo sem perguntar nada a ninguém.
            var recusa = JogarEvil(sa, ModoEvil.Recusa, r => r.perguntou && r.fechouOTurno);
            Check("controle: respondendo NÃO, a pergunta veio e a Fusão não aconteceu", recusa.perguntou && !recusa.fundiu,
                  $"(perguntou={recusa.perguntou} fundiu={recusa.fundiu})");

            // CONTROLE 2: sem a Foolish, o Dragon Knight vem do DECK — e aí a
            // condição "do seu Cemitério" não se cumpre: nem pergunta, nem Fusão.
            var doDeck = JogarEvil(sa, ModoEvil.DoDeck, r => r.buscouDoDeck && r.fechouOTurno);
            Check("controle: buscado do DECK, a Fusão nem é oferecida", doDeck.buscouDoDeck && !doDeck.perguntou && !doDeck.fundiu,
                  $"(doDeck={doDeck.buscouDoDeck} perguntou={doDeck.perguntou} fundiu={doDeck.fundiu})");

            var normal = JogarNormalNoCemiterio(sa, LUA_EVIL);
            Check("com a Evil sozinha no Cemitério, a busca por monstro NORMAL ficou ativável", normal.ofereceu);
            Check("e trouxe a Evil do Cemitério para a mão", normal.trouxe);
            // CONTROLE 3: o mesmo script sem as duas linhas do ADD/REMOVE_TYPE.
            var semNormal = JogarNormalNoCemiterio(sa, EvilSemNormalNoCemiterio());
            Check("controle: sem o \"Normal no Cemitério\", a mesma busca nunca é oferecida",
                  semNormal.evilNoCemiterio && semNormal.naMaoSemOferta && !semNormal.ofereceu,
                  $"(noCemiterio={semNormal.evilNoCemiterio} naMao={semNormal.naMaoSemOferta} ofereceu={semNormal.ofereceu})");
        }

        sealed class ResultadoEvil
        {
            public bool dkNoCemiterio, buscouDoCemiterio, buscouDoDeck, perguntou, fundiu, materialEvil, materialDk;
            public bool fechouOTurno, unsupported;
        }

        /// <summary>
        /// A Evil jogada pelo jogador. `Fusao`/`Recusa`: a Foolish Burial manda um
        /// Dragon Knight ao Cemitério, a Evil é Invocada e ativa a busca, e a escolha
        /// prefere o Dragon Knight DO CEMITÉRIO. `DoDeck` não usa a Foolish, então o
        /// Dragon Knight só pode vir do Deck. `fechouOTurno` marca o idle depois da
        /// resolução — é aí que dá para afirmar que a Fusão NÃO veio.
        /// </summary>
        static ResultadoEvil JogarEvil(string sa, ModoEvil modo, Func<ResultadoEvil, bool> pronto)
        {
            var res = new ResultadoEvil();
            var cartas = CartasEvil(LUA_EVIL);
            var deck = Enumerable.Repeat(EVIL, 14)
                .Concat(Enumerable.Repeat(FOOLISH, 13))
                .Concat(Enumerable.Repeat(KNIGHT_DK, 13)).ToArray();
            if (modo == ModoEvil.DoDeck)
                deck = Enumerable.Repeat(EVIL, 20).Concat(Enumerable.Repeat(KNIGHT_DK, 20)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 99, 4242, 777, 3, 17, 404, 2718, 8080, 42 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc,
                                                     extra: new[] { EVIL_KNIGHT }, cartasCustom: cartas);
                var r = duel.Advance();
                bool enterrando = false, buscando = false, invocouNoTurno = false, usouNoTurno = false;
                int idles = 0;

                for (int guard = 0; guard < 1500 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if (DIAG) Log.Info($"  [diag] {modo} seed={seed} ev={JsonSerializer.Serialize(e)}");
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        if (enterrando && code == KNIGHT_DK && de == LOC_DECK && loc == LOC_GRAVE) res.dkNoCemiterio = true;
                        if (buscando && code == KNIGHT_DK && loc == LOC_HAND && de == LOC_GRAVE) res.buscouDoCemiterio = true;
                        if (buscando && code == KNIGHT_DK && loc == LOC_HAND && de == LOC_DECK) res.buscouDoDeck = true;
                        if (buscando && code == EVIL_KNIGHT && de == LOC_EXTRA && (loc & LOC_MZONE) != 0) res.fundiu = true;
                        if (buscando && code == EVIL && (de & LOC_MZONE) != 0 && loc == LOC_GRAVE) res.materialEvil = true;
                        if (buscando && code == KNIGHT_DK && de == LOC_HAND && loc == LOC_GRAVE) res.materialDk = true;
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    // O "você pode" chega como `yesno` (MSG_SELECT_YESNO), e a ação é `yesno`.
                    if (q.kind == "yesno" && q.player == 0 && buscando)
                    {
                        res.perguntou = true;
                        r = duel.Respond("yesno", modo == ModoEvil.Recusa ? 0 : 1);
                        continue;
                    }
                    // A Foolish escolhe o Dragon Knight; a busca prefere o do CEMITÉRIO.
                    if (q.kind == "selectcard" && q.player == 0 && (enterrando || buscando))
                    {
                        var dk = q.choices.Where(c => c.code == KNIGHT_DK)
                            .OrderByDescending(c => c.location == LOC_GRAVE).FirstOrDefault();
                        if (dk.code == KNIGHT_DK && (enterrando || q.choices.Any(c => c.location != LOC_HAND)))
                        {
                            r = duel.Respond("select", 0, new List<int> { dk.index });
                            continue;
                        }
                    }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        if (buscando) res.fechouOTurno = true;
                        enterrando = false;
                        buscando = false;
                        if (pronto(res) || ++idles > 60) break;

                        // 1) o Dragon Knight no Cemitério, pela Foolish Burial
                        if (modo != ModoEvil.DoDeck && !res.dkNoCemiterio)
                        {
                            var fb = q.activatable.FirstOrDefault(a => a.code == FOOLISH);
                            if (fb.code == FOOLISH) { enterrando = true; r = duel.Respond("activate", fb.index); continue; }
                        }
                        bool pode = modo == ModoEvil.DoDeck || res.dkNoCemiterio;
                        // 2) a Evil em campo usa o efeito (uma vez por turno)
                        var ef = q.activatable.FirstOrDefault(a => a.code == EVIL && (a.location & LOC_MZONE) != 0);
                        if (pode && !usouNoTurno && ef.code == EVIL)
                        {
                            usouNoTurno = true; buscando = true;
                            r = duel.Respond("activate", ef.index);
                            continue;
                        }
                        // 3) Invocar a Evil
                        var inv = q.summonable.FirstOrDefault(a => a.code == EVIL);
                        if (pode && !invocouNoTurno && inv.code == EVIL)
                        {
                            invocouNoTurno = true;
                            r = duel.Respond("summon", inv.index);
                            continue;
                        }
                        invocouNoTurno = false;
                        usouNoTurno = false;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    if (q.kind == "battle" && q.player == 0) { r = duel.Respond("endbattle", 0); continue; }
                    r = Padrao(duel, q);
                }
                if (pronto(res)) break;
            }
            return res;
        }

        sealed class ResultadoNormal { public bool evilNoCemiterio, ofereceu, trouxe, naMaoSemOferta, unsupported; }

        /// <summary>
        /// A Foolish Burial manda a Evil ao Cemitério — o único monstro lá — e a
        /// pergunta é se a Magia "busque 1 monstro Normal do seu Cemitério" passa a
        /// ser oferecida. Só é, se ali a Evil for um monstro Normal.
        /// </summary>
        static ResultadoNormal JogarNormalNoCemiterio(string sa, string luaEvil)
        {
            var res = new ResultadoNormal();
            var cartas = CartasEvil(luaEvil);
            var deck = Enumerable.Repeat(EVIL, 13)
                .Concat(Enumerable.Repeat(FOOLISH, 13))
                .Concat(Enumerable.Repeat(BUSCA_NORMAL, 14)).ToArray();
            var npc = Enumerable.Repeat(OX, 40).ToArray();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 99, 4242, 777 })
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL, npc: true, npcDeck: npc, cartasCustom: cartas);
                var r = duel.Advance();
                bool enterrando = false, buscando = false;
                int idles = 0, idlesComEla = 0, buscasNaMao = 0;

                for (int guard = 0; guard < 800 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        // Quantas buscas estão na MÃO: "não foi oferecida" só prova
                        // alguma coisa se ela estava lá para ser oferecida.
                        if (tipo == "draw" && Convert.ToInt32(t.GetProperty("player")?.GetValue(e) ?? -1) == 0)
                        {
                            foreach (var c in (t.GetProperty("cards")?.GetValue(e) as IEnumerable) ?? Array.Empty<object>())
                                if (Convert.ToUInt32(c.GetType().GetProperty("code")?.GetValue(c) ?? 0u) == BUSCA_NORMAL) buscasNaMao++;
                        }
                        if (tipo != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte de = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        if (code == BUSCA_NORMAL && de == LOC_HAND && loc != LOC_HAND) buscasNaMao--;
                        if (enterrando && code == EVIL && de == LOC_DECK && loc == LOC_GRAVE) res.evilNoCemiterio = true;
                        if (buscando && code == EVIL && de == LOC_GRAVE && loc == LOC_HAND) res.trouxe = true;
                    }
                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { res.unsupported = true; break; }

                    if (q.kind == "selectcard" && q.player == 0 && enterrando)
                    {
                        var ev = q.choices.FirstOrDefault(c => c.code == EVIL);
                        if (ev.code == EVIL) { r = duel.Respond("select", 0, new List<int> { ev.index }); continue; }
                    }
                    if (q.kind == "idle" && q.player == 0)
                    {
                        enterrando = false;
                        buscando = false;
                        if (res.trouxe || ++idles > 40) break;
                        if (!res.evilNoCemiterio)
                        {
                            var fb = q.activatable.FirstOrDefault(a => a.code == FOOLISH);
                            if (fb.code == FOOLISH) { enterrando = true; r = duel.Respond("activate", fb.index); continue; }
                        }
                        else
                        {
                            // Com a Evil no Cemitério, a busca na MÃO: oferecida ou não.
                            var b = q.activatable.FirstOrDefault(a => a.code == BUSCA_NORMAL);
                            if (b.code == BUSCA_NORMAL) { res.ofereceu = true; buscando = true; r = duel.Respond("activate", b.index); continue; }
                            // Só conta como "nunca oferecida" com a busca NA MÃO de verdade.
                            if (buscasNaMao > 0) { res.naMaoSemOferta = true; if (++idlesComEla > 3) break; }
                        }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    if (q.kind == "battle" && q.player == 0) { r = duel.Respond("endbattle", 0); continue; }
                    r = Padrao(duel, q);
                }
                if (res.trouxe) break;
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
