using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
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
        static InteractiveDuel _duel;
        static string _sa;
        static volatile bool _shutdown;

        public static void Run(string streamingAssets, string url = "http://localhost:8770/")
        {
            _sa = streamingAssets;
            var listener = new HttpListener();
            listener.Prefixes.Add(url);
            try { listener.Start(); }
            catch (HttpListenerException e)
            {
                Log.Err($"Não consegui abrir {url}: {e.Message}");
                Log.Err($"Se for acesso negado: netsh http add urlacl url={url} user=%USERNAME%");
                return;
            }

            Log.Info($"Servidor de duelo (treino W2) em {url}");
            Log.Info("  POST /start · POST /respond · GET /health · POST /shutdown · Ctrl+C para sair");

            while (!_shutdown)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); } catch { break; }
                try { Handle(ctx); }
                catch (Exception e) { Log.Err($"[web] {e.Message}"); try { ctx.Response.Abort(); } catch { } }
            }

            // Encerramento limpo: libera a memoria nativa do ocgcore antes de sair.
            // Um kill do processo pularia isto — funciona, mas deixa o duelo vivo
            // ate o SO recolher, e nao e' o que queremos quando da' pra pedir bonito.
            lock (_lock)
            {
                if (_duel != null) { _duel.Dispose(); _duel = null; Log.Info("duelo ativo liberado."); }
            }
            try { listener.Stop(); listener.Close(); } catch { }
            Log.Info("servidor de duelo encerrado.");
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
            if (path == "/shutdown")
            {
                WriteText(res, "bye");
                _shutdown = true;
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
            res.StatusCode = 404; WriteText(res, "not found");
        }

        static object StartDuel(JsonElement body)
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

            lock (_lock)
            {
                _duel?.Dispose();
                _duel = new InteractiveDuel(_sa, deck, seed, flags);
                return _duel.Advance();
            }
        }

        static object RespondDuel(JsonElement body)
        {
            string action = body.TryGetProperty("action", out var a) ? a.GetString() : null;
            int arg = body.TryGetProperty("arg", out var g) && g.ValueKind == JsonValueKind.Number ? g.GetInt32() : 0;
            lock (_lock)
            {
                if (_duel == null) return new { error = "nenhum duelo ativo — dê /start" };
                return _duel.Respond(action ?? "endturn", arg);
            }
        }

        static uint[] ReadDeck(JsonElement body)
        {
            if (!body.TryGetProperty("deck", out var arr) || arr.ValueKind != JsonValueKind.Array)
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
