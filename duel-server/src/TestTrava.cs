using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// As magias de TRAVA — `--test-trava`.
    ///
    /// O relato foi: *"ele esta' perdendo e mesmo assim nao usa a Swords of
    /// Concealing Light"*. Nao era criterio errado: era a AUSENCIA de qualquer
    /// criterio. Nenhuma regra do `Decide` olhava para elas, e nenhuma poderia —
    /// as duas Espadas vem com `category = 0` no `cards.cdb`, entao as regras por
    /// EFEITO (`Perfil().Compra`, `.DestroiMonstro`, …) nao as enxergam, e nenhuma
    /// lista por id as citava. O NPC carregava a carta a partida inteira enquanto
    /// apanhava.
    ///
    /// Tres metades, e as tres erram calado:
    ///
    ///   1. **o reconhecimento**, que e' so' Lua (nao ha' categoria para cruzar):
    ///      a proibicao mais o ALCANCE `(0, LOCATION_MZONE)`. O par controle e' a
    ///      Gravity Bind, que proibe igual mas mira os DOIS lados — ativa-la
    ///      prenderia o proprio campo do NPC, e um deck de batida que nao pode
    ///      atacar nao fecha duelo nenhum;
    ///   2. **a decisao**, com o campo montado a mao: ele ativa quando o campo do
    ///      oponente supera o dele, e GUARDA quando ja' domina. O par controle e'
    ///      obrigatorio — sem ele, uma regra que ativasse sempre passaria igual, e
    ///      "ativou" nao provaria criterio nenhum;
    ///   3. **o duelo de verdade**, que e' o unico que prova que a carta chega a
    ///      `activatable` e que a jogada sai pelo caminho real (a decisao acima
    ///      roda sobre uma `Question` montada aqui — ela nao prova que o motor
    ///      oferece a carta).
    /// </summary>
    public static class TestTrava
    {
        const uint CONCEALING = 12923641;   // Magia Continua: vira os monstros dele e tranca a posicao
        const uint REVEALING = 72302403;    // Magia Normal: ele nao ataca por 3 turnos
        const uint GRAVITY_BIND = 85742772; // trava os DOIS lados — o par controle do reconhecimento
        const uint MESSENGER = 92527720;    // Messenger of Peace — idem, os dois lados
        const uint RAIGEKI = 12580477;      // remocao: resolve de vez, e por isso vem antes da trava

        // Corpos Normais (vanilla), sem efeito nenhum para nao encher a volta de
        // perguntas com escolhas que este teste nao investiga.
        const uint PETIT_MOTH = 58192742;   // Nv1 300/200
        const uint MYSTICAL_ELF = 15025844; // Nv4 800/2000
        const uint BATTLE_OX = 5053103;     // Nv4 1700/1000
        const uint GAIA_NV7 = 6368038;      // Nv7 2300/2100

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que conta como TRAVA (so' o Lua decide: category vem 0) ===\n");
            OReconhecimento(sa);

            Log.Info("\n=== a decisao, com o campo montado a mao ===\n");
            AsDecisoes(sa);

            Log.Info("\n=== duelo de verdade: ele ativa sozinho, apanhando ===\n");
            NoDueloDeVerdade(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------- reconhecimento

        static void OReconhecimento(string sa)
        {
            using var db = new DatabaseManager(sa);

            foreach (var (code, nome) in new[] { (CONCEALING, "Swords of Concealing Light"),
                                                 (REVEALING, "Swords of Revealing Light") })
            {
                Check($"{nome} e' reconhecida como trava", db.Perfil(code).Trava,
                      "(o Lua tem a proibicao e o alcance (0,LOCATION_MZONE)?)");
                // A metade que explica POR QUE o reconhecimento nao pode vir da
                // categoria: ela e' ZERO. Sem esta asserticao, alguem "melhoraria"
                // a regra cruzando com a `category` (como todas as outras classes
                // do perfil fazem) e ela pararia de achar as duas — em silencio.
                Check($"{nome} tem category ZERO no banco (por isso a regra e' so' Lua)",
                      db.Stats(code).Category == 0,
                      $"(veio 0x{db.Stats(code).Category:x})");
            }

            foreach (var (code, nome) in new[] { (GRAVITY_BIND, "Gravity Bind"),
                                                 (MESSENGER, "Messenger of Peace") })
            {
                Check($"par CONTROLE: {nome} NAO e' trava (prende os DOIS lados)",
                      !db.Perfil(code).Trava,
                      "(o NPC prenderia o proprio campo e nao fecharia mais o duelo)");
            }
        }

        // --------------------------------------------------------- a decisao

        static void AsDecisoes(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();    // o campo do NPC (jogador 1)
            var campoDele = new List<uint>();   // o campo do humano (jogador 0)

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : campoDele,
                log: _ => { },
                handOf: _ => new List<uint>());

            InteractiveDuel.Question Idle(params uint[] ativaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis)
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            bool AtivouTrava(NpcBrain.Play p) =>
                p.Action == "activate" && (p.Why ?? "").StartsWith("trava:");

            // O caso relatado: ele nao tem corpo nenhum e o outro lado tem um
            // 1700 em campo. E' exatamente aqui que a carta existe para ser jogada.
            meuCampo.Clear(); campoDele.Clear(); campoDele.Add(BATTLE_OX);
            var p1 = brain.Decide(Idle(CONCEALING), 1);
            Check("campo dele com 1700 e o meu vazio: ATIVA a trava", AtivouTrava(p1),
                  $"(veio {p1.Action} — {p1.Why})");

            // PAR CONTROLE, e o que importa: eu domino o combate. Travar quem eu ja'
            // venco so' adia o meu proprio ataque e queima uma carta.
            meuCampo.Clear(); meuCampo.Add(GAIA_NV7);
            campoDele.Clear(); campoDele.Add(PETIT_MOTH);
            var p2 = brain.Decide(Idle(CONCEALING), 1);
            Check("par CONTROLE: com 2300 contra 300 em campo, GUARDA", !AtivouTrava(p2),
                  $"(veio {p2.Action} — {p2.Why})");

            // O outro jeito de a trava nao valer nada: nao ha' o que travar.
            meuCampo.Clear(); campoDele.Clear();
            var p3 = brain.Decide(Idle(CONCEALING), 1);
            Check("campo dele VAZIO: guarda (nao ha' o que travar)", !AtivouTrava(p3),
                  $"(veio {p3.Action} — {p3.Why})");

            // Empate de ATK conta como ameaca: numa batalha entre iguais os dois
            // morrem, e o NPC nao tem corpo sobrando para trocar.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);
            campoDele.Clear(); campoDele.Add(BATTLE_OX);
            var p4 = brain.Decide(Idle(CONCEALING), 1);
            Check("ATK empatado tambem e' ameaca: ativa", AtivouTrava(p4),
                  $"(veio {p4.Action} — {p4.Why})");

            // A ORDEM. As duas resolvem o mesmo problema, mas a remocao resolve
            // para sempre e a trava tem prazo — gastar a trava com um Raigeki na
            // mao seria trocar a solucao pela pausa.
            meuCampo.Clear(); campoDele.Clear(); campoDele.Add(BATTLE_OX);
            var p5 = brain.Decide(Idle(CONCEALING, RAIGEKI), 1);
            Check("com Raigeki na mao, a REMOCAO vem antes da trava",
                  p5.Action == "activate" && !AtivouTrava(p5),
                  $"(veio {p5.Action} — {p5.Why})");

            // E a Gravity Bind nunca e' escolhida como trava, mesmo apanhando: ela
            // prenderia o campo do proprio NPC junto.
            meuCampo.Clear(); campoDele.Clear(); campoDele.Add(BATTLE_OX);
            var p6 = brain.Decide(Idle(GRAVITY_BIND), 1);
            Check("par CONTROLE: apanhando, a Gravity Bind continua fora", !AtivouTrava(p6),
                  $"(veio {p6.Action} — {p6.Why})");
        }

        // ---------------------------------------------------------------- duelo

        /// <summary>
        /// O duelo real. A secao acima roda sobre uma `Question` montada aqui —
        /// ela prova o CRITERIO, e nao que o motor oferece a carta. Este prova o
        /// resto do caminho: a Espada chega a mao, entra em `activatable` e a
        /// jogada sai.
        /// </summary>
        static void NoDueloDeVerdade(string sa)
        {
            // O jogador com corpos grandes; o NPC, com corpos fracos e as Espadas.
            var deckJogador = new List<uint>();
            for (int i = 0; i < 40; i++) deckJogador.Add(i % 2 == 0 ? GAIA_NV7 : BATTLE_OX);

            var deckNpc = new List<uint>();
            for (int i = 0; i < 8; i++) deckNpc.Add(CONCEALING);
            for (int i = 0; i < 6; i++) deckNpc.Add(REVEALING);
            while (deckNpc.Count < 40) deckNpc.Add(deckNpc.Count % 2 == 0 ? PETIT_MOTH : MYSTICAL_ELF);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 20260823UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray());
            var r = duel.Advance();

            bool tinhaNaMao = false, ativou = false;
            string porque = null;

            for (int guard = 0; guard < 300 && !r.ended && !ativou; guard++)
            {
                // A carta esta' com ele? Sem isto, "ativou" poderia ser sorte de
                // embaralhamento — e "nao ativou" nao diria nada. A resposta vem do
                // proprio motor, pelo mesmo `MaoDoNpc()` que o raio-x do admin usa.
                var mao = duel.MaoDoNpc();
                if (mao != null && mao.Any(c => c == CONCEALING || c == REVEALING)) tinhaNaMao = true;

                foreach (var e in r.events)
                {
                    var (acao, why) = LerNpc(e);
                    // O evento do NPC na Main Phase nao carrega o codigo da carta
                    // (so' `action` e `why`), entao o sinal e' o motivo — escrito
                    // pela propria regra da trava.
                    if (acao == "activate" && (why ?? "").StartsWith("trava:"))
                    {
                        ativou = true; porque = why;
                        Log.Info($"  > NPC ativou a trava: {why}");
                    }
                }
                if (ativou) break;

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    // Poe o maior corpo que der em campo e passa a vez: e' o campo
                    // do jogador que faz a regra do NPC disparar.
                    if (q.summonable.Count > 0)
                    {
                        var maior = q.summonable
                            .OrderByDescending(a => (long)db_Atk(sa, a.code))
                            .First();
                        r = duel.Respond("summon", maior.index);
                        continue;
                    }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }

            Check("a trava chegou a mao do NPC", tinhaNaMao,
                  "(nunca foi comprada — o duelo nao chegou a exercitar a regra)");
            Check("e ele a ativou sozinho, sem ninguem mandar", ativou,
                  "(a regra da trava nao disparou — era o defeito relatado)");
            Check("dizendo qual carta e por que", porque != null && porque.Contains("prende o campo dele"),
                  $"(motivo: {porque ?? "nenhum"})");
        }

        // ---------------------------------------------------------- utilidades

        static DatabaseManager _db;
        static int db_Atk(string sa, uint code)
        {
            _db ??= new DatabaseManager(sa);
            return _db.Stats(code).AtkValue;
        }

        static (string acao, string why) LerNpc(object e)
        {
            var t = e.GetType();
            if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") return (null, null);
            return (t.GetProperty("action")?.GetValue(e) as string,
                    t.GetProperty("why")?.GetValue(e) as string);
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
