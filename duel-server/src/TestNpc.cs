using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste das regras do NPC do Teste de Batalha — `--test-npc`.
    ///
    /// Verifica a lógica de decisão isoladamente (sem duelo), montando situações
    /// controladas, e depois roda um duelo de verdade para confirmar que o NPC
    /// realmente invoca, usa o Pote da Ganância e encerra o turno.
    /// </summary>
    public static class TestNpc
    {
        // Vanilla Nv4, ATK/DEF conhecidos e sem efeito para atrapalhar:
        const uint BATTLE_OX = 5053103;      // 1700 / 1000
        const uint MYSTICAL_ELF = 15025844;  //  800 / 2000  <- maior DEF
        const uint CELTIC = 91152256;        // 1400 / 1200
        const uint GAIA = 6368038;           // Nv7 2300 / 2100
        const uint POT = 55144522;           // Pote da Ganancia
        const uint AQUA_MADOOR = 85639257;   // 1200 / 2000  <- o caso do exemplo
        const uint GIANT_SOLDIER = 13039848; // 1300 / 2000

        static int _pass, _fail;

        /// <summary>O jogador 0 joga simples: invoca o mais forte que puder.</summary>
        static InteractiveDuel.Result JogadaDoJogador(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            if (q.summonable.Count == 0) return duel.Respond("endturn", 0);
            var gaia = q.summonable.FirstOrDefault(a => a.code == GAIA);
            int idx = gaia.code == GAIA ? gaia.index : q.summonable[0].index;
            return duel.Respond("summon", idx);
        }

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== regras do NPC (decisao isolada) ===\n");
            LogicaIsolada(sa);
            Log.Info("\n=== NPC jogando um duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // Decisão isolada: monta a pergunta na mão e confere a escolha.
        // ------------------------------------------------------------------
        static void LogicaIsolada(string sa)
        {
            var db = new DatabaseManager(sa);
            var campo = new List<uint>();                       // campo do oponente
            var brain = new NpcBrain(db, p => p == 0 ? campo : new List<uint>());

            InteractiveDuel.Question Idle(
                IEnumerable<uint> summonable, IEnumerable<uint> settable = null,
                IEnumerable<uint> activatable = null)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in summonable) q.summonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in settable ?? Enumerable.Empty<uint>()) q.settable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in activatable ?? Enumerable.Empty<uint>()) q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            // regra 1 — a mão precisa ser setável também, senão o statline
            // defensivo da Mystical Elf não teria como virar Set.
            campo.Clear();
            var p = brain.Decide(Idle(new[] { CELTIC, BATTLE_OX, MYSTICAL_ELF }), 1);
            Check("regra 1: invoca o de maior ATK entre os ofensivos (Battle Ox 1700)",
                  p.Action == "summon" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // regra 2: oponente com ATK maior que tudo na mao
            campo.Clear(); campo.Add(GAIA);   // 2300 em campo
            p = brain.Decide(Idle(new[] { CELTIC, BATTLE_OX },
                                  settable: new[] { CELTIC, BATTLE_OX, MYSTICAL_ELF }), 1);
            Check("regra 2: com ameaca 2300, seta o de maior DEF (Mystical Elf 2000)",
                  p.Action == "setmonster" && p.Index == 2, $"(veio {p.Action} idx {p.Index})");

            // regra 2 nao dispara quando a mao supera a ameaca
            campo.Clear(); campo.Add(CELTIC);  // 1400 em campo
            p = brain.Decide(Idle(new[] { BATTLE_OX },              // 1700 > 1400
                                  settable: new[] { MYSTICAL_ELF }), 1);
            Check("sem ameaca real (1700 > 1400): volta a invocar em ataque",
                  p.Action == "summon", $"(veio {p.Action})");

            // regra 3: nivel maior tem precedencia
            campo.Clear(); campo.Add(GAIA);
            p = brain.Decide(Idle(new[] { BATTLE_OX, GAIA },
                                  settable: new[] { MYSTICAL_ELF }), 1);
            Check("regra 3: prefere a invocacao de nivel maior (Gaia Nv7)",
                  p.Action == "summon" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // regra 4: Pote antes de tudo
            campo.Clear(); campo.Add(GAIA);
            p = brain.Decide(Idle(new[] { BATTLE_OX, GAIA },
                                  settable: new[] { MYSTICAL_ELF },
                                  activatable: new[] { POT }), 1);
            Check("regra 4: Pote da Ganancia antes de qualquer invocacao",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index})");

            // --- statline da propria carta decide o modo --------------------
            // O caso exato levantado: o jogador tem 1100 em campo e o NPC tem um
            // Aqua Madoor 1200/2000. Ele venceria atacando (1200 > 1100), mas o
            // statline diz que ele rende mais como parede — entao seta.
            campo.Clear(); campo.Add(4042268);         // Island Turtle, 1100 ATK
            p = brain.Decide(Idle(new[] { AQUA_MADOOR }, settable: new[] { AQUA_MADOOR }), 1);
            Check("Aqua Madoor 1200/2000 contra 1100: SETA (venceria atacando, mas e' parede)",
                  p.Action == "setmonster", $"(veio {p.Action})");

            campo.Clear(); campo.Add(GIANT_SOLDIER);   // 1300 ATK em campo
            p = brain.Decide(Idle(new[] { MYSTICAL_ELF }, settable: new[] { MYSTICAL_ELF }), 1);
            Check("Mystical Elf (800/2000) diante de 1300: seta",
                  p.Action == "setmonster",
                  $"(veio {p.Action} — DEF 2000 > ATK 800, e' parede)");

            campo.Clear();                              // campo vazio
            p = brain.Decide(Idle(new[] { MYSTICAL_ELF }, settable: new[] { MYSTICAL_ELF }), 1);
            Check("sem ameaca, parede continua sendo setada (statline manda)",
                  p.Action == "setmonster", $"(veio {p.Action})");

            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX }, settable: new[] { BATTLE_OX }), 1);
            Check("Battle Ox (1700/1000) com campo vazio: ataca",
                  p.Action == "summon", $"(veio {p.Action})");

            // ofensivo perde para a ameaca -> volta a defender
            campo.Clear(); campo.Add(GAIA);            // 2300
            p = brain.Decide(Idle(new[] { BATTLE_OX }, settable: new[] { BATTLE_OX, MYSTICAL_ELF }), 1);
            Check("atacante fraco diante de 2300: seta o de maior DEF",
                  p.Action == "setmonster" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // mao vazia
            campo.Clear();
            p = brain.Decide(Idle(Array.Empty<uint>()), 1);
            Check("sem jogada possivel: encerra o turno", p.Action == "endturn");
        }

        // ------------------------------------------------------------------
        // Duelo real: o NPC precisa jogar sozinho enquanto passamos os turnos.
        // ------------------------------------------------------------------
        static void DueloReal(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 6; i++) deck.Add(POT);
            for (int i = 0; i < 3; i++) deck.Add(GAIA);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF, CELTIC };
            while (deck.Count < 40) deck.Add(lv4[deck.Count % lv4.Length]);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 13579UL, 0x1000000UL, npc: true);
            var r = duel.Advance();

            var acoes = new List<string>();

            void Colher(InteractiveDuel.Result res)
            {
                foreach (var e in res.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") continue;
                    string act = t.GetProperty("action")?.GetValue(e) as string;
                    string why = t.GetProperty("why")?.GetValue(e) as string;
                    acoes.Add(act);
                    Log.Info($"  NPC: {act}  ({why})");
                }
            }

            int guard = 0;
            while (!r.ended && guard++ < 120)
            {
                Colher(r);
                var q = r.question;
                if (q == null) break;

                // O jogador 0 invoca o mais forte que puder — sem uma ameaça em
                // campo a regra 2 nunca teria como disparar.
                r = q.kind switch
                {
                    "idle" => JogadaDoJogador(duel, q),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "battle" => duel.Respond("endbattle", 0),
                    _ => duel.Respond("endturn", 0),
                };
                // Segue até a regra 2 aparecer: ela só pode disparar depois que o
                // jogador acumular tributos e invocar algo mais forte, o que leva
                // alguns turnos.
                if (acoes.Contains("setmonster") && acoes.Contains("activate")) break;
            }
            Colher(r);   // o último resultado também conta

            Log.Info($"\n  acoes do NPC: [{string.Join(", ", acoes)}]");
            Check("o duelo nao travou em laco fechado",
                  !r.events.Any(e => (e.GetType().GetProperty("reason")?.GetValue(e) as string) == "guard"));
            Check("regra 2 disparou num duelo real (setou em defesa sob ameaca)",
                  acoes.Contains("setmonster"),
                  "(o jogador precisa ter posto um monstro mais forte em campo)");
            Check("o NPC jogou (nao ficou so passando o turno)",
                  acoes.Any(a => a is "summon" or "setmonster"),
                  $"(acoes: {string.Join(",", acoes)})");
            Check("o NPC usou o Pote da Ganancia", acoes.Contains("activate"),
                  "(nao apareceu 'activate')");
        }
    }
}
