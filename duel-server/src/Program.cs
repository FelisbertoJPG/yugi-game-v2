using System;
using System.IO;
using System.Runtime.InteropServices;
using YGO;

// duel-server — passo 1 da secao 6 do continue.md.
// Reproduz no terminal o que a Unity ja fazia: cria o duelo no ocgcore,
// injeta os baralhos, inicia e roda o loop de processo imprimindo as mensagens
// do motor — sem Unity. Portado de DuelManager.cs (Start + Update).
namespace DuelServer
{
    internal static class Program
    {
        // Retornos de OCG_DuelProcess (edo9300 ocgcore)
        private const int OCG_DUEL_STATUS_END = 0;
        private const int OCG_DUEL_STATUS_AWAITING = 1;
        private const int OCG_DUEL_STATUS_CONTINUE = 2;

        // Delegates precisam de referencia gerenciada viva para o GC nao coletar
        // enquanto o codigo nativo ainda guarda o ponteiro deles.
        private static OCG_DataReader _cardReaderDelegate;
        private static OCG_ScriptReader _scriptReaderDelegate;

        private static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            bool serve = Array.IndexOf(args, "--serve") >= 0;
            Log.Info(serve
                ? "=== duel-server (modo servidor de treino / web) ==="
                : "=== duel-server (ocgcore edo9300, sem Unity) ===");

            // 1. Localizar os StreamingAssets (cards.cdb + scripts lua)
            string streamingAssets = ResolveStreamingAssets(args);
            if (streamingAssets == null)
            {
                Log.Err("Nao encontrei duel_academy/Assets/StreamingAssets/YGODemo/cards.cdb.");
                Log.Err("Passe o caminho de StreamingAssets como primeiro argumento, ou defina YGODEMO_PATH.");
                return 2;
            }
            Log.Info($"StreamingAssets: {streamingAssets}");

            // Versao do core (confirma que a DLL carrega antes de qualquer coisa)
            try
            {
                YgoCoreAPI.OCG_GetVersion(out int major, out int minor);
                Log.Info($"ocgcore versao {major}.{minor}");
            }
            catch (DllNotFoundException e)
            {
                Log.Err($"ocgcore.dll nao encontrada ao lado do executavel: {e.Message}");
                return 3;
            }
            catch (BadImageFormatException)
            {
                Log.Err("BadImageFormat: a ocgcore.dll e x64 e o processo esta em 32-bit. Rebuild com PlatformTarget x64.");
                return 3;
            }

            // Modo servidor de treino (web): sobe o HttpListener e transmite via SSE.
            if (serve)
            {
                WebServer.Run(streamingAssets);
                return 0;
            }

            // Sonda do formato de resposta do SELECT_TRIBUTE/SELECT_CARD.
            if (Array.IndexOf(args, "--probe-tribute") >= 0)
            {
                ProbeTribute.Run(streamingAssets);
                return 0;
            }

            // Mesma sonda, com espaco de busca exaustivo.
            if (Array.IndexOf(args, "--brute-tribute") >= 0)
            {
                ProbeTribute.Run(streamingAssets, brute: true);
                return 0;
            }

            // Teste de aceitacao das invocacoes especiais.
            if (Array.IndexOf(args, "--test-summons") >= 0)
                return TestSummons.Run(streamingAssets);

            // Teste das regras do NPC do Teste de Batalha.
            if (Array.IndexOf(args, "--test-npc") >= 0)
                return TestNpc.Run(streamingAssets);

            // Sonda do layout do SELECT_IDLECMD.
            if (Array.IndexOf(args, "--probe-idle") >= 0)
            {
                ProbeIdle.Run(streamingAssets);
                return 0;
            }

            // Sonda da mudanca de posicao.
            if (Array.IndexOf(args, "--probe-pos") >= 0)
            {
                ProbePos.Run(streamingAssets);
                return 0;
            }

            // Harness de diagnóstico do protocolo (console).
            if (Array.IndexOf(args, "--selfplay") >= 0)
            {
                SelfPlay.Run(streamingAssets);
                return 0;
            }

            var dbManager = new DatabaseManager(streamingAssets);
            var scriptManager = new ScriptManager(streamingAssets);

            _cardReaderDelegate = dbManager.CardReaderCallback;
            _scriptReaderDelegate = scriptManager.ScriptReaderCallback;

            var options = new OCG_DuelOptions
            {
                seed0 = 12345,
                flags = 0,
                team1 = new OCG_Player { startingLP = 8000, startingDrawCount = 5, drawCountPerTurn = 1 },
                team2 = new OCG_Player { startingLP = 8000, startingDrawCount = 5, drawCountPerTurn = 1 },
                cardReader = Marshal.GetFunctionPointerForDelegate(_cardReaderDelegate),
                scriptReader = Marshal.GetFunctionPointerForDelegate(_scriptReaderDelegate),
                logHandler = IntPtr.Zero,
                cardReaderDone = IntPtr.Zero,
                enableUnsafeLibraries = 0
            };

