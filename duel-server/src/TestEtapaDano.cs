using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// A ETAPA DE DANO — `--test-etapa-dano`.
    ///
    /// O relato foi: *"a fase de batalha e a etapa de dano nao estao bem
    /// definidas; no Yu-Gi-Oh o fluxo e' declarar o ataque, escolher quem ataca
    /// e em quem, virar o monstro que estava com a face para baixo, abrir uma
    /// janela de respostas, colidir e so' entao calcular o dano"*.
    ///
    /// O motor faz tudo isso — e mandava tres dessas fronteiras para o vazio.
    /// `MSG_ATTACK_DISABLED (112)`, `MSG_DAMAGE_STEP_START (113)` e
    /// `MSG_DAMAGE_STEP_END (114)` nao tinham `case` nenhum: o laco de mensagens
    /// anda pelo tamanho declarado de cada uma, entao elas eram puladas EM
    /// SILENCIO — sem erro, sem log — e a tela via o ataque como UM instante: a
    /// seta aparecia e o resultado ja' estava na mesa.
    ///
    /// O que se prova aqui e' a SEQUENCIA que sai para `web/duel.html`, porque
    /// e' dela que a tela tira o ritmo. Sao tres duelos:
    ///
    ///   **A — o alvo esta' VIRADO.** `attack` (a declaracao) vem ANTES de
    ///   `damagestep:inicio` — se viessem juntos nao haveria onde caber a janela
    ///   de resposta —, o alvo abre DENTRO da etapa de dano (um `pos` entre o
    ///   inicio e o `battle`, que e' a regra do jogo e a unica chance de a tela
    ///   mostrar a carta antes do golpe), e o `battle` (o calculo) cai entre o
    ///   inicio e o fim.
    ///
    ///   **B — par CONTROLE, o ataque DIRETO.** Nao ha' alvo para virar nem com
    ///   quem colidir, mas a etapa de dano existe igual e e' dentro dela que o
    ///   `lp` chega. Sem este par, uma leitura que so' funcionasse com monstro
    ///   do outro lado passaria batida.
    ///
    ///   **C — o ataque ANULADO.** O jogador baixa uma Negate Attack, o NPC
    ///   ataca, e a janela de resposta chega ao front com
    ///   `chainTriggerKind = "attack"` e o codigo do ATACANTE. Ativada, o motor
    ///   manda MSG_ATTACK_DISABLED e **nao ha' etapa de dano nenhuma**. Sao as
    ///   duas metades que faltavam: sem o gatilho, a unica frase honesta na
    ///   janela mais importante do duelo era a da fase (*"seu oponente esta'
    ///   indo para a Battle Step"*); sem o `attackcancel`, anular um ataque e'
    ///   indistinguivel, na tela, de um ataque que ninguem declarou — a seta
    ///   some, nenhum LP muda, e quem gastou a carta nao ve nada acontecer.
    ///
    /// Os tres duelos sao dirigidos pelo JOGADOR (`Respond`), o mesmo caminho de
    /// `web/duel.html`: e' o unico lado de onde da' para OLHAR a etapa de dano
    /// enquanto ela acontece — o turno inteiro do NPC resolve dentro de um
    /// `Respond` so'.
    /// </summary>
    public static class TestEtapaDano
    {
        const uint OX = 5053103;              // Normal Nv4 1700/1000
        const uint CELTIC = 91152256;         // Normal Nv4 1400/1200
        const uint NEGATE_ATTACK = 14315573;  // Armadilha de Contra: anula o ataque
        const byte LOC_MZONE = 0x4;
        const int POS_FACEDOWN_DEF = 0x8;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== A. a etapa de dano contra um monstro VIRADO ===\n");
            var v = Atacando(sa, comAlvo: true);
            Log.Info($"\n  > sequencia: {string.Join(" -> ", v.trilha)}\n");

            Check("o ataque foi declarado (evento `attack`)", v.iAttack >= 0);
            Check("a etapa de dano ABRIU (MSG_DAMAGE_STEP_START chegou traduzido)",
                  v.iInicio >= 0,
                  "(sem o case 113 a mensagem e' pulada em silencio e a tela nao tem onde separar os dois momentos)");
            Check("a declaracao vem ANTES da etapa de dano",
                  v.iAttack >= 0 && v.iInicio > v.iAttack,
                  $"(attack={v.iAttack} inicio={v.iInicio})");
            Check("a etapa de dano FECHOU (MSG_DAMAGE_STEP_END)", v.iFim >= 0);
            Check("o calculo (`battle`) esta' DENTRO da etapa de dano",
                  v.iBattle > v.iInicio && v.iBattle < v.iFim,
                  $"(inicio={v.iInicio} battle={v.iBattle} fim={v.iFim})");
            Check("o alvo estava mesmo com a face para baixo antes do ataque",
                  v.alvoEstavaVirado, "(sem isso a virada abaixo nao provaria nada)");
            Check("o alvo VIRADO abriu dentro da etapa de dano, ANTES do calculo",
                  v.iFlip > v.iInicio && v.iBattle > 0 && v.iFlip < v.iBattle,
                  $"(inicio={v.iInicio} pos={v.iFlip} battle={v.iBattle})");
            Check("e abriu com o CODIGO real — sem ele a arte nao aparece",
                  v.codeDoFlip != 0, $"(veio {v.codeDoFlip})");

            Log.Info("\n=== B. par CONTROLE: o ataque DIRETO ===\n");
            var dir = Atacando(sa, comAlvo: false);
            Log.Info($"\n  > sequencia: {string.Join(" -> ", dir.trilha)}\n");
            Check("o ataque foi declarado como DIRETO", dir.iAttack >= 0 && dir.direto,
                  $"(attack={dir.iAttack} direto={dir.direto})");
            Check("ele TAMBEM abre e fecha a etapa de dano",
                  dir.iInicio > dir.iAttack && dir.iFim > dir.iInicio,
                  $"(attack={dir.iAttack} inicio={dir.iInicio} fim={dir.iFim})");
            Check("o dano cai dentro dela",
                  dir.iDano > dir.iInicio && dir.iDano < dir.iFim,
                  $"(inicio={dir.iInicio} lp={dir.iDano} fim={dir.iFim})");
            // MEDIDO, e ao contrario do que a intuicao diz: o ataque direto TEM
            // MSG_BATTLE. O motor manda o calculo com o lado do defensor
            // ZERADO — e e' por isso que a tela nao pode desenhar o quadro do
            // defensor a partir da existencia do evento: ela mostraria um
            // adversario de 0 de ATK apanhando, no ataque que nao tem alvo.
            Check("o calculo chega mesmo assim, com o lado do defensor ZERADO",
                  dir.iBattle > dir.iInicio && dir.defDoCalculo == 0,
                  $"(battle={dir.iBattle} atacante={dir.atkDoCalculo} defensor={dir.defDoCalculo})");
            Check("e o atacante aparece com o ATK dele", dir.atkDoCalculo > 0,
                  $"(veio {dir.atkDoCalculo})");

            Log.Info("\n=== C. o ataque ANULADO (a janela de resposta usada) ===\n");
            var an = Defendendo(sa);
            Log.Info($"\n  > sequencia: {string.Join(" -> ", an.trilha)}\n");
            Check("o NPC declarou um ataque", an.iAttack >= 0);
            Check("a janela de resposta abriu para o jogador", an.abriuJanela,
                  "(sem ela nao ha' o que rotular — nem como anular nada)");
            Check("e ela diz que foi um ATAQUE que a abriu",
                  an.gatilhoKind == "attack",
                  $"(veio \"{an.gatilhoKind}\" — vazio faz a tela cair na frase da fase)");
            Check("nomeando o ATACANTE", an.gatilhoCode != 0, $"(veio {an.gatilhoCode})");
            Check("e o jogador certo: quem declarou foi o oponente",
                  an.gatilhoPlayer == 1, $"(veio {an.gatilhoPlayer})");
            Check("ativada a Negate Attack, o ataque foi ANULADO (`attackcancel`)",
                  an.iCancel >= 0,
                  "(sem o case 112 a seta some e nada explica por que o golpe nao veio)");
            Check("o cancelamento vem DEPOIS da declaracao",
                  an.iAttack >= 0 && an.iCancel > an.iAttack,
                  $"(attack={an.iAttack} cancel={an.iCancel})");
            Check("e nao houve etapa de dano nenhuma — o ataque nao chegou la'",
                  an.iInicio < 0 && an.iBattle < 0,
                  $"(inicio={an.iInicio} battle={an.iBattle})");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        sealed class Saida
        {
            public readonly List<string> trilha = new();
            public int iAttack = -1, iInicio = -1, iFim = -1, iBattle = -1, iDano = -1,
                       iFlip = -1, iCancel = -1;
            public uint codeDoFlip;
            public int atkDoCalculo = -1, defDoCalculo = -1;
            public bool alvoEstavaVirado, direto, abriuJanela;
            public string gatilhoKind = "";
            public uint gatilhoCode;
            public int gatilhoPlayer = -2;
            public int passo;
        }

        /// <summary>
        /// **A e B.** O JOGADOR ataca. Com `comAlvo` o NPC joga de verdade e poe
        /// um corpo em campo antes (o ataque cai nele); sem ele o cerebro fica
        /// desligado, o outro lado so' encerra os turnos, e o campo vazio e' o
        /// que torna o ataque DIRETO — a diferenca que este par existe para
        /// provar.
        /// </summary>
        static Saida Atacando(string sa, bool comAlvo)
        {
            var meu = new List<uint>();
            while (meu.Count < 40) meu.Add(OX);
            var dele = new List<uint>();
            while (dele.Count < 40) dele.Add(CELTIC);

            using var duel = new InteractiveDuel(sa, meu.ToArray(), 20260825UL, 0x1000000UL,
                                                 npc: comAlvo, npcDeck: dele.ToArray());
            var r = duel.Advance();

            var saida = new Saida();
            bool atacou = false;
            int corposDoNpc = 0;

            for (int guard = 0; guard < 600 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    if (!(Campo(e, "type") is string tipo)) continue;
                    if (tipo == "move" && Num(e, "controller") == 1 && Num(e, "loc") == LOC_MZONE)
                        corposDoNpc++;
                    Anotar(saida, e, tipo, atacou);
                }
                if (saida.iFim >= 0) break;

                var q = r.question;
                if (q == null) break;
                GuardarGatilho(saida, q);

                // O jogador só entra na batalha quando o cenário está montado:
                // em A, depois de o NPC ter um corpo em campo; em B, de saída.
                bool pronto = !comAlvo || corposDoNpc > 0;
                r = Responder(duel, q, () =>
                {
                    if (q.kind == "idle" && q.player == 0 && q.summonable.Count > 0 && !atacou)
                        return duel.Respond("summon", q.summonable[0].index);
                    if (q.kind == "idle" && q.player == 0 && pronto && !atacou && q.canBattle)
                        return duel.Respond("battle", 0);
                    if (q.kind == "battle" && q.player == 0 && q.attackers.Count > 0 && !atacou)
                    {
                        atacou = true;
                        return duel.Respond("attack", q.attackers[0].index);
                    }
                    return null;
                });
            }
            return saida;
        }

        /// <summary>
        /// **C.** O jogador BAIXA uma Negate Attack e passa a vez; o NPC invoca,
        /// ataca, e a janela de resposta chega. Ela e' ativada — e o ataque morre
        /// ali.
        /// </summary>
        static Saida Defendendo(string sa)
        {
            // Metade corpo, metade armadilha: sem monstro nenhum o jogador nao
            // sobrevive ao segundo turno, e sem armadilha nao ha' o que responder.
            var meu = new List<uint>();
            while (meu.Count < 40) meu.Add(meu.Count % 2 == 0 ? NEGATE_ATTACK : OX);
            var dele = new List<uint>();
            while (dele.Count < 40) dele.Add(CELTIC);

            using var duel = new InteractiveDuel(sa, meu.ToArray(), 20260825UL, 0x1000000UL,
                                                 npc: true, npcDeck: dele.ToArray());
            var r = duel.Advance();

            var saida = new Saida();
            bool baixou = false;

            for (int guard = 0; guard < 600 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    if (!(Campo(e, "type") is string tipo)) continue;
                    Anotar(saida, e, tipo, atacou: true);
                }
                if (saida.iCancel >= 0) break;

                var q = r.question;
                if (q == null) break;
                GuardarGatilho(saida, q);

                r = Responder(duel, q, () =>
                {
                    // Baixa a armadilha e passa: ela só serve no turno do outro.
                    if (q.kind == "idle" && q.player == 0)
                    {
                        if (!baixou && q.settableST.Count > 0)
                        {
                            baixou = true;
                            return duel.Respond("setspell", q.settableST[0].index);
                        }
                        return duel.Respond("endturn", 0);
                    }
                    // A janela do ataque: ativa a Negate Attack.
                    if (q.kind == "chain" && q.player == 0 && saida.iAttack >= 0)
                    {
                        saida.abriuJanela = true;
                        var alvo = q.choices.FirstOrDefault(c => c.code == NEGATE_ATTACK);
                        if (alvo.code == NEGATE_ATTACK)
                        {
                            saida.trilha.Add("[jogador ativa a Negate Attack]");
                            return duel.Respond("chain", alvo.index);
                        }
                    }
                    return null;
                });
            }
            return saida;
        }

        /// <summary>Anota o evento na trilha do duelo, na ordem em que ele chegou.</summary>
        static void Anotar(Saida s, object e, string tipo, bool atacou)
        {
            // A posição do alvo ANTES do ataque: ela some no instante em que ele
            // vira, e é o que prova que a virada foi da batalha, e não de uma
            // Invocação-Virar do próprio dono.
            if (!atacou && (tipo == "move" || tipo == "pos")
                && Num(e, "controller") == 1 && Num(e, "loc") == LOC_MZONE)
                s.alvoEstavaVirado = Num(e, "pos") == POS_FACEDOWN_DEF;

            switch (tipo)
            {
                case "attack":
                    s.iAttack = s.passo++;
                    s.direto = Campo(e, "direct") is bool b && b;
                    s.trilha.Add(s.direto ? "attack (direto)" : "attack");
                    break;
                case "damagestep":
                {
                    string etapa = Campo(e, "etapa") as string;
                    if (etapa == "inicio") s.iInicio = s.passo++;
                    else s.iFim = s.passo++;
                    s.trilha.Add($"damagestep:{etapa}");
                    break;
                }
                case "battle":
                    s.iBattle = s.passo++;
                    s.atkDoCalculo = Num(e, "atkAtk");
                    s.defDoCalculo = Num(e, "defAtk");
                    s.trilha.Add($"battle (calculo {s.atkDoCalculo} x {s.defDoCalculo})");
                    break;
                case "attackcancel":
                    s.iCancel = s.passo++;
                    s.trilha.Add("attackcancel");
                    break;
                case "lp":
                    // Só o dano DA BATALHA: um `lp` de custo de carta cai fora do
                    // par e não diz nada sobre esta etapa.
                    if (s.iInicio >= 0 && s.iFim < 0 && s.iDano < 0)
                    {
                        s.iDano = s.passo++;
                        s.trilha.Add("lp (dano)");
                    }
                    break;
                case "pos":
                    if (s.iInicio >= 0 && s.iBattle < 0 && s.iFlip < 0
                        && Num(e, "controller") == 1 && Num(e, "loc") == LOC_MZONE)
                    {
                        s.iFlip = s.passo++;
                        s.codeDoFlip = (uint)Math.Max(0, Num(e, "code"));
                        s.trilha.Add("pos (o alvo abre)");
                    }
                    break;
            }
        }

        /// <summary>
        /// O rótulo que o front vai escrever na janela de corrente. Guardado na
        /// PRIMEIRA janela depois da declaração — é a que responde ao ataque.
        /// </summary>
        static void GuardarGatilho(Saida s, InteractiveDuel.Question q)
        {
            if (q.kind != "chain" || q.player != 0 || s.iAttack < 0) return;
            if (!string.IsNullOrEmpty(s.gatilhoKind)) return;
            s.gatilhoKind = q.chainTriggerKind;
            s.gatilhoCode = q.chainTriggerCode;
            s.gatilhoPlayer = q.chainTriggerPlayer;
        }

        /// <summary>
        /// O roteiro do duelo tenta primeiro (`roteiro`); não sendo a vez dele,
        /// responde o mínimo que faz o duelo andar. As perguntas do jogador 1
        /// caem aqui quando o cérebro está desligado (cenário B) — e a resposta
        /// certa ali é não fazer nada, que é o que mantém o campo dele vazio.
        /// </summary>
        static InteractiveDuel.Result Responder(InteractiveDuel duel, InteractiveDuel.Question q,
                                                Func<InteractiveDuel.Result> roteiro)
        {
            var r = roteiro();
            if (r != null) return r;

            switch (q.kind)
            {
                case "idle": return duel.Respond("endturn", 0);
                case "battle": return duel.Respond("endbattle", 0);
                case "place": return duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                case "position": return duel.Respond("position", 0x1);
                case "yesno": return duel.Respond("yesno", 0);
                case "option": return duel.Respond("option", 0);
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
        /// Os eventos são objetos ANÔNIMOS (o mesmo JSON que vai para o front),
        /// então a leitura é por reflexão — de propósito: ler o objeto real prova
        /// que o campo chega com o NOME que a tela procura.
        /// </summary>
        static object Campo(object e, string nome) => e.GetType().GetProperty(nome)?.GetValue(e);

        static int Num(object e, string nome)
        {
            var v = Campo(e, nome);
            return v == null ? -1 : Convert.ToInt32(v);
        }
    }
}
