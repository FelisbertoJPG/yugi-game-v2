using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// O pacote de SUPORTE do deck do Panik — `--test-panik`.
    ///
    /// Três cartas que o cérebro carregava a partida inteira sem jogar, achadas
    /// pela varredura do `--cobertura` (e não por leitura do `NpcBrain`, que é
    /// como buraco de regra passa despercebido: o que se procura é justamente o
    /// que não está escrito lá).
    ///
    ///   YELLOW LUSTER SHIELD / BANNER OF COURAGE — reforço PERMANENTE do meu
    ///       campo. Nenhuma categoria as classifica (vêm 0 no `cards.cdb`), então
    ///       o sinal é o Lua: `EFFECT_UPDATE_ATTACK/_DEFENSE` mais o alcance
    ///       `SetTargetRange(LOCATION_MZONE, 0)` — "todas as minhas, nenhuma das
    ///       dele" — e o tipo, que precisa FICAR em campo.
    ///   FOOLISH BURIAL — sozinha é perda de carta; o valor está no par com a
    ///       reanimação. A condição é a mão, não o campo. (A segunda razão da
    ///       regra — a reanimação que ainda está no DECK, que é o que faz a carta
    ///       sair numa mão de abertura — mora em `--test-enterro`.)
    ///   SHIFTING SHADOWS — não muda um ponto de ATK: apaga o que o outro lado já
    ///       sabia sobre qual carta está em qual zona. Num deck de cartas setadas
    ///       é disso que o duelo vive.
    ///
    /// Cada metade tem par CONTROLE, e nos dois casos ele é o que separa "a regra
    /// tem critério" de "a regra dispara sempre" — que passariam igual num teste
    /// que só olhasse o caso bom.
    /// </summary>
    public static class TestPanik
    {
        const uint YELLOW_LUSTER = 4542651;    // Magia Continua: +300 DEF nos MEUS
        const uint BANNER = 10012614;          // Magia Continua: +200 ATK nos MEUS (Battle Phase)
        const uint FOOLISH = 81439173;         // manda 1 monstro do DECK para o cemiterio
        const uint SHIFTING = 59237154;        // Magia Continua: embaralha as MINHAS viradas (300 LP)

        // Os dois pares controle do reconhecimento, um para cada metade da regra:
        const uint SOGEN = 86318356;           // reforca os DOIS lados (alcance errado)
        const uint UNION_ATTACK = 60399954;    // reforca so' os meus, mas e' de UMA vez (nao fica)

        const uint MONSTER_REBORN = 83764718;
        const uint POT = 55144522;

        const uint PETIT_MOTH = 58192742, MYSTICAL_ELF = 15025844,
                   BATTLE_OX = 5053103, GAIA_NV7 = 6368038,
                   METAL_GUARDIAN = 68339286, KING_YAMIMAKAI = 69455834;

        const byte HAND = 0x2, SZONE = 0x8;
        const int LP_PISO = 1000;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que o Lua diz de cada carta (nao ha' categoria para cruzar) ===\n");
            OReconhecimento(sa);

            Log.Info("\n=== as decisoes, com a mesa montada a mao ===\n");
            AsDecisoes(sa);

            Log.Info("\n=== duelo de verdade com o deck do Panik ===\n");
            NoDuelo(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------- reconhecimento

        static void OReconhecimento(string sa)
        {
            using var db = new DatabaseManager(sa);

            Check("Yellow Luster Shield e' reforco do MEU campo", db.Perfil(YELLOW_LUSTER).ReforcoMeuCampo);
            Check("Banner of Courage tambem", db.Perfil(BANNER).ReforcoMeuCampo);

            // As DUAS metades da regra, uma em cada controle. Sem elas, "reconhece
            // as duas cartas certas" ficaria de pe' com uma regra que reconhece
            // qualquer carta que mexa em ATK.
            Check("par CONTROLE (alcance): Sogen NAO e' — reforca os DOIS lados",
                  !db.Perfil(SOGEN).ReforcoMeuCampo,
                  "(o NPC subiria o ATK do oponente junto com o dele)");
            Check("par CONTROLE (permanencia): Union Attack NAO e' — e' de uma vez so'",
                  !db.Perfil(UNION_ATTACK).ReforcoMeuCampo,
                  "(reforco de um turno depende de escolher o turno, e disso o cerebro nao sabe)");

            Check("Foolish Burial manda do DECK para o cemiterio", db.Perfil(FOOLISH).EnterraDoDeck);
            Check("par CONTROLE: Monster Reborn NAO enterra (ele TIRA do cemiterio)",
                  !db.Perfil(MONSTER_REBORN).EnterraDoDeck);
            Check("par CONTROLE: Pote da Ganancia NAO enterra", !db.Perfil(POT).EnterraDoDeck);

            Check("Shifting Shadows embaralha as minhas viradas", db.Perfil(SHIFTING).EmbaralhaViradas);
            Check("par CONTROLE: Yellow Luster Shield nao embaralha nada",
                  !db.Perfil(YELLOW_LUSTER).EmbaralhaViradas);
        }

        // ------------------------------------------------------------ decisoes

        static void AsDecisoes(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();      // meus monstros com a face para CIMA
            var minhasViradas = new List<uint>(); // meus monstros com a face para BAIXO
            var campoDele = new List<uint>();
            var minhaMao = new List<uint>();
            int meuLp = 8000;

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : campoDele,
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                lpOf: _ => meuLp,
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (c, 0x1, i))
                        .Concat(minhasViradas.Select((c, i) => (c, 0x8, meuCampo.Count + i))).ToList()
                    : campoDele.Select((c, i) => (c, 0x1, i)).ToList());

            InteractiveDuel.Question Idle(uint code, byte onde = HAND)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = onde });
                return q;
            }

            bool Ativou(NpcBrain.Play p, uint code) =>
                p.Action == "activate" && (p.Why ?? "").Contains(code.ToString());

            void Zerar()
            {
                meuCampo.Clear(); minhasViradas.Clear(); campoDele.Clear();
                minhaMao.Clear(); meuLp = 8000;
            }

            // ---- reforco permanente ----
            Zerar(); meuCampo.Add(METAL_GUARDIAN); campoDele.Add(BATTLE_OX);
            var p1 = brain.Decide(Idle(YELLOW_LUSTER), 1);
            Check("com corpo em campo, ATIVA o reforco", Ativou(p1, YELLOW_LUSTER),
                  $"(veio {p1.Action} — {p1.Why})");

            // PAR CONTROLE: sem corpo o reforco nao reforca nada, e ainda ocupa a
            // zona que uma armadilha usaria.
            Zerar(); campoDele.Add(BATTLE_OX);
            var p2 = brain.Decide(Idle(YELLOW_LUSTER), 1);
            Check("par CONTROLE: campo vazio, GUARDA o reforco", !Ativou(p2, YELLOW_LUSTER),
                  $"(veio {p2.Action} — {p2.Why})");

            Zerar(); meuCampo.Add(KING_YAMIMAKAI);
            var p3 = brain.Decide(Idle(BANNER), 1);
            Check("a mesma regra vale para o Banner of Courage", Ativou(p3, BANNER),
                  $"(veio {p3.Action} — {p3.Why})");

            // ---- enterrar para reanimar ----
            Zerar(); minhaMao.Add(FOOLISH); minhaMao.Add(MONSTER_REBORN);
            var p4 = brain.Decide(Idle(FOOLISH), 1);
            Check("com reanimacao na MAO, enterra do deck", Ativou(p4, FOOLISH),
                  $"(veio {p4.Action} — {p4.Why})");

            // PAR CONTROLE: sem o par, enterrar e' pagar uma carta para encher o
            // proprio cemiterio.
            //
            // Este `brain` nao recebe `listaDoDeckOf`, entao a SEGUNDA razao da
            // regra 5.56 — a reanimacao que ainda esta' no DECK — nao tem o que
            // ler e nao dispara. Nao e' descuido: e' o que prova que decidir pelo
            // deck e' opcional, e que nada mudou para quem nao o informa. A outra
            // metade tem controle proprio em `--test-enterro`, com um deck de
            // verdade e sem reanimacao nenhuma dentro dele.
            Zerar(); minhaMao.Add(FOOLISH); minhaMao.Add(POT);
            var p5 = brain.Decide(Idle(FOOLISH), 1);
            Check("par CONTROLE: sem reanimacao na mao (e sem decklist), GUARDA", !Ativou(p5, FOOLISH),
                  $"(veio {p5.Action} — {p5.Why})");

            // ---- embaralhar as viradas ----
            Zerar(); minhasViradas.Add(METAL_GUARDIAN); minhasViradas.Add(PETIT_MOTH);
            minhaMao.Add(SHIFTING);
            var p6 = brain.Decide(Idle(SHIFTING), 1);
            Check("com carta virada, poe o Shifting Shadows em campo", Ativou(p6, SHIFTING),
                  $"(veio {p6.Action} — {p6.Why})");

            // PAR CONTROLE: sem nada virado nao ha' o que esconder.
            Zerar(); meuCampo.Add(BATTLE_OX); minhaMao.Add(SHIFTING);
            var p7 = brain.Decide(Idle(SHIFTING), 1);
            Check("par CONTROLE: sem carta virada, GUARDA", !Ativou(p7, SHIFTING),
                  $"(veio {p7.Action} — {p7.Why})");

            // O efeito de IGNICAO, ja' com a carta em campo (loc 8). Quantas
            // viradas sao precisas quem exige e' o Lua; o que sobra ao cerebro e'
            // a conta do custo.
            Zerar(); minhasViradas.Add(METAL_GUARDIAN); minhasViradas.Add(PETIT_MOTH);
            var p8 = brain.Decide(Idle(SHIFTING, SZONE), 1);
            Check("com LP folgado, usa o efeito (300 LP)", Ativou(p8, SHIFTING),
                  $"(veio {p8.Action} — {p8.Why})");

            // PAR CONTROLE: os 300 LP nao podem furar o piso. Perder o duelo para
            // esconder de qual zona e' o muro seria o pior negocio possivel.
            Zerar(); minhasViradas.Add(METAL_GUARDIAN); minhasViradas.Add(PETIT_MOTH);
            meuLp = LP_PISO + 200;
            var p9 = brain.Decide(Idle(SHIFTING, SZONE), 1);
            Check($"par CONTROLE: com {meuLp} de vida, NAO paga os 300", !Ativou(p9, SHIFTING),
                  $"(veio {p9.Action} — {p9.Why})");
        }

        // ---------------------------------------------------------------- duelo

        /// <summary>
        /// O deck do Panik de verdade, contra um jogador que so' poe corpo em
        /// campo e passa a vez. As secoes acima provam o CRITERIO sobre uma mesa
        /// montada aqui; este prova o resto do caminho — que as cartas chegam a
        /// `activatable` e que as jogadas saem sozinhas.
        /// </summary>
        static void NoDuelo(string sa)
        {
            uint[] panik =
            {
                62121, 62121, 62121, 69455834, 69455834, 69455834,
                68339286, 68339286, 68339286, 32344688, 32344688, 32344688,
                33066139, 33066139, 33066139, 4542651, 4542651, 4542651,
                46918794, 46918794, 46918794, 9064354, 9064354, 9064354,
                70828912, 70828912, 70828912, 12923641, 12923641,
                55144522, 55144522, 1845204, 1845204, 1845204,
                10012614, 10012614, 81439173, 81439173, 81439173,
                59237154, 59237154,
            };
            uint[] panikExtra = { 6840573, 6840573, 6840573 };

            var deckJogador = new List<uint>();
            for (int i = 0; i < 40; i++) deckJogador.Add(i % 2 == 0 ? GAIA_NV7 : BATTLE_OX);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 20260823UL, 0x1000000UL,
                                                 npc: true, npcDeck: panik, npcExtra: panikExtra);
            var r = duel.Advance();

            var motivos = new List<string>();
            for (int guard = 0; guard < 400 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var (acao, why) = LerNpc(e);
                    if (acao == "activate" && why != null) motivos.Add(why);
                }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    if (q.summonable.Count > 0) { r = duel.Respond("summon", q.summonable[0].index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }

            bool Saiu(string trecho) => motivos.Any(m => m.Contains(trecho));

            Log.Info($"  ({motivos.Count} ativacoes do NPC no duelo)");
            Check("o reforco permanente saiu sozinho", Saiu("reforco permanente"),
                  $"(motivos: {string.Join(" | ", motivos.Distinct().Take(8))})");
            Check("o Shifting Shadows foi para o campo sozinho", Saiu(SHIFTING.ToString()),
                  "(nenhuma ativacao citou a carta)");
            // O Foolish Burial depende de a reanimacao estar na mao AO MESMO
            // TEMPO — e' combo, e combo depende do embaralhamento. Aqui basta que
            // o duelo tenha rodado inteiro sem a regra travar nada.
            Check("o duelo rodou inteiro sem nenhuma regra estourar", motivos.Count > 0,
                  "(o NPC nao ativou nada — alguma regra derrubou a decisao)");
        }

        static (string acao, string why) LerNpc(object e)
        {
            var t = e.GetType();
            if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") return (null, null);
            return (t.GetProperty("action")?.GetValue(e) as string,
                    t.GetProperty("why")?.GetValue(e) as string);
        }

        static InteractiveDuel.Result Padrao(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            switch (q.kind)
            {
                case "place": return duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                case "position": return duel.Respond("position", 0x1);
                case "yesno": return duel.Respond("yesno", 0);
                case "option": return duel.Respond("option", 0);
                case "battle": return duel.Respond("endbattle", 0);
                case "chain": return duel.Respond("chain", -1);
                case "selectcard":
                case "selecttribute":
                case "selectsum":
                    return duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                case "selectunselect":
                    return q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index);
                default: return duel.Respond("endturn", 0);
            }
        }
    }
}
