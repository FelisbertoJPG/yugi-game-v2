using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Harness de diagnóstico (--selfplay). Deck de monstros Nível 4 (invocáveis
    /// sem tributo). Decodifica o SELECT_IDLECMD e AUTO-SONDA o formato da resposta
    /// de invocação: tenta vários encodings candidatos e detecta qual NÃO gera
    /// MSG_RETRY (id=1). Objetivo: achar empiricamente o protocolo edo9300.
    /// </summary>
    public static class SelfPlay
    {
        const int END = 0, AWAITING = 1, CONTINUE = 2;

        static string MsgName(byte id) => id switch
        {
            1 => "RETRY", 2 => "HINT", 3 => "WAITING", 4 => "START",
            10 => "SELECT_BATTLECMD", 11 => "SELECT_IDLECMD", 12 => "SELECT_EFFECTYN",
            13 => "SELECT_YESNO", 14 => "SELECT_OPTION", 15 => "SELECT_CARD",
            16 => "SELECT_CHAIN", 18 => "SELECT_PLACE", 19 => "SELECT_POSITION",
            40 => "NEW_TURN", 41 => "NEW_PHASE", 50 => "MOVE",
            60 => "SUMMONING", 61 => "SUMMONED", 62 => "SPSUMMONING",
            90 => "DRAW", 110 => "WIN",
            _ => $"?{id}"
        };

        static readonly uint[] Deck = BuildDeck();

        // Candidatos de resposta para o SELECT_IDLECMD.
        // "i32 0" já é conhecido: invoca o índice 0. Os demais sondam os códigos
        // de fase (encerrar turno / ir pra battle) no idle sem invocáveis.
        static readonly List<(string label, byte[] bytes)> IdleCandidates = new()
        {
            ("summon i32 0", I32(0)),
            ("i32 5",        I32(5)),
            ("i32 6",        I32(6)),
            ("i32 7",        I32(7)),
            ("i32 8",        I32(8)),
            ("i32 9",        I32(9)),
        };
        static int _idleProbe = 0;
        static byte _lastRespType = 0;
        static string _lastLabel = "";
        static bool _summonWorked = false;

        public static void Run(string streamingAssets)
        {
            using var s = new DuelSession(streamingAssets, Deck, Deck);
            Log.Info("--- selfplay: sonda de protocolo ---\n");
            IntPtr duel = s.Handle;

            byte lastSelect = 0;
            int responses = 0;

            for (int iter = 0; iter < 200; iter++)
            {
                int status = YgoCoreAPI.OCG_DuelProcess(duel);
                IntPtr p = YgoCoreAPI.OCG_DuelGetMessage(duel, out uint len);
                bool sawRetry = false, sawProgress = false;
                if (p != IntPtr.Zero && len > 0)
                {
                    byte[] buf = new byte[len];
                    Marshal.Copy(p, buf, 0, (int)len);
                    var (found, retry, progress) = DumpMessages(buf);
                    sawRetry = retry; sawProgress = progress;
                    if (found != 0) lastSelect = found; // RETRY não traz SELECT: mantém a pergunta
                }

                // avalia a resposta anterior ao idle
                if (sawRetry && _lastRespType == 11)
                {
                    Log.Info($"    ✗ RETRY — candidato \"{_lastLabel}\" invalido");
                    _idleProbe++;
                }
                else if (sawProgress && _lastRespType == 11)
                {
                    Log.Info($"    ✓✓✓ idle avançou com \"{_lastLabel}\" ✓✓✓");
                    _idleProbe = 0; // achou algo; reinicia a sonda pro próximo idle
                }

                if (status == END) { Log.Info("\n[selfplay] FIM."); return; }
                if (status == AWAITING)
                {
                    if (++responses > 40) { Log.Info("\n[selfplay] parei (40 respostas)."); return; }
                    byte[] resp = Decide(lastSelect);
                    _lastRespType = lastSelect;
                    Log.Info($"  >> resp a {MsgName(lastSelect)} cand=\"{_lastLabel}\": [{Hex(resp)}]");
                    YgoCoreAPI.OCG_DuelSetResponse(duel, resp, (uint)resp.Length);
                }
            }
            Log.Info("\n[selfplay] teto de iteracoes.");
        }

        static byte[] Decide(byte sel)
        {
            switch (sel)
            {
                case 11: // SELECT_IDLECMD — sondar candidatos de invocação
                    if (_idleProbe >= IdleCandidates.Count)
                    {
                        _lastLabel = "sem mais candidatos -> end phase i32 7";
                        return I32(7); // tentativa de "end phase"
                    }
                    var c = IdleCandidates[_idleProbe];
                    _lastLabel = c.label;
                    return c.bytes;
                case 18: _lastLabel = "place [0,0x4,0]"; return new byte[] { 0, 0x4, 0 };
                case 19: _lastLabel = "pos FACEUP_ATK i32 1"; return I32(1);
                case 10: _lastLabel = "battle end i32 3"; return I32(3);
                case 16: _lastLabel = "chain no i32 -1"; return I32(-1);
                default: _lastLabel = "i32 0"; return I32(0);
            }
        }

        static (byte lastSel, bool retry, bool progress) DumpMessages(byte[] data)
        {
            int off = 0; byte last = 0; bool retry = false, progress = false;
            while (off < data.Length)
            {
                int mlen = BitConverter.ToInt32(data, off); off += 4;
                if (mlen <= 0 || off + mlen > data.Length) break;
                byte type = data[off];
                int show = Math.Min(mlen, 48);
                byte[] slice = new byte[show];
                Array.Copy(data, off, slice, 0, show);
                Log.Info($"MSG {MsgName(type),-17} id={type,-3} len={mlen,-4} : {Hex(slice)}");

                if (type == 1) retry = true;
                if (type == 11) DecodeIdle(data, off);
                // progresso = qualquer avanço real (mover, invocar, mudar fase/turno)
                if (type is 50 or 60 or 18 or 19 or 40 or 41) progress = true;
                if (type >= 10 && type <= 26) last = type;
                off += mlen;
            }
            return (last, retry, progress);
        }

        static void DecodeIdle(byte[] d, int off)
        {
            try
            {
                int p = off + 1;
                byte player = d[p++];
                int sum = BitConverter.ToInt32(d, p); p += 4;
                Log.Info($"    idle player={player} summonableCount={sum}");
                for (int i = 0; i < sum; i++)
                {
                    uint code = BitConverter.ToUInt32(d, p);
                    byte ctrl = d[p + 4], loc = d[p + 5];
                    Log.Info($"      [{i}] code={code} ctrl={ctrl} loc=0x{loc:X} (bytes {Hex(Slice(d, p, 10))})");
                    p += 10;
                }
            }
            catch { Log.Info("    (falha ao decodificar idle)"); }
        }

        static byte[] Slice(byte[] d, int o, int n)
        {
            n = Math.Min(n, d.Length - o);
            var b = new byte[n]; Array.Copy(d, o, b, 0, n); return b;
        }

        static byte[] I32(params int[] vals)
        {
            var b = new byte[vals.Length * 4];
            for (int i = 0; i < vals.Length; i++) BitConverter.GetBytes(vals[i]).CopyTo(b, i * 4);
            return b;
        }

        static string Hex(byte[] b) => BitConverter.ToString(b).Replace("-", " ");

        static uint[] BuildDeck()
        {
            // 40 vanilla Nível 4 (invocáveis sem tributo)
            uint[] ids = { 5053103, 5388481, 5464695 }; // Battle Ox, Darkfire Soldier #1, Blazing Inpachi
            var d = new uint[40];
            for (int i = 0; i < 40; i++) d[i] = ids[i % ids.Length];
            return d;
        }
    }
}
