using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Armory Call no NPC — `--test-armory`.
    ///
    /// A armadilha busca 1 equipamento do DECK e já equipa. O motor oferece
    /// TODOS os equipamentos do deck (o `thfilter` do Lua só pede TYPE_EQUIP),
    /// inclusive os que não podem equipar em nada que o NPC controla — e pelo
    /// critério genérico do `DecideSelect` (maior ATK) todo equipamento empata
    /// em 0, então ele levaria o primeiro da lista. "Saber usar" é justamente
    /// escolher entre eles.
    ///
    /// O duelo real no fim não é redundante: se `_proximoEquipDoDeck` deixar de
    /// ser consumido na seleção certa, NENHUMA regra isolada acusa — o sintoma
    /// seria só "o NPC às vezes busca uma carta inútil".
    /// </summary>
    public static class TestArmory
    {
        const uint ARMORY_CALL = 38960450;   // Armadilha Normal

        // Monstros vanilla, para o alvo ser previsível.
        const uint BATTLE_OX = 5053103;      // Besta-Guerreira / TERRA — 1700
        const uint MYSTICAL_ELF = 15025844;  // Mago / LUZ          —  800/2000
        const uint FLAME_MANIPULATOR = 34460851; // Mago / FOGO     —  900

        // Equipamentos: um por caso de decisão.
        const uint MYSTICAL_MOON = 36607978; // +300 Besta-Guerreira
        const uint BOOK_SECRET = 91595718;   // +300 Mago
        const uint DRAGON_TREASURE = 1435851;// +300 Dragao (nao serve a ninguem aqui)
        const uint INVIGORATION = 98374133;  // +400 TERRA
        const uint ELFS_LIGHT = 39897277;    // +400 LUZ
        const uint SALAMANDRA = 32268901;    // +700 FOGO
        const uint SWORD_DEEP = 98495314;    // +500 qualquer
        const uint RING_MAGNETISM = 20436034;// −500: nunca serve de reforco

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Armory Call: decisao isolada ===\n");
            Isolado(sa);
            Log.Info("\n=== Armory Call: duelo real (o NPC sozinho) ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- isolado
        static void Isolado(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();

            var brain = new NpcBrain(db, p => p == 1 ? meuCampo : new List<uint>(), _ => { });

            InteractiveDuel.Question Idle()
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = ARMORY_CALL, index = 0 });
                return q;
            }

            InteractiveDuel.Question Busca(params uint[] doDeck)
            {
                var q = new InteractiveDuel.Question { kind = "select", player = 1, selMin = 1, selMax = 1 };
                int i = 0;
                foreach (var c in doDeck)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = c, index = i++, location = 0x1 /* DECK */, controller = 1 });
                return q;
            }

            // 1. Sem alvo em campo, a busca seca desperdicaria a carta (1x/turno).
            meuCampo.Clear();
            var p = brain.Decide(Idle(), 1);
            Check("sem monstro em campo, NAO ativa (a carta e' 1x por turno)",
                  p.Action != "activate", $"(veio {p.Action} {p.Why})");

            // 2. Com alvo, ativa.
            meuCampo.Add(BATTLE_OX);
            p = brain.Decide(Idle(), 1);
            Check("com monstro com a face para cima, ativa",
                  p.Action == "activate", $"(veio {p.Action})");

            // 3. Escolhe o equipamento que CASA com a raca do meu monstro.
            //    Dragon Treasure vem primeiro na lista de proposito: e' o que o
            //    criterio generico levaria.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);      // Besta-Guerreira / TERRA
            brain.Decide(Idle(), 1);
            var esc = brain.DecideSelect(Busca(DRAGON_TREASURE, BOOK_SECRET, MYSTICAL_MOON), 1);
            Check("ignora o equipamento sem alvo e pega o da raca certa",
                  esc.Count == 1 && esc[0] == 2, $"(escolheu indice {string.Join(",", esc)})");

            // 4. Entre +300 (tipo) e +400 (atributo) que servem ao MESMO monstro,
            //    leva o de maior ATK — o NPC ataca.
            brain.Decide(Idle(), 1);
            esc = brain.DecideSelect(Busca(MYSTICAL_MOON, INVIGORATION), 1);
            Check("+400 do atributo ganha do +300 do tipo",
                  esc.Count == 1 && esc[0] == 1, $"(escolheu {string.Join(",", esc)})");

            // 5. Salamandra (+700) so' serve em FOGO: com um Mago LUZ em campo ela
            //    NAO pode ser escolhida, por mais alto que seja o bonus.
            meuCampo.Clear(); meuCampo.Add(MYSTICAL_ELF);   // Mago / LUZ
            brain.Decide(Idle(), 1);
            esc = brain.DecideSelect(Busca(SALAMANDRA, ELFS_LIGHT), 1);
            Check("nao pega Salamandra (+700 FOGO) para um monstro de LUZ",
                  esc.Count == 1 && esc[0] == 1, $"(escolheu {string.Join(",", esc)})");

            // 6. Com FOGO em campo, ai' sim ela ganha de todo o resto.
            meuCampo.Clear(); meuCampo.Add(FLAME_MANIPULATOR);  // Mago / FOGO
            brain.Decide(Idle(), 1);
            esc = brain.DecideSelect(Busca(BOOK_SECRET, SWORD_DEEP, SALAMANDRA), 1);
            Check("com monstro de FOGO, Salamandra (+700) ganha de todos",
                  esc.Count == 1 && esc[0] == 2, $"(escolheu {string.Join(",", esc)})");

            // 7. Equipamento que so' atrapalha nunca e' escolhido como reforco.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);
            brain.Decide(Idle(), 1);
            esc = brain.DecideSelect(Busca(RING_MAGNETISM, MYSTICAL_MOON), 1);
            Check("nunca escolhe Ring of Magnetism (−500) como reforco",
                  esc.Count == 1 && esc[0] == 1, $"(escolheu {string.Join(",", esc)})");

            // 8. Bonus igual em dois monstros meus: reforca o de MAIOR ATK, que e'
            //    quem ataca. Sword of Deep-Seated serve nos dois.
            meuCampo.Clear(); meuCampo.Add(MYSTICAL_ELF); meuCampo.Add(BATTLE_OX);
            brain.Decide(Idle(), 1);
            esc = brain.DecideSelect(Busca(SWORD_DEEP), 1);
            Check("com dois alvos, escolhe (o unico) equipamento sem travar",
                  esc.Count == 1 && esc[0] == 0, $"(escolheu {string.Join(",", esc)})");

            // 9. Nada serve: nao pode devolver lista vazia — o motor exige uma
            //    escolha, e travar a seleção travaria o duelo.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);
            brain.Decide(Idle(), 1);
            esc = brain.DecideSelect(Busca(DRAGON_TREASURE, BOOK_SECRET), 1);
            Check("sem equipamento que sirva, ainda assim responde algo",
                  esc.Count == 1, $"(veio {esc.Count} escolha(s))");

            // 10. A flag e' consumida: a seleção SEGUINTE (o alvo do equip, que vem
            //     do campo) nao pode cair na regra da busca.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);
            brain.Decide(Idle(), 1);
            brain.DecideSelect(Busca(MYSTICAL_MOON), 1);
            var alvo = new InteractiveDuel.Question { kind = "select", player = 1, selMin = 1, selMax = 1 };
            alvo.choices.Add(new InteractiveDuel.Sel
            { code = BATTLE_OX, index = 0, location = 0x4 /* MZONE */, controller = 1 });
            esc = brain.DecideSelect(alvo, 1);
            Check("a flag da busca nao vaza para a seleção do alvo",
                  esc.Count == 1 && esc[0] == 0, $"(escolheu {string.Join(",", esc)})");
        }

        // ---------------------------------------------------------- duelo real
        static void DueloReal(string sa)
        {
            // Deck do NPC: Battle Ox (Besta-Guerreira) + Armory Call + os dois
            // equipamentos. Mystical Moon (+300) e' o que casa; Dragon Treasure
            // esta' la' justamente para ele ter como errar.
            var deckNpc = new List<uint>();
            // 40 cartas exatas: com 36 o motor nao monta o deck e a armadilha nunca
            // chega a mao — o sintoma e' o NPC so' invocar, sem erro nenhum.
            for (int i = 0; i < 10; i++) deckNpc.Add(BATTLE_OX);
            for (int i = 0; i < 12; i++) deckNpc.Add(ARMORY_CALL);
            for (int i = 0; i < 9; i++) deckNpc.Add(DRAGON_TREASURE);
            for (int i = 0; i < 9; i++) deckNpc.Add(MYSTICAL_MOON);

            var deckJogador = new List<uint>();
            for (int i = 0; i < 40; i++) deckJogador.Add(MYSTICAL_ELF);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 4242UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray(),
                                                 extra: null, npcExtra: null);
            var r = duel.Advance();

            bool setou = false, ativou = false, equipou = false;
            uint buscada = 0;
            int atkFinal = 0;

            for (int guard = 0; guard < 240 && !r.ended; guard++)
            {
                foreach (var ev in r.events)
                {
                    string s = System.Text.Json.JsonSerializer.Serialize(ev);
                    if (s.Contains("seta armadilha") && s.Contains(ARMORY_CALL.ToString())) setou = true;
                    if (s.Contains("Armory Call: busca equipamento")) ativou = true;
                    if (s.Contains("Armory Call: escolhe"))
                    {
                        equipou = true;
                        if (s.Contains(MYSTICAL_MOON.ToString())) buscada = MYSTICAL_MOON;
                        else if (s.Contains(DRAGON_TREASURE.ToString())) buscada = DRAGON_TREASURE;
                    }
                }
                if (equipou)
                {
                    // A prova final vem do MOTOR, não do log: o Battle Ox do NPC
                    // tem de estar com 2000 (1700 + 300).
                    for (int seq = 0; seq < 5; seq++)
                    {
                        // `QueryAtk` devolve nulo para zona vazia — só interessa
                        // a maior das ocupadas.
                        var (atk, _) = duel.QueryAtk(controller: 1, seq);
                        if (atk.GetValueOrDefault() > atkFinal) atkFinal = atk.GetValueOrDefault();
                    }
                    if (atkFinal >= 2000) break;
                }

                var q = r.question;
                if (q == null) break;

                // A pergunta de ZONA nao e' opcional: responder outra coisa faz o
                // motor reperguntar, e o laco gira sem sair do lugar.
                if (q.kind == "place")
                { r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); continue; }

                r = q.kind == "idle" && q.summonable.Count > 0
                    ? duel.Respond("summon", q.summonable[0].index)
                    : duel.Respond("endturn", 0);
            }

            Check("o NPC setou a Armory Call", setou);
            Check("e ativou quando tinha monstro em campo", ativou);
            Check("buscou o equipamento que CASA (Mystical Moon, nao Dragon Treasure)",
                  buscada == MYSTICAL_MOON, $"(buscou {buscada})");
            Check("o motor confirma o Battle Ox em 2000 ATK (1700 + 300)",
                  atkFinal >= 2000, $"(maior ATK do NPC: {atkFinal})");
        }
    }
}
