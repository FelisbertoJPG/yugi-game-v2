using System;
using System.IO;
using System.Text.RegularExpressions;

namespace YGO
{
    /// <summary>
    /// Substituto do UnityEngine.Debug para o console app.
    /// Mantem as strings de log originais (com tags de cor da Unity) intactas
    /// nos arquivos portados, mas remove as tags &lt;color=...&gt; na saida.
    ///
    /// Além do console, tudo é anexado a <c>logs/duel-server.log</c> (ao lado do
    /// executável) — assim o log SOBREVIVE ao fechamento do servidor e dá para
    /// "ler o log" depois de uma sessão. Cada boot escreve um separador de sessão
    /// e o arquivo rotaciona (.old) quando passa de 5 MB.
    /// </summary>
    public static class Log
    {
        private static readonly Regex ColorTag = new(@"</?color[^>]*>", RegexOptions.Compiled);
        private static string Strip(object msg) => ColorTag.Replace(msg?.ToString() ?? "", "");

        private static readonly object _lock = new();
        private static bool _init;
        /// <summary>Caminho absoluto do arquivo de log (null se não deu para abrir).</summary>
        public static string FilePath { get; private set; }

        private static void Ensure()
        {
            if (_init) return;
            _init = true;
            try
            {
                string baseDir = Path.GetDirectoryName(Environment.ProcessPath)
                                 ?? AppContext.BaseDirectory;
                string dir = Path.Combine(baseDir, "logs");
                Directory.CreateDirectory(dir);
                FilePath = Path.Combine(dir, "duel-server.log");

                // Rotaciona quando fica grande, preservando a última rodada em .old.
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > 5_000_000)
                {
                    string old = FilePath + ".old";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(FilePath, old);
                }
                // A CASCA (host/CascaLog.cs) escreve no MESMO arquivo e abre a
                // sessao antes de o motor existir. Sem esta guarda o cabecalho
                // sairia duas vezes por boot, com as linhas da casca orfas
                // acima do segundo — que e' justamente onde uma troca de motor
                // mal sucedida deixa o seu rastro.
                if (Environment.GetEnvironmentVariable("CLASSICDUELS_LOG_SESSAO") == "1") return;
                File.AppendAllText(FilePath,
                    $"\n===== sessao {DateTime.Now:yyyy-MM-dd HH:mm:ss} (pid {Environment.ProcessId}) =====\n");
            }
            catch { FilePath = null; }
        }

        private static void ToFile(string level, string line)
        {
            Ensure();
            if (FilePath == null) return;
            lock (_lock)
            {
                try { File.AppendAllText(FilePath, $"{DateTime.Now:HH:mm:ss} {level} {line}\n"); }
                catch { /* nunca deixa o log derrubar o duelo */ }
            }
        }

        public static void Info(object msg)
        {
            string s = Strip(msg);
            Console.WriteLine(s);
            ToFile("    ", s);
        }

        public static void Warn(object msg)
        {
            string s = Strip(msg);
            var prev = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("[WARN] " + s);
            Console.ForegroundColor = prev;
            ToFile("WARN", s);
        }

        public static void Err(object msg)
        {
            string s = Strip(msg);
            var prev = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Error.WriteLine("[ERRO] " + s);
            Console.ForegroundColor = prev;
            ToFile("ERRO", s);
        }
    }
}
