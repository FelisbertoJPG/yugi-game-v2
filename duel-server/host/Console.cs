using System;
using System.IO;
using System.Runtime.InteropServices;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// **O jogo deixou de abrir uma janela de terminal** (23/08/2026).
    ///
    /// Para quem não é técnico, um console preto aparecendo por cima do jogo e
    /// tendo de ser minimizado é ruído, não informação — e era exatamente o que
    /// acontecia: o `.exe` era um programa de console, então o Windows criava a
    /// janela antes de qualquer linha de código nossa rodar. A troca é
    /// `&lt;OutputType&gt;WinExe&lt;/OutputType&gt;` no `duel-server.csproj`, e é o
    /// Windows quem para de criá-la.
    ///
    /// O PREÇO, e é este arquivo que o paga: um `WinExe` chamado DE UM TERMINAL
    /// não se anexa a ele, e todo o `Console.WriteLine` some. O mesmo executável
    /// roda as suítes (`duel-server.exe --test-campos`, `--cobertura deck.ydk`,
    /// `--probe-idle`…), e elas ficariam mudas — o resultado ia para o arquivo de
    /// log e a janela do desenvolvedor não mostrava nada.
    ///
    /// `AttachConsole(ATTACH_PARENT_PROCESS)` resolve os dois casos com a mesma
    /// linha, porque a resposta vem de QUEM CHAMOU:
    ///
    ///   • chamado de um terminal → o pai tem console, anexa, e a saída aparece
    ///     ali como sempre apareceu;
    ///   • dois cliques no ícone → o pai é o Explorer, que não tem console;
    ///     `AttachConsole` falha, não se cria nada, e o jogador não vê janela
    ///     nenhuma. É o comportamento que se queria.
    ///
    /// Anexar não basta: os `TextWriter` que o .NET monta para um processo sem
    /// console escrevem no vazio, e continuariam escrevendo no vazio depois. Por
    /// isso as saídas são REABERTAS logo em seguida.
    /// </summary>
    internal static class ConsoleDoPai
    {
        const int ATTACH_PARENT_PROCESS = -1;

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AttachConsole(int dwProcessId);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetConsoleWindow();

        const int STD_OUTPUT_HANDLE = -11;

        [DllImport("kernel32.dll")]
        static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll")]
        static extern uint GetFileType(IntPtr hFile);

        /// <summary>
        /// Da' para ESCREVER neste handle?
        ///
        /// "Nao e' nulo" nao basta, e essa foi a primeira versao desta funcao: um
        /// `WinExe` chamado do terminal recebe um handle nao-nulo e INVALIDO, e a
        /// primeira escrita morria com `IOException: Identificador invalido` —
        /// derrubando o processo inteiro na primeira linha de log.
        ///
        /// `GetFileType` e' o teste de verdade: 1 disco, 2 console, 3 pipe; zero
        /// e' "nao sei o que e' isto", que na pratica e' handle morto.
        /// </summary>
        static bool DaParaEscrever(IntPtr h)
        {
            if (h == IntPtr.Zero || h == new IntPtr(-1)) return false;
            uint tipo = GetFileType(h);
            return tipo == 1 || tipo == 2 || tipo == 3;
        }

        /// <summary>
        /// Este processo tem para onde escrever? Falso = dois cliques no ícone, e
        /// aí uma mensagem de erro precisa virar caixa de diálogo para ser vista.
        /// </summary>
        internal static bool TemConsole { get; private set; }

        /// <summary>
        /// Chame ANTES de qualquer escrita. Nunca lança: um jogo que não abre
        /// porque o console não pôde ser anexado seria o pior negócio possível.
        /// </summary>
        internal static void Anexar()
        {
            try
            {
                // Ja' existe console (build de console, ou alguem alocou um)? Nada
                // a fazer — anexar de novo falharia e reabrir as saidas so'
                // trocaria writers bons por writers iguais.
                if (GetConsoleWindow() != IntPtr.Zero) { TemConsole = true; return; }

                // JA' HA' PARA ONDE ESCREVER? Um handle valido aqui significa que
                // quem chamou passou um: um pipe (`| grep`, o npm capturando a
                // saida da suite), um arquivo (`> log.txt`) ou o console dele.
                //
                // Esta linha e' um conserto, nao precaucao: sem ela o
                // `AttachConsole` abaixo era seguido de um `Console.SetOut` que
                // JOGAVA O PIPE FORA e mandava tudo para o console. O sintoma foi
                // `npm run update:test` respondendo exit 0 com a saida das suites
                // sumida — o resultado ia para a janela e o npm capturava nada.
                if (DaParaEscrever(GetStdHandle(STD_OUTPUT_HANDLE))) { TemConsole = true; return; }

                if (!AttachConsole(ATTACH_PARENT_PROCESS)) return;
                TemConsole = true;

                var saida = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
                var erro = new StreamWriter(Console.OpenStandardError()) { AutoFlush = true };
                Console.SetOut(saida);
                Console.SetError(erro);
            }
            catch
            {
                // Sem console. O log em arquivo continua inteiro, e o que o
                // JOGADOR precisa ver sai por caixa de dialogo (`AvisoDaCasca`).
            }
        }
    }

    /// <summary>
    /// A mensagem que o JOGADOR precisa ver quando o jogo não abre.
    ///
    /// Existe porque tirar o terminal tirou junto o único lugar onde a casca
    /// falava: `CascaLog.Err` escreve no arquivo e no console, e sem console o
    /// desfecho de "o motor não subiu" passaria a ser o jogo simplesmente não
    /// aparecer, em silêncio absoluto. É o mesmo motivo — e quase o mesmo código
    /// — do `Aviso` que já existe do lado do motor; ele não pode ser reusado
    /// daqui justamente porque mora no motor, que é o que falhou em carregar.
    /// </summary>
    internal static class AvisoDaCasca
    {
        const uint MB_OK = 0x0, MB_ICONERROR = 0x10, MB_TOPMOST = 0x40000;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

        internal static void Erro(string texto)
        {
            CascaLog.Err(texto.Replace("\n", " "));
            if (ConsoleDoPai.TemConsole) return;               // ja' foi visto no terminal
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return;
            try { MessageBoxW(IntPtr.Zero, texto, "Classic Duels", MB_OK | MB_ICONERROR | MB_TOPMOST); }
            catch { /* sem UI: o log em arquivo e' o que sobra */ }
        }
    }
}
