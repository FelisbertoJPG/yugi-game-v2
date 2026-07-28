using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação das invocações — `--test-summons`.
    ///
    /// Joga de verdade pelo InteractiveDuel (mesmo caminho do servidor web) e
    /// verifica que a invocação por TRIBUTO acontece: monta tabuleiro com Nv4,
    /// invoca um Nv7 (2 tributos), responde à seleção e confirma pelos eventos
    /// que os tributos foram para o cemitério e o monstro entrou em campo.
    /// </summary>
    public static class TestSummons
    {
        const uint BATTLE_OX = 5053103;      // Nv4
        const uint MYSTICAL_ELF = 15025844;  // Nv4
        const uint CELTIC = 91152256;        // Nv4
        const uint GAIA = 6368038;           // Nv7 -> 2 tributos
        const uint SKULL = 70781052;         // Nv6 -> 1 tributo
        const byte LOC_GRAVE = 0x10, LOC_MZONE = 0x4, LOC_HAND = 0x2;

        static int _pass, _fail;

        const uint BLS = 5405694;            // Black Luster Soldier — Ritual Nv8
        const uint BLS_RITUAL = 55761792;    // Black Luster Ritual — a magia

        public static int Run(string sa)
        {
            Log.Info("=== teste: invocacao por tributo ===\n");
            TributeSummon(sa);
            Log.Info("\n=== teste: invocacao ritual ===\n");
            RitualSummon(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Ritual: ativa a magia, o motor pede o monstro ritual e depois os
        /// tributos que somem o nível. Deck com muitos Nv4 para fechar os 8.
        /// </summary>
        static void RitualSummon(string sa)
        {
            var deck = RitualDeck();
            using var duel = new InteractiveDuel(sa, deck, 24680UL, 0x1000000UL, npc: false);

            var r = duel.Advance();
            int guard = 0;
            bool activated = false, summonedBls = false;
            var unsupported = 0;
            var tributed = new List<uint>();   // monstros que foram ao cemitério

            while (!r.ended && guard++ < 300 && !summonedBls)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == BLS && loc == LOC_MZONE) summonedBls = true;
                    // Tributo de ritual pode vir do campo OU DA MÃO — a regra
                    // permite as duas origens, e o motor usa isso. Filtrar só o
                    // campo faz parecer que nenhum tributo aconteceu.
                    if (loc == LOC_GRAVE && (from == LOC_MZONE || from == LOC_HAND)
                        && code != BLS_RITUAL && code != BLS)
                        tributed.Add(code);
                }
                if (summonedBls) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var ritual = q.activatable.FirstOrDefault(a => a.code == BLS_RITUAL);
                        if (ritual.code == BLS_RITUAL)
                        {
                            Log.Info($"  > ativando Black Luster Ritual (index={ritual.index})");
                            activated = true;
                            r = duel.Respond("activate", ritual.index);
                        }
                        else if (q.summonable.Count > 0)
                            r = duel.Respond("summon", q.summonable[0].index);
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place":
                        r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                        break;
                    case "selectcard":
                    case "selecttribute":
                        Log.Info($"  > {q.kind}: min={q.selMin} opcoes={q.choices.Count}");
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        Log.Info($"  > selectunselect: opcoes={q.choices.Count} " +
                                 $"min={q.selMin} podeEncerrar={q.canFinish}");
                        r = q.canFinish && q.choices.Count == 0
                            ? duel.Respond("finishselect", 0)
                            : duel.Respond("pick", q.choices[0].index);
                        break;
                    case "battle":
                        r = duel.Respond("endbattle", 0);
                        break;
                    case "unsupported":
                        Log.Err($"  pergunta nao suportada: tipo {q.rawType}");
                        unsupported = q.rawType;
                        goto done;
                    default:
                        r = duel.Respond("endturn", 0);
                        break;
                }
            }
        done:
            Check("a magia de ritual pode ser ativada", activated);
            Check("Black Luster Soldier foi invocado por ritual", summonedBls,
                  unsupported != 0 ? $"(travou no tipo {unsupported})" : "");

            // A regra do ritual: os tributos têm de somar o nível do monstro (8).
            // Quem verifica isso é o script Lua da carta — nós não escrevemos
            // nenhuma linha sobre soma de níveis; só respondemos o que o motor pede.
            Log.Info($"  tributados: [{string.Join(", ", tributed)}] ({tributed.Count} monstros)");
            Check("o ritual consumiu tributos", tributed.Count > 0,
                  $"(foram {tributed.Count})");
            Check("os tributos somam o nivel 8 do Black Luster Soldier",
                  tributed.Count * 4 == 8, $"(monstros Nv4; vieram {tributed.Count})");
        }

        static uint[] RitualDeck()
        {
            var d = new List<uint>();
            for (int i = 0; i < 6; i++) d.Add(BLS_RITUAL);
            for (int i = 0; i < 6; i++) d.Add(BLS);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF, CELTIC };
            while (d.Count < 40) d.Add(lv4[d.Count % lv4.Length]);
            return d.ToArray();
        }

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        static void TributeSummon(string sa)
        {
            var deck = BuildDeck();
            // NPC desligado de propósito: este teste é sobre a mecânica de
            // invocação. Com o oponente jogando, o tabuleiro muda e a pergunta de
            // tributo às vezes se resolve sozinha — ruído para o que se mede aqui.
            using var duel = new InteractiveDuel(sa, deck, 987654321UL, 0x1000000UL, npc: false);

            var r = duel.Advance();
            int guard = 0;
            bool sawTributeQuestion = false, summonedGaia = false;
            var toGrave = new List<uint>();

            while (!r.ended && guard++ < 200)
            {
                CollectMoves(r, toGrave, ref summonedGaia);
                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        // Prioriza o Nv7: é ele que força o pedido de tributo.
                        var gaia = q.summonable.FirstOrDefault(a => a.code == GAIA);
                        if (gaia.code == GAIA)
                        {
                            Log.Info($"  > invocando GAIA (Nv7) index={gaia.index}");
                            r = duel.Respond("summon", gaia.index);
                        }
                        else if (q.summonable.Count > 0)
                        {
                            r = duel.Respond("summon", q.summonable[0].index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place":
                        r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                        break;
                    case "selecttribute":
                    {
                        sawTributeQuestion = true;
                        Log.Info($"  > SELECT_TRIBUTE: min={q.selMin} max={q.selMax} " +
                                 $"opcoes={q.choices.Count}");
                        Check("a pergunta de tributo traz as cartas", q.choices.Count > 0);
                        var pick = q.choices.Take(Math.Max(1, q.selMin))
                                            .Select(c => c.index).ToList();
                        Log.Info($"  > tributando indices [{string.Join(",", pick)}]");
                        r = duel.Respond("select", 0, pick);
                        break;
                    }
                    case "selectcard":
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                    {
                        sawTributeQuestion = true;
                        Log.Info($"  > SELECT_UNSELECT: opcoes={q.choices.Count} " +
                                 $"min={q.selMin} podeEncerrar={q.canFinish}");
                        // Escolhe uma por vez; quando o motor libera o encerramento
                        // e não há mais nada obrigatório, encerra.
                        if (q.choices.Count > 0 && !q.canFinish)
                            r = duel.Respond("pick", q.choices[0].index);
                        else if (q.canFinish)
                            r = duel.Respond("finishselect", 0);
                        else
                            r = duel.Respond("pick", q.choices[0].index);
                        break;
                    }
                    case "battle":
                        r = duel.Respond("endbattle", 0);
                        break;
                    case "unsupported":
                        Check($"pergunta nao suportada (tipo {q.rawType})", false);
                        return;
                    default:
                        r = duel.Respond("endturn", 0);
                        break;
                }
                if (summonedGaia) break;
            }
            CollectMoves(r, toGrave, ref summonedGaia);

            Check("o motor pediu os tributos", sawTributeQuestion);
            Check("GAIA entrou em campo apos o tributo", summonedGaia);
            Check("2 monstros foram para o cemiterio", toGrave.Count >= 2,
                  $"(foram {toGrave.Count}: {string.Join(",", toGrave)})");
        }

        /// <summary>Lê os eventos de movimento para confirmar o que aconteceu.</summary>
        static void CollectMoves(InteractiveDuel.Result r, List<uint> toGrave, ref bool summonedGaia)
        {
            foreach (var e in r.events)
            {
                var t = e.GetType();
                string kind = t.GetProperty("type")?.GetValue(e) as string;
                if (kind != "move") continue;
                uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                if (loc == LOC_GRAVE && code != GAIA) toGrave.Add(code);
                if (loc == LOC_MZONE && code == GAIA) summonedGaia = true;
            }
        }

        static uint[] BuildDeck()
        {
            var d = new List<uint>();
            for (int i = 0; i < 6; i++) d.Add(GAIA);
            for (int i = 0; i < 3; i++) d.Add(SKULL);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF, CELTIC };
            while (d.Count < 40) d.Add(lv4[d.Count % lv4.Length]);
            return d.ToArray();
        }
    }
}
