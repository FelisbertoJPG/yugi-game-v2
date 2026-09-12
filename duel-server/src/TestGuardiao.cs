using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **O suporte do arquétipo Gate Guardian — `--test-guardiao`.**
    ///
    /// O deck do Para &amp; Dox ganhou três cartas que mudam como ele joga, e uma
    /// delas muda uma PREMISSA antiga do cérebro:
    ///
    ///   • **Dark Element** — com um monstro "Gate Guardian" no MEU cemitério,
    ///     paga metade dos LP e põe um Nv11+ do arquétipo em campo (da mão, do
    ///     deck ou do Extra — **nunca do cemitério**). Quer dizer: o Guardião no
    ///     cemitério deixou de ser carta morta e virou INTERRUPTOR;
    ///   • **Double Attack! Wind and Thunder!!** — destrói 1 carta do campo
    ///     tendo um Guardião em campo (a regra genérica de remoção já a
    ///     enxerga: o Lua dela chama `Duel.Destroy`);
    ///   • **Riryoku Guardian** — perdendo no LP, corta os dele pela metade e
    ///     põe esse tanto de ATK no meu Guardião.
    ///
    /// E as TRÊS dividem o mesmo segundo efeito: **banir a si mesmas do
    /// cemitério para buscar 1 Sanga/Kazejin/Suijin**. É o motor de recurso do
    /// deck, e não custa nada — a carta já foi gasta.
    ///
    /// O pedido era somar sem estragar: *"manter 1 Gate Guardian no GY para a
    /// spell, mas não jogar todos lá"* e *"banir as spells para continuar
    /// gerando recurso"*.
    /// </summary>
    public static class TestGuardiao
    {
        const uint DARK_ELEMENT = 53194323;
        const uint DOUBLE_ATTACK = 60176682;
        const uint RIRYOKU = 96661780;
        const uint GATE_GUARDIAN = 25833572;
        const uint FOOLISH = 81439173;
        const uint SANGA = 25955164;
        const uint LABYRINTH_WALL = 67284908;   // 0/3000 — corpo qualquer, sem efeito
        const uint CHEERFUL_COFFIN = 41142615;  // descarta ate' 3 monstros da mao
        const uint JIRAI_GUMO = 94773007;       // 2200/100 — o descarte "natural" da fila
        const byte HAND = 0x2, GRAVE = 0x10, DECK = 0x1;
        const int POS_ATAQUE = 0x1;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            using var db = new DatabaseManager(sa);

            Log.Info("=== o recurso de graca: banir a magia do cemiterio ===\n");
            ORecursoDeGraca(db);

            Log.Info("\n=== Dark Element: metade dos LP tem preco ===\n");
            ODarkElement(db);

            Log.Info("\n=== Foolish: enterrar UM Guardiao para ligar a chave ===\n");
            OEnterroDoGuardiao(db);

            Log.Info("\n=== Cheerful Coffin: descartar da MAO para ligar a chave ===\n");
            OCoffin(db);

            Log.Info("\n=== Riryoku Guardian: a hora e' uma so' ===\n");
            ORiryoku(db);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------ o recurso

        static void ORecursoDeGraca(DatabaseManager db)
        {
            // A MESMA carta, oferecida do CEMITÉRIO: é o efeito de busca.
            var q = Idle();
            Ativavel(q, DARK_ELEMENT, GRAVE, 0);
            var r = Cerebro(db, lp: 8000).Decide(q, 1);
            Check("bane a magia do cemiterio para buscar uma peca",
                  r.Action == "activate" && r.Index == 0, $"({r.Action}: {r.Why})");

            // As três dividem o efeito — não pode ser regra de uma carta só.
            foreach (var mg in new[] { DOUBLE_ATTACK, RIRYOKU })
            {
                var q2 = Idle();
                Ativavel(q2, mg, GRAVE, 7);
                var r2 = Cerebro(db, lp: 8000).Decide(q2, 1);
                Check($"idem para {mg}", r2.Action == "activate" && r2.Index == 7,
                      $"({r2.Action}: {r2.Why})");
            }

            // **O par CONTROLE que separa os dois efeitos da MESMA carta.** Da
            // mão, a Dark Element cobra metade dos LP — se a regra "de graça"
            // pegasse esta oferta, ela pagaria meia vida achando que não pagava
            // nada. Com 1200 LP o piso barra a ativação, então a prova é que o
            // cérebro NÃO escolhe aquele índice.
            var q3 = Idle();
            Ativavel(q3, DARK_ELEMENT, HAND, 3);
            var r3 = Cerebro(db, lp: 1200).Decide(q3, 1);
            Check("CONTROLE: a MESMA carta na MAO nao e' tratada como busca de graca",
                  !(r3.Action == "activate" && r3.Index == 3), $"({r3.Action}: {r3.Why})");
        }

        // -------------------------------------------------- a Dark Element

        static void ODarkElement(DatabaseManager db)
        {
            var q = Idle();
            Ativavel(q, DARK_ELEMENT, HAND, 0);

            var cheio = Cerebro(db, lp: 8000).Decide(q, 1);
            Check("com 8000 LP, ativa (metade nao dói e o corpo vale)",
                  cheio.Action == "activate" && cheio.Index == 0, $"({cheio.Action}: {cheio.Why})");

            // CONTROLE do PISO: metade de 1500 são 750, abaixo dos 1000.
            var q2 = Idle();
            Ativavel(q2, DARK_ELEMENT, HAND, 0);
            var baixo = Cerebro(db, lp: 1500).Decide(q2, 1);
            Check("CONTROLE: com 1500 LP ela NAO sai (metade fura o piso)",
                  !(baixo.Action == "activate" && baixo.Index == 0), $"({baixo.Action}: {baixo.Why})");

            // CONTROLE do CAMPO: já tenho um 3750 de pé contra um campo fraco —
            // meia vida por um corpo que não muda a mesa.
            var q3 = Idle();
            Ativavel(q3, DARK_ELEMENT, HAND, 0);
            var dominando = Cerebro(db, lp: 8000,
                                    meuCampo: new List<(uint, int, int)> { (GATE_GUARDIAN, POS_ATAQUE, 0) })
                            .Decide(q3, 1);
            Check("CONTROLE: ja' dominando a mesa, guarda a carta",
                  !(dominando.Action == "activate" && dominando.Index == 0),
                  $"({dominando.Action}: {dominando.Why})");
        }

        // ------------------------------------------------------- o enterro

        static void OEnterroDoGuardiao(DatabaseManager db)
        {
            var cerebro = Cerebro(db, lp: 8000,
                                  mao: new List<uint> { FOOLISH, DARK_ELEMENT },
                                  deck: new List<uint> { GATE_GUARDIAN, GATE_GUARDIAN, DARK_ELEMENT });

            var q = Idle();
            Ativavel(q, FOOLISH, HAND, 0);
            var r = cerebro.Decide(q, 1);
            Check("ativa o Foolish para enterrar o Guardiao (a chave da Dark Element)",
                  r.Action == "activate" && r.Index == 0, $"({r.Action}: {r.Why})");

            // A ESCOLHA: o enterro dirigido tem de trazer o Gate Guardian, e não
            // o maior ATK nem "o que volta do cemitério" — ele não volta.
            var sel = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            sel.choices.Add(new InteractiveDuel.Sel { code = SANGA, index = 0, controller = 1, location = DECK });
            sel.choices.Add(new InteractiveDuel.Sel { code = GATE_GUARDIAN, index = 1, controller = 1, location = DECK });
            var escolha = cerebro.DecideSelect(sel, 1);
            Check("e ENTERRA o Gate Guardian, nao a peca de maior ATK",
                  escolha.Count == 1 && escolha[0] == 1, $"(escolheu {string.Join(",", escolha)})");

            // **"Nao jogar todos la'"** — o mesmo cérebro, um segundo Foolish.
            // A chave já está ligada, então a segunda cópia fica fora do
            // cemitério para ser invocada.
            var q2 = Idle();
            Ativavel(q2, FOOLISH, HAND, 0);
            var r2 = cerebro.Decide(q2, 1);
            Check("o SEGUNDO Foolish nao enterra outro Guardiao",
                  !(r2.Action == "activate" && (r2.Why ?? "").Contains("LIGAR")),
                  $"({r2.Action}: {r2.Why})");

            // CONTROLE: sem Dark Element em lugar nenhum, enterrar o Guardiao e'
            // so' rasgar carta — ele nao volta do cemiterio.
            var semChave = Cerebro(db, lp: 8000,
                                   mao: new List<uint> { FOOLISH },
                                   deck: new List<uint> { GATE_GUARDIAN, GATE_GUARDIAN });
            var q3 = Idle();
            Ativavel(q3, FOOLISH, HAND, 0);
            var r3 = semChave.Decide(q3, 1);
            Check("CONTROLE: sem Dark Element, nao enterra o Guardiao",
                  !(r3.Action == "activate" && (r3.Why ?? "").Contains("LIGAR")),
                  $"({r3.Action}: {r3.Why})");
        }

        // ------------------------------------------------------- o Coffin
        //
        // O relato: *"ele tinha 1 Gate Guardian e 1 Dark Element na mao, podia
        // descartar o Guardiao e sair jogando — como nao fez, perdeu"*. É a irmã
        // da razão (c) do Foolish, pela outra porta: lá o Guardião sai do DECK,
        // aqui sai da MÃO.

        static void OCoffin(DatabaseManager db)
        {
            var cerebro = Cerebro(db, lp: 8000,
                                  mao: new List<uint> { CHEERFUL_COFFIN, DARK_ELEMENT, GATE_GUARDIAN },
                                  deck: new List<uint> { GATE_GUARDIAN, GATE_GUARDIAN });

            var q = Idle();
            Ativavel(q, CHEERFUL_COFFIN, HAND, 0);
            var r = cerebro.Decide(q, 1);
            Check("ativa o Cheerful Coffin com a Dark Element ao lado na mao",
                  r.Action == "activate" && r.Index == 0, $"({r.Action}: {r.Why})");

            // **O DESCARTE DIRIGIDO.** A fila de descarte dá −3 ao Gate Guardian
            // para PROTEGÊ-LO — sem a marca, ela descartaria o Jirai Gumo e a
            // chave continuaria desligada, com a carta já gasta.
            var sel = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            sel.choices.Add(new InteractiveDuel.Sel { code = JIRAI_GUMO, index = 0, controller = 1, location = HAND });
            sel.choices.Add(new InteractiveDuel.Sel { code = GATE_GUARDIAN, index = 1, controller = 1, location = HAND });
            var escolha = cerebro.DecideSelect(sel, 1);
            Check("e DESCARTA o Gate Guardian, vencendo a protecao da fila",
                  escolha.Count == 1 && escolha[0] == 1, $"(descartou {string.Join(",", escolha)})");

            // CONTROLE 1: a marca vale por UMA pergunta. No descarte seguinte a
            // proteção do Guardião volta a valer — senão o deck se desmontaria
            // sozinho no primeiro custo que aparecesse.
            var sel2 = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            sel2.choices.Add(new InteractiveDuel.Sel { code = JIRAI_GUMO, index = 0, controller = 1, location = HAND });
            sel2.choices.Add(new InteractiveDuel.Sel { code = GATE_GUARDIAN, index = 1, controller = 1, location = HAND });
            var escolha2 = cerebro.DecideSelect(sel2, 1);
            Check("CONTROLE: no descarte seguinte o Guardiao volta a ser protegido",
                  escolha2.Count == 1 && escolha2[0] == 0, $"(descartou {string.Join(",", escolha2)})");

            // CONTROLE 2: sem a Dark Element na mão, descartar o Guardião é só
            // rasgar carta — ele não volta do cemitério sozinho.
            var semChave = Cerebro(db, lp: 8000,
                                   mao: new List<uint> { CHEERFUL_COFFIN, GATE_GUARDIAN },
                                   deck: new List<uint> { GATE_GUARDIAN });
            var q3 = Idle();
            Ativavel(q3, CHEERFUL_COFFIN, HAND, 0);
            var r3 = semChave.Decide(q3, 1);
            Check("CONTROLE: sem a Dark Element na mao, nao ativa o Coffin",
                  !(r3.Action == "activate" && r3.Index == 0), $"({r3.Action}: {r3.Why})");
        }

        // ------------------------------------------------------- o desempate

        static void ORiryoku(DatabaseManager db)
        {
            var q = Idle();
            Ativavel(q, RIRYOKU, HAND, 0);
            var r = Cerebro(db, lp: 2000).Decide(q, 1);
            Check("oferecida, a Riryoku Guardian sai (o motor ja' cobrou a condicao)",
                  r.Action == "activate" && r.Index == 0, $"({r.Action}: {r.Why})");
        }

        // ---------------------------------------------------------- arnês

        static InteractiveDuel.Question Idle() =>
            new InteractiveDuel.Question { kind = "idle", player = 1 };

        static void Ativavel(InteractiveDuel.Question q, uint code, byte local, int index) =>
            q.activatable.Add(new InteractiveDuel.Act
            { code = code, index = index, controller = 1, location = local, sequence = 0 });

        static NpcBrain Cerebro(DatabaseManager db, int lp,
                                List<(uint code, int pos, int seq)> meuCampo = null,
                                List<uint> mao = null, List<uint> deck = null)
        {
            var campo = meuCampo ?? new List<(uint code, int pos, int seq)>();
            var vazio = new List<(uint code, int pos, int seq)>();
            return new NpcBrain(
                db,
                p => (p == 1 ? campo : vazio).Select(m => m.code).ToList(),
                s => Log.Info($"    [npc] {s}"),
                p => p == 1 ? (IReadOnlyList<uint>)(mao ?? new List<uint>()) : Array.Empty<uint>(),
                _ => 0,
                p => (p == 1 ? campo : vazio).Select(m => (m.code, m.pos)).ToList(),
                _ => 0, _ => Array.Empty<uint>(),
                p => p == 1 ? lp : 8000,
                p => p == 1 ? campo : vazio,
                _ => Array.Empty<uint>(),
                null, null,
                p => p == 1 ? (IReadOnlyList<uint>)(deck ?? new List<uint>()) : Array.Empty<uint>());
        }
    }
}
