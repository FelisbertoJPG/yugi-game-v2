using System;
using System.Runtime.InteropServices;

namespace YGO
{
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void OCG_DataReader(IntPtr payload, uint code, IntPtr data);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate int OCG_ScriptReader(IntPtr payload, IntPtr duel, [MarshalAs(UnmanagedType.LPStr)] string name);

    [StructLayout(LayoutKind.Sequential)]
    public struct OCG_Player
    {
        public uint startingLP;
        public uint startingDrawCount;
        public uint drawCountPerTurn;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct OCG_CardData
    {
        public uint code;
        public uint alias;
        public IntPtr setcodes;
        public uint type;
        public uint level;
        public uint attribute;
        public ulong race;
        public int attack;
        public int defense;
        public uint lscale;
        public uint rscale;
        public uint link_marker;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct OCG_DuelOptions
    {
        public ulong seed0;
        public ulong seed1;
        public ulong seed2;
        public ulong seed3;
        public ulong flags;
        public OCG_Player team1;
        public OCG_Player team2;
        public IntPtr cardReader;
        public IntPtr payload1;
        public IntPtr scriptReader;
        public IntPtr payload2;
        public IntPtr logHandler;
        public IntPtr payload3;
        public IntPtr cardReaderDone;
        public IntPtr payload4;
        public byte enableUnsafeLibraries;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct OCG_NewCardInfo
    {
        public byte team;      // 0 ou 1
        public byte duelist;   // 0 ou 1
        public uint code;      // ID da carta
        public byte con;       // Controlador (0 ou 1)
        public uint loc;       // Localização (1 = Deck)
        public uint seq;       // Sequência
        public uint pos;       // Posição (8 = Facedown Defense)
    }

    /// <summary>Endereço de uma carta para consulta no estado atual do duelo.
    /// O padding explícito acompanha o alinhamento C da API nativa x64.</summary>
    [StructLayout(LayoutKind.Explicit, Size = 20)]
    public struct OCG_QueryInfo
    {
        [FieldOffset(0)] public uint flags;
        [FieldOffset(4)] public byte con;
        [FieldOffset(8)] public uint loc;
        [FieldOffset(12)] public uint seq;
        [FieldOffset(16)] public uint overlay_seq;
    }

    /// <summary>
    /// Wrapper para a nova DLL em C++ do ygopro-core (edo9300 API).
    /// </summary>
    public static class YgoCoreAPI
    {
        private const string LibName = "ocgcore";

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void OCG_GetVersion(out int major, out int minor);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int OCG_CreateDuel(out IntPtr out_ocg_duel, ref OCG_DuelOptions options);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void OCG_DestroyDuel(IntPtr ocg_duel);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void OCG_DuelNewCard(IntPtr ocg_duel, ref OCG_NewCardInfo info);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void OCG_StartDuel(IntPtr ocg_duel);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int OCG_DuelProcess(IntPtr ocg_duel);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr OCG_DuelGetMessage(IntPtr ocg_duel, out uint length);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int OCG_LoadScript(IntPtr ocg_duel, byte[] buffer, uint length, [MarshalAs(UnmanagedType.LPStr)] string name);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void OCG_DuelSetResponse(IntPtr ocg_duel, byte[] buffer, uint length);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int OCG_DuelQueryCount(IntPtr ocg_duel, byte team, uint loc);

        [DllImport(LibName, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr OCG_DuelQuery(IntPtr ocg_duel, out uint length,
                                                   ref OCG_QueryInfo info);
    }
}
