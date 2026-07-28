using System;
using System.IO;
using System.Runtime.InteropServices;
using YGO;

// Portado de duel_academy/Assets/Scripts/YGO/DatabaseManager.cs
// Mudancas para console app .NET 8:
//   - UnityEngine.Debug   -> Log
//   - Application.streamingAssetsPath -> caminho injetado no construtor
public class DatabaseManager
{
    private IntPtr db;

    // ----- P/Invoke Direto para a SQLite3.dll Nativa -----
    [DllImport("sqlite3", EntryPoint = "sqlite3_open", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_open(string filename, out IntPtr ppDb);

    [DllImport("sqlite3", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close(IntPtr ppDb);

    [DllImport("sqlite3", EntryPoint = "sqlite3_prepare_v2", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_prepare_v2(IntPtr db, string zSql, int nByte, out IntPtr ppStmt, IntPtr pzTail);

    [DllImport("sqlite3", EntryPoint = "sqlite3_step", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_step(IntPtr pStmt);

    [DllImport("sqlite3", EntryPoint = "sqlite3_column_int", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_column_int(IntPtr pStmt, int iCol);

    [DllImport("sqlite3", EntryPoint = "sqlite3_column_int64", CallingConvention = CallingConvention.Cdecl)]
    private static extern long sqlite3_column_int64(IntPtr pStmt, int iCol);

    [DllImport("sqlite3", EntryPoint = "sqlite3_finalize", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_finalize(IntPtr pStmt);

    public DatabaseManager(string streamingAssetsPath)
    {
        string dbPath = Path.Combine(streamingAssetsPath, "YGODemo/cards.cdb");

        try
        {
            int rc = sqlite3_open(dbPath, out db);
            if (rc != 0)
            {
                Log.Err($"[DatabaseManager] Falha ao abrir SQLite (Erro {rc}). A sqlite3.dll oficial nao foi encontrada na pasta Plugins.");
            }
            else
            {
                Log.Info($"<color=green>[DatabaseManager]</color> Banco SQLite conectado usando P/Invoke Nativo puro (Sem bibliotecas velhas)!");
            }
        }
        catch (DllNotFoundException)
        {
            Log.Err("[DatabaseManager] ERRO CRITICO: sqlite3.dll nao esta na pasta Plugins/YGO! Baixe ela no site oficial.");
        }
    }

    /// <summary>Stats de uma carta, para a IA do NPC decidir a jogada.</summary>
    public readonly struct CardStats
    {
        public readonly uint Code, Type, RawLevel;
        public readonly int Atk, Def;
        public CardStats(uint code, uint type, uint rawLevel, int atk, int def)
        { Code = code; Type = type; RawLevel = rawLevel; Atk = atk; Def = def; }

        public bool IsMonster => (Type & 0x1) != 0;
        public bool IsSpell => (Type & 0x2) != 0;
        /// <summary>O campo `level` empacota escalas de Pêndulo nos bits altos.</summary>
        public int Level => (int)(RawLevel & 0xff);
        /// <summary>ATK "?" é gravado como -2; para decidir jogada vale 0.</summary>
        public int AtkValue => Atk == -2 ? 0 : Atk;
        public int DefValue => Def == -2 ? 0 : Def;
    }

    private readonly System.Collections.Generic.Dictionary<uint, CardStats> _statsCache = new();

    /// <summary>Consulta stats (com cache) — a IA pergunta a mesma carta muitas vezes.</summary>
    public CardStats Stats(uint code)
    {
        if (_statsCache.TryGetValue(code, out var hit)) return hit;

        var s = new CardStats(code, 0, 0, 0, 0);
        if (db != IntPtr.Zero)
        {
            string query = $"SELECT type, level, atk, def FROM datas WHERE id = {code}";
            if (sqlite3_prepare_v2(db, query, -1, out IntPtr stmt, IntPtr.Zero) == 0)
            {
                if (sqlite3_step(stmt) == 100)
                {
                    s = new CardStats(
                        code,
                        (uint)sqlite3_column_int(stmt, 0),
                        (uint)sqlite3_column_int(stmt, 1),
                        sqlite3_column_int(stmt, 2),
                        sqlite3_column_int(stmt, 3));
                }
                sqlite3_finalize(stmt);
            }
        }
        _statsCache[code] = s;
        return s;
    }

    public void CardReaderCallback(IntPtr payload, uint code, IntPtr dataPtr)
    {
        OCG_CardData cardData = new OCG_CardData();
        cardData.code = code;
        cardData.setcodes = IntPtr.Zero;

        if (db != IntPtr.Zero)
        {
            // A query pega os status basicos que o motor exige (ataque, defesa, nivel, atributo)
            string query = $"SELECT alias, type, level, attribute, race, atk, def FROM datas WHERE id = {code}";
            IntPtr stmt;

            if (sqlite3_prepare_v2(db, query, -1, out stmt, IntPtr.Zero) == 0)
            {
                if (sqlite3_step(stmt) == 100) // 100 = SQLITE_ROW (Achou a carta)
                {
                    cardData.alias = (uint)sqlite3_column_int(stmt, 0);
                    cardData.type = (uint)sqlite3_column_int(stmt, 1);
                    cardData.level = (uint)sqlite3_column_int(stmt, 2);
                    cardData.attribute = (uint)sqlite3_column_int(stmt, 3);
                    cardData.race = (ulong)sqlite3_column_int64(stmt, 4);
                    cardData.attack = sqlite3_column_int(stmt, 5);
                    cardData.defense = sqlite3_column_int(stmt, 6);
                }
                else
                {
                    Log.Warn($"[DatabaseManager] A carta {code} nao existe no cards.cdb!");
                }
                sqlite3_finalize(stmt);
            }
        }

        Marshal.StructureToPtr(cardData, dataPtr, false);
    }

    ~DatabaseManager()
    {
        if (db != IntPtr.Zero)
            sqlite3_close(db);
    }
}
