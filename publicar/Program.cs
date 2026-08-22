using System.Diagnostics;
using System.Text.Json;

// publicar — leva as alteracoes daqui para a nuvem, sem linha de comando.
//
// Fluxo: confere o ambiente; para o servidor; compila; roda as 5 suites do
// instalador (offline, ~6s); gera dist\release\ em DRY-RUN; mostra o que mudou
// desde a ultima geracao; publica o Release.
//
// **Nao pergunta nada.** Dois cliques = publicar, que e' o que este exe existe
// para ser; pedido do usuario em 20/08/2026. Quem quiser a trava de volta usa
// `--perguntar` (ou `--so-build`, que para no dry-run e nao sobe nada). A
// seguranca aqui nunca esteve na pergunta e sim nos passos ANTES dela:
// ambiente conferido, servidor parado, as suites do instalador e o diff dos
// marcadores na tela — nenhum deles depende de alguem ler o aviso.
//
// A ordem nao e' arbitraria:
//   - parar o servidor vem antes de compilar porque o .exe fica travado
//     enquanto roda, e o build falha (ou pior: passa e o teste seguinte roda o
//     binario antigo, dando a impressao de que a mudanca nao funcionou);
//   - os testes vem antes de gerar os pacotes porque publicar um instalador
//     quebrado e' o unico erro daqui que o jogador nao consegue contornar;
//   - o dry-run vem antes do aviso porque e' dele que sai o diff dos
//     marcadores: sem ele a tela nao teria o que mostrar.
//
// ELE NAO REIMPLEMENTA NADA: toda a inteligencia continua em
// tools/publish-release.ps1 e nas suites do duel-server. Este exe so' chama, na
// ordem certa, e se recusa a seguir quando alguma coisa esta' fora do lugar.
// E' de proposito — dois caminhos que "publicam" divergiriam com o tempo.

namespace Publicador;

internal static class Program
{
    const string Owner = "FelisbertoJPG";
    const string Repo = "yugi-server-";

    static string _root;

    static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.Title = "Classic Duels — publicar";

        if (Has(args, "--ajuda") || Has(args, "-h") || Has(args, "--help")) return Ajuda();

        // Diagnostico: imprime a digital da casca e sai. Existe para poder
        // conferir, sem publicar nada, que esta conta bate com a do pack.ps1 —
        // duas implementacoes da mesma formula divergem calado.
        if (Has(args, "--digital"))
        {
            _root = AcharRaiz();
            if (_root == null) { Console.Error.WriteLine("raiz nao encontrada"); return 2; }
            Console.WriteLine(DigitalDaCasca(Path.Combine(_root, "duel-server", "host")));
            return 0;
        }

        bool comExe = Has(args, "--com-exe");
        bool semTestes = Has(args, "--sem-testes");
        bool soBuild = Has(args, "--so-build");
        // Opt-IN, e nao opt-out: sem isto ele publica direto. `--sim` continua
        // aceito e nao faz nada — era ele que pulava a pergunta, e quebrar o
        // atalho de quem ja' o digitava nao ganharia nada.
        bool perguntar = Has(args, "--perguntar");
        string tag = Valor(args, "--tag");
        string podar = Valor(args, "--podar");

        Banner();

        _root = AcharRaiz();
        if (_root == null)
        {
            Fail("Nao achei a raiz do projeto (procurei por package.json + ygo-data/ + duel-server/).");
            Console.WriteLine("       Deixe o publicar.exe dentro da pasta do projeto.");
            return Segurar(2);
        }
        Info($"projeto: {_root}");
        Directory.SetCurrentDirectory(_root);

        // ---- 1. ambiente ---------------------------------------------------
        Step(1, "conferindo o ambiente");
        if (!ConferirAmbiente(soBuild)) return Segurar(3);

        // ---- 2. o exe precisa ser republicado? -----------------------------
        // A casca (duel-server/host/) e' a unica parte que ainda viaja dentro do
        // executavel. Mudou ela e o exe nao foi refeito? O Release sairia com um
        // exe velho carregando um motor novo — e nada acusaria.
        Step(2, "a casca mudou desde o ultimo empacotamento?");
        if (!ConferirCasca(comExe)) return Segurar(4);

        // ---- 3. servidor parado --------------------------------------------
        Step(3, "parando o servidor");
        PararServidor();

