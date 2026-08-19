using System;
using System.IO;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// O log da CASCA — as poucas linhas escritas antes de o motor existir.
    ///
    /// Nao da' para usar o `YGO.Log` daqui: ele mora dentro do motor, que e'
    /// justamente o que ainda nao foi carregado. Escreve no MESMO arquivo
    /// (`logs/duel-server.log`, ao lado do executavel) e no mesmo formato, para
    /// "ler o log" continuar sendo uma coisa so'.
    ///
    /// Quem abre a sessao no arquivo passa a ser a casca; o motor ve' a variavel
    /// de ambiente e nao repete o cabecalho.
    /// </summary>
    internal static class CascaLog
    {
        internal const string VarSessao = "CLASSICDUELS_LOG_SESSAO";

        static readonly object _trava = new();
        static string _arquivo;
        static bool _iniciado;

        static void Garantir()
        {
            if (_iniciado) return;
            _iniciado = true;
            try
            {
                string baseDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
                string dir = Path.Combine(baseDir, "logs");
                Directory.CreateDirectory(dir);
                _arquivo = Path.Combine(dir, "duel-server.log");

                if (File.Exists(_arquivo) && new FileInfo(_arquivo).Length > 5_000_000)
                {
                    string velho = _arquivo + ".old";
                    if (File.Exists(velho)) File.Delete(velho);
                    File.Move(_arquivo, velho);
                }
                File.AppendAllText(_arquivo,
                    $"\n===== sessao {DateTime.Now:yyyy-MM-dd HH:mm:ss} (pid {Environment.ProcessId}) =====\n");
                Environment.SetEnvironmentVariable(VarSessao, "1");
            }
            catch { _arquivo = null; }
        }

        static void NoArquivo(string nivel, string linha)
        {
            Garantir();
            if (_arquivo == null) return;
            lock (_trava)
            {
                try { File.AppendAllText(_arquivo, $"{DateTime.Now:HH:mm:ss} {nivel} {linha}\n"); }
                catch { /* log nunca derruba o jogo */ }
            }
        }

        public static void Info(string msg) { Console.WriteLine(msg); NoArquivo("    ", msg); }

        public static void Warn(string msg)
        {
            var antes = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("[WARN] " + msg);
            Console.ForegroundColor = antes;
            NoArquivo("WARN", msg);
        }

        public static void Err(string msg)
        {
            var antes = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Error.WriteLine("[ERRO] " + msg);
            Console.ForegroundColor = antes;
            NoArquivo("ERRO", msg);
        }
    }
}
