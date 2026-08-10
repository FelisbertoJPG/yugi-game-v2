using System;
using System.IO;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da trava de atualização durante o duelo —
    /// `--test-update-duelo` (INSTALADOR-PENDENCIAS.md §3).
    ///
    /// O problema que ele fecha: `POST /__update/aplicar` funcionava a qualquer
    /// momento. Com um duelo em andamento, a extração do pacote 'cards' tenta
    /// sobrescrever os ~21 mil `.lua` e o `cards.cdb` — e o `cards.cdb` está
    /// ABERTO pelo SQLite desde `DuelSession` (`sqlite3_open`). O resultado seria
    /// uma extração morta pela metade, com o jogo instalado entre duas versões, e
    /// nenhum sintoma até o jogador reabrir.
    ///
    /// São dois fatos independentes, e os dois precisam valer:
    ///
    ///   1. o `cards.cdb` é MESMO segurado enquanto um duelo existe, e é MESMO
    ///      solto quando ele é descartado (o `Dispose` determinístico do
    ///      `DatabaseManager` — antes só havia finalizador, e ninguém sabe quando
    ///      o coletor de lixo roda);
    ///   2. o estado que a rota consulta (`DueloEmAndamento` /
    ///      `LiberarDueloEncerrado`) responde certo nas três situações: sem duelo,
    ///      com duelo vivo, e com duelo já encerrado.
    ///
    /// O caso do duelo ENCERRADO não é detalhe: o objeto continua vivo até o
    /// próximo `/start`, segurando o arquivo. Se a rota só perguntasse "tem duelo?"
    /// e não soltasse, atualizar depois de jogar uma vez ficaria impossível até
    /// fechar o jogo — que é o oposto do que se quer.
    /// </summary>
    public static class TestUpdateDuelo
    {
        const uint BATTLE_OX = 5053103;   // vanilla inerte: ninguém ativa nada

        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Log.Info($"  ok   {nome}"); }
        static void Falha(string nome, string porque) { _fail++; Log.Err($"  FALHA {nome}: {porque}"); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run(string sa)
        {
            Log.Info("=== teste: TRAVA DE ATUALIZACAO DURANTE O DUELO ===\n");

            string cdb = Path.Combine(sa, "YGODemo", "cards.cdb");

            CardsCdbEhSoltoNoDispose(sa, cdb);
            AplicarERecusadoComDueloVivoELiberadoDepois(sa, cdb);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ casos

        /// <summary>
        /// A raiz do problema, medida no arquivo em vez de deduzida: com um duelo
        /// vivo o `cards.cdb` não pode ser aberto em exclusiva (é exatamente o que
        /// a extração do zip precisaria fazer); depois do `Dispose`, pode.
        /// </summary>
        static void CardsCdbEhSoltoNoDispose(string sa, string cdb)
        {
            Checa(LivreParaTrocar(cdb), "antes de qualquer duelo, o cards.cdb esta' livre",
                  "algum outro processo esta' com o banco aberto — feche o duel-server");

            var duelo = NovoDuelo(sa);
            Checa(!LivreParaTrocar(cdb), "com um duelo vivo, o cards.cdb esta' TRAVADO pelo SQLite",
                  "o banco deveria estar aberto; a trava do update perdeu o motivo de existir");

            duelo.Dispose();
            Checa(LivreParaTrocar(cdb), "depois do Dispose, o cards.cdb volta a estar livre",
                  "o DatabaseManager nao fechou o banco — so' o finalizador fecharia, e ninguem sabe quando");
        }

        /// <summary>
        /// O estado que a rota `/__update/aplicar` consulta, pelo MESMO caminho de
        /// código das rotas `/start` e `/respond`.
        /// </summary>
        static void AplicarERecusadoComDueloVivoELiberadoDepois(string sa, string cdb)
        {
            WebServer.ConfigurarParaTeste(sa);

            Checa(!WebServer.DueloEmAndamento, "sem duelo nenhum: nao ha' duelo em andamento");
            Checa(WebServer.LiberarDueloEncerrado(),
                  "sem duelo nenhum: aplicar a atualizacao e' liberado");

            var r = WebServer.StartDuel(Corpo(
                "{\"deck\":[" + Repetido(BATTLE_OX, 40) + "],\"npc\":false,\"seed\":424242}"));
            Checa(!Terminou(r), "o duelo de teste comecou");

            Checa(WebServer.DueloEmAndamento, "com duelo vivo: ha' duelo em andamento");
            Checa(!WebServer.LiberarDueloEncerrado(),
                  "com duelo vivo: aplicar a atualizacao e' RECUSADO (e' o 409 da rota)");
            Checa(!LivreParaTrocar(cdb),
                  "e o cards.cdb continua travado — a extracao teria falhado pela metade");

            // Passa turno até o deck acabar. É a forma mais barata de terminar um
            // duelo de verdade: ninguém ataca, ninguém invoca, o motor encerra
            // sozinho quando alguém não tem o que comprar.
            int voltas = 0;
            while (!Terminou(r) && voltas++ < 400)
                r = WebServer.RespondDuel(Corpo("{\"action\":\"endturn\"}"));

            Checa(Terminou(r), $"o duelo terminou (deck-out) em {voltas} jogadas",
                  "o duelo nao acabou dentro do teto — o resto do caso nao pode ser avaliado");
            if (!Terminou(r)) return;

            Checa(!WebServer.DueloEmAndamento, "duelo encerrado: nao conta mais como em andamento");
            Checa(WebServer.LiberarDueloEncerrado(),
                  "duelo encerrado: aplicar a atualizacao volta a ser liberado");
            Checa(LivreParaTrocar(cdb),
                  "e o cards.cdb foi solto junto — atualizar depois de jogar nao exige fechar o jogo");
        }

        // ------------------------------------------------------------- utilidades

        static InteractiveDuel NovoDuelo(string sa)
        {
            var deck = new uint[40];
            for (int i = 0; i < deck.Length; i++) deck[i] = BATTLE_OX;
            var d = new InteractiveDuel(sa, deck, 424242UL, 0x1000000UL, npc: false);
            d.Advance();
            return d;
        }

        /// <summary>
        /// "Dá para sobrescrever este arquivo?" — a pergunta que a extração do zip
        /// faz na prática. Abre em exclusiva e fecha na hora, sem escrever nada.
        /// </summary>
        static bool LivreParaTrocar(string caminho)
        {
            try
            {
                using var _ = new FileStream(caminho, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                return true;
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        static JsonElement Corpo(string json) => JsonDocument.Parse(json).RootElement;

        /// <summary>
        /// O duelo acabou? As rotas devolvem a resposta JA' PROJETADA para um
        /// jogador (`Result.Para`), que e' um objeto anonimo — nao da' para receber
        /// como `Result`. E' de proposito: quem serializar o Result cru vaza o
        /// codigo das cartas viradas, entao o tipo forca a projecao.
        /// </summary>
        static bool Terminou(object resposta) =>
            Convert.ToBoolean(resposta?.GetType().GetProperty("ended")?.GetValue(resposta) ?? false);

        static string Repetido(uint code, int quantas) =>
            string.Join(",", System.Linq.Enumerable.Repeat(code.ToString(), quantas));
    }
}
