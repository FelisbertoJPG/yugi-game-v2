using System;
using System.IO;
using System.Linq;
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

            // Suite do instalador/auto-updater. Vem ANTES de tudo de proposito:
            // nao toca no ocgcore nem precisa dos StreamingAssets, entao roda numa
            // maquina que nem tem o cards.cdb. Monta um Release falso no %TEMP%.
            if (Array.IndexOf(args, "--test-update") >= 0)
                return TestUpdate.Run();

            // Instala o Release REAL (dist\release\, recem-gerado pelo
            // publish-release.ps1) numa raiz descartavel e confere o re-scan.
            // Ultimo passo antes de -Publish.
            // Instala o Release publicado DE VERDADE, pela rede, com o token
            // embutido. Prova o transporte (API do asset + Accept: octet-stream +
            // redirect para o CDN), que nenhum outro teste alcanca.
            if (Array.IndexOf(args, "--test-remote") >= 0)
                return TestUpdate.RunRemote();

            // Projecao por espectador (duelo entre dois humanos). Nao toca no
            // ocgcore: monta eventos a mao e confere o que cada lado recebe.
            if (Array.IndexOf(args, "--test-visao") >= 0)
                return TestVisao.Run();

            // O contrario do --test-remote: a rede FORA do ar. Fonte inexistente,
            // manifesto corrompido, asset que some no meio — nada disso pode
            // travar o boot nem instalar meia atualizacao.
            if (Array.IndexOf(args, "--test-offline") >= 0)
                return TestOffline.Run();

            // A coreografia da troca do proprio exe, com um exe de mentira no
            // %TEMP%: o .bat roda de verdade, espera um PID morrer e copia por
            // cima. Nao encosta no binario que esta rodando o teste.
            if (Array.IndexOf(args, "--test-selfupdate") >= 0)
                return TestSelfUpdate.Run();

            int iRel = Array.IndexOf(args, "--test-release");
            if (iRel >= 0)
                return TestUpdate.RunRelease(iRel + 1 < args.Length
                    ? args[iRel + 1]
                    : Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "dist", "release"));

            bool serve = Array.IndexOf(args, "--serve") >= 0;

            // --app: o jogo inteiro num processo so' (duelo + front + navegador),
            // que e' o modo do executavel distribuido. Sem Node, sem launcher.
            //
            // Com payload embutido e sem argumento nenhum, --app e' o padrao: quem
            // recebeu o arquivo vai dar dois cliques, nao abrir um terminal.
            bool app = Array.IndexOf(args, "--app") >= 0
                       || (args.Length == 0 && Payload.Exists);
            string appRoot = null;
            if (app)
            {
                Console.Title = "Duel Academy";
                Log.Info("=== Duel Academy ===");
                appRoot = Payload.EnsureExtracted() ?? FindProjectRoot();
                if (appRoot == null)
                {
                    Log.Err("Nao achei os arquivos do jogo (web/ + duel_academy/).");
                    Log.Err("Este executavel nao foi empacotado: rode-o de dentro da pasta do projeto.");
                    return Segurar(2);
                }
                // O ResolveStreamingAssets abaixo respeita YGODEMO_PATH, entao
                // apontar por aqui evita duplicar a logica de busca.
                Environment.SetEnvironmentVariable(
                    "YGODEMO_PATH", Path.Combine(appRoot, "duel_academy", "Assets", "StreamingAssets"));
            }
            else
            {
                Log.Info(serve
                    ? "=== duel-server (modo servidor de treino / web) ==="
                    : "=== duel-server (ocgcore edo9300, sem Unity) ===");
            }

            // 1. Localizar os StreamingAssets (cards.cdb + scripts lua)
            string streamingAssets = ResolveStreamingAssets(args);
            if (streamingAssets == null)
            {
                Log.Err("Nao encontrei duel_academy/Assets/StreamingAssets/YGODemo/cards.cdb.");
                Log.Err("Passe o caminho de StreamingAssets como primeiro argumento, ou defina YGODEMO_PATH.");
                return app ? Segurar(2) : 2;
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
                return app ? Segurar(3) : 3;
            }
            catch (BadImageFormatException)
            {
                Log.Err("BadImageFormat: a ocgcore.dll e x64 e o processo esta em 32-bit. Rebuild com PlatformTarget x64.");
                return app ? Segurar(3) : 3;
            }

            // Modo aplicativo: um processo atende as duas portas (front e duelo) e
            // abre o navegador sozinho. A janela fica aberta porque ELA e' o jogo:
            // fechar o console encerra o servidor, que e' o comportamento esperado
            // de um programa avulso.
            //
            // --lan: por padrao o HttpListener escuta so' em localhost (nada de
            // fora do PC alcanca). Com --lan ele escuta em TODAS as interfaces
            // (host "+"), pra um aparelho na mesma rede (o app mobile, cliente
            // fino deste mesmo servidor) conseguir falar com /start,/respond e
            // ler /__decks,/__store (GET — StaticServer.cs continua recusando
            // POST fora de localhost, entao gravar continua so' no PC). Escutar
            // em "+" no Windows pode exigir uma reserva de URL feita UMA vez,
            // como administrador (`netsh http add urlacl ...` — a mensagem de
            // erro completa, com a sintaxe certa pro PowerShell, já aparece
            // sozinha se a porta recusar por falta de permissao).
            if (app)
            {
                bool lan = Array.IndexOf(args, "--lan") >= 0;
                string bindHost = lan ? "+" : "localhost";
                string duelBindUrl = $"http://{bindHost}:8770/";
                string frontBindUrl = $"http://{bindHost}:8080/";

                // Checagem de atualizacao, ANTES de abrir o navegador. Timeout
                // curto e falha silenciosa: estar offline ou com o GitHub fora do
                // ar nao pode impedir ninguem de jogar o que ja tem instalado.
                // `--sem-update` pula (util pra depurar o front sem rede nenhuma).
                bool temUpdate = false;
                if (Payload.Exists && Array.IndexOf(args, "--sem-update") < 0)
                {
                    temUpdate = Update.UpdateService.Checar(appRoot, TimeSpan.FromSeconds(8));

                    // Se o proprio executavel esta velho, trocar os arquivos do
                    // jogo sem trocar o exe deixa os dois fora de sincronia.
                    if (Update.UpdateService.InstaladorDesatualizado)
                        Log.Info("ha' uma versao nova do proprio Duel Academy.exe");
                }

                bool subiu = WebServer.Run(streamingAssets,
                    url: duelBindUrl,
                    webRoot: appRoot,
                    extraUrl: frontBindUrl,
                    onReady: () =>
                    {
                        if (lan) ImprimeEnderecosLan();
                        if (Array.IndexOf(args, "--no-browser") >= 0) return;
                        AbrirNavegador(FrontUrl + (temUpdate ? "web/atualizando.html" : "web/index.html"));
                    });

                // Nao subiu: ate' agora o processo saia com 0 e a janela fechava
                // antes de qualquer um conseguir ler. Do lado do jogador o jogo
                // "simplesmente nao abre" — e a unica explicacao ficava no log,
                // que ninguem le'. Pior pelo launcher, que abre sem janela
                // nenhuma: nao havia console onde a mensagem pudesse aparecer.
                if (!subiu)
                {
                    Aviso.PortaOcupada($"{duelBindUrl} / {frontBindUrl}",
                                       "outro processo ja' esta usando a porta.");
                    return Segurar(4);
                }
                return 0;
            }

            // Modo servidor de treino (web): sobe o HttpListener e transmite via SSE.
            // (Este modo nao serve web/ sozinho — precisa do `npm run dev` do
            // Node ao lado; --lan aqui so' abre a porta do duelo em si.)
            if (serve)
            {
                bool lanServe = Array.IndexOf(args, "--lan") >= 0;
                WebServer.Run(streamingAssets, url: $"http://{(lanServe ? "+" : "localhost")}:8770/",
                    onReady: lanServe ? ImprimeEnderecosLan : null);
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

            // Trava de atualizacao durante o duelo: o cards.cdb fica aberto pelo
            // SQLite enquanto se joga, e trocar os arquivos debaixo do motor
            // deixaria o jogo instalado pela metade. Precisa do cards.cdb de
            // verdade, por isso vem depois do ResolveStreamingAssets.
            if (Array.IndexOf(args, "--test-update-duelo") >= 0)
                return TestUpdateDuelo.Run(streamingAssets);

            // Modo multiplayer: os dois lados decidem, ninguem joga pelo outro — e
            // o duelo contra o NPC continua exatamente como era.
            // Duelos concorrentes no mesmo processo (base da arena).
            if (Array.IndexOf(args, "--test-salas") >= 0)
                return TestSalas.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-multiplayer") >= 0)
                return TestMultiplayer.Run(streamingAssets);

            // Teste de aceitacao das invocacoes especiais.
            if (Array.IndexOf(args, "--test-summons") >= 0)
                return TestSummons.Run(streamingAssets);

            // Teste das regras do NPC do Teste de Batalha.
            if (Array.IndexOf(args, "--test-npc") >= 0)
                return TestNpc.Run(streamingAssets);

            // Teste de aceitacao da Battle Phase.
            if (Array.IndexOf(args, "--test-battle") >= 0)
                return TestBattle.Run(streamingAssets);

            // Teste de aceitacao da invocacao por Fusao (Extra Deck).
            if (Array.IndexOf(args, "--test-fusion") >= 0)
                return TestFusion.Run(streamingAssets);

            // Teste da saida do cemiterio (contrato do fromLoc no MSG_MOVE).
            if (Array.IndexOf(args, "--test-grave") >= 0)
                return TestGrave.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-chain") >= 0)
                return TestChain.Run(streamingAssets);

            // Teste das armadilhas de CONTRA (negacao) do NPC: o que vale negar,
            // com qual carta e a que preco — e, no duelo real, que o contexto da
            // janela de corrente (o que foi invocado/ativado) chega mesmo ao NPC.
            if (Array.IndexOf(args, "--test-counter") >= 0)
                return TestCounter.Run(streamingAssets);

            // Teste da LEITURA do NPC (mao do oponente + cartas baixadas): a
            // batalha contra o setado, a isca da negacao, a remocao direcionada e
            // a regra de nao se estender contra varredura conhecida.
            if (Array.IndexOf(args, "--test-leitura") >= 0)
                return TestLeitura.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-equip") >= 0)
                return TestEquip.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-kaiba") >= 0)
                return TestKaiba.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-dust") >= 0)
                return TestDust.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-joey") >= 0)
                return TestJoey.Run(streamingAssets);

            // Teste de aceitacao do Bonus de Campo (editor de tabuleiro): a magia
            // de campo injetada de verdade aplica o efeito dela (Forest +200 ATK
            // a Inseto), nao e' simulacao.
            if (Array.IndexOf(args, "--test-fieldbonus") >= 0)
                return TestFieldBonus.Run(streamingAssets);

            // Teste de aceitacao da Invocacao-Sincro (Extra Deck via spsummon).
            if (Array.IndexOf(args, "--test-synchro") >= 0)
                return TestSynchro.Run(streamingAssets);

            // Teste de aceitacao da Invocacao-Xyz (Extra Deck via spsummon).
            if (Array.IndexOf(args, "--test-xyz") >= 0)
                return TestXyz.Run(streamingAssets);

            // Teste de aceitacao do pacote Toon: NpcBrain ativa Toon World e
            // invoca especialmente os Toons "classicos" da mao (spsummon).
            if (Array.IndexOf(args, "--test-toon") >= 0)
                return TestToon.Run(streamingAssets);

            // Teste de aceitacao das cartas COM EFEITO que o deck do Weevil
            // trouxe pra Lista 1 (casulo/mariposas, Insect Imitation, o
            // equipamento de Inseto): o Lua delas roda de verdade no motor.
            if (Array.IndexOf(args, "--test-weevil") >= 0)
                return TestWeevil.Run(streamingAssets);

            // Teste de aceitacao dos dois ciclos de equipamento classico da
            // Lista 1 (+300 por Tipo, +400/-200 por Atributo): cada carta
            // aplica o bonus no alvo certo, ATK consultado no motor.
            if (Array.IndexOf(args, "--test-equip-classicos") >= 0)
                return TestEquipClassicos.Run(streamingAssets);

            // Teste de aceitacao: o NpcBrain sabe pilotar o COMBO do Wevil sozinho
            // (Cocoon of Evolution -> evolucao das mariposas), nao so as cartas
            // rodarem quando alguem manda ativar (isso e' o --test-weevil).
            if (Array.IndexOf(args, "--test-weevil-npc") >= 0)
                return TestWeevilNpc.Run(streamingAssets);

            // Teste de aceitacao do pacote "Normal grande" do deck do Pegasus:
            // o NpcBrain busca (Summoner's Art) e Invoca Especialmente
            // (Ancient Rules) um Normal Nv5+ sozinho, escolhendo o de maior ATK.
            if (Array.IndexOf(args, "--test-pegasus") >= 0)
                return TestPegasus.Run(streamingAssets);

            if (Array.IndexOf(args, "--test-armory") >= 0)
                return TestArmory.Run(streamingAssets);

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

            // Sonda da Battle Phase.
            if (Array.IndexOf(args, "--probe-battle") >= 0)
            {
                ProbeBattle.Run(streamingAssets);
                return 0;
            }

            // Sonda do SELECT_CHAIN (corrente das armadilhas).
            if (Array.IndexOf(args, "--probe-chain") >= 0)
                return ProbeChain.Run(streamingAssets);

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
        private const string FrontUrl = "http://localhost:8080/";

        /// <summary>
        /// Raiz do jogo quando NAO ha payload embutido (rodando do repositorio).
        /// Procura as duas pastas que o modo --app precisa servir.
        /// </summary>
        private static string FindProjectRoot()
        {
            foreach (string start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
            {
                var dir = new DirectoryInfo(start);
                while (dir != null)
                {
                    if (Directory.Exists(Path.Combine(dir.FullName, "web")) &&
                        Directory.Exists(Path.Combine(dir.FullName, "duel_academy")))
                        return dir.FullName;
                    dir = dir.Parent;
                }
            }
            return null;
        }

        /// <summary>
        /// Lista os IPs da(s) rede(s) local(is) do PC — sem isso o usuario teria
        /// que descobrir sozinho (`ipconfig`) qual endereco digitar nas
        /// Configuracoes do app mobile. So' chamado com `--lan`.
        /// </summary>
        private static void ImprimeEnderecosLan()
        {
            Log.Info("--lan ligado: escutando em todas as interfaces de rede.");
            try
            {
                var ips = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
                    .Where(ni => ni.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up
                              && ni.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
                    .SelectMany(ni => ni.GetIPProperties().UnicastAddresses)
                    .Where(ip => ip.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    .Select(ip => ip.Address.ToString())
                    .Distinct();
                foreach (var ip in ips)
                    Log.Info($"  no app mobile, servidor: {ip}:8770");
            }
            catch (Exception e)
            {
                Log.Warn($"nao consegui listar os IPs da rede ({e.Message}). Use `ipconfig` e ache o IPv4.");
            }
        }

        /// <summary>
        /// Caminhos de instalação padrão do Edge/Chrome no Windows — checar
        /// arquivo em vez de mexer no registro, no mesmo espírito pragmático
        /// do resto do launcher (sem dependência nova, sem P/Invoke extra).
        /// </summary>
        private static readonly string[] NavegadoresChromium =
        {
            @"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
            @"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
            @"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
            @"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        };

        /// <summary>
        /// Abre o jogo como janela de app (Edge/Chrome com `--app=`): sem barra
        /// de endereço, sem abas — parece um executável de verdade, não uma aba
        /// de navegador. Sem Edge/Chrome instalado (raro no Windows 11, onde o
        /// Edge vem de fábrica), cai para o navegador padrão do sistema.
        /// </summary>
        private static void AbrirNavegador(string url)
        {
            Console.WriteLine();
            Log.Info($"abrindo {url}");
            Log.Info("DEIXE ESTA JANELA ABERTA — fechar aqui encerra o jogo.");
            Console.WriteLine();

            string chromium = NavegadoresChromium
                .Select(Environment.ExpandEnvironmentVariables)
                .FirstOrDefault(File.Exists);
            if (chromium != null)
            {
                try
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = chromium,
                        Arguments = $"--app=\"{url}\" --window-size=1400,900",
                        UseShellExecute = false,
                    });
                    return;
                }
                catch (Exception e)
                {
                    Log.Warn($"nao consegui abrir {Path.GetFileName(chromium)} em modo app ({e.Message}); tentando o navegador padrao.");
                }
            }

            try
            {
                System.Diagnostics.Process.Start(
                    new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception e)
            {
                Log.Warn($"nao consegui abrir o navegador ({e.Message}).");
                Log.Warn($"Abra manualmente: {url}");
            }
        }

        /// <summary>
        /// Segura a janela antes de sair. Sem isto um erro no modo --app aparece e
        /// some junto com o console, e quem recebeu o executavel so' ve' um piscar
        /// de terminal — exatamente o relato que originou este modo.
        /// </summary>
        private static int Segurar(int code)
        {
            Console.WriteLine();
            Console.WriteLine("  (pressione qualquer tecla para fechar)");
            try { Console.ReadKey(true); } catch { System.Threading.Thread.Sleep(8000); }
            return code;
        }

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
