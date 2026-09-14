using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// A CARD ADVANCE — `--test-card-advance`.
    ///
    /// O relato: *"a Card Advance não é tratada no jogo"*. O log de uma sessão
    /// real (`dist/logs/duel-server.log`) mostra o que acontecia: o jogador
    /// ativa, escolhe a zona, e em seguida `[retry] o motor recusou a resposta
    /// anterior (pergunta pendente: chain)` se repete até o `[guard] laco
    /// fechado`. O duelo morria ali, sem aviso nenhum na tela.
    ///
    /// A carta faz DUAS perguntas no meio da resolução, e nenhuma tinha tradução:
    ///
    ///   1. `Duel.AnnounceNumberRange(tp,1,ct)` → MSG_ANNOUNCE_NUMBER (143),
    ///      "quantas cartas do topo olhar";
    ///   2. `Duel.SortDecktop(tp,tp,ac)` → MSG_SORT_CARD (25), "devolva na ordem
    ///      que quiser".
    ///
    /// A 143 estava FORA da faixa que o `Parse` marcava como "não suportada"
    /// (10..30), então a pergunta pendente continuava sendo a janela de corrente
    /// anterior: o host respondia `-1` a uma pergunta de número, o motor devolvia
    /// RETRY, o host respondia igual. Toda carta de `AnnounceNumber` e de
    /// `SortDecktop`/`SortDeckbottom` cai no mesmo buraco.
    ///
    /// O que se prova, pelo caminho do JOGADOR (`Respond`, o de `web/duel.html`):
    ///
    ///   - a pergunta do número chega com os valores do script (1 a 5) e com a
    ///     carta que pergunta;
    ///   - declarar 3 faz chegar a ordenação de TRÊS cartas do deck;
    ///   - uma ordem torta (o mesmo lugar três vezes) é recusada e a MESMA
    ///     pergunta volta — o motor a recusaria com RETRY e a tela ficaria parada;
    ///   - inverter a ordem muda a compra seguinte: vem a carta que estava em 3º;
    ///   - a resolução não para no sort: o segundo efeito da carta (Invocar por
    ///     Tributo um Nv5+ além da Invocação-Normal) fica valendo, e o Summoned
    ///     Skull é oferecido depois de um Nv4 já ter sido invocado.
    ///
    /// Os pares CONTROLE, na MESMA seed: manter a ordem compra a carta que já
    /// estava em cima (sem ele, "comprou a 3ª" podia ser só a sorte do baralho —
    /// e é ele que FIXA qual ponta da lista do motor é o topo); e sem ativar a
    /// Card Advance o Skull NÃO é oferecido depois da Invocação-Normal (sem ele,
    /// "ofereceu" podia ser uma regra do motor sem nada a ver com a carta).
    /// </summary>
    public static class TestCardAdvance
    {
        const uint CARD_ADVANCE = 52112003;
        const uint SKULL = 70781052;          // Summoned Skull — Normal Nv6 2500/1200, pede 1 tributo

        // Dez Normais Nv4 DIFERENTES: a prova da ordem é a compra seguinte, e com
        // cópias demais do mesmo corpo "comprou a carta certa" não separaria nada.
        static readonly uint[] NV4 =
        {
            5053103,   // Battle Ox
            15025844,  // Mystical Elf
            91152256,  // Celtic Guardian
            69140098,  // Gemini Elf
            97590747,  // La Jinn the Mystical Genie of the Lamp
            14898066,  // Vorse Raider
            11091375,  // Luster Dragon
            43096270,  // Alexandrite Dragon
            76184692,  // Hitotsu-Me Giant
            68401546,  // Fairy's Gift
        };

        const byte LOC_DECK = 0x01, LOC_MZONE = 0x04;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        enum Modo { Inverter, Manter, SemAtivar }

        sealed class Saida
        {
            public ulong seed;
            public bool montou;                       // a mão tinha Card Advance + Skull + um Nv4
            public List<ulong> numeros;               // o que a pergunta do número ofereceu
            public uint numeroDe;                     // quem perguntou o número
            public List<InteractiveDuel.Sel> ordenar; // as cartas da ordenação, na ordem do motor
            public uint ordenarDe;
            public bool tortaRecusada;
            public uint topoEsperado;                 // a carta que a ordem mandada pôs em cima
            public bool voltouAoIdle;
            public bool skullOferecido;
            public bool skullEmCampo;
            public uint comprou;                      // a 1a compra do jogador no turno seguinte
            public readonly HashSet<string> kinds = new();
            public string fim;                        // null = o duelo seguiu
        }

        public static int Run(string sa)
        {
            Log.Info("=== Card Advance: declarar 3 e INVERTER o topo do deck ===\n");

            // Procura um embaralhamento que monte a mão. Fixar uma seed daria um
            // teste que passa hoje e acusa amanhã por sorte do baralho. E a prova
            // da ordem precisa de cartas DIFERENTES nas pontas: com o mesmo corpo
            // em 1º e 3º, inverter e manter comprariam igual.
            Saida inv = null;
            for (ulong seed = 1; seed <= 80 && inv == null; seed++)
            {
                var t = Rodar(sa, Modo.Inverter, seed);
                if (!t.montou) continue;
                if (t.ordenar != null && t.ordenar.Count == 3 && t.ordenar[0].code == t.ordenar[2].code) continue;
                inv = t;
            }
            if (inv == null)
            {
                Check("montar a mao (Card Advance + Summoned Skull + um Nv4) em 80 embaralhamentos", false);
                return Fim();
            }
            Log.Info($"  seed {inv.seed}");

            Check("o duelo NAO morreu no meio (sem [guard], sem 'unsupported')",
                  inv.fim == null && !inv.kinds.Contains("unsupported"),
                  $"(fim: {inv.fim ?? "-"}; perguntas vistas: {string.Join(",", inv.kinds)})");
            Check("a pergunta do numero chegou (MSG_ANNOUNCE_NUMBER traduzida)", inv.numeros != null);
            Check("com os valores que o script oferece: 1 a 5",
                  inv.numeros != null && inv.numeros.SequenceEqual(new ulong[] { 1, 2, 3, 4, 5 }),
                  $"(veio [{(inv.numeros == null ? "" : string.Join(",", inv.numeros))}])");
            Check("e diz QUEM pergunta: a Card Advance", inv.numeroDe == CARD_ADVANCE, $"(veio {inv.numeroDe})");
            Check("declarar 3 fez chegar a ordenacao de TRES cartas (MSG_SORT_CARD traduzida)",
                  inv.ordenar?.Count == 3, $"(veio {inv.ordenar?.Count.ToString() ?? "nada"})");
            Check("todas do DECK do proprio jogador",
                  inv.ordenar != null && inv.ordenar.All(c => c.location == LOC_DECK && c.controller == 0),
                  inv.ordenar == null ? "" : $"({string.Join(",", inv.ordenar.Select(c => $"ctrl{c.controller}/loc{c.location:x}"))})");
            Check("a ordenacao tambem diz QUEM pergunta", inv.ordenarDe == CARD_ADVANCE, $"(veio {inv.ordenarDe})");
            Check("uma ordem torta (o mesmo lugar tres vezes) e' RECUSADA e a mesma pergunta volta", inv.tortaRecusada);
            Check("a resolucao terminou e o turno seguiu (voltou ao idle)", inv.voltouAoIdle);
            Check("o 2o efeito valeu: com um Nv4 ja' invocado, o Summoned Skull e' oferecido", inv.skullOferecido);
            Check("e ele chega ao campo por Tributo", inv.skullEmCampo);
            Check("a ordem INVERTIDA mudou a compra: veio a carta que estava em 3o",
                  inv.comprou != 0 && inv.comprou == inv.topoEsperado,
                  $"(comprou {inv.comprou}, esperado {inv.topoEsperado}; lista do motor: " +
                  $"{(inv.ordenar == null ? "-" : string.Join(",", inv.ordenar.Select(c => c.code)))})");

            Log.Info("\n=== par CONTROLE: a mesma seed, mantendo a ordem ===\n");
            var man = Rodar(sa, Modo.Manter, inv.seed);
            Check("a mesma mao foi montada", man.montou);
            Check("as mesmas tres cartas vieram para ordenar",
                  man.ordenar != null && inv.ordenar != null
                  && man.ordenar.Select(c => c.code).SequenceEqual(inv.ordenar.Select(c => c.code)));
            Check("manter a ordem compra a carta que JA' estava em cima (a 1a da lista do motor)",
                  man.comprou != 0 && inv.ordenar != null && man.comprou == inv.ordenar[0].code,
                  $"(comprou {man.comprou})");
            Check("e ela e' outra carta que a da ordem invertida", man.comprou != 0 && man.comprou != inv.comprou);

            Log.Info("\n=== par CONTROLE: sem a Card Advance, o Skull nao ganha a 2a invocacao ===\n");
            var sem = Rodar(sa, Modo.SemAtivar, inv.seed);
            Check("a mesma mao foi montada", sem.montou);
            Check("depois da Invocacao-Normal o Summoned Skull NAO e' oferecido",
                  sem.montou && sem.fim == null && !sem.skullOferecido,
                  $"(fim: {sem.fim ?? "-"}; ofereceu: {sem.skullOferecido})");

            return Fim();
        }

        static int Fim()
        {
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Um duelo dirigido pelo jogador HUMANO, o mesmo caminho de `duel.html`.
        /// O oponente não joga (`npc: false`): o teste é sobre as perguntas da
        /// carta, e um NPC ativo encheria as voltas de janelas que não importam.
        /// </summary>
        static Saida Rodar(string sa, Modo modo, ulong seed)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 6; i++) deck.Add(CARD_ADVANCE);
            for (int i = 0; i < 4; i++) deck.Add(SKULL);
            for (int i = 0; i < 30; i++) deck.Add(NV4[i % NV4.Length]);
            var oponente = Enumerable.Repeat(NV4[0], 40).ToArray();

            var s = new Saida { seed = seed };
            using var duel = new InteractiveDuel(sa, deck.ToArray(), seed, 0x1000000UL,
                                                 npc: false, npcDeck: oponente);
            var r = duel.Advance();

            // 0 antes de tudo · 1 Card Advance ativada · 2 pronta para o Nv4 ·
            // 3 Nv4 invocado · 4 pronta para passar o turno · 5 turno passado
            int etapa = 0;

            for (int guard = 0; guard < 600; guard++)
            {
                foreach (var e in r.events)
                {
                    string tipo = Val(e, "type") as string;
                    if (tipo == "end") s.fim = (Val(e, "reason") as string) ?? "o duelo acabou";
                    if (tipo == "move" && Convert.ToUInt32(Val(e, "code") ?? 0u) == SKULL
                        && Convert.ToByte(Val(e, "loc") ?? (byte)0) == LOC_MZONE
                        && Convert.ToByte(Val(e, "controller") ?? (byte)9) == 0)
                        s.skullEmCampo = true;
                    if (tipo == "draw" && etapa == 5 && s.comprou == 0
                        && Convert.ToByte(Val(e, "player") ?? (byte)9) == 0
                        && Val(e, "cards") is IEnumerable cartas)
                    {
                        foreach (var c in cartas) { s.comprou = Convert.ToUInt32(Val(c, "code") ?? 0u); break; }
                    }
                }
                if (s.comprou != 0 || r.ended) return s;

                var q = r.question;
                if (q == null) return s;
                s.kinds.Add(q.kind);

                if (q.kind == "idle" && q.player == 0)
                {
                    if (etapa == 0)
                    {
                        var mao = duel.MaoDoJogador();
                        s.montou = mao.Contains(CARD_ADVANCE) && mao.Contains(SKULL) && mao.Any(c => NV4.Contains(c));
                        if (!s.montou) return s;
                        if (modo == Modo.SemAtivar) etapa = 2;
                        else
                        {
                            var ca = q.activatable.FirstOrDefault(a => a.code == CARD_ADVANCE);
                            if (ca.code == 0) { s.fim = "a Card Advance nao estava ativavel"; return s; }
                            Log.Info($"  > ativando a Card Advance (mao: {string.Join(", ", mao)})");
                            etapa = 1;
                            r = duel.Respond("activate", ca.index);
                            continue;
                        }
                    }
                    if (etapa == 1) { s.fim = "voltou ao idle sem passar pela ordenacao"; return s; }
                    if (etapa == 2)
                    {
                        s.voltouAoIdle = modo != Modo.SemAtivar;
                        var nv4 = q.summonable.FirstOrDefault(a => NV4.Contains(a.code));
                        if (nv4.code == 0) { s.fim = "sem Nv4 invocavel"; return s; }
                        etapa = 3;
                        r = duel.Respond("summon", nv4.index);
                        continue;
                    }
                    if (etapa == 3)
                    {
                        var skull = q.summonable.FirstOrDefault(a => a.code == SKULL);
                        s.skullOferecido = skull.code != 0;
                        if (modo == Modo.SemAtivar) return s;
                        etapa = 4;
                        if (skull.code != 0) { r = duel.Respond("summon", skull.index); continue; }
                    }
                    if (etapa == 4)
                    {
                        etapa = 5;
                        r = duel.Respond("endturn", 0);
                        continue;
                    }
                    s.fim = "chegou ao turno seguinte sem registrar a compra";
                    return s;
                }

                if (q.kind == "announcenumber" && q.player == 0)
                {
                    s.numeros = q.options.ToList();
                    s.numeroDe = q.askCode;
                    int idx = q.options.IndexOf(3UL);
                    if (idx < 0) { s.fim = "3 nao foi oferecido"; return s; }
                    r = duel.Respond("number", idx);
                    continue;
                }

                if (q.kind == "sortcard" && q.player == 0)
                {
                    s.ordenar = q.choices.ToList();
                    s.ordenarDe = q.askCode;
                    int n = q.choices.Count;
                    if (modo == Modo.Inverter)
                    {
                        var torta = duel.Respond("sort", 0, Enumerable.Repeat(0, n).ToList());
                        s.tortaRecusada = ReferenceEquals(torta.question, q)
                                          && torta.events.Any(e => Val(e, "type") as string == "refused");
                    }
                    // Lugar de cada carta NA ORDEM DO MOTOR (0 = em cima): inverter
                    // é mandar a última dele para cima.
                    var lugares = Enumerable.Range(0, n)
                        .Select(i => modo == Modo.Inverter ? n - 1 - i : i).ToList();
                    s.topoEsperado = modo == Modo.Inverter ? q.choices[n - 1].code : q.choices[0].code;
                    Log.Info($"  > ordenando [{string.Join(",", q.choices.Select(c => c.code))}] com lugares [{string.Join(",", lugares)}]");
                    etapa = 2;
                    r = duel.Respond("sort", 0, lugares);
                    continue;
                }

                r = Padrao(duel, q);
            }
            s.fim ??= "o arnes do teste deu 600 voltas";
            return s;
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

        /// <summary>
        /// Os eventos são objetos ANÔNIMOS (o mesmo JSON que vai para o front):
        /// ler por reflexão prova que o campo chega com o NOME que o front procura.
        /// </summary>
        static object Val(object e, string nome) => e?.GetType().GetProperty(nome)?.GetValue(e);
    }
}
