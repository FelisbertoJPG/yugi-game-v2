using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do "Bônus de Campo" — `--test-fieldbonus`.
    ///
    /// O editor de tabuleiro (`web/campo.html`) deixa fixar uma magia de campo
    /// já ativa desde o início do duelo (estilo "campo de Floresta do Weevil"
    /// no anime). A injeção mora em `DuelSession.InjectField` — só materializa
    /// a carta virada pra cima na zona de campo antes de `OCG_StartDuel`; quem
    /// aplica o efeito é o Lua da PRÓPRIA carta, sem nada reimplementado aqui.
    ///
    /// Prova disso: Forest dá +200 de ATK a monstro Tipo Inseto. Um Inseto
    /// normal-summonado com Forest no campo tem que consultar ATK = base + 200
    /// no PRÓPRIO motor (`InteractiveDuel.QueryAtk`, a mesma consulta que a
    /// Equip Spell usa) — não é uma conta nossa, é o que o core responde.
    ///
    /// Também prova que o evento `stats` (o que acende o destaque ".boost" no
    /// ATK em `duel.html`) chega sozinho quando um monstro entra em campo já
    /// sob o bônus — antes só disparava em MSG_EQUIP; pedido do usuário depois
    /// de testar um tabuleiro com Forest injetada pro deck do Weevil e ver que
    /// o ATK do Inseto não destacava na tela.
    /// </summary>
    public static class TestFieldBonus
    {
        const uint FOREST = 87430998;
        const uint KAMAKIRI = 3134241; // Flying Kamakiri #2 — Inseto Nv4, ATK 1500

        // A magia de campo ATIVADA DA MÃO, que é o caso do jogador (o Forest acima
        // é injetado pelo editor de tabuleiro, antes do duelo começar).
        const uint UMI = 22702055;
        const uint PEIXE = 23771716;   // 7 Colored Fish — Peixe Nv4 1800/800 -> Umi dá +200
        const uint MAQUINA = 7359741;  // Mechanicalchaser — Máquina Nv4 1850/800 -> Umi TIRA 200

        const byte MZONE = 0x4;

        static int _pass, _fail;

        public static int Run(string sa)
        {
            Log.Info("=== teste: BONUS DE CAMPO (Forest +200 ATK a Inseto) ===\n");
            ForestDaBonusDeVerdade(sa);
            Log.Info("\n=== teste: UMI ativada DA MAO, com monstro ja em campo ===\n");
            UmiAlcancaQuemJaEstavaEmCampo(sa);
            Log.Info("\n=== teste: o campo do tabuleiro do NPC e' DELE ===\n");
            OCampoDoNpcEhDele(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// De QUEM é a magia de campo injetada pelo tabuleiro.
        ///
        /// Ela nascia sempre do lado do jogador (`controller: 0`), o que virava o
        /// efeito do avesso: o "campo de Floresta do Weevil" acabava sendo SEU —
        /// ocupava a SUA zona de campo, e bastava você ativar uma magia de campo
        /// qualquer da mão para o campo especial do adversário sumir de graça,
        /// sem gastar remoção nenhuma. O tabuleiro temático do NPC durava até a
        /// sua primeira magia de campo.
        ///
        /// Com o tabuleiro sendo do NPC, a carta é dele. As duas passam a
        /// conviver — cada jogador tem a própria zona de campo —, então derrubar
        /// a dele voltou a custar uma remoção de verdade.
        ///
        /// O par CONTROLE é o que dá sentido ao teste: o MESMO duelo com a carta
        /// registrada como do jogador, onde ela É substituída.
        /// </summary>
        static void OCampoDoNpcEhDele(string sa)
        {
            // (dono do campo injetado) -> (o Umi sobreviveu?, controller no evento)
            (bool sobreviveu, int controller) Rodar(int donoDoCampo)
            {
                // Deck do jogador: a magia de campo DELE (Forest) para pôr por
                // cima, mais corpo inerte para o duelo andar.
                var meu = new List<uint>();
                for (int i = 0; i < 14; i++) meu.Add(FOREST);
                while (meu.Count < 40) meu.Add(5053103);   // Battle Ox, filler

                using var duel = new InteractiveDuel(sa, meu.ToArray(), 7654321UL, 0x1000000UL,
                                                     npc: false, npcDeck: null,
                                                     extra: null, npcExtra: null,
                                                     fieldSpell: UMI,
                                                     npcLeitura: false, doisHumanos: false,
                                                     fieldSpellController: donoDoCampo);
                var r = duel.Advance();

                int ctrlDoEvento = -1;
                bool umiMorreu = false, ativouForest = false;
                int guard = 0;

                while (!r.ended && guard++ < 200)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
                        int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);

                        // O evento SINTÉTICO do boot (fromLoc 0 = "nasceu ali"):
                        // é ele que diz ao front em que lado desenhar a carta.
                        if (code == UMI && from == 0 && loc == 0x8) ctrlDoEvento = ctrl;
                        // O Umi saindo da zona de magia para o cemitério.
                        if (code == UMI && from == 0x8 && loc == 0x10) umiMorreu = true;
                    }
                    if (ativouForest && umiMorreu) break;

                    var q = r.question;
                    if (q == null) break;

                    switch (q.kind)
                    {
                        case "idle":
                        {
                            var forest = q.activatable.FirstOrDefault(a => a.code == FOREST);
                            if (!ativouForest && forest.code == FOREST)
                            {
                                ativouForest = true;
                                r = duel.Respond("activate", forest.index);
                            }
                            else r = duel.Respond("endturn", 0);
                            break;
                        }
                        case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                        case "position": r = duel.Respond("position", 0x1); break;
                        case "chain": r = duel.Respond("chain", -1); break;
                        case "yesno": r = duel.Respond("yesno", 1); break;
                        case "battle": r = duel.Respond("endbattle", 0); break;
                        case "selectcard":
                        case "selecttribute":
                            r = duel.Respond("select", 0,
                                q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                            break;
                        default: r = duel.Respond("endturn", 0); break;
                    }
                }

                Check($"[dono={donoDoCampo}] o jogador chegou a ativar a propria magia de campo",
                      ativouForest, "(sem isso nao ha' o que comparar)");
                return (!umiMorreu, ctrlDoEvento);
            }

            var doNpc = Rodar(donoDoCampo: 1);
            var doJogador = Rodar(donoDoCampo: 0);

            Check("o evento de boot diz que a carta e' do NPC (controller 1)",
                  doNpc.controller == 1,
                  $"(veio {doNpc.controller} — o front desenharia na zona de campo errada)");
            Check("CONTROLE: como carta do jogador, ela veio com controller 0",
                  doJogador.controller == 0, $"(veio {doJogador.controller})");

            Check("sendo do NPC, o Umi SOBREVIVE a magia de campo do jogador",
                  doNpc.sobreviveu,
                  "(o jogador derrubou o campo do adversario de graca, so' ativando o dele)");
            Check("CONTROLE: sendo do jogador, ela e' substituida pela dele",
                  !doJogador.sobreviveu,
                  "(se nem assim ela sai, o teste acima nao esta provando nada)");
        }

        /// <summary>
        /// O caso que o jogador relatou: ativar Umi com monstros JÁ em campo não
        /// mexia em nada na tela.
        ///
        /// O motor sempre aplicou o bônus — a falha era de quem PERGUNTA. O evento
        /// `stats` só nascia em MSG_EQUIP (equipou) e em MSG_MOVE (entrou em campo),
        /// e uma magia de campo que resolve não é nenhum dos dois: ela mexe em
        /// cartas que não se moveram. Agora quem emite é a varredura do campo
        /// inteiro (`InteractiveDuel.VarrerStats`), que roda depois de cada leva de
        /// mensagens e compara com o que já foi contado.
        ///
        /// Três coisas de uma vez, e a terceira é um bug separado que estava
        /// escondido dentro do primeiro:
        ///
        ///   1. o monstro que JÁ estava em campo recebe `stats` quando Umi resolve
        ///      (1800 -> 2000);
        ///   2. o monstro que entra DEPOIS, com Umi já ativa, também (1850 -> 1650
        ///      no caso da Máquina — Umi TIRA 200 dela, e essa é a prova de que
        ///      quem decide é o Lua da carta e não uma conta nossa);
        ///   3. um monstro sem bônus nenhum também recebe `stats`. Parece
        ///      desperdício e não é: `duel.html` só desenha o rótulo de ATK quando
        ///      o valor existe, então antes disto o tabuleiro não mostrava ATK/DEF
        ///      de NINGUÉM — só de quem tinha equipamento.
        /// </summary>
        static void UmiAlcancaQuemJaEstavaEmCampo(string sa)
        {
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(UMI, 12); Add(PEIXE, 14); Add(MAQUINA, 14);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 20260814UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool peixeEmCampo = false, umiAtivada = false, maquinaEmCampo = false;
            int seqPeixe = -1, seqMaquina = -1;
            // Cada `stats` que chegou para o peixe e para a máquina, em ordem.
            var doPeixe = new List<(int atk, int baseAtk)>();
            var daMaquina = new List<(int atk, int baseAtk)>();

            for (int guard = 0; guard < 200 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    var tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        int seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        if (loc == MZONE && code == PEIXE) { peixeEmCampo = true; seqPeixe = seq; }
                        if (loc == MZONE && code == MAQUINA) { maquinaEmCampo = true; seqMaquina = seq; }
                        if (code == UMI && loc != 0x2) umiAtivada = true;   // saiu da mão para a zona de campo
                    }
                    else if (tipo == "stats")
                    {
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        int seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        int evAtk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? -1);
                        int evBase = Convert.ToInt32(t.GetProperty("baseAtk")?.GetValue(e) ?? -1);
                        if (loc != MZONE) continue;
                        if (seq == seqPeixe && peixeEmCampo) doPeixe.Add((evAtk, evBase));
                        else if (seq == seqMaquina && maquinaEmCampo) daMaquina.Add((evAtk, evBase));
                    }
                }

                if (peixeEmCampo && umiAtivada && maquinaEmCampo) break;

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle")
                {
                    // A ordem importa e é o teste inteiro: primeiro o peixe ENTRA em
                    // campo, só DEPOIS Umi é ativada. Invertido, o peixe entraria já
                    // sob o bônus e cairia no caso antigo (MSG_MOVE), que sempre
                    // funcionou — não provaria nada.
                    var peixe = q.summonable.FirstOrDefault(a => a.code == PEIXE);
                    if (!peixeEmCampo && peixe.code == PEIXE) { r = duel.Respond("summon", peixe.index); continue; }

                    var umi = q.activatable.FirstOrDefault(a => a.code == UMI);
                    if (peixeEmCampo && !umiAtivada && umi.code == UMI) { r = duel.Respond("activate", umi.index); continue; }

                    var maq = q.summonable.FirstOrDefault(a => a.code == MAQUINA);
                    if (umiAtivada && !maquinaEmCampo && maq.code == MAQUINA) { r = duel.Respond("summon", maq.index); continue; }

                    r = duel.Respond("endturn", 0);
                    continue;
                }

                r = q.kind switch
                {
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "yesno" => duel.Respond("yesno", 0),
                    "battle" => duel.Respond("endbattle", 0),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("7 Colored Fish entrou em campo", peixeEmCampo);
            Check("Umi foi ativada DA MAO depois disso", umiAtivada);
            if (!peixeEmCampo || !umiAtivada) return;

            Log.Info($"  stats do peixe:  [{string.Join(", ", doPeixe.Select(s => $"{s.atk}/base {s.baseAtk}"))}]");
            Log.Info($"  stats da maquina:[{string.Join(", ", daMaquina.Select(s => $"{s.atk}/base {s.baseAtk}"))}]");

            // (3) o monstro sem bônus nenhum já tinha sido anunciado — é o que faz o
            //     rótulo de ATK existir na carta antes de qualquer magia.
            Check("o peixe recebeu 'stats' ao entrar, ANTES de Umi (1800 sobre base 1800)",
                  doPeixe.Count > 0 && doPeixe[0] == (1800, 1800),
                  doPeixe.Count > 0 ? $"(veio {doPeixe[0].atk}/{doPeixe[0].baseAtk})" : "(nenhum stats chegou)");

            // (1) o caso do relato.
            Check("Umi alcancou quem JA' estava em campo: chegou 'stats' de 2000 sobre base 1800",
                  doPeixe.Any(s => s.atk == 2000 && s.baseAtk == 1800),
                  $"(recebidos: {doPeixe.Count})");

            // (2) e a Máquina prova que quem manda e' o Lua da carta: Umi TIRA dela.
            if (maquinaEmCampo)
                Check("e a Maquina que entrou depois perdeu 200 (1650 sobre base 1850) — quem decide e' o Lua",
                      daMaquina.Any(s => s.atk == 1650 && s.baseAtk == 1850),
                      $"(recebidos: {daMaquina.Count})");
            else
                Log.Info("  --   (a Maquina nao chegou a ser invocada nesta partida)");

            // O motor confirma, sem passar por evento nenhum.
            var (atk, baseAtk) = duel.QueryAtk(controller: 0, seqPeixe);
            Check("o motor confirma o peixe em 2000 (consulta direta, nao evento)",
                  atk == 2000 && baseAtk == 1800, $"(veio {atk}, base {baseAtk})");
        }

        static void ForestDaBonusDeVerdade(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 14; i++) deck.Add(KAMAKIRI);
            while (deck.Count < 40) deck.Add(5053103); // Battle Ox, filler inerte

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 998877UL, 0x1000000UL,
                                                 npc: false, npcDeck: null, extra: null, npcExtra: null,
                                                 fieldSpell: FOREST);
            var r = duel.Advance();

            bool summonou = false;
            int seq = -1;
            // Prova que o `duel.html` de verdade recebe o destaque de ATK: não
            // basta o QueryAtk manual (linha 88) responder certo, o evento
            // `stats` precisa aparecer no MESMO lote da invocação — é ele que
            // acende o ".boost" na carta (ver InteractiveDuel.cs, case 50/MOVE).
            bool statsEventChegou = false;
            int statsAtk = -1, statsBaseAtk = -1;

            for (int guard = 0; guard < 30 && !r.ended && !summonou; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    var tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        if (code == KAMAKIRI && loc == 4) // LOCATION_MZONE
                        {
                            summonou = true;
                            seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        }
                    }
                    else if (tipo == "stats")
                    {
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        int evSeq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        if (loc == 4 && evSeq == seq)
                        {
                            statsEventChegou = true;
                            statsAtk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? -1);
                            statsBaseAtk = Convert.ToInt32(t.GetProperty("baseAtk")?.GetValue(e) ?? -1);
                        }
                    }
                }
                if (summonou) break;

                var q = r.question;
                if (q == null) break;

                switch (q.kind)
                {
                    case "idle":
                    {
                        var s = q.summonable.FirstOrDefault(a => a.code == KAMAKIRI);
                        if (s.code == KAMAKIRI) { r = duel.Respond("summon", s.index); break; }
                        r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "place": r = duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0); break;
                    case "yesno": r = duel.Respond("yesno", 0); break;
                    default: r = duel.Respond("endturn", 0); break;
                }
            }

            Check("Flying Kamakiri #2 foi normal-summonado", summonou);
            if (!summonou) return;

            var (atk, baseAtk) = duel.QueryAtk(controller: 0, seq);
            Log.Info($"  ATK consultado no motor: base={baseAtk} atual={atk} (Forest ativo deveria dar base+200)");
            Check("Forest aplicou +200 de ATK de verdade (consulta no core, nao conta nossa)",
                  atk == 1700, $"(veio {atk}, base {baseAtk})");

            Check("o evento 'stats' chegou no MESMO lote da invocacao (duel.html destaca o ATK)",
                  statsEventChegou, $"(chegou={statsEventChegou})");
            if (statsEventChegou)
                Check("o evento 'stats' trouxe os numeros certos (1700 sobre base 1500)",
                      statsAtk == 1700 && statsBaseAtk == 1500, $"(atk={statsAtk}, baseAtk={statsBaseAtk})");
        }

        static void Check(string nome, bool ok, string extra = "")
        {
            if (ok) { _pass++; Log.Info($"  OK   {nome} {extra}"); }
            else { _fail++; Log.Err($"  FALHOU {nome} {extra}"); }
        }
    }
}
