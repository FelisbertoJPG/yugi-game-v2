using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

// classic-duels — atalho para subir o ambiente sem linha de comando.
//
// Fluxo: sobe o servidor estatico (8080), espera 200; sobe o duel-server
// (8770), espera 200 no /health; confere a URL final; abre o navegador; sai.
//
// Os servidores sobem DESACOPLADOS (ShellExecute + janela oculta), entao eles
// sobrevivem ao launcher fechar — que e' justamente o objetivo. Os PIDs ficam
// gravados para o `--stop` conseguir derrubar so' o que este launcher subiu,
// em vez de matar todo processo `node` da maquina.

namespace Launcher;

internal static class Program
{
    const string FrontUrl = "http://localhost:8080";
    const string DuelUrl = "http://localhost:8770";
    const string FrontProbe = FrontUrl + "/web/index.html";
    const string DuelProbe = DuelUrl + "/health";
    const string OpenPage = FrontUrl + "/web/index.html";
    const string FrontShutdown = FrontUrl + "/__shutdown";
    const string DuelShutdown = DuelUrl + "/shutdown";

    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };
    static string _root;
    static string _pidFile;

    static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        // O mesmo codigo gera dois executaveis: classic-duels.exe (liga) e
        // classic-duels-stop.exe (desliga), este ultimo compilado com STOP_MODE.
#if STOP_MODE
        bool stop = true;
#else
        bool stop = Has(args, "--stop");
