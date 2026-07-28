using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Sonda da Battle Phase — `--probe-battle`.
    ///
    /// Monta monstros dos dois lados, entra na batalha e despeja o
    /// SELECT_BATTLECMD cru + todas as mensagens do ataque. É daqui que sai o
    /// layout real, em vez de assumir tamanhos e desalinhar em silêncio (já
    /// aconteceu com a lista de ativáveis).
    /// </summary>
    public static class ProbeBattle
    {
        const int END = 0, AWAITING = 1;

        static string Nome(byte id) => id switch
        {
            1 => "RETRY", 2 => "HINT", 10 => "SELECT_BATTLECMD", 11 => "SELECT_IDLECMD",
            16 => "SELECT_CHAIN", 18 => "SELECT_PLACE", 19 => "SELECT_POSITION",
            40 => "NEW_TURN", 41 => "NEW_PHASE", 50 => "MOVE", 53 => "POS_CHANGE",
            60 => "SUMMONING", 61 => "SUMMONED", 90 => "DRAW",
            91 => "DAMAGE", 92 => "RECOVER", 110 => "WIN",
            _ => $"?{id}"
        };

        public static void Run(string sa)
        {
            Log.Info("=== sonda: Battle Phase ===\n");

            // ATK bem diferentes: garante destruição de um lado e dano no outro.
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(5053103);   // Battle Ox 1700/1000
            for (int i = 0; i < 20; i++) deck.Add(91152256);  // Celtic Guardian 1400/1200

            using var s = new DuelSession(sa, deck.ToArray(), deck.ToArray(), 31337UL, 0x1000000UL);
            IntPtr duel = s.Handle;

            byte pending = 0;
            int freeZone = 0, idlePlayer = 0;
            bool podeBattle = false, temInvocavel = false;
            bool dumpando = false;
            int dumps = 0, ataques = 0;

            for (int iter = 0; iter < 4000 && dumps < 40; iter++)
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

                        if (type == 10) DumpBattleCmd(buf, off, mlen);
                        else if (dumpando && type != 16)
                        {
                            Log.Info($"  MSG {Nome(type),-18} id={type,-4} len={mlen,-4} " +
                                     $"{Hex(buf, off, Math.Min(mlen, 44))}");
                            dumps++;
                        }

                        if (type == 11) LerIdle(buf, off, mlen, ref idlePlayer,
                                                ref temInvocavel, ref podeBattle);
                        if (type == 18) { uint f = BitConverter.ToUInt32(buf, off + 3); freeZone = 0;
                            for (int z = 0; z < 5; z++) if ((f & (1u << z)) == 0) { freeZone = z; break; } }
                        if (type >= 10 && type <= 30) pending = type;
                        off += mlen;
                    }
                }

                if (status == END) { Log.Info("\n[sonda] duelo terminou."); break; }
                if (status != AWAITING) continue;

                byte[] resp;
                if (pending == 10)
                {
                    // Tenta atacar com o índice 0; se não houver atacante, sai da batalha.
                    if (_atacantes > 0 && ataques < 3)
                    {
                        // A lista de ATIVÁVEIS vem antes da de atacantes, então o
                        // comando 0 é "ativar" e o ataque é o comando 1.
                        Log.Info($"\n>> atacando com o indice 0 (dos {_atacantes} atacantes) — cmd 1");
                        Log.Info("   mensagens do ataque:");
                        resp = I32((0 << 16) | 1);
                        ataques++;
                        dumpando = true;
                    }
                    else resp = I32(3);           // encerra a batalha
                }
                else if (pending == 11)
                {
                    if (idlePlayer == 0 && podeBattle && !temInvocavel) resp = I32(6);   // ir pra Battle
                    else if (temInvocavel) resp = I32(0);                                 // invocar
                    else if (podeBattle) resp = I32(6);
                    else resp = I32(7);
                }
                else if (pending == 15)
                {
                    // Escolha do ALVO do ataque. Formato de parse_response_cards:
                    // [int32 tipo=0][uint32 quantidade][índices uint32].
                    Log.Info("   >> escolhendo o alvo do ataque (indice 0)");
                    var b = new byte[12];
                    BitConverter.GetBytes(0).CopyTo(b, 0);
                    BitConverter.GetBytes(1u).CopyTo(b, 4);
                    BitConverter.GetBytes(0u).CopyTo(b, 8);
                    resp = b;
                }
                else resp = pending switch
                {
                    18 => new byte[] { (byte)idlePlayer, 0x4, (byte)freeZone },
                    19 => I32(0x1),
                    16 => I32(-1),
                    _ => I32(-1),
                };

                YgoCoreAPI.OCG_DuelSetResponse(duel, resp, (uint)resp.Length);
            }
            Log.Info("\n=== fim ===");
        }

        static int _atacantes;

        /// <summary>
        /// Despeja o SELECT_BATTLECMD e testa os tamanhos de entrada plausíveis.
        /// A mensagem termina com 2 flags (pode Main2, pode End), então o cursor
        /// tem de parar exatamente 2 bytes antes do fim — mesmo truque do idle.
        /// </summary>
        static void DumpBattleCmd(byte[] d, int o, int mlen)
        {
            Log.Info($"\n--- SELECT_BATTLECMD len={mlen} player={d[o + 1]} ---");
            Log.Info($"    bytes: {Hex(d, o, Math.Min(mlen, 80))}");

            foreach (int atv in new[] { 18, 19 })
                foreach (int atk in new[] { 10, 11, 7, 8 })
                {
                    int p = o + 2, limit = o + mlen;
                    bool ok = true;
                    int nAtv = 0, nAtk = 0;
                    try
                    {
                        nAtv = BitConverter.ToInt32(d, p); p += 4;
                        if (nAtv < 0 || nAtv > 40) ok = false; else p += nAtv * atv;
                        if (ok && p + 4 <= limit)
                        {
                            nAtk = BitConverter.ToInt32(d, p); p += 4;
                            if (nAtk < 0 || nAtk > 40) ok = false; else p += nAtk * atk;
                        }
                        else ok = false;
                    }
                    catch { ok = false; }

                    int sobra = ok ? limit - p : -1;
                    string marca = (ok && sobra == 2) ? "  <== FECHA" : "";
                    Log.Info($"    ativ={atv} atk={atk}: listas=[{nAtv},{nAtk}] sobra={sobra}{marca}");
                    if (ok && sobra == 2) _atacantes = nAtk;
                }
        }

        static void LerIdle(byte[] d, int o, int mlen, ref int player,
                            ref bool temInvocavel, ref bool podeBattle)
        {
            player = d[o + 1];
            int limit = o + mlen;
            temInvocavel = BitConverter.ToInt32(d, o + 2) > 0;
            podeBattle = d[limit - 3] != 0;
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
