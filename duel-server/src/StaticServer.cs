using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Porte em C# do `tools/serve.mjs`: serve os arquivos do projeto (web/ e
    /// ygo-data/ juntos, que e' o que o front precisa) e as duas APIs de disco,
    /// `/__decks/*` e `/__store/*`.
    ///
    /// Existe para o executavel empacotado nao depender de Node instalado. Em
    /// desenvolvimento o serve.mjs continua sendo o servidor — este aqui so' entra
    /// no modo `--app`, e as rotas sao identicas de proposito: o front nao sabe
    /// (nem precisa saber) qual dos dois esta atendendo.
    /// </summary>
    public static class StaticServer
    {
        static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
        {
            [".html"] = "text/html; charset=utf-8",
            [".js"] = "text/javascript; charset=utf-8",
            [".mjs"] = "text/javascript; charset=utf-8",
            [".json"] = "application/json; charset=utf-8",
            [".css"] = "text/css; charset=utf-8",
            [".lua"] = "text/plain; charset=utf-8",
            [".ydk"] = "text/plain; charset=utf-8",
            [".txt"] = "text/plain; charset=utf-8",
            [".cdb"] = "application/vnd.sqlite3",
            [".svg"] = "image/svg+xml",
            [".png"] = "image/png",
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".webp"] = "image/webp",
            [".gif"] = "image/gif",
            [".ico"] = "image/x-icon",
            [".woff2"] = "font/woff2",
        };

        /// <summary>Atende o que nao for rota da API de duelo. `true` se respondeu.</summary>
        public static bool Handle(HttpListenerContext ctx, string root)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            string path = Uri.UnescapeDataString(req.Url?.AbsolutePath ?? "/");

            // Escrever no disco nao e' coisa que se deixe aberta para a rede — mas
            // LER (GET: listar decks, ver store/banlist) precisa funcionar de outro
            // aparelho na LAN (ex.: o app mobile, que e' cliente fino deste mesmo
            // servidor). So' bloqueia fora de localhost quando o metodo NAO e' GET.
            if (path.StartsWith("/__") && req.HttpMethod != "GET" && !req.IsLocal)
            { Status(res, 403, "403"); return true; }

            if (path.StartsWith("/__decks/")) return Decks(ctx, root, path.Substring("/__decks/".Length));
            if (path.StartsWith("/__store/")) return Store(ctx, root, path.Substring("/__store/".Length));
            if (path.StartsWith("/__boards/")) return Boards(ctx, root, path.Substring("/__boards/".Length));
            if (path.StartsWith("/__update/")) return UpdateApi(ctx, path.Substring("/__update/".Length));

            // Redireciona de verdade em vez de servir o index na raiz: um documento
            // servido em '/' faz os caminhos relativos dele resolverem contra '/',
            // e o modulo nunca carrega. Ja custou uma home inteira quebrada.
            if (path == "/" || path == "/web" || path == "/web/")
            {
                res.StatusCode = 302;
                res.Headers["Location"] = "/web/index.html";
                res.Close();
                return true;
            }

            return Arquivo(res, root, path);
        }

        static bool Arquivo(HttpListenerResponse res, string root, string path)
        {
            string full;
            try { full = Path.GetFullPath(Path.Combine(root, path.TrimStart('/', '\\'))); }
            catch { Status(res, 404, "404"); return true; }

            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            { Status(res, 403, "403"); return true; }
            if (!File.Exists(full)) { Status(res, 404, "404"); return true; }

            try
            {
                byte[] bytes = File.ReadAllBytes(full);
                res.StatusCode = 200;
                res.ContentType = Mime.TryGetValue(Path.GetExtension(full), out var m)
                    ? m : "application/octet-stream";
                res.Headers["Cache-Control"] = "no-cache";
                res.ContentLength64 = bytes.Length;
                res.OutputStream.Write(bytes, 0, bytes.Length);
                res.Close();
            }
            catch (Exception e) { Log.Err($"[static] {path}: {e.Message}"); try { res.Abort(); } catch { } }
            return true;
        }

        // ------------------------------------------------------------- decks/

        /// <summary>
        /// Resolve um caminho pedido pelo cliente para dentro de `baseDir`.
        ///
        /// RECUSA o suspeito em vez de "consertar": sanitizar em silencio faz
        /// `../../evil.ydk` virar `decks/evil.ydk`, o arquivo aparece onde ninguem
        /// pediu e o cliente recebe um "deu certo". Melhor falhar alto.
        /// </summary>
        static string CaminhoDeckEm(string baseDir, string rel)
        {
            if (string.IsNullOrWhiteSpace(rel)) return null;
            if (Regex.IsMatch(rel, @"^([a-zA-Z]:|[/\\])")) return null;     // absoluto / UNC

            var partes = rel.Split('/', '\\');
            if (partes.Any(p => p.Length == 0 || p == "." || p == "..")) return null;
            if (!string.Equals(Path.GetExtension(rel), ".ydk", StringComparison.OrdinalIgnoreCase)) return null;

            string full = Path.GetFullPath(Path.Combine(baseDir, Path.Combine(partes)));
            // cinto e suspensorio: mesmo com tudo acima, confirma a contencao
            if (!full.StartsWith(baseDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return null;
            return full;
        }

        /// <summary>
        /// Onde um path de deck pedido pelo cliente REALMENTE mora: `player/*`
        /// pertence a quem está logado (`decks/users/&lt;usuário&gt;/player/*`,
        /// exige sessão); `npc/*` (e qualquer outra coisa) continua em
        /// `decks/`, global — deck de NPC não é progresso de ninguém. O
        /// cliente nunca vê essa distinção: o `path` continua `player/x.ydk`.
        /// </summary>
        static (string full, string error, int status) ResolveDeckPath(HttpListenerContext ctx, string root, string rel)
        {
            // Deck do JOGADOR nao mora mais em disco: vive em `decks_jogador`
            // no Supabase, e gravar passa por `salvar_deck()`, que confere cada
            // carta contra a colecao dele. Recusar aqui em vez de aceitar em
            // silencio e' o ponto — um cliente velho que ainda tentasse este
            // caminho estaria justamente contornando a conferencia de posse.
            if (rel != null && (rel == "player" || rel.StartsWith("player/") || rel.StartsWith("player\\")))
                return (null, "decks do jogador ficam no Supabase, nao em disco", 410);
            string full2 = CaminhoDeckEm(Path.Combine(root, "decks"), rel);
            if (full2 == null) return (null, "caminho invalido (precisa ser .ydk dentro de decks/)", 400);
            return (full2, null, 0);
        }

        static bool Decks(HttpListenerContext ctx, string root, string acao)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            string decks = Path.Combine(root, "decks");
            // Backup de antes do login existir — nao e' conteudo de jogo, so
            // precisa ficar fora da listagem (mesma exclusao do lado Node).
            string legacyBackup = Path.Combine(decks, "legacy-backup-player");

            if (acao == "list")
            {
                var itens = new List<object>();
                if (Directory.Exists(decks))
                {
                    foreach (var f in Directory.EnumerateFiles(decks, "*.ydk", SearchOption.AllDirectories))
                    {
                        if (f.StartsWith(legacyBackup + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                        try
                        {
                            string texto = File.ReadAllText(f);
                            itens.Add(new
                            {
                                path = Path.GetRelativePath(decks, f).Replace('\\', '/'),
                                meta = LerMeta(texto),
                                content = texto,
                            });
                        }
                        catch { /* sumiu no meio da varredura */ }
                    }
                }
                // So' conteudo do jogo (npc/...). Os decks do JOGADOR vem do
                // Supabase e sao juntados no cliente, em `projectdecks.js` —
                // aqui eles nem sao lidos.
                Json(res, new { ok = true, decks = itens });
                return true;
            }

            if (acao == "save" && req.HttpMethod == "POST")
            {
                var body = Body(req);
                string rel = Str(body, "path");
                var (full, error, status) = ResolveDeckPath(ctx, root, rel);
                if (full == null) { Json(res, new { ok = false, error }, status); return true; }
                string conteudo = Str(body, "content");
                if (string.IsNullOrWhiteSpace(conteudo))
                { Json(res, new { ok = false, error = "conteudo vazio" }, 400); return true; }

                Directory.CreateDirectory(Path.GetDirectoryName(full));
                File.WriteAllText(full, conteudo, new UTF8Encoding(false));
                Log.Info($"deck salvo: {Path.GetRelativePath(root, full)}");
                // `rel` já validou como seguro — é o mesmo path público que o
                // cliente mandou, só normalizado (nunca deriva de `full`: pra
                // um deck de usuário, `full` mora fora de decks/ "puro").
                string publico = string.Join('/', rel.Trim().Split('/', '\\'));
                Json(res, new { ok = true, path = publico });
                return true;
            }

            if (acao == "delete" && req.HttpMethod == "POST")
            {
                var (full, error, status) = ResolveDeckPath(ctx, root, Str(Body(req), "path"));
                if (full == null) { Json(res, new { ok = false, error }, status); return true; }
                if (!File.Exists(full)) { Json(res, new { ok = false, error = "nao existe" }, 404); return true; }
                try { File.Delete(full); Log.Info($"deck removido: {Path.GetRelativePath(root, full)}"); }
                catch (Exception e) { Json(res, new { ok = false, error = e.Message }, 404); return true; }
                Json(res, new { ok = true });
                return true;
            }

            Json(res, new { ok = false, error = "acao desconhecida" }, 404);
            return true;
        }

        /// <summary>Le os `#chave valor` do topo do .ydk sem o parser completo.</summary>
        static Dictionary<string, string> LerMeta(string texto)
        {
            var meta = new Dictionary<string, string>();
            foreach (var bruta in texto.Split('\n'))
            {
                string linha = bruta.Trim();
                if (linha.StartsWith("#main")) break;
                var m = Regex.Match(linha, @"^#([a-zA-Z][\w-]*)\s+(.+)$");
                if (m.Success) meta[m.Groups[1].Value.ToLowerInvariant()] = m.Groups[2].Value.Trim();
            }
            return meta;
        }

        // ------------------------------------------------------------ boards/

        /// <summary>Layouts de campo do editor (web/campo.html). Flat como store/
        /// (sem subpastas), mas com list/save/delete como decks/ — o editor
        /// precisa navegar vários tabuleiros, não só ler um pelo nome.</summary>
        static string CaminhoBoard(string root, string nome)
        {
            if (string.IsNullOrEmpty(nome) || !Regex.IsMatch(nome, @"^[a-zA-Z0-9_-]+\.json$")) return null;
            string boards = Path.Combine(root, "boards");
            string full = Path.GetFullPath(Path.Combine(boards, nome));
            if (!full.StartsWith(boards + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return null;
            return full;
        }

        static bool Boards(HttpListenerContext ctx, string root, string acao)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            string boards = Path.Combine(root, "boards");

            if (acao == "list")
            {
                var itens = new List<object>();
                if (Directory.Exists(boards))
                {
                    foreach (var f in Directory.EnumerateFiles(boards, "*.json"))
                    {
                        try
                        {
                            itens.Add(new { path = Path.GetFileName(f), content = File.ReadAllText(f) });
                        }
                        catch { /* sumiu no meio da varredura */ }
                    }
                }
                Json(res, new { ok = true, boards = itens });
                return true;
            }

            if (acao == "save" && req.HttpMethod == "POST")
            {
                var body = Body(req);
                string full = CaminhoBoard(root, Str(body, "path"));
                if (full == null)
                { Json(res, new { ok = false, error = "caminho invalido (precisa ser .json dentro de boards/)" }, 400); return true; }
                string conteudo = Str(body, "content");
                if (string.IsNullOrWhiteSpace(conteudo))
                { Json(res, new { ok = false, error = "conteudo vazio" }, 400); return true; }
                try { JsonDocument.Parse(conteudo); }
                catch { Json(res, new { ok = false, error = "conteudo nao e' JSON valido" }, 400); return true; }

                Directory.CreateDirectory(Path.GetDirectoryName(full));
                File.WriteAllText(full, conteudo, new UTF8Encoding(false));
                Log.Info($"tabuleiro salvo: {Path.GetRelativePath(root, full)}");
                Json(res, new { ok = true, path = Path.GetFileName(full) });
                return true;
            }

            if (acao == "delete" && req.HttpMethod == "POST")
            {
                string full = CaminhoBoard(root, Str(Body(req), "path"));
                if (full == null) { Json(res, new { ok = false, error = "caminho invalido" }, 400); return true; }
                if (!File.Exists(full)) { Json(res, new { ok = false, error = "nao existe" }, 404); return true; }
                try { File.Delete(full); Log.Info($"tabuleiro removido: {Path.GetRelativePath(root, full)}"); }
                catch (Exception e) { Json(res, new { ok = false, error = e.Message }, 404); return true; }
                Json(res, new { ok = true });
                return true;
            }

            Json(res, new { ok = false, error = "acao desconhecida" }, 404);
            return true;
        }

        // ------------------------------------------------------------- store/

        /// <summary>So' um nome simples de .json dentro de store/ (sem subpastas).</summary>
        static string CaminhoStore(string root, string nome)
        {
            if (string.IsNullOrEmpty(nome) || !Regex.IsMatch(nome, @"^[a-zA-Z0-9_-]+\.json$")) return null;
            string store = Path.Combine(root, "store");
            string full = Path.GetFullPath(Path.Combine(store, nome));
            if (!full.StartsWith(store + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return null;
            return full;
        }

        static bool Store(HttpListenerContext ctx, string root, string nome)
        {
            var req = ctx.Request;
            var res = ctx.Response;

            // A carteira (DP/colecao/pity) saiu daqui: e' uma linha em
            // `carteiras` no Supabase, onde o dono so' tem SELECT e toda
            // mudanca passa por uma funcao que aplica a regra do jogo. Enquanto
            // era um arquivo, trocar "dp": 2000 por "dp": 999999 num editor de
            // texto era todo o trabalho.
            if (nome == "wallet.json")
            {
                Json(res, new { ok = false, error = "a carteira fica no Supabase, nao em disco" }, 410);
                return true;
            }

            // O resto (banlist/boosters/npcs) e' CONTEUDO do jogo: global,
            // versionado no git, sem sessao nenhuma — igual sempre foi.
            string full = CaminhoStore(root, nome);
            if (full == null) { Json(res, new { ok = false, error = "nome invalido (use <nome>.json)" }, 400); return true; }

            if (req.HttpMethod == "POST")
            {
                string cru = Texto(req);
                if (string.IsNullOrWhiteSpace(cru)) cru = "{}";
                // Reescreve indentado, como o serve.mjs faz, para o arquivo ficar
                // legivel no diff quando alguem commitar store/.
                try
                {
                    using var doc = JsonDocument.Parse(cru);
                    cru = JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
                }
                catch { Json(res, new { ok = false, error = "json invalido" }, 400); return true; }

                Directory.CreateDirectory(Path.GetDirectoryName(full));
                File.WriteAllText(full, cru, new UTF8Encoding(false));
                Log.Info($"store salvo: {Path.GetRelativePath(root, full)}");
                Json(res, new { ok = true });
                return true;
            }

            if (!File.Exists(full)) { Json(res, new { ok = false, error = "nao existe" }, 404); return true; }
            try
            {
                var bytes = File.ReadAllBytes(full);
                res.StatusCode = 200;
                res.ContentType = "application/json; charset=utf-8";
                res.ContentLength64 = bytes.Length;
                res.OutputStream.Write(bytes, 0, bytes.Length);
                res.Close();
            }
            catch (Exception e) { Json(res, new { ok = false, error = e.Message }, 404); }
            return true;
        }

        // ---------------------------------------------------------------- util

        static JsonElement Body(HttpListenerRequest req)
        {
            string texto = Texto(req);
            if (string.IsNullOrWhiteSpace(texto)) texto = "{}";
            try { return JsonDocument.Parse(texto).RootElement.Clone(); }
            catch { return JsonDocument.Parse("{}").RootElement.Clone(); }
        }

        static string Texto(HttpListenerRequest req)
        {
            using var sr = new StreamReader(req.InputStream, req.ContentEncoding ?? Encoding.UTF8);
            return sr.ReadToEnd();
        }

        // ------------------------------------------------------------ update/
        //
        // O progresso vai por POLLING (o front pergunta a cada meio segundo), nao
        // por SSE. Uma atualizacao dura segundos e tem UM estado global — abrir um
        // canal persistente para isso sao mais partes moveis do que a tarefa pede.
        //
        // Nao ha rota que devolva o token nem a URL assinada: quem fala com o
        // GitHub e' o processo, nunca o navegador.
        static bool UpdateApi(HttpListenerContext ctx, string resto)
        {
            var req = ctx.Request;
            var res = ctx.Response;

            // Instalar troca arquivos do jogo — isso e' comando local, nunca da LAN,
            // mesmo com --lan ligado. (A trava geral de /__ so' cobre nao-GET.)
            if (resto == "aplicar")
            {
                if (!req.IsLocal) { Status(res, 403, "403"); return true; }
                if (req.HttpMethod != "POST") { Status(res, 405, "405"); return true; }

                // Com duelo em andamento, a extracao trocaria os ~21 mil .lua e o
                // cards.cdb debaixo do motor — e o cards.cdb esta ABERTO pelo
                // SQLite desde que o duelo comecou, entao a extracao morreria pela
                // metade, com o jogo instalado entre duas versoes. Recusar aqui e'
                // mais barato que consertar isso depois na maquina do jogador.
                // (Um duelo ja' encerrado nao impede nada: a chamada abaixo o
                // libera e fecha o arquivo.)
                if (!DuelServer.WebServer.LiberarDueloEncerrado())
                {
                    Json(res, new { erro = "termine o duelo para atualizar" }, 409);
                    return true;
                }
                DuelServer.Update.UpdateService.Aplicar();
                Json(res, DuelServer.Update.UpdateService.Snapshot());
                return true;
            }

            // Voltar para a versao anterior. Mesmas travas do `aplicar`: e' o
            // mesmo tipo de operacao (trocar os arquivos do jogo em massa), so'
            // que na outra direcao.
            if (resto == "restaurar")
            {
                if (!req.IsLocal) { Status(res, 403, "403"); return true; }
                if (req.HttpMethod != "POST") { Status(res, 405, "405"); return true; }
                if (!DuelServer.WebServer.LiberarDueloEncerrado())
                {
                    Json(res, new { erro = "termine o duelo para restaurar" }, 409);
                    return true;
                }
                Json(res, DuelServer.Update.UpdateService.Restaurar());
                return true;
            }

            if (resto == "status") { Json(res, DuelServer.Update.UpdateService.Snapshot()); return true; }

            Status(res, 404, "404");
            return true;
        }

        static string Str(JsonElement o, string prop) =>
            o.ValueKind == JsonValueKind.Object && o.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() : null;

        static void Json(HttpListenerResponse res, object o, int code = 200)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o));
            res.StatusCode = code;
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }

        static void Status(HttpListenerResponse res, int code, string texto)
        {
            var bytes = Encoding.UTF8.GetBytes(texto);
            res.StatusCode = code;
            res.ContentType = "text/plain; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }
    }
}
