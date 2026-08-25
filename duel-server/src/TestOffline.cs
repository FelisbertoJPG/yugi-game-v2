using System;
using System.IO;
using System.Linq;
using System.Text;
using DuelServer.Update;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do caminho OFFLINE — `--test-offline`
    /// (INSTALADOR-PENDENCIAS.md §7).
    ///
    /// `--test-remote` prova a rede funcionando. Ninguém provava o contrário: sem
    /// internet, com token inválido, ou com o GitHub devolvendo 500. E é justamente
    /// o caso que acontece com o jogador — e o tipo de coisa que quebra sem ninguém
    /// notar, porque o sintoma é o jogo funcionar normalmente até o dia em que não
    /// funciona.
    ///
    /// A regra que estes casos protegem: **toda falha de rede vira um ESTADO, nunca
    /// uma exceção** — nunca algo que suba até o boot, nunca uma instalação pela
    /// metade, nunca um jogo que não abre sem dizer por quê.
    ///
    /// Até 23/08/2026 a regra ia mais longe ("offline nunca trava o jogo": o
    /// jogador entrava com o que tinha). Isso mudou — ver o cabeçalho de
    /// `UpdateService` —, e a metade nova está aqui dentro, no
    /// `CacheSalvaOBootDepoisDaPrimeiraVez`: o cache do manifesto continua
    /// respondendo, mas agora se ANUNCIA como cache, e é essa bandeira que impede
    /// um cliente velho de concluir que está em dia sem ter conseguido perguntar.
    /// </summary>
    public static class TestOffline
    {
        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Log.Info($"  ok   {nome}"); }
        static void Falha(string nome, string porque) { _fail++; Log.Err($"  FALHA {nome}: {porque}"); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run()
        {
            Log.Info("=== teste: CAMINHO OFFLINE (a rede fora do ar nao pode travar o jogo) ===\n");

            string bancada = Path.Combine(Path.GetTempPath(),
                "duelacademy-test-offline-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                FonteInexistenteNaoLanca(Sub(bancada, "1-sem-fonte"));
                CacheSalvaOBootDepoisDaPrimeiraVez(Sub(bancada, "2-cache"));
                ManifestoCorrompidoNaoDerruba(Sub(bancada, "3-corrompido"));
                CacheIlegivelTambemNaoDerruba(Sub(bancada, "4-cache-podre"));
                AssetSumidoNoMeioNaoEstragaOQueEstaInstalado(Sub(bancada, "5-asset-sumido"));
            }
            finally
            {
                try { if (Directory.Exists(bancada)) Directory.Delete(bancada, true); } catch { }
            }

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ casos

        /// <summary>
        /// O caso literal do jogador sem internet no primeiro boot: a fonte não
        /// existe. Tem que devolver `null` — não lançar —, porque quem chama
        /// (`UpdateService.Checar`) traduz `null` em "sem conexão, jogue com o que
        /// tem" e o `Program` segue para o `WebServer.Run`.
        /// </summary>
        static void FonteInexistenteNaoLanca(string dir)
        {
            string raiz = Path.Combine(dir, "game");
            Directory.CreateDirectory(raiz);
            var eng = NovaEngine(raiz, new FonteLocal(Path.Combine(dir, "nao-existe")));

            Manifest m = null;
            try { m = eng.CarregarManifestoAsync().GetAwaiter().GetResult(); }
            catch (Exception e) { Falha("fonte inexistente nao lanca", e.GetType().Name + ": " + e.Message); return; }

            Ok("fonte inexistente nao lanca");
            Checa(m == null, "fonte inexistente devolve null (= 'nao consegui perguntar')");
            Checa(!eng.ManifestoVeioDoCache,
                  "e nao mente dizendo que veio do cache (nao havia cache nenhum)");
        }

        /// <summary>
        /// Depois de UMA checagem bem-sucedida, o manifesto fica em cache
        /// (`.duelacademy/manifest.cache.json`). A partir daí, ficar offline não é
        /// nem "sem atualização": o cliente sabe qual é a versão certa e conclui,
        /// corretamente, que está em dia — sem tocar na rede.
        /// </summary>
        static void CacheSalvaOBootDepoisDaPrimeiraVez(string dir)
        {
            var (raiz, fonte, release) = Cenario(dir);

            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            Checa(m != null, "primeira checagem, com rede: manifesto carrega");
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            Checa(File.Exists(Path.Combine(raiz, UpdateEngine.PastaMarcadores, "manifest.cache.json")),
                  "o manifesto bom ficou em cache");

            // Agora a "rede cai": a pasta do Release some.
            Directory.Delete(release, true);

            var eng2 = NovaEngine(raiz, new FonteLocal(release));
            var m2 = eng2.CarregarManifestoAsync().GetAwaiter().GetResult();
            Checa(m2 != null, "offline: o manifesto vem do cache");
            if (m2 == null) return;

            Checa(m2.GameVersion == m.GameVersion, "e' o mesmo manifesto de antes",
                  $"veio {m2.GameVersion}");

            var plano = eng2.Montar(m2);
            Checa(plano.NadaAFazer, "offline com tudo instalado: o plano nao pede nada",
                  plano.Resumo());

            // A METADE QUE MUDOU EM 23/08/2026. O cache continua existindo e
            // continua respondendo — o que mudou e' que ele se ANUNCIA como cache.
            // `UpdateService.Checar` para o jogo na tela de atualizacao quando esta
            // bandeira esta' levantada: um manifesto do cache diz o que era verdade
            // da ultima vez, e aceita-lo como resposta deixaria passar exatamente o
            // cliente velho que nao consegue perguntar se esta' velho — que e' o
            // caso que este projeto ja' pagou caro (o motor congelado de 19/08).
            Checa(eng2.ManifestoVeioDoCache,
                  "e ele se ANUNCIA como cache (o boot recusa jogar sem falar com o servidor)");
            Checa(!eng.ManifestoVeioDoCache,
                  "par CONTROLE: o da rede nao levanta a bandeira");
        }

        /// <summary>
        /// O GitHub devolvendo 500, ou um asset cortado, chegam aqui como um
        /// manifesto que não é JSON. O sintoma sem essa trava seria uma exceção de
        /// parse subindo do boot — jogo que não abre por causa de um erro do
        /// servidor DO OUTRO LADO.
        /// </summary>
        static void ManifestoCorrompidoNaoDerruba(string dir)
        {
            var (raiz, _, release) = Cenario(dir);
            File.WriteAllText(Path.Combine(release, "manifest.json"),
                              "<html><title>500 Internal Server Error</title></html>");

            var eng = NovaEngine(raiz, new FonteLocal(release));
            Manifest m = null;
            try { m = eng.CarregarManifestoAsync().GetAwaiter().GetResult(); }
            catch (Exception e) { Falha("manifesto corrompido nao lanca", e.Message); return; }

            Ok("manifesto corrompido nao lanca");
            Checa(m == null, "manifesto corrompido, sem cache: devolve null");
        }

        /// <summary>
        /// O fallback do fallback: fonte morta E cache podre (disco cheio no meio da
        /// gravação anterior, antivírus, o que for). Ainda assim: null, não exceção.
        /// </summary>
        static void CacheIlegivelTambemNaoDerruba(string dir)
        {
            string raiz = Path.Combine(dir, "game");
            Directory.CreateDirectory(Path.Combine(raiz, UpdateEngine.PastaMarcadores));
            File.WriteAllText(Path.Combine(raiz, UpdateEngine.PastaMarcadores, "manifest.cache.json"),
                              "{ isto nao e' json");

            var eng = NovaEngine(raiz, new FonteLocal(Path.Combine(dir, "nao-existe")));
            Manifest m = null;
            try { m = eng.CarregarManifestoAsync().GetAwaiter().GetResult(); }
            catch (Exception e) { Falha("cache ilegivel nao lanca", e.Message); return; }

            Ok("cache ilegivel nao lanca");
            Checa(m == null, "cache ilegivel + fonte morta: devolve null");
        }

        /// <summary>
        /// A rede cai NO MEIO do download (o caso mais desagradável: o manifesto
        /// chegou, os assets não). Nada pode ser instalado pela metade, e o que já
        /// estava no disco continua exatamente como estava.
        /// </summary>
        static void AssetSumidoNoMeioNaoEstragaOQueEstaInstalado(string dir)
        {
            var (raiz, fonte, release) = Cenario(dir);

            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();
            string indice = Path.Combine(raiz, "web", "index.html");
            string antes = File.ReadAllText(indice);

            // "Versão nova" anunciada, mas o asset não vem — é o 404/timeout no
            // meio do caminho, do ponto de vista do cliente.
            var pg = m.Payloads.First(p => p.Id == "game");
            pg.Version = "game-inventada";
            File.Delete(Path.Combine(release, "game.zip"));

            var plano = eng.Montar(m);
            Checa(plano.PayloadsPendentes.Any(), "o pacote anunciado entra no plano");

            bool ok;
            try { ok = eng.AplicarAsync(plano).GetAwaiter().GetResult(); }
            catch (Exception e) { Falha("asset sumido nao lanca", e.Message); return; }

            Ok("asset sumido nao lanca");
            Checa(!ok, "apply devolve FALHA (nao finge sucesso)");
            Checa(File.ReadAllText(indice) == antes, "o que estava instalado ficou intacto");
            Checa(eng.LerMarcador("game") != "game-inventada",
                  "e o marcador NAO foi gravado — a proxima tentativa refaz tudo");
        }

        // ------------------------------------------------------------- a bancada

        static string Sub(string bancada, string nome)
        {
            string d = Path.Combine(bancada, nome);
            Directory.CreateDirectory(d);
            return d;
        }

        static UpdateEngine NovaEngine(string raiz, FonteDeAssets fonte)
        {
            string pai = Path.GetDirectoryName(raiz);
            return new UpdateEngine(raiz, fonte,
                onProgresso: _ => { },
                pastaBackups: Path.Combine(pai, "backups"),
                arquivoCache: Path.Combine(pai, "cache", "hashes.tsv"));
        }

        /// <summary>Release falso mínimo — os dois pacotes, sem arquivo avulso.</summary>
        static (string raiz, FonteDeAssets fonte, string release) Cenario(string dir)
        {
            string raiz = Path.Combine(dir, "game");
            string release = Path.Combine(dir, "release");
            Directory.CreateDirectory(raiz);
            Directory.CreateDirectory(release);

            string zipGame = Path.Combine(release, "game.zip");
            Zip(zipGame, ("web/index.html", "<h1>Classic Duels</h1>"), ("web/js/deck.js", "// regras"));

            string zipCards = Path.Combine(release, "cards.zip");
            Zip(zipCards, ("ygo-data/data/cards.json", "[]"));

            var m = new Manifest
            {
                GameVersion = "offline-1",
                DisplayName = "Classic Duels",
                ManagedRoots = new System.Collections.Generic.List<RaizGerenciada>
                { new() { Path = "web", RemoveMode = "keep" } },
                Payloads = new System.Collections.Generic.List<PayloadManifesto>
                {
                    Pacote("game", zipGame, "web"),
                    Pacote("cards", zipCards, "ygo-data/data")
                }
            };
            File.WriteAllText(Path.Combine(release, "manifest.json"), m.ToJson(), new UTF8Encoding(false));

            return (raiz, new FonteLocal(release), release);
        }

        static PayloadManifesto Pacote(string id, string zip, params string[] roots)
        {
            string sha = HashCache.Computar(zip);
            return new PayloadManifesto
            {
                Id = id,
                Asset = Path.GetFileName(zip),
                Sha256 = sha,
                Size = new FileInfo(zip).Length,
                Version = $"{id}-{sha.Substring(0, 12)}",
                Roots = roots.ToList()
            };
        }

        static void Zip(string caminho, params (string nome, string conteudo)[] entradas)
        {
            using var fs = File.Create(caminho);
            using var zip = new System.IO.Compression.ZipArchive(
                fs, System.IO.Compression.ZipArchiveMode.Create);
            foreach (var (nome, conteudo) in entradas)
            {
                var e = zip.CreateEntry(nome, System.IO.Compression.CompressionLevel.Optimal);
                using var w = new StreamWriter(e.Open());
                w.Write(conteudo);
            }
        }
    }
}