            int status = YgoCoreAPI.OCG_CreateDuel(out IntPtr duel, ref options);
            if (status != 0 || duel == IntPtr.Zero)
            {
                Log.Err($"Falha ao criar o duelo. Codigo: {status}");
                return 4;
            }
            Log.Info($"Duelo criado no ponteiro: {duel}");

            // Mesmo deck misto do prototipo Unity, para paridade de saida.
            uint[] mixedDeck =
            {
                89631139, // Blue-Eyes White Dragon
                46986414, // Dark Magician
                83764718, // Monster Reborn
                70903634  // Right Arm of the Forbidden One (o comentario da Unity dizia "Mirror Force" — era engano)
            };

            InjectDeck(duel, team: 0, controller: 0, deck: mixedDeck, count: 40);
            InjectDeck(duel, team: 1, controller: 1, deck: mixedDeck, count: 40);
            Log.Info("Baralhos de teste injetados (40 + 40).");

            YgoCoreAPI.OCG_StartDuel(duel);
            Log.Info("Duelo iniciado. Rodando o loop de processo...\n");

            RunProcessLoop(duel);

            YgoCoreAPI.OCG_DestroyDuel(duel);
            Log.Info("\nDuelo finalizado e memoria liberada.");
            return 0;
        }

        private static void InjectDeck(IntPtr duel, byte team, byte controller, uint[] deck, int count)
        {
            for (int i = 0; i < count; i++)
            {
                var card = new OCG_NewCardInfo
                {
                    team = team,
                    duelist = 0,
                    code = deck[i % deck.Length],
                    con = controller,
                    loc = 1, // LOCATION_DECK
                    seq = 0,
                    pos = 8  // POS_FACEDOWN_DEFENSE
                };
                YgoCoreAPI.OCG_DuelNewCard(duel, ref card);
            }
        }

        /// <summary>
        /// Equivalente ao Update() da Unity, mas em laco: processa passos ate o
        /// motor terminar (END) ou pedir uma resposta (AWAITING). Para o milestone
        /// paramos na primeira decisao — ninguem responde ainda.
        /// </summary>
        private static void RunProcessLoop(IntPtr duel)
        {
            const int maxIterations = 10000; // trava de seguranca contra loop infinito
            for (int iter = 0; iter < maxIterations; iter++)
            {
                int status = YgoCoreAPI.OCG_DuelProcess(duel);

                // Drena o buffer de mensagens gerado neste passo.
                IntPtr msgPtr = YgoCoreAPI.OCG_DuelGetMessage(duel, out uint length);
                if (msgPtr != IntPtr.Zero && length > 0)
                {
                    byte[] messageData = new byte[length];
                    Marshal.Copy(msgPtr, messageData, 0, (int)length);
                    MessageParser.Parse(messageData);
                }

                if (status == OCG_DUEL_STATUS_END)
                {
                    Log.Info("\n[loop] Motor sinalizou FIM do duelo.");
                    return;
                }
                if (status == OCG_DUEL_STATUS_AWAITING)
                {
                    Log.Info("\n[loop] Motor aguardando uma resposta do jogador (primeira decisao alcancada).");
                    Log.Info("[loop] Milestone atingido: duelo criado, maos compradas, mensagens impressas.");
                    return;
                }
                // OCG_DUEL_STATUS_CONTINUE -> processa o proximo passo
            }
            Log.Warn("[loop] Atingido o teto de iteracoes sem END/AWAITING.");
        }

        /// <summary>
        /// Descobre o caminho de duel_academy/Assets/StreamingAssets. Ordem:
        /// 1) primeiro argumento; 2) env YGODEMO_PATH; 3) busca subindo a arvore
        /// a partir do executavel e do diretorio atual.
        /// </summary>
        private static string ResolveStreamingAssets(string[] args)
        {
            if (args.Length > 0 && HasCdb(args[0])) return args[0];

            string env = Environment.GetEnvironmentVariable("YGODEMO_PATH");
            if (!string.IsNullOrEmpty(env) && HasCdb(env)) return env;

            foreach (string start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
            {
                var dir = new DirectoryInfo(start);
                while (dir != null)
                {
                    string candidate = Path.Combine(dir.FullName, "duel_academy", "Assets", "StreamingAssets");
                    if (HasCdb(candidate)) return candidate;
                    dir = dir.Parent;
                }
            }
            return null;
        }

        private static bool HasCdb(string streamingAssets) =>
            File.Exists(Path.Combine(streamingAssets, "YGODemo", "cards.cdb"));
    }
}
