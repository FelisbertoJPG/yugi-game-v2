using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Sonda do SELECT_CHAIN (16) — `--probe-chain`.
    ///
    /// Monta o cenário onde uma corrente REALMENTE abre: o jogador 0 seta uma
    /// Mirror Force e passa o turno de campo vazio; o NPC invoca e ataca direto,
    /// e o motor pergunta ao jogador 0 se quer encadear a Mirror Force. Aí
    /// despejamos os bytes crus e tentamos achar o cabeçalho/entrada por
    /// tentativa — mesma disciplina do --probe-battle, porque chutar offset aqui
    /// entregaria a resposta errada ao motor.
    /// </summary>
    public static class ProbeChain
    {
        const uint MIRROR = 44095762;   // Mirror Force (armadilha normal)
        const uint OX = 5053103;        // Battle Ox 1700/1000 (Nv4)

        static bool _capturou;

        public static int Run(string sa)
        {
            Log.Info("=== sonda: SELECT_CHAIN ===\n");

            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(MIRROR);
            for (int i = 0; i < 20; i++) deck.Add(OX);

            InteractiveDuel.ChainProbe = Dump;

            // Alguns seeds até cair uma mão com Mirror Force para o jogador 0.
            foreach (ulong seed in new ulong[] { 7, 31337, 999, 2024, 12345, 555, 88 })
            {
                _capturou = false;
                using var duel = new InteractiveDuel(sa, deck.ToArray(), seed, 0x1000000UL, npc: true);
                Dirigir(duel);
                if (_capturou) break;
                Log.Info($"[probe-chain] seed {seed}: nenhuma corrente abriu, tentando outro…");
            }

            InteractiveDuel.ChainProbe = null;
            if (!_capturou) Log.Err("[probe-chain] NENHUMA corrente capturada.");
            Log.Info("\n=== fim ===");
            return _capturou ? 0 : 1;
        }

        /// <summary>Jogador 0: seta Mirror Force quando dá e passa o turno (campo vazio).</summary>
        static void Dirigir(InteractiveDuel duel)
        {
            var r = duel.Advance();
            for (int guard = 0; guard < 60 && !r.ended && !_capturou; guard++)
            {
                var q = r.question;
                if (q == null) break;

                if (q.kind == "place")
                    Log.Info($"  [place] zoneType={q.zoneType} zonas=[{string.Join(",", q.zones)}]");

                r = q.kind switch
                {
                    "idle" => Idle(duel, q),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "selectcard" or "selecttribute" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    "chain" => duel.Respond("endturn", 0),  // não deve chegar aqui (auto-declina)
                    _ => duel.Respond("endturn", 0),
                };
                LogEventos(r);
            }
        }

        static void LogEventos(InteractiveDuel.Result r)
        {
            foreach (var e in r.events)
            {
                var t = e.GetType();
                string kind = t.GetProperty("type")?.GetValue(e) as string;
                if (kind == "retry") Log.Err("  >> RETRY (o motor recusou a resposta anterior)");
                if (kind == "npc")
                    Log.Info($"  >> NPC: {t.GetProperty("action")?.GetValue(e)} " +
                             $"({t.GetProperty("why")?.GetValue(e)})");
                if (kind == "move")
                {
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    if (code == MIRROR) Log.Info("  >> MOVE da Mirror Force (entrou em campo)");
                }
            }
        }

        static InteractiveDuel.Result Idle(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            // Seta a Mirror Force se estiver na mão; nunca invoca (campo vazio força
            // o ataque direto do NPC, que abre a corrente).
            var mf = q.settableST.FirstOrDefault(a => a.code == MIRROR);
            if (mf.code == MIRROR) return duel.Respond("setspell", mf.index);
            return duel.Respond("endturn", 0);
        }

        // ------------------------------------------------------------------
        static readonly byte[] MirrorBytes = BitConverter.GetBytes(MIRROR);

        static int Acha(byte[] d, int o, int mlen)
        {
            for (int p = o; p + 4 <= o + mlen; p++)
                if (d[p] == MirrorBytes[0] && d[p + 1] == MirrorBytes[1] &&
                    d[p + 2] == MirrorBytes[2] && d[p + 3] == MirrorBytes[3]) return p - o;
            return -1;
        }

        static void Dump(byte[] d, int o, int mlen)
        {
            if (_capturou) return;

            int at = Acha(d, o, mlen);
            Log.Info($"--- SELECT_CHAIN len={mlen} player={d[o + 1]} " +
                     (at >= 0 ? $"[Mirror Force no offset {at}]" : "(sem Mirror Force — janela vazia)") + " ---");
            Log.Info($"    bytes: {Hex(d, o, Math.Min(mlen, 96))}");
            if (at < 0) return;   // só interessa a corrente que OFERECE a Mirror Force
            _capturou = true;

            // Procura o cabeçalho: varia quantos bytes vêm depois de type+player,
            // então testa e vê onde um 'count' pequeno deixa as entradas fechando
            // exatamente no fim da mensagem.
            foreach (int header in new[] { 2, 3, 6, 7, 10, 11, 12, 14, 15, 18, 19 })
            {
                if (o + header + 4 > o + mlen) continue;
                int cnt = BitConverter.ToInt32(d, o + header);
                if (cnt < 1 || cnt > 20) continue;
                int rest = mlen - header - 4;
                if (rest <= 0 || rest % cnt != 0) continue;
                int entry = rest / cnt;
                Log.Info($"    header={header,-2} count={cnt} entry={entry} (fecha exatamente)");

                // Se a entrada tem pelo menos code(4)+ctrl+loc, mostra o primeiro.
                int p = o + header + 4;
                if (entry >= 6)
                {
                    uint code = BitConverter.ToUInt32(d, p);
                    byte ctrl = d[p + 4], loc = d[p + 5];
                    Log.Info($"      entrada[0]: code={code} ctrl={ctrl} loc=0x{loc:X2}" +
                             (code == MIRROR ? "  <== Mirror Force!" : ""));
                }
            }
        }

        static string Hex(byte[] d, int o, int n)
        {
            n = Math.Max(0, Math.Min(n, d.Length - o));
            var b = new byte[n]; Array.Copy(d, o, b, 0, n);
            return BitConverter.ToString(b).Replace("-", " ");
        }
    }
}
