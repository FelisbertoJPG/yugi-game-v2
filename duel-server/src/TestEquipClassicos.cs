using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação dos EQUIPAMENTOS CLÁSSICOS da Lista 1 —
    /// `--test-equip-classicos`.
    ///
    /// O `--test-equip` já prova o caminho ativar -> escolher alvo -> bônus com
    /// UMA carta (Legendary Sword). Este aqui é o outro problema: a Lista 1
    /// carrega os dois ciclos completos da era clássica — +300 ATK/DEF por TIPO
    /// e +400 ATK/-200 DEF por ATRIBUTO — e cada equipamento só serve a um tipo
    /// ou atributo específico. Um alvo errado não dá erro nenhum: o motor
    /// simplesmente não oferece a carta, e a lista ficaria com uma carta morta
    /// sem ninguém perceber.
    ///
    /// Então cada linha da tabela equipa a carta no monstro VANILLA certo e
    /// consulta o ATK no próprio motor (`QueryAtk`) — nunca uma conta nossa. Se
    /// o Lua não tivesse rodado, o ATK viria o base.
    /// </summary>
    public static class TestEquipClassicos
    {
        /// <summary>equipamento, cobaia (Normal Monster do tipo/atributo certo),
        /// ATK base dela, ATK esperado depois de equipar.</summary>
        static readonly (uint equip, string nomeEquip, uint monstro, string nomeMonstro, int baseAtk, int esperado)[] CASOS =
        {
            // ciclo +300 ATK/DEF por TIPO
            (15052462, "Violet Crystal (Zumbi)",          24530661, "Master Kyonshee",       1750, 2050),
            (1557499,  "Silver Bow and Arrow (Fada)",     12493482, "Dunames Dark Witch",    1800, 2100),
            (4614116,  "Dark Energy (Demonio)",            7459013, "Zure, Knight of DW",    1800, 2100),
            (37820550, "Electro-Whip (Trovao)",           54620698, "Gem-Knight Tourmaline", 1600, 1900),
            (98252586, "Follow Wind (Besta Alada)",       30532390, "Sky Scout",             1800, 2100),
            (36607978, "Mystical Moon (Besta-Guerreira)", 11987744, "Nin-Ken Dog",           1800, 2100),
            // ciclo +400 ATK / -200 DEF por ATRIBUTO
            (2370081,  "Steel Shell (AGUA)",              23771716, "7 Colored Fish",        1800, 2200),
            (18937875, "Burning Spear (FOGO)",            11813953, "Great Angus",           1800, 2200),
            (39897277, "Elf's Light (LUZ)",               12493482, "Dunames Dark Witch",    1800, 2200),
            (55321970, "Gust Fan (VENTO)",                11987744, "Nin-Ken Dog",           1800, 2200),
            (98374133, "Invigoration (TERRA)",             5053103, "Battle Ox",             1700, 2100),
        };

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== equipamentos classicos: cada um no tipo/atributo certo ===\n");
            ulong seed = 909090UL;
            foreach (var c in CASOS) UmCaso(sa, c, seed++);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void UmCaso(string sa,
            (uint equip, string nomeEquip, uint monstro, string nomeMonstro, int baseAtk, int esperado) c,
            ulong seed)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) { deck.Add(c.monstro); deck.Add(c.equip); }

            using var duel = new InteractiveDuel(sa, deck.ToArray(), seed, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: null, npcExtra: null);
            var r = duel.Advance();
            int seq = -1;
            bool invocou = false, ativou = false;

            for (int guard = 0; guard < 60 && !r.ended && !ativou; guard++)
            {
                int s = SeqDoMove(r.events, c.monstro);
                if (s >= 0) { seq = s; invocou = true; }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    if (!invocou)
                    {
                        var sum = q.summonable.FirstOrDefault(a => a.code == c.monstro);
                        if (sum.code == c.monstro) { r = duel.Respond("summon", sum.index); continue; }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    var act = q.activatable.FirstOrDefault(a => a.code == c.equip);
                    if (act.code == c.equip) { ativou = true; r = duel.Respond("activate", act.index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Auto(duel, q);
            }

            // escolha do alvo / colocação da magia depois do activate
            for (int guard = 0; guard < 20 && !r.ended && r.question != null
                                && r.question.kind != "idle"; guard++)
                r = Auto(duel, r.question);

            int s2 = SeqDoMove(r.events, c.monstro);
            if (s2 >= 0) seq = s2;

            if (!ativou || seq < 0)
            {
                Check($"{c.nomeEquip} equipou em {c.nomeMonstro}", false,
                      ativou ? "(nao achei o monstro na zona)" : "(o motor nunca ofereceu a carta)");
                return;
            }

            var (atk, _) = duel.QueryAtk(controller: 0, seq);
            Check($"{c.nomeEquip} em {c.nomeMonstro}: {c.baseAtk} -> {c.esperado}",
                  atk == c.esperado, $"(veio {atk})");
        }

        static InteractiveDuel.Result Auto(InteractiveDuel duel, InteractiveDuel.Question q) => q.kind switch
        {
            "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
            "position" => duel.Respond("position", 0x1),
            "chain" => duel.Respond("chain", -1),
            "yesno" => duel.Respond("yesno", 1),
            "selectoption" => duel.Respond("select", 0),
            "selectcard" or "selecttribute" or "selectsum" or "selectunselect" =>
                duel.Respond("select", 0, q.choices.Take(Math.Max(1, q.selMin)).Select(x => x.index).ToList()),
            "battle" => duel.Respond("endbattle", 0),
            _ => duel.Respond("endturn", 0),
        };

        static int SeqDoMove(IEnumerable<object> events, uint code)
        {
            foreach (var e in events)
            {
                var t = e.GetType();
                if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                if (Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u) != code) continue;
                if (Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0) != 4) continue; // LOCATION_MZONE
                return Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
            }
            return -1;
        }
    }
}
