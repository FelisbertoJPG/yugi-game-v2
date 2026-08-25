using System;
using System.Linq;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste do modo MULTIPLAYER — `--test-multiplayer`.
    ///
    /// O motor foi escrito assumindo um humano (jogador 0) e um robô (jogador 1):
    /// toda pergunta do 1 era respondida internamente, pelo `NpcBrain` ou pelo
    /// auto-passe, e nunca chegava a lugar nenhum. Um duelo entre duas pessoas
    /// precisa do contrário — a pergunta do 1 tem de SUBIR e o duelo tem de PARAR
    /// e esperar.
    ///
    /// Este arquivo prova as duas metades, e a segunda importa tanto quanto:
    ///
    ///   1. no multiplayer, os dois lados decidem de verdade;
    ///   2. **contra o NPC, absolutamente nada mudou** — o adversário continua
    ///      existindo e jogando sozinho, porque multiplayer é uma opção à parte,
    ///      não uma troca do que já funcionava.
    /// </summary>
    public static class TestMultiplayer
    {
        const uint BATTLE_OX = 5053103;   // vanilla inerte: ninguém ativa nada

        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Log.Info($"  ok   {nome}"); }
        static void Falha(string nome, string porque) { _fail++; Log.Err($"  FALHA {nome}: {porque}"); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run(string sa)
        {
            Log.Info("=== teste: MULTIPLAYER (humano x humano) ===\n");

            ContraONpcNadaMudou(sa);
            OsDoisLadosDecidem(sa);
            PerguntaSoChegaAQuemFoiPerguntado(sa);
            NinguemJogaPeloOutro(sa);
            RaioXNaoAlcancaUmHumano(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ casos

        /// <summary>
        /// REGRESSÃO, e é o caso mais importante do arquivo. O adversário NPC é o
        /// jogo que existe hoje; multiplayer não pode ter custo nenhum para ele.
        /// </summary>
        static void ContraONpcNadaMudou(string sa)
        {
            using var d = Duelo(sa, doisHumanos: false, npc: true);
            var r = d.Advance();

            Checa(r.question != null && r.question.player == 0,
                  "contra o NPC: a primeira pergunta e' do jogador 0");

            // Passar o turno tem de devolver o controle ao jogador 0 depois de o NPC
            // jogar o dele inteiro, sem nunca parar no meio pedindo decisão do 1.
            r = d.Respond("endturn", 0);
            Checa(!r.ended && r.question != null && r.question.player == 0,
                  "contra o NPC: depois do endturn a vez volta para o jogador 0",
                  $"veio player={r.question?.player.ToString() ?? "sem pergunta"}");
        }

        /// <summary>
        /// O modo novo: passar o turno entrega a decisão à OUTRA PESSOA, e o motor
        /// para. É exatamente o que nunca acontecia antes.
        /// </summary>
        static void OsDoisLadosDecidem(string sa)
        {
            using var d = Duelo(sa, doisHumanos: true, npc: false);
            var r = d.Advance();

            Checa(r.question != null && r.question.player == 0,
                  "multiplayer: comeca perguntando ao jogador 0");

            r = d.Respond("endturn", 0, porJogador: 0);
            Checa(!r.ended && r.question != null && r.question.player == 1,
                  "multiplayer: depois do endturn quem decide e' o jogador 1 (o motor ESPEROU)",
                  $"veio player={r.question?.player.ToString() ?? "sem pergunta"}");

            r = d.Respond("endturn", 0, porJogador: 1);
            Checa(!r.ended && r.question != null && r.question.player == 0,
                  "e a vez volta para o jogador 0 — os dois lados alternam de verdade",
                  $"veio player={r.question?.player.ToString() ?? "sem pergunta"}");

            // Aguenta o vaivém: um turno que alterna uma vez pode ser sorte.
            int trocas = 0, ultimo = 0;
            for (int i = 0; i < 20 && !r.ended && r.question != null; i++)
            {
                int de = r.question.player;
                r = d.Respond("endturn", 0, porJogador: (byte)de);
                if (!r.ended && r.question != null && r.question.player != ultimo)
                { trocas++; ultimo = r.question.player; }
            }
            Checa(trocas >= 5, $"o vaivem se sustenta ({trocas} trocas de vez em 20 jogadas)");
        }

        /// <summary>
        /// A pergunta é de um jogador só. Se ela chegasse aos dois, o adversário
        /// veria os alvos que o outro está avaliando — e os dois teriam botão para
        /// clicar na mesma decisão.
        /// </summary>
        static void PerguntaSoChegaAQuemFoiPerguntado(string sa)
        {
            using var d = Duelo(sa, doisHumanos: true, npc: false);
            var r = d.Advance();
            r = d.Respond("endturn", 0, porJogador: 0);   // agora a pergunta e' do 1

            Checa(r.question != null && r.question.player == 1, "preparo: a pergunta e' do jogador 1");
            if (r.question == null || r.question.player != 1) return;

            Checa(TemPergunta(r, 1), "o jogador 1 recebe a pergunta dele");
            Checa(!TemPergunta(r, 0), "e o jogador 0 NAO recebe — ele so' espera");
        }

        /// <summary>
        /// Sem esta trava, o jogador 1 responde a pergunta do 0 e joga o turno do
        /// adversário. Nem precisa de má intenção: duas telas abertas e um clique
        /// atrasado bastam.
        /// </summary>
        static void NinguemJogaPeloOutro(string sa)
        {
            using var d = Duelo(sa, doisHumanos: true, npc: false);
            var r = d.Advance();                          // pergunta do jogador 0

            var invasao = d.Respond("endturn", 0, porJogador: 1);
            Checa(invasao.question != null && invasao.question.player == 0,
                  "jogada do jogador errado e' recusada e a pergunta continua pendente");
            Checa(invasao.events.Any(e => (e.GetType().GetProperty("type")?.GetValue(e) as string) == "refused"),
                  "e a recusa vem explicita no evento 'refused'");

            // E o dono da vez continua conseguindo jogar normalmente depois disso.
            var boa = d.Respond("endturn", 0, porJogador: 0);
            Checa(boa.question != null && boa.question.player == 1,
                  "depois da recusa, o jogador certo joga normalmente");
        }

        /// <summary>
        /// O RAIO-X (`POST /espiar`, a caixa "ver a mao do NPC" do admin) para no
        /// multiplayer — e esta e' a unica trava de verdade que ele tem.
        ///
        /// Quem hospeda roda o motor para os DOIS (ver `web/js/ponte.js`), entao
        /// este processo tem a mao do outro JOGADOR na memoria. Devolve-la
        /// transformaria um diagnostico do cerebro do NPC em trapaca contra uma
        /// pessoa — e sem ninguem perceber, porque do outro lado nada muda.
        ///
        /// `null` e nao lista vazia: "nao posso mostrar" e "ele esta sem cartas"
        /// sao respostas diferentes, e a tela precisa saber qual das duas e'.
        ///
        /// O par CONTROLE e' obrigatorio aqui: sem ele, uma `MaoDoNpc()` que
        /// devolvesse null SEMPRE passaria neste teste — e o raio-x nao mostraria
        /// nada, em silencio, que e' o defeito que ninguem acusa.
        /// </summary>
        static void RaioXNaoAlcancaUmHumano(string sa)
        {
            using (var humanos = Duelo(sa, doisHumanos: true, npc: false))
            {
                humanos.Advance();
                Checa(humanos.MaoDoNpc() == null,
                      "multiplayer: a mao do adversario HUMANO nao sai do servidor");
            }

            using (var contraNpc = Duelo(sa, doisHumanos: false, npc: true))
            {
                contraNpc.Advance();
                var mao = contraNpc.MaoDoNpc();
                Checa(mao != null, "par CONTROLE: contra o NPC a mao e' devolvida");
                Checa(mao != null && mao.Count > 0,
                      "e ela tem as cartas de verdade (a mao inicial do NPC)",
                      $"(veio {mao?.Count ?? -1} carta(s))");
            }
        }

        // ------------------------------------------------------------- utilidades

        static InteractiveDuel Duelo(string sa, bool doisHumanos, bool npc)
        {
            var deck = new uint[40];
            for (int i = 0; i < deck.Length; i++) deck[i] = BATTLE_OX;
            return new InteractiveDuel(sa, deck, 20260810UL, 0x1000000UL,
                                       npc: npc, doisHumanos: doisHumanos);
        }

        /// <summary>A resposta projetada para este jogador traz pergunta?</summary>
        static bool TemPergunta(InteractiveDuel.Result r, byte espectador)
        {
            var doc = JsonDocument.Parse(JsonSerializer.Serialize(
                r.Para(espectador), new JsonSerializerOptions { IncludeFields = true }));
            return doc.RootElement.TryGetProperty("question", out var q)
                   && q.ValueKind != JsonValueKind.Null;
        }
    }
}
