using System;
using System.IO;
using System.Runtime.InteropServices;
using YGO;

// Portado de duel_academy/Assets/Scripts/YGO/DatabaseManager.cs
// Mudancas para console app .NET 8:
//   - UnityEngine.Debug   -> Log
//   - Application.streamingAssetsPath -> caminho injetado no construtor
public class DatabaseManager : IDisposable
{
    private IntPtr db;

    /// <summary>
    /// Ensina o .NET a achar a SQLite no Linux.
    ///
    /// `DllImport("sqlite3")` procura por `libsqlite3.so` — o nome do pacote de
    /// DESENVOLVIMENTO. Uma distribuicao so' com o runtime instalado tem apenas
    /// `libsqlite3.so.0`, e o carregamento falha. O sintoma nao apontava para
    /// nada disso: o banco de cartas ficava vazio, o NPC nao enxergava carta
    /// nenhuma e so' passava o turno — 24 testes vermelhos, todos parecendo bug
    /// de regra.
    ///
    /// Resolver por codigo (em vez de exigir libsqlite3-dev na imagem) mantem o
    /// servidor auto-suficiente: roda em qualquer host sem pacote extra.
    /// No Windows nada muda — o resolvedor devolve zero e o .NET segue com a
    /// busca normal, achando a sqlite3.dll ao lado do executavel.
    /// </summary>
    static DatabaseManager()
    {
        NativeLibrary.SetDllImportResolver(typeof(DatabaseManager).Assembly, (nome, asm, caminho) =>
        {
            if (nome != "sqlite3" || !RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                return IntPtr.Zero;

            foreach (var tentativa in new[] { "libsqlite3.so.0", "libsqlite3.so" })
                if (NativeLibrary.TryLoad(tentativa, out var h)) return h;

            return IntPtr.Zero;
        });
    }

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

    /// <summary>Onde moram o banco e os scripts — o `Perfil` precisa dos dois.</summary>
    private readonly string _sa;

    public DatabaseManager(string streamingAssetsPath)
    {
        _sa = streamingAssetsPath;
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
        /// <summary>
        /// Raça (RACE_*) e atributo (ATTRIBUTE_*) do monstro, direto do
        /// `cards.cdb`. Magia/armadilha vem 0 nos dois — a restrição de um
        /// equipamento ("só em Dragão") mora no Lua dele, não no banco.
        ///
        /// Existem para o `NpcBrain` casar equipamento com alvo sem chumbar a
        /// raça de cada monstro do jogo: só a exigência do EQUIPAMENTO precisa
        /// de tabela; de quem recebe, o banco responde.
        /// </summary>
        public readonly uint Race, Attribute;

        /// <summary>
        /// A `category` do `cards.cdb` — a classificação que o PRÓPRIO motor faz
        /// do que o efeito da carta fez (destruir, comprar, invocar…). É o que
        /// permite reconhecer "esta carta compra" sem manter uma lista de IDs.
        /// </summary>
        public readonly uint Category;

        public CardStats(uint code, uint type, uint rawLevel, int atk, int def,
                         uint race = 0, uint attribute = 0, uint category = 0)
        {
            Code = code; Type = type; RawLevel = rawLevel; Atk = atk; Def = def;
            Race = race; Attribute = attribute; Category = category;
        }

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
            string query = $"SELECT type, level, atk, def, race, attribute, category FROM datas WHERE id = {code}";
            if (sqlite3_prepare_v2(db, query, -1, out IntPtr stmt, IntPtr.Zero) == 0)
            {
                if (sqlite3_step(stmt) == 100)
                {
                    s = new CardStats(
                        code,
                        (uint)sqlite3_column_int(stmt, 0),
                        (uint)sqlite3_column_int(stmt, 1),
                        sqlite3_column_int(stmt, 2),
                        sqlite3_column_int(stmt, 3),
                        (uint)sqlite3_column_int(stmt, 4),
                        (uint)sqlite3_column_int(stmt, 5),
                        (uint)sqlite3_column_int(stmt, 6));
                }
                sqlite3_finalize(stmt);
            }
        }
        _statsCache[code] = s;
        return s;
    }

