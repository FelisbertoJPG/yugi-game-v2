using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **O NPC nao se mata, e o duelo sabe quem venceu** — `--test-derrota`.
    ///
    /// O relato: *"quando o oponente sofre uma derrota devido ao proprio efeito,
    /// o jogo nao sabe interpretar isso (o que e' uma vitoria do player);
    /// exemplo e' o Panik estar com 500 ou menos de vida e usar a Tremendous
    /// Fire"*.
    ///
    /// Sao DUAS perguntas, e a medida separou uma da outra:
    ///
    ///   1. **o motor sabe?** Sabe. Um duelo em que o LP do NPC zera termina com
    ///      `ended` e `winner = 0` — o MSG_WIN chega, o `Winner()` le o LP e o
    ///      front desenha "voce venceu". Esta metade fica aqui como guarda: e' a
    ///      unica que prova que a vitoria por LP zerado NO MEIO DE UMA RESOLUCAO
    ///      (e nao numa batalha) chega inteira ao lado de fora.
    ///   2. **o NPC devia ter feito isso?** Nao. A **Tremendous Fire** tira 1000
    ///      do oponente e **500 de quem a ativa**, e a regra de queima do
    ///      `NpcBrain` era uma linha so' — *"dano fixo no oponente, ativa sempre
    ///      que der"*. Com 500 de vida ele a ativava e perdia o duelo ali.
    ///
    /// **Nao ha' o que ler no banco.** A `category` da carta e' `CATEGORY_DAMAGE`
    /// — ela diz que a carta causa dano, nunca EM QUEM. Quem sabe e' o Lua da
    /// propria carta, onde quem ativou e' `tp` e o oponente e' `1-tp`
    /// (`DatabaseManager.DanoEmMim`). E' a mesma regra da casa das magias de
    /// campo: a resposta sai do script, e um script que ele nao sabe ler devolve
    /// "nao sei" (zero) em vez de um palpite.
    ///
    /// O par CONTROLE e' o coracao: com 8000 de vida a MESMA carta TEM de ser
    /// ativada. Sem ele, um NPC que nunca queimasse nada passaria no teste — e o
    /// deck de queima ficaria sem a condicao de vitoria dele.
    /// </summary>
    public static class TestDerrota
    {
        const uint TREMENDOUS_FIRE = 46918794;  // 1000 nele, 500 EM MIM
        const uint OOKAZI = 19523799;           // 800 nele, nada em mim
        const uint HINOTAMA = 46130346;         // 500 nele, nada em mim
        const uint FINAL_FLAME = 73134081;      // 600 nele, nada em mim

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== quanto cada queima cobra de QUEM a ativa (lido do Lua) ===\n");
            OLua(sa);

            Log.Info("\n=== decisao isolada: com 500 de vida ele NAO ativa a Tremendous Fire ===\n");
            Isolado(sa);

            Log.Info("\n=== duelo real: queimado ate' a casa dos 200, ele segura a carta ===\n");
            NoDuelo(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // --------------------------------------------------------------- o Lua

        static void OLua(string sa)
        {
            using var db = new DatabaseManager(sa);

            Check("Tremendous Fire cobra 500 de quem a ativa",
                  db.DanoEmMim(TREMENDOUS_FIRE) == 500,
                  $"(leu {db.DanoEmMim(TREMENDOUS_FIRE)})");

            // Os pares CONTROLE do reconhecimento: as outras queimas da mesma
            // lista nao cobram nada. Um leitor que confundisse `tp` com `1-tp`
            // devolveria o dano DELE aqui, e o NPC pararia de queimar justamente
            // quando estivesse ganhando — o avesso do bug.
            Check("par CONTROLE: Ookazi nao cobra nada de mim", db.DanoEmMim(OOKAZI) == 0,
                  $"(leu {db.DanoEmMim(OOKAZI)} — confundiu `tp` com `1-tp`?)");
            Check("par CONTROLE: Hinotama nao cobra nada de mim", db.DanoEmMim(HINOTAMA) == 0,
                  $"(leu {db.DanoEmMim(HINOTAMA)})");
            Check("par CONTROLE: Final Flame nao cobra nada de mim", db.DanoEmMim(FINAL_FLAME) == 0,
                  $"(leu {db.DanoEmMim(FINAL_FLAME)})");
        }

        // ------------------------------------------------------------- isolado

        static void Isolado(string sa)
        {
            using var db = new DatabaseManager(sa);
            int lp = 8000;

            var brain = new NpcBrain(db,
                fieldOf: _ => new List<uint>(),
                log: m => Log.Info($"    [npc] {m}"),
                handOf: _ => new List<uint> { TREMENDOUS_FIRE },
                lpOf: _ => lp);

            InteractiveDuel.Question Idle(params uint[] naMao)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                for (int i = 0; i < naMao.Length; i++)
                    q.activatable.Add(new InteractiveDuel.Act { code = naMao[i], index = i });
                return q;
            }

            // PAR CONTROLE primeiro: com vida de sobra, a carta TEM de sair.
            lp = 8000;
            var comVida = brain.Decide(Idle(TREMENDOUS_FIRE), 1);
            Check("par CONTROLE: com 8000 de vida ele ATIVA a Tremendous Fire",
                  comVida.Action == "activate",
                  $"(veio {comVida.Action} — {comVida.Why}; um NPC que nunca queima " +
                  "passaria em todas as assercoes de baixo)");

            // 501 sobrevive por um ponto: e' o degrau exato da regra, e e' o que
            // separa "nao me mato" de um piso de LP inventado.
            lp = 501;
            var noFio = brain.Decide(Idle(TREMENDOUS_FIRE), 1);
            Check("com 501 ele ainda ativa — sobra 1 de vida",
                  noFio.Action == "activate", $"(veio {noFio.Action} — {noFio.Why})");

            lp = 500;
            var noLimite = brain.Decide(Idle(TREMENDOUS_FIRE), 1);
            Check("com 500 ele NAO ativa: os 500 dela zerariam a vida dele",
                  noLimite.Action != "activate", $"(veio {noLimite.Action} — {noLimite.Why})");

            lp = 200;
            var abaixo = brain.Decide(Idle(TREMENDOUS_FIRE), 1);
            Check("com 200 tambem nao", abaixo.Action != "activate",
                  $"(veio {abaixo.Action} — {abaixo.Why})");

            // A recusa nao pode engolir a queima que nao custa nada. Filtrar
            // DEPOIS de escolher o candidato faria o NPC parar de queimar so' por
            // ter uma Tremendous Fire na mao — e o deck de queima morre com a mao
            // cheia e o campo vazio.
            lp = 200;
            var comOokazi = brain.Decide(Idle(TREMENDOUS_FIRE, OOKAZI), 1);
            Check("com 200 e uma Ookazi ao lado, ele ativa a OOKAZI",
                  comOokazi.Action == "activate" && comOokazi.Index == 1,
                  $"(veio {comOokazi.Action} idx={comOokazi.Index} — {comOokazi.Why})");
        }

        // --------------------------------------------------------------- duelo

        /// <summary>
        /// O duelo que reproduziu o relato. O JOGADOR queima o NPC com Ookazi
        /// (800, sem custo nenhum para quem ativa) ate' a casa dos 200 e para; o
        /// NPC tem a mao cheia de Tremendous Fire e, antes desta correcao,
        /// ativava a primeira e morria.
        ///
        /// Prova as duas metades de uma vez:
        ///   • ele SOBREVIVE ao turno em que a carta esta' ativavel e ele nao tem
        ///     vida para ela — a regra chegou ao duelo de verdade, e nao so' ao
        ///     cerebro montado a mao;
        ///   • quando o LP dele finalmente zera — pela Ookazi do jogador —, o
        ///     duelo TERMINA e o vencedor anunciado e' o jogador. E' a metade "o
        ///     motor sabe interpretar", que o relato punha em duvida.
        /// </summary>
        static void NoDuelo(string sa)
        {
            var deckJogador = new List<uint>();
            while (deckJogador.Count < 40) deckJogador.Add(OOKAZI);
            var deckNpc = new List<uint>();
            while (deckNpc.Count < 40) deckNpc.Add(TREMENDOUS_FIRE);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 20260824UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray());
            var r = duel.Advance();

            int[] lp = { 8000, 8000 };
            int? winner = null;
            bool viuEnd = false;
            int menorLpVivoDoNpc = 8000;
            bool suicidou = false;
            bool queimouAlgumaVez = false;
            int turnosDeleNoFio = 0;   // turnos DELE com a vida abaixo do custo da carta

            for (int guard = 0; guard < 600 && !r.ended; guard++)
            {
                var volta = Colher(r, lp, ref winner, ref viuEnd, quemQueima: 1);
                suicidou |= volta.suicidio;
                queimouAlgumaVez |= volta.queimou;
                turnosDeleNoFio += volta.turnosDele.Count(l => l > 0 && l <= 500);
                if (lp[1] > 0) menorLpVivoDoNpc = Math.Min(menorLpVivoDoNpc, lp[1]);

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    var ook = q.activatable.FirstOrDefault(a => a.code == OOKAZI);
                    bool temOokazi = ook.code == OOKAZI;

                    // Fase 1 — queima ate' a casa dos 200 e PARA. Dai' em diante,
                    // quem baixar o LP do NPC so' pode ser ele mesmo.
                    if (temOokazi && lp[1] > 900) { r = duel.Respond("activate", ook.index); continue; }

                    // Fase 2 — passa o turno enquanto ele nao prova que sobrevive.
                    // Sao os turnos DELE, com a mao cheia de uma carta que cobra
                    // mais vida do que ele tem, e sem nenhuma outra jogada no deck.
                    if (turnosDeleNoFio < 3) { r = duel.Respond("endturn", 0); continue; }

                    // Fase 3 — fecha o duelo pela Ookazi, para a assercao do fim
                    // de duelo ser sobre LP zerado e nao sobre deckout.
                    if (temOokazi) { r = duel.Respond("activate", ook.index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }
            var ultima = Colher(r, lp, ref winner, ref viuEnd, quemQueima: 1);
            suicidou |= ultima.suicidio;

            Check($"o NPC chegou a {menorLpVivoDoNpc} de vida, abaixo dos 500 que a carta cobra",
                  menorLpVivoDoNpc <= 500 && menorLpVivoDoNpc > 0,
                  "(o duelo nao alcancou o estado que reproduz o relato)");
            Check("e ele ja' havia ativado a Tremendous Fire antes, com vida de sobra",
                  queimouAlgumaVez,
                  "(a carta nunca chegou a ser ativavel — 'nao se matou' nao provaria nada)");
            Check($"passou {turnosDeleNoFio} turno(s) proprio(s) nesse estado, com o deck todo " +
                  "de Tremendous Fire, e NAO se queimou ate' zero",
                  turnosDeleNoFio >= 3 && !suicidou,
                  suicidou ? "(ativou a carta que cobra mais vida do que ele tinha)"
                           : "(nao chegou a ter a vez dele nesse estado)");

            Check("o duelo TERMINOU", r.ended && viuEnd);
            Check("com o LP do NPC em zero e o do jogador de pe", lp[1] <= 0 && lp[0] > 0,
                  $"(lp0={lp[0]} lp1={lp[1]})");
            Check("e o vencedor anunciado e' o JOGADOR (winner = 0)", winner == 0,
                  $"(veio {(winner.HasValue ? winner.Value.ToString() : "nenhum")} — " +
                  "a tela mostraria 'oponente venceu' ou um empate)");
        }

        /// <summary>
        /// Le os eventos de uma volta e devolve o que o teste precisa saber dela:
        /// se <paramref name="quemQueima"/> ativou a Tremendous Fire, se o LP dele
        /// chegou a zero na MESMA volta em que a ativou (o suicidio que o teste
        /// procura), e o LP dele no comeco de cada turno DELE — que e' como se
        /// conta quantas vezes ele teve a vez com a vida abaixo do custo da carta.
        /// </summary>
        static (bool queimou, bool suicidio, List<int> turnosDele) Colher(
            InteractiveDuel.Result r, int[] lp, ref int? winner, ref bool viuEnd, int quemQueima)
        {
            bool suicidio = false, queimou = false;
            var turnosDele = new List<int>();

            foreach (var e in r.events)
            {
                var t = e.GetType();
                string tipo = t.GetProperty("type")?.GetValue(e) as string;

                if (tipo == "turn")
                {
                    if (Convert.ToInt32(t.GetProperty("player").GetValue(e)) == quemQueima)
                        turnosDele.Add(lp[quemQueima]);
                }
                else if (tipo == "npc")
                {
                    string acao = t.GetProperty("action")?.GetValue(e) as string;
                    string por = t.GetProperty("why")?.GetValue(e) as string ?? "";
                    if (acao == "activate" && por.Contains(TREMENDOUS_FIRE.ToString()))
                        queimou = true;
                }
                else if (tipo == "lp")
                {
                    int p = Convert.ToInt32(t.GetProperty("player").GetValue(e));
                    lp[p] = Convert.ToInt32(t.GetProperty("lp").GetValue(e));
                    if (p == quemQueima && lp[p] <= 0 && queimou) suicidio = true;
                }
                else if (tipo == "end")
                {
                    viuEnd = true;
                    var w = t.GetProperty("winner")?.GetValue(e);
                    if (w != null) winner = Convert.ToInt32(w);
                }
            }
            return (queimou, suicidio, turnosDele);
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
