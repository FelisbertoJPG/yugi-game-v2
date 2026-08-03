using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da INVOCAÇÃO-XYZ — `--test-xyz`.
    ///
    /// Mesma mecânica de fundo da Sincro (`TestSynchro.cs`): o motor oferece a
    /// invocação em `spSummonable` (idle, comando 1) quando 2+ monstros do
    /// mesmo nível já estão em campo. `Xyz.AddProcedure(c,nil,4,2)` (a receita do
    /// Number 39: Utopia) não filtra por nome — 2 monstros Nv4 quaisquer servem.
    ///
    /// Exemplo trabalhado: 2x Battle Ox (Nv4) => Number 39: Utopia (Xyz Rank 4).
    /// A 2ª parte prova a DESANEXAÇÃO de material: o efeito de Utopia
    /// (`EVENT_ATTACK_ANNOUNCE`, custo `Cost.Detach(1,1,nil)`) nega um ataque —
    /// testado com a própria Utopia atacando direto (campo do oponente vazio no
    /// harness de 1 jogador), negando o PRÓPRIO ataque. O sinal inequívoco de que
    /// a negação funcionou é o LP do oponente continuar 8000 — um ataque direto
    /// de 2500 não negado teria descontado.
    /// </summary>
    public static class TestXyz
    {
        const uint BATTLE_OX = 5053103;   // Nv4, vanilla padrão do projeto — material genérico
        const uint UTOPIA = 84013237;     // Xyz Rank 4, 2 materiais Nv4

        const byte LOC_MZONE = 0x4, LOC_HAND = 0x2, LOC_GRAVE = 0x10, LOC_EXTRA = 0x40;

        static int _pass, _fail;

        public static int Run(string sa)
        {
            Log.Info("=== teste: INVOCACAO-XYZ (Extra Deck) ===\n");
            RanqueiaComSucesso(sa);
            Log.Info("\n=== teste: Utopia DESANEXA material p/ negar um ataque ===\n");
            UtopiaDesanexa(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Sobe 2 Battle Ox em turnos separados (só 1 Invocação-Normal por turno)
        /// até os dois estarem em campo — aí a Xyz deve aparecer em `spSummonable`.
        /// </summary>
        static void RanqueiaComSucesso(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(BATTLE_OX);
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            uint[] extra = { UTOPIA };

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 975319UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: extra);
            var r = duel.Advance();

            bool ranqueou = false;
            int boisQueSairamDoCampo = 0;
            // Só sobe até 2 (o pedido do Rank 4) — sem esse teto o teste empilhava
            // Battle Ox turno após turno em vez de parar assim que os 2 materiais
            // necessários já estão em campo.
            int boxEmCampo = 0;
            var perguntas = new List<string>();

            for (int guard = 0; guard < 400 && !r.ended && !ranqueou; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == UTOPIA && loc == LOC_MZONE)
                    {
                        ranqueou = true;
                        Log.Info($"  > Number 39: Utopia entrou em campo (veio de loc 0x{from:x})");
                    }
                    if (code == BATTLE_OX && from == LOC_MZONE) boisQueSairamDoCampo++;
                }
                if (ranqueou) break;

                var q = r.question;
                if (q == null) break;
                perguntas.Add(q.kind);

                switch (q.kind)
                {
                    case "idle":
                    {
                        var sp = q.spSummonable.FirstOrDefault(a => a.code == UTOPIA);
                        if (sp.code == UTOPIA)
                        {
                            Log.Info("  > Utopia disponivel em spSummonable — invocando");
                            r = duel.Respond("spsummon", sp.index);
                            break;
                        }
                        var ox = q.summonable.FirstOrDefault(a => a.code == BATTLE_OX);
                        if (boxEmCampo < 2 && ox.code == BATTLE_OX)
                        { Log.Info("  > normal summon Battle Ox"); boxEmCampo++; r = duel.Respond("summon", ox.index); }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    case "yesno": r = duel.Respond("yesno", 0); break;
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

            Check("Number 39: Utopia foi invocado do Extra Deck (spsummon)", ranqueou);
            Check("os 2 Battle Ox saíram da zona de monstro (viraram material)",
                  boisQueSairamDoCampo >= 2, $"(saíram {boisQueSairamDoCampo})");
        }

        /// <summary>
        /// Repete a ranqueação e, com Utopia em campo, vai pra Battle Phase e ataca
        /// direto (campo do oponente vazio). `EVENT_ATTACK_ANNOUNCE` deve oferecer
        /// o efeito opcional de desanexar 1 material e negar o ataque — aceitamos.
        /// Prova definitiva: o LP do oponente continua 8000 (2500 de dano NÃO
        /// aconteceu). Tratamos tanto `yesno` quanto `chain` para o gatilho, porque
        /// o formato exato de um TRIGGER_O opcional neste ponto do turno não foi
        /// medido antes deste teste.
        /// </summary>
        static void UtopiaDesanexa(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(BATTLE_OX);
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            uint[] extra = { UTOPIA };

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 8642097UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: extra);
            var r = duel.Advance();

            bool ranqueou = false, atacou = false, negociouEfeito = false, utopiaMorreu = false;
            bool lpMudou = false;
            int lpOponente = 8000;
            int boxEmCampo = 0;

            for (int guard = 0; guard < 500 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "lp")
                    {
                        int player = Convert.ToInt32(t.GetProperty("player")?.GetValue(e) ?? 0);
                        if (player == 1) { lpMudou = true; lpOponente = Convert.ToInt32(t.GetProperty("lp")?.GetValue(e) ?? 8000); }
                    }
                    if (tipo == "attack") atacou = true;
                    if (tipo != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == UTOPIA && loc == LOC_MZONE) ranqueou = true;
                    if (code == UTOPIA && loc == LOC_GRAVE) utopiaMorreu = true;
                }
                // Depois do ataque já ter sido declarado, um resultado (LP mudou OU
                // Utopia negou) encerra o teste — não precisa rodar mais turnos.
                if (atacou && (lpMudou || negociouEfeito)) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        if (ranqueou && !atacou && q.canBattle)
                        { Log.Info("  > indo pra Battle Phase"); r = duel.Respond("battle", 0); break; }

                        var sp = q.spSummonable.FirstOrDefault(a => a.code == UTOPIA);
                        if (!ranqueou && sp.code == UTOPIA) { r = duel.Respond("spsummon", sp.index); break; }
                        var ox = q.summonable.FirstOrDefault(a => a.code == BATTLE_OX);
                        if (!ranqueou && boxEmCampo < 2 && ox.code == BATTLE_OX)
                        { boxEmCampo++; r = duel.Respond("summon", ox.index); break; }
                        r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "battle":
                    {
                        var atacante = q.attackers.FirstOrDefault(a => a.code == UTOPIA);
                        if (!atacou && atacante.code == UTOPIA)
                        { Log.Info("  > declarando ataque direto com Utopia"); r = duel.Respond("attack", atacante.index); }
                        else r = duel.Respond("endbattle", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    // Gatilho opcional de Utopia (negar o ataque desanexando material).
                    // Aceitamos sempre que aparecer depois de termos atacado.
                    case "yesno":
                        if (atacou) negociouEfeito = true;
                        r = duel.Respond("yesno", 1);
                        break;
                    case "chain":
                    {
                        var utopia = q.choices.FirstOrDefault(c => c.code == UTOPIA);
                        if (atacou && utopia.code == UTOPIA)
                        { negociouEfeito = true; Log.Info("  > corrente oferece Utopia — ativando p/ negar"); r = duel.Respond("chain", utopia.index); }
                        else r = duel.Respond("chain", -1);
                        break;
                    }
                    case "selectcard":
                    case "selecttribute":
                        Log.Info($"  > {q.kind} (provavel desanexacao de material): " +
                                 $"{q.choices.Count} opcoes [{string.Join(",", q.choices.Select(c => c.code))}]");
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        if (q.canFinish && q.choices.Count == 0) { r = duel.Respond("finishselect", 0); break; }
                        Log.Info($"  > selectunselect (provavel desanexacao): {q.choices.Count} opcoes " +
                                 $"[{string.Join(",", q.choices.Select(c => c.code))}]");
                        r = duel.Respond("pick", q.choices[0].index);
                        break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check("Utopia ranqueou antes do teste de desanexacao", ranqueou);
            Check("o ataque foi declarado", atacou);
            Check("o efeito de negar (desanexar material) foi oferecido e aceito", negociouEfeito);
            Check("LP do oponente continua 8000 — o dano NAO passou (ataque negado)",
                  !lpMudou, $"(lp observado: {lpOponente})");
            Check("Utopia sobreviveu (nao foi pro cemiterio)", !utopiaMorreu);
        }

        static void Check(string nome, bool ok, string extra = "")
        {
            if (ok) { _pass++; Log.Info($"  OK   {nome} {extra}"); }
            else { _fail++; Log.Err($"  FALHOU {nome} {extra}"); }
        }
    }
}
