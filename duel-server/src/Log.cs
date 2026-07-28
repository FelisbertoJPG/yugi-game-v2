using System.Text.RegularExpressions;

namespace YGO
{
    /// <summary>
    /// Substituto do UnityEngine.Debug para o console app.
    /// Mantem as strings de log originais (com tags de cor da Unity) intactas
    /// nos arquivos portados, mas remove as tags &lt;color=...&gt; na saida.
    /// </summary>
    public static class Log
    {
        private static readonly Regex ColorTag = new(@"</?color[^>]*>", RegexOptions.Compiled);

        private static string Strip(object msg) => ColorTag.Replace(msg?.ToString() ?? "", "");

        public static void Info(object msg) => Console.WriteLine(Strip(msg));

        public static void Warn(object msg)
        {
            var prev = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("[WARN] " + Strip(msg));
            Console.ForegroundColor = prev;
        }

        public static void Err(object msg)
        {
            var prev = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Error.WriteLine("[ERRO] " + Strip(msg));
            Console.ForegroundColor = prev;
        }
    }
}