        // ---- 4. compilar ---------------------------------------------------
        Step(4, "compilando o duel-server");
        if (Rodar("dotnet", "build duel-server -v q --nologo") != 0)
        {
            Fail("a compilacao falhou — nada foi publicado.");
            return Segurar(5);
        }
        Ok("compilado");

        // ---- 5. suites do instalador ---------------------------------------
        if (semTestes)
        {
            Step(5, "suites do instalador");
            Warn("PULADAS por --sem-testes — voce esta' publicando sem rede de seguranca.");
        }
        else
        {
            Step(5, "suites do instalador (offline, ~6s)");
            if (!RodarSuites()) return Segurar(6);
        }

        // ---- 6. gerar os pacotes (dry-run) ---------------------------------
        // As versoes ANTES de regerar: e' com elas que o passo 7 diz o que mudou.
        var antes = LerVersoes();
        string exeAntes = LerVersaoInstalador();

        Step(6, "gerando os pacotes em dist\\release\\ (dry-run)");
        string argsBuild = "-NoProfile -ExecutionPolicy Bypass -File tools\\publish-release.ps1";
        if (comExe) argsBuild += " -ComExe";
        if (Rodar("powershell", argsBuild) != 0)
        {
            Fail("a geracao dos pacotes falhou — nada foi publicado.");
            return Segurar(7);
        }

        // ---- 7. o que mudou -------------------------------------------------
        // A comparacao boa e' com o que esta' PUBLICADO — e' ela que responde "o
        // que os jogadores vao baixar". O manifesto remoto tem 4 KB; so' quando
        // nao da' para busca-lo e' que cai na ultima geracao local, que responde
        // uma pergunta parecida mas nao a mesma.
        Step(7, "o que mudou");
        var publicado = BaixarManifestoPublicado();
        bool algoMudou = publicado != null
            ? Comparar(publicado.Value.payloads, publicado.Value.exe, comExe, "o que esta' publicado")
            : Comparar(antes, exeAntes, comExe, "a ultima geracao NESTA pasta");

        if (soBuild)
        {
            Console.WriteLine();
            Ok("DRY-RUN pronto. Confira dist\\release\\manifest.json e rode de novo sem --so-build.");
            return Segurar(0);
        }

        // ---- 8. o aviso -----------------------------------------------------
        // Fica na tela mesmo sem pergunta: quem esta' olhando ve o que vai
        // acontecer, e fica registrado no que rolou pela janela.
        Step(8, "o que vai acontecer");
        if (!algoMudou)
            Warn("nenhum pacote mudou — este Release nao entregaria novidade nenhuma.");
        Console.WriteLine();
        Console.WriteLine($"       Isto vai criar um Release em {Owner}/{Repo}.");
        Console.WriteLine("       Todo jogador com o jogo instalado passa a baixar isto no proximo boot.");
        Console.WriteLine("       Nao existe desfazer: o download de quem ja' atualizou ja' aconteceu.");
        Console.WriteLine();

        if (perguntar && !Confirmar())
        {
            Console.WriteLine();
            Info("cancelado — nada foi publicado. Os pacotes ficam em dist\\release\\.");
            return Segurar(0);
        }

        // ---- 9. publicar ----------------------------------------------------
        Step(9, "publicando o Release");
        string argsPub = "-NoProfile -ExecutionPolicy Bypass -File tools\\publish-release.ps1 -Publish";
        if (comExe) argsPub += " -ComExe";
        if (!string.IsNullOrWhiteSpace(tag)) argsPub += " -Tag " + tag;
        if (!string.IsNullOrWhiteSpace(podar)) argsPub += " -PodarReleases " + podar;

        if (Rodar("powershell", argsPub) != 0)
        {
            Fail("a publicacao falhou.");
            return Segurar(8);
        }

