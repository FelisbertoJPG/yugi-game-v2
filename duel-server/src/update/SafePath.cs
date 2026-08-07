using System;
using System.IO;

namespace DuelServer.Update
{
    /// <summary>
    /// Caminhos vindos de fora (manifesto ou entradas de um .zip) NUNCA podem ser
    /// combinados com a raiz sem checagem: um "../../Windows/System32/..." escaparia
    /// da instalação e escreveria onde bem entendesse ("zip slip").
    ///
    /// Isto é a extração — sem mudança de comportamento — do teste que já morava
    /// dentro de <see cref="DuelServer.Payload"/>.EnsureExtracted. Agora o
    /// instalador remoto e o payload embutido usam a MESMA regra, em vez de cada
    /// um ter a sua cópia (que é como uma das duas envelhece sozinha).
    /// </summary>
    public static class SafePath
    {
        /// <summary>
        /// Resolve <paramref name="rel"/> dentro de <paramref name="baseDir"/> e
        /// exige que o resultado fique DENTRO dele. Lança se escapar.
        /// </summary>
        public static string Combine(string baseDir, string rel)
        {
            string raiz = Path.GetFullPath(baseDir).TrimEnd(Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(raiz, rel.Replace('/', Path.DirectorySeparatorChar)));

            if (!full.Equals(raiz, StringComparison.OrdinalIgnoreCase) &&
                !full.StartsWith(raiz + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"caminho inseguro no manifesto: {rel}");

            return full;
        }

        /// <summary>Versão que devolve false em vez de lançar (para laços de extração).</summary>
        public static bool TryCombine(string baseDir, string rel, out string full)
        {
            try { full = Combine(baseDir, rel); return true; }
            catch { full = null; return false; }
        }

        /// <summary>Normaliza para comparar com os `path`/`roots` do manifesto, que usam "/".</summary>
        public static string Rel(string raiz, string absoluto)
        {
            string r = Path.GetFullPath(raiz).TrimEnd(Path.DirectorySeparatorChar);
            string a = Path.GetFullPath(absoluto);
            if (!a.StartsWith(r + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
            return a.Substring(r.Length + 1).Replace('\\', '/');
        }

        /// <summary>`true` se <paramref name="rel"/> é o próprio <paramref name="root"/> ou está dentro dele.</summary>
        public static bool DentroDe(string rel, string root)
        {
            string n = (rel ?? "").Replace('\\', '/').TrimStart('/');
            string r = (root ?? "").Replace('\\', '/').Trim('/');
            if (r.Length == 0) return true;
            return n.Equals(r, StringComparison.OrdinalIgnoreCase) ||
                   n.StartsWith(r + "/", StringComparison.OrdinalIgnoreCase);
        }
    }
}
