using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Sonda do protocolo de SELECT_TRIBUTE (20) / SELECT_CARD (15) — `--probe-tribute`.
    ///
    /// O formato de resposta dessas duas mensagens nunca tinha sido decifrado
    /// (tentativas anteriores deram todas MSG_RETRY). Em vez de chutar mais um
    /// encoding, esta sonda:
    ///   1. monta um tabuleiro de verdade (invoca monstros Nv4 em turnos seguidos),
    ///   2. tenta invocar um Nv6, o que obriga o motor a pedir tributo,
    ///   3. mede o tamanho de entrada da lista a partir do tamanho da mensagem,
    ///   4. e testa candidatos de resposta um a um, detectando o RETRY.
    ///
    /// Depois de um RETRY o motor NÃO reenvia a pergunta — ele espera outra
    /// resposta para a mesma. Por isso guardamos qual era a pergunta pendente.
    /// </summary>
    public static class ProbeTribute
    {
        const int END = 0, AWAITING = 1, CONTINUE = 2;

        // Vanilla, sem script Lua para atrapalhar: o efeito não interfere na sonda.
        const uint BATTLE_OX = 5053103;       // Nv4
        const uint MYSTICAL_ELF = 15025844;   // Nv4
        const uint CELTIC = 91152256;         // Nv4
        const uint SUMMONED_SKULL = 70781052; // Nv6 -> exige 1 tributo
        const uint GAIA = 6368038;            // Nv7 -> exige 2 tributos

        static string MsgName(byte id) => id switch
        {
            1 => "RETRY", 2 => "HINT", 3 => "WAITING", 4 => "START",
            10 => "SELECT_BATTLECMD", 11 => "SELECT_IDLECMD", 12 => "SELECT_EFFECTYN",
            13 => "SELECT_YESNO", 14 => "SELECT_OPTION", 15 => "SELECT_CARD",
            16 => "SELECT_CHAIN", 18 => "SELECT_PLACE", 19 => "SELECT_POSITION",
            20 => "SELECT_TRIBUTE", 21 => "SORT_CHAIN", 22 => "SELECT_COUNTER",
            23 => "SELECT_SUM", 24 => "SELECT_DISFIELD", 25 => "SORT_CARD",
            26 => "SELECT_UNSELECT", 40 => "NEW_TURN", 41 => "NEW_PHASE",
            50 => "MOVE", 60 => "SUMMONING", 61 => "SUMMONED", 90 => "DRAW",
            110 => "WIN", _ => $"?{id}"
        };

        /// <summary>Uma carta oferecida na lista de seleção.</summary>
        struct Offer { public uint code; public byte ctrl, loc; public int seq; public byte release; }
        static readonly List<Offer> _offers = new();

        /// <summary>
        /// Gera o espaço de formatos de resposta em vez de tentar um palpite por
        /// vez: combina larguras de contador (nenhum/1/2/4 bytes) com larguras de
        /// índice (1/2/4), mais bitmask e endereçamento por [ctrl,loc,seq] — que é
        /// como o SELECT_PLACE endereça uma zona, então é hipótese plausível aqui.
        /// </summary>
        /// <summary>Quando ligado, o espaço de busca vira exaustivo em vez de curado.</summary>
        static bool _brute;

        static List<(string label, byte[] bytes)> _cachedSpace;

        static List<(string label, byte[] bytes)> Candidates(int n)
        {
            if (_brute) return _cachedSpace ??= BruteSpace(n);
            return Curated(n);
        }

        /// <summary>
        /// Espaço exaustivo: todo buffer de 1..4 bytes sobre um alfabeto reduzido,
        /// mais sequências curtas de int32. Cobre qualquer encoding orientado a
        /// byte e os alinhados a 4, que é onde o formato tem que estar.
        /// </summary>
        static List<(string, byte[])> BruteSpace(int n)
        {
            var list = new List<(string, byte[])>();
            byte[] alpha = { 0x00, 0x01, 0x02, 0x03, 0xFF };

            for (int len = 1; len <= 4; len++)
            {
                var idx = new int[len];
                while (true)
                {
                    var b = new byte[len];
                    for (int i = 0; i < len; i++) b[i] = alpha[idx[i]];
                    list.Add(($"raw{len} {Hex(b)}", b));

                    int k = len - 1;
                    while (k >= 0 && ++idx[k] == alpha.Length) { idx[k] = 0; k--; }
                    if (k < 0) break;
                }
            }

            int[] vals = { -1, 0, 1, 2, 3 };
            for (int cnt = 2; cnt <= 3; cnt++)
            {
                var idx = new int[cnt];
                while (true)
                {
                    var b = new byte[cnt * 4];
                    for (int i = 0; i < cnt; i++) BitConverter.GetBytes(vals[idx[i]]).CopyTo(b, i * 4);
                    list.Add(($"i32x{cnt} {Hex(b)}", b));

                    int k = cnt - 1;
                    while (k >= 0 && ++idx[k] == vals.Length) { idx[k] = 0; k--; }
                    if (k < 0) break;
                }
            }
            return list;
        }

        /// <summary>
        /// Formato real do ocgcore, tirado de `parse_response_cards` (playerop.cpp):
        ///   [int32 tipo][uint32 quantidade][índices...]
        /// tipo 0 = índices uint32, 1 = uint16, 2 = uint8, 3 = bitfield, -1 = cancelar.
        /// `returns.at&lt;T&gt;(i)` indexa por ELEMENTO, então os índices sempre começam
        /// no byte 8, seja qual for a largura.
        /// </summary>
        public static byte[] EncodeSelect(int[] indices, int type = 0)
        {
            int width = type switch { 0 => 4, 1 => 2, _ => 1 };
            var b = new byte[8 + indices.Length * width];
            BitConverter.GetBytes(type).CopyTo(b, 0);
            BitConverter.GetBytes((uint)indices.Length).CopyTo(b, 4);
            for (int i = 0; i < indices.Length; i++)
                WriteLE(b, 8 + i * width, indices[i], width);
            return b;
        }

        /// <summary>Variante bitfield (tipo 3): bits começam no bit 32, ou seja, byte 4.</summary>
        public static byte[] EncodeSelectBitfield(int[] indices, int total)
        {
            var b = new byte[4 + Math.Max(4, (total + 7) / 8)];
            BitConverter.GetBytes(3).CopyTo(b, 0);
            foreach (int i in indices) b[4 + i / 8] |= (byte)(1 << (i % 8));
            return b;
        }

        static List<(string label, byte[] bytes)> Curated(int n)
        {
            var seq = new int[n];
            for (int i = 0; i < n; i++) seq[i] = i;

            var list = new List<(string, byte[])>
            {
                // Derivados da fonte do ocgcore — devem funcionar.
                ("FONTE tipo0 (idx uint32)", EncodeSelect(seq, 0)),
                ("FONTE tipo1 (idx uint16)", EncodeSelect(seq, 1)),
                ("FONTE tipo2 (idx uint8)",  EncodeSelect(seq, 2)),
                ("FONTE tipo3 (bitfield)",   EncodeSelectBitfield(seq, _offers.Count)),
            };

            int[] countW = { 0, 1, 2, 4 };
            int[] idxW = { 1, 2, 4 };

            foreach (int cw in countW)
                foreach (int iw in idxW)
                {
                    list.Add(($"count{cw * 8}+idx{iw * 8}", Build(cw, iw, n, false)));
                    if (cw != 0)
                        list.Add(($"count{cw * 8}+idx{iw * 8} (64B)", Pad(Build(cw, iw, n, false), 64)));
                }

            // bitmask sobre a lista oferecida
            list.Add(("bitmask 8", new[] { (byte)Bitmask(n) }));
            list.Add(("bitmask 32", I32(Bitmask(n))));
            list.Add(("count8+bitmask8", new[] { (byte)n, (byte)Bitmask(n) }));

            // endereçamento por posição no campo, no estilo do SELECT_PLACE
            list.Add(("addr [ctrl,loc,seq8] x n", Addr(n, 1, false)));
            list.Add(("count8 + addr [ctrl,loc,seq8]", Addr(n, 1, true)));
            list.Add(("addr [ctrl,loc,seq32] x n", Addr(n, 4, false)));
            list.Add(("count8 + addr [ctrl,loc,seq32]", Addr(n, 4, true)));
            list.Add(("count32 + addr [ctrl,loc,seq32]", Addr32(n)));

            // índices na ordem inversa (caso a ordem importe)
            list.Add(("count8+idx8 invertido", BuildRev(n)));

            return list;
        }

        static byte[] Build(int countWidth, int idxWidth, int n, bool rev)
        {
            var b = new byte[countWidth + idxWidth * n];
            if (countWidth > 0) WriteLE(b, 0, n, countWidth);
            for (int i = 0; i < n; i++)
            {
                int v = rev ? (n - 1 - i) : i;
                WriteLE(b, countWidth + i * idxWidth, v, idxWidth);
            }
            return b;
        }

        static byte[] BuildRev(int n) => Build(1, 1, n, true);

        static byte[] Addr(int n, int seqWidth, bool withCount)
        {
            int entry = 2 + seqWidth;
            var b = new byte[(withCount ? 1 : 0) + entry * n];
            int p = 0;
            if (withCount) b[p++] = (byte)n;
            for (int i = 0; i < n && i < _offers.Count; i++)
            {
                b[p++] = _offers[i].ctrl;
                b[p++] = _offers[i].loc;
                WriteLE(b, p, _offers[i].seq, seqWidth); p += seqWidth;
            }
            return b;
        }

        static byte[] Addr32(int n)
        {
            var b = new byte[4 + 6 * n];
            WriteLE(b, 0, n, 4);
            int p = 4;
            for (int i = 0; i < n && i < _offers.Count; i++)
            {
                b[p++] = _offers[i].ctrl;
                b[p++] = _offers[i].loc;
                WriteLE(b, p, _offers[i].seq, 4); p += 4;
            }
            return b;
        }

        static void WriteLE(byte[] b, int off, int value, int width)
        {
            for (int i = 0; i < width && off + i < b.Length; i++)
                b[off + i] = (byte)((value >> (8 * i)) & 0xFF);
        }

        static int Bitmask(int n) { int m = 0; for (int i = 0; i < n; i++) m |= 1 << i; return m; }
        static byte[] Pad(byte[] src, int size)
        {
            var b = new byte[size]; Array.Copy(src, b, Math.Min(src.Length, size)); return b;
        }

        // ---- estado da sonda ----
        static int _cand;               // candidato atual
        static byte _pendingSelect;     // pergunta que o motor espera responder
        static int _tributeNeed = 1;    // quantas cartas o motor pede
        static bool _solved;
        static string _solution = "";
        static int _ownTurns;
        static readonly List<uint> _handCodes = new();

        public static void Run(string streamingAssets, bool brute = false)
        {
            _brute = brute;
            Log.Info(brute
                ? "=== busca exaustiva: SELECT_TRIBUTE ===\n"
                : "=== sonda: SELECT_TRIBUTE / SELECT_CARD ===\n");
            var deck = BuildDeck();
            using var s = new DuelSession(streamingAssets, deck, deck, 987654321UL, 0x1000000UL);
            IntPtr duel = s.Handle;

            int responses = 0;
            int maxIter = brute ? 400_000 : 4000;
            int maxResp = brute ? 40_000 : 400;
            for (int iter = 0; iter < maxIter && !_solved; iter++)
            {
                int status = YgoCoreAPI.OCG_DuelProcess(duel);

                IntPtr p = YgoCoreAPI.OCG_DuelGetMessage(duel, out uint len);
                bool retry = false, progressed = false;
                if (p != IntPtr.Zero && len > 0)
                {
                    var buf = new byte[len];
                    Marshal.Copy(p, buf, 0, (int)len);
                    (retry, progressed) = Scan(buf);
                }

                // Julga o candidato anterior, se estávamos sondando.
                if (_pendingSelect is 20 or 15 && _cand > 0)
                {
                    if (retry)
                    {
                        if (!_brute)
                            Log.Info($"    x RETRY — \"{Candidates(_tributeNeed)[_cand - 1].label}\" invalido");
                        else if (_cand % 100 == 0)
                            Log.Info($"    ... {_cand} candidatos descartados");
                    }
                    else if (progressed)
                    {
                        _solution = Candidates(_tributeNeed)[_cand - 1].label;
                        _solved = true;
                        Log.Info($"\n>>> ACEITO: \"{_solution}\"");
                        Log.Info($">>> bytes: [{Hex(Candidates(_tributeNeed)[_cand - 1].bytes)}]\n");
                        break;
                    }
                }

                if (status == END) { Log.Info("[sonda] duelo terminou antes de achar."); break; }
                if (status != AWAITING) continue;

                if (++responses > maxResp) { Log.Info("[sonda] teto de respostas."); break; }
                var resp = Decide(duel);
                YgoCoreAPI.OCG_DuelSetResponse(duel, resp, (uint)resp.Length);
            }

            Log.Info(_solved
                ? $"=== RESULTADO: formato = {_solution} ==="
                : "=== RESULTADO: nenhum candidato aceito ===");
        }

        static byte[] Decide(IntPtr duel)
        {
            switch (_pendingSelect)
            {
                case 11: return DecideIdle();
                case 18: return new byte[] { 0, 0x4, (byte)_freeZone };
                case 19: return I32(0x1);                 // face-up ataque
                case 16: return I32(-1);                  // não encadeia
                case 10: return I32(3);                   // encerra battle
                case 20:
                case 15:
                {
                    var list = Candidates(_tributeNeed);
                    if (_cand >= list.Count)
                    {
                        Log.Info("    (candidatos esgotados; recusando para nao travar)");
                        return I32(-1);
                    }
                    var c = list[_cand++];
                    if (!_brute) Log.Info($"  >> tentando \"{c.label}\": [{Hex(c.bytes)}]");
                    return c.bytes;
                }
                default: return I32(-1);
            }
        }

        static int _freeZone;
        static List<(uint code, int index)> _summonable = new();

        static byte[] DecideIdle()
        {
            if (_idlePlayer != 0) return I32(7);       // oponente: encerra turno

            // Se o Nv6 já está invocável, é ele que dispara o pedido de tributo.
            foreach (var (code, index) in _summonable)
            {
                if (code == SUMMONED_SKULL || code == GAIA)
                {
                    Log.Info($"  >> invocando com tributo: code={code} index={index}");
                    return I32(index << 16);
                }
            }
            // Senão, constrói tabuleiro: invoca o primeiro Nv4 disponível.
            if (_summonable.Count > 0)
            {
                Log.Info($"  >> invocando Nv4 index=0 (montando tabuleiro)");
                return I32(0 << 16);
            }
            return I32(7); // nada a fazer: encerra o turno
        }

        static int _idlePlayer;

        static (bool retry, bool progressed) Scan(byte[] d)
        {
            int off = 0; bool retry = false, prog = false;
            while (off < d.Length)
            {
                int mlen = BitConverter.ToInt32(d, off); off += 4;
                if (mlen <= 0 || off + mlen > d.Length) break;
                byte type = d[off];

                if (type == 1) retry = true;
                if (type is 50 or 60 or 61 or 40 or 41) prog = true;

                if (type == 40) { byte pl = d[off + 1]; if (pl == 0) _ownTurns++; }
                if (type == 11) ParseIdle(d, off, mlen);
                if (type == 18) ParsePlace(d, off);
                if (type is 20 or 15) DumpTribute(d, off, mlen, type);

                if (type >= 10 && type <= 30) _pendingSelect = type;
                off += mlen;
            }
            return (retry, prog);
        }

        static void ParseIdle(byte[] d, int o, int mlen)
        {
            _idlePlayer = d[o + 1];
            _summonable.Clear();
            int limit = o + mlen, p = o + 2;
            if (p + 4 > limit) return;
            int n = BitConverter.ToInt32(d, p); p += 4;
            for (int i = 0; i < n && p + 10 <= limit; i++)
            {
                _summonable.Add((BitConverter.ToUInt32(d, p), i));
                p += 10;
            }
            if (_idlePlayer == 0 && n > 0)
            {
                var nomes = new List<string>();
                foreach (var (c, i) in _summonable) nomes.Add($"[{i}]{c}");
                Log.Info($"  idle p0: invocaveis = {string.Join(" ", nomes)}");
            }
        }

        static void ParsePlace(byte[] d, int o)
        {
            uint flag = BitConverter.ToUInt32(d, o + 3);
            _freeZone = 0;
            for (int z = 0; z < 5; z++) if ((flag & (1u << z)) == 0) { _freeZone = z; break; }
        }

        /// <summary>
        /// Despeja o SELECT_TRIBUTE e deduz o tamanho de cada entrada a partir do
        /// tamanho total — mais confiável do que assumir um layout.
        /// </summary>
        static void DumpTribute(byte[] d, int o, int mlen, byte type)
        {
            Log.Info($"\n### {MsgName(type)} (len={mlen}) ###");
            Log.Info($"    bytes: {Hex(Slice(d, o, Math.Min(mlen, 64)))}");

            byte player = d[o + 1];
            byte cancelable = d[o + 2];
            int min = BitConverter.ToInt32(d, o + 3);
            int max = BitConverter.ToInt32(d, o + 7);
            int count = BitConverter.ToInt32(d, o + 11);
            int header = 15;                       // type+player+cancelable+min+max+count
            int rest = mlen - header;
            Log.Info($"    player={player} cancelable={cancelable} min={min} max={max} count={count}");
            _offers.Clear();
            if (count > 0 && rest > 0)
            {
                Log.Info($"    sobra={rest} bytes / {count} cartas = {(double)rest / count} por entrada");
                int entry = rest / count;
                for (int i = 0; i < count; i++)
                {
                    int q = o + header + i * entry;
                    if (q + entry > o + mlen) break;
                    var of = new Offer
                    {
                        code = BitConverter.ToUInt32(d, q),
                        ctrl = d[q + 4],
                        loc = d[q + 5],
                        seq = BitConverter.ToInt32(d, q + 6),
                        release = entry >= 11 ? d[q + 10] : (byte)1,
                    };
                    _offers.Add(of);
                    Log.Info($"      [{i}] code={of.code} ctrl={of.ctrl} loc=0x{of.loc:X} seq={of.seq} release={of.release}");
                }
            }
            _tributeNeed = Math.Max(1, min);
            // No modo exaustivo o cursor NÃO reinicia: a pergunta é cancelada e
            // refeita várias vezes, e recomeçar do zero repetiria o mesmo prefixo
            // para sempre sem nunca varrer o espaço.
            if (!_brute) _cand = 0;
            Log.Info($"    ({Candidates(_tributeNeed).Count} candidatos; cursor em {_cand})\n");
        }

        static byte[] Slice(byte[] d, int o, int n)
        {
            n = Math.Max(0, Math.Min(n, d.Length - o));
            var b = new byte[n]; Array.Copy(d, o, b, 0, n); return b;
        }

        static byte[] I32(params int[] v)
        {
            var b = new byte[v.Length * 4];
            for (int i = 0; i < v.Length; i++) BitConverter.GetBytes(v[i]).CopyTo(b, i * 4);
            return b;
        }

        static string Hex(byte[] b) => BitConverter.ToString(b).Replace("-", " ");

        static uint[] BuildDeck()
        {
            var d = new List<uint>();
            for (int i = 0; i < 6; i++) d.Add(SUMMONED_SKULL);
            for (int i = 0; i < 3; i++) d.Add(GAIA);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF, CELTIC };
            while (d.Count < 40) d.Add(lv4[d.Count % lv4.Length]);
            return d.ToArray();
        }
    }
}
