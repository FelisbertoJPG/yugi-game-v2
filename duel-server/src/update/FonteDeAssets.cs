using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace DuelServer.Update
{
    /// <summary>
    /// De ONDE vêm o manifesto e os arquivos. O núcleo do updater não sabe se é
    /// GitHub, uma pasta local ou um servidor próprio — é o que permite rodar o
    /// self-test inteiro (`--test-update`) sem rede e sem publicar nada.
    /// </summary>
    public abstract class FonteDeAssets
    {
        /// <summary>Descrição curta para o log ("github FelisbertoJPG/yugi-server-@latest").</summary>
        public abstract string Descricao { get; }

        /// <summary>Conteúdo cru do manifest.json.</summary>
        public abstract Task<string> ManifestoAsync(CancellationToken ct);

        /// <summary>
        /// Abre o asset para leitura. <paramref name="url"/> tem precedência sobre
        /// <paramref name="asset"/> quando os dois vierem preenchidos.
        /// </summary>
        public abstract Task<Stream> AbrirAsync(string asset, string url, CancellationToken ct);
    }

    /// <summary>
    /// Uma pasta no disco fazendo as vezes de Release. É o que o `--test-update`
    /// usa: monta um "Release falso" no %TEMP% e exercita load→plan→apply→re-scan
    /// exatamente pelo mesmo caminho de código do GitHub.
    /// </summary>
    public sealed class FonteLocal : FonteDeAssets
    {
        readonly string _dir;
        public FonteLocal(string dir) { _dir = Path.GetFullPath(dir); }

        public override string Descricao => $"pasta local {_dir}";

        public override Task<string> ManifestoAsync(CancellationToken ct) =>
            File.ReadAllTextAsync(Path.Combine(_dir, "manifest.json"), ct);

        public override Task<Stream> AbrirAsync(string asset, string url, CancellationToken ct)
        {
            string caminho = !string.IsNullOrEmpty(url) && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.IsFile
                ? u.LocalPath
                : Path.Combine(_dir, asset ?? "");

            if (!File.Exists(caminho))
                throw new FileNotFoundException($"asset ausente na fonte: {asset ?? url}", caminho);

            return Task.FromResult<Stream>(File.OpenRead(caminho));
        }
    }
}
