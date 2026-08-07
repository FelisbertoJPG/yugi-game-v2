using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using YGO;

namespace DuelServer.Update
{
    /// <summary>
    /// Resolve os assets de um Release do GitHub. Duas armadilhas de repositório
    /// PRIVADO que custaram caro no molde original (MECANISMO-INSTALADOR.md §4):
    ///
    /// 1. NÃO use `browser_download_url` (github.com/.../releases/download/...):
    ///    em repo privado ela IGNORA o token e devolve 404. O caminho certo é o
    ///    endpoint da API do asset, `/releases/assets/{id}`, com o header
    ///    `Accept: application/octet-stream` — sem esse Accept vem o JSON de
    ///    metadados em vez do binário, e o sha256 "não confere" sem explicação.
    ///
    /// 2. O HttpClient TIRA o header Authorization no redirect cross-host (da
    ///    api.github.com para o CDN). Isso é o comportamento correto e seguro —
    ///    não vaza o token para o CDN. Não force o auth no redirect.
    /// </summary>
    public sealed class FonteGitHub : FonteDeAssets
    {
        readonly string _owner, _repo, _tag;
        readonly HttpClient _http;
        Dictionary<string, AssetInfo> _assets;

        public sealed class AssetInfo
        {
            public long Id;
            public long Size;
            public string ApiUrl;
        }

        public FonteGitHub(string owner, string repo, string tag, string token, HttpClient http = null)
        {
            _owner = owner; _repo = repo; _tag = tag ?? "";
            _http = http ?? NovoHttp(token);
        }

        public override string Descricao =>
            $"github {_owner}/{_repo}@{(_tag.Length == 0 ? "latest" : _tag)}";

        public static HttpClient NovoHttp(string token)
        {
            var h = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            h.DefaultRequestHeaders.UserAgent.ParseAdd(BuildConfig.UserAgent); // o GitHub EXIGE User-Agent
            h.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            h.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            if (!string.IsNullOrEmpty(token))
                h.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            else
                Log.Warn("sem token de distribuicao — so' funciona se o repositorio for publico");
            return h;
        }

        async Task<Dictionary<string, AssetInfo>> AssetsAsync(CancellationToken ct)
        {
            if (_assets != null) return _assets;

            string url = _tag.Length == 0
                ? $"https://api.github.com/repos/{_owner}/{_repo}/releases/latest"
                : $"https://api.github.com/repos/{_owner}/{_repo}/releases/tags/{_tag}";

            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
                throw new HttpRequestException(
                    $"GET {url} devolveu {(int)resp.StatusCode} {resp.ReasonPhrase}" +
                    ((int)resp.StatusCode == 404
                        ? " (repo privado sem token, ou nenhum Release publicado ainda)"
                        : ""));

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var mapa = new Dictionary<string, AssetInfo>(StringComparer.OrdinalIgnoreCase);

            if (doc.RootElement.TryGetProperty("assets", out var arr))
            {
                foreach (var a in arr.EnumerateArray())
                {
                    string nome = a.GetProperty("name").GetString();
                    long id = a.GetProperty("id").GetInt64();
                    mapa[nome] = new AssetInfo
                    {
                        Id = id,
                        Size = a.TryGetProperty("size", out var s) ? s.GetInt64() : 0,
                        ApiUrl = $"https://api.github.com/repos/{_owner}/{_repo}/releases/assets/{id}"
                    };
                }
            }
            return _assets = mapa;
        }

        /// <summary>
        /// O GitHub RENOMEIA assets ao subir: troca espaços e caracteres especiais
        /// por ponto ("Extra Armor.jar" vira "Extra.Armor.jar"). Isso quebra o
        /// casamento manifesto→asset em silêncio. O gerador já grava o campo
        /// `asset` sanitizado, mas o resolvedor tenta os dois nomes — arrumar só
        /// uma ponta deixa manifestos antigos quebrados.
        /// </summary>
        public static string NomeSeguro(string nome) =>
            Regex.Replace(nome ?? "", "[^A-Za-z0-9._-]", ".");

        public override async Task<string> ManifestoAsync(CancellationToken ct)
        {
            using var s = await AbrirAsync("manifest.json", null, ct);
            using var r = new StreamReader(s);
            return await r.ReadToEndAsync(ct);
        }

        public override async Task<Stream> AbrirAsync(string asset, string url, CancellationToken ct)
        {
            // Uma URL direta no manifesto tem precedência e dispensa a API.
            if (!string.IsNullOrEmpty(url))
                return await _http.GetStreamAsync(url, ct);

            var mapa = await AssetsAsync(ct);
            if (!mapa.TryGetValue(asset, out var info) &&
                !mapa.TryGetValue(NomeSeguro(asset), out info))
                throw new FileNotFoundException(
                    $"asset '{asset}' nao esta no Release (tem: {string.Join(", ", mapa.Keys.Take(12))})");

            var req = new HttpRequestMessage(HttpMethod.Get, info.ApiUrl);
            // SEM este Accept vem o JSON de metadados, nao o binario.
            req.Headers.Accept.Clear();
            req.Headers.Accept.ParseAdd("application/octet-stream");

            var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            resp.EnsureSuccessStatusCode();
            return await resp.Content.ReadAsStreamAsync(ct);
        }
    }
}
