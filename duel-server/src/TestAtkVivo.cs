using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// O NPC decide pelo ATK/DEF **de agora** — `--test-atk-vivo`.
    ///
    /// O bug que originou: o `NpcBrain` inteiro lia `DatabaseManager.Stats(code)`,
    /// que é o statline IMPRESSO na carta, direto do `cards.cdb`. Todo modificador
    /// contínuo — Equip Spell, magia de campo, efeito que sobe ATK — é invisível
    /// ali. O sintoma na mesa: o jogador equipa +700 num monstro, e o NPC ataca
    /// assim mesmo, porque na conta dele aquele monstro continua valendo o número
    /// impresso. Ele perde o monstro numa batalha que "ganharia".
    ///
    /// O mais traiçoeiro é que nada acusava: a TELA já mostrava o ATK certo (o
    /// evento `stats` sempre veio do motor, ver `--test-fieldbonus`). Só quem
    /// decide o ataque é que não enxergava. O jogador via 2200 na carta dele e o
    /// NPC de 1700 se jogando em cima.
    ///
    /// Duas camadas, como no `--test-pegasus`:
    ///   1. **decisão isolada** — a regra afirmada com números montados à mão, sem
    ///      motor. É onde se prova que o cérebro USA o valor vivo;
    ///   2. **duelo real** — prova que o valor vivo CHEGA nele, isto é, que o
    ///      `StatsEmCampo` está mesmo plugado. Sem esta camada, a primeira passaria
    ///      com o acessador desligado e ninguém notaria.
    ///
    /// O par CONTROLE é o coração do arquivo: o mesmo duelo sem o equipamento,
    /// onde o NPC **tem de atacar**. Sem ele, "o NPC não atacou" não prova nada —
    /// um NPC quebrado que nunca ataca passaria no teste.
    /// </summary>
    public static class TestAtkVivo
    {
        const uint URABY = 1784619;        // Normal Nv4 1500/800 — o monstro do jogador
        const uint HORN = 64047146;        // Horn of the Unicorn — +700 ATK/DEF, sem restrição
        const uint BATTLE_OX = 5053103;    // Normal Nv4 1700/1000 — o atacante do NPC

        // 1500 base, 2200 equipado. O 1700 do Battle Ox fica exatamente NO MEIO:
        // é o que separa "leu o impresso" de "leu o de agora" numa comparação só.
        const int URABY_BASE = 1500, URABY_EQUIPADO = 2200, OX = 1700;

        const byte MZONE = 0x4;
        const int POS_ATAQUE = 0x1;

        static int _pass, _fail;
        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que as cartas valem no banco (a premissa do resto) ===\n");
            OBanco(sa);
            Log.Info("\n=== decisao isolada: o cerebro usa o valor vivo, nao o impresso ===\n");
            Isolado(sa);
            Log.Info("\n=== duelo real: CONTROLE — sem equipamento o NPC ATACA ===\n");
            bool atacouSemEquip = DueloReal(sa, comEquipamento: false);
            Log.Info("\n=== duelo real: com +700 no alvo, o NPC NAO ataca ===\n");
            bool atacouComEquip = DueloReal(sa, comEquipamento: true);

            Check("CONTROLE: sem equipamento o NPC declara ataque (1700 > 1500)", atacouSemEquip,
                  "(nao atacou nem sem bonus — o teste abaixo nao provaria nada)");
            Check("com o alvo em 2200, o NPC NAO declara ataque (1700 < 2200)", !atacouComEquip,
                  "(atacou assim mesmo — voltou a ler o ATK impresso na carta)");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- o banco

        static void OBanco(string sa)
        {
            using var db = new DatabaseManager(sa);
            var uraby = db.Stats(URABY);
            var ox = db.Stats(BATTLE_OX);
            Check($"Uraby e' {uraby.AtkValue}/{uraby.DefValue} impresso",
                  uraby.AtkValue == URABY_BASE);
            Check($"Battle Ox e' {ox.AtkValue} — entre o Uraby impresso ({URABY_BASE}) " +
                  $"e o equipado ({URABY_EQUIPADO})",
                  ox.AtkValue == OX && ox.AtkValue > URABY_BASE && ox.AtkValue < URABY_EQUIPADO,
                  "(sem esse sanduiche o teste nao distingue as duas leituras)");
        }

        // ------------------------------------------------------------- isolado

        /// <summary>
        /// O cérebro com um campo montado à mão e um `statsEmCampoOf` de mentira.
        /// Nenhum motor envolvido: aqui se afirma a REGRA, e o mesmo cenário roda
        /// duas vezes — com o acessador ligado e desligado — para mostrar que a
        /// resposta muda por causa dele, e não por acaso.
        /// </summary>
        static void Isolado(string sa)
        {
            using var db = new DatabaseManager(sa);

            // Campo fixo: NPC (1) com um Battle Ox na zona 0; jogador (0) com um
            // Uraby na zona 0. `seq` é o que liga cada monstro ao ATK vivo.
            var campoNpc = new List<(uint code, int pos, int seq)> { (BATTLE_OX, POS_ATAQUE, 0) };
            var campoJogador = new List<(uint code, int pos, int seq)> { (URABY, POS_ATAQUE, 0) };

            NpcBrain Cerebro(Func<int, int, (int atk, int def)?> statsVivo) => new NpcBrain(
                db,
                p => (p == 1 ? campoNpc : campoJogador).Select(m => m.code).ToList(),
                s => Log.Info($"    [npc] {s}"),
                _ => Array.Empty<uint>(),
                _ => 0,
                p => (p == 1 ? campoNpc : campoJogador).Select(m => (m.code, m.pos)).ToList(),
                _ => 0, _ => Array.Empty<uint>(), _ => 8000,
                p => p == 1 ? campoNpc : campoJogador,
                _ => Array.Empty<uint>(),
                statsVivo);

            var q = new InteractiveDuel.Question { kind = "battle", player = 1 };
            q.attackers.Add(new InteractiveDuel.Act
            { code = BATTLE_OX, index = 0, controller = 1, location = MZONE, sequence = 0 });

            // (a) SEM acessador: cai no impresso — 1700 > 1500, ataca. É o
            //     comportamento antigo, e ele continua certo QUANDO não há bônus.
            var semVivo = Cerebro(null).DecideBattle(q, 1);
            Check("sem informacao viva, decide pelo impresso e ataca (1700 > 1500)",
                  semVivo.Attack, $"(veio {semVivo.Why})");

            // (b) COM acessador dizendo que o Uraby está em 2200: recusa.
            (int, int)? Vivo(int player, int seq) =>
                player == 0 && seq == 0 ? (URABY_EQUIPADO, 1500)
                : player == 1 && seq == 0 ? (OX, 1000)
                : ((int, int)?)null;

            var comVivo = Cerebro(Vivo).DecideBattle(q, 1);
            Check("com o alvo valendo 2200 agora, NAO ataca", !comVivo.Attack,
                  $"(veio attack={comVivo.Attack}: {comVivo.Why})");
            Check("e o motivo cita o 2200, nao o 1500 (leu o valor certo)",
                  comVivo.Why.Contains(URABY_EQUIPADO.ToString()),
                  $"(motivo: {comVivo.Why})");

            // (c) O PRÓPRIO monstro do NPC equipado: subestimar-se também é bug.
            //     Ox em 2400 contra um Uraby de 1500 — tem de atacar, e o motivo
            //     precisa citar o 2400.
            (int, int)? VivoOxForte(int player, int seq) =>
                player == 1 && seq == 0 ? (2400, 1000)
                : player == 0 && seq == 0 ? (URABY_BASE, 800)
                : ((int, int)?)null;

            var oxForte = Cerebro(VivoOxForte).DecideBattle(q, 1);
            Check("o NPC tambem le o bonus no PROPRIO monstro (2400 ataca o 1500)",
                  oxForte.Attack && oxForte.Why.Contains("2400"),
                  $"(veio attack={oxForte.Attack}: {oxForte.Why})");
        }

        // ---------------------------------------------------------- duelo real

        /// <summary>
        /// O jogador (0) invoca o Uraby, opcionalmente equipa o Horn, e passa o
        /// turno. O NPC (1) joga sozinho. Devolve se ele DECLAROU ataque.
        /// </summary>
        static bool DueloReal(string sa, bool comEquipamento)
        {
            // Deck do jogador: Uraby + o equipamento. Saturado de propósito — o
            // alvo é a MECÂNICA, não a consistência de um deck de verdade.
            var meu = new List<uint>();
            for (int i = 0; i < 12; i++) meu.Add(URABY);
            if (comEquipamento) for (int i = 0; i < 12; i++) meu.Add(HORN);
            while (meu.Count < 40) meu.Add(URABY);

            // Deck do NPC: só Battle Ox, para o atacante ser sempre o mesmo 1700.
            var dele = new List<uint>();
            while (dele.Count < 40) dele.Add(BATTLE_OX);

            using var duel = new InteractiveDuel(sa, meu.ToArray(), 20260815UL, 0x1000000UL,
                                                 npc: true, npcDeck: dele.ToArray());
            var r = duel.Advance();

            bool invocou = false, equipou = false, npcAtacou = false;
            int atkDoUraby = 0;
            int guard = 0;

            while (!r.ended && guard++ < 400)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;

                    // O ATK que o MOTOR atribui ao Uraby — a prova de que o
                    // equipamento pegou (e o número que o NPC deveria enxergar).
                    if (tipo == "stats")
                    {
                        int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);
                        int atk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? 0);
                        if (ctrl == 0 && atk > 0) atkDoUraby = atk;
                    }

                    if (tipo == "attack")
                    {
                        int quem = Convert.ToInt32(t.GetProperty("atkCtrl")?.GetValue(e) ?? 0);
                        if (quem == 1)
                        {
                            npcAtacou = true;
                            Log.Info("  > o NPC DECLAROU ataque");
                        }
                    }

                    if (tipo == "npc")
                    {
                        string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                        if (why.Contains("ataca") || why.Contains("encerra") || why.Contains("ATK"))
                            Log.Info($"  npc: {why}");
                    }
                }

                // Já sabemos o que queríamos: o NPC teve a chance e decidiu.
                if (npcAtacou) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var uraby = q.summonable.FirstOrDefault(a => a.code == URABY);
                        var horn = q.activatable.FirstOrDefault(a => a.code == HORN);

                        if (!invocou && uraby.code == URABY)
                        {
                            invocou = true;
                            Log.Info("  > jogador invoca o Uraby (1500) em ataque");
                            r = duel.Respond("summon", uraby.index);
                        }
                        else if (comEquipamento && !equipou && horn.code == HORN)
                        {
                            equipou = true;
                            Log.Info("  > jogador equipa Horn of the Unicorn (+700)");
                            r = duel.Respond("activate", horn.index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    // O Uraby precisa entrar EM ATAQUE: em defesa o NPC compararia
                    // com a DEF e o teste mediria outra coisa.
                    case "position": r = duel.Respond("position", POS_ATAQUE); break;
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "battle": r = duel.Respond("endbattle", 0); break;
                    case "chain": r = duel.Respond("chain", -1); break;
                    case "yesno": r = duel.Respond("yesno", 1); break;
                    case "selectcard":
                    case "selecttribute":
                    case "selectsum":
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        r = q.canFinish && q.choices.Count == 0
                            ? duel.Respond("finishselect", 0)
                            : duel.Respond("pick", q.choices[0].index);
                        break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check($"{(comEquipamento ? "[com equip] " : "[controle] ")}o Uraby entrou em campo", invocou);
            if (comEquipamento)
            {
                Check("[com equip] o equipamento pegou de verdade no motor " +
                      $"(o Uraby esta em {atkDoUraby})",
                      equipou && atkDoUraby == URABY_EQUIPADO,
                      $"(equipou={equipou}, motor diz {atkDoUraby}, esperado {URABY_EQUIPADO})");
            }
            return npcAtacou;
        }
    }
}
