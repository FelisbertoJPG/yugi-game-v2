using System;
using System.IO;
using System.Runtime.InteropServices;
using DuelServer;   // BonusDeCampo — esta classe ficou no namespace global (porte do Unity)
using YGO;

// Portado de duel_academy/Assets/Scripts/YGO/DatabaseManager.cs
// Mudancas para console app .NET 8:
//   - UnityEngine.Debug   -> Log
//   - Application.streamingAssetsPath -> caminho injetado no construtor
public class DatabaseManager : IDisposable
{
    private IntPtr db;

    /// <summary>
    /// O resolvedor de bibliotecas nativas mora em <see cref="DuelServer.Nativas"/>.
    ///
    /// Ele ficava AQUI, num construtor estatico, e isso escondia dois furos: o
    /// construtor so' roda quando alguem toca no banco (a `ocgcore` e' carregada
    /// antes, no boot), e o .NET aceita um resolvedor por assembly — entao a
    /// casca nao conseguia registrar o dela sem estourar
    /// "A resolver is already set for the assembly". Continua sendo chamado por
    /// aqui para quem usar o `DatabaseManager` direto num teste.
    /// </summary>
    static DatabaseManager()
    {
        DuelServer.Nativas.Ligar();
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

    /// <summary>
    /// Coluna de TEXTO. Devolve um ponteiro para UTF-8 do proprio SQLite — que
    /// so' vale ate' o `sqlite3_step`/`finalize` seguinte, entao a string tem de
    /// ser copiada na hora (`PtrToStringUTF8`) e nunca guardada como IntPtr.
    /// </summary>
    [DllImport("sqlite3", EntryPoint = "sqlite3_column_text", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr sqlite3_column_text(IntPtr pStmt, int iCol);

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
        public bool IsTrap => (Type & 0x4) != 0;
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

    // ================= o TEXTO de um efeito (a descricao) =================
    //
    // Toda pergunta do motor que envolve UM efeito carrega uma `description`
    // de 64 bits, montada pelo proprio script em `aux.Stringid(code, i)`:
    //
    //     (i & 0xfffff) | code << 20
    //
    // ou seja, QUAL carta e QUAL das descricoes dela (`str1`..`str16` da tabela
    // `texts` do cards.cdb, com `i = 0` sendo a `str1`). E' o unico jeito de
    // saber qual dos efeitos de uma carta esta' em jogo: o Forgotten Temple of
    // the Deep aparece na janela de corrente com o mesmo nome e a mesma arte
    // para "banir 1 peixe" (str1) e para "Invocar Especialmente o banido"
    // (str2), e sem esta linha o jogador ativa um achando que ativou o outro.
    //
    // Quem resolve e' o SERVIDOR, e nao o navegador, porque a fonte certa e' a
    // tabela `texts` **com o indice preservado**: o `cards.json` do `ygo-data`
    // guarda `strings` compactado (descarta as vazias), e em 373 cartas do
    // banco ha' buraco no meio — ali o indice do motor apontaria para a
    // descricao ERRADA, que e' exatamente o problema que este campo existe para
    // resolver.
    //
    // Descricao de SISTEMA (o motor tem uma tabela propria de textos genericos,
    // que nao mora no cards.cdb) sai como `code == 0` e devolve null: a tela
    // simplesmente nao mostra frase nenhuma, em vez de mostrar uma inventada.

    private readonly System.Collections.Generic.Dictionary<ulong, string> _textoCache = new();

    private readonly System.Collections.Generic.Dictionary<uint, string> _nomeCache = new();

    /// <summary>
    /// O NOME da carta, direto da tabela `texts` do `cards.cdb`.
    ///
    /// O motor nunca precisou dele para jogar — decide por statline, categoria e
    /// Lua —, e por isso ele não existia aqui. Passou a existir para as
    /// FERRAMENTAS: um relatório de cobertura que lista "10012614" carta por
    /// carta não é lido por ninguém, e a pergunta que ele responde ("o NPC sabe
    /// usar isto?") é feita por gente que pensa em nomes.
    ///
    /// Devolve o próprio código como texto quando não acha — nunca vazio: uma
    /// linha sem identificação nenhuma é pior que uma com o número.
    /// </summary>
    public string Nome(uint code)
    {
        if (_nomeCache.TryGetValue(code, out string hit)) return hit;

        string nome = null;
        if (db != IntPtr.Zero)
        {
            string query = $"SELECT name FROM texts WHERE id = {code}";
            if (sqlite3_prepare_v2(db, query, -1, out IntPtr stmt, IntPtr.Zero) == 0)
            {
                if (sqlite3_step(stmt) == 100)
                {
                    IntPtr raw = sqlite3_column_text(stmt, 0);
                    string s = raw == IntPtr.Zero ? null : Marshal.PtrToStringUTF8(raw);
                    if (!string.IsNullOrWhiteSpace(s)) nome = s.Trim();
                }
                sqlite3_finalize(stmt);
            }
        }

        nome ??= code.ToString();
        _nomeCache[code] = nome;
        return nome;
    }

    /// <summary>
    /// O texto da descricao de um efeito (`aux.Stringid`), ou null quando nao
    /// da' para saber (descricao vazia, texto de sistema, carta sem `str`).
    /// </summary>
    public string TextoDoEfeito(ulong desc)
    {
        if (desc == 0) return null;
        if (_textoCache.TryGetValue(desc, out string hit)) return hit;

        uint code = (uint)(desc >> 20);
        int i = (int)(desc & 0xfffff);
        string texto = null;

        if (code != 0 && i >= 0 && i < 16 && db != IntPtr.Zero)
        {
            string query = $"SELECT str{i + 1} FROM texts WHERE id = {code}";
            if (sqlite3_prepare_v2(db, query, -1, out IntPtr stmt, IntPtr.Zero) == 0)
            {
                if (sqlite3_step(stmt) == 100)
                {
                    IntPtr raw = sqlite3_column_text(stmt, 0);
                    string s2 = raw == IntPtr.Zero ? null : Marshal.PtrToStringUTF8(raw);
                    if (!string.IsNullOrWhiteSpace(s2)) texto = s2.Trim();
                }
                sqlite3_finalize(stmt);
            }
        }

        _textoCache[desc] = texto;
        return texto;
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
    /// <summary>`CATEGORY_TOGRAVE` — manda para o cemitério (o Foolish Burial sai 0x4).</summary>
    const uint CATEGORY_PRO_CEMITERIO = 0x4;

    /// <summary>Bits de "esta carta FICA em campo" no `type` (os mesmos do ocgcore).</summary>
    const uint TYPE_CONTINUO = 0x20000, TYPE_CAMPO = 0x80000;

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
        /// <summary>
        /// O efeito dispara ao ser INVOCADO — e por isso a carta nunca deve ser
        /// SETADA. Um monstro setado entra com a face para baixo: o gatilho de
        /// invocação não acontece, e a vantagem que ele traria some com a carta.
        /// </summary>
        public readonly bool GanhaAoInvocar;
        /// <summary>
        /// TRAVA: enquanto está em campo, proíbe alguma coisa aos monstros do
        /// OPONENTE — atacar (Swords of Revealing Light) ou mudar de posição
        /// depois de virados (Swords of Concealing Light).
        ///
        /// É a única classe deste perfil que a `category` não ajuda a achar: as
        /// duas Espadas vêm com `category = 0` no `cards.cdb`, porque o que elas
        /// fazem não é um EFEITO que resolve e sim uma restrição que fica de pé.
        /// Quem as identifica é o par no Lua: a proibição
        /// (`EFFECT_CANNOT_ATTACK*` / `EFFECT_CANNOT_CHANGE_POSITION`) mais o
        /// alcance `SetTargetRange(0, LOCATION_MZONE)` — "nenhuma das minhas,
        /// todas as dele".
        ///
        /// O alcance é metade da regra, não detalhe: a Gravity Bind trava os
        /// DOIS lados (`LOCATION_MZONE,LOCATION_MZONE`) e fica de fora de
        /// propósito. Um NPC de batida que ativasse aquilo prenderia o próprio
        /// campo junto e não conseguiria mais fechar o duelo.
        /// </summary>
        public readonly bool Trava;
        /// <summary>
        /// REFORCO: uma carta que FICA em campo (contínua ou de campo) e sobe o
        /// ATK/DEF dos MEUS monstros — Yellow Luster Shield, Banner of Courage.
        ///
        /// Como a Trava, não há categoria para cruzar (vêm 0 no banco): o sinal é
        /// `EFFECT_UPDATE_ATTACK`/`_DEFENSE` mais o alcance
        /// `SetTargetRange(LOCATION_MZONE, 0)` — "todas as minhas, nenhuma das
        /// dele". O alcance é metade da regra: `(LOCATION_MZONE, LOCATION_MZONE)`
        /// reforça os DOIS lados e `(0, LOCATION_MZONE)` reforça só o dele.
        ///
        /// Exige ficar em campo de propósito. Um reforço de uma vez só (Rise of
        /// the Snake Deity, Union Attack) depende de escolher o TURNO certo, e
        /// disso o cérebro não sabe nada; um reforço permanente é bom no instante
        /// em que existe monstro para receber.
        /// </summary>
        public readonly bool ReforcoMeuCampo;
        /// <summary>
        /// Manda um monstro do DECK direto para o cemitério (Foolish Burial).
        ///
        /// Sozinha é perda de carta — o valor está no PAR: enterrar o corpo
        /// grande e reanimá-lo. Por isso quem decide usá-la olha a mão à procura
        /// de uma reanimação (<see cref="ReanimaDoCemiterio"/>).
        /// </summary>
        public readonly bool EnterraDoDeck;
        /// <summary>
        /// Embaralha os MEUS monstros virados (Shifting Shadows, Magical Hats) —
        /// desfaz o que o outro lado já sabia sobre qual carta está em qual zona.
        /// </summary>
        public readonly bool EmbaralhaViradas;
        /// <summary>
        /// O CUSTO desta carta pode sair do CAMPO, não só da mão (a Dark Factory
        /// of More Production: "mande 1 monstro da mão ou do campo ao cemitério").
        ///
        /// Existe porque `Descarta` respondia "sim" para ela e isso é meia
        /// verdade: quem decide se vale ativar precisa saber que o preço pode ser
        /// um corpo que está EM JOGO. Sem essa distinção, o NPC ficava com o campo
        /// aberto para comprar 1 carta — foi o relato.
        /// </summary>
        public readonly bool CustoPodeVirDoCampo;
        /// <summary>
        /// A carta põe em campo um corpo **CONDENADO**: ele não pode atacar e é
        /// destruído na End Phase deste mesmo turno (Instant Fusion, Ready
        /// Fusion).
        ///
        /// Vale por duas coisas que o cérebro decidia errado sem saber disto: um
        /// corpo condenado é o **tributo mais barato que existe na mesa** (o preço
        /// dele já foi pago — ele some de qualquer jeito), e ele **não conta como
        /// campo** na hora de medir ameaça, porque não ataca e nem chega ao turno
        /// do oponente.
        ///
        /// A metade do ATAQUE não precisa de regra nenhuma: o `EFFECT_CANNOT_ATTACK`
        /// é do próprio motor, então o corpo nunca aparece em `attackers`.
        /// </summary>
        public readonly bool TrazCorpoCondenado;

        public PerfilDeEfeito(bool compra, bool descarta, bool reanima, bool destroiMonstro,
                              bool destroiSt, bool busca, bool invocaEspecial, bool fusao,
                              bool pagaLp, bool ganhaAoInvocar, bool trava,
                              bool reforcoMeuCampo, bool enterraDoDeck, bool embaralhaViradas,
                              bool custoPodeVirDoCampo, bool trazCorpoCondenado)
        {
            CustoPodeVirDoCampo = custoPodeVirDoCampo;
            TrazCorpoCondenado = trazCorpoCondenado;
            Compra = compra; Descarta = descarta; ReanimaDoCemiterio = reanima;
            DestroiMonstro = destroiMonstro; DestroiSt = destroiSt; Busca = busca;
            InvocaEspecial = invocaEspecial; Fusao = fusao; PagaLp = pagaLp;
            GanhaAoInvocar = ganhaAoInvocar; Trava = trava;
            ReforcoMeuCampo = reforcoMeuCampo; EnterraDoDeck = enterraDoDeck;
            EmbaralhaViradas = embaralhaViradas;
        }
    }

    private readonly System.Collections.Generic.Dictionary<uint, int> _danoEmMimCache = new();

    /// <summary>
    /// **Quanto esta carta tira do MEU proprio LP quando resolve.**
    ///
    /// O caso que trouxe isto: a **Tremendous Fire** tira 1000 do oponente e
    /// **500 de quem a ativa**. O cerebro tinha uma lista de queima (`BURN`) e
    /// uma regra so' — *"dano fixo no oponente, ativa sempre que der"* —, entao
    /// o NPC com 500 de vida ativava a carta e **se matava**. Foi o relato:
    /// o Panik em 500 usando a Tremendous Fire.
    ///
    /// Nao ha' de onde ler isso no `cards.cdb`: a `category` da carta e'
    /// `CATEGORY_DAMAGE` para os dois lados igual — ela diz que a carta causa
    /// dano, nunca **em quem**. Quem sabe e' o Lua da propria carta, onde o
    /// jogador que ativou e' sempre `tp` e o oponente e' `1-tp`:
    ///
    ///   Duel.Damage(1-tp,1000,REASON_EFFECT,true)   -- nele
    ///   Duel.Damage(tp,500,REASON_EFFECT,true)      -- em MIM
    ///
    /// Le so' a forma literal (`tp` e um numero). Dano calculado — o ATK de um
    /// monstro, uma variavel — devolve **0**, que e' a mesma resposta honesta
    /// de <see cref="BonusDeCampo"/> para um script que ele nao sabe ler: "nao
    /// sei", e o cerebro segue como antes. Chutar um valor faria o NPC guardar
    /// uma carta boa a partida inteira.
    ///
    /// `PLAYER_ALL` fica de fora de proposito: ele atinge os DOIS, e a conta de
    /// "isso me mata?" precisaria olhar tambem o LP dele para nao virar medo a'
    /// toa. Nenhuma carta do pool de hoje usa essa forma para queimar.
    /// </summary>
    public int DanoEmMim(uint code)
    {
        if (_danoEmMimCache.TryGetValue(code, out var hit)) return hit;

        int total = 0;
        string lua = LuaDaCarta(code);
        if (!string.IsNullOrEmpty(lua))
            foreach (System.Text.RegularExpressions.Match m in
                     System.Text.RegularExpressions.Regex.Matches(
                         lua, @"Duel\.Damage\(\s*tp\s*,\s*(\d+)\s*,"))
                total += int.Parse(m.Groups[1].Value);

        _danoEmMimCache[code] = total;
        return total;
    }

    private readonly System.Collections.Generic.Dictionary<uint, (uint raca, int nivel)> _exigeCache = new();

    /// <summary>
    /// **De que CORPO esta carta precisa** para poder ser ativada — a raça e o
    /// nível mínimo de um monstro MEU, com a face para cima, na zona de monstro.
    /// `raca == 0` quando a carta não exige nada disso.
    ///
    /// O caso que trouxe isto: a **Chaos Scepter Blast** só liga com um
    /// Mago (Spellcaster) de Nível 8 ou mais em campo, e aí bane 1 carta do
    /// campo **com a face para baixo** — remoção permanente. O NPC tinha na mão
    /// a Espada, o Magician of Black Chaos (Nv8 Mago) E o ritual que o traz, e
    /// pôs em campo o Black Luster Soldier (Nv8 GUERREIRO), de 3000 de ATK.
    /// Corpo maior, combo morto: a Espada ficou na mão a partida toda.
    ///
    /// O sinal é o par no Lua — a condição perguntando se existe um monstro meu
    /// (`IsExistingMatchingCard(..., tp, LOCATION_MZONE, 0, ...)`) e o filtro
    /// dela pedindo raça e nível. São 27 cartas no banco inteiro e **uma** em
    /// deck hoje; o resto do pool não é afetado.
    /// </summary>
    public (uint raca, int nivel) ExigeCorpo(uint code)
    {
        if (_exigeCache.TryGetValue(code, out var hit)) return hit;

        var achado = ((uint)0, 0);
        string lua = LuaDaCarta(code);
        if (!string.IsNullOrEmpty(lua)
            && System.Text.RegularExpressions.Regex.IsMatch(
                   lua, @"IsExistingMatchingCard\(\s*s\.\w+\s*,\s*tp\s*,\s*LOCATION_MZONE\s*,\s*0\s*,"))
        {
            uint raca = 0;
            foreach (System.Text.RegularExpressions.Match m in
                     System.Text.RegularExpressions.Regex.Matches(lua, @"IsRace\(\s*(RACE_\w+)"))
                raca |= BonusDeCampo.Constante(m.Groups[1].Value);

            var mn = System.Text.RegularExpressions.Regex.Match(lua, @"IsLevelAbove\(\s*(\d+)");
            if (raca != 0 && mn.Success) achado = (raca, int.Parse(mn.Groups[1].Value));
        }

        _exigeCache[code] = achado;
        return achado;
    }

    private readonly System.Collections.Generic.Dictionary<uint, System.Collections.Generic.HashSet<uint>> _ritualCache = new();

    /// <summary>
    /// Os monstros que esta magia-ritual NOMEIA no Lua — vazio quando ela não
    /// nomeia nenhum.
    ///
    /// Os dois formatos existem lado a lado no mesmo deck: a Black Luster Ritual
    /// é `Ritual.AddProcGreaterCode(c, 8, nil, 5405694)`, que diz exatamente
    /// quem ela invoca; o Chaos Form filtra por ARQUÉTIPO e não cita ninguém.
    ///
    /// O vazio é a resposta honesta para o segundo caso, e quem lê trata assim:
    /// ritual que nomeia só serve para os nomeados; ritual que não nomeia é
    /// candidato a qualquer um. Fingir uma lista aqui faria o cérebro escolher o
    /// ritual errado com confiança.
    /// </summary>
    public System.Collections.Generic.HashSet<uint> RitualInvoca(uint code)
    {
        if (_ritualCache.TryGetValue(code, out var hit)) return hit;

        var achados = new System.Collections.Generic.HashSet<uint>();
        string lua = LuaDaCarta(code);
        if (!string.IsNullOrEmpty(lua))
        {
            foreach (System.Text.RegularExpressions.Match m in
                     System.Text.RegularExpressions.Regex.Matches(
                         lua, @"Ritual\.AddProc\w*Code\w*\([^)]*?(\d{5,10})\s*\)"))
                if (uint.TryParse(m.Groups[1].Value, out uint c)) achados.Add(c);
        }

        _ritualCache[code] = achados;
        return achados;
    }

    private readonly System.Collections.Generic.Dictionary<uint, bool> _salvaCache = new();

    /// <summary>
    /// **Esta carta vale mais BAIXADA do que na mão**: destruída pelo oponente
    /// enquanto está na zona de magia/armadilha, ela Invoca Especialmente
    /// alguém.
    ///
    /// A Chaos Scepter Blast é o caso: destruída ali, ela traz do DECK um dos
    /// dois magos do Caos. Na mão, destruída, não faz nada — então uma carta sem
    /// uso agora não é carta parada, é uma armadilha esperando a remoção do
    /// outro lado. As três condições juntas, porque cada uma sozinha é comum:
    /// o gatilho de destruição, a exigência de ter sido S/T, e a invocação.
    /// </summary>
    public bool SalvaSeDestruida(uint code)
    {
        if (_salvaCache.TryGetValue(code, out bool hit)) return hit;
        string lua = LuaDaCarta(code);
        bool r = !string.IsNullOrEmpty(lua)
              && lua.Contains("EVENT_DESTROYED")
              && lua.Contains("IsPreviousLocation(LOCATION_SZONE)")
              && lua.Contains("SpecialSummon");
        _salvaCache[code] = r;
        return r;
    }

    private readonly System.Collections.Generic.Dictionary<uint, BonusDeCampo> _campoCache = new();

    /// <summary>
    /// O que uma Magia de Campo faz com o ATK dos monstros — lido do Lua dela
    /// (ver <see cref="BonusDeCampo"/>). Com cache: o cérebro pergunta a mesma
    /// carta a cada decisão.
    /// </summary>
    public BonusDeCampo CampoDe(uint code)
    {
        if (_campoCache.TryGetValue(code, out var hit)) return hit;
        var b = BonusDeCampo.Ler(LuaDaCarta(code));
        _campoCache[code] = b;
        return b;
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
        var st = Stats(code);
        uint cat = st.Category;
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
        // `EVENT_SUMMON_SUCCESS` é o gatilho de "fui Invocado (com a face para
        // cima)". Quem o tem perde o efeito ao ser setado — o Magician's Rod
        // busca uma magia ao ser Invocado, e setado ele vira só um corpo de 100
        // de DEF.
        bool ganhaAoInvocar = lua.Contains("EVENT_SUMMON_SUCCESS");
        // TRAVA (ver o comentário do campo). Sem categoria nenhuma para cruzar —
        // as duas Espadas vêm com `category = 0` —, então o sinal é só o Lua, e
        // por isso ele é DUPLO: a proibição sozinha pegaria a Gravity Bind, que
        // prende o meu campo junto; o alcance sozinho pegaria qualquer efeito
        // contínuo mirado no outro lado.
        bool trava = (lua.Contains("EFFECT_CANNOT_ATTACK")
                      || lua.Contains("EFFECT_CANNOT_CHANGE_POSITION"))
                  && System.Text.RegularExpressions.Regex.IsMatch(
                         lua, @"SetTargetRange\(\s*0\s*,\s*LOCATION_MZONE\s*\)");

        // REFORCO permanente do MEU campo (ver o comentário do campo). O `Fica`
        // é o que separa o reforço permanente do de uma vez só: o segundo depende
        // de escolher o turno, e disso o cérebro não sabe nada.
        bool fica = (st.Type & (TYPE_CONTINUO | TYPE_CAMPO)) != 0;
        bool reforcoMeuCampo = fica
            && (lua.Contains("EFFECT_UPDATE_ATTACK") || lua.Contains("EFFECT_UPDATE_DEFENSE"))
            && System.Text.RegularExpressions.Regex.IsMatch(
                   lua, @"SetTargetRange\(\s*LOCATION_MZONE\s*,\s*0\s*\)");

        // ENTERRAR do deck (Foolish Burial). A categoria sozinha pegaria todo
        // efeito que manda alguma coisa para o cemitério — o `LOCATION_DECK` é o
        // que restringe à carta que tira do DECK.
        bool enterraDoDeck = (cat & CATEGORY_PRO_CEMITERIO) != 0
                          && lua.Contains("LOCATION_DECK") && lua.Contains("SendtoGrave");

        bool embaralhaViradas = lua.Contains("ShuffleSetCard");

        // O custo aceita a MAO ou o CAMPO? O idioma do Lua é o par de locais numa
        // chamada só (`LOCATION_HAND|LOCATION_MZONE`), e o `REASON_COST` é o que
        // separa "o custo" de "o efeito" — há muita carta que ALCANÇA os dois
        // lugares para fazer alguma coisa, e essa não cobra nada por isso.
        // CORPO CONDENADO (ver o comentário do campo). Os quatro sinais juntos:
        // ela invoca especialmente, o corpo não pode atacar, e ele é destruído
        // numa End Phase. Nenhum sozinho serve — `EFFECT_CANNOT_ATTACK` também
        // aparece nas magias de TRAVA (que prendem o campo DELE), e `PHASE_END`
        // aparece em tudo que tem prazo. A Polymerization, que invoca por fusão
        // um corpo que FICA, não casa: ela não tem os outros dois.
        bool trazCorpoCondenado = lua.Contains("EFFECT_CANNOT_ATTACK")
                               && lua.Contains("PHASE_END")
                               && lua.Contains("SpecialSummon")
                               && lua.Contains("Destroy");

        bool custoPodeVirDoCampo = lua.Contains("REASON_COST")
            && System.Text.RegularExpressions.Regex.IsMatch(lua,
                   @"LOCATION_HAND\s*[|+]\s*LOCATION_MZONE|LOCATION_MZONE\s*[|+]\s*LOCATION_HAND");

        var p = new PerfilDeEfeito(compra, descarta, reanima, destroiMonstro,
                                   destroiSt, busca, invocaEspecial, fusao, pagaLp,
                                   ganhaAoInvocar, trava,
                                   reforcoMeuCampo, enterraDoDeck, embaralhaViradas,
                                   custoPodeVirDoCampo, trazCorpoCondenado);
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
