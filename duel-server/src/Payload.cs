using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// O jogo inteiro (web/, ygo-data/, cards.cdb e os ~21 mil scripts lua) viaja
    /// DENTRO do executavel quando ele e' publicado por `npm run pack`.
    ///
    /// Isso existe para o projeto poder ser compartilhado: um arquivo so', sem
    /// clonar repositorio, sem instalar .NET e sem instalar Node. Na primeira
    /// execucao o conteudo e' extraido para %LOCALAPPDATA%\DuelAcademy\game e nas
    /// seguintes so' se confere o carimbo.
    ///
    /// Em desenvolvimento nao existe payload embutido: `Exists` da' false e o
    /// Program cai de volta na pasta do repositorio, como sempre foi.
    /// </summary>
    public static class Payload
    {
        const string ResourceName = "payload.zip";

        /// <summary>Pastas cujo conteudo e' do JOGADOR: nunca sobrescrever numa
        /// atualizacao, senao a carteira e os decks dele somem.</summary>
        static readonly string[] Preservadas = { "store/", "decks/" };

        public static bool Exists
        {
            get
            {
                try { return Asm.GetManifestResourceInfo(ResourceName) != null; }
                catch { return false; }
            }
        }

        static Assembly Asm => typeof(Payload).Assembly;

        /// <summary>
        /// Garante o jogo extraido em disco e devolve a raiz. Null quando este
        /// executavel nao carrega payload (build de desenvolvimento).
        /// </summary>
        public static string EnsureExtracted()
        {
            if (!Exists) return null;

            string carimbo = Carimbo();
            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DuelAcademy", "game");
            string marca = Path.Combine(root, ".versao");

            if (Directory.Exists(root) && File.Exists(marca))
            {
                string atual = null;
                try { atual = File.ReadAllText(marca).Trim(); } catch { }
                if (atual == carimbo)
                {
                    Log.Info($"jogo ja instalado em {root}");
                    return root;
                }
                Log.Info("versao nova do jogo — atualizando os arquivos");
            }
            else
            {
                Log.Info($"primeira execucao — instalando o jogo em {root}");
                Log.Info("  (leva alguns segundos; nas proximas vezes abre direto)");
            }

            try { Directory.CreateDirectory(root); }
            catch (Exception e) { Log.Err($"nao consegui criar {root}: {e.Message}"); return null; }

            // Apaga a marca ANTES de mexer nos arquivos: se a extracao morrer no
            // meio, a proxima execucao refaz tudo em vez de rodar pela metade.
            try { if (File.Exists(marca)) File.Delete(marca); } catch { }

            int escritos = 0, preservados = 0;
            using (var zip = new ZipArchive(Open(), ZipArchiveMode.Read))
            {
                foreach (var entry in zip.Entries)
                {
                    if (entry.FullName.EndsWith("/")) continue;               // diretorio
                    string destino = Path.GetFullPath(Path.Combine(root, entry.FullName));
                    if (!destino.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                        continue;                                            // zip slip

                    if (File.Exists(destino) && EhDoJogador(entry.FullName)) { preservados++; continue; }

                    Directory.CreateDirectory(Path.GetDirectoryName(destino));
                    entry.ExtractToFile(destino, overwrite: true);
                    escritos++;
                }
            }

            File.WriteAllText(marca, carimbo);
            Log.Info($"{escritos} arquivos instalados" +
                     (preservados > 0 ? $", {preservados} preservados (seus decks/carteira)" : ""));
            return root;
        }

        static bool EhDoJogador(string entrada)
        {
            string n = entrada.Replace('\\', '/');
            foreach (var p in Preservadas)
                if (n.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        static Stream Open() =>
            Asm.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"recurso {ResourceName} sumiu do executavel");

        /// <summary>
        /// Identidade do conteudo, pelo hash do proprio zip. Nao dependemos de um
        /// numero de versao escrito a mao — que e' justamente o que se esquece de
        /// incrementar, deixando o jogador com arquivos velhos sem aviso nenhum.
        /// </summary>
        static string Carimbo()
        {
            using var s = Open();
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(s)).Substring(0, 16).ToLowerInvariant();
        }
    }
}
