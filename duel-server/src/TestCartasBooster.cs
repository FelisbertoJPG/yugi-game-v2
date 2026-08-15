using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação das cartas que os BOOSTERS já vendiam e a Lista 1 não
    /// conhecia — `--test-cartas-booster`.
    ///
    /// Como elas apareceram: o Booster Builder monta o pacote a partir do banco
    /// INTEIRO, não do pool da Lista 1. Uma carta posta num booster é aberta pelo
    /// jogador, entra na Coleção, aparece no Deck Builder — e só na hora de
    /// SALVAR o deck é que `salvar_deck` diz "não está na lista permitida". O
    /// jogador paga DP por uma carta que não pode jogar, e nada acusa isso antes.
    ///
    /// São quatro, todas com Lua pronto no ocgcore:
    ///
    ///   DE-SPELL           destrói 1 Magia com a face para cima, ou 1
    ///                      Magia/Armadilha SETADA (revelando-a)
    ///   RITUAL CAGE        Magia Contínua: seus Rituais não sofrem dano de
    ///                      batalha nem são alvo/destruídos por efeito de monstro
    ///   BIRTHRIGHT         Armadilha Contínua: Invoca Especialmente 1 Normal do
    ///                      SEU cemitério; a carta e o monstro morrem juntos
    ///   SWING OF MEMORIES  o mesmo, pela mão, mas o monstro é destruído na End
    ///                      Phase deste turno
    ///
    /// O que este arquivo prova é a pergunta que o pedido faz: **o efeito roda e
    /// o front sabe desenhar o que o motor pede**. Por isso os três duelos são
    /// dirigidos pelo jogador HUMANO (`Respond`), que é exatamente o caminho de
    /// `web/duel.html`, e não pelo `NpcBrain` — e por isso toda pergunta que
    /// aparece é conferida contra a lista de `kind` que o front sabe desenhar.
    /// Uma carta que pedisse uma pergunta fora dessa lista viraria, na tela,
    /// "⚠ ação não suportada ainda — comece um novo duelo": duelo perdido no
    /// meio, sem erro nenhum no servidor.
    /// </summary>
    public static class TestCartasBooster
    {
        const uint DE_SPELL = 19159413;
        const uint RITUAL_CAGE = 25796442;
        const uint BIRTHRIGHT = 35539880;
        const uint SWING = 96765646;

        // Corpos Normais (vanilla) para encher o cemitério: o Nv7 pede 2
        // tributos, e é o tributo — não o combate — que põe Normal no cemitério
        // num duelo sem oponente. Mesma saída do `--test-grave`.
        const uint BATTLE_OX = 5053103;      // Normal Nv4 1700/1000
        const uint MYSTICAL_ELF = 15025844;  // Normal Nv4 800/2000
        const uint GAIA_NV7 = 6368038;       // Normal Nv7 2300/2100 — 2 tributos

        const byte LOC_HAND = 0x2, LOC_MZONE = 0x4, LOC_SZONE = 0x8, LOC_GRAVE = 0x10;

        // Tipos do `cards.cdb` (os mesmos do ocgcore).
        const uint TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_CONTINUOUS = 0x20000;

        /// <summary>
        /// Os `kind` de pergunta que `web/duel.html` sabe desenhar. Levantado do
        /// próprio front (as comparações `question.kind === …` de lá); `unsupported`
        /// fica FORA de propósito — é justamente o balde do que ninguém tratou.
        /// </summary>
        static readonly HashSet<string> DO_FRONT = new()
        {
            "idle", "battle", "place", "position", "chain", "yesno", "option",
            "selectcard", "selecttribute", "selectunselect", "selectsum",
        };

        static readonly HashSet<string> _vistos = new();
        static readonly HashSet<string> _foraDoFront = new();

        static int _pass, _fail;
        static bool DIAG = Environment.GetEnvironmentVariable("DIAG") == "1";

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        /// <summary>Anota o `kind` da pergunta antes de respondê-la.</summary>
        static void Anotar(InteractiveDuel.Question q)
        {
            if (q == null) return;
            _vistos.Add(q.kind);
            if (!DO_FRONT.Contains(q.kind)) _foraDoFront.Add($"{q.kind}(msg {q.rawType})");
        }

        public static int Run(string sa)
        {
            Log.Info("=== o banco e o Lua das 4 cartas ===\n");
            OBanco(sa);
            Log.Info("\n=== Swing of Memories: o Normal volta do cemiterio (magia da mao) ===\n");
            SwingOfMemories(sa);
            Log.Info("\n=== Birthright: o mesmo pela armadilha continua, ativada DO CAMPO ===\n");
            Birthright(sa);
            Log.Info("\n=== Ritual Cage fica em campo e a De-Spell a destroi ===\n");
            CageEDeSpell(sa);
            Log.Info("\n=== o front sabe desenhar tudo que o motor pediu ===\n");
            OFront();
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- o banco

        /// <summary>
        /// Preparo, e não é formalidade: se a carta não estiver no `cards.cdb` do
        /// motor (ou o `.lua` não estiver na pasta que o `ScriptManager` mapeia),
        /// ela simplesmente nunca aparece em `activatable` — e os duelos abaixo
        /// falhariam com "nunca ficou ativável", que não diz por quê.
        /// </summary>
        static void OBanco(string sa)
        {
            using var db = new DatabaseManager(sa);
            string pastaLua = Path.Combine(sa, "YGODemo", "script");

            void Confere(uint code, string nome, uint tipoBase, bool continua)
            {
                var s = db.Stats(code);
                Check($"{nome} ({code}) esta no cards.cdb do motor", s.Type != 0,
                      "(o motor le o proprio banco, nao o ygo-data/data)");
                Check($"{nome} e' {(tipoBase == TYPE_SPELL ? "Magia" : "Armadilha")}" +
                      (continua ? " CONTINUA" : ""),
                      (s.Type & tipoBase) != 0 && ((s.Type & TYPE_CONTINUOUS) != 0) == continua,
                      $"(type 0x{s.Type:x})");

                bool temLua = Directory.Exists(pastaLua)
                    && Directory.EnumerateFiles(pastaLua, $"c{code}.lua", SearchOption.AllDirectories).Any();
                Check($"{nome} tem script Lua (nenhum efeito precisa ser escrito a mao)", temLua,
                      $"(procurei c{code}.lua em {pastaLua})");
            }

            Confere(DE_SPELL, "De-Spell", TYPE_SPELL, continua: false);
            Confere(RITUAL_CAGE, "Ritual Cage", TYPE_SPELL, continua: true);
            Confere(BIRTHRIGHT, "Birthright", TYPE_TRAP, continua: true);
            Confere(SWING, "Swing of Memories", TYPE_SPELL, continua: false);
        }

        // -------------------------------------------------- Swing of Memories

        static void SwingOfMemories(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 10; i++) deck.Add(SWING);
            for (int i = 0; i < 8; i++) deck.Add(GAIA_NV7);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF };
            while (deck.Count < 40) deck.Add(lv4[deck.Count % lv4.Length]);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 20260814UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool ativou = false, reviveu = false, morreuNaEndPhase = false;
            bool alvoVeioDoCemiterio = false;
            uint codigoRevivido = 0;
            var cemiterio = new List<uint>();

            for (int guard = 0; guard < 500 && !r.ended && !morreuNaEndPhase; guard++)
            {
                foreach (var e in r.events)
                {
                    if (!EhMove(e, out uint code, out byte loc, out byte from, out byte ctrl, out byte fromCtrl))
                        continue;
                    if (loc == LOC_GRAVE && ctrl == 0) cemiterio.Add(code);
                    if (from == LOC_GRAVE && loc == LOC_MZONE && fromCtrl == 0 && code != 0)
                    {
                        reviveu = true; codigoRevivido = code;
                        Log.Info($"  > {code} saiu do cemiterio para a zona de monstro");
                    }
                    // A destruição na End Phase É o efeito da carta (o corpo vale
                    // um turno só). Sem esta conferência, um Swing que revivesse
                    // DE GRAÇA passaria no teste — e seria bem melhor que a carta.
                    else if (reviveu && code == codigoRevivido
                             && from == LOC_MZONE && loc == LOC_GRAVE && fromCtrl == 0)
                    {
                        morreuNaEndPhase = true;
                        Log.Info($"  > {code} foi destruido (End Phase), como a carta manda");
                    }
                }
                if (morreuNaEndPhase) break;

                var q = r.question;
                if (q == null) break;
                Anotar(q);

                switch (q.kind)
                {
                    case "idle":
                    {
                        var swing = q.activatable.FirstOrDefault(a => a.code == SWING);
                        var nv7 = q.summonable.FirstOrDefault(a => a.code == GAIA_NV7);
                        // Já reviveu: só passar o turno, que é o que leva à End Phase.
                        if (reviveu) { r = duel.Respond("endturn", 0); break; }

                        if (swing.code == SWING)
                        {
                            ativou = true;
                            Log.Info("  > Swing of Memories ativavel (ha Normal no cemiterio)");
                            r = duel.Respond("activate", swing.index);
                        }
                        else if (nv7.code == GAIA_NV7) r = duel.Respond("summon", nv7.index);
                        // Para de invocar assim que há alvo no cemitério: a carta
                        // exige zona de monstro LIVRE (`GetLocationCount>0`), então
                        // encher o campo a deixaria fora de `activatable` para
                        // sempre — foi assim que o `--test-grave` travou na 1ª versão.
                        else if (!TemNormal(cemiterio) && q.summonable.Count > 0)
                            r = duel.Respond("summon", q.summonable[0].index);
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "selectcard":
                        // O alvo do Swing vem do CEMITÉRIO (0x10). É o que o front
                        // precisa saber para desenhar a escolha na pilha certa.
                        if (q.choices.Count > 0 && q.choices[0].location == LOC_GRAVE)
                            alvoVeioDoCemiterio = true;
                        r = Escolher(duel, q);
                        break;
                    default:
                        r = Padrao(duel, q);
                        break;
                }
            }

            Check("o motor ofereceu a Swing of Memories para ativar", ativou,
                  "(nunca entrou em `activatable` — sem Normal no cemiterio ou sem zona livre)");
            Check("o alvo foi oferecido a partir do CEMITERIO (loc 0x10)", alvoVeioDoCemiterio);
            Check($"um monstro Normal voltou do cemiterio para o campo (codigo {codigoRevivido})", reviveu);
            Check("e foi destruido na End Phase, como a carta manda", morreuNaEndPhase,
                  "(o corpo ficou em campo de graca — o efeito continuo nao registrou)");
        }

        // ---------------------------------------------------------- Birthright

        /// <summary>
        /// Mesma prova do Swing, mas pelo caminho da ARMADILHA: setar no campo,
        /// esperar o turno virar e ativar. E a ativação NÃO aparece no `idle` —
        /// vem numa janela de CORRENTE, porque o efeito é `EVENT_FREE_CHAIN`.
        /// Foi essa a descoberta do `--test-grave` com o Call of the Haunted, e é
        /// o que o front desenha no overlay de corrente.
        /// </summary>
        static void Birthright(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 10; i++) deck.Add(BIRTHRIGHT);
            for (int i = 0; i < 8; i++) deck.Add(GAIA_NV7);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF };
            while (deck.Count < 40) deck.Add(lv4[deck.Count % lv4.Length]);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 31337UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool setou = false, ativouDoCampo = false, reviveu = false;
            byte locDaAtivacao = 0;
            uint codigoRevivido = 0;
            var cemiterio = new List<uint>();

            for (int guard = 0; guard < 500 && !r.ended && !reviveu; guard++)
            {
                foreach (var e in r.events)
                {
                    if (!EhMove(e, out uint code, out byte loc, out byte from, out byte ctrl, out byte fromCtrl))
                        continue;
                    if (loc == LOC_GRAVE && ctrl == 0) cemiterio.Add(code);
                    if (from == LOC_GRAVE && loc == LOC_MZONE && fromCtrl == 0 && code != 0)
                    {
                        reviveu = true; codigoRevivido = code;
                        Log.Info($"  > {code} saiu do cemiterio para a zona de monstro");
                    }
                }
                if (reviveu) break;

                var q = r.question;
                if (q == null) break;
                Anotar(q);

                switch (q.kind)
                {
                    case "idle":
                    {
                        var setar = q.settableST.FirstOrDefault(a => a.code == BIRTHRIGHT);
                        var nv7 = q.summonable.FirstOrDefault(a => a.code == GAIA_NV7);

                        if (DIAG)
                            Log.Info($"  [diag] idle ativaveis=[" +
                                     string.Join(",", q.activatable.Select(a => $"{a.code}@0x{a.location:x}")) +
                                     $"] setavelST={q.settableST.Count} cemiterio={cemiterio.Count}");

                        if (!setou && setar.code == BIRTHRIGHT)
                        {
                            setou = true;
                            Log.Info("  > setando a Birthright");
                            r = duel.Respond("setspell", setar.index);
                        }
                        else if (nv7.code == GAIA_NV7) r = duel.Respond("summon", nv7.index);
                        else if (!TemNormal(cemiterio) && q.summonable.Count > 0)
                            r = duel.Respond("summon", q.summonable[0].index);
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "chain":
                    {
                        var alvo = q.choices.FirstOrDefault(c => c.code == BIRTHRIGHT);
                        if (alvo.code == BIRTHRIGHT)
                        {
                            ativouDoCampo = true;
                            locDaAtivacao = alvo.location;
                            Log.Info($"  > Birthright na CORRENTE (location 0x{alvo.location:x})");
                            r = duel.Respond("chain", alvo.index);
                        }
                        else r = duel.Respond("chain", -1);
                        break;
                    }
                    default:
                        r = Padrao(duel, q);
                        break;
                }
            }

            Check("a armadilha foi setada", setou);
            Check("ela ficou ativavel A PARTIR DO CAMPO (nao da mao)", ativouDoCampo,
                  "(nunca apareceu na janela de corrente)");
            Check("a ativacao veio da zona de magia/armadilha (loc 0x8)", locDaAtivacao == LOC_SZONE,
                  $"(veio 0x{locDaAtivacao:x})");
            Check($"um monstro Normal voltou do cemiterio para o campo (codigo {codigoRevivido})", reviveu);
        }

        // --------------------------------------------------- Cage + De-Spell

        /// <summary>
        /// As duas juntas, e não é economia de arquivo: a De-Spell precisa de uma
        /// Magia NA MESA para ter alvo, e num duelo sem oponente a única magia que
        /// fica em campo é uma CONTÍNUA nossa. A Ritual Cage é exatamente isso —
        /// então uma prova a outra. A Cage prova que fica (o front tem de
        /// desenhá-la na zona), a De-Spell prova que sai.
        ///
        /// O Lua da De-Spell aceita alvo dos DOIS lados
        /// (`IsExistingTarget(..., tp, LOCATION_SZONE, LOCATION_SZONE, ...)`),
        /// menos ela própria (`chkc ~= e:GetHandler()`).
        /// </summary>
        static void CageEDeSpell(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 10; i++) deck.Add(RITUAL_CAGE);
            for (int i = 0; i < 10; i++) deck.Add(DE_SPELL);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF };
            while (deck.Count < 40) deck.Add(lv4[deck.Count % lv4.Length]);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 90210UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool cageEmCampo = false, ofereceuCageComoAlvo = false, cageDestruida = false;
            bool ativouDeSpell = false;
            byte locDoAlvo = 0;

            for (int guard = 0; guard < 500 && !r.ended && !cageDestruida; guard++)
            {
                foreach (var e in r.events)
                {
                    if (!EhMove(e, out uint code, out byte loc, out byte from, out byte ctrl, out byte fromCtrl))
                        continue;
                    if (code == RITUAL_CAGE && loc == LOC_SZONE && ctrl == 0 && from == LOC_HAND)
                    {
                        cageEmCampo = true;
                        Log.Info("  > Ritual Cage entrou na zona de magia/armadilha (continua, fica la')");
                    }
                    else if (code == RITUAL_CAGE && from == LOC_SZONE && loc == LOC_GRAVE && fromCtrl == 0)
                    {
                        cageDestruida = true;
                        Log.Info("  > Ritual Cage foi destruida pela De-Spell (0x8 -> 0x10)");
                    }
                }
                if (cageDestruida) break;

                var q = r.question;
                if (q == null) break;
                Anotar(q);

                switch (q.kind)
                {
                    case "idle":
                    {
                        var cage = q.activatable.FirstOrDefault(a => a.code == RITUAL_CAGE);
                        var despell = q.activatable.FirstOrDefault(a => a.code == DE_SPELL);

                        if (DIAG)
                            Log.Info($"  [diag] idle ativaveis=[" +
                                     string.Join(",", q.activatable.Select(a => $"{a.code}@0x{a.location:x}")) +
                                     $"] cageEmCampo={cageEmCampo}");

                        // A ordem importa: sem a Cage na mesa a De-Spell não tem
                        // alvo, e o motor nem a oferece.
                        if (!cageEmCampo && cage.code == RITUAL_CAGE)
                        {
                            Log.Info("  > ativando a Ritual Cage");
                            r = duel.Respond("activate", cage.index);
                        }
                        else if (cageEmCampo && despell.code == DE_SPELL)
                        {
                            ativouDeSpell = true;
                            Log.Info("  > ativando a De-Spell");
                            r = duel.Respond("activate", despell.index);
                        }
                        else r = duel.Respond("endturn", 0);
                        break;
                    }
                    case "selectcard":
                    {
                        var alvo = q.choices.FirstOrDefault(c => c.code == RITUAL_CAGE);
                        if (alvo.code == RITUAL_CAGE)
                        {
                            ofereceuCageComoAlvo = true;
                            locDoAlvo = alvo.location;
                            r = duel.Respond("select", 0, new List<int> { alvo.index });
                        }
                        else r = Escolher(duel, q);
                        break;
                    }
                    default:
                        r = Padrao(duel, q);
                        break;
                }
            }

            Check("a Ritual Cage ficou na zona de magia/armadilha (Magia Continua)", cageEmCampo);
            Check("o motor ofereceu a De-Spell para ativar", ativouDeSpell,
                  "(sem magia na mesa ela nao tem alvo e nao e' oferecida)");
            Check("a De-Spell ofereceu a Cage como alvo, na zona de magia (loc 0x8)",
                  ofereceuCageComoAlvo && locDoAlvo == LOC_SZONE, $"(loc 0x{locDoAlvo:x})");
            Check("e a Cage foi destruida de verdade (0x8 -> cemiterio)", cageDestruida);
        }

        // -------------------------------------------------------------- front

        static void OFront()
        {
            Log.Info($"  perguntas que o motor fez: [{string.Join(", ", _vistos.OrderBy(x => x))}]");
            Check("nenhuma pergunta fora do que web/duel.html sabe desenhar",
                  _foraDoFront.Count == 0,
                  $"(o front mostraria \"acao nao suportada\" em: {string.Join(", ", _foraDoFront)})");
            // Guarda contra o teste passar sem ter exercitado nada: se o duelo
            // morresse na primeira volta, `_vistos` teria só "idle" e todo o
            // resto acima falharia — mas o Check de cima passaria, sozinho.
            Check("as escolhas de carta e a janela de corrente foram mesmo exercitadas",
                  _vistos.Contains("selectcard") && _vistos.Contains("chain"),
                  $"(vistos: {string.Join(", ", _vistos)})");
        }

        // ---------------------------------------------------------- utilidades

        /// <summary>
        /// Lê um evento `move` (anônimo, por reflexão — é o mesmo objeto que vai
        /// para o front como JSON).
        /// </summary>
        static bool EhMove(object e, out uint code, out byte loc, out byte from,
                           out byte ctrl, out byte fromCtrl)
        {
            code = 0; loc = 0; from = 0; ctrl = 0; fromCtrl = 0;
            var t = e.GetType();
            if ((t.GetProperty("type")?.GetValue(e) as string) != "move") return false;
            code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
            loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
            from = Convert.ToByte(t.GetProperty("fromLoc")?.GetValue(e) ?? (byte)0);
            ctrl = Convert.ToByte(t.GetProperty("controller")?.GetValue(e) ?? (byte)0);
            fromCtrl = Convert.ToByte(t.GetProperty("fromCtrl")?.GetValue(e) ?? (byte)0);
            return true;
        }

        static bool TemNormal(List<uint> cemiterio) =>
            cemiterio.Any(c => c == BATTLE_OX || c == MYSTICAL_ELF || c == GAIA_NV7);

        static InteractiveDuel.Result Escolher(InteractiveDuel duel, InteractiveDuel.Question q) =>
            duel.Respond("select", 0,
                q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());

        /// <summary>
        /// A resposta "mais simples possível" para tudo que não é o alvo do teste.
        /// Vale para os três duelos, então mora num lugar só.
        /// </summary>
        static InteractiveDuel.Result Padrao(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            switch (q.kind)
            {
                case "place": return duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                case "position": return duel.Respond("position", 0x1);
                case "yesno": return duel.Respond("yesno", 1);
                case "option": return duel.Respond("option", 0);
                case "battle": return duel.Respond("endbattle", 0);
                case "chain": return duel.Respond("chain", -1);
                case "selectcard":
                case "selecttribute":
                case "selectsum": return Escolher(duel, q);
                case "selectunselect":
                    return q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index);
                case "unsupported":
                    Log.Err($"  > MENSAGEM NAO SUPORTADA: tipo bruto {q.rawType}");
                    return duel.Respond("endturn", 0);
                default: return duel.Respond("endturn", 0);
            }
        }
    }
}
