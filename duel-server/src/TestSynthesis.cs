using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **O ritual que come do DECK — `--test-synthesis`.**
    ///
    /// O relato: *"tenho todas as condicoes pra usar a Super Soldier Synthesis —
    /// na mao 1 Envoy of Chaos e pelo menos 2 LUZ no deck — e ela nao quer
    /// ativar"*.
    ///
    /// A carta (45948430) e' diferente de todo ritual que este projeto ja' tinha
    /// exercitado: o material NAO sai do campo. O Lua dela pede **exatamente 2**
    /// monstros, **1 LUZ e 1 TREVAS**, **um da MAO e outro do DECK**, com os
    /// niveis somando **8 cravados** — e o monstro ritual vem da mao ou do
    /// cemiterio, nunca do deck. Nada disso passa pelo caminho de tributo que
    /// `--test-summons` cobre.
    ///
    /// **O par CONTROLE e' o teste inteiro.** Sao dois duelos com a MESMA seed e
    /// decks que diferem em UMA carta: com o LUZ Nv4 no deck a ativacao tem de
    /// ser oferecida; sem ele, tem de NAO ser. Sem o segundo, um motor que nunca
    /// oferecesse nada passaria igual — e "nao apareceu" nao provaria bug nenhum,
    /// que e' exatamente onde esta investigacao empacou.
    ///
    /// Ele existe tambem porque, ate' hoje, **um Lua que estoura na condicao de
    /// ativacao sumia sem rastro**: o `logHandler` do ocgcore ficava nulo (ver
    /// `DuelSession`). Com ele ligado, um erro de script aparece como `[lua]` no
    /// log desta suite — e ai' "a carta nao ativa" deixa de ser um misterio.
    /// </summary>
    public static class TestSynthesis
    {
        const uint SYNTHESIS = 45948430;  // Ritual Spell: 1 LUZ + 1 TREVAS, um da mao e um do deck, soma 8
        const uint BLS = 5405694;         // Black Luster Soldier — Ritual Monster Nv8, do arquetipo
        const uint ENVOY_DARK = 38695361; // Envoy of Chaos — TREVAS Nv4 (a metade que ele tem na mao)
        const uint KNIGHT_LIGHT = 6628343;// Beginning Knight — LUZ Nv4 (a metade que mora no deck)
        const uint ELF_LIGHT = 15025844;  // Mystical Elf — LUZ Nv4 vanilla: o mesmo papel, sem efeito nenhum
        const uint OX = 5053103;          // Battle Ox — TERRA Nv4: enchimento que NAO serve de material
        const uint CLASSICO = 55761792;   // Black Luster Ritual — a API ANTIGA, o controle do arnes
        const uint COSMO_NV8 = 38999506;  // Cosmo Queen — TREVAS Nv8 vanilla: paga a soma 8 sozinha

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Super Soldier Synthesis: material da MAO + do DECK ===\n");

            // Os dois decks diferem em UMA carta. O enchimento e' TERRA (Battle
            // Ox), que nao e' LUZ nem TREVAS: ele nunca serve de material, entao
            // a unica coisa que muda entre os dois duelos e' a metade LUZ.
            var comLuz = Deck(luz: KNIGHT_LIGHT);
            var semLuz = Deck(luz: OX);

            var (ofereceu, mao) = PrimeiroIdle(sa, comLuz);
            Check("com o LUZ Nv4 no deck, o motor OFERECE a ativacao", ofereceu,
                  $"(mao: {mao})");

            var (ofereceuSem, maoSem) = PrimeiroIdle(sa, semLuz);
            Check("CONTROLE: sem nenhum LUZ no deck, ele NAO oferece", !ofereceuSem,
                  $"(mao: {maoSem})");

            // A terceira: o LUZ vanilla. Se o Beginning Knight falhar e a Mystical
            // Elf passar, o problema e' do efeito DELE, e nao do ritual — e a
            // diferenca entre esses dois casos e' meia hora de caçada.
            var (ofereceuElf, maoElf) = PrimeiroIdle(sa, Deck(luz: ELF_LIGHT));
            Check("com um LUZ Nv4 VANILLA no deck, tambem oferece", ofereceuElf,
                  $"(mao: {maoElf})");

            // **O CONTROLE DO ARNES.** Sem ele, "nao apareceu" nao separa uma
            // carta quebrada de um teste que nunca conseguiria ver carta nenhuma.
            // A Black Luster Ritual invoca o MESMO monstro e esta' no mesmo deck
            // do jogador — o que muda e' a API do script: ela e' o
            // `Ritual.AddProcGreaterCode` de sempre (material do campo/mao,
            // soma >= 8), enquanto a Synthesis e' o `Ritual.CreateProc` moderno,
            // com material vindo do DECK. Se esta aparece e aquela nao, o
            // problema esta' no caminho novo, e nao no arnes.
            var (ofereceuClassico, maoClassico) = PrimeiroIdle(sa, DeckClassico(), CLASSICO);
            Check("CONTROLE DO ARNES: a Black Luster Ritual (API antiga) aparece", ofereceuClassico,
                  $"(mao: {maoClassico})");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// 40 cartas. A mao de abertura sao 5, e o deck e' feito para que ela
        /// traga o ritual, o monstro e a metade TREVAS: um terco de cada. A
        /// metade LUZ entra em UMA copia so' — ela precisa ficar NO DECK, que e'
        /// de onde a carta a manda para o cemiterio.
        /// </summary>
        static uint[] Deck(uint luz)
        {
            var d = new List<uint>();
            for (int i = 0; i < 13; i++) d.Add(SYNTHESIS);
            for (int i = 0; i < 13; i++) d.Add(BLS);
            for (int i = 0; i < 13; i++) d.Add(ENVOY_DARK);
            d.Add(luz);
            return d.ToArray();
        }

        /// <summary>
        /// Roda o duelo ate' a primeira decisao do JOGADOR e responde: a
        /// Synthesis esta' na lista de ativaveis?
        ///
        /// O turno e' dirigido pelo humano de proposito — pelo NPC, a Main Phase
        /// inteira se resolve dentro de um `Respond` so', e a lista de ativaveis
        /// nunca chega ao lado de fora.
        /// </summary>
        /// <summary>
        /// O deck do CONTROLE: a Black Luster Ritual classica, o mesmo monstro
        /// ritual, e um corpo Nv8 (Cosmo Queen, vanilla TREVAS) que sozinho paga
        /// a soma de 8 direto da mao.
        /// </summary>
        static uint[] DeckClassico()
        {
            var d = new List<uint>();
            for (int i = 0; i < 13; i++) d.Add(CLASSICO);
            for (int i = 0; i < 13; i++) d.Add(BLS);
            for (int i = 0; i < 14; i++) d.Add(COSMO_NV8);
            return d.ToArray();
        }

        static (bool, string) PrimeiroIdle(string sa, uint[] deck, uint procurada = SYNTHESIS)
        {
            var enchimento = new List<uint>();
            for (int i = 0; i < 40; i++) enchimento.Add(OX);

            // **Procura um embaralhamento que monte a situacao do relato**: a
            // Synthesis, o monstro ritual e a metade TREVAS na MAO, com a metade
            // LUZ ficando no deck. Fixar uma seed daria um teste que passa hoje e
            // acusa amanha por sorte do baralho — e foi por nao conferir a mao
            // que a primeira versao disto "provou" um bug que nao existia: o
            // embaralhamento simplesmente nao tinha dado o TREVAS.
            for (ulong seed = 1; seed <= 60; seed++)
            {
                using var duel = new InteractiveDuel(sa, deck, seed, 0x1000000UL,
                                                     npc: true, npcDeck: enchimento.ToArray());
                var r = duel.Advance();

                for (int guard = 0; guard < 60 && !r.ended; guard++)
                {
                    var q = r.question;
                    if (q == null) break;

                    if (q.kind == "idle" && q.player == 0)
                    {
                        var mao = duel.MaoDoJogador();
                        // A metade TREVAS so' e' exigida no caminho da Synthesis;
                        // o controle classico paga com o Nv8 da propria mao.
                        bool montou = mao.Contains(procurada) && mao.Contains(BLS)
                                   && (procurada != SYNTHESIS || mao.Contains(ENVOY_DARK))
                                   && (procurada != CLASSICO || mao.Contains(COSMO_NV8));
                        if (!montou) break;   // outro embaralhamento

                        var codigos = q.activatable.Select(a => a.code).ToList();
                        Log.Info($"  seed {seed} | mao: {string.Join(", ", mao)}");
                        Log.Info($"  ativaveis: {(codigos.Count == 0 ? "(nenhuma)" : string.Join(", ", codigos))}");
                        return (codigos.Contains(procurada), string.Join(",", mao));
                    }

                    r = Padrao(duel, q);
                }
            }
            return (false, "nao consegui montar a mao em 60 embaralhamentos");
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
