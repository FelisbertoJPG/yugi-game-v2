using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// O CORPO CONDENADO — `--test-condenado`.
    ///
    /// Instant Fusion e Ready Fusion pagam 1000 LP e põem uma Fusão em campo que
    /// **não pode atacar** e é **destruída na End Phase deste mesmo turno**. A
    /// pergunta que originou isto: *"o NPC sabe que esses corpos somem na End? no
    /// caso pra ele usar como tributo, material pra qualquer coisa"*.
    ///
    /// Não sabia. E o buraco tinha três metades bem diferentes:
    ///
    ///   1. **atacar** — esta já estava segura, e não precisou de regra nenhuma: o
    ///      `EFFECT_CANNOT_ATTACK` é do próprio motor, então o corpo nunca aparece
    ///      em `attackers` e o NPC não tem como tentar;
    ///   2. **pagar com ele** — o cérebro media o preço de um corpo pelo ATK/DEF
    ///      de agora, então PROTEGIA justamente o que ia sumir: com um Barox
    ///      (1380, do Instant Fusion) e um Petit Moth (300) em campo, ele
    ///      tributava o Moth. Um corpo condenado é o tributo mais barato que
    ///      existe na mesa — o preço dele já foi pago;
    ///   3. **contar como campo** — ele entrava no `MaiorAtkEmCampo`, que é quem
    ///      responde "eu domino a mesa?". Duplamente errado: o corpo não ataca e
    ///      nem chega ao turno do oponente. O NPC concluía que estava bem e
    ///      guardava a trava e o reforço, com o campo esvaziando logo depois.
    ///
    /// **A marca é por ZONA e vem do que ACONTECEU** (a carta que resolveu, mais o
    /// monstro que chegou do Extra logo depois), e não do tipo da carta. Essa
    /// distinção é o coração do arquivo: antes, a única regra que sabia disso
    /// (o Templo do Mako) adivinhava por `TYPE_FUSION`, e o argumento — "num deck
    /// sem Polymerization, uma Fusão em campo só pode ter vindo do Instant Fusion"
    /// — valia para aquele deck e para mais nenhum. Num deck com Polymerization o
    /// palpite mandaria tributar de graça o melhor corpo do campo, que ia FICAR.
    /// </summary>
    public static class TestCondenado
    {
        const uint INSTANT_FUSION = 1845204;
        const uint READY_FUSION = 63854005;
        const uint POLYMERIZATION = 24094653;   // o par controle: a Fusao dela FICA
        const uint BAROX = 6840573;             // Fusao Nv5 1380/1530 — a do Panik
        const uint PETIT_MOTH = 58192742;       // Nv1 300/200
        const uint CONCEALING = 12923641;       // a trava, que depende da `ameacaReal`

        const byte MZONE = 0x4;
        const int POS_ATAQUE = 0x1;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== quais cartas trazem corpo condenado (lido do Lua) ===\n");
            OReconhecimento(sa);

            Log.Info("\n=== pagar com ele: e' o corpo mais barato da mesa ===\n");
            OCusto(sa);

            Log.Info("\n=== e ele NAO conta como campo ===\n");
            ACamada(sa);

            Log.Info("\n=== e NAO recebe equipamento: a carta iria junto para o cemiterio ===\n");
            OEquipamento(sa);

            Log.Info("\n=== duelo de verdade: o motor marca a zona sozinho ===\n");
            NoDuelo(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------- reconhecimento

        static void OReconhecimento(string sa)
        {
            using var db = new DatabaseManager(sa);

            Check("Instant Fusion traz corpo condenado", db.Perfil(INSTANT_FUSION).TrazCorpoCondenado);
            Check("Ready Fusion tambem", db.Perfil(READY_FUSION).TrazCorpoCondenado);

            // O PAR CONTROLE que da' sentido a tudo: a Polymerization tambem invoca
            // uma Fusao, e o corpo dela FICA. Tratar as duas igual (que e' o que o
            // palpite por `TYPE_FUSION` fazia) mandaria o NPC gastar de graca o
            // melhor corpo do campo.
            Check("par CONTROLE: Polymerization NAO condena — a Fusao dela fica",
                  !db.Perfil(POLYMERIZATION).TrazCorpoCondenado,
                  "(o NPC tributaria de graca o melhor corpo do campo)");

            // E a trava, que tem `EFFECT_CANNOT_ATTACK` no Lua: sem os outros tres
            // sinais juntos, ela cairia aqui — e ela nem poe corpo em campo.
            Check("par CONTROLE: a Swords of Concealing Light nao condena ninguem",
                  !db.Perfil(CONCEALING).TrazCorpoCondenado,
                  "(ela tem EFFECT_CANNOT_ATTACK, mas mirado no campo DELE)");
        }

        // ---------------------------------------------------------------- custo

        static void OCusto(string sa)
        {
            using var db = new DatabaseManager(sa);

            // Campo: o Barox condenado na zona 0, o Petit Moth na 1.
            var meuCampo = new List<uint> { BAROX, PETIT_MOTH };
            var condenadas = new HashSet<int>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (code: c, pos: POS_ATAQUE, seq: i)).ToList()
                    : new List<(uint, int, int)>(),
                corpoCondenadoOf: (p, seq) => p == 1 && condenadas.Contains(seq));

            // Um pedido de UM tributo, com os dois corpos oferecidos.
            InteractiveDuel.Question Tributo()
            {
                var q = new InteractiveDuel.Question { kind = "selecttribute", player = 1, selMin = 1, selMax = 1 };
                for (int i = 0; i < meuCampo.Count; i++)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = meuCampo[i], index = i, location = MZONE, controller = 1, sequence = i, release = 1 });
                return q;
            }

            condenadas.Clear(); condenadas.Add(0);       // o Barox esta' condenado
            var comMarca = brain.DecideSelect(Tributo(), 1);
            Check("tributa o corpo CONDENADO, mesmo ele tendo o maior ATK",
                  comMarca.Count == 1 && comMarca[0] == 0,
                  $"(escolheu {(comMarca.Count > 0 ? meuCampo[comMarca[0]].ToString() : "nenhum")})");

            // PAR CONTROLE: o MESMO tabuleiro sem a marca (o Barox veio da
            // Polymerization e vai ficar). Agora o preco volta a ser o ATK, e quem
            // sai e' o corpo barato de verdade.
            condenadas.Clear();
            var semMarca = brain.DecideSelect(Tributo(), 1);
            Check("par CONTROLE: sem a marca, tributa o corpo BARATO (o Moth)",
                  semMarca.Count == 1 && semMarca[0] == 1,
                  $"(escolheu {(semMarca.Count > 0 ? meuCampo[semMarca[0]].ToString() : "nenhum")})");
        }

        // ---------------------------------------------------------- como campo

        static void ACamada(string sa)
        {
            using var db = new DatabaseManager(sa);

            // Eu: so' o Barox condenado (1380). Ele: um Petit Moth (300).
            //
            // Pelo ATK impresso eu domino a mesa — e e' exatamente essa a conta
            // errada: o Barox nao ataca e some na minha End Phase, entao no turno
            // DELE meu campo esta' vazio. A trava (`Swords of Concealing Light`)
            // le' a `ameacaReal`, e por isso serve de termometro aqui.
            var meuCampo = new List<uint> { BAROX };
            var campoDele = new List<uint> { PETIT_MOTH };
            var condenadas = new HashSet<int>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : campoDele,
                log: _ => { },
                handOf: p => p == 1 ? new List<uint> { CONCEALING } : new List<uint>(),
                todoFieldPosOf: p => (p == 1 ? meuCampo : campoDele)
                    .Select((c, i) => (code: c, pos: POS_ATAQUE, seq: i)).ToList(),
                corpoCondenadoOf: (p, seq) => p == 1 && condenadas.Contains(seq));

            InteractiveDuel.Question Idle()
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = CONCEALING, index = 0, location = 0x2 });
                return q;
            }

            bool AtivouTrava(NpcBrain.Play p) =>
                p.Action == "activate" && (p.Why ?? "").StartsWith("trava:");

            condenadas.Clear(); condenadas.Add(0);
            var comMarca = brain.Decide(Idle(), 1);
            Check("com o corpo condenado, o campo conta como VAZIO — ele reage a ameaca",
                  AtivouTrava(comMarca), $"(veio {comMarca.Action} — {comMarca.Why})");

            // PAR CONTROLE: o mesmo 1380 sem a marca e' campo de verdade, supera os
            // 300 dele, e nao ha' ameaca nenhuma a que reagir.
            condenadas.Clear();
            var semMarca = brain.Decide(Idle(), 1);
            Check("par CONTROLE: sem a marca, 1380 contra 300 e' campo dominado — GUARDA",
                  !AtivouTrava(semMarca), $"(veio {semMarca.Action} — {semMarca.Why})");
        }

        // --------------------------------------------------------- equipamento

        /// <summary>
        /// **Equipamento nunca vai para o corpo condenado.**
        ///
        /// O relato: *"o NPC usa a Ready Fusion, gasta recurso em cima do monstro,
        /// e ele nao pode atacar e na end e' destruido — entao ele gasta os equip
        /// a' toa"*. E o desempate da escolha do alvo escolhia justamente ele: a
        /// regra reforca "quem ja' vale mais na mesa" quando o bonus empata, e a
        /// Fusao que o Instant/Ready Fusion traz costuma ser o maior ATK do campo.
        ///
        /// O prejuizo e' duplo e todo silencioso: o bonus de ATK nao serve para
        /// nada (o `EFFECT_CANNOT_ATTACK` e' do motor — o corpo nunca chega a
        /// batalhar) e o equipamento vai JUNTO para o cemiterio quando ele e'
        /// destruido na End Phase. A carta equipa, o motor soma, a tela mostra o
        /// numero novo, e os dois somem no fim do turno.
        ///
        /// O par CONTROLE e' o mesmo tabuleiro sem a marca, onde o alvo TEM de
        /// voltar a ser o corpo grande: sem ele, uma regra que sempre equipasse o
        /// monstro mais fraco passaria aqui e desperdicaria todo equipamento do
        /// jogo no pior corpo da mesa.
        /// </summary>
        static void OEquipamento(string sa)
        {
            using var db = new DatabaseManager(sa);

            // Stim-Pack: +700 sem exigir raca nem atributo, entao ele SERVE nos
            // dois corpos e o desempate e' quem decide. Com um equipamento
            // restrito, "escolheu o Moth" nao provaria regra nenhuma.
            const uint STIM_PACK = 83225447;

            var meuCampo = new List<uint> { BAROX, PETIT_MOTH };
            var condenadas = new HashSet<int>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: m => Log.Info($"    [npc] {m}"),
                handOf: _ => new List<uint> { STIM_PACK },
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (code: c, pos: POS_ATAQUE, seq: i)).ToList()
                    : new List<(uint, int, int)>(),
                corpoCondenadoOf: (p, seq) => p == 1 && condenadas.Contains(seq));

            InteractiveDuel.Question Idle()
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = STIM_PACK, index = 0 });
                return q;
            }

            // PAR CONTROLE primeiro: sem marca nenhuma, o desempate manda no
            // corpo grande (zona 0, o Barox de 1380).
            condenadas.Clear();
            var semMarca = brain.Decide(Idle(), 1);
            Check("par CONTROLE: sem a marca, equipa o corpo GRANDE (o Barox, zona 0)",
                  semMarca.Action == "activate" && semMarca.Why.Contains("zona 0"),
                  $"(veio {semMarca.Action} — {semMarca.Why})");

            // Com o Barox condenado, o unico alvo que sobra e' o Moth.
            condenadas.Clear(); condenadas.Add(0);
            var comMarca = brain.Decide(Idle(), 1);
            Check("com a marca, equipa o OUTRO corpo (o Moth, zona 1) e nao o condenado",
                  comMarca.Action == "activate" && comMarca.Why.Contains("zona 1"),
                  $"(veio {comMarca.Action} — {comMarca.Why}; o equipamento iria para o " +
                  "cemiterio junto com a Fusao na End Phase)");

            // E com TODO o campo condenado nao ha' alvo nenhum: a carta fica na
            // mao para o turno em que houver corpo de verdade. Equipar "o menos
            // pior" seria a mesma carta jogada fora.
            condenadas.Clear(); condenadas.Add(0); condenadas.Add(1);
            var tudoCondenado = brain.Decide(Idle(), 1);
            Check("com o campo TODO condenado, guarda o equipamento na mao",
                  tudoCondenado.Action != "activate",
                  $"(veio {tudoCondenado.Action} — {tudoCondenado.Why})");
        }

        // ---------------------------------------------------------------- duelo

        /// <summary>
        /// O caminho que as secoes acima NAO provam: que o motor marca a zona
        /// sozinho. Elas dizem a marca na mao; esta faz o NPC ativar o Instant
        /// Fusion de verdade e confere que o corpo que chegou do Extra ficou
        /// marcado — e que o par controle (a Fusao da Polymerization) nao.
        /// </summary>
        static void NoDuelo(string sa)
        {
            // O JOGADOR e' quem ativa, e nao o NPC — nao por preferencia, por
            // OBSERVABILIDADE: o turno inteiro do NPC (ativar, batalhar, encerrar)
            // e' resolvido dentro de um `Respond` so', entao o corpo nasce e morre
            // na End Phase no MESMO lote de eventos, e a marca ja' saiu quando
            // alguem de fora consegue olhar. Pelo lado do humano o motor devolve
            // uma pergunta com o corpo ainda em campo.
            //
            // E prova uma coisa a mais de graca: a marca nao e' do NPC, e' da
            // ZONA. Um corpo condenado do outro lado tambem nao pode contar como
            // ameaca.
            var deckJogador = new List<uint>();
            for (int i = 0; i < 12; i++) deckJogador.Add(INSTANT_FUSION);
            while (deckJogador.Count < 40) deckJogador.Add(PETIT_MOTH);
            uint[] extraJogador = { BAROX, BAROX, BAROX };

            var deckNpc = new List<uint>();
            while (deckNpc.Count < 40) deckNpc.Add(PETIT_MOTH);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 20260823UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray(), extra: extraJogador);
            var r = duel.Advance();

            bool ativou = false, marcou = false, desmarcouAoSair = false;
            int zonaDoBarox = -1;

            for (int guard = 0; guard < 200 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                    if (Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u) != BAROX) continue;
                    if (Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0) != 0) continue;
                    if (Convert.ToInt32(t.GetProperty("loc")?.GetValue(e) ?? 0) != MZONE) continue;
                    zonaDoBarox = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? 0);
                }

                // A marca e' lida FORA do laco de eventos, com o motor parado numa
                // pergunta: e' o unico instante em que o corpo esta' em campo e
                // alguem pode perguntar.
                if (zonaDoBarox >= 0 && !marcou) marcou = duel.CorpoCondenado(0, zonaDoBarox);

                // Depois da End Phase o corpo saiu do campo — e a marca tem de sair
                // junto. Marca velha e' pior que marca nenhuma: ela faria o cerebro
                // tratar como descartavel o proximo monstro a ocupar aquela zona.
                if (marcou && !duel.CorpoCondenado(0, zonaDoBarox)) desmarcouAoSair = true;

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    var inst = q.activatable.FirstOrDefault(a => a.code == INSTANT_FUSION);
                    if (!ativou && inst.code == INSTANT_FUSION)
                    {
                        ativou = true;
                        r = duel.Respond("activate", inst.index);
                        continue;
                    }
                    // Ja' ativou e ja' conferiu: passa o turno para o corpo morrer
                    // na End Phase, que e' o que prova a outra metade.
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }

            Check("o jogador ativou o Instant Fusion", ativou);
            Check("o corpo chegou do Extra a zona de monstro", zonaDoBarox >= 0,
                  "(a Fusao nunca entrou em campo — o duelo nao exercitou a marcacao)");
            Check("e o motor marcou a ZONA dele sozinho", marcou,
                  "(sem a marca, o cerebro volta a proteger o corpo que vai sumir)");
            Check("e a marca SAIU quando o corpo saiu do campo", desmarcouAoSair,
                  "(marca velha faria o proximo monstro daquela zona ser tributado de graca)");
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
