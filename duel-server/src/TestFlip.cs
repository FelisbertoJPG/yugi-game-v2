using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// A Invocacao-Virar (flip summon) — `--test-flip`.
    ///
    /// O relato foi: *"clico num monstro virado e nao acontece nada; no turno
    /// seguinte clico de novo e ele vira para cima em DEFESA"*. As duas metades
    /// sao o MESMO defeito, e ele nao era do cliente.
    ///
    /// A Invocacao-Virar **nao emite MSG_POS_CHANGE**. O core troca a posicao
    /// sozinho (`current.position = POS_FACEUP_ATTACK`) e so' entao escreve o
    /// MSG_FLIPSUMMONING (64) — que ninguem traduzia em evento. Do lado de fora
    /// o duelo andava e a tela nao: a carta continuava desenhada de costas, e o
    /// clique seguinte — que o cliente ainda achava ser uma virada — caia no
    /// reposition de verdade, deitando o monstro em DEFESA face-up. Nenhum erro,
    /// nem no console nem no log.
    ///
    /// O que se prova aqui e' o EVENTO que sai para `web/duel.html`, porque e'
    /// ele que a tela desenha:
    ///
    ///   1. virar um monstro setado emite `pos` com `flip: true` e a carta ABERTA
    ///      em ATAQUE (0x1), com o codigo real — sem o codigo a arte nao aparece;
    ///   2. o par CONTROLE: o MESMO comando num monstro que ja' esta' com a face
    ///      para cima emite `pos` SEM `flip`, e deita em DEFESA (0x4). Sem este
    ///      par, "veio um evento pos" nao provaria nada — era exatamente o evento
    ///      errado que chegava antes.
    /// </summary>
    public static class TestFlip
    {
        // Normais Nv4 sem efeito: o teste e' sobre a POSICAO, e uma carta com
        // efeito de virar (Man-Eater Bug) encheria a volta de perguntas.
        const uint BATTLE_OX = 5053103;      // Normal Nv4 1700/1000
        const uint MYSTICAL_ELF = 15025844;  // Normal Nv4 800/2000

        const byte LOC_MZONE = 0x4;
        const int POS_FACEUP_ATK = 0x1, POS_FACEUP_DEF = 0x4, POS_FACEDOWN_DEF = 0x8;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Invocacao-Virar: o monstro setado abre em ATAQUE ===\n");
            var virada = Rodar(sa, virarSetado: true);
            Check("o motor ofereceu a virada (o monstro entrou em `repositionable`)",
                  virada.ofereceu,
                  "(monstro SETADO neste turno nao e' oferecido — o duelo nao chegou ao turno seguinte)");
            Check("o comando `reposition` gerou um evento `pos` para a tela", virada.evento != null,
                  "(MSG_FLIPSUMMONING sem traducao: o duelo anda no servidor e a tela fica parada)");
            Check("o evento veio marcado como `flip` (Invocacao-Virar, nao troca de posicao)",
                  virada.evento?.flip == true);
            Check("a carta abriu com a face para cima em ATAQUE (0x1)",
                  virada.evento?.pos == POS_FACEUP_ATK,
                  $"(veio 0x{virada.evento?.pos:x} — 0x4 e' o sintoma antigo: deitou em defesa)");
            Check("o evento traz o CODIGO real (sem ele a arte nao aparece na zona)",
                  virada.evento != null && virada.evento.code != 0,
                  $"(veio {virada.evento?.code})");
            Check("e aponta a zona de monstro do proprio jogador",
                  virada.evento?.loc == LOC_MZONE && virada.evento?.controller == 0,
                  $"(loc 0x{virada.evento?.loc:x} ctrl {virada.evento?.controller})");
            Check("antes da virada a carta estava mesmo virada para baixo",
                  virada.posAntes == POS_FACEDOWN_DEF, $"(posAntes 0x{virada.posAntes:x})");

            Log.Info("\n=== par CONTROLE: o mesmo comando num monstro ja' aberto ===\n");
            var deitada = Rodar(sa, virarSetado: false);
            Check("o motor ofereceu a mudanca de posicao", deitada.ofereceu);
            Check("o comando gerou um evento `pos`", deitada.evento != null);
            Check("e ele NAO e' um `flip` (a carta ja' estava com a face para cima)",
                  deitada.evento != null && deitada.evento.flip != true);
            Check("o monstro deitou em DEFESA face-up (0x4)",
                  deitada.evento?.pos == POS_FACEUP_DEF, $"(veio 0x{deitada.evento?.pos:x})");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        sealed class Evento
        {
            public uint code; public byte controller, loc; public int seq, pos; public bool? flip;
        }

        sealed class Saida
        {
            public bool ofereceu;
            public Evento evento;
            public int posAntes = -1;
        }

        /// <summary>
        /// Um duelo dirigido pelo jogador HUMANO (`Respond`) — o mesmo caminho de
        /// `web/duel.html`. `virarSetado` escolhe qual das duas jogadas exercitar:
        /// baixar um monstro virado e vira-lo depois, ou invoca-lo aberto e deita-lo.
        /// </summary>
        static Saida Rodar(string sa, bool virarSetado)
        {
            var deck = new List<uint>();
            while (deck.Count < 40) deck.Add(deck.Count % 2 == 0 ? BATTLE_OX : MYSTICAL_ELF);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 20260823UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            var saida = new Saida();
            bool entrou = false;      // ja' pus o corpo em campo
            int seqDoCorpo = -1;
            bool mandouVirar = false;

            for (int guard = 0; guard < 400 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var mv = Ler(e, "move");
                    if (mv != null && mv.loc == LOC_MZONE && mv.controller == 0)
                    {
                        entrou = true; seqDoCorpo = mv.seq; saida.posAntes = mv.pos;
                    }
                    if (!mandouVirar) continue;
                    var pos = Ler(e, "pos");
                    if (pos != null && pos.loc == LOC_MZONE && pos.controller == 0
                        && pos.seq == seqDoCorpo && saida.evento == null)
                        saida.evento = pos;
                }
                if (saida.evento != null) break;

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    // O corpo ja' esta' em campo: procura a oferta de posicao. Ela
                    // so' aparece no turno SEGUINTE — quem decide isso e' o motor,
                    // e e' por isso que o duelo precisa dar essa volta.
                    if (entrou)
                    {
                        var alvo = q.repositionable
                            .FirstOrDefault(a => a.location == LOC_MZONE && a.sequence == seqDoCorpo);
                        if (alvo.code != 0)
                        {
                            saida.ofereceu = true;
                            mandouVirar = true;
                            Log.Info($"  > mandando reposition na zona M{seqDoCorpo} (carta {alvo.code})");
                            r = duel.Respond("reposition", alvo.index);
                            continue;
                        }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    // Ainda sem corpo: baixa um. Virado (mset) ou aberto (summon),
                    // conforme o caso que este duelo esta' provando.
                    var lista = virarSetado ? q.settable : q.summonable;
                    if (lista.Count > 0)
                    {
                        r = duel.Respond(virarSetado ? "setmonster" : "summon", lista[0].index);
                        continue;
                    }
                    r = duel.Respond("endturn", 0);
                    continue;
                }

                r = Padrao(duel, q);
            }
            return saida;
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
        /// Os eventos sao objetos ANONIMOS (o mesmo JSON que vai para o front), entao
        /// a leitura e' por reflexao — de proposito: ler o objeto real prova que o
        /// campo chega com o NOME que o front procura.
        /// </summary>
        static Evento Ler(object e, string tipo)
        {
            var t = e.GetType();
            if ((t.GetProperty("type")?.GetValue(e) as string) != tipo) return null;
            var flip = t.GetProperty("flip")?.GetValue(e);
            return new Evento
            {
                code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u),
                controller = Convert.ToByte(t.GetProperty("controller")?.GetValue(e) ?? (byte)0),
                loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0),
                seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? 0),
                pos = Convert.ToInt32(t.GetProperty("pos")?.GetValue(e) ?? 0),
                flip = flip == null ? (bool?)null : Convert.ToBoolean(flip),
            };
        }
    }
}
