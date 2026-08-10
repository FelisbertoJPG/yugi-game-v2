using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste da PROJEÇÃO POR ESPECTADOR — `--test-visao`.
    ///
    /// Um duelo entre dois humanos é o mesmo motor visto de dois lugares: a carta
    /// que está virada para um está aberta para o outro. Antes disto, a decisão de
    /// esconder era tomada ao construir o evento (`code = 0` na origem), com o
    /// espectador fixo no jogador 0 — o que só funciona enquanto o jogador 1 for um
    /// robô que não recebe tela.
    ///
    /// Agora o evento nasce COMPLETO e `Result.Para(espectador)` apaga na saída.
    /// Isso inverte o risco: antes, esquecer de esconder era impossível (já nascia
    /// escondido); agora, esquecer de PROJETAR entrega o código da carta que o
    /// adversário baixou. Nenhum erro apareceria — só alguém "adivinhando" o Mirror
    /// Force antes de atacar.
    ///
    /// Por isso este arquivo existe e por isso ele testa os dois sentidos de cada
    /// caso: o que o dono vê E o que o adversário não vê. As 19 suítes de duelo
    /// leem os eventos CRUS e não passariam por aqui nunca.
    /// </summary>
    public static class TestVisao
    {
        const uint CARTA = 46986414;   // Dark Magician — qualquer código serve
        const int VIRADA_DEF = 0x8;    // POS_FACEDOWN_DEFENSE
        const int ATAQUE = 0x1;        // POS_FACEUP_ATTACK

        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Log.Info($"  ok   {nome}"); }
        static void Falha(string nome, string porque) { _fail++; Log.Err($"  FALHA {nome}: {porque}"); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run()
        {
            Log.Info("=== teste: VISAO POR ESPECTADOR (duelo entre dois humanos) ===\n");

            CartaViradaDoOponente();
            CartaAbertaTodoMundoVe();
            CompraSoOQuemComprouVe();
            StatsDeMonstroViradoNaoVazaAtk();
            EventoPublicoChegaIgualAosDois();
            ResultCruNaoSerializaEventos();

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ casos

        /// <summary>
        /// O caso central: o jogador 1 baixa uma carta virada. O 0 não pode saber
        /// qual é; o 1 precisa saber, porque é dele.
        /// </summary>
        static void CartaViradaDoOponente()
        {
            var r = ComEventos(Move(controller: 1, pos: VIRADA_DEF));

            var p0 = Eventos(r, 0)[0];
            Checa(Num(p0, "code") == 0, "carta virada do oponente: codigo apagado para quem NAO e' o dono",
                  $"veio code={Num(p0, "code")}");
            Checa(Bool(p0, "hidden"), "e marcada como hidden");

            var p1 = Eventos(r, 1)[0];
            Checa(Num(p1, "code") == CARTA, "a MESMA carta chega inteira para o dono",
                  $"veio code={Num(p1, "code")}");
            Checa(!Bool(p1, "hidden"), "e nao vem marcada como hidden para ele");
        }

        /// <summary>Carta aberta é pública — esconder dos dois seria tão errado quanto revelar.</summary>
        static void CartaAbertaTodoMundoVe()
        {
            var r = ComEventos(Move(controller: 1, pos: ATAQUE));
            Checa(Num(Eventos(r, 0)[0], "code") == CARTA, "carta em ataque: o adversario ve' o codigo");
            Checa(Num(Eventos(r, 1)[0], "code") == CARTA, "e o dono tambem");
        }

        /// <summary>
        /// A compra. O adversário vê QUE você comprou (e quantas), nunca o quê —
        /// exatamente como na mesa.
        /// </summary>
        static void CompraSoOQuemComprouVe()
        {
            var r = ComEventos(new
            {
                type = "draw",
                player = 0,
                cards = new List<object> { new { code = CARTA, hidden = false },
                                           new { code = CARTA, hidden = false } },
            });

            var meu = Cartas(Eventos(r, 0)[0]);
            Checa(meu.Count == 2 && meu.All(c => Num(c, "code") == CARTA),
                  "quem comprou ve' as 2 cartas que comprou");

            var dele = Cartas(Eventos(r, 1)[0]);
            Checa(dele.Count == 2, "o adversario ve' QUE foram 2 cartas", $"viu {dele.Count}");
            Checa(dele.All(c => Num(c, "code") == 0), "mas nenhum codigo");
            Checa(dele.All(c => Bool(c, "hidden")), "e todas marcadas como hidden");
        }

        /// <summary>
        /// REGRESSÃO. O `stats` (destaque de ATK/DEF) de um monstro VIRADO diz o que
        /// ele é — um 2500 de ATK escondido só pode ser uma coisa. Antes o evento
        /// simplesmente não era emitido para carta virada; agora ele é emitido com
        /// o `pos` e SUPRIMIDO na projeção, o que dá o mesmo resultado para o
        /// adversário e corrige o dono, que antes também ficava sem.
        /// </summary>
        static void StatsDeMonstroViradoNaoVazaAtk()
        {
            var r = ComEventos(new
            {
                type = "stats", controller = 1, loc = (byte)0x4, seq = 0,
                pos = VIRADA_DEF, atk = 2500, baseAtk = 2000, def = 2100, baseDef = 2100,
            });

            Checa(Eventos(r, 0).Count == 0,
                  "stats de monstro virado NAO chega ao adversario (o ATK entregaria a carta)");
            Checa(Eventos(r, 1).Count == 1, "mas chega ao dono, que sabe o que baixou");

            // O `stats` do MSG_EQUIP nao tem `pos` — equipamento nao mira carta
            // virada, entao e' publico. Suprimi-lo apagaria o destaque de ATK da tela.
            var eq = ComEventos(new
            {
                type = "stats", controller = 1, loc = (byte)0x4, seq = 0,
                atk = 1800, baseAtk = 1500, def = 1000, baseDef = 1000,
            });
            Checa(Eventos(eq, 0).Count == 1 && Eventos(eq, 1).Count == 1,
                  "stats de equipamento (sem pos) continua publico para os dois");
        }

        /// <summary>LP, fase, corrente e batalha são públicos — na mesa também são.</summary>
        static void EventoPublicoChegaIgualAosDois()
        {
            var r = ComEventos(new { type = "lp", player = 1, lp = 6200 });
            string a = Json(Eventos(r, 0)[0]), b = Json(Eventos(r, 1)[0]);
            Checa(a == b, "evento publico e' identico para os dois", $"{a} != {b}");
        }

        /// <summary>
        /// A TRAVA. `Result.events` é `[JsonIgnore]`: quem serializar o Result cru
        /// manda um objeto SEM eventos e percebe na hora, em vez de vazar em
        /// silêncio o código de tudo que está virado na mesa.
        ///
        /// Se alguém remover esse atributo por engano, é aqui que aparece.
        /// </summary>
        static void ResultCruNaoSerializaEventos()
        {
            var r = ComEventos(Move(controller: 1, pos: VIRADA_DEF));
            string cru = JsonSerializer.Serialize(r, new JsonSerializerOptions { IncludeFields = true });

            Checa(!cru.Contains("events"),
                  "Result cru NAO serializa 'events' (a trava do JsonIgnore esta no lugar)", cru);
            Checa(!cru.Contains(CARTA.ToString()),
                  "e o codigo da carta virada nao aparece nele", cru);

            string projetado = Json(Eventos(r, 0)[0]);
            Checa(!projetado.Contains(CARTA.ToString()),
                  "a versao projetada para o adversario tambem nao tem o codigo", projetado);
        }

        // ------------------------------------------------------------- utilidades

        static object Move(int controller, int pos) => new
        {
            type = "move", code = CARTA, hidden = false,
            fromCtrl = (byte)0, fromLoc = (byte)0, fromSeq = 0,
            controller = (byte)controller, loc = (byte)0x4, seq = 0, pos,
        };

        static InteractiveDuel.Result ComEventos(params object[] evs)
        {
            var r = new InteractiveDuel.Result();
            r.events.AddRange(evs);
            return r;
        }

        /// <summary>Os eventos como o front os receberia — passando pela projeção.</summary>
        static List<JsonElement> Eventos(InteractiveDuel.Result r, byte espectador)
        {
            var doc = JsonDocument.Parse(JsonSerializer.Serialize(
                r.Para(espectador), new JsonSerializerOptions { IncludeFields = true }));
            return doc.RootElement.GetProperty("events").EnumerateArray().ToList();
        }

        static List<JsonElement> Cartas(JsonElement ev) =>
            ev.GetProperty("cards").EnumerateArray().ToList();

        static long Num(JsonElement e, string prop) =>
            e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : -1;

        static bool Bool(JsonElement e, string prop) =>
            e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.True;

        static string Json(JsonElement e) => e.GetRawText();
    }
}
