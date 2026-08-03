using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da INVOCAÇÃO-SINCRO — `--test-synchro`.
    ///
    /// Diferente da Fusão, a Sincro não passa por uma magia (Polymerization):
    /// o motor oferece a Invocação Especial diretamente na 2ª lista do
    /// `SELECT_IDLECMD` (`spsummon`), que o host descartava sem ler
    /// (`InteractiveDuel.ParseIdle`). Uma vez exposta (`q.spSummonable`) e
    /// respondida (comando 1 do idle), o resto — escolher os materiais, mandar
    /// pro cemitério, encaixar a carta do Extra Deck — é o motor: nenhuma regra
    /// nossa, igual à Fusão.
    ///
    /// Exemplo trabalhado: Rose, Warrior of Revenge (Tuner Nv4) + Battle Ox (Nv4)
    /// => Stardust Dragon (Sincro Nv8). A 2ª parte prova o efeito de negar do
    /// Stardust: ele é um QUICK effect (`EVENT_CHAINING`), então aparece como
    /// janela de corrente (`kind:"chain"`) — já suportada — quando o próprio
    /// jogador ativa Dark Hole (destruição em massa que atinge os DOIS lados do
    /// campo, ao contrário do Raigeki, que só destrói o lado do oponente — por
    /// isso Dark Hole, não Raigeki, é o gatilho aqui: com o oponente sempre vazio
    /// no harness, o Raigeki nunca teria alvo e a condição do Stardust nunca
    /// bateria).
    ///
    /// O Tuner é Rose, Warrior of Revenge, não Debris Dragon (a escolha óbvia,
    /// já que é Dragão como o Stardust) — medido empiricamente: Debris Dragon
    /// registra `EFFECT_CANNOT_BE_SYNCHRO_MATERIAL` no próprio script
    /// (`c14943837.lua`), e com ele em campo o Stardust NUNCA aparecia em
    /// `spSummonable`, mesmo com material de sobra e zona livre. Rose não tem
    /// nenhuma restrição desse tipo e o mesmo tabuleiro funciona na hora.
    /// </summary>
    public static class TestSynchro
    {
        const uint TUNER = 1557341;   // Rose, Warrior of Revenge — Tuner Nv4 sem restricao de material
        const uint BATTLE_OX = 5053103;       // não-Tuner Nv4 (vanilla padrão do projeto)
        const uint STARDUST = 44508094;       // Sincro Nv8 (Tuner+não-Tuner somando 8)
        const uint DARK_HOLE = 53129443;      // destrói TODOS os monstros do campo (dos 2 lados)

        const byte LOC_MZONE = 0x4, LOC_HAND = 0x2, LOC_GRAVE = 0x10, LOC_EXTRA = 0x40;

        static int _pass, _fail;

        public static int Run(string sa)
        {
            Log.Info("=== teste: INVOCACAO-SINCRO (Extra Deck) ===\n");
            SincronizaComSucesso(sa);
            Log.Info("\n=== teste: Stardust Dragon NEGA uma destruicao em massa ===\n");
            StardustNega(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Sobe o Tuner e o Battle Ox em turnos separados (só 1 Invocação-Normal
        /// por turno) até os dois estarem em campo juntos — aí a Sincro deve aparecer
        /// em `spSummonable`. Deck saturado dos dois nomes: o objetivo é testar a
        /// MECÂNICA, não a consistência de um deck de verdade (mesmo padrão de
        /// `TestFusion.FusaoPorPoly`).
        /// </summary>
        static void SincronizaComSucesso(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 13; i++) deck.Add(TUNER);
            for (int i = 0; i < 13; i++) deck.Add(BATTLE_OX);
            while (deck.Count < 40) deck.Add(DARK_HOLE);

            uint[] extra = { STARDUST };

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 13579UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: extra);
            var r = duel.Advance();

            bool sincronizou = false;
            // Conta o que já está em campo — sem isso o teste empilhava cópia atrás
            // de cópia do Tuner, turno após turno, em vez de parar assim que os
            // dois materiais necessários já estão em campo.
            int tunerEmCampo = 0, boxEmCampo = 0;
            var materiaisNoCemiterio = new List<uint>();
            var perguntas = new List<string>();

            for (int guard = 0; guard < 400 && !r.ended && !sincronizou; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == STARDUST && loc == LOC_MZONE)
                    {
                        sincronizou = true;
                        Log.Info($"  > Stardust Dragon entrou em campo (veio de loc 0x{from:x})");
                    }
                    if (loc == LOC_GRAVE && (code == TUNER || code == BATTLE_OX) && from == LOC_MZONE)
                        materiaisNoCemiterio.Add(code);
                }
                if (sincronizou) break;

                var q = r.question;
                if (q == null) break;
                perguntas.Add(q.kind);

                switch (q.kind)
                {
                    case "idle":
                    {
                        var sp = q.spSummonable.FirstOrDefault(a => a.code == STARDUST);
                        if (sp.code == STARDUST)
                        {
                            Log.Info("  > Stardust Dragon disponivel em spSummonable — invocando");
                            r = duel.Respond("spsummon", sp.index);
                            break;
                        }
                        // Ainda falta 1 dos dois materiais: normal-summona só o que
                        // falta, um por turno, e para assim que os dois estiverem lá.
                        var tuner = q.summonable.FirstOrDefault(a => a.code == TUNER);
                        var box = q.summonable.FirstOrDefault(a => a.code == BATTLE_OX);
                        if (tunerEmCampo == 0 && tuner.code == TUNER)
                        {
                            Log.Info("  > normal summon Tuner");
                            tunerEmCampo++;
                            r = duel.Respond("summon", tuner.index);
                        }
                        else if (boxEmCampo == 0 && box.code == BATTLE_OX)
                        {
                            Log.Info("  > normal summon Battle Ox");
                            boxEmCampo++;
                            r = duel.Respond("summon", box.index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    case "yesno": r = duel.Respond("yesno", 0); break;   // recusa qualquer efeito opcional
                    case "selectcard":
                    case "selecttribute":
                        Log.Info($"  > {q.kind}: {q.choices.Count} opcoes " +
                                 $"[{string.Join(",", q.choices.Select(c => c.code))}], escolher {q.selMin}-{q.selMax}");
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        if (q.canFinish && q.choices.Count == 0) { r = duel.Respond("finishselect", 0); break; }
                        Log.Info($"  > selectunselect: {q.choices.Count} opcoes " +
                                 $"[{string.Join(",", q.choices.Select(c => c.code))}] canFinish={q.canFinish}");
                        r = duel.Respond("pick", q.choices[0].index);
                        break;
                    case "chain": r = duel.Respond("chain", -1); break;
                    case "battle": r = duel.Respond("endbattle", 0); break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Log.Info($"  perguntas vistas: {string.Join(" -> ", perguntas.Distinct())}");

            Check("Stardust Dragon foi invocado do Extra Deck (spsummon)", sincronizou);
            Check("os dois materiais (Tuner + nao-Tuner) foram para o cemiterio",
                  materiaisNoCemiterio.Count >= 2,
                  $"(foram {materiaisNoCemiterio.Count}: [{string.Join(", ", materiaisNoCemiterio)}])");
        }

        /// <summary>
        /// Repete a sincronização e, com Stardust em campo, ativa Dark Hole (o
        /// próprio jogador — harness de 1 jogador só). O efeito de negar do
        /// Stardust é QUICK (`EVENT_CHAINING`): deve abrir uma janela `chain`
        /// oferecendo o índice dele. Ativar paga o custo (`Duel.Release` — vai pro
        /// cemitério) e nega o Dark Hole. Na End Phase, o gatilho de reanimação
        /// (`EFFECT_TYPE_TRIGGER_O` a partir do cemitério) deve perguntar
        /// `yesno`; respondemos que sim e conferimos que ele volta pro campo.
        /// </summary>
        static void StardustNega(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 12; i++) deck.Add(TUNER);
            for (int i = 0; i < 12; i++) deck.Add(BATTLE_OX);
            for (int i = 0; i < 8; i++) deck.Add(DARK_HOLE);
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            uint[] extra = { STARDUST };

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 24681357UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: extra);
            var r = duel.Advance();

            bool sincronizou = false, negou = false, pagouCusto = false, reanimou = false;
            bool stardustEmCampo = false;
            int tunerEmCampo = 0, boxEmCampo = 0;

            for (int guard = 0; guard < 500 && !r.ended && !reanimou; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == STARDUST && loc == LOC_MZONE)
                    {
                        sincronizou = true; stardustEmCampo = true;
                        Log.Info($"  > Stardust em campo (de loc 0x{from:x})");
                    }
                    if (code == STARDUST && loc == LOC_GRAVE && from == LOC_MZONE)
                    {
                        pagouCusto = true; stardustEmCampo = false;
                        Log.Info("  > Stardust pagou o custo (Release) — foi pro cemiterio");
                    }
                    if (code == STARDUST && loc == LOC_MZONE && from == LOC_GRAVE)
                    {
                        reanimou = true; stardustEmCampo = true;
                        Log.Info("  > Stardust reanimou na End Phase");
                    }
                }
                if (reanimou) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var sp = q.spSummonable.FirstOrDefault(a => a.code == STARDUST);
                        if (!sincronizou && sp.code == STARDUST) { r = duel.Respond("spsummon", sp.index); break; }

                        if (sincronizou && stardustEmCampo)
                        {
                            var dh = q.activatable.FirstOrDefault(a => a.code == DARK_HOLE);
                            if (dh.code == DARK_HOLE)
                            {
                                Log.Info("  > ativando Dark Hole (o proprio jogador, p/ dar gatilho ao Stardust)");
                                r = duel.Respond("activate", dh.index);
                                break;
                            }
                        }
                        if (!sincronizou)
                        {
                            var tuner = q.summonable.FirstOrDefault(a => a.code == TUNER);
                            var box = q.summonable.FirstOrDefault(a => a.code == BATTLE_OX);
                            if (tunerEmCampo == 0 && tuner.code == TUNER)
                            { tunerEmCampo++; r = duel.Respond("summon", tuner.index); break; }
                            if (boxEmCampo == 0 && box.code == BATTLE_OX)
                            { boxEmCampo++; r = duel.Respond("summon", box.index); break; }
                        }
                        r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    case "chain":
                    {
                        var stardust = q.choices.FirstOrDefault(c => c.code == STARDUST);
                        if (stardust.code == STARDUST)
                        {
                            Log.Info("  > janela de corrente oferece Stardust — ativando p/ negar");
                            negou = true;
                            r = duel.Respond("chain", stardust.index);
                        }
                        else r = duel.Respond("chain", -1);
                        break;
                    }
                    // O gatilho de reanimacao (End Phase) e opcional: sempre aceita.
                    // Qualquer outro yesno (nenhum esperado aqui) tambem aceitamos,
                    // pra nao travar o duelo por recusa de algo inofensivo.
                    case "yesno": r = duel.Respond("yesno", 1); break;
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
                    case "battle": r = duel.Respond("endbattle", 0); break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check("Stardust sincronizou antes do teste de negacao", sincronizou);
            Check("a janela de corrente ofereceu o efeito de negar do Stardust", negou);
            Check("Stardust pagou o custo (Release -> cemiterio) ao negar", pagouCusto);
            Check("Stardust reanimou sozinho na End Phase (gatilho do cemiterio)", reanimou);
        }

        static void Check(string nome, bool ok, string extra = "")
        {
            if (ok) { _pass++; Log.Info($"  OK   {nome} {extra}"); }
            else { _fail++; Log.Err($"  FALHOU {nome} {extra}"); }
        }
    }
}
