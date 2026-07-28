using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Sonda da mudança de posição — `--probe-pos`.
    ///
    /// Invoca um monstro, passa o turno (posição só muda no turno seguinte, que é
    /// a regra que queremos ver o motor aplicar sozinho) e despeja TODAS as
    /// mensagens que chegam logo após o comando de reposição, com os bytes.
    /// É assim que se descobre o layout sem depender de documentação.
    /// </summary>
    public static class ProbePos
    {
        const int END = 0, AWAITING = 1;

        public static void Run(string sa)
        {
            Log.Info("=== sonda: mudanca de posicao ===\n");

            var deck = new List<uint>();
            for (int i = 0; i < 40; i++) deck.Add(i % 2 == 0 ? 5053103u : 15025844u);

            using var s = new DuelSession(sa, deck.ToArray(), deck.ToArray(), 777UL, 0x1000000UL);
            IntPtr duel = s.Handle;

            byte pending = 0;
            int freeZone = 0, idlePlayer = 0;
            var reposicionaveis = new List<(uint code, int index, byte loc, int seq)>();
            var invocaveis = new List<int>();
            bool mandouRepos = false, dumpando = false;
            int dumps = 0;

            for (int iter = 0; iter < 3000 && dumps < 12; iter++)
            {
                int status = YgoCoreAPI.OCG_DuelProcess(duel);
                IntPtr p = YgoCoreAPI.OCG_DuelGetMessage(duel, out uint len);

                if (p != IntPtr.Zero && len > 0)
                {
                    var buf = new byte[len];
                    Marshal.Copy(p, buf, 0, (int)len);
                    int off = 0;
                    while (off < buf.Length)
                    {
                        int mlen = BitConverter.ToInt32(buf, off); off += 4;
                        if (mlen <= 0 || off + mlen > buf.Length) break;
                        byte type = buf[off];

                        if (dumpando)
                        {
                            Log.Info($"  MSG {type,-4} len={mlen,-4} {Hex(buf, off, Math.Min(mlen, 40))}");
                            dumps++;
                        }

                        if (type == 11) LerIdle(buf, off, mlen, ref idlePlayer, reposicionaveis, invocaveis);
                        if (type == 18) { uint f = BitConverter.ToUInt32(buf, off + 3); freeZone = 0;
                            for (int z = 0; z < 5; z++) if ((f & (1u << z)) == 0) { freeZone = z; break; } }
                        if (type >= 10 && type <= 30) pending = type;
                        off += mlen;
                    }
                }

                if (status == END) { Log.Info("[sonda] duelo terminou."); break; }
                if (status != AWAITING) continue;

                byte[] resp;
                if (pending == 11 && idlePlayer == 0 && reposicionaveis.Count > 0 && !mandouRepos)
                {
                    var alvo = reposicionaveis[0];
                    Log.Info($"\n>> mudando posicao: code={alvo.code} loc=0x{alvo.loc:X} " +
                             $"seq={alvo.seq} idx={alvo.index}");
                    Log.Info("   mensagens que chegam depois:");
                    resp = I32((alvo.index << 16) | 2);
                    mandouRepos = true;
                    dumpando = true;
                }
                else
                {
                    resp = pending switch
                    {
                        11 => invocaveis.Count > 0 && idlePlayer == 0 ? I32(0) : I32(7),
                        18 => new byte[] { (byte)idlePlayer, 0x4, (byte)freeZone },
                        19 => I32(0x1),
                        16 => I32(-1),
                        10 => I32(3),
                        _ => I32(-1),
                    };
                }
                YgoCoreAPI.OCG_DuelSetResponse(duel, resp, (uint)resp.Length);
            }

            Log.Info(mandouRepos
                ? "\n=== fim: veja acima os ids das mensagens de mudanca de posicao ==="
                : "\n=== nunca apareceu carta reposicionavel ===");
        }

        static void LerIdle(byte[] d, int o, int mlen, ref int player,
                            List<(uint, int, byte, int)> repos, List<int> summon)
        {
            player = d[o + 1];
            repos.Clear(); summon.Clear();
            int limit = o + mlen, p = o + 2;

            int n = BitConverter.ToInt32(d, p); p += 4;
            for (int i = 0; i < n && p + 10 <= limit; i++) { summon.Add(i); p += 10; }
            int sp = BitConverter.ToInt32(d, p); p += 4; p += sp * 10;          // spsummon
            int nr = p + 4 <= limit ? BitConverter.ToInt32(d, p) : 0; p += 4;   // reposition
            for (int i = 0; i < nr && p + 7 <= limit; i++)
            {
                repos.Add((BitConverter.ToUInt32(d, p), i, d[p + 5], d[p + 6]));
                p += 7;
            }
        }

        static string Hex(byte[] d, int o, int n)
        {
            n = Math.Max(0, Math.Min(n, d.Length - o));
            var b = new byte[n]; Array.Copy(d, o, b, 0, n);
            return BitConverter.ToString(b).Replace("-", " ");
        }

        static byte[] I32(params int[] v)
        {
            var b = new byte[v.Length * 4];
            for (int i = 0; i < v.Length; i++) BitConverter.GetBytes(v[i]).CopyTo(b, i * 4);
            return b;
        }
    }
}
