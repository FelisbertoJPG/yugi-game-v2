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
            if (path.StartsWith("/__auth/")) return Auth(ctx, root, path.Substring("/__auth/".Length));

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

        // -------------------------------------------------------------- auth/
        //
        // Espelho de `tools/serve.mjs`: mesmo algoritmo (PBKDF2-HMAC-SHA256,
        // 210 mil iterações — nativo do .NET via Rfc2898DeriveBytes, zero
        // dependência nova) e mesmo formato de hash/sessão, pra uma conta
        // criada aqui funcionar idêntica no `npm run dev` e vice-versa.

        const int Pbkdf2Iterations = 210_000;
        const int SessionMaxAgeSeconds = 60 * 60 * 24 * 30; // 30 dias

        static readonly JsonSerializerOptions CamelCase =
            new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

        sealed class Account
        {
            public string Username { get; set; }
            public string PasswordHash { get; set; }
            public string CreatedAt { get; set; }
        }

        sealed class SessionInfo
        {
            public string Username { get; set; }
            public string CreatedAt { get; set; }
        }

        // token -> sessão. Concurrent porque o HttpListener pode atender mais
        // de uma requisição ao mesmo tempo (Node é single-threaded, então
        // serve.mjs usa um Map comum; aqui não dá pra assumir o mesmo).
        static readonly ConcurrentDictionary<string, SessionInfo> Sessions = new();
        static volatile bool _sessionsLoaded;
        static readonly object SessionsLoadLock = new();

        static string AccountsDir(string root) => Path.Combine(root, "store", "accounts");
        static string UsersStoreDir(string root) => Path.Combine(root, "store", "users");
        static string UsersDecksDir(string root) => Path.Combine(root, "decks", "users");
        static string SessionsFile(string root) => Path.Combine(root, "store", "sessions.json");
        static string AccountPath(string root, string username) => Path.Combine(AccountsDir(root), $"{username}.json");

        /// <summary>Só letras/números/_, 3-20 caracteres — rejeita fora disso
        /// em vez de sanitizar (mesmo espírito de `CaminhoDeck`/`CaminhoBoard`).</summary>
        static bool SafeUsername(string s) => !string.IsNullOrEmpty(s) && Regex.IsMatch(s, @"^[a-zA-Z0-9_]{3,20}$");

        /// <summary>`pbkdf2$&lt;iter&gt;$&lt;saltBase64&gt;$&lt;hashBase64&gt;` —
        /// mesmo formato autodescritivo do lado Node.</summary>
        static string HashPassword(string password)
        {
            byte[] salt = RandomNumberGenerator.GetBytes(16);
            byte[] hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Pbkdf2Iterations, HashAlgorithmName.SHA256, 32);
            return $"pbkdf2${Pbkdf2Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
        }

        /// <summary>Comparação em tempo constante — igual ao `timingSafeEqual`
        /// do lado Node, pelo mesmo motivo (não vazar por timing).</summary>
        static bool VerifyPassword(string password, string stored)
        {
            if (string.IsNullOrEmpty(stored)) return false;
            var partes = stored.Split('$');
            if (partes.Length != 4 || partes[0] != "pbkdf2") return false;
            if (!int.TryParse(partes[1], out int iter) || iter <= 0) return false;
            byte[] salt, esperado;
            try { salt = Convert.FromBase64String(partes[2]); esperado = Convert.FromBase64String(partes[3]); }
            catch { return false; }
            byte[] atual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iter, HashAlgorithmName.SHA256, esperado.Length);
            return CryptographicOperations.FixedTimeEquals(atual, esperado);
        }

        /// <summary>Parseia o cookie à mão em vez de usar `req.Cookies` — mesmo
        /// formato exato do parser manual do Node, sem depender de nenhuma
        /// particularidade de como o `HttpListener` interpreta `Set-Cookie`.</summary>
        static string ParseSessionCookie(HttpListenerRequest req)
        {
            string header = req.Headers["Cookie"];
            if (string.IsNullOrEmpty(header)) return null;
            foreach (var parte in header.Split(';'))
            {
                int i = parte.IndexOf('=');
                if (i < 0) continue;
                if (parte.Substring(0, i).Trim() != "session") continue;
                try { return Uri.UnescapeDataString(parte.Substring(i + 1).Trim()); }
                catch { return parte.Substring(i + 1).Trim(); }
            }
            return null;
        }

        static void SetSessionCookie(HttpListenerResponse res, string token) =>
            res.Headers.Add("Set-Cookie",
                $"session={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age={SessionMaxAgeSeconds}");

        static void ClearSessionCookie(HttpListenerResponse res) =>
            res.Headers.Add("Set-Cookie", "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");

        static void EnsureSessionsLoaded(string root)
        {
            if (_sessionsLoaded) return;
            lock (SessionsLoadLock)
            {
                if (_sessionsLoaded) return;
                try
                {
                    string full = SessionsFile(root);
                    if (File.Exists(full))
                    {
                        var raw = JsonSerializer.Deserialize<Dictionary<string, SessionInfo>>(
                            File.ReadAllText(full), CamelCase);
                        if (raw != null) foreach (var kv in raw) Sessions[kv.Key] = kv.Value;
                        Log.Info($"{Sessions.Count} sessao(oes) restaurada(s) de sessions.json");
                    }
                }
                catch { /* primeira vez, ou arquivo corrompido — comeca vazio */ }
                _sessionsLoaded = true;
            }
        }

        static void PersistSessions(string root)
        {
            try
            {
                string full = SessionsFile(root);
                Directory.CreateDirectory(Path.GetDirectoryName(full));
                File.WriteAllText(full, JsonSerializer.Serialize(Sessions, CamelCase), new UTF8Encoding(false));
            }
            catch (Exception e) { Log.Warn($"nao consegui gravar sessions.json: {e.Message}"); }
        }

        /// <summary>`(true, username)` de quem está logado nesta requisição.</summary>
        static (bool ok, string username) SessionFor(HttpListenerContext ctx, string root)
        {
            EnsureSessionsLoaded(root);
            string token = ParseSessionCookie(ctx.Request);
            if (token != null && Sessions.TryGetValue(token, out var s)) return (true, s.Username);
            return (false, null);
        }

        static bool Auth(HttpListenerContext ctx, string root, string acao)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            EnsureSessionsLoaded(root);

            if (acao == "register" && req.HttpMethod == "POST")
            {
                var body = Body(req);
                string username = Str(body, "username");
                string password = Str(body, "password");
                if (!SafeUsername(username))
                { Json(res, new { ok = false, error = "usuário inválido (3-20 letras/números/_)" }, 400); return true; }
                if (string.IsNullOrEmpty(password) || password.Length < 8)
                { Json(res, new { ok = false, error = "senha precisa de pelo menos 8 caracteres" }, 400); return true; }

                string accFull = AccountPath(root, username);
                if (File.Exists(accFull))
                { Json(res, new { ok = false, error = "esse usuário já existe" }, 409); return true; }

                Directory.CreateDirectory(AccountsDir(root));
                var account = new Account
                {
                    Username = username,
                    PasswordHash = HashPassword(password),
                    CreatedAt = DateTime.UtcNow.ToString("o"),
                };
                File.WriteAllText(accFull, JsonSerializer.Serialize(account, CamelCase), new UTF8Encoding(false));
                Log.Info($"conta criada: {username}");

                string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                Sessions[token] = new SessionInfo { Username = username, CreatedAt = DateTime.UtcNow.ToString("o") };
                PersistSessions(root);
                SetSessionCookie(res, token);
                Json(res, new { ok = true, username });
                return true;
            }

            if (acao == "login" && req.HttpMethod == "POST")
            {
                var body = Body(req);
                string username = Str(body, "username");
                string password = Str(body, "password");
                // Mensagem genérica nos dois casos — dizer "usuário não existe"
                // deixaria alguém varrer nomes válidos.
                bool Falha() { Json(res, new { ok = false, error = "usuário ou senha incorretos" }, 401); return true; }
                if (!SafeUsername(username)) return Falha();

                string accFull = AccountPath(root, username);
                if (!File.Exists(accFull)) return Falha();
                Account account;
                try { account = JsonSerializer.Deserialize<Account>(File.ReadAllText(accFull), CamelCase); }
                catch { return Falha(); }
                if (account == null || string.IsNullOrEmpty(password) || !VerifyPassword(password, account.PasswordHash))
                    return Falha();

                string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                Sessions[token] = new SessionInfo { Username = username, CreatedAt = DateTime.UtcNow.ToString("o") };
                PersistSessions(root);
                SetSessionCookie(res, token);
                Json(res, new { ok = true, username });
                return true;
            }

            if (acao == "logout" && req.HttpMethod == "POST")
            {
                string token = ParseSessionCookie(req);
                if (token != null) { Sessions.TryRemove(token, out _); PersistSessions(root); }
                ClearSessionCookie(res);
                Json(res, new { ok = true });
                return true;
            }

            if (acao == "me")
            {
                var (ok, username) = SessionFor(ctx, root);
                if (!ok) { Json(res, new { ok = false, error = "não logado" }, 401); return true; }
                Json(res, new { ok = true, username });
                return true;
            }

            Json(res, new { ok = false, error = "ação desconhecida" }, 404);
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
            if (rel != null && (rel == "player" || rel.StartsWith("player/") || rel.StartsWith("player\\")))
            {
                var (ok, username) = SessionFor(ctx, root);
                if (!ok) return (null, "não logado", 401);
                string full = CaminhoDeckEm(Path.Combine(UsersDecksDir(root), username), rel);
                if (full == null) return (null, "caminho invalido (precisa ser .ydk dentro de decks/)", 400);
                return (full, null, 0);
            }
            string full2 = CaminhoDeckEm(Path.Combine(root, "decks"), rel);
            if (full2 == null) return (null, "caminho invalido (precisa ser .ydk dentro de decks/)", 400);
            return (full2, null, 0);
        }

        static bool Decks(HttpListenerContext ctx, string root, string acao)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            string decks = Path.Combine(root, "decks");
            string usersDecks = UsersDecksDir(root);
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
                        if (f.StartsWith(usersDecks + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
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
                var (logado, username) = SessionFor(ctx, root);
                if (logado)
                {
                    string meuDir = Path.Combine(usersDecks, username);
                    if (Directory.Exists(meuDir))
                    {
                        foreach (var f in Directory.EnumerateFiles(meuDir, "*.ydk", SearchOption.AllDirectories))
                        {
                            try
                            {
                                string texto = File.ReadAllText(f);
                                itens.Add(new
                                {
                                    path = Path.GetRelativePath(meuDir, f).Replace('\\', '/'),
                                    meta = LerMeta(texto),
                                    content = texto,
                                });
                            }
                            catch { /* idem */ }
                        }
                    }
                }
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

            // wallet.json e' dado de CONTA (DP/colecao/pity), nao config do
            // jogo — pertence a quem esta logado. Todo outro nome
            // (banlist/boosters/npcs) continua exatamente como sempre foi.
            string full;
            if (nome == "wallet.json")
            {
                var (logado, username) = SessionFor(ctx, root);
                if (!logado) { Json(res, new { ok = false, error = "não logado" }, 401); return true; }
                full = Path.Combine(UsersStoreDir(root), username, "wallet.json");
            }
            else
            {
                full = CaminhoStore(root, nome);
                if (full == null) { Json(res, new { ok = false, error = "nome invalido (use <nome>.json)" }, 400); return true; }
            }

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
