using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação das SALAS — `--test-salas`.
    ///
    /// Até aqui o `WebServer` guardava UM duelo por processo (`static
    /// InteractiveDuel _duel`). Bastava para o jogo de mesa e para a ponte, onde
    /// cada máquina hospeda o próprio duelo. Não basta para a ARENA, que é um
    /// processo só atendendo várias partidas: o `/start` do segundo jogador
    /// destruía o duelo do primeiro, e o `/respond` dele caía no duelo errado.
    ///
    /// O que este teste protege é justamente o que um refactor de concorrência
    /// quebra sem avisar — os testes de duelo passam todos com salas trocadas,
    /// porque cada um roda sozinho.
    /// </summary>
    public static class TestSalas
    {
        static int _pass, _fail;
        static void Ok(string n) { _pass++; Log.Info($"  ok   {n}"); }
        static void Falha(string n, string p) { _fail++; Log.Err($"  FALHA {n}: {p}"); }
        static void Checa(bool c, string n, string p = null) { if (c) Ok(n); else Falha(n, p ?? "condicao falsa"); }

        // Vanillas inertes: o duelo precisa rodar, não precisa ser interessante.
        const uint BATTLE_OX = 5053103;
        // Precisa ter script Lua como o Battle Ox: uma carta sem script faz o
        // ScriptManager avisar e polui o diagnóstico de um teste que não é sobre
        // isso. Flying Kamakiri #2 é vanilla e tem script.
        const uint KAMAKIRI = 3134241;

        static uint[] Deck(uint carta) => Enumerable.Repeat(carta, 40).ToArray();

        static JsonElement Corpo(object o) =>
            JsonDocument.Parse(JsonSerializer.Serialize(o)).RootElement;

        /// <summary>O `Result` volta como objeto anônimo; leitura por reflexão.</summary>
        static object Campo(object alvo, string nome) =>
            alvo?.GetType().GetProperty(nome)?.GetValue(alvo);

        public static int Run(string sa)
        {
            Log.Info("=== teste: SALAS (duelos concorrentes no mesmo processo) ===\n");
            WebServer.ConfigurarParaTeste(sa);

            // --- duas salas, decks e seeds diferentes
            var a = WebServer.StartDuel(Corpo(new { deck = Deck(BATTLE_OX), seed = 111UL, npc = false, sala = "A" }));
            var b = WebServer.StartDuel(Corpo(new { deck = Deck(KAMAKIRI), seed = 222UL, npc = false, sala = "B" }));

            Checa(Campo(a, "error") == null, "sala A abriu", $"{Campo(a, "error")}");
            Checa(Campo(b, "error") == null, "sala B abriu", $"{Campo(b, "error")}");

            // A prova de que sao duelos DISTINTOS: cada mao so' tem a carta do
            // proprio deck. Se uma sala tivesse atropelado a outra, as duas
            // responderiam com o mesmo conteudo.
            Checa(TemNaMao(a, BATTLE_OX) && !TemNaMao(a, KAMAKIRI),
                  "a mao da sala A e' do deck da sala A");
            Checa(TemNaMao(b, KAMAKIRI) && !TemNaMao(b, BATTLE_OX),
                  "a mao da sala B e' do deck da sala B");

            // --- jogar numa sala nao mexe na outra
            var antesB = Perguntou(b);
            WebServer.RespondDuel(Corpo(new { action = "endturn", sala = "A" }));
            var depoisB = WebServer.RespondDuel(Corpo(new { action = "__espiar__", sala = "B" }));

            // "__espiar__" e' acao desconhecida de proposito: o motor recusa e
            // devolve o estado sem alterar nada. Serve para olhar a sala B sem
            // jogar por ela.
            Checa(Campo(depoisB, "error") == null, "sala B continua viva depois de jogarem na A",
                  $"{Campo(depoisB, "error")}");
            Checa(antesB, "a sala B tinha pergunta pendente antes");

            // --- sala inexistente nao herda o duelo de ninguem
            var c = WebServer.RespondDuel(Corpo(new { action = "endturn", sala = "NAO-EXISTE" }));
            Checa($"{Campo(c, "error")}".Contains("nenhum duelo"),
                  "sala sem /start recusa o /respond", $"veio: {Campo(c, "error")}");

            // --- compatibilidade: sem `sala`, tudo como antes
            var padrao = WebServer.StartDuel(Corpo(new { deck = Deck(BATTLE_OX), seed = 333UL, npc = false }));
            Checa(Campo(padrao, "error") == null, "sem id de sala o duelo abre igual a antes");
            var padrao2 = WebServer.RespondDuel(Corpo(new { action = "endturn" }));
            Checa(Campo(padrao2, "error") == null, "e o /respond sem id acha esse mesmo duelo");

            // E a sala padrao NAO pode ser as salas nomeadas.
            var aindaA = WebServer.RespondDuel(Corpo(new { action = "__espiar__", sala = "A" }));
            Checa(Campo(aindaA, "error") == null,
                  "abrir o duelo padrao nao derrubou a sala A", $"{Campo(aindaA, "error")}");

            // --- a trava do update enxerga TODAS as salas
            Checa(WebServer.DueloEmAndamento,
                  "DueloEmAndamento ve' duelo vivo em qualquer sala");
            Checa(!WebServer.LiberarDueloEncerrado(),
                  "LiberarDueloEncerrado recusa enquanto houver duelo em andamento");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>A carta aparece na mão do jogador 0 nos eventos de compra?</summary>
        static bool TemNaMao(object resposta, uint code)
        {
            var evs = Campo(resposta, "events") as System.Collections.IEnumerable;
            if (evs == null) return false;
            foreach (var e in evs)
            {
                if ($"{Campo(e, "type")}" != "draw") continue;
                // Depois da visão por espectador, cada carta do `draw` é
                // `{code, hidden}` — não mais um id solto.
                if (Campo(e, "cards") is System.Collections.IEnumerable cartas)
                    foreach (var c in cartas)
                    {
                        object cru = Campo(c, "code") ?? c;
                        if (cru is IConvertible && Convert.ToUInt32(cru) == code) return true;
                    }
            }
            return false;
        }

        static bool Perguntou(object resposta) => Campo(resposta, "question") != null;
    }
}
