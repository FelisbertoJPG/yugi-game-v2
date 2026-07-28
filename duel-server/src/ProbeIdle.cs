using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Sonda do layout do MSG_SELECT_IDLECMD — `--probe-idle`.
    ///
    /// A mensagem termina em 3 bytes de flag (to_bp, to_ep, shuffle). Isso dá um
    /// verificador exato: se os tamanhos de entrada estiverem certos, o cursor
    /// pousa em `fim - 3`. Testamos as combinações candidatas e vemos qual fecha
    /// a conta — em vez de confiar num tamanho decorado.
    /// </summary>
    public static class ProbeIdle
    {
        const int END = 0, AWAITING = 1;

        public static void Run(string sa)
        {
            Log.Info("=== sonda do layout do SELECT_IDLECMD ===\n");

            var deck = BuildDeck();
            using var s = new DuelSession(sa, deck, deck, 4242UL, 0x1000000UL);
            IntPtr duel = s.Handle;

            byte pending = 0;
            int freeZone = 0, examinadas = 0;

            for (int iter = 0; iter < 6000 && examinadas < 14; iter++)
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
                        if (type == 11) { if (Analisar(buf, off, mlen)) examinadas++; }
                        if (type == 18) { uint f = BitConverter.ToUInt32(buf, off + 3); freeZone = 0;
                            for (int z = 0; z < 5; z++) if ((f & (1u << z)) == 0) { freeZone = z; break; } }
                        if (type >= 10 && type <= 30) pending = type;
                        off += mlen;
                    }
                }

                if (status == END) break;
                if (status != AWAITING) continue;

                // Invoca sempre que der: reposition só aparece quando existe um
                // monstro com a face para cima em campo, de um turno anterior.
                byte[] resp = pending switch
                {
                    11 => _podeInvocar ? I32(0) : I32(7),
                    18 => new byte[] { (byte)_idlePlayer, 0x4, (byte)freeZone },
                    19 => I32(0x1),
                    16 => I32(-1),
                    10 => I32(3),
                    _ => I32(-1),
                };
                YgoCoreAPI.OCG_DuelSetResponse(duel, resp, (uint)resp.Length);
            }
        }

        /// <summary>Tenta combinações de tamanho e diz qual fecha a mensagem.</summary>
        static bool _podeInvocar;
        static int _idlePlayer;

        static bool Analisar(byte[] d, int o, int mlen)
        {
            int limit = o + mlen;
            byte player = d[o + 1];
            _idlePlayer = player;

            int nSummon = BitConverter.ToInt32(d, o + 2);
            _podeInvocar = nSummon > 0;

            Log.Info($"--- SELECT_IDLECMD player={player} len={mlen} (summon={nSummon}) ---");
            Log.Info($"    bytes: {Hex(d, o, Math.Min(mlen, 80))}");

            var ok = new List<string>();
            int nRepos = -1;
            foreach (int repos in new[] { 7, 10 })
                foreach (int act in new[] { 18, 19 })
                {
                    if (Tenta(d, o, mlen, repos, act, out int nr, out string detalhe))
                    { ok.Add($"repos={repos} act={act}"); nRepos = nr; }
                    Log.Info($"    repos={repos} act={act}: {detalhe}");
                }

            // Só é informativo quando as listas que estamos medindo não estão vazias.
            bool decisivo = ok.Count == 1;
            Log.Info(decisivo
                ? $"    >>> DECISIVO: {ok[0]}"
                : $"    >>> ambiguo (listas vazias): {(ok.Count == 0 ? "NENHUMA" : string.Join(" | ", ok))}");
            Log.Info("");
            return decisivo;
        }

        /// <summary>
        /// Percorre as 6 listas e verifica se o cursor termina exatamente 3 bytes
        /// antes do fim (os flags to_bp / to_ep / shuffle).
        /// </summary>
        static bool Tenta(byte[] d, int o, int mlen, int repos, int act,
                          out int nRepos, out string detalhe)
        {
            int limit = o + mlen;
            int p = o + 2;
            var contagens = new List<int>();
            nRepos = 0;
            try
            {
                int idx = 0;
                foreach (int tam in new[] { 10, 10, repos, 10, 10, act })
                {
                    if (p + 4 > limit) { detalhe = "estourou ao ler contador"; return false; }
                    int n = BitConverter.ToInt32(d, p); p += 4;
                    if (n < 0 || n > 60) { detalhe = $"contador absurdo ({n})"; return false; }
                    contagens.Add(n);
                    if (idx == 2) nRepos = n;
                    p += n * tam;
                    idx++;
                    if (p > limit) { detalhe = "estourou lendo entradas"; return false; }
                }
            }
            catch { detalhe = "excecao"; return false; }

            int sobra = limit - p;
            detalhe = $"listas=[{string.Join(",", contagens)}] sobra={sobra} " +
                      (sobra == 3 ? "<== FECHA" : "");
            return sobra == 3;
        }

        static string Hex(byte[] d, int o, int n)
        {
            n = Math.Min(n, d.Length - o);
            var b = new byte[n]; Array.Copy(d, o, b, 0, n);
            return BitConverter.ToString(b).Replace("-", " ");
        }

        static byte[] I32(params int[] v)
        {
            var b = new byte[v.Length * 4];
            for (int i = 0; i < v.Length; i++) BitConverter.GetBytes(v[i]).CopyTo(b, i * 4);
            return b;
        }

        /// <summary>Deck com muitas magias ativáveis, para a lista ter várias entradas.</summary>
        static uint[] BuildDeck()
        {
            var d = new List<uint>();
            for (int i = 0; i < 10; i++) d.Add(55144522);  // Pote da Ganancia
            for (int i = 0; i < 10; i++) d.Add(83764718);  // Monster Reborn
            for (int i = 0; i < 10; i++) d.Add(5053103);   // Battle Ox
            while (d.Count < 40) d.Add(15025844);          // Mystical Elf
            return d.ToArray();
        }
    }
}
