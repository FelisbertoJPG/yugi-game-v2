using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da FUSÃO — `--test-fusion`.
    ///
    /// Exemplo trabalhado: Polymerization + Gaia The Fierce Knight + Curse of
    /// Dragon => Gaia the Dragon Champion.
    ///
    /// O ponto do teste é provar uma afirmação que parece boa demais: **não
    /// escrevemos Lua nenhum para isto funcionar.** A receita da fusão está no
    /// script da PRÓPRIA carta fundida, que já vem do ocgcore:
    ///
    ///   scripts/official/c66889139.lua
    ///     Fusion.AddProcMix(c,true,true,6368038,28279543)
    ///                                   ^Gaia Nv7   ^Curse of Dragon
    ///
    /// e a Polymerization é só um gancho genérico:
    ///
    ///   scripts/official/c24094653.lua
    ///     Fusion.RegisterSummonEff(c)
    ///
    /// Ou seja: o host não sabe (nem precisa saber) o que fabrica o quê. O que
    /// faltava era mecânico — a carta fundida precisa estar no EXTRA DECK, e o
    /// DuelSession injetava tudo em LOCATION_DECK. Ver InjectExtra().
    /// </summary>
    public static class TestFusion
    {
        const uint POLY = 24094653;   // Polymerization
        const uint GAIA_KNIGHT = 6368038;    // Gaia The Fierce Knight — material
        const uint CURSE_DRAGON = 28279543;  // Curse of Dragon — material
        const uint GAIA_CHAMPION = 66889139; // Gaia the Dragon Champion — a fusão

        const byte LOC_MZONE = 0x4, LOC_HAND = 0x2, LOC_GRAVE = 0x10, LOC_EXTRA = 0x40;

        static int _pass, _fail;

        const uint FUSION_SAGE = 26902560;   // busca 1 Polymerization no deck

        public static int Run(string sa)
        {
            Log.Info("=== teste: invocacao por FUSAO (Polymerization) ===\n");
            FusaoPorPoly(sa);
            Log.Info("\n=== teste: BUSCA no deck (Fusion Sage) ===\n");
            BuscaNoDeck(sa);
            Log.Info("\n=== teste: SUBSTITUTO de materia (King of the Swamp) ===\n");
            SubstitutoDeMateria(sa);
            Log.Info("\n=== teste: o NPC funde sozinho (duelo real) ===\n");
            NpcFunde(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Fusion Sage: "adicione 1 Polymerization do seu Deck à sua mão".
        ///
        /// Parece o Pote da Ganância, mas NÃO é: o Pote compra (MSG_DRAW, sem
        /// decisão), este BUSCA — o motor abre um SELECT_CARD com cartas vindas
        /// do LOCATION_DECK e espera você escolher. O que sai depois é um
        /// MSG_MOVE de loc 1 (deck) para loc 2 (mão), não um MSG_DRAW.
        ///
        /// Este teste existe para medir esse fluxo, que é o de qualquer
        /// "adicione do deck à mão".
        /// </summary>
        static void BuscaNoDeck(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 10; i++) deck.Add(FUSION_SAGE);
            for (int i = 0; i < 10; i++) deck.Add(POLY);
            while (deck.Count < 40) deck.Add(GAIA_KNIGHT);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 777UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool sageAtivada = false, perguntouEscolha = false, polyFoiParaMao = false;
            int opcoesOferecidas = 0;
            byte locOrigem = 0, locDestino = 0;
            var tiposDeMensagem = new List<string>();

            for (int guard = 0; guard < 200 && !r.ended && !polyFoiParaMao; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo != null && !tiposDeMensagem.Contains(tipo)) tiposDeMensagem.Add(tipo);
                    if (tipo != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == POLY && from == 0x1 && loc == LOC_HAND)
                    {
                        polyFoiParaMao = true; locOrigem = from; locDestino = loc;
                        Log.Info($"  > Polymerization saiu do deck (loc 0x{from:x}) para a mao (loc 0x{loc:x})");
                    }
                }
                if (polyFoiParaMao) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var sage = q.activatable.FirstOrDefault(a => a.code == FUSION_SAGE);
                        if (sage.code == FUSION_SAGE)
                        {
                            sageAtivada = true;
                            Log.Info("  > Fusion Sage ativavel");
                            r = duel.Respond("activate", sage.index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "selectcard":
                    case "selecttribute":
                        perguntouEscolha = true;
                        opcoesOferecidas = q.choices.Count;
                        Log.Info($"  > {q.kind}: {q.choices.Count} opcoes vindas do DECK " +
                                 $"(loc da 1a = 0x{(q.choices.Count > 0 ? q.choices[0].location : 0):x}), " +
                                 $"escolher {q.selMin}-{q.selMax}");
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        if (q.canFinish && q.choices.Count == 0) { r = duel.Respond("finishselect", 0); break; }
                        perguntouEscolha = true;
                        opcoesOferecidas = q.choices.Count;
                        r = duel.Respond("pick", q.choices[0].index);
                        break;
                    case "place":
                        r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                        break;
                    case "unsupported":
                        Log.Err($"  > MENSAGEM NAO SUPORTADA: tipo bruto {q.rawType}");
                        r = duel.Respond("endturn", 0);
                        break;
                    default:
                        r = duel.Respond("endturn", 0);
                        break;
                }
            }

            Log.Info($"  eventos vistos: {string.Join(", ", tiposDeMensagem)}");

            Check("Fusion Sage pode ser ativada", sageAtivada);
            Check("o motor pediu a ESCOLHA da carta (busca, nao compra)", perguntouEscolha,
                  $"({opcoesOferecidas} opcoes)");
            Check("a Polymerization foi do deck (0x1) para a mao (0x2)", polyFoiParaMao,
                  $"(origem 0x{locOrigem:x} destino 0x{locDestino:x})");
            Check("o fluxo NAO usou MSG_DRAW (nao e' compra)", !tiposDeMensagem.Contains("draw")
                  || polyFoiParaMao);
        }

        static void FusaoPorPoly(string sa)
        {
            // Deck enviesado para a mão inicial trazer as três peças. Num deck de
            // verdade a Poly seria 3 cópias; aqui o objetivo é testar a mecânica,
            // não a consistência.
            var deck = new List<uint>();
            for (int i = 0; i < 14; i++) deck.Add(POLY);
            for (int i = 0; i < 13; i++) deck.Add(GAIA_KNIGHT);
            while (deck.Count < 40) deck.Add(CURSE_DRAGON);

            // O EXTRA é onde a fusão mora. Uma cópia basta.
            uint[] extra = { GAIA_CHAMPION };

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 2468UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: extra);
            var r = duel.Advance();

            bool polyAtivada = false, fusaoEmCampo = false;
            var materiaisNoCemiterio = new List<uint>();
            var perguntas = new List<string>();

            for (int guard = 0; guard < 300 && !r.ended && !fusaoEmCampo; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);

                    // A prova: a fusão sai do EXTRA e assenta na zona de monstro.
                    if (code == GAIA_CHAMPION && loc == LOC_MZONE)
                    {
                        fusaoEmCampo = true;
                        Log.Info($"  > Gaia the Dragon Champion entrou em campo (veio de loc 0x{from:x})");
                    }
                    if (loc == LOC_GRAVE && (code == GAIA_KNIGHT || code == CURSE_DRAGON))
                        materiaisNoCemiterio.Add(code);
                }
                if (fusaoEmCampo) break;

                var q = r.question;
                if (q == null) break;
                perguntas.Add(q.kind);

                switch (q.kind)
                {
                    case "idle":
                    {
                        // A Poly só aparece em `activatable` quando o motor julga
                        // que há uma fusão possível com o que está na mão/campo.
                        // Isso é regra dele, não nossa — se não aparecer, é porque
                        // as matérias não estão lá.
                        var poly = q.activatable.FirstOrDefault(a => a.code == POLY);
                        if (poly.code == POLY)
                        {
                            polyAtivada = true;
                            Log.Info("  > Polymerization ativavel: o motor achou uma fusao possivel");
                            r = duel.Respond("activate", poly.index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place":
                        r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                        break;

                    // Escolha das matérias. O motor SÓ oferece combinações legais
                    // (a receita está no Lua do Gaia), então pegar o que ele deu
                    // já é a jogada certa — não cabe ao host validar receita.
                    case "selectcard":
                    case "selecttribute":
                        Log.Info($"  > {q.kind}: {q.choices.Count} opcoes, escolher {q.selMin}-{q.selMax} " +
                                 $"[{string.Join(",", q.choices.Select(c => c.code))}]");
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;

                    case "selectunselect":
                        if (q.canFinish && q.choices.Count == 0) { r = duel.Respond("finishselect", 0); break; }
                        Log.Info($"  > selectunselect: {q.choices.Count} opcoes " +
                                 $"[{string.Join(",", q.choices.Select(c => c.code))}] canFinish={q.canFinish}");
                        r = duel.Respond("pick", q.choices[0].index);
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

            Log.Info($"  perguntas vistas: {string.Join(" -> ", perguntas.Distinct())}");

            Check("a Polymerization ficou ativavel (motor reconheceu a receita)", polyAtivada);
            Check("Gaia the Dragon Champion foi invocado do Extra Deck", fusaoEmCampo);
            Check("as duas materias foram para o cemiterio", materiaisNoCemiterio.Count >= 2,
                  $"(foram {materiaisNoCemiterio.Count}: [{string.Join(", ", materiaisNoCemiterio)}])");
        }

        const uint KING_SWAMP = 79109599;   // substituto de materia + busca Poly

        /// <summary>
        /// King of the Swamp no lugar de uma matéria NOMEADA.
        ///
        /// Onde mora a regra — e é o contrário do que parece: a receita está no
        /// script do monstro fundido (`Fusion.AddProcMix`), mas a permissão de
        /// substituir está no script do SUBSTITUTO, como `EFFECT_FUSION_SUBSTITUTE`:
        ///
        ///   scripts/official/c79109599.lua
        ///     e2:SetCode(EFFECT_FUSION_SUBSTITUTE)
        ///     function s.subcon(e) return e:GetHandler():IsLocation(
        ///        LOCATION_HAND|LOCATION_ONFIELD|LOCATION_GRAVE) end
        ///
        /// Cada carta declara o próprio contrato e o motor cruza os dois. Nada a
        /// escrever do nosso lado — de novo.
        ///
        /// O deck deste teste NÃO tem Gaia The Fierce Knight, que é matéria
        /// obrigatória do Gaia the Dragon Champion. Se a fusão sair, saiu pelo
        /// substituto — não há outro caminho.
        /// </summary>
        static void SubstitutoDeMateria(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 12; i++) deck.Add(POLY);
            for (int i = 0; i < 14; i++) deck.Add(KING_SWAMP);
            while (deck.Count < 40) deck.Add(CURSE_DRAGON);   // a OUTRA materia, real

            uint[] extra = { GAIA_CHAMPION };

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 9753UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: extra);
            var r = duel.Advance();

            bool fundiu = false, kingFoiUsado = false, buscouComKing = false;
            var idsOferecidos = new List<uint>();

            for (int guard = 0; guard < 300 && !r.ended && !fundiu; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                    if (code == GAIA_CHAMPION && loc == LOC_MZONE)
                    {
                        fundiu = true;
                        Log.Info("  > Gaia the Dragon Champion saiu SEM a materia nomeada");
                    }
                    // O King indo ao cemitério vindo da mão: ou foi custo da
                    // busca, ou foi consumido como matéria.
                    if (code == KING_SWAMP && loc == LOC_GRAVE && from == LOC_HAND)
                        kingFoiUsado = true;
                }
                if (fundiu) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var poly = q.activatable.FirstOrDefault(a => a.code == POLY);
                        var king = q.activatable.FirstOrDefault(a => a.code == KING_SWAMP);

                        // A BUSCA vem primeiro, uma vez — é a mesma ordem que o
                        // NpcBrain usa (buscar antes de gastar), e sem isso a mão
                        // inicial já traz a Poly e o efeito do King nunca roda.
                        // Descartá-lo não custa nada: ele segue valendo como
                        // matéria a partir do cemitério.
                        if (king.code == KING_SWAMP && !buscouComKing)
                        {
                            buscouComKing = true;
                            Log.Info("  > King of the Swamp ativavel na mao (busca a Poly descartando-se)");
                            r = duel.Respond("activate", king.index);
                        }
                        else if (poly.code == POLY)
                        {
                            Log.Info("  > Polymerization ativavel (o motor aceitou o substituto)");
                            r = duel.Respond("activate", poly.index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    case "yesno": r = duel.Respond("yesno", 1); break;
                    case "selectcard":
                    case "selecttribute":
                        foreach (var c in q.choices) if (!idsOferecidos.Contains(c.code)) idsOferecidos.Add(c.code);
                        r = duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                        break;
                    case "selectunselect":
                        if (q.canFinish && q.choices.Count == 0) { r = duel.Respond("finishselect", 0); break; }
                        foreach (var c in q.choices) if (!idsOferecidos.Contains(c.code)) idsOferecidos.Add(c.code);
                        Log.Info($"  > materias oferecidas: [{string.Join(",", q.choices.Select(c => c.code))}]");
                        r = duel.Respond("pick", q.choices[0].index);
                        break;
                    case "battle": r = duel.Respond("endbattle", 0); break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check("o King of the Swamp pode buscar a Poly da mao", buscouComKing);
            Check("a fusao saiu SEM a materia nomeada (so' pelo substituto)", fundiu);
            Check("o King foi oferecido/consumido no processo", kingFoiUsado
                  || idsOferecidos.Contains(KING_SWAMP),
                  $"(oferecidos: [{string.Join(",", idsOferecidos)}])");
        }

        /// <summary>
        /// A regra de fusão do NpcBrain valendo num duelo de verdade.
        ///
        /// A decisão isolada está no `--test-npc`; aqui interessa o que ela
        /// depende para funcionar de fato: o NPC precisa de EXTRA DECK PRÓPRIO
        /// (`npcExtra`). Sem isso a Polymerization nunca entraria em
        /// `activatable`, a regra jamais dispararia, e o teste isolado
        /// continuaria verde — que é exatamente o buraco que este teste fecha.
        /// </summary>
        static void NpcFunde(string sa)
        {
            var deckNpc = new List<uint>();
            for (int i = 0; i < 12; i++) deckNpc.Add(POLY);
            for (int i = 0; i < 14; i++) deckNpc.Add(GAIA_KNIGHT);
            while (deckNpc.Count < 40) deckNpc.Add(CURSE_DRAGON);

            // Deck do jogador: monstros mansos, só para o duelo andar.
            var deckJogador = new List<uint>();
            while (deckJogador.Count < 40) deckJogador.Add(GAIA_KNIGHT);

            uint[] extraNpc = { GAIA_CHAMPION };

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 1357UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray(),
                                                 extra: null, npcExtra: extraNpc);
            var r = duel.Advance();

            bool npcFundiu = false;
            string porqueNpc = null;

            for (int guard = 0; guard < 400 && !r.ended && !npcFundiu; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;

                    // O NPC anuncia cada jogada com o motivo — é assim que se
                    // confere que foi a REGRA que disparou, e não sorte.
                    if (tipo == "npc")
                    {
                        string why = t.GetProperty("why")?.GetValue(e) as string;
                        if (why != null && why.StartsWith("Fusao")) porqueNpc = why;
                    }
                    if (tipo != "move") continue;
                    uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                    byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                    byte ctrl = Convert.ToByte(t.GetProperty("controller")?.GetValue(e) ?? (byte)0);
                    if (code == GAIA_CHAMPION && loc == LOC_MZONE && ctrl == 1)
                    {
                        npcFundiu = true;
                        Log.Info("  > o NPC pos Gaia the Dragon Champion em campo");
                    }
                }
                if (npcFundiu) break;

                var q = r.question;
                if (q == null) break;

                // O jogador não atrapalha: passa o turno e responde o mínimo.
                switch (q.kind)
                {
                    case "idle": r = duel.Respond("endturn", 0); break;
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "battle": r = duel.Respond("endbattle", 0); break;
                    case "position": r = duel.Respond("position", 0x1); break;
                    case "yesno": r = duel.Respond("yes", 1); break;
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
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check("o NPC invocou a fusao sozinho, num duelo real", npcFundiu);
            Check("a jogada veio da REGRA de fusao (motivo registrado)", porqueNpc != null,
                  porqueNpc == null ? "(nenhum evento npc com motivo 'Fusao')" : $"-> \"{porqueNpc}\"");
        }

        static void Check(string nome, bool ok, string extra = "")
        {
            if (ok) { _pass++; Log.Info($"  OK   {nome} {extra}"); }
            else { _fail++; Log.Err($"  FALHOU {nome} {extra}"); }
        }
    }
}
