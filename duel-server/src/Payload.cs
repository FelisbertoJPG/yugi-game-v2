using System;
using System.Collections.Generic;
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
    /// execucao o conteudo e' extraido para %LOCALAPPDATA%\ClassicDuels\game e nas
    /// seguintes so' se confere o carimbo.
    ///
    /// Em desenvolvimento nao existe payload embutido: `Exists` da' false e o
    /// Program cai de volta na pasta do repositorio, como sempre foi.
    ///
    /// ------------------------------------------------------------------------
    /// FORMATO (mudou para matar a "atualizacao fantasma" — INSTALADOR-PENDENCIAS §1)
    ///
    ///   payload.zip
    ///   ├── game.zip          copia BYTE A BYTE do dist\release\game.zip publicado
    ///   ├── cards.zip         idem, do dist\release\cards.zip
    ///   ├── payload.markers   "game=game-abc123def456" + "cards=cards-…", lidos do
    ///   │                     dist\release\manifest.json
    ///   └── seed\…            o que os dois pacotes NAO trazem (store/, decks/,
    ///                         package.json) — o estado inicial do jogo
    ///
    /// O motivo de embutir os zips PUBLICADOS em vez de montar a propria arvore:
    /// o diff dos pacotes e' por MARCADOR, e o marcador e' derivado do sha256 do
    /// zip. Dois `CreateFromDirectory` sobre o mesmo conteudo nao produzem bytes
    /// iguais (o zip guarda o timestamp de cada entrada), entao um payload montado
    /// aqui nunca casaria com o Release — e o primeiro boot de toda instalacao
    /// nova oferecia ~26 MB de atualizacao do conteudo que ele mesmo acabara de
    /// instalar. Consumindo os mesmos arquivos, os marcadores batem e a instalacao
    /// nova ja' nasce em dia.
    /// </summary>
    public static class Payload
    {
        const string ResourceName = "payload.zip";
        const string Marcadores = "payload.markers";
        const string Semente = "seed/";

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

        /// <summary>A pasta em %LOCALAPPDATA% onde o jogo se instala.</summary>
        public const string PASTA = "ClassicDuels";

        /// <summary>
        /// O nome que a pasta tinha quando o jogo se chamava **Duel Academy**.
        /// Fica literal aqui, e não pode ser renomeado junto com o resto: é o
        /// nome do que já está no disco de quem joga, e não o nome do jogo.
        /// </summary>
        public const string PASTA_ANTIGA = "DuelAcademy";

        /// <summary>
        /// **A instalação que ficou com o nome antigo.**
        ///
        /// O jogo se chamava Duel Academy, e a pasta tinha o nome dele. Só que
        /// dentro dela não mora apenas o jogo: moram os `decks/` e o `store/`,
        /// que são de quem joga e o instalador tem ordem de nunca tocar. Trocar
        /// o nome sem mais nada abandonaria tudo isso num canto do disco e
        /// reinstalaria do zero por cima.
        ///
        /// Move a pasta INTEIRA — assim `game/`, os marcadores `.duelacademy/`
        /// (que continuam com o nome velho de propósito: são invisíveis, e
        /// renomeá-los faria todo cliente instalado rebaixar 28 MB à toa) e o
        /// que mais estiver lá viajam juntos, sem o instalador perceber
        /// diferença nenhuma.
        ///
        /// Nunca sobrescreve: se a pasta nova já existe, uma instalação nova já
        /// aconteceu e ela é a verdade. Falhar aqui não é fatal — o jogo segue e
        /// instala do zero, que é o pior caso e não a regra.
        ///
        /// Devolve `true` quando a mudança aconteceu de verdade.
        /// </summary>
        public static bool MigrarInstalacaoAntiga(string velha, string nova)
        {
            try
            {
                if (string.IsNullOrEmpty(velha) || string.IsNullOrEmpty(nova)) return false;
                if (!Directory.Exists(velha) || Directory.Exists(nova)) return false;

                Directory.CreateDirectory(Path.GetDirectoryName(nova) ?? ".");
                Directory.Move(velha, nova);
                Log.Info($"instalacao antiga migrada: {velha} -> {nova}");
                return true;
            }
            catch (Exception e)
            {
                // Pasta em uso, permissao, disco diferente… O jogo continua: a
                // instalacao nova acontece do zero na pasta nova, e a antiga fica
                // onde esta' (nada e' apagado).
                Log.Warn($"nao consegui migrar a instalacao antiga ({e.Message}) — " +
                         "o jogo vai instalar do zero na pasta nova");
                return false;
            }
        }

        /// <summary>
        /// Garante o jogo extraido em disco e devolve a raiz. Null quando este
        /// executavel nao carrega payload (build de desenvolvimento).
        /// </summary>
        public static string EnsureExtracted()
        {
            if (!Exists) return null;

            string carimbo = Carimbo();
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            // Quem ja' jogava tem a instalacao — e os decks e o store dentro dela
            // — na pasta com o nome ANTIGO do jogo.
            MigrarInstalacaoAntiga(Path.Combine(local, PASTA_ANTIGA),
                                   Path.Combine(local, PASTA));
            string root = Path.Combine(local, PASTA, "game");
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

            using (var s = Open())
            {
                var (escritos, preservados) = Instalar(s, root);
                Log.Info($"{escritos} arquivos instalados" +
                         (preservados > 0 ? $", {preservados} preservados (seus decks/carteira)" : ""));
            }

            File.WriteAllText(marca, carimbo);
            return root;
        }

        /// <summary>
        /// A extração em si, separada do recurso embutido para o `--test-payload`
        /// poder rodá-la com um payload de mentira. É o mesmo código que o
        /// executável distribuído roda no primeiro boot.
        /// </summary>
        internal static (int escritos, int preservados) Instalar(Stream payloadZip, string root)
        {
            int escritos = 0, preservados = 0;
            var versoes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var pacotes = new List<(string id, ZipArchiveEntry entrada)>();

            using var zip = new ZipArchive(payloadZip, ZipArchiveMode.Read);

            // 1a passada: o mapa id -> versao, e a semente (store/, decks/,
            // package.json). Os pacotes ficam para depois porque so' com as
            // versoes em maos da' para registrar o marcador de cada um.
            foreach (var entry in zip.Entries)
            {
                if (entry.FullName.EndsWith("/")) continue;               // diretorio
                string nome = entry.FullName.Replace('\\', '/');

                if (nome.Equals(Marcadores, StringComparison.OrdinalIgnoreCase))
                { LerMarcadores(entry, versoes); continue; }

                if (nome.Equals("game.zip", StringComparison.OrdinalIgnoreCase) ||
                    nome.Equals("cards.zip", StringComparison.OrdinalIgnoreCase))
                { pacotes.Add((Path.GetFileNameWithoutExtension(nome), entry)); continue; }

                // `seed/x` vai para `x`. Qualquer outra coisa e' o formato
                // antigo (arvore crua na raiz do payload) e continua servindo.
                string destinoRel = nome.StartsWith(Semente, StringComparison.OrdinalIgnoreCase)
                    ? nome.Substring(Semente.Length)
                    : nome;
                if (destinoRel.Length == 0) continue;

                if (!Update.SafePath.TryCombine(root, destinoRel, out string destino)) continue;
                if (File.Exists(destino) && EhDoJogador(destinoRel)) { preservados++; continue; }

                Directory.CreateDirectory(Path.GetDirectoryName(destino));
                entry.ExtractToFile(destino, overwrite: true);
                escritos++;
            }

            // 2a passada: os pacotes, do jeito que o auto-updater os instalaria.
            foreach (var (id, entrada) in pacotes)
                escritos += ExtrairPacote(root, id, entrada, versoes);

            return (escritos, preservados);
        }

        /// <summary>
        /// Extrai um `game.zip`/`cards.zip` embutido e registra marcador +
        /// inventario, exatamente como o <see cref="Update.UpdateEngine"/> faria.
        ///
        /// Sem a versao (payload sem `payload.markers`, ou marcador ausente para
        /// este id) o conteudo AINDA e' instalado — o jogo abre —, mas o marcador
        /// nao e' escrito e a checagem seguinte vai oferecer o pacote. E' o
        /// comportamento antigo, e e' o certo: mentir um marcador que nao veio do
        /// Release deixaria o jogador preso numa versao velha para sempre.
        /// </summary>
        static int ExtrairPacote(string root, string id, ZipArchiveEntry entrada,
                                 Dictionary<string, string> versoes)
        {
            var instalados = new List<string>();

            // O zip aninhado precisa passar por um arquivo temporario: o stream de
            // uma entrada de zip nao e' navegavel, e o ZipArchive em modo leitura
            // exige navegar (ele le' o diretorio central, que fica no FIM). Sem
            // isto o `cards.zip` embutido nem abre.
            string tmp = Path.Combine(Path.GetTempPath(), $"duelacademy-payload-{id}-{Guid.NewGuid():N}.zip");
            try
            {
                using (var origem = entrada.Open())
                using (var saida = File.Create(tmp))
                    origem.CopyTo(saida);

                using var interno = ZipFile.OpenRead(tmp);
                foreach (var e in interno.Entries)
                {
                    if (string.IsNullOrEmpty(e.Name)) continue;               // diretorio
                    string rel = e.FullName.Replace('\\', '/');
                    if (!Update.SafePath.TryCombine(root, rel, out string destino)) continue;
                    if (File.Exists(destino) && EhDoJogador(rel)) continue;

                    Directory.CreateDirectory(Path.GetDirectoryName(destino));
                    e.ExtractToFile(destino, overwrite: true);
                    instalados.Add(Update.SafePath.Rel(root, destino) ?? rel);
                }
            }
            catch (Exception e)
            {
                Log.Err($"nao consegui extrair o pacote '{id}' embutido: {e.Message}");
                return instalados.Count;
            }
            finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }

            if (versoes.TryGetValue(id, out string versao) && !string.IsNullOrEmpty(versao))
            {
                try
                {
                    Update.UpdateEngine.RegistrarPacoteInstalado(root, id, versao, instalados);
                    Log.Info($"pacote '{id}' embutido: {instalados.Count} arquivos — {versao}");
                }
                catch (Exception e) { Log.Warn($"nao consegui marcar o pacote '{id}': {e.Message}"); }
            }
            else
            {
                Log.Warn($"pacote '{id}' embutido sem versao no {Marcadores} — " +
                         "a primeira checagem vai oferece-lo de novo");
            }
            return instalados.Count;
        }

        /// <summary>Formato do `payload.markers`: uma linha `id=versao` por pacote.</summary>
        static void LerMarcadores(ZipArchiveEntry entry, Dictionary<string, string> destino)
        {
            try
            {
                using var r = new StreamReader(entry.Open());
                string linha;
                while ((linha = r.ReadLine()) != null)
                {
                    int i = linha.IndexOf('=');
                    if (i <= 0) continue;
                    destino[linha.Substring(0, i).Trim()] = linha.Substring(i + 1).Trim();
                }
            }
            catch (Exception e) { Log.Warn($"{Marcadores} ilegivel: {e.Message}"); }
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
