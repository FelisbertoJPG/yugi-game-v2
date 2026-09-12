using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **A magia de CAMPO quando o outro lado já tem uma — `--test-campo`.**
    ///
    /// O relato: *"tentei ativar o Gateway to Chaos enquanto o oponente tinha um
    /// Mausoléu do Imperador no campo, e só foi permitido SETAR meu campo, não
    /// ativar."*
    ///
    /// A leitura óbvia — *"a zona de campo é uma só, e ele ocupou"* — é falsa
    /// neste motor: o `/start` não liga `DUEL_1_FACEUP_FIELD` (0x400), então
    /// cada lado tem a sua. Mas "óbvio e falso" foi exatamente o que fez as três
    /// primeiras caçadas desta semana começarem no lugar errado, e por isso isto
    /// aqui não deduz nada: injeta a magia de campo DELE e pergunta ao motor.
    ///
    /// O suspeito de verdade é a condição da própria carta: o Gateway to Chaos
    /// só ativa com um monstro **RITUAL do arquétipo "Black Luster Soldier"** ou
    /// um **"Gaia the Fierce Knight"** ainda **no DECK**, que possa ir para a mão
    /// (`c40089744.lua`, `s.target` → `Duel.IsExistingMatchingCard(..., LOCATION_DECK, ...)`).
    /// Num deck de 3 BLS, ter comprado os três apaga a ativação sem avisar
    /// ninguém.
    ///
    /// Os três casos separam as duas explicações de vez.
    /// </summary>
    public static class TestCampo
    {
        const uint GATEWAY = 40089744;   // Gateway to Chaos — Magia de Campo com condição
        const uint MAUSOLEU = 80921533;  // Mausoleum of the Emperor — a magia de campo DELE
        const uint BLS = 5405694;        // Black Luster Soldier — Ritual Nv8, o que a condição procura
        const uint OX = 5053103;         // Battle Ox — enchimento que a condição NÃO aceita

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Gateway to Chaos: quando ele ATIVA e quando so' seta ===\n");

            // (1) A condição cumprida: há BLS no deck. Tem de aparecer.
            var comAlvo = PrimeiroIdle(sa, DeckComBls(), campoDele: null);
            Check("com um BLS Ritual ainda no DECK, o Gateway APARECE como ativavel",
                  comAlvo.ativavel, $"(ativaveis: {comAlvo.lista})");

            // (2) CONTROLE da condição: nenhum BLS/Gaia no deck. NÃO pode aparecer
            //     — e é isto que explica o relato sem bug nenhum no motor.
            var semAlvo = PrimeiroIdle(sa, DeckSemBls(), campoDele: null);
            Check("CONTROLE: sem nenhum BLS no deck, ele NAO aparece (condicao da carta)",
                  !semAlvo.ativavel, $"(ativaveis: {semAlvo.lista})");

            // (3) **A pergunta do relato.** A MESMA mão do caso (1), agora com o
            //     Mausoléu do Imperador ATIVO no campo DELE. Se aparecer, a magia
            //     de campo do oponente não atrapalha e o caso está encerrado; se
            //     sumir, o bug é do motor e vira tarefa própria.
            var comCampoDele = PrimeiroIdle(sa, DeckComBls(), campoDele: MAUSOLEU);
            Check("com a magia de campo DELE ativa, o Gateway continua ativavel",
                  comCampoDele.ativavel, $"(ativaveis: {comCampoDele.lista})");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>Deck em que a condição do Gateway TEM alvo: BLS de sobra.</summary>
        static uint[] DeckComBls()
        {
            var d = new List<uint>();
            for (int i = 0; i < 13; i++) d.Add(GATEWAY);
            for (int i = 0; i < 27; i++) d.Add(BLS);
            return d.ToArray();
        }

        /// <summary>O mesmo deck sem NENHUM alvo para a condição.</summary>
        static uint[] DeckSemBls()
        {
            var d = new List<uint>();
            for (int i = 0; i < 13; i++) d.Add(GATEWAY);
            for (int i = 0; i < 27; i++) d.Add(OX);
            return d.ToArray();
        }

        static (bool ativavel, string lista) PrimeiroIdle(string sa, uint[] deck, uint? campoDele)
        {
            var enchimento = new List<uint>();
            for (int i = 0; i < 40; i++) enchimento.Add(OX);

            for (ulong seed = 1; seed <= 40; seed++)
            {
                // `fieldSpellController: 1` põe a magia de campo do lado DELE — é
                // o mesmo caminho do tabuleiro temático (o campo de Floresta do
                // Weevil), e o que faz a mesa deste teste ser a do relato.
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL,
                                                     npc: true, npcDeck: enchimento.ToArray(),
                                                     fieldSpell: campoDele,
                                                     fieldSpellController: 1);
                var r = duel.Advance();

                for (int guard = 0; guard < 60 && !r.ended; guard++)
                {
                    var q = r.question;
                    if (q == null) break;

                    if (q.kind == "idle" && q.player == 0)
                    {
                        var mao = duel.MaoDoJogador();
                        if (!mao.Contains(GATEWAY)) break;   // outro embaralhamento

                        var codigos = q.activatable.Select(a => a.code).ToList();
                        var setaveis = q.settableST.Select(a => a.code).ToList();
                        Log.Info($"  seed {seed} | mao: {string.Join(", ", mao)}");
                        Log.Info($"  ativaveis: {(codigos.Count == 0 ? "(nenhuma)" : string.Join(", ", codigos))}" +
                                 $" | setaveis: {string.Join(", ", setaveis)}");
                        return (codigos.Contains(GATEWAY), string.Join(",", codigos));
                    }

                    r = Padrao(duel, q);
                }
            }
            return (false, "nao consegui pôr o Gateway na mao em 40 embaralhamentos");
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
