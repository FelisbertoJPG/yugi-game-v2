using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using DuelServer.Update;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da troca do PRÓPRIO executável — `--test-selfupdate`
    /// (INSTALADOR-PENDENCIAS.md §2).
    ///
    /// O `SelfUpdater` existia, compilava e estava plugado no `UpdateService`, mas
    /// nunca tinha sido exercitado: nenhum Release publicado incluiu o exe, então
    /// `manifest.installer` era `null` e o caminho inteiro estava morto.
    ///
    /// É o caminho com mais partes móveis do sistema todo — baixar o `.new`,
    /// conferir sha256, apagar o `Zone.Identifier`, escrever um `.bat`, esperar o
    /// PID morrer, copiar por cima de um exe que acabou de encerrar, reabrir. Cada
    /// passo tem um jeito de falhar em silêncio, e o sintoma no jogador é "o jogo
    /// não abre mais" — sem log, porque o processo que escreveria o log é
    /// justamente o que não subiu.
    ///
    /// Aqui a coreografia roda inteira com um exe de MENTIRA no %TEMP%: o `.bat` é
    /// escrito e executado de verdade, esperando de verdade um PID morrer e
    /// copiando de verdade por cima do arquivo. O que não acontece é reabrir nada
    /// (`reabrir: false`) e mexer no binário que está rodando o teste — daí os dois
    /// parâmetros de teste no `SelfUpdater`.
    ///
    /// O que este teste NÃO cobre, e continua exigindo uma publicação real: baixar
    /// o exe pelo navegador para ele vir com a Marca da Web de verdade. É esse
    /// cenário que produz o erro 1223, e ele não aparece copiando arquivo
    /// localmente. O caso 3 aqui chega perto — põe a marca à mão e confere que ela
    /// sai —, mas quem produz a marca é o navegador, não nós.
    /// </summary>
    public static class TestSelfUpdate
    {
        const string ANTIGA = "eu sou a versao ANTIGA do Classic Duels";
        const string NOVA = "eu sou a versao NOVA do Classic Duels";

        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Log.Info($"  ok   {nome}"); }
        static void Falha(string nome, string porque) { _fail++; Log.Err($"  FALHA {nome}: {porque}"); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run()
        {
            Log.Info("=== teste: AUTO-UPDATE DO PROPRIO EXECUTAVEL ===\n");

            string bancada = Path.Combine(Path.GetTempPath(),
                "duelacademy-test-selfupdate-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                SemInstaladorNoManifestoNaoFazNada(Sub(bancada, "1-sem-installer"));
                ShaErradoNaoTrocaNada(Sub(bancada, "2-sha"));
                MarcaDaWebSaiDoExeNovo(Sub(bancada, "3-marca"));
                CoreografiaCompleta(Sub(bancada, "4-troca"));
                ReaberturaParaTrocarOMotor(Sub(bancada, "5-reabertura"));
            }
            finally
            {
                try { if (Directory.Exists(bancada)) Directory.Delete(bancada, true); } catch { }
            }

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ casos

        /// <summary>
        /// A REABERTURA — o irmão mais novo da troca do exe, e o passo que fecha
        /// a atualização do MOTOR.
        ///
        /// O pacote `engine` cai em `.staged/` e quem o aplica é a casca, no
        /// boot. Falta então só o boot acontecer: o jogo fecha e reabre sozinho.
        /// Sem isto o jogador ficaria com o motor novo baixado, a tela dizendo
        /// "pronto" e o motor VELHO ainda rodando — a pior das duas mentiras
        /// possíveis aqui.
        ///
        /// O `.bat` espera o PID morrer antes de reabrir, e não é frescura:
        /// subir o processo novo enquanto o antigo ainda segura as portas
        /// 8080/8770 faz o servidor "andar para a próxima porta livre", e o
        /// jogador cairia num jogo na 8081 enquanto o outro morre.
        ///
        /// Aqui o "executável" é um `.cmd` que escreve um arquivo e sai — é o
        /// que permite provar que ele foi MESMO reaberto, sem abrir o jogo.
        /// </summary>
        static void ReaberturaParaTrocarOMotor(string dir)
        {
            Directory.CreateDirectory(dir);
            string alvo = Path.Combine(dir, "ClassicDuels-de-mentira.cmd");
            string prova = Path.Combine(dir, "abriu.txt");
            File.WriteAllText(alvo,
                "@echo off" + Environment.NewLine +
                // Guarda os ARGUMENTOS, e nao so' a prova de que abriu: e' por um
                // argumento (`--reaberto`) que o processo novo sabe que ja' existe
                // uma janela do jogo na tela. Sem ele, a atualizacao termina com
                // duas copias do jogo abertas — o relato "2 exe abrindo apos att".
                "echo abri %* > " + "\"" + prova + "\"" + Environment.NewLine +
                // `exit` (e nao `exit /b`) porque o `start` do Windows abre um
                // .cmd com `cmd /K`, que fica com a janela aberta para sempre —
                // e o teste nunca terminaria. O alvo de verdade e' um .exe, que
                // o `start` executa direto; isto e' so' para o alvo de mentira.
                "exit" + Environment.NewLine,
                Encoding.ASCII);

            var batsAntes = new System.Collections.Generic.HashSet<string>(
                Directory.EnumerateFiles(Path.GetTempPath(), "classicduels-reabrir-*.bat"),
                StringComparer.OrdinalIgnoreCase);

            int pidMorto = PidDeUmProcessoQueJaMorreu();
            bool agendou = SelfUpdater.AgendarReabertura(exeAtual: alvo, pidEsperar: pidMorto);
            Checa(agendou, "a reabertura foi agendada (o .bat foi escrito e disparado)");
            if (!agendou) return;

            Checa(Esperar(() => File.Exists(prova), TimeSpan.FromSeconds(20)),
                  "o .bat reabriu o jogo depois de o processo antigo morrer",
                  "passaram 20s e o alvo nao foi executado");

            string argsRecebidos = File.Exists(prova) ? File.ReadAllText(prova) : "";
            Checa(argsRecebidos.Contains("--reaberto"),
                  "e passou `--reaberto` — o processo novo nao abre uma SEGUNDA janela",
                  $"(recebeu: {argsRecebidos.Trim()})");

            // A OUTRA METADE, e ela custou caro: passar o argumento so' serve se
            // quem o recebe continuar sendo o JOGO. A condicao de modo era
            // `args.Length == 0`, entao o exe empacotado via UM argumento,
            // concluia que nao era `--app` e caia no modo de demonstracao —
            // rodava um duelo de teste no console, nunca subia o servidor do
            // front, e a janela do navegador ficava consultando um servidor que
            // nao existia. O relato foi *"o launcher fica travado nessa tela e
            // preciso fechar e abrir de novo"*.
            Checa(Program.EhModoApp(new[] { "--reaberto" }, temPayload: true),
                  "e o processo reaberto AINDA e' o jogo (--app implicito)",
                  "(um argumento so' o derrubava para o modo de demonstracao)");

            // Os outros modificadores tinham a mesma armadilha esperando.
            foreach (string flag in new[] { "--lan", "--sem-update", "--no-browser", "--motor-embutido" })
                Checa(Program.EhModoApp(new[] { flag }, temPayload: true),
                      $"idem para `{flag}` sozinho");

            Checa(Program.EhModoApp(new[] { "--reaberto", "--lan" }, temPayload: true),
                  "e para dois modificadores juntos");

            // PAR CONTROLE, nos dois sentidos — sem eles, um `EhModoApp` que
            // respondesse `true` sempre passaria em tudo acima.
            Checa(!Program.EhModoApp(new[] { "--serve" }, temPayload: true),
                  "par CONTROLE: `--serve` escolhe OUTRO modo, e continua escolhendo");
            Checa(!Program.EhModoApp(Array.Empty<string>(), temPayload: false),
                  "par CONTROLE: sem payload, dois cliques nao viram jogo (e' o repo em dev)");
            Checa(Program.EhModoApp(new[] { "--app" }, temPayload: false),
                  "par CONTROLE: `--app` explicito vale mesmo sem payload");

            Checa(Esperar(() => !Directory.EnumerateFiles(Path.GetTempPath(), "classicduels-reabrir-*.bat")
                                           .Any(b => !batsAntes.Contains(b)),
                  TimeSpan.FromSeconds(5)),
                  "o .bat se autodeletou");
        }


        /// <summary>
        /// O estado de HOJE em produção: `"installer": null` no manifesto. Não pode
        /// baixar nada nem deixar rastro — é o caminho que todo cliente instalado
        /// percorre a cada boot.
        /// </summary>
        static void SemInstaladorNoManifestoNaoFazNada(string dir)
        {
            var (alvo, fonte, m) = Cenario(dir);
            m.Installer = null;

            string novo = SelfUpdater.BaixarAsync(m, fonte, exeAtual: alvo).GetAwaiter().GetResult();
            Checa(novo == null, "manifesto sem 'installer': nao baixa nada");
            Checa(!File.Exists(alvo + ".new"), "e nao deixa .new no disco");
            Checa(File.ReadAllText(alvo) == ANTIGA, "o exe atual continua intacto");
        }

        /// <summary>
        /// A trava mais importante deste arquivo. Trocar o exe por um binário que
        /// veio corrompido deixaria o jogador sem NENHUMA versão que abre — e sem
        /// como pedir ajuda, porque o que abriria o log é o que não sobe.
        /// </summary>
        static void ShaErradoNaoTrocaNada(string dir)
        {
            var (alvo, fonte, m) = Cenario(dir);
            m.Installer.Sha256 = new string('0', 64);

            string novo = SelfUpdater.BaixarAsync(m, fonte, exeAtual: alvo).GetAwaiter().GetResult();
            Checa(novo == null, "sha256 errado: BaixarAsync devolve null");
            Checa(!File.Exists(alvo + ".new"), "o .new corrompido foi apagado");
            Checa(File.ReadAllText(alvo) == ANTIGA, "o exe atual continua intacto");
        }

        /// <summary>
        /// A armadilha mais cara do projeto (erro 1223). Todo arquivo vindo da
        /// internet carrega o fluxo alternativo `Zone.Identifier`, e o launcher abre
        /// os processos com a janela OCULTA — sem janela não há onde clicar na
        /// confirmação, então o Windows cancela na hora sem perguntar nada. O
        /// sintoma no jogador é o jogo não abrir DEPOIS de uma atualização
        /// bem-sucedida.
        ///
        /// A marca é posta à mão aqui porque o download é local; num Release de
        /// verdade quem a põe é o navegador.
        /// </summary>
        static void MarcaDaWebSaiDoExeNovo(string dir)
        {
            var (alvo, fonte, m) = Cenario(dir);
            string novoEsperado = alvo + ".new";

            // O fluxo alternativo sobrevive ao truncamento do fluxo principal, que
            // e' o que o File.Create do BaixarAsync faz — entao marcar aqui, antes,
            // e' equivalente a ter baixado um arquivo marcado.
            File.WriteAllText(novoEsperado, "");
            if (!TentarMarcar(novoEsperado))
            { Log.Warn("  (pulado: o %TEMP% nao e' NTFS, nao da' para simular a marca da web)"); return; }
            Checa(TemMarcaDaWeb(novoEsperado), "a marca da web foi posta no .new (preparo do caso)");

            string novo = SelfUpdater.BaixarAsync(m, fonte, exeAtual: alvo).GetAwaiter().GetResult();
            Checa(novo != null, "o exe novo baixou");
            Checa(!TemMarcaDaWeb(novoEsperado),
                  "a marca da web foi REMOVIDA do exe novo (senao: erro 1223, jogo nao abre)");
        }

        /// <summary>
        /// A coreografia inteira, com o `.bat` rodando de verdade: espera o PID
        /// morrer, copia por cima, apaga o `.new` e se autodeleta.
        ///
        /// O PID esperado é o de um processo que JÁ morreu — assim a espera termina
        /// na hora sem precisar encerrar quem está testando, mas o laço `tasklist`
        /// do `.bat` é exercitado do mesmo jeito.
        /// </summary>
        static void CoreografiaCompleta(string dir)
        {
            var (alvo, fonte, m) = Cenario(dir);

            string novo = SelfUpdater.BaixarAsync(m, fonte, exeAtual: alvo).GetAwaiter().GetResult();
            Checa(novo != null && File.Exists(novo), "o .new baixou e conferiu o sha256");
            if (novo == null) return;
            Checa(File.ReadAllText(novo) == NOVA, "o .new tem o conteudo da versao nova");

            // Fotografia de antes: o %TEMP% pode ter um .bat de uma troca real
            // pendente, e conta-los todos faria este caso falhar por acaso.
            var batsAntes = new System.Collections.Generic.HashSet<string>(
                Directory.EnumerateFiles(Path.GetTempPath(), "duelacademy-update-*.bat"),
                StringComparer.OrdinalIgnoreCase);

            int pidMorto = PidDeUmProcessoQueJaMorreu();
            // reabrir: false — abrir um "exe" que e' um arquivo de texto so'
            // produziria uma janela de erro no meio do teste.
            bool agendou = SelfUpdater.AgendarTroca(novo, reabrir: false, exeAtual: alvo, pidEsperar: pidMorto);
            Checa(agendou, "a troca foi agendada (o .bat foi escrito e disparado)");
            if (!agendou) return;

            bool trocou = Esperar(() => File.ReadAllText(alvo) == NOVA, TimeSpan.FromSeconds(20));
            Checa(trocou, "o .bat copiou a versao nova por cima do exe antigo",
                  "passaram 20s e o arquivo continua com o conteudo antigo");

            Checa(Esperar(() => !File.Exists(novo), TimeSpan.FromSeconds(5)),
                  "o .bat apagou o .new depois de copiar");

            // O .bat se autodeleta no fim (`del "%~f0"`). Se ficasse, cada
            // atualizacao deixaria lixo no %TEMP% do jogador para sempre.
            Checa(Esperar(() => !Directory.EnumerateFiles(Path.GetTempPath(), "duelacademy-update-*.bat")
                                           .Any(b => !batsAntes.Contains(b)),
                  TimeSpan.FromSeconds(5)),
                  "o .bat se autodeletou");
        }

        // ------------------------------------------------------------- a bancada

        static string Sub(string bancada, string nome)
        {
            string d = Path.Combine(bancada, nome);
            Directory.CreateDirectory(d);
            return d;
        }

        /// <summary>Um "exe" antigo em disco + um Release falso com o "exe" novo.</summary>
        static (string alvo, FonteDeAssets fonte, Manifest m) Cenario(string dir)
        {
            string alvo = Path.Combine(dir, "ClassicDuels.exe");
            File.WriteAllText(alvo, ANTIGA);

            string release = Path.Combine(dir, "release");
            Directory.CreateDirectory(release);
            string asset = Path.Combine(release, "ClassicDuels.exe");
            File.WriteAllText(asset, NOVA);

            var m = new Manifest
            {
                GameVersion = "selfupdate-1",
                Installer = new InstaladorInfo
                {
                    Version = "0.2.0",
                    Asset = "ClassicDuels.exe",
                    Sha256 = HashCache.Computar(asset),
                    Size = new FileInfo(asset).Length
                }
            };
            return (alvo, new FonteLocal(release), m);
        }

        /// <summary>
        /// Sobe e derruba um processo só para ter um PID que o Windows já não
        /// conhece — o `.bat` espera por ele e sai do laço na primeira volta.
        /// </summary>
        static int PidDeUmProcessoQueJaMorreu()
        {
            using var p = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c exit",
                CreateNoWindow = true,
                UseShellExecute = false
            });
            p.WaitForExit();
            return p.Id;
        }

        static bool Esperar(Func<bool> condicao, TimeSpan limite)
        {
            var relogio = Stopwatch.StartNew();
            while (relogio.Elapsed < limite)
            {
                try { if (condicao()) return true; } catch { }
                Thread.Sleep(120);
            }
            try { return condicao(); } catch { return false; }
        }

        static bool TentarMarcar(string arquivo)
        {
            try
            {
                File.WriteAllText(arquivo + ":Zone.Identifier",
                                  "[ZoneTransfer]\r\nZoneId=3\r\n", Encoding.ASCII);
                return TemMarcaDaWeb(arquivo);
            }
            catch { return false; }
        }

        static bool TemMarcaDaWeb(string arquivo)
        {
            try { return File.ReadAllText(arquivo + ":Zone.Identifier").Contains("ZoneId"); }
            catch { return false; }
        }
    }
}
