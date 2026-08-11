using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Text.Json;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Servidor local do "treino" (W2), modelo RPC. Zero deps, só localhost:8770.
    ///   POST /start   {deck:[ids], seed?}  -> cria o duelo e avança até sua vez
    ///   POST /respond {action, arg}        -> aplica a jogada e avança
    ///   GET  /health                       -> "ok"
    /// Cada resposta: { events:[...], question:{...}|null, ended:bool }.
    /// </summary>
    public static class WebServer
    {
        static readonly JsonSerializerOptions Json = new() { IncludeFields = true };
        static readonly object _lock = new();
        /// <summary>
        /// Quem esta' na frente DESTA maquina. Hoje e' sempre o jogador 0 — o
        /// oponente e' o NPC, que nao recebe tela. No duelo entre dois humanos e'
        /// isto que passa a variar por conexao.
        /// </summary>
        const byte HUMANO_LOCAL = 0;

        /// <summary>
        /// Um duelo vivo e o que o cerca. Cada sala tem o PRÓPRIO cadeado: dois
        /// duelos concorrentes não têm por que esperar um pelo outro, e um duelo
        /// travado não pode congelar o servidor inteiro.
        /// </summary>
        sealed class Sala
        {
            public readonly object Trava = new();
            public InteractiveDuel Duel;
            public bool Encerrado = true;
            public bool Multiplayer;
            public DateTime Ultimo = DateTime.UtcNow;
        }

        /// <summary>
        /// Salas por id. O jogo de mesa e a ponte não mandam id nenhum e caem
        /// todos em <see cref="SalaPadrao"/> — para eles nada mudou, continua
        /// um duelo por processo.
        ///
        /// O id só passa a existir na ARENA, onde um processo hospeda vários
        /// duelos ao mesmo tempo. Sem isto, dois jogadores em partidas
        /// diferentes se sobrescreveriam: o `/start` do segundo destruía o duelo
        /// do primeiro, e o `/respond` dele caía no duelo errado.
        /// </summary>
        const string SalaPadrao = "_";
        static readonly ConcurrentDictionary<string, Sala> _salas = new();

        /// <summary>Sala ociosa há mais que isto é recolhida (ver <see cref="Faxina"/>).</summary>
        static readonly TimeSpan ValidadeDaSala = TimeSpan.FromMinutes(30);

        static Sala SalaDe(JsonElement body)
        {
            string id = body.TryGetProperty("sala", out var s) && s.ValueKind == JsonValueKind.String
                ? (s.GetString() ?? SalaPadrao)
                : SalaPadrao;
            return _salas.GetOrAdd(id, _ => new Sala());
        }

        static string _sa;
        static string _webRoot;
        static volatile bool _shutdown;

        /// <summary>
        /// Sobe o servidor. `webRoot` liga o servidor de arquivos embutido (modo
        /// --app, sem Node); `extraUrl` adiciona a porta do front ao MESMO
        /// listener, para o executavel empacotado ser um processo so'.
        /// </summary>
        /// <summary>
        /// Sobe o servidor. Devolve `false` se nem chegou a escutar — quem chama
        /// precisa saber, para poder AVISAR o jogador em vez de sair calado.
        /// </summary>
        public static bool Run(string streamingAssets, string url = "http://localhost:8770/",
                               string webRoot = null, string extraUrl = null,
                               Action onReady = null)
        {
            _sa = streamingAssets;
            _webRoot = webRoot == null ? null : Path.GetFullPath(webRoot).TrimEnd(Path.DirectorySeparatorChar);
            var listener = new HttpListener();
            listener.Prefixes.Add(url);
            if (extraUrl != null) listener.Prefixes.Add(extraUrl);

            try { listener.Start(); }
            catch (HttpListenerException)
            {
                // A porta esta ocupada. Antes de desistir, tenta recuperar de um
                // ORFAO NOSSO: um duel-server que ficou vivo sem jogo aberto (o
                // usuario matou a janela, o processo sobreviveu). Ele responde
                // /__shutdown; qualquer outra coisa ignora e o erro segue.
                //
                // Isto e' a contencao que faltava: ate' agora o unico caminho era
                // o usuario descobrir sozinho que havia um processo pendurado.
                if (PedirParaSair(url) | PedirParaSair(extraUrl))
                {
                    Thread.Sleep(1200);
                    try { listener.Start(); Log.Info("porta recuperada de uma instancia antiga."); }
                    catch (HttpListenerException e2) { return NaoSubiu(url, extraUrl, e2); }
                }
                else
                {
                    try { listener.Start(); }
                    catch (HttpListenerException e3) { return NaoSubiu(url, extraUrl, e3); }
                }
            }

            // Solta o registro do http.sys e a memoria nativa em QUALQUER forma de
            // fechamento — X da janela, Ctrl+C, logoff. Sem isto, fechar no X
            // deixava a porta reservada e o proximo boot reclamava de porta
            // ocupada sem haver jogo nenhum aberto.
            ArmarFechamentoLimpo(listener);

            Log.Info($"Servidor de duelo (treino W2) em {url}");
            if (_webRoot != null) Log.Info($"Servidor do front em {extraUrl}  (raiz: {_webRoot})");
            Log.Info("  POST /start · POST /respond · GET /health · POST /shutdown · Ctrl+C para sair");
            if (Log.FilePath != null) Log.Info($"  log da sessao: {Log.FilePath}");

            try { onReady?.Invoke(); }
            catch (Exception e) { Log.Warn($"[web] onReady: {e.Message}"); }

            while (!_shutdown)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); } catch { break; }
                try { Handle(ctx); }
                catch (Exception e) { Log.Err($"[web] {e.Message}"); try { ctx.Response.Abort(); } catch { } }
            }

            // Saida pelo caminho normal (/shutdown, Ctrl+C tratado). O
            // `ArmarFechamentoLimpo` cobre os caminhos anormais — X da janela,
            // logoff — e usa a mesma trava, entao soltar duas vezes nao acontece.
            LiberarDuelos("encerrando");
            try { listener.Stop(); listener.Close(); } catch { }
            Interlocked.Exchange(ref _jaFechou, 1);
            Log.Info("servidor de duelo encerrado. portas liberadas.");
            return true;
        }

        /// <summary>
        /// Pede educadamente para quem esta na porta encerrar. `true` se algo
        /// respondeu — e' o nosso `/__shutdown`, entao era um duel-server orfao.
        ///
        /// Timeout curto de proposito: se quem atende nao for nosso, nao vale
        /// segurar o boot do jogo esperando.
        /// </summary>
        static bool PedirParaSair(string url)
        {
            if (string.IsNullOrEmpty(url)) return false;
            // "+" e' o coringa de bind do HttpListener, nao um host alcancavel.
            string alvo = url.Replace("://+:", "://localhost:");
            try
            {
                using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                var r = http.PostAsync(alvo.TrimEnd('/') + "/__shutdown", null).GetAwaiter().GetResult();
                if (!r.IsSuccessStatusCode) return false;
                Log.Info($"havia uma instancia antiga em {alvo} — pedi para ela sair.");
                return true;
            }
            catch { return false; }
        }

        static bool NaoSubiu(string url, string extraUrl, HttpListenerException e)
        {
            Log.Err($"Não consegui abrir {url}{(extraUrl != null ? " / " + extraUrl : "")}: {e.Message}");
            Log.Err("Porta ocupada? Feche outra instância (duel-academy-stop.exe) e tente de novo.");
            Log.Err("Se for acesso negado (comum com --lan): reserve a URL, como administrador.");
            Log.Err($"  PowerShell: netsh http add urlacl url={url} user=$env:USERNAME");
            Log.Err($"  cmd.exe:    netsh http add urlacl url={url} user=%USERNAME%");
            return false;
        }

        // ------------------------------------------------------ fechar limpo

        delegate bool HandlerDoConsole(uint tipo);
        static HandlerDoConsole _handler;   // referencia viva: o GC nao pode levar

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetConsoleCtrlHandler(HandlerDoConsole handler, bool add);

        static int _jaFechou;

        /// <summary>
        /// Garante que a porta e a memoria nativa sejam soltas em QUALQUER
        /// fechamento.
        ///
        /// `ProcessExit` sozinho nao basta no Windows: fechar a janela no X
        /// dispara CTRL_CLOSE_EVENT, e sem um handler o processo e' derrubado
        /// sem rodar nada. O registro no http.sys ficava para tras e o boot
        /// seguinte reclamava de porta ocupada — sem haver jogo aberto. Foi
        /// exatamente o sintoma relatado.
        /// </summary>
        static void ArmarFechamentoLimpo(HttpListener listener)
        {
            void Soltar()
            {
                // Uma vez so': ProcessExit e o handler do console podem disparar
                // os dois no mesmo fechamento.
                if (Interlocked.Exchange(ref _jaFechou, 1) != 0) return;
                _shutdown = true;
                LiberarDuelos("fechamento");
                try { listener.Stop(); listener.Close(); } catch { }
                Log.Info("portas liberadas.");
            }

            AppDomain.CurrentDomain.ProcessExit += (_, _) => Soltar();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; Soltar(); Environment.Exit(0); };

            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return;
            _handler = tipo =>
            {
                // 0 CTRL_C · 1 CTRL_BREAK · 2 CTRL_CLOSE (o X) · 5 LOGOFF · 6 SHUTDOWN
                Soltar();
                return false;   // deixa o Windows seguir com o encerramento
            };
            try { SetConsoleCtrlHandler(_handler, true); }
            catch (Exception e) { Log.Warn($"nao consegui armar o fechamento limpo: {e.Message}"); }
        }

        /// <summary>Descarta o ocgcore de todas as salas.</summary>
        static void LiberarDuelos(string porque)
        {
            foreach (var (id, s) in _salas)
                lock (s.Trava)
                {
                    if (s.Duel == null) continue;
                    s.Duel.Dispose(); s.Duel = null; s.Encerrado = true;
                    Log.Info($"duelo da sala {id} liberado ({porque}).");
                }
        }

        static void Handle(HttpListenerContext ctx)
        {
            var req = ctx.Request; var res = ctx.Response;
            res.Headers["Access-Control-Allow-Origin"] = "*";
            res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            res.Headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";

            string path = req.Url?.AbsolutePath ?? "/";
            if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); return; }
            if (path == "/health") { WriteText(res, "ok"); return; }

            // Encerramento a pedido do launcher. Responde primeiro, so' entao sai
            // do laco — assim quem pediu recebe o 200 em vez de uma conexao morta.
            // `/__shutdown` e' o nome que o serve.mjs usa: no modo --app este
            // processo faz o papel dos dois, entao responde pelos dois nomes.
            if (path == "/shutdown" || path == "/__shutdown")
            {
                WriteText(res, "bye");
                _shutdown = true;
                return;
            }

            // Sair do duelo (voltar para a home, fechar a aba). Encerra a SESSAO,
            // nao o servidor: solta o ocgcore daquela sala para a proxima partida
            // comecar limpa. Sem isto o duelo ficava vivo ate' alguem dar /start
            // de novo — e segurando o cards.cdb aberto.
            //
            // Chamado por sendBeacon no `beforeunload`, entao precisa aceitar
            // POST sem corpo e responder rapido.
            if (path == "/encerrar" && req.HttpMethod == "POST")
            {
                var body = ReadBody(req);
                var sala = SalaDe(body);
                lock (sala.Trava)
                {
                    if (sala.Duel != null)
                    {
                        sala.Duel.Dispose(); sala.Duel = null; sala.Encerrado = true;
                        Log.Info("duelo encerrado a pedido do front (saiu da tela).");
                    }
                }
                WriteJson(res, new { ok = true });
                return;
            }

            if (path == "/start" && req.HttpMethod == "POST")
            {
                var body = ReadBody(req);
                WriteJson(res, StartDuel(body));
                return;
            }
            if (path == "/respond" && req.HttpMethod == "POST")
            {
                var body = ReadBody(req);
                WriteJson(res, RespondDuel(body));
                return;
            }
            // Nao e' rota da API: no modo --app o servidor de arquivos assume.
            if (_webRoot != null && StaticServer.Handle(ctx, _webRoot)) return;

            res.StatusCode = 404; WriteText(res, "not found");
        }

        /// <summary>
        /// Só para os testes: aponta os StreamingAssets sem subir o HttpListener,
        /// para o `--test-update-duelo` exercitar o MESMO `StartDuel`/`RespondDuel`
        /// que as rotas usam (a trava do update vive nesse estado, não na rota).
        /// </summary>
        internal static void ConfigurarParaTeste(string streamingAssets) => _sa = streamingAssets;

        internal static object StartDuel(JsonElement body)
        {
            uint[] deck = ReadDeck(body);
            if (deck.Length == 0) return new { error = "deck vazio" };
            ulong seed = body.TryGetProperty("seed", out var s) && s.ValueKind == JsonValueKind.Number
                ? (ulong)s.GetInt64()
                : (ulong)Random.Shared.NextInt64();
            // Treino: NO_HAND_LIMIT (0x1000000) por padrão — sem limite de mão o motor
            // não pede descarte (o oponente desligado só acumula), e o duelo não trava.
            ulong flags = body.TryGetProperty("flags", out var f) && f.ValueKind == JsonValueKind.Number
                ? (ulong)f.GetInt64()
                : 0x1000000UL;

            // NPC ligado por padrão. `npc:false` volta ao oponente desligado
            // (auto-passa), que é o modo de treinar sozinho.
            bool npc = !body.TryGetProperty("npc", out var n) || n.ValueKind != JsonValueKind.False;

            // Deck do adversário; sem ele, usa o mesmo do jogador.
            uint[] npcDeck = ReadDeck(body, "npcDeck");
            if (npcDeck.Length == 0) npcDeck = null;

            // Extra Deck (Fusão/Sincro/Xyz/Link). Opcional: deck sem Extra manda
            // lista vazia e nada muda.
            uint[] extra = ReadDeck(body, "extra");
            if (extra.Length == 0) extra = null;
            uint[] npcExtra = ReadDeck(body, "npcExtra");
            if (npcExtra.Length == 0) npcExtra = null;

            // Bônus de Campo (editor de tabuleiro): código de UMA magia de campo
            // já ativa desde o início do duelo. Opcional — sem tabuleiro
            // customizado com isso setado, nada muda.
            uint? fieldSpell = body.TryGetProperty("fieldSpell", out var fs) && fs.ValueKind == JsonValueKind.Number
                ? (uint)fs.GetInt64()
                : (uint?)null;

            // Nível do adversário. "avancado" é o NPC que LÊ a mão e as cartas
            // baixadas do jogador; qualquer outra coisa (inclusive campo ausente,
            // que é o caso de todo NPC criado antes disto existir) é iniciante.
            // Os dois jogam pelas mesmas regras — só um deles sabe o que você tem.
            string nivel = body.TryGetProperty("npcLevel", out var nv) && nv.ValueKind == JsonValueKind.String
                ? (nv.GetString() ?? "")
                : "";
            bool leitura = nivel.Equals("avancado", StringComparison.OrdinalIgnoreCase);

            // MULTIPLAYER: os dois lados sao gente. O `npcDeck` passa a ser o deck
            // do OUTRO JOGADOR (congelado pela sala no Supabase), e nenhum NPC
            // decide nada. Sem este campo, tudo continua como sempre foi.
            bool multi = body.TryGetProperty("multiplayer", out var mp)
                         && mp.ValueKind == JsonValueKind.True;

            Log.Info($"[rpc] /start deck={deck.Length} extra={(extra?.Length ?? 0)} npc={npc} " +
                     $"npcDeck={(npcDeck?.Length ?? 0)} seed={seed} fieldSpell={(fieldSpell?.ToString() ?? "-")} " +
                     $"nivel={(leitura ? "avancado" : "iniciante")} multiplayer={multi}");
            Faxina();
            var sala = SalaDe(body);
            lock (sala.Trava)
            {
                sala.Duel?.Dispose();
                sala.Duel = new InteractiveDuel(_sa, deck, seed, flags, npc, npcDeck, extra, npcExtra, fieldSpell,
                                                npcLeitura: leitura, doisHumanos: multi);
                sala.Multiplayer = multi;
                sala.Ultimo = DateTime.UtcNow;
                var r = sala.Duel.Advance();
                sala.Encerrado = r.ended;
                return Entregar(r, sala.Multiplayer);
            }
        }

        /// <summary>
        /// Recolhe salas paradas. Cada duelo segura memória nativa do ocgcore, e
        /// um cliente que fecha a aba no meio da partida nunca avisa ninguém —
        /// sem isto, um servidor de arena vaza um duelo por desistência
        /// silenciosa até acabar a memória.
        /// </summary>
        static void Faxina()
        {
            var limite = DateTime.UtcNow - ValidadeDaSala;
            foreach (var (id, s) in _salas)
            {
                if (id == SalaPadrao || s.Ultimo > limite) continue;
                if (!_salas.TryRemove(id, out var morta)) continue;
                lock (morta.Trava)
                {
                    morta.Duel?.Dispose();
                    morta.Duel = null;
                }
                Log.Info($"sala {id} recolhida por inatividade");
            }
        }

        /// <summary>
        /// A resposta pronta para quem chamou.
        ///
        /// Contra o NPC: a visao do jogador 0, e so'. E' obrigatorio projetar — o
        /// `Result` cru guarda o codigo das cartas viradas de TODO MUNDO.
        ///
        /// No MULTIPLAYER devolve as DUAS visoes, porque quem chama e' o navegador
        /// do anfitriao, que faz dois papeis: desenha a propria tela e repassa ao
        /// convidado a visao dele. Sem as duas na mesma resposta, o anfitriao teria
        /// de perguntar de novo — e as duas respostas poderiam descrever estados
        /// diferentes do duelo.
        ///
        /// Isso significa que o navegador do anfitriao recebe a visao do convidado,
        /// e portanto a mao dele. E' a fraqueza CONHECIDA e ACEITA do modo ponte —
        /// quem hospeda roda o motor e enxerga tudo de qualquer jeito. E' por isso
        /// que a partida de ponte nao paga DP nem conta ranking (migration 0010).
        /// </summary>
        static object Entregar(InteractiveDuel.Result r, bool multiplayer) =>
            multiplayer
                ? new { multiplayer = true, visoes = new Dictionary<string, object>
                        { ["0"] = r.Para(0), ["1"] = r.Para(1) } }
                : r.Para(HUMANO_LOCAL);

        /// <summary>
        /// Ha' um duelo EM ANDAMENTO neste momento? (Um duelo que ja' acabou nao
        /// conta — o objeto continua vivo ate' o proximo /start, mas ninguem mais
        /// joga nele.)
        /// </summary>
        public static bool DueloEmAndamento
        {
            get
            {
                // QUALQUER sala conta: numa arena, atualizar por causa de uma sala
                // vazia derrubaria as outras que estao no meio de um duelo.
                foreach (var (_, s) in _salas)
                    lock (s.Trava)
                        if (s.Duel != null && !s.Encerrado) return true;
                return false;
            }
        }

        /// <summary>
        /// Libera o duelo JA' ENCERRADO, se houver — e devolve `false`, sem
        /// liberar nada, quando ha' um duelo em andamento.
        ///
        /// Quem chama e' o `/__update/aplicar`: trocar os ~21 mil `.lua` e o
        /// `cards.cdb` debaixo de um duelo vivo faz a extracao morrer pela metade
        /// (o SQLite mantem o `cards.cdb` aberto desde `DuelSession`). E como o
        /// duelo encerrado continua segurando o arquivo ate' o proximo /start,
        /// nao basta perguntar: e' preciso soltar.
        /// </summary>
        public static bool LiberarDueloEncerrado()
        {
            // Duas passadas de proposito: so' solta DEPOIS de saber que ninguem
            // esta jogando. Soltar sala a sala enquanto confere deixaria metade
            // liberada e metade nao, com o update abortando no meio.
            if (DueloEmAndamento) return false;

            foreach (var (id, s) in _salas)
                lock (s.Trava)
                {
                    if (s.Duel == null) continue;
                    s.Duel.Dispose();
                    s.Duel = null;
                    Log.Info($"duelo encerrado da sala {id} liberado (o cards.cdb foi fechado).");
                }
            return true;
        }

        internal static object RespondDuel(JsonElement body)
        {
            string action = body.TryGetProperty("action", out var a) ? a.GetString() : null;
            int arg = body.TryGetProperty("arg", out var g) && g.ValueKind == JsonValueKind.Number ? g.GetInt32() : 0;

            // "select" (tributo/alvo) manda vários índices de uma vez.
            List<int> args = null;
            if (body.TryGetProperty("args", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                args = new List<int>();
                foreach (var e in arr.EnumerateArray())
                    if (e.ValueKind == JsonValueKind.Number) args.Add(e.GetInt32());
            }

            // DE QUEM e' a jogada. So' o multiplayer manda: contra o NPC existe um
            // humano so' e a pergunta e' sempre dele. Sem isto, no multiplayer um
            // jogador responderia a pergunta do outro — a trava existe no motor
            // (`InteractiveDuel.Respond`), mas ela precisa saber quem esta' falando.
            byte? porJogador = body.TryGetProperty("jogador", out var pj)
                               && pj.ValueKind == JsonValueKind.Number
                ? (byte)pj.GetInt32()
                : (byte?)null;

            Log.Info($"[rpc] /respond {action ?? "endturn"} arg={arg}"
                     + (args != null ? $" args=[{string.Join(",", args)}]" : "")
                     + (porJogador.HasValue ? $" jogador={porJogador}" : ""));
            var sala = SalaDe(body);
            lock (sala.Trava)
            {
                if (sala.Duel == null) return new { error = "nenhum duelo ativo — dê /start" };
                sala.Ultimo = DateTime.UtcNow;
                var r = sala.Duel.Respond(action ?? "endturn", arg, args, porJogador);
                sala.Encerrado = r.ended;
                return Entregar(r, sala.Multiplayer);
            }
        }

        static uint[] ReadDeck(JsonElement body, string prop = "deck")
        {
            if (!body.TryGetProperty(prop, out var arr) || arr.ValueKind != JsonValueKind.Array)
                return Array.Empty<uint>();
            var list = new List<uint>();
            foreach (var e in arr.EnumerateArray())
                if (e.ValueKind == JsonValueKind.Number) list.Add((uint)e.GetInt64());
            return list.ToArray();
        }

        static JsonElement ReadBody(HttpListenerRequest req)
        {
            using var sr = new StreamReader(req.InputStream, req.ContentEncoding ?? Encoding.UTF8);
            string text = sr.ReadToEnd();
            if (string.IsNullOrWhiteSpace(text)) text = "{}";
            return JsonDocument.Parse(text).RootElement.Clone();
        }

        static void WriteJson(HttpListenerResponse res, object o)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o, Json));
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }

        static void WriteText(HttpListenerResponse res, string text)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            res.ContentType = "text/plain; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }
    }
}
