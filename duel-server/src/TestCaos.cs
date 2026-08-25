using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// O pacote **CAOS** do Yugi — `--test-caos`.
    ///
    /// O relato veio de um duelo real: *"o Yugi preferiu invocar um Lustro Negro
    /// em vez de usar Magician of Black Chaos + Chaos Scepter = combo pra banir
    /// meu ritual pra sempre; ele ia tirar 2 cards do meu campo, do jeito que fez
    /// tirou apenas 1"*.
    ///
    /// A **Chaos Scepter Blast** só liga com um **Mago (Spellcaster) de Nível 8
    /// ou mais** com a face para cima no campo dela, e aí bane 1 carta do campo
    /// **com a face para baixo** — remoção permanente, que não volta nem se
    /// identifica. O NPC tinha na mão a Espada, o **Magician of Black Chaos**
    /// (Nv8 MAGO) e o **Black Luster Soldier** (Nv8 GUERREIRO), mais os rituais
    /// dos dois. Pôs o Guerreiro, de 3000 de ATK.
    ///
    /// Não era critério errado: `AtivavelSe(q, EhRitual)` devolve o PRIMEIRO
    /// ritual ativável da lista. Não havia critério nenhum, então a escolha entre
    /// pôr 3000 de ATK e fechar um combo de duas remoções era a ordem em que o
    /// motor tivesse listado as cartas.
    ///
    /// A segunda metade veio do mesmo relato: *"ensina a máquina a baixar o Chaos
    /// Scepter caso não tenha uso, porque se ele é destruído traz um dos Chaos
    /// magician pro campo"*. É o próprio texto da carta, e a diferença está na
    /// ZONA — destruída na mão ela não faz nada; destruída na zona de magia, ela
    /// Invoca Especialmente do DECK.
    /// </summary>
    public static class TestCaos
    {
        const uint ESPADA = 15256925;        // Chaos Scepter Blast
        const uint MAGO_CAOS = 30208479;     // Magician of Black Chaos — Nv8 MAGO
        const uint LUSTRO = 5405694;         // Black Luster Soldier — Nv8 GUERREIRO
        const uint RITUAL_LUSTRO = 55761792; // Black Luster Ritual — NOMEIA o Lustro
        const uint RITUAL_MAGO = 76792184;   // Black Magic Ritual — NOMEIA o Mago
        const uint CHAOS_FORM = 21082832;    // Chaos Form — nao nomeia ninguem
        const uint POLY = 24094653;          // par controle: ritual nenhum
        const uint POT = 55144522;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que o Lua diz das cartas ===\n");
            ALeitura(sa);

            Log.Info("\n=== a escolha do ritual (a jogada relatada) ===\n");
            AEscolha(sa);

            Log.Info("\n=== baixar a Espada quando ela nao tem uso ===\n");
            OGuardaChuva(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------ leitura

        static void ALeitura(string sa)
        {
            using var db = new DatabaseManager(sa);

            var exige = db.ExigeCorpo(ESPADA);
            Check("a Espada exige um corpo de raça e nível", exige.raca != 0,
                  "(sem isto o cerebro nao sabe que ela esta' parada por FALTA DE CORPO)");
            Check("...e o corpo e' um MAGO", (exige.raca & db.Stats(MAGO_CAOS).Race) != 0,
                  $"(raca exigida 0x{exige.raca:x}, o Mago e' 0x{db.Stats(MAGO_CAOS).Race:x})");
            Check("...de nivel 8 ou mais", exige.nivel == 8, $"(veio {exige.nivel})");

            // O PAR CONTROLE que e' o coracao da jogada: o Lustro Negro tem o
            // mesmo nivel e MAIS ATK, e nao serve — ele e' Guerreiro.
            Check("par CONTROLE: o Lustro Negro (Nv8, 3000 ATK) NAO serve — e' Guerreiro",
                  (exige.raca & db.Stats(LUSTRO).Race) == 0,
                  "(era exatamente a troca que o NPC fez)");

            Check("par CONTROLE: o Pote da Ganancia nao exige corpo nenhum",
                  db.ExigeCorpo(POT).raca == 0);

            // Quem cada ritual NOMEIA — e o que fazer com o que nao nomeia ninguem.
            Check("Black Luster Ritual nomeia o Lustro", db.RitualInvoca(RITUAL_LUSTRO).Contains(LUSTRO));
            Check("Black Magic Ritual nomeia o Mago", db.RitualInvoca(RITUAL_MAGO).Contains(MAGO_CAOS));
            Check("Chaos Form nao nomeia ninguem (filtra por arquetipo)",
                  db.RitualInvoca(CHAOS_FORM).Count == 0,
                  "(fingir uma lista aqui faria o cerebro escolher errado com confianca)");
            Check("par CONTROLE: a Polymerization nao e' ritual e nao nomeia nada",
                  db.RitualInvoca(POLY).Count == 0);

            Check("a Espada se SALVA se destruida na zona de magia", db.SalvaSeDestruida(ESPADA));
            Check("par CONTROLE: o Pote nao", !db.SalvaSeDestruida(POT));
        }

        // ------------------------------------------------------------ escolha

        static void AEscolha(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuCampo = new List<uint>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (code: c, pos: 0x1, seq: i)).ToList()
                    : new List<(uint, int, int)>());

            InteractiveDuel.Question Idle(params uint[] ativaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis)
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            // A MÃO DO DUELO RELATADO: a Espada parada, os dois corpos Nv8 e os
            // dois rituais. Antes, `AtivavelSe` levava o primeiro da lista — e a
            // lista comeca pelo ritual do Lustro.
            minhaMao.Clear(); meuCampo.Clear();
            minhaMao.AddRange(new[] { ESPADA, MAGO_CAOS, LUSTRO, RITUAL_LUSTRO, CHAOS_FORM });
            var p1 = brain.Decide(Idle(RITUAL_LUSTRO, CHAOS_FORM), 1);
            Check("escolhe o ritual que traz o MAGO, e nao o que traz o Lustro",
                  p1.Action == "activate" && p1.Index == 1,
                  $"(veio {p1.Action} idx {p1.Index} — {p1.Why})");
            Check("e diz por que (a carta parada na mao)",
                  (p1.Why ?? "").Contains(ESPADA.ToString()), $"(motivo: {p1.Why})");

            // ...e a ESCOLHA do monstro tem de cumprir a decisao. Sem isto o
            // criterio generico (maior ATK) traria o Guerreiro de volta, desfazendo
            // tudo na pergunta seguinte.
            var sel = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            sel.choices.Add(new InteractiveDuel.Sel { code = LUSTRO, index = 0, location = 0x2, controller = 1 });
            sel.choices.Add(new InteractiveDuel.Sel { code = MAGO_CAOS, index = 1, location = 0x2, controller = 1 });
            var escolha = brain.DecideSelect(sel, 1);
            Check("e invoca o MAGO, mesmo o Lustro tendo 200 de ATK a mais",
                  escolha.Count == 1 && escolha[0] == 1,
                  $"(escolheu {(escolha.Count > 0 ? sel.choices[escolha[0]].code.ToString() : "nenhum")})");

            // PAR CONTROLE 1: sem a Espada na mao nao ha' combo a fechar, e a regra
            // nao pode se meter — o ritual volta a ser o primeiro ativavel.
            minhaMao.Clear(); meuCampo.Clear();
            minhaMao.AddRange(new[] { MAGO_CAOS, LUSTRO, RITUAL_LUSTRO, CHAOS_FORM });
            var p2 = brain.Decide(Idle(RITUAL_LUSTRO, CHAOS_FORM), 1);
            Check("par CONTROLE: sem a Espada na mao, nao ha' preferencia",
                  p2.Action == "activate" && p2.Index == 0,
                  $"(veio idx {p2.Index} — {p2.Why})");

            // PAR CONTROLE 2: o corpo JA' esta' em campo. A Espada nao esta' parada
            // por falta dele, e gastar um ritual para repetir o que ja' existe
            // seria trocar uma carta por nada.
            minhaMao.Clear(); minhaMao.AddRange(new[] { ESPADA, MAGO_CAOS, LUSTRO, RITUAL_LUSTRO, CHAOS_FORM });
            meuCampo.Clear(); meuCampo.Add(MAGO_CAOS);
            var p3 = brain.Decide(Idle(RITUAL_LUSTRO, CHAOS_FORM), 1);
            Check("par CONTROLE: com o Mago JA' em campo, nao ha' preferencia",
                  p3.Action == "activate" && p3.Index == 0,
                  $"(veio idx {p3.Index} — {p3.Why})");

            // PAR CONTROLE 3: so' o ritual do Lustro disponivel. Ele NOMEIA o
            // Guerreiro, entao nao acorda nada — mas continua sendo jogada, e a
            // regra nao pode travar o turno recusando-a.
            minhaMao.Clear(); meuCampo.Clear();
            minhaMao.AddRange(new[] { ESPADA, MAGO_CAOS, LUSTRO, RITUAL_LUSTRO });
            var p4 = brain.Decide(Idle(RITUAL_LUSTRO), 1);
            Check("par CONTROLE: com so' o ritual do Lustro, ele sai assim mesmo",
                  p4.Action == "activate", $"(veio {p4.Action} — {p4.Why})");
        }

        // ------------------------------------------------------- guarda-chuva

        static void OGuardaChuva(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuCampo = new List<uint>();
            int stEmCampo = 0;

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                stCountOf: _ => stEmCampo);

            InteractiveDuel.Question Idle(uint[] ativaveis, uint[] setaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis)
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                i = 0;
                foreach (var c in setaveis)
                    q.settableST.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            bool Baixou(NpcBrain.Play p) =>
                p.Action == "setspell" && (p.Why ?? "").Contains(ESPADA.ToString());

            // Sem corpo em campo, a Espada nao esta' ativavel — e parada na mao ela
            // nao faz nada. Baixada, ela vira a armadilha que o texto dela promete.
            minhaMao.Clear(); minhaMao.Add(ESPADA);
            meuCampo.Clear(); stEmCampo = 0;
            var p1 = brain.Decide(Idle(Array.Empty<uint>(), new[] { ESPADA }), 1);
            Check("sem uso agora: BAIXA a Espada", Baixou(p1), $"(veio {p1.Action} — {p1.Why})");

            // PAR CONTROLE: com o corpo em campo ela ESTA' ativavel, e ativar (banir
            // 1 carta do campo dele, para sempre) vale mais que a espera.
            minhaMao.Clear(); minhaMao.Add(ESPADA);
            meuCampo.Clear(); meuCampo.Add(MAGO_CAOS); stEmCampo = 0;
            var p2 = brain.Decide(Idle(new[] { ESPADA }, new[] { ESPADA }), 1);
            Check("par CONTROLE: podendo ativar, NAO baixa", !Baixou(p2),
                  $"(veio {p2.Action} — {p2.Why})");

            // PAR CONTROLE: com as zonas cheias, baixar travaria o proprio jogo —
            // a mesma folga que a regra da armadilha respeita.
            minhaMao.Clear(); minhaMao.Add(ESPADA);
            meuCampo.Clear(); stEmCampo = 4;
            var p3 = brain.Decide(Idle(Array.Empty<uint>(), new[] { ESPADA }), 1);
            Check("par CONTROLE: com as zonas cheias, nao baixa", !Baixou(p3),
                  $"(veio {p3.Action} — {p3.Why})");

            // PAR CONTROLE: o Pote da Ganancia nao se salva se destruido — baixa-lo
            // seria so' adiar a compra.
            minhaMao.Clear(); minhaMao.Add(POT);
            meuCampo.Clear(); stEmCampo = 0;
            var p4 = brain.Decide(Idle(Array.Empty<uint>(), new[] { POT }), 1);
            Check("par CONTROLE: o Pote nao e' baixado por esta regra",
                  p4.Action != "setspell" || !(p4.Why ?? "").Contains("se ele a destruir"),
                  $"(veio {p4.Action} — {p4.Why})");
        }
    }
}
