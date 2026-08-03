using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação das cartas que o deck do Weevil trouxe para a Lista 1
    /// — `--test-weevil`.
    ///
    /// São as 6 primeiras cartas COM EFEITO que entraram na Lista 1 por causa de
    /// um deck de NPC (`decks/npc/wevil/deck_1.ydk`). Como sempre, nenhum efeito
    /// foi escrito aqui: o que este teste prova é que o Lua que já vem no
    /// ocgcore roda de verdade para cada uma delas. Cada checagem consulta o
    /// motor (ATK pela `QueryAtk`, listas de invocação pelo próprio idle), nunca
    /// uma conta nossa:
    ///
    ///   1. Insect Armor with Laser Cannon — Petit Moth 300 ATK vira 1000 (+700).
    ///   2. Cocoon of Evolution — equipado da mão no Petit Moth, o ATK dele passa
    ///      a ser o do casulo (300 -> 0).
    ///   3. Insect Imitation — tributa o Petit Moth (Nv1) e Invoca Especialmente
    ///      do DECK um Inseto de nível +1 (Basic Insect, Nv2).
    ///   4. Larvae Moth / Great Moth / Perfectly Ultimate Great Moth — nenhuma
    ///      pode ser Invocada Normalmente, e cada uma só aparece em
    ///      `spSummonable` depois de N turnos com o casulo equipado, na ordem
    ///      2 -> 4 -> 6. É a contagem de turnos do Lua delas, medida turno a
    ///      turno.
    /// </summary>
    public static class TestWeevil
    {
        const uint PETIT_MOTH = 58192742;   // vanilla Nv1 300/200 — a base de tudo
        const uint COCOON = 40240595;       // Cocoon of Evolution (Nv3 0/2000)
        const uint LARVAE = 87756343;       // Larvae Moth (Nv2 500/400) — 2 turnos
        const uint GREAT = 14141448;        // Great Moth (Nv8 2600/2500) — 4 turnos
        const uint PERFECT = 48579379;      // Perfectly Ultimate Great Moth — 6 turnos
        const uint IMITATION = 96965364;    // Insect Imitation
        const uint LASER_ARMOR = 3492538;   // Insect Armor with Laser Cannon (+700)
        const uint BASIC_INSECT = 89091579; // vanilla Nv2 500/700 — alvo do Imitation
        const uint BATTLE_OX = 5053103;     // filler inerte

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== equipamento: Insect Armor with Laser Cannon (+700) ===\n");
            ArmorDaMais700(sa);
            Log.Info("\n=== Cocoon of Evolution equipa e troca o ATK do Petit Moth ===\n");
            CasuloTrocaAtk(sa);
            Log.Info("\n=== Insect Imitation invoca do DECK um Inseto de nivel +1 ===\n");
            ImitationInvocaDoDeck(sa);
            Log.Info("\n=== evolucao das mariposas (contagem de turnos do casulo) ===\n");
            MariposasEvoluem(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // --------------------------------------------------------------- helpers
        /// <summary>Responde o que NÃO é a decisão em teste (colocação, posição,
        /// corrente, seleção trivial). O deck de cada cenário é montado para que
        /// a primeira opção seja sempre a única válida.</summary>
        static InteractiveDuel.Result Auto(InteractiveDuel duel, InteractiveDuel.Question q) => q.kind switch
        {
            "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
            "position" => duel.Respond("position", 0x1),
            "chain" => duel.Respond("chain", -1),
            "yesno" => duel.Respond("yesno", 1),
            "selectoption" => duel.Respond("select", 0),
            "selectcard" or "selecttribute" or "selectsum" or "selectunselect" =>
                duel.Respond("select", 0, q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
            "battle" => duel.Respond("endbattle", 0),
            _ => duel.Respond("endturn", 0),
        };

        /// <summary>Onde o monstro de código `code` está na zona de monstros do
        /// jogador 0, lido dos eventos `move` — é o `seq` que a QueryAtk pede.</summary>
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

        /// <summary>Invoca 1 Petit Moth e ativa da mão a carta `alvo`, devolvendo
        /// o duelo parado logo depois. Base dos cenários 1 e 2.</summary>
        static (InteractiveDuel duel, InteractiveDuel.Result r, int seq, bool ativou)
            PetitMothComCartaAtiva(string sa, List<uint> deck, uint alvo, ulong seed)
        {
            var duel = new InteractiveDuel(sa, deck.ToArray(), seed, 0x1000000UL,
                                           npc: false, npcDeck: null, extra: null, npcExtra: null);
            var r = duel.Advance();
            int seq = -1;
            bool invocou = false, ativou = false;

            for (int guard = 0; guard < 60 && !r.ended && !ativou; guard++)
            {
                int s = SeqDoMove(r.events, PETIT_MOTH);
                if (s >= 0) { seq = s; invocou = true; }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    if (!invocou)
                    {
                        var sum = q.summonable.FirstOrDefault(a => a.code == PETIT_MOTH);
                        if (sum.code == PETIT_MOTH) { r = duel.Respond("summon", sum.index); continue; }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    var act = q.activatable.FirstOrDefault(a => a.code == alvo);
                    if (act.code == alvo) { ativou = true; r = duel.Respond("activate", act.index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Auto(duel, q);
            }

            // depois de ativar ainda vem a seleção do alvo / colocação da magia
            for (int guard = 0; guard < 20 && !r.ended && r.question != null
                                && r.question.kind != "idle"; guard++)
                r = Auto(duel, r.question);

            int s2 = SeqDoMove(r.events, PETIT_MOTH);
            if (s2 >= 0) seq = s2;
            return (duel, r, seq, ativou);
        }

        // --------------------------------------------------- 1. equipamento +700
        static void ArmorDaMais700(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) { deck.Add(PETIT_MOTH); deck.Add(LASER_ARMOR); }

            var (duel, _, seq, ativou) = PetitMothComCartaAtiva(sa, deck, LASER_ARMOR, 424242UL);
            using (duel)
            {
                Check("Insect Armor with Laser Cannon foi ativada num Petit Moth", ativou && seq >= 0);
                if (!ativou || seq < 0) return;

                var (atk, baseAtk) = duel.QueryAtk(controller: 0, seq);
                Log.Info($"  ATK consultado no motor: base={baseAtk} atual={atk} (esperado 300 -> 1000)");
                Check("o equipamento deu +700 de ATK de verdade (consulta no core)",
                      atk == 1000, $"(veio {atk}, base {baseAtk})");
            }
        }

        // ------------------------------------------------- 2. Cocoon of Evolution
        static void CasuloTrocaAtk(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) { deck.Add(PETIT_MOTH); deck.Add(COCOON); }

            var (duel, _, seq, ativou) = PetitMothComCartaAtiva(sa, deck, COCOON, 515151UL);
            using (duel)
            {
                Check("Cocoon of Evolution foi equipado da mao a um Petit Moth", ativou && seq >= 0);
                if (!ativou || seq < 0) return;

                var (atk, baseAtk) = duel.QueryAtk(controller: 0, seq);
                Log.Info($"  ATK consultado no motor: base={baseAtk} atual={atk} (esperado 300 -> 0)");
                Check("o Petit Moth passou a usar o ATK do casulo (300 -> 0)",
                      atk == 0, $"(veio {atk}, base {baseAtk})");
            }
        }

        // ---------------------------------------------------- 3. Insect Imitation
        static void ImitationInvocaDoDeck(string sa)
        {
            // Só Petit Moth (Nv1) e Basic Insect (Nv2) como Insetos: o único
            // "nível +1" possível a partir do Petit Moth é o Basic Insect, então
            // a seleção do motor tem uma opção só e o Auto() acerta sozinho.
            var deck = new List<uint>();
            for (int i = 0; i < 13; i++) { deck.Add(PETIT_MOTH); deck.Add(IMITATION); deck.Add(BASIC_INSECT); }
            deck.Add(BATTLE_OX);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 626262UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: null, npcExtra: null);
            var r = duel.Advance();
            bool invocou = false, ativou = false, veioDoDeck = false;

            for (int guard = 0; guard < 120 && !r.ended && !veioDoDeck; guard++)
            {
                if (SeqDoMove(r.events, PETIT_MOTH) >= 0) invocou = true;
                if (ativou && SeqDoMove(r.events, BASIC_INSECT) >= 0) veioDoDeck = true;

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    if (!invocou)
                    {
                        var sum = q.summonable.FirstOrDefault(a => a.code == PETIT_MOTH);
                        if (sum.code == PETIT_MOTH) { r = duel.Respond("summon", sum.index); continue; }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    var act = q.activatable.FirstOrDefault(a => a.code == IMITATION);
                    if (act.code == IMITATION) { ativou = true; r = duel.Respond("activate", act.index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Auto(duel, q);
            }

            Check("Insect Imitation foi ativada com um Petit Moth em campo", ativou);
            Check("Basic Insect (Nv2) foi Invocado Especialmente vindo do DECK", veioDoDeck);
        }

        // ------------------------------------------------- 4. evolucao das mothas
        static void MariposasEvoluem(string sa)
        {
            // Deck saturado: o objetivo é a MECÂNICA (a contagem de turnos do
            // casulo), não a consistência de um deck real — mesmo espírito do
            // TestToon/TestSynchro.
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(PETIT_MOTH, 8); Add(COCOON, 8); Add(LARVAE, 8); Add(GREAT, 8); Add(PERFECT, 8);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 737373UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: null, npcExtra: null);
            var r = duel.Advance();

            bool invocou = false, equipou = false;
            int meuTurno = 0, turnoDoEquip = -1;
            var primeiroTurnoSpSummon = new Dictionary<uint, int>();
            bool normalSummonProibido = true;

            for (int guard = 0; guard < 600 && !r.ended; guard++)
            {
                if (SeqDoMove(r.events, PETIT_MOTH) >= 0) invocou = true;

                var q = r.question;
                if (q == null) break;

                if (q.kind != "idle" || q.player != 0) { r = Auto(duel, q); continue; }

                meuTurno++;

                // Controle: nenhuma das três pode ser Invocada Normalmente/Setada.
                foreach (var lista in new[] { q.summonable, q.settable })
                    if (lista.Any(a => a.code == LARVAE || a.code == GREAT || a.code == PERFECT))
                        normalSummonProibido = false;

                // Registra em que turno o motor passou a OFERECER cada mariposa.
                if (equipou)
                    foreach (var m in new[] { LARVAE, GREAT, PERFECT })
                        if (!primeiroTurnoSpSummon.ContainsKey(m) && q.spSummonable.Any(a => a.code == m))
                            primeiroTurnoSpSummon[m] = meuTurno - turnoDoEquip;

                if (primeiroTurnoSpSummon.Count == 3) break;

                if (!invocou)
                {
                    var sum = q.summonable.FirstOrDefault(a => a.code == PETIT_MOTH);
                    if (sum.code == PETIT_MOTH) { meuTurno--; r = duel.Respond("summon", sum.index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                if (!equipou)
                {
                    var act = q.activatable.FirstOrDefault(a => a.code == COCOON);
                    if (act.code == COCOON)
                    {
                        equipou = true; turnoDoEquip = meuTurno;
                        meuTurno--;
                        r = duel.Respond("activate", act.index);
                        continue;
                    }
                }
                // Nunca ataca nem invoca mais nada: o Petit Moth precisa
                // sobreviver dentro do casulo até a última mariposa.
                r = duel.Respond("endturn", 0);
            }

            string Quando(uint c) => primeiroTurnoSpSummon.TryGetValue(c, out var t) ? $"{t}o turno" : "nunca";
            Log.Info($"  casulo equipado no meu turno {turnoDoEquip}");
            Log.Info($"  Larvae Moth  disponivel: {Quando(LARVAE)}");
            Log.Info($"  Great Moth   disponivel: {Quando(GREAT)}");
            Log.Info($"  Perf. Ultimate disponivel: {Quando(PERFECT)}");

            Check("o casulo chegou a ser equipado", equipou);
            Check("nenhuma mariposa pode ser Invocada Normalmente/Setada", normalSummonProibido);
            Check("Larvae Moth liberada no 2o turno com o casulo",
                  primeiroTurnoSpSummon.TryGetValue(LARVAE, out var tl) && tl == 2, $"(veio {Quando(LARVAE)})");
            Check("Great Moth liberado no 4o turno com o casulo",
                  primeiroTurnoSpSummon.TryGetValue(GREAT, out var tg) && tg == 4, $"(veio {Quando(GREAT)})");
            Check("Perfectly Ultimate Great Moth liberado no 6o turno com o casulo",
                  primeiroTurnoSpSummon.TryGetValue(PERFECT, out var tp) && tp == 6, $"(veio {Quando(PERFECT)})");
        }
    }
}