    // ================= o que o EFEITO de uma carta faz =================
    //
    // O NPC precisava saber "esta carta compra?" sem uma lista de IDs escrita à
    // mão — uma lista assim envelhece a cada carta nova e é justamente o tipo de
    // regra que não deveria morar fora do motor. As duas fontes abaixo são do
    // próprio jogo:
    //
    //   • a coluna `category` do `cards.cdb`, que é a classificação que o motor
    //     faz do efeito. **O bit de compra é 0x100** — e isso NÃO é o que o
    //     `constant.lua` deste core diz (lá 0x100 é CATEGORY_SUMMON e
    //     CATEGORY_DRAW é 0x10000): o banco foi escrito com a tabela ANTIGA.
    //     Conferido contra o banco, não deduzido: Pot of Greed, Graceful
    //     Charity, Jar of Greed, Trade-In, Card Destruction e Dark World
    //     Dealings têm todos 0x100, e Raigeki (destruir) tem 0x1;
    //
    //   • o Lua da própria carta, para o que a categoria não distingue. São 794
    //     cartas com o bit de compra e 13 delas não têm `Duel.Draw` no próprio
    //     script (a compra vem de outro efeito), então exigir os DOIS sinais
    //     limpa esses falsos positivos. E o custo de descarte a categoria
    //     simplesmente não registra — Graceful Charity e Dark World Dealings são
    //     `0x100` e nada mais, embora as duas mandem descartar.
    // Os outros bits, medidos do mesmo jeito (uma carta conhecida de cada classe,
    // conferida contra o banco):
    //
    //   0x1      destrói MONSTRO ......... Raigeki, Dark Hole, Thousand Knives
    //   0x2      destrói MAGIA/ARMADILHA . Mystical Space Typhoon, Heavy Storm,
    //                                      Dust Tornado, Dark Magic Attack
    //   0x220    BUSCA no deck ........... Summoner's Art, Reinforcement of the
    //                                      Army, Sangan, Magician's Rod, Terraforming
    //   0x100000 INVOCAÇÃO ESPECIAL ...... Monster Reborn, Ancient Rules, Dark
    //                                      Magic Veil, Magician Navigation,
    //                                      Call of the Haunted, Magician's Circle
    //   0x800000 FUSÃO ................... Polymerization, The Eye of Timaeus
    //
    // Carta fora da tabela (De-Spell e Fissure saem com `0`) simplesmente não é
    // reconhecida — e o silêncio é o erro barato: o NPC deixa de usar uma carta,
    // em vez de usar errado uma que ele não entendeu.
    const uint CATEGORY_DESTROI_MONSTRO = 0x1;
    const uint CATEGORY_DESTROI_ST = 0x2;
    const uint CATEGORY_BUSCA = 0x200;
    const uint CATEGORY_DRAW = 0x100;
    const uint CATEGORY_SP_SUMMON = 0x100000;
    const uint CATEGORY_FUSAO = 0x800000;

    /// <summary>O que o efeito de uma carta faz, do ponto de vista de quem decide jogá-la.</summary>
    public readonly struct PerfilDeEfeito
    {
        /// <summary>Compra carta(s) para quem ativou.</summary>
        public readonly bool Compra;
        /// <summary>Tira carta da MÃO (custo de descarte, ou descarte forçado).</summary>
        public readonly bool Descarta;
        /// <summary>Traz um monstro de volta do CEMITÉRIO.</summary>
        public readonly bool ReanimaDoCemiterio;
        /// <summary>Destrói monstro do outro lado.</summary>
        public readonly bool DestroiMonstro;
        /// <summary>Destrói magia/armadilha do outro lado.</summary>
        public readonly bool DestroiSt;
        /// <summary>Tira uma carta do DECK e põe na mão.</summary>
        public readonly bool Busca;
        /// <summary>Põe um monstro em campo por Invocação Especial (de onde for).</summary>
        public readonly bool InvocaEspecial;
        /// <summary>Invoca por FUSÃO, do Extra Deck.</summary>
        public readonly bool Fusao;
        /// <summary>Cobra pontos de vida.</summary>
        public readonly bool PagaLp;

        public PerfilDeEfeito(bool compra, bool descarta, bool reanima, bool destroiMonstro,
                              bool destroiSt, bool busca, bool invocaEspecial, bool fusao, bool pagaLp)
        {
            Compra = compra; Descarta = descarta; ReanimaDoCemiterio = reanima;
            DestroiMonstro = destroiMonstro; DestroiSt = destroiSt; Busca = busca;
            InvocaEspecial = invocaEspecial; Fusao = fusao; PagaLp = pagaLp;
        }
    }

    private readonly System.Collections.Generic.Dictionary<uint, PerfilDeEfeito> _perfilCache = new();

