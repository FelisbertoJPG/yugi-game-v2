using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// A MÃO INICIAL escolhida — `--test-mao-inicial`.
    ///
    /// O "Testar Duelo" da Área de Teste (`web/testarduelo.html`) deixa o admin
    /// dizer QUANTAS cartas quer na mão e QUAIS. O motor não tem "mão inicial":
    /// ela é a compra de regra (`startingDrawCount`) tirada do topo do deck. Então
    /// as escolhidas vão para o TOPO (`DuelSession.ComMaoNoTopo`) e o tamanho vira
    /// a compra inicial do jogador — e a tela as recebe pelo MSG_DRAW de sempre.
    ///
    /// Erra CALADO nos dois sentidos: pôr as escolhidas na ponta errada da lista
    /// as deixa no FUNDO do deck (o duelo abre com uma mão plausível, só que outra),
    /// e injetá-las direto na mão as põe no motor sem evento nenhum — a tela nasce
    /// sem elas. O que se prova é o evento `draw`, porque é ele que a tela desenha.
    /// </summary>
    public static class TestMaoInicial
    {
        const uint BATTLE_OX = 5053103;        // Normal Nv4 — o enchimento
        const uint DARK_MAGICIAN = 46986414;   // Normal Nv7 — duas cópias no fundo da pilha
        const uint MYSTICAL_ELF = 15025844;    // Normal Nv4 — uma cópia

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            var deck = new List<uint> { DARK_MAGICIAN, DARK_MAGICIAN, MYSTICAL_ELF };
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            Log.Info("=== o corpo do /start: o que vale como mao inicial ===\n");
            var (mao, tam) = Ler(deck, "{\"maoInicial\":[46986414,46986414,46986414],\"tamanhoMao\":7}");
            Check("tres Dark Magician pedidos com DOIS no deck viram dois",
                  mao?.Count(c => c == DARK_MAGICIAN) == 2, $"(veio [{Lista(mao)}])");
            Check("o tamanho pedido (7) e' respeitado", tam == 7, $"(veio {tam})");

            (mao, tam) = Ler(deck, "{\"maoInicial\":[46986414,15025844,5053103],\"tamanhoMao\":2}");
            Check("tamanho menor que as escolhidas sobe para caber todas (3)", tam == 3, $"(veio {tam})");

            (mao, tam) = Ler(deck, "{\"maoInicial\":[89631139]}");
            Check("carta fora do deck e' ignorada", mao == null, $"(veio [{Lista(mao)}])");
            Check("sem `tamanhoMao` e' a mao de regra (5)", tam == DuelSession.TAMANHO_MAO_PADRAO, $"(veio {tam})");

            (mao, tam) = Ler(deck, "{\"tamanhoMao\":999}");
            Check("tamanho nunca passa do deck", tam == deck.Count, $"(veio {tam})");

            Log.Info("\n=== o duelo: as escolhidas chegam pela COMPRA inicial ===\n");
            var escolhidas = new[] { DARK_MAGICIAN, DARK_MAGICIAN, MYSTICAL_ELF };
            var (minha, dele) = CompraInicial(sa, deck.ToArray(), escolhidas, 7);
            Check("a compra inicial do jogador trouxe 7 cartas", minha.Count == 7, $"(veio {minha.Count})");
            Check("com os DOIS Dark Magician (estavam entre 40 cartas)",
                  minha.Count(c => c == DARK_MAGICIAN) == 2, $"(mao [{Lista(minha)}])");
            Check("e o Mystical Elf", minha.Contains(MYSTICAL_ELF), $"(mao [{Lista(minha)}])");
            Check("o NPC continua comprando as 5 de regra", dele.Count == DuelSession.TAMANHO_MAO_PADRAO,
                  $"(veio {dele.Count})");

            Log.Info("\n=== par CONTROLE: a mesma seed sem escolher nada ===\n");
            var (sem, _) = CompraInicial(sa, deck.ToArray(), null, DuelSession.TAMANHO_MAO_PADRAO);
            Check("sem escolha a mao e' de 5", sem.Count == DuelSession.TAMANHO_MAO_PADRAO, $"(veio {sem.Count})");
            Check("e ela NAO e' a mesma (senao 'chegou' nao provaria nada)",
                  !(sem.Count(c => c == DARK_MAGICIAN) == 2 && sem.Contains(MYSTICAL_ELF)),
                  $"(mao [{Lista(sem)}] — troque a seed)");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static (uint[] mao, int tam) Ler(List<uint> deck, string json) =>
            WebServer.MaoInicialDoCorpo(JsonDocument.Parse(json).RootElement, deck.ToArray());

        static string Lista(IEnumerable<uint> c) => c == null ? "" : string.Join(",", c);

        /// <summary>
        /// O primeiro `draw` de cada lado — a compra inicial, lida do MESMO evento
        /// anônimo que vai para `web/duel.html` (por reflexão, como em `--test-flip`).
        /// </summary>
        static (List<uint> minha, List<uint> dele) CompraInicial(string sa, uint[] deck, uint[] mao, int tamanho)
        {
            using var duel = new InteractiveDuel(sa, deck, 20260926UL, 0x1000000UL, npc: false,
                                                 npcDeck: Enumerable.Repeat(BATTLE_OX, 40).ToArray(),
                                                 maoInicial: mao, tamanhoMao: tamanho);
            var r = duel.Advance();
            List<uint> minha = null, dele = null;
            foreach (var e in r.events)
            {
                var t = e.GetType();
                if ((t.GetProperty("type")?.GetValue(e) as string) != "draw") continue;
                int pl = Convert.ToInt32(t.GetProperty("player")?.GetValue(e) ?? 0);
                var cartas = ((IEnumerable<object>)t.GetProperty("cards")?.GetValue(e) ?? Array.Empty<object>())
                    .Select(c => Convert.ToUInt32(c.GetType().GetProperty("code")?.GetValue(c) ?? 0u))
                    .ToList();
                if (pl == 0 && minha == null) minha = cartas;
                if (pl == 1 && dele == null) dele = cartas;
            }
            return (minha ?? new List<uint>(), dele ?? new List<uint>());
        }
    }
}
