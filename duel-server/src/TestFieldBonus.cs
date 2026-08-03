using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do "Bônus de Campo" — `--test-fieldbonus`.
    ///
    /// O editor de tabuleiro (`web/campo.html`) deixa fixar uma magia de campo
    /// já ativa desde o início do duelo (estilo "campo de Floresta do Weevil"
    /// no anime). A injeção mora em `DuelSession.InjectField` — só materializa
    /// a carta virada pra cima na zona de campo antes de `OCG_StartDuel`; quem
    /// aplica o efeito é o Lua da PRÓPRIA carta, sem nada reimplementado aqui.
    ///
    /// Prova disso: Forest dá +200 de ATK a monstro Tipo Inseto. Um Inseto
    /// normal-summonado com Forest no campo tem que consultar ATK = base + 200
    /// no PRÓPRIO motor (`InteractiveDuel.QueryAtk`, a mesma consulta que a
    /// Equip Spell usa) — não é uma conta nossa, é o que o core responde.
    ///
    /// Também prova que o evento `stats` (o que acende o destaque ".boost" no
    /// ATK em `duel.html`) chega sozinho quando um monstro entra em campo já
    /// sob o bônus — antes só disparava em MSG_EQUIP; pedido do usuário depois
    /// de testar um tabuleiro com Forest injetada pro deck do Weevil e ver que
    /// o ATK do Inseto não destacava na tela.
    /// </summary>
    public static class TestFieldBonus
    {
        const uint FOREST = 87430998;
        const uint KAMAKIRI = 3134241; // Flying Kamakiri #2 — Inseto Nv4, ATK 1500

        static int _pass, _fail;

        public static int Run(string sa)
        {
            Log.Info("=== teste: BONUS DE CAMPO (Forest +200 ATK a Inseto) ===\n");
            ForestDaBonusDeVerdade(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void ForestDaBonusDeVerdade(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 14; i++) deck.Add(KAMAKIRI);
            while (deck.Count < 40) deck.Add(5053103); // Battle Ox, filler inerte

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 998877UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: null, npcExtra: null,
                                                 fieldSpell: FOREST);
            var r = duel.Advance();

            bool summonou = false;
            int seq = -1;
            // Prova que o `duel.html` de verdade recebe o destaque de ATK: não
            // basta o QueryAtk manual (linha 88) responder certo, o evento
            // `stats` precisa aparecer no MESMO lote da invocação — é ele que
            // acende o ".boost" na carta (ver InteractiveDuel.cs, case 50/MOVE).
            bool statsEventChegou = false;
            int statsAtk = -1, statsBaseAtk = -1;

            for (int guard = 0; guard < 30 && !r.ended && !summonou; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    var tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        if (code == KAMAKIRI && loc == 4) // LOCATION_MZONE
                        {
                            summonou = true;
                            seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        }
                    }
                    else if (tipo == "stats")
                    {
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        int evSeq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        if (loc == 4 && evSeq == seq)
                        {
                            statsEventChegou = true;
                            statsAtk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? -1);
                            statsBaseAtk = Convert.ToInt32(t.GetProperty("baseAtk")?.GetValue(e) ?? -1);
                        }
                    }
                }
                if (summonou) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var s = q.summonable.FirstOrDefault(a => a.code == KAMAKIRI);
                        if (s.code == KAMAKIRI) { r = duel.Respond("summon", s.index); break; }
                        r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "yesno": r = duel.Respond("yesno", 0); break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check("Flying Kamakiri #2 foi normal-summonado", summonou);
            if (!summonou) return;

            var (atk, baseAtk) = duel.QueryAtk(controller: 0, seq);
            Log.Info($"  ATK consultado no motor: base={baseAtk} atual={atk} (Forest ativo deveria dar base+200)");
            Check("Forest aplicou +200 de ATK de verdade (consulta no core, nao conta nossa)",
                  atk == 1700, $"(veio {atk}, base {baseAtk})");

            Check("o evento 'stats' chegou no MESMO lote da invocacao (duel.html destaca o ATK)",
                  statsEventChegou, $"(chegou={statsEventChegou})");
            if (statsEventChegou)
                Check("o evento 'stats' trouxe os numeros certos (1700 sobre base 1500)",
                      statsAtk == 1700 && statsBaseAtk == 1500, $"(atk={statsAtk}, baseAtk={statsBaseAtk})");
        }

        static void Check(string nome, bool ok, string extra = "")
        {
            if (ok) { _pass++; Log.Info($"  OK   {nome} {extra}"); }
            else { _fail++; Log.Err($"  FALHOU {nome} {extra}"); }
        }
    }
}