        Console.WriteLine();
        Ok("publicado. O jogo dos jogadores pega isto no proximo boot.");
        if (comExe)
            Info("com exe: quem esta' numa versao anterior troca o executavel sozinho, e reabre.");
        return Segurar(0);
    }

    // ------------------------------------------------------------------ passos

    static bool ConferirAmbiente(bool soBuild)
    {
        if (Capturar("dotnet", "--version", out string ver) != 0)
        {
            Fail("nao achei o `dotnet`. Instale o SDK .NET 8.");
            return false;
        }
        Ok($"dotnet {ver.Trim()}");

        if (!File.Exists(Path.Combine(_root, "tools", "publish-release.ps1")))
        {
            Fail("nao achei tools\\publish-release.ps1.");
            return false;
        }
        Ok("tools\\publish-release.ps1");

        // O gh so' e' preciso para publicar de verdade. No --so-build a ausencia
        // dele nao e' motivo para deixar de gerar os pacotes.
        string gh = AcharGh();
        if (gh == null)
        {
            if (soBuild) { Warn("gh CLI nao encontrado (so' importa na hora de publicar)"); return true; }
            Fail("nao achei o gh CLI. Instale em https://cli.github.com e rode `gh auth login`.");
            return false;
        }
        Ok($"gh: {gh}");

        // A permissao e' conferida AQUI, e nao so' la' dentro, porque o script so'
        // descobre isso depois de gastar minutos montando os pacotes.
        if (Capturar(gh, $"repo view {Owner}/{Repo} --json viewerPermission -q .viewerPermission",
                     out string perm) != 0)
        {
            if (soBuild) { Warn($"nao consegui consultar {Owner}/{Repo} (so' importa ao publicar)"); return true; }
            Fail($"nao consegui consultar {Owner}/{Repo} — rode: gh auth login");
            return false;
        }
        perm = perm.Trim();
        if (perm != "WRITE" && perm != "ADMIN" && perm != "MAINTAIN")
        {
            Fail($"a conta autenticada tem permissao '{perm}' em {Owner}/{Repo} — precisa de WRITE.");
            return false;
        }
        Ok($"permissao em {Owner}/{Repo}: {perm}");
        return true;
    }

    /// <summary>
    /// A casca e' a unica parte que ainda viaja dentro do .exe. Se ela mudou
    /// depois do ultimo `npm run pack`, o Release sairia com um executavel
    /// desatualizado — o mesmo erro silencioso que o pack.ps1 ja' recusa para o
    /// engine.zip.
    ///
    /// A comparacao e' por CONTEUDO (dist\.cache\casca.digital, gravada pelo
    /// pack.ps1), nunca por data: copiar a pasta do projeto entre maquinas
    /// reescreve a data de todo arquivo de uma vez, e a primeira versao disto
    /// acusava mudanca em seis fontes que ninguem tinha tocado.
    /// </summary>
    static bool ConferirCasca(bool comExe)
    {
        string host = Path.Combine(_root, "duel-server", "host");
        string exe = Path.Combine(_root, "dist", "ClassicDuels.exe");
        string arqDigital = Path.Combine(_root, "dist", ".cache", "casca.digital");

        if (!Directory.Exists(host)) { Warn("nao achei duel-server\\host — seguindo."); return true; }

        if (!File.Exists(exe))
        {
            if (comExe)
            {
                Fail("--com-exe pedido, mas nao existe dist\\ClassicDuels.exe. Rode `npm run pack` antes.");
                return false;
            }
            Info("sem dist\\ClassicDuels.exe — publicando so' os pacotes (e' o caminho normal).");
            return true;
        }

        // Sem a digital nao da' para saber, e CHUTAR seria pior que os dois erros
        // possiveis: bloquear uma publicacao boa ou liberar uma ruim. Avisa.
        if (!File.Exists(arqDigital))
        {
            Warn("nao achei dist\\.cache\\casca.digital — nao consigo dizer se o exe esta' em dia.");
            Console.WriteLine("       Ela e' gravada pelo `npm run pack`. Rode-o uma vez se voce mexeu");
            Console.WriteLine("       em duel-server\\host; se nao mexeu, pode seguir.");
            return true;
        }

        string agora = DigitalDaCasca(host);
        string doPack = File.ReadAllText(arqDigital).Trim();

        if (!string.Equals(agora, doPack, StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine();
            Fail("a casca (duel-server\\host) mudou DEPOIS do ultimo `npm run pack`.");
            Console.WriteLine("       O exe em dist\\ esta' velho. Um Release com ele entregaria uma casca");
            Console.WriteLine("       antiga carregando um motor novo, e nada acusaria.");
            Console.WriteLine();
            Console.WriteLine("       Faca, nesta ordem:");
            Console.WriteLine("         1. suba a InstallerVersion em duel-server\\src\\update\\BuildConfig.cs");
            Console.WriteLine("         2. npm run pack");
            Console.WriteLine("         3. publicar.exe --com-exe");
            Console.WriteLine();
            Console.WriteLine("       (mexeu so' no motor ou no front? entao a casca nao devia ter mudado —");
            Console.WriteLine("        confira o que voce editou dentro de host\\.)");
            return false;
        }

        Ok(comExe ? "o exe em dist\\ foi empacotado com esta casca"
                  : "a casca nao mudou desde o ultimo pack — nao precisa de --com-exe");
        return true;
    }

    /// <summary>
    /// Impressao digital dos fontes da casca. A MESMA conta do `DigitalDaCasca`
    /// em tools\pack.ps1 — uma linha "caminho/relativo|sha256" por arquivo,
    /// ordenadas por ordinal, unidas por \n, e o sha256 disso em hex minusculo.
    /// Divergir faz a trava acusar mudanca que nao houve.
    /// </summary>
    static string DigitalDaCasca(string host)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var linhas = new List<string>();

        foreach (var f in Directory.GetFiles(host, "*.cs", SearchOption.AllDirectories))
        {
            string rel = f.Substring(host.Length).TrimStart('\\', '/').Replace('\\', '/');
            string h = Convert.ToHexString(sha.ComputeHash(File.ReadAllBytes(f))).ToLowerInvariant();
            linhas.Add($"{rel}|{h}");
        }
        linhas.Sort(StringComparer.Ordinal);

        var tudo = System.Text.Encoding.UTF8.GetBytes(string.Join("\n", linhas));
        return Convert.ToHexString(sha.ComputeHash(tudo)).ToLowerInvariant();
    }

    static void PararServidor()
    {
        string stop = Path.Combine(_root, "classic-duels-stop.exe");
        if (!File.Exists(stop))
        {
            Warn("nao achei classic-duels-stop.exe — se o servidor estiver no ar, o build pode falhar.");
            return;
        }
        // A saida do stop e' barulhenta e nao interessa aqui; o que importa e' que
        // as portas e o .exe fiquem livres antes do build.
        Capturar(stop, "", out _);
        Ok("servidor parado");
    }

    static bool RodarSuites()
    {
        string motor = Path.Combine(_root, "duel-server", "bin", "Debug", "net8.0", "win-x64", "duel-server.exe");
        if (!File.Exists(motor))
        {
            Fail($"nao achei {motor}");
            return false;
        }

        // As cinco do `npm run update:test`. Todas offline e deterministas: sao
        // exatamente as que provam o caminho que este exe esta' prestes a usar.
        string[] suites = { "--test-casca", "--test-update", "--test-offline",
                            "--test-selfupdate", "--test-update-duelo" };

        foreach (var s in suites)
        {
            if (Capturar(motor, s, out string saida) != 0)
            {
                Fail($"{s} FALHOU — nada foi publicado.");
                Console.WriteLine();
                var linhas = saida.Replace("\r", "").Split('\n');
                for (int i = Math.Max(0, linhas.Length - 25); i < linhas.Length; i++)
                    Console.WriteLine("       " + linhas[i].TrimEnd());
                return false;
            }
            Ok(s);
        }
        return true;
    }

    // -------------------------------------------------------------- comparacao

    static string Manifesto => Path.Combine(_root, "dist", "release", "manifest.json");

    /// <summary>Marcadores de cada pacote no manifesto local, ou vazio se nao ha'.</summary>
    static Dictionary<string, string> LerVersoes()
    {
        var mapa = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!File.Exists(Manifesto)) return mapa;
            using var doc = JsonDocument.Parse(File.ReadAllText(Manifesto));
            if (!doc.RootElement.TryGetProperty("payloads", out var ps)) return mapa;
            foreach (var p in ps.EnumerateArray())
                if (p.TryGetProperty("id", out var id) && p.TryGetProperty("version", out var v))
                    mapa[id.GetString() ?? ""] = v.GetString() ?? "";
        }
        catch { }
        return mapa;
    }

    static string LerVersaoInstalador()
    {
        try
        {
            if (!File.Exists(Manifesto)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(Manifesto));
            if (doc.RootElement.TryGetProperty("installer", out var i) &&
                i.ValueKind == JsonValueKind.Object &&
                i.TryGetProperty("version", out var v)) return v.GetString();
        }
        catch { }
        return null;
    }

    /// <summary>
    /// Baixa o manifesto do Release mais recente (4 KB) — a MESMA coisa que o
    /// jogo do jogador le' no boot. Null quando nao deu (sem rede, sem gh, ou
    /// nenhum Release ainda), e ai' o chamador cai na comparacao local.
    /// </summary>
    static (Dictionary<string, string> payloads, string exe)? BaixarManifestoPublicado()
    {
        string gh = AcharGh();
        if (gh == null) return null;

        string tmp = Path.Combine(Path.GetTempPath(), "classic-duels-publicar-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(tmp);
            if (Capturar(gh, $"release download --repo {Owner}/{Repo} --pattern manifest.json --clobber -D \"{tmp}\"",
                         out string erro) != 0)
            {
                Warn("nao consegui ler o manifesto publicado — comparando com a geracao local.");
                Info(erro.Trim().Split('\n').FirstOrDefault()?.Trim() ?? "");
                return null;
            }

            string arq = Path.Combine(tmp, "manifest.json");
            if (!File.Exists(arq)) return null;

            using var doc = JsonDocument.Parse(File.ReadAllText(arq));
            var mapa = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (doc.RootElement.TryGetProperty("payloads", out var ps))
                foreach (var p in ps.EnumerateArray())
                    if (p.TryGetProperty("id", out var id) && p.TryGetProperty("version", out var v))
                        mapa[id.GetString() ?? ""] = v.GetString() ?? "";

            string exe = null;
            if (doc.RootElement.TryGetProperty("installer", out var i) &&
                i.ValueKind == JsonValueKind.Object &&
                i.TryGetProperty("version", out var ev)) exe = ev.GetString();

            string versao = doc.RootElement.TryGetProperty("gameVersion", out var g) ? g.GetString() : "?";
            Info($"no ar agora: {versao}");
            return (mapa, exe);
        }
        catch (Exception e)
        {
            Warn($"nao consegui ler o manifesto publicado ({e.Message}) — comparando com a geracao local.");
            return null;
        }
        finally { try { Directory.Delete(tmp, true); } catch { } }
    }

    /// <summary>
    /// Mostra o diff dos marcadores contra <paramref name="contra"/> — o que
    /// esta' publicado, quando deu para busca-lo, ou a ultima geracao local.
    /// A tela diz qual dos dois, porque so' o primeiro responde "e' isto que os
    /// jogadores vao baixar".
    /// </summary>
    static bool Comparar(Dictionary<string, string> antes, string exeAntes, bool comExe, string contra)
    {
        var depois = LerVersoes();
        if (depois.Count == 0) { Warn("nao consegui ler o manifesto gerado."); return true; }

        var tamanhos = LerTamanhos();
        long baixar = 0;
        bool mudou = false;

        foreach (var par in depois)
        {
            tamanhos.TryGetValue(par.Key, out long bytes);
            string mb = $"{bytes / 1048576.0:0.#} MB";

            if (antes.Count == 0 || !antes.TryGetValue(par.Key, out string velho))
            {
                Console.WriteLine($"       novo  {par.Key,-8} {par.Value}   {mb}");
                baixar += bytes;
                mudou = true;
            }
            else if (velho != par.Value)
            {
                Write(ConsoleColor.Yellow, "       ~     ");
                Console.WriteLine($"{par.Key,-8} {velho}  ->  {par.Value}   {mb}");
                baixar += bytes;
                mudou = true;
            }
            else Console.WriteLine($"       =     {par.Key,-8} sem mudanca");
        }

        string exeDepois = LerVersaoInstalador();
        if (comExe && exeDepois != null)
        {
            if (exeAntes == exeDepois)
            {
                Console.WriteLine();
                Warn($"a InstallerVersion continua {exeDepois} — igual a' da ultima geracao.");
                Console.WriteLine("       Quem ja' esta' nessa versao NAO vai trocar o exe: a comparacao do");
                Console.WriteLine("       instalador e' por numero, e ele nao subiu.");
                Console.WriteLine("       Suba em duel-server\\src\\update\\BuildConfig.cs se a casca mudou.");
            }
            else
            {
                Write(ConsoleColor.Yellow, "       ~     ");
                Console.WriteLine($"{"exe",-8} {exeAntes ?? "(nenhum)"}  ->  {exeDepois}");
                mudou = true;
            }
        }

        Console.WriteLine();
        Info($"comparado com {contra}.");
        if (mudou)
            Info($"cada jogador vai baixar {baixar / 1048576.0:0.#} MB" +
                 (comExe ? " (mais o exe, so' quem estiver numa versao anterior)." : "."));
        return mudou;
    }

    /// <summary>Tamanho de cada pacote no manifesto gerado, para dizer o preco do download.</summary>
    static Dictionary<string, long> LerTamanhos()
    {
        var mapa = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!File.Exists(Manifesto)) return mapa;
            using var doc = JsonDocument.Parse(File.ReadAllText(Manifesto));
            if (!doc.RootElement.TryGetProperty("payloads", out var ps)) return mapa;
            foreach (var p in ps.EnumerateArray())
                if (p.TryGetProperty("id", out var id) && p.TryGetProperty("size", out var s))
                    mapa[id.GetString() ?? ""] = s.GetInt64();
        }
        catch { }
        return mapa;
    }

    static bool Confirmar()
    {
        Write(ConsoleColor.Yellow, "       Digite PUBLICAR para confirmar (qualquer outra coisa cancela): ");
        string r = Console.ReadLine();
        return string.Equals(r?.Trim(), "PUBLICAR", StringComparison.Ordinal);
    }

    // ------------------------------------------------------------- utilitarios

    /// <summary>
    /// O gh costuma nao estar no PATH do processo filho mesmo respondendo na
    /// janela de quem chamou. Mesma busca do publish-release.ps1.
    /// </summary>
    static string AcharGh()
    {
        string caminhos = string.Join(";",
            Environment.GetEnvironmentVariable("PATH") ?? "",
            Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "",
            Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "");

        foreach (var dir in caminhos.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                string p = Path.Combine(dir.Trim(), "gh.exe");
                if (File.Exists(p)) return p;
            }
            catch { }
        }

        foreach (var p in new[]
                 {
                     Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? "", "GitHub CLI", "gh.exe"),
                     Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", "GitHub CLI", "gh.exe"),
                     Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "", "GitHubCLI", "gh.exe")
                 })
            if (File.Exists(p)) return p;

        return null;
    }

    /// <summary>Roda herdando o console: a saida colorida do script aparece inteira.</summary>
    static int Rodar(string exe, string args)
    {
        var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, WorkingDirectory = _root };
        using var p = Process.Start(psi);
        p.WaitForExit();
        return p.ExitCode;
    }

    /// <summary>Roda capturando a saida (para consultar valores e guardar o erro).</summary>
    static int Capturar(string exe, string args, out string saida)
    {
        try
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = _root ?? Directory.GetCurrentDirectory()
            };
            using var p = Process.Start(psi);
            string o = p.StandardOutput.ReadToEnd();
            string e = p.StandardError.ReadToEnd();
            p.WaitForExit();
            saida = o + e;
            return p.ExitCode;
        }
        catch (Exception e) { saida = e.Message; return -1; }
    }

    static string AcharRaiz()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
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
        a.Any(x => string.Equals(x, flag, StringComparison.OrdinalIgnoreCase));

    static string Valor(string[] a, string flag)
    {
        for (int i = 0; i < a.Length - 1; i++)
            if (string.Equals(a[i], flag, StringComparison.OrdinalIgnoreCase)) return a[i + 1];
        return null;
    }

    static int Ajuda()
    {
        Banner();
        Console.WriteLine("  publicar.exe [opcoes]");
        Console.WriteLine();
        Console.WriteLine("    (sem opcao)     compila, testa, gera, mostra o diff e PUBLICA (sem perguntar)");
        Console.WriteLine("    --so-build      para no dry-run: gera dist\\release\\ e nao publica nada");
        Console.WriteLine("    --com-exe       sobe tambem o ClassicDuels.exe (so' quando a casca mudou;");
        Console.WriteLine("                    exige `npm run pack` antes e a InstallerVersion subida)");
        Console.WriteLine("    --sem-testes    pula as suites do instalador (nao use sem um bom motivo)");
        Console.WriteLine("    --perguntar     exige a palavra PUBLICAR antes de subir");
        Console.WriteLine("    --sim           aceito e ignorado (a confirmacao ja' nao existe)");
        Console.WriteLine("    --tag <nome>    nome da tag do Release (padrao: carimbo de data/hora)");
        Console.WriteLine("    --podar <n>     apaga os Releases antigos, mantendo os n mais recentes");
        Console.WriteLine();
        return 0;
    }

    // -------------------------------------------------------------------- tela

    static void Banner() =>
        Write(ConsoleColor.Cyan, "\n  ####  CLASSIC DUELS — PUBLICAR  ####\n");

    static void Step(int n, string what)
    {
        Console.WriteLine();
        Write(ConsoleColor.Cyan, $"  [{n}] ");
        Console.WriteLine(what);
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

    static int Segurar(int codigo)
    {
        Console.WriteLine();
        Console.WriteLine("  (pressione qualquer tecla para fechar)");
        try { Console.ReadKey(true); } catch { Thread.Sleep(5000); }
        return codigo;
    }
}
