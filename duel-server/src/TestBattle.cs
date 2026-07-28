using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da Battle Phase — `--test-battle`.
    ///
    /// Joga pelo InteractiveDuel (mesmo caminho do servidor web) até um ataque
    /// resolver, e confere o que o motor produziu: o combate, a destruição do
    /// monstro mais fraco e o dano correto. Nenhuma dessas regras é nossa — o
    /// teste existe para provar que estamos lendo o motor direito.
    /// </summary>
    public static class TestBattle
    {
        const uint OX = 5053103;       // 1700 / 1000
        const uint CELTIC = 91152256;  // 1400 / 1200
        const byte LOC_GRAVE = 0x10;

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: Battle Phase ===\n");
            Batalha(sa);
            Log.Info("\n=== teste: resposta trocada e' recusada ===\n");
            RespostaTrocada(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Regressão de um bug real: responder "attack" a uma pergunta de ZONA
        /// virava os bytes `01 00 00 00`, que o motor lia como
        /// `[jogador 1, ...]` — e a carta ia parar no campo do OPONENTE, que
        /// podia até usá-la como tributo. O servidor tem de recusar.
        /// </summary>
        static void RespostaTrocada(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 40; i++) deck.Add(OX);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 999UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            // Anda até o motor pedir uma ZONA.
            for (int i = 0; i < 40 && r.question?.kind != "place"; i++)
            {
                var q = r.question;
                if (q == null) break;
                r = q.kind == "idle" && q.summonable.Count > 0
                    ? duel.Respond("summon", q.summonable[0].index)
                    : duel.Respond("endturn", 0);
            }

            Check("cheguei numa pergunta de zona", r.question?.kind == "place",
                  $"(veio {r.question?.kind})");
            if (r.question?.kind != "place") return;

            // Responde ERRADO de propósito.
            var antes = r.question;
            r = duel.Respond("attack", 0);

            bool recusou = r.events.Any(e =>
                (e.GetType().GetProperty("type")?.GetValue(e) as string) == "refused");
            Check("o servidor recusou a acao incompativel", recusou);
            Check("a pergunta de zona continua pendente", r.question?.kind == "place",
                  $"(veio {r.question?.kind})");

            // E a resposta certa continua funcionando depois da recusa.
            r = duel.Respond("place", antes.zones.Count > 0 ? antes.zones[0] : 0);
            Check("a resposta correta ainda funciona depois da recusa",
                  r.question?.kind != "place" || r.ended);
        }

        static void Batalha(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(OX);
            for (int i = 0; i < 20; i++) deck.Add(CELTIC);

            // NPC ligado: precisamos de monstros do outro lado para haver combate.
            using var duel = new InteractiveDuel(sa, deck.ToArray(), 31337UL, 0x1000000UL, npc: true);
            var r = duel.Advance();

            bool atacou = false, houveCombate = false, destruiu = false, deuDano = false;
            int danoTotal = 0;
            var aoCemiterio = new List<uint>();

            for (int guard = 0; guard < 250 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "attack") { atacou = true; Log.Info("  > ataque declarado"); }
                    if (kind == "battle")
                    {
                        houveCombate = true;
                        int aA = Conv(t, e, "atkAtk"), dA = Conv(t, e, "defAtk");
                        bool aD = (bool)(t.GetProperty("atkDestroyed")?.GetValue(e) ?? false);
                        bool dD = (bool)(t.GetProperty("defDestroyed")?.GetValue(e) ?? false);
                        destruiu = aD || dD;
                        Log.Info($"  > combate: atacante ATK {aA} (destruido={aD}) " +
                                 $"vs alvo ATK {dA} (destruido={dD})");
                        Check("o mais fraco foi destruido", aA > dA ? dD : aD,
                              $"({aA} vs {dA})");
                    }
                    if (kind == "lp")
                    {
                        int delta = Conv(t, e, "delta");
                        if (delta < 0) { deuDano = true; danoTotal += -delta; Log.Info($"  > dano: {-delta}"); }
                    }
                    if (kind == "move")
                    {
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        if (loc == LOC_GRAVE) aoCemiterio.Add(Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u));
                    }
                }
                if (houveCombate && deuDano) break;

                var q = r.question;
                if (q == null) break;

                r = q.kind switch
                {
                    // Vai para a batalha assim que puder; lá, ataca com o primeiro.
                    "idle" => q.canBattle ? duel.Respond("battle", 0)
                            : q.summonable.Count > 0 ? duel.Respond("summon", q.summonable[0].index)
                            : duel.Respond("endturn", 0),
                    "battle" => q.attackers.Count > 0 ? duel.Respond("attack", q.attackers[0].index)
                              : duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "selectcard" or "selecttribute" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    "selectunselect" => q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("um ataque foi declarado", atacou);
            Check("o combate foi resolvido pelo motor", houveCombate);
            Check("houve destruicao por batalha", destruiu);
            Check("o monstro destruido foi para o cemiterio", aoCemiterio.Count > 0,
                  $"(foram {aoCemiterio.Count})");
            Check("houve dano de batalha", deuDano, $"(total {danoTotal})");
            Check("o dano bate com a diferenca de ATK (1700-1400=300)", danoTotal == 300,
                  $"(veio {danoTotal})");
        }

        static int Conv(Type t, object e, string prop) =>
            Convert.ToInt32(t.GetProperty(prop)?.GetValue(e) ?? 0);
    }
}
