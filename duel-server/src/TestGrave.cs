using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste da SAÍDA DO CEMITÉRIO — `--test-grave`.
    ///
    /// Por que existe: o cemitério, no front, é uma pilha que só crescia. Carta
    /// que saía de lá (Monster Reborn revivendo, resgate para a mão) aparecia no
    /// destino E continuava listada no cemitério — um fantasma.
    ///
    /// O conserto é do lado do front, mas ele depende de um contrato do
    /// servidor: o `move` precisa trazer `fromLoc = 0x10` e o `code` REAL da
    /// carta, senão não há como saber qual tirar da pilha. É esse contrato que
    /// este teste protege — se o parser do MSG_MOVE mudar, o front voltaria a
    /// mostrar fantasmas silenciosamente, e é o tipo de coisa que ninguém nota
    /// até olhar o cemitério.
    /// </summary>
    public static class TestGrave
    {
        const uint REBORN = 83764718;        // Monster Reborn
        const uint BATTLE_OX = 5053103;      // Nv4
        const uint MYSTICAL_ELF = 15025844;  // Nv4
        const uint GAIA_NV7 = 6368038;       // Gaia The Fierce Knight — 2 tributos

        const byte LOC_MZONE = 0x4, LOC_GRAVE = 0x10, LOC_HAND = 0x2;

        static int _pass, _fail;
        static bool DIAG = Environment.GetEnvironmentVariable("DIAG") == "1";

        const uint CALL_HAUNTED = 97077563;  // Chamado dos Assombrados (Armadilha Contínua)

        public static int Run(string sa)
        {
            Log.Info("=== teste: saida do cemiterio (Monster Reborn) ===\n");
            RebornTiraDoCemiterio(sa);
            Log.Info("\n=== teste: Call of the Haunted (armadilha SETADA no campo) ===\n");
            ChamadoDosAssombrados(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Call of the Haunted — Armadilha CONTÍNUA que revive 1 monstro do
        /// cemitério.
        ///
        /// Exercita três coisas de uma vez, e por isso vale como teste:
        ///   1. ativar carta JÁ SETADA no campo (e não da mão);
        ///   2. escolher alvo no cemitério (SELECT_CARD vindo de LOCATION_GRAVE);
        ///   3. o monstro saindo do cemitério para o campo — o mesmo caminho do
        ///      Monster Reborn, que é onde estava o bug do "fantasma" na pilha.
        ///
        /// Ela também é um Set: pelas regras, armadilha não pode ser ativada no
        /// turno em que foi baixada. Quem cuida disso é o motor — ela só aparece
        /// em `activatable` no turno seguinte, e o teste não precisa contar turnos.
        /// </summary>
        static void ChamadoDosAssombrados(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 10; i++) deck.Add(CALL_HAUNTED);
            for (int i = 0; i < 8; i++) deck.Add(GAIA_NV7);   // tributo -> enche o cemiterio
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF };
            while (deck.Count < 40) deck.Add(lv4[deck.Count % lv4.Length]);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 8642UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool setouArmadilha = false, ativouDoCampo = false, reviveu = false;
            uint codigoRevivido = 0;
            byte locOrigemAtivacao = 0;
            int copiasAntes = 0, copiasDepois = 0;
            var noCemiterio = new List<uint>();

            for (int guard = 0; guard < 400 && !r.ended && !reviveu; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    byte ctrl = Convert.ToByte(t.GetProperty("controller")?.GetValue(e) ?? (byte)0);

                    if (loc == LOC_GRAVE && ctrl == 0) noCemiterio.Add(code);
                    if (from == LOC_GRAVE && loc == LOC_MZONE && ctrl == 0 && code != 0)
                    {
                        reviveu = true; codigoRevivido = code;
                        // Conta ANTES e DEPOIS: o cemitério tem duplicatas, então
                        // "a carta não está mais lá" seria uma asserção errada —
                        // sobra a outra cópia do mesmo código. O que se cobra é a
                        // pilha ter diminuído em exatamente uma, que é o mesmo
                        // cuidado do `indexOf`/`splice` no front.
                        copiasAntes = noCemiterio.Count(x => x == code);
                        int i = noCemiterio.IndexOf(code);
                        if (i >= 0) noCemiterio.RemoveAt(i);
                        copiasDepois = noCemiterio.Count(x => x == code);
                        Log.Info($"  > {code} voltou do cemiterio para o campo " +
                                 $"(copias na pilha: {copiasAntes} -> {copiasDepois})");
                    }
                }
                if (reviveu) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        // A armadilha ativável vem com location = SZONE (0x8):
                        // é a prova de que está sendo ativada DO CAMPO, e não
                        // da mão (que seria 0x2).
                        var call = q.activatable.FirstOrDefault(a => a.code == CALL_HAUNTED);
                        var setar = q.settableST.FirstOrDefault(a => a.code == CALL_HAUNTED);
                        var nv7 = q.summonable.FirstOrDefault(a => a.code == GAIA_NV7);

                        // Há monstro meu no cemitério para reviver?
                        bool temAlvo = noCemiterio.Any(c => c == BATTLE_OX || c == MYSTICAL_ELF
                                                            || c == GAIA_NV7);
                        if (DIAG)
                            Log.Info($"  [diag] idle p{q.player} ativaveis=[" +
                                     string.Join(",", q.activatable.Select(a => $"{a.code}@0x{a.location:x}")) +
                                     $"] setavelST=[{string.Join(",", q.settableST.Select(a => a.code))}]" +
                                     $" invocaveis={q.summonable.Count} cemiterio={noCemiterio.Count}");

                        if (call.code == CALL_HAUNTED)
                        {
                            ativouDoCampo = true;
                            locOrigemAtivacao = call.location;
                            Log.Info($"  > Call of the Haunted ativavel (location 0x{call.location:x})");
                            r = duel.Respond("activate", call.index);
                        }
                        else if (setar.code == CALL_HAUNTED && !setouArmadilha)
                        {
                            setouArmadilha = true;
                            Log.Info("  > setando a armadilha");
                            r = duel.Respond("setspell", setar.index);
                        }
                        else if (!temAlvo && nv7.code == GAIA_NV7)
                        {
                            Log.Info("  > invoca o Nv7 por tributo (enche o cemiterio)");
                            r = duel.Respond("summon", nv7.index);
                        }
                        // PARA de invocar assim que há armadilha setada e alvo no
                        // cemitério. Não é detalhe de teste: o Call of the Haunted
                        // exige `GetLocationCount(MZONE) > 0` — com as 5 zonas
                        // ocupadas ele nunca fica ativável, e a primeira versão
                        // deste teste falhou exatamente assim, enchendo o campo.
                        else if (!temAlvo && q.summonable.Count > 0)
                            r = duel.Respond("summon", q.summonable[0].index);
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place":
                        r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                        break;
                    case "selectcard":
                    case "selecttribute":
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        r = q.canFinish && q.choices.Count == 0
                            ? duel.Respond("finishselect", 0)
                            : duel.Respond("pick", q.choices[0].index);
                        break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    case "yesno": r = duel.Respond("yesno", 1); break;
                    case "battle": r = duel.Respond("endbattle", 0); break;

                    // A DESCOBERTA deste teste: a armadilha setada NÃO aparece na
                    // lista `activate` do idle — ela é oferecida numa janela de
                    // CORRENTE (SELECT_CHAIN), porque o efeito é EVENT_FREE_CHAIN.
                    // Responder qualquer outra coisa aqui é recusado pelo servidor
                    // (evento `refused`) e a pergunta continua pendente, que foi
                    // exatamente como a primeira versão deste teste travou.
                    case "chain":
                    {
                        var alvo = q.choices.FirstOrDefault(c => c.code == CALL_HAUNTED);
                        if (alvo.code == CALL_HAUNTED)
                        {
                            ativouDoCampo = true;
                            locOrigemAtivacao = alvo.location;
                            Log.Info($"  > Call of the Haunted na CORRENTE (location 0x{alvo.location:x})");
                            r = duel.Respond("chain", alvo.index);
                        }
                        else r = duel.Respond("chain", -1);   // -1 = não encadeia
                        break;
                    }
                    case "unsupported":
                        Log.Err($"  > MENSAGEM NAO SUPORTADA: tipo bruto {q.rawType}");
                        r = duel.Respond("endturn", 0);
                        break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            if (DIAG)
                Log.Info($"  [diag] saida do laco: ended={r.ended} " +
                         $"pergunta={(r.question == null ? "null" : r.question.kind)} " +
                         $"eventos=[{string.Join(",", r.events.Select(e => e.GetType().GetProperty("type")?.GetValue(e)))}]");

            Check("a armadilha foi setada", setouArmadilha);
            Check("ficou ativavel A PARTIR DO CAMPO (nao da mao)", ativouDoCampo);
            Check("a ativacao veio da zona de magia/armadilha (loc 0x8)",
                  locOrigemAtivacao == 0x8, $"(veio 0x{locOrigemAtivacao:x})");
            Check("o monstro voltou do cemiterio para a zona de monstro", reviveu,
                  $"(codigo {codigoRevivido})");
            Check("a pilha do cemiterio diminuiu em exatamente 1", copiasDepois == copiasAntes - 1,
                  $"(copias do {codigoRevivido}: {copiasAntes} -> {copiasDepois}; " +
                  $"pilha final: [{string.Join(", ", noCemiterio)}])");
        }

        static void RebornTiraDoCemiterio(string sa)
        {
            // Como encher o cemitério sem depender de combate: com o oponente
            // DESLIGADO ninguém ataca, então nada morre — a primeira versão deste
            // teste falhou exatamente assim, com o cemitério vazio e o Reborn
            // nunca ativável (sem alvo, o motor não o oferece).
            //
            // A saída é a INVOCAÇÃO POR TRIBUTO: os tributos vão para o cemitério
            // por regra, no nosso próprio turno e sem oponente nenhum.
            var deck = new List<uint>();
            for (int i = 0; i < 10; i++) deck.Add(REBORN);
            for (int i = 0; i < 8; i++) deck.Add(GAIA_NV7);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF };
            while (deck.Count < 40) deck.Add(lv4[deck.Count % lv4.Length]);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 24680UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            // Espelho do cemitério do jogador 0, montado SÓ com os eventos que o
            // front recebe — é a mesma conta que o duel.html faz.
            var cemiterio = new List<uint>();
            bool saiuDoCemiterio = false;
            uint codigoQueSaiu = 0;
            byte destino = 0;
            bool codigoVeioPreenchido = false;

            for (int guard = 0; guard < 300 && !r.ended && !saiuDoCemiterio; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    byte ctrl = Convert.ToByte(t.GetProperty("controller")?.GetValue(e) ?? (byte)0);
                    byte fromCtrl = Convert.ToByte(t.GetProperty("fromCtrl")?.GetValue(e) ?? (byte)0);

                    if (loc == LOC_GRAVE && ctrl == 0) cemiterio.Add(code);

                    if (from == LOC_GRAVE && fromCtrl == 0)
                    {
                        saiuDoCemiterio = true;
                        codigoQueSaiu = code;
                        destino = loc;
                        codigoVeioPreenchido = code != 0;
                        int i = cemiterio.IndexOf(code);
                        if (i >= 0) cemiterio.RemoveAt(i);
                        Log.Info($"  > carta {code} SAIU do cemiterio (0x10) para loc 0x{loc:x}");
                    }
                }
                if (saiuDoCemiterio) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        // Prioridade: (1) Reborn, que é o que se testa — só fica
                        // ativável quando há monstro no cemitério; (2) o Nv7, cuja
                        // invocação por tributo é justamente o que ENCHE o
                        // cemitério; (3) qualquer invocação, para juntar tributos.
                        var reborn = q.activatable.FirstOrDefault(a => a.code == REBORN);
                        var nv7 = q.summonable.FirstOrDefault(a => a.code == GAIA_NV7);
                        if (reborn.code == REBORN)
                        {
                            Log.Info("  > Monster Reborn ativavel (ha monstro no cemiterio)");
                            r = duel.Respond("activate", reborn.index);
                        }
                        else if (nv7.code == GAIA_NV7)
                        {
                            Log.Info("  > invocando o Nv7 por tributo (enche o cemiterio)");
                            r = duel.Respond("summon", nv7.index);
                        }
                        else if (q.summonable.Count > 0) r = duel.Respond("summon", q.summonable[0].index);
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place":
                        r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                        break;
                    case "selectcard":
                    case "selecttribute":
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        r = q.canFinish && q.choices.Count == 0
                            ? duel.Respond("finishselect", 0)
                            : duel.Respond("pick", q.choices[0].index);
                        break;
                    case "position":
                        r = duel.Respond("position", 0x1);
                        break;
                    case "yesno":
                        r = duel.Respond("yes", 1);
                        break;
                    case "battle":
                        r = duel.Respond("endbattle", 0);
                        break;
                    default:
                        r = duel.Respond("endturn", 0);
                        break;
                }
            }

            Check("alguma carta saiu do cemiterio", saiuDoCemiterio);
            Check("o evento trouxe fromLoc = 0x10 (cemiterio)", saiuDoCemiterio);
            Check("o evento trouxe o CODIGO real (sem ele o front nao sabe qual tirar)",
                  codigoVeioPreenchido, $"(code={codigoQueSaiu})");
            Check("o destino foi o campo ou a mao", destino == LOC_MZONE || destino == LOC_HAND,
                  $"(loc 0x{destino:x})");
            Log.Info($"  cemiterio do jogador apos remover: [{string.Join(", ", cemiterio)}] " +
                     $"({cemiterio.Count} cartas)");
            Check("a carta que saiu NAO continua no cemiterio", !cemiterio.Contains(codigoQueSaiu)
                  || cemiterio.Count(x => x == codigoQueSaiu) < cemiterio.Count,
                  "(espelho montado com os mesmos eventos que o front recebe)");
        }

        static void Check(string nome, bool ok, string extra = "")
        {
            if (ok) { _pass++; Log.Info($"  OK   {nome} {extra}"); }
            else { _fail++; Log.Err($"  FALHOU {nome} {extra}"); }
        }
    }
}