    /// <summary>
    /// Perfil do efeito, com cache. Carta sem script cai em "não faz nada
    /// disso" — o silêncio é o erro barato: o NPC deixa de usar uma carta, em
    /// vez de usar errado uma que ele não entendeu.
    /// </summary>
    public PerfilDeEfeito Perfil(uint code)
    {
        if (_perfilCache.TryGetValue(code, out var hit)) return hit;

        string lua = LuaDaCarta(code);
        uint cat = Stats(code).Category;
        bool compra = (cat & CATEGORY_DRAW) != 0 && lua.Contains("Duel.Draw");
        // `DiscardHand` é o descarte direto; `REASON_DISCARD` cobre quem manda
        // para o cemitério COMO descarte; e "mandar da mão para o cemitério" é a
        // terceira forma de escrever a mesma coisa (Hand Destruction).
        bool descarta = lua.Contains("DiscardHand") || lua.Contains("REASON_DISCARD")
                     || (lua.Contains("SendtoGrave") && lua.Contains("LOCATION_HAND"));
        // Invocar Especialmente + cemitério: é o que separa o Monster Reborn e o
        // Premature Burial do Ancient Rules (que também Invoca Especialmente, mas
        // da mão). A categoria não distingue os dois — os três são `0x100000`.
        bool reanima = lua.Contains("SpecialSummon") && lua.Contains("LOCATION_GRAVE");
        // Categoria E Lua, sempre: a categoria diz a CLASSE do efeito e o script
        // confirma que ele existe mesmo naquela carta. Um sinal só erra nos dois
        // sentidos — há categoria sem o efeito no próprio script, e há script com
        // a palavra sem a carta ser daquela classe.
        bool destroiMonstro = (cat & CATEGORY_DESTROI_MONSTRO) != 0 && lua.Contains("Destroy");
        bool destroiSt = (cat & CATEGORY_DESTROI_ST) != 0 && lua.Contains("Destroy");
        // Buscar é tirar do DECK e pôr na mão. As duas metades têm de aparecer:
        // `LOCATION_DECK` sozinho pega também quem invoca direto do deck.
        bool busca = (cat & CATEGORY_BUSCA) != 0 && lua.Contains("LOCATION_DECK");
        bool invocaEspecial = (cat & CATEGORY_SP_SUMMON) != 0 && lua.Contains("SpecialSummon");
        bool fusao = (cat & CATEGORY_FUSAO) != 0;
        // "PayLP" cobre as DUAS formas que os scripts usam: o `Duel.PayLPCost`
        // antigo e o `Cost.PayLP(n)` moderno — o Dark Magic Veil usa o segundo, e
        // procurar só pelo primeiro fazia o custo dele passar despercebido.
        bool pagaLp = lua.Contains("PayLP");

        var p = new PerfilDeEfeito(compra, descarta, reanima, destroiMonstro,
                                   destroiSt, busca, invocaEspecial, fusao, pagaLp);
        _perfilCache[code] = p;
        return p;
    }

    private readonly System.Collections.Generic.Dictionary<uint, string> _luaCache = new();

    /// <summary>
    /// O script da carta, lido do disco. Busca DIRIGIDA (dois caminhos
    /// conhecidos) em vez de varrer a pasta: são 21 mil arquivos, e o
    /// ScriptManager já paga essa varredura uma vez na subida.
    /// </summary>
    private string LuaDaCarta(uint code)
    {
        if (_luaCache.TryGetValue(code, out string hit)) return hit;
        string texto = "";
        foreach (string rel in new[] { "YGODemo/script/official", "YGODemo/script" })
        {
            string p = Path.Combine(_sa ?? "", rel, $"c{code}.lua");
            if (!File.Exists(p)) continue;
            try { texto = File.ReadAllText(p); } catch { /* ilegível = desconhecida */ }
            break;
        }
        _luaCache[code] = texto;
        return texto;
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

    /// <summary>
    /// Fecha o cards.cdb AGORA, sem esperar o coletor de lixo.
    ///
    /// O finalizador sozinho nao bastava: enquanto o SQLite mantem o arquivo
    /// aberto, o auto-updater nao consegue sobrescrever o cards.cdb — e a
    /// extracao do pacote 'cards' falharia pela metade, com o jogo instalado
    /// entre duas versoes. Como ninguem sabe quando o GC roda, o duelo que
    /// abriu o banco e' quem tem de fecha-lo ao ser descartado.
    /// </summary>
    public void Dispose()
    {
        if (db != IntPtr.Zero)
        {
            sqlite3_close(db);
            db = IntPtr.Zero;
        }
        GC.SuppressFinalize(this);
    }

    ~DatabaseManager()
    {
        if (db != IntPtr.Zero)
            sqlite3_close(db);
    }
}