#endif
        bool keep = Has(args, "--keep");
        bool noBrowser = Has(args, "--no-browser");

        Console.Title = stop ? "Classic Duels — desligar" : "Classic Duels";
        Banner(stop);

        _root = FindRepoRoot();
        if (_root == null)
        {
            Fail("Nao achei a raiz do projeto (procurei por package.json + ygo-data/ + duel-server/).");
            Console.WriteLine("  Deixe o classic-duels.exe dentro da pasta do projeto.");
            return Hold(2, true);
        }
        _pidFile = Path.Combine(Path.GetTempPath(), "classic-duels-launcher.json");
        Info($"projeto: {_root}");

        if (stop) return StopAll();

        // ---- 1. servidor estatico (front) --------------------------------
        Step(1, "servidor do front (porta 8080)");
        if (!EnsureServer(
                probe: FrontProbe,
                alreadyUpMsg: "ja estava no ar",
                start: StartFront,
                name: "front",
                waitSeconds: 20))
            return Hold(3, true);

        // ---- 2. servidor de duelo ----------------------------------------
        Step(2, "servidor de duelo (porta 8770)");
        if (!EnsureServer(
                probe: DuelProbe,
                alreadyUpMsg: "ja estava no ar",
                start: StartDuelServer,
                name: "duel-server",
                waitSeconds: 45))
            return Hold(4, true);

        // ---- 3. conferir a pagina final ----------------------------------
        Step(3, "conferindo a home");
        var (ok, code) = Probe(OpenPage).GetAwaiter().GetResult();
        if (!ok)
        {
            Fail($"{OpenPage} respondeu {code}.");
            Console.WriteLine("  Os servidores subiram, mas a pagina nao. web/index.html sumiu?");
            return Hold(5, true);
        }
        Ok($"200 OK  {OpenPage}");

        // ---- 4. abrir o navegador ----------------------------------------
        if (!noBrowser)
        {
            Step(4, "abrindo a janela do jogo");
            try
            {
                OpenAsAppWindow(OpenPage);
                Ok("janela aberta");
            }
            catch (Exception e)
            {
                Warn($"nao consegui abrir a janela do jogo: {e.Message}");
                Console.WriteLine($"  Abra manualmente: {OpenPage}");
            }
        }

        Console.WriteLine();
        Ok("tudo pronto.");
        Console.WriteLine($"  front       {FrontUrl}");
        Console.WriteLine($"  duel-server {DuelUrl}");
        Console.WriteLine("  para derrubar:  classic-duels.exe --stop");

        return Hold(0, keep);
    }

    // ------------------------------------------------------------------ passos

    /// <summary>Sobe o servidor se ainda nao estiver de pe e espera o 200.</summary>
    static bool EnsureServer(string probe, string alreadyUpMsg,
                             Func<Process> start, string name, int waitSeconds)
    {
        var (up, _) = Probe(probe).GetAwaiter().GetResult();
        if (up)
        {
            Ok($"{alreadyUpMsg} — 200 OK  {probe}");
            return true;
        }

        Process p;
        try { p = start(); }
        catch (Exception e) { Fail($"nao consegui iniciar o {name}: {e.Message}"); return false; }

        if (p != null) RememberPid(p.Id, name);

        Console.Write($"  aguardando {probe} ");
        var sw = Stopwatch.StartNew();
        while (sw.Elapsed.TotalSeconds < waitSeconds)
        {
            // Se o processo morreu, nao adianta seguir esperando.
            if (p is { HasExited: true })
            {
                Console.WriteLine();
                Fail($"o {name} encerrou sozinho (codigo {p.ExitCode}).");
                if (name == "duel-server")
                    Console.WriteLine("  Rode `cd duel-server; dotnet run -- --serve` para ver o erro.");
                return false;
            }
            Thread.Sleep(500);
            Console.Write(".");
            var (ok2, _) = Probe(probe).GetAwaiter().GetResult();
            if (ok2)
            {
                Console.WriteLine();
                Ok($"200 OK  {probe}  ({sw.Elapsed.TotalSeconds:0.0}s)");
                return true;
            }
        }
        Console.WriteLine();
        Fail($"o {name} nao respondeu em {waitSeconds}s.");
        return false;
    }

    static Process StartFront()
    {
        string serve = Path.Combine(_root, "tools", "serve.mjs");
        if (!File.Exists(serve)) throw new FileNotFoundException($"nao achei {serve}");
        Info("iniciando: node tools/serve.mjs");
        return Spawn("node", $"\"{serve}\"", _root);
    }

    static Process StartDuelServer()
    {
        string exe = FindDuelServerExe();
        if (exe == null)
        {
            Info("duel-server ainda nao compilado — rodando `dotnet build` (pode demorar)");
            var build = Spawn("dotnet", "build -v q --nologo",
                              Path.Combine(_root, "duel-server"), hidden: false, wait: true);
            if (build == null || build.ExitCode != 0)
                throw new Exception("`dotnet build` falhou. Rode manualmente para ver o erro.");
            exe = FindDuelServerExe()
                  ?? throw new Exception("compilou, mas nao achei o duel-server.exe");
        }
        // Mostrar qual build subiu evita perder tempo achando que o código novo
        // não funciona quando na verdade nem foi ele que rodou.
        var quando = File.GetLastWriteTime(exe);
        string cfg = exe.Contains("Release", StringComparison.OrdinalIgnoreCase) ? "Release" : "Debug";
        Info($"iniciando: duel-server.exe --serve  [{cfg}, compilado {quando:dd/MM HH:mm}]");
        string dir = Path.GetDirectoryName(exe);
        try { return Spawn(exe, "--serve", dir); }
        catch (Win32Exception e) when (e.NativeErrorCode == ErrorCancelled)
        {
            // Marca da Web (ver OfferUnblock). Com a permissao do usuario, tiramos
            // a marca e tentamos de novo — uma vez so'.
            if (!OfferUnblock(dir))
                throw new Exception(
                    "o Windows bloqueou o duel-server.exe (Marca da Web) e a correcao nao foi aplicada. " +
                    "Para desbloquear na mao: clique direito no exe > Propriedades > Desbloquear.");
            return Spawn(exe, "--serve", dir);
        }
    }

    // ------------------------------------------------------- Marca da Web (MOTW)

    /// <summary>Win32 ERROR_CANCELLED — "A operacao foi cancelada pelo usuario".</summary>
    const int ErrorCancelled = 1223;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool DeleteFileW(string lpFileName);

    /// <summary>
    /// Arquivo que veio de fora da maquina (zip baixado, pendrive, pasta de rede)
    /// carrega o fluxo alternativo `Zone.Identifier`, a "Marca da Web". O
    /// ShellExecute entao pede confirmacao ao usuario — mas o launcher sobe os
    /// servidores com a janela OCULTA, entao nao ha' onde clicar e o Windows
    /// devolve na hora o erro 1223, "cancelada pelo usuario", sem nunca ter
    /// perguntado nada. Tirar o fluxo e' exatamente o que o botao "Desbloquear"
    /// das Propriedades do arquivo faz — nao mexe no conteudo de nada.
    ///
    /// Como isso apaga um pedaco de metadado do disco, perguntamos antes.
    /// </summary>
    static bool OfferUnblock(string dir)
    {
        Console.WriteLine();
        Warn("o Windows bloqueou este executavel: e' a Marca da Web.");
        Console.WriteLine("  Os arquivos vieram de fora desta maquina (zip baixado, pendrive, rede),");
        Console.WriteLine("  entao o Windows pede confirmacao para roda-los. Como o launcher sobe os");
        Console.WriteLine("  servidores em janela oculta, ninguem tem onde clicar e ele ja' cancela.");
        Console.WriteLine();
        Console.WriteLine($"  Solucao: remover a marca dos arquivos de {dir}");
        Console.WriteLine("  (o mesmo que Propriedades > Desbloquear; o conteudo nao muda).");
        Console.WriteLine();

        if (!AskYesNo("  Aplicar a solucao agora?")) { Info("nada foi alterado."); return false; }

        int n = 0;
        try
        {
            foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                if (DeleteFileW(f + ":Zone.Identifier")) n++;
        }
        catch (Exception e) { Fail($"nao consegui desbloquear tudo: {e.Message}"); }

        if (n == 0)
        {
            Warn("nenhuma marca encontrada — o bloqueio pode ser do antivirus, nao da Marca da Web.");
            return false;
        }
        Ok($"{n} arquivo(s) desbloqueado(s) — tentando subir de novo");
        return true;
    }

    /// <summary>
    /// Pergunta S/N. Sem console interativo (saida redirecionada, duplo clique
    /// perdendo o stdin) a resposta e' NAO: melhor falhar com a explicacao na
    /// tela do que mexer nos arquivos do usuario sem ele ter dito nada.
    /// </summary>
    static bool AskYesNo(string question)
    {
        Console.Write($"{question} [S/N] ");
        try
        {
            while (true)
            {
                var k = Console.ReadKey(true).KeyChar;
                if (k is 's' or 'S' or 'y' or 'Y') { Console.WriteLine("S"); return true; }
                if (k is 'n' or 'N' or (char)27) { Console.WriteLine("N"); return false; }
            }
        }
        catch (InvalidOperationException)
        {
            var line = Console.ReadLine();
            bool sim = line != null && (line.StartsWith("s", StringComparison.OrdinalIgnoreCase) ||
                                        line.StartsWith("y", StringComparison.OrdinalIgnoreCase));
            if (line == null) Console.WriteLine("N (sem console interativo)");
            return sim;
        }
    }

    /// <summary>
    /// Procura o exe compilado, sempre o MAIS RECENTE.
    ///
    /// Não preferir Release: uma versão antiga desta função priorizava Release e
    /// acabou subindo um binário de horas antes, sem as mudanças recém-compiladas
    /// em Debug — o comportamento novo simplesmente não aparecia, sem nenhum erro
    /// visível. Num ciclo de desenvolvimento o que importa é o build mais novo.
    /// </summary>
    static string FindDuelServerExe()
    {
        string bin = Path.Combine(_root, "duel-server", "bin");
        if (!Directory.Exists(bin)) return null;
        return Directory.EnumerateFiles(bin, "duel-server.exe", SearchOption.AllDirectories)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }

    /// <summary>
    /// Caminhos de instalacao padrao do Edge/Chrome no Windows — checar arquivo
    /// em vez de mexer no registro, pragmatico como o resto deste launcher.
    /// </summary>
    static readonly string[] ChromiumPaths =
    {
        @"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
        @"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        @"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        @"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    };

    /// <summary>
    /// Abre o jogo como janela de app (Edge/Chrome com `--app=`): sem barra de
    /// endereco nem abas — parece um executavel de verdade, nao uma aba de
    /// navegador. Sem Edge/Chrome instalado cai para o navegador padrao.
    /// </summary>
    static void OpenAsAppWindow(string url)
    {
        string chromium = ChromiumPaths
            .Select(Environment.ExpandEnvironmentVariables)
            .FirstOrDefault(File.Exists);
        if (chromium != null)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = chromium,
                    Arguments = $"--app=\"{url}\" --window-size=1400,900",
                    UseShellExecute = false,
                });
                return;
            }
            catch (Exception e)
            {
                Warn($"nao consegui abrir {Path.GetFileName(chromium)} em modo app ({e.Message}); tentando o navegador padrao.");
            }
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    // ------------------------------------------------------------------ processo

    /// <summary>
    /// `hidden` usa ShellExecute, que cria o processo desacoplado do nosso
    /// console — sem isso, fechar o terminal do launcher levaria os servidores
    /// junto, que e' exatamente o que nao queremos.
    /// </summary>
    static Process Spawn(string file, string args, string cwd,
                         bool hidden = true, bool wait = false)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = args,
            WorkingDirectory = cwd,
            UseShellExecute = hidden,
            CreateNoWindow = !hidden,
            WindowStyle = hidden ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal,
        };
        var p = Process.Start(psi);
        if (wait && p != null) p.WaitForExit();
        return p;
    }

    static void RememberPid(int pid, string name)
    {
        try
        {
            var list = LoadPids();
            list.RemoveAll(e => e.Name == name);
            list.Add(new PidEntry { Name = name, Pid = pid, StartedAt = DateTime.Now });
            File.WriteAllText(_pidFile, JsonSerializer.Serialize(list));
        }
        catch { /* o --stop tem fallback por porta; nao vale derrubar o launcher por isso */ }
    }

    static List<PidEntry> LoadPids()
    {
        try
        {
            if (!File.Exists(_pidFile)) return new();
            return JsonSerializer.Deserialize<List<PidEntry>>(File.ReadAllText(_pidFile)) ?? new();
        }
        catch { return new(); }
    }

    /// <summary>
    /// Desligamento limpo: pede a cada servidor que encerre sozinho (o duel-server
    /// aproveita para liberar a memoria nativa do ocgcore) e so' recorre ao kill
    /// se ele nao obedecer. A ordem importa pouco, mas o duel-server vai primeiro
    /// por ser o que tem recurso nativo para soltar.
    /// </summary>
    static int StopAll()
    {
        Step(1, "encerrando os servidores");

        var targets = new[]
        {
            ("duel-server", DuelShutdown, DuelProbe),
            ("front",       FrontShutdown, FrontProbe),
        };

        var pids = LoadPids();
        var teimosos = new List<string>();
        int agiu = 0;

        foreach (var (name, shutdownUrl, probe) in targets)
        {
            var (up, _) = Probe(probe).GetAwaiter().GetResult();
            if (!up) { Info($"{name} ja estava parado"); continue; }

            agiu++;
            AskShutdown(shutdownUrl).GetAwaiter().GetResult();
            if (WaitDown(probe, 8))
            {
                Ok($"{name} encerrou de forma limpa");
                continue;
            }
            Warn($"{name} nao respondeu ao pedido de encerramento");
            teimosos.Add(name);
        }

        // Ultimo recurso, so' para quem ignorou o pedido.
        foreach (var name in teimosos)
        {
            var e = pids.Find(x => x.Name == name);
            if (e == null) { Warn($"{name} continua no ar e nao tenho o pid dele"); continue; }
            try
            {
                var p = Process.GetProcessById(e.Pid);
                Info($"forcando o encerramento do {name} (pid {e.Pid})");
                p.Kill(entireProcessTree: true);
                p.WaitForExit(5000);
                Ok($"{name} encerrado a forca");
            }
            catch (ArgumentException) { Info($"{name} (pid {e.Pid}) ja tinha saido"); }
            catch (Exception ex) { Fail($"{name} (pid {e.Pid}): {ex.Message}"); }
        }

        try { File.Delete(_pidFile); } catch { }
        if (agiu == 0) Info("nada estava rodando");

        // Confere de verdade se as portas cairam.
        Console.WriteLine();
        bool limpo = true;
        foreach (var (name, probe) in new[] { ("front", FrontProbe), ("duel-server", DuelProbe) })
        {
            var (up, _) = Probe(probe).GetAwaiter().GetResult();
            if (up) { Fail($"{name} AINDA responde em {probe}"); limpo = false; }
            else Ok($"{name}: porta livre");
        }

        if (limpo) { Console.WriteLine(); Ok("desligamento limpo."); }
        else Warn("algo continuou de pe — pode ter sido subido por fora deste launcher.");

        return Hold(limpo ? 0 : 6, true);
    }

    /// <summary>Pede o encerramento. Falhar aqui e' esperado: o servidor pode
    /// derrubar a conexao no meio da resposta ao sair.</summary>
    static async Task AskShutdown(string url)
    {
        try { using var _ = await Http.PostAsync(url, new StringContent("")); }
        catch { /* seguimos para o WaitDown, que e' quem da' o veredito */ }
    }

    /// <summary>Espera a porta parar de responder.</summary>
    static bool WaitDown(string probe, int seconds)
    {
        var sw = Stopwatch.StartNew();
        while (sw.Elapsed.TotalSeconds < seconds)
        {
            Thread.Sleep(300);
            var (up, _) = Probe(probe).GetAwaiter().GetResult();
            if (!up) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ util

    static async Task<(bool ok, string code)> Probe(string url)
    {
        try
        {
            using var res = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            return ((int)res.StatusCode == 200, ((int)res.StatusCode).ToString());
        }
        catch (TaskCanceledException) { return (false, "timeout"); }
        catch (HttpRequestException) { return (false, "sem resposta"); }
        catch (Exception e) { return (false, e.GetType().Name); }
    }

    /// <summary>Sobe a partir do exe procurando a raiz do repositorio.</summary>
    static string FindRepoRoot()
    {
        var candidates = new List<string>();
        var exeDir = AppContext.BaseDirectory;
        candidates.Add(exeDir);
        candidates.Add(Directory.GetCurrentDirectory());

        foreach (var start in candidates)
        {
            var dir = new DirectoryInfo(start);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "package.json")) &&
                    Directory.Exists(Path.Combine(dir.FullName, "ygo-data")) &&
                    Directory.Exists(Path.Combine(dir.FullName, "duel-server")))
                    return dir.FullName;
                dir = dir.Parent;
            }
        }
        return null;
    }

    static bool Has(string[] a, string flag) =>
        Array.Exists(a, x => string.Equals(x, flag, StringComparison.OrdinalIgnoreCase));

    static int Hold(int code, bool pause)
    {
        if (pause)
        {
            Console.WriteLine();
            Console.WriteLine("  (pressione qualquer tecla para fechar)");
            try { Console.ReadKey(true); } catch { Thread.Sleep(4000); }
        }
        else
        {
            // Sucesso: some sozinho, como pedido. Um respiro para dar tempo de ler.
            Thread.Sleep(1200);
        }
        return code;
    }

    // ------------------------------------------------------------------ saida

    static void Banner(bool stop)
    {
        Write(stop ? ConsoleColor.Red : ConsoleColor.Yellow,
              stop ? "\n  ####  CLASSIC DUELS — DESLIGAR  ####\n"
                   : "\n  ####  CLASSIC DUELS  ####\n");
    }

    static void Step(int n, string what)
    {
        Console.WriteLine();
        Write(ConsoleColor.Cyan, $"[{n}] {what}");
        Console.WriteLine();
    }

    static void Ok(string m) { Write(ConsoleColor.Green, "  OK   "); Console.WriteLine(m); }
    static void Fail(string m) { Write(ConsoleColor.Red, "  ERRO "); Console.WriteLine(m); }
    static void Warn(string m) { Write(ConsoleColor.Yellow, "  !    "); Console.WriteLine(m); }
    static void Info(string m) { Write(ConsoleColor.DarkGray, "  ·    " + m); Console.WriteLine(); }

    static void Write(ConsoleColor c, string s)
    {
        var old = Console.ForegroundColor;
        Console.ForegroundColor = c;
        Console.Write(s);
        Console.ForegroundColor = old;
    }

    sealed class PidEntry
    {
        public string Name { get; set; }
        public int Pid { get; set; }
        public DateTime StartedAt { get; set; }
    }
}
