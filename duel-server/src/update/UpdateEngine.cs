using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using YGO;

namespace DuelServer.Update
{
    /// <summary>Etapa + detalhe + fração (0..1). Desacopla o núcleo de QUEM mostra
    /// o progresso: o SSE de `/__update/`, o console do boot ou o self-test.</summary>
    public readonly struct Progresso
    {
        public readonly string Etapa, Detalhe;
        public readonly double Fracao;
        public Progresso(string etapa, string detalhe, double fracao)
        { Etapa = etapa; Detalhe = detalhe; Fracao = fracao; }
        public override string ToString() => $"[{Fracao,6:P0}] {Etapa}: {Detalhe}";
    }

    public enum Acao { EmDia, Baixar, Orfao }

    public sealed class ItemPlano
    {
        public string Path;          // relativo à raiz
        public Acao Acao;
        public string Motivo;        // "faltando", "tamanho difere", "sha256 difere"
        public long Bytes;
        public ArquivoManifesto Fonte;
    }

    public sealed class PayloadPlano
    {
        public PayloadManifesto Fonte;
        public string VersaoLocal;   // null quando nunca foi instalado
        public bool Precisa;
    }

    public sealed class Plano
    {
        public Manifest Manifesto;
        public List<ItemPlano> Arquivos = new();
        public List<ItemPlano> Orfaos = new();
        public List<PayloadPlano> Payloads = new();
        public bool InstaladorDesatualizado;

        public IEnumerable<ItemPlano> ABaixar => Arquivos.Where(a => a.Acao == Acao.Baixar);
        public IEnumerable<PayloadPlano> PayloadsPendentes => Payloads.Where(p => p.Precisa);

        /// <summary>
        /// Só o CONTEÚDO: arquivos avulsos e pacotes. É o denominador do
        /// progresso do <c>AplicarAsync</c>, que baixa só isto — o executável tem
        /// etapa própria depois, com barra própria.
        /// </summary>
        public long BytesConteudo =>
            ABaixar.Sum(a => a.Bytes) + PayloadsPendentes.Sum(p => p.Fonte.Size);

        /// <summary>
        /// Tudo o que vai descer pela rede, o executável INCLUSO — é o número que
        /// a tela mostra ao jogador. Omitir os ~67 MB do exe faria a tela
        /// prometer "0,8 MB" e baixar setenta.
        /// </summary>
        public long BytesTotais =>
            BytesConteudo + (InstaladorDesatualizado ? (Manifesto?.Installer?.Size ?? 0) : 0);

        /// <summary>
        /// Algum pacote pendente e' de motor (cai em `.staged/`)? Quem pergunta e'
        /// o <see cref="UpdateService"/>: depois de instalar, o jogo tem de
        /// REABRIR para a casca aplicar a troca — senao o jogador continuaria
        /// jogando o motor velho achando que atualizou.
        /// </summary>
        public bool TrocaMotor => PayloadsPendentes.Any(p => p.Fonte != null && p.Fonte.EmEstagio);

        /// <summary>
        /// Não há CONTEÚDO a mexer. É o que o <c>AplicarAsync</c> pergunta: com
        /// isto verdadeiro ele não tem arquivo nenhum para trocar e sai na hora,
        /// sem abrir uma pasta de backup vazia.
        /// </summary>
        public bool SemConteudo =>
            !ABaixar.Any() && !PayloadsPendentes.Any() && Orfaos.Count == 0;

        /// <summary>
        /// Nada a fazer DE VERDADE — o próprio executável incluído.
        ///
        /// O exe estava de fora, e isso congelava o jogador para sempre: assim que
        /// os arquivos e os pacotes ficavam em dia, o plano dizia "tudo em dia", o
        /// boot não abria a tela de atualização e a troca do exe — que só acontece
        /// dentro do <c>Aplicar</c> — nunca era chamada. Um exe anterior a 0.15.0
        /// não aplica o pacote `engine` (ele cai em `.staged/` e quem o aplica é a
        /// casca), então o motor ficava parado no que veio embutido no exe: front
        /// novo todo dia, motor congelado, e nenhuma tela dizendo nada.
        ///
        /// Aconteceu de verdade. O sintoma, do lado de quem joga, é "atualizei
        /// duas vezes e continuo com o cliente velho".
        /// </summary>
        public bool NadaAFazer => SemConteudo && !InstaladorDesatualizado;

        public string Resumo()
        {
            if (NadaAFazer) return "tudo em dia";
            var partes = new List<string>();
            int n = ABaixar.Count();
            if (n > 0) partes.Add($"{n} arquivo(s)");
            foreach (var p in PayloadsPendentes) partes.Add($"pacote '{p.Fonte.Id}'");
            if (Orfaos.Count > 0) partes.Add($"{Orfaos.Count} orfao(s)");
            if (InstaladorDesatualizado)
                partes.Add($"o proprio Classic Duels ({Manifesto?.Installer?.Version})");
            return string.Join(" + ", partes) + $" — {BytesTotais / 1048576.0:0.#} MB";
        }
    }

    /// <summary>
    /// O núcleo: carrega o manifesto, calcula o diff entre disco e manifesto e
    /// aplica só a diferença.
    ///
    /// Três regras que valem a pena não esquecer (todas custaram caro no molde
    /// original, MECANISMO-INSTALADOR.md §2 e §7):
    ///
    /// 1. O diff é por CONTEÚDO (size + sha256), nunca por data de modificação —
    ///    datas mentem (cópia, backup, fuso, restauração de backup).
    /// 2. O sha256 do que foi baixado é conferido DEPOIS do download e ANTES de
    ///    instalar. Download cortado é comum; se o hash não bate, o `.part` morre
    ///    e o arquivo bom antigo continua intacto.
    /// 3. Nada é apagado sem backup. Toda substituição é reversível.
    /// </summary>
    public sealed class UpdateEngine
    {
        public const string PastaMarcadores = ".duelacademy";

        readonly string _raiz;
        readonly FonteDeAssets _fonte;
        readonly HashCache _cache;
        readonly Action<Progresso> _onProgresso;
        readonly string _pastaBackups;
        readonly string _cacheManifesto;

        /// <summary>
        /// Pastas que são do JOGADOR e nunca podem ser tocadas — nem sobrescritas,
        /// nem varridas por órfãos, nem movidas para backup. Desde que o login
        /// existe, aqui mora conta de gente: `store/accounts/`, `store/users/`,
        /// `store/sessions.json`, `decks/users/`. Isto é uma trava do CÓDIGO, não
        /// uma configuração do manifesto: um manifesto errado publicado por engano
        /// não pode ter poder de deslogar todo mundo.
        /// </summary>
        public static readonly string[] Intocaveis = { "store", "decks" };

        public UpdateEngine(string raiz, FonteDeAssets fonte, Action<Progresso> onProgresso = null,
                            string pastaBackups = null, string arquivoCache = null,
                            string cacheManifesto = null)
        {
            _raiz = Path.GetFullPath(raiz);
            _fonte = fonte;
            _onProgresso = onProgresso ?? (p => Log.Info("  " + p));
            _pastaBackups = pastaBackups ?? Path.Combine(Path.GetDirectoryName(_raiz) ?? _raiz, "backups");
            _cacheManifesto = cacheManifesto ?? Path.Combine(_raiz, PastaMarcadores, "manifest.cache.json");
            _cache = new HashCache(arquivoCache ?? Path.Combine(_raiz, PastaMarcadores, "hashes.tsv"));
        }

        void Prog(string etapa, string detalhe, double fracao) =>
            _onProgresso(new Progresso(etapa, detalhe, fracao));

        // ------------------------------------------------------------------ carga

        /// <summary>
        /// Fallback em cadeia: remoto → cache local do último manifesto bom.
        /// Estar offline NUNCA pode travar o jogo — quem chama trata null caindo
        /// de volta no payload embutido no exe (o plano B permanente daqui, que o
        /// instalador do molde original não tinha).
        /// </summary>
        public async Task<Manifest> CarregarManifestoAsync(CancellationToken ct = default)
        {
            Prog("manifesto", _fonte.Descricao, 0);
            try
            {
                string json = await _fonte.ManifestoAsync(ct);
                var m = Manifest.Parse(json);
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_cacheManifesto));
                    await File.WriteAllTextAsync(_cacheManifesto, json, ct);
                }
                catch { /* cache é otimização, não requisito */ }
                Log.Info($"manifesto: {m.DisplayName} {m.GameVersion}");
                return m;
            }
            catch (Exception e)
            {
                Log.Warn($"nao consegui buscar o manifesto ({e.Message})");
                if (File.Exists(_cacheManifesto))
                {
                    try
                    {
                        var m = Manifest.Parse(await File.ReadAllTextAsync(_cacheManifesto, ct));
                        Log.Info($"usando o manifesto do cache ({m.GameVersion})");
                        return m;
                    }
                    catch (Exception e2) { Log.Warn($"cache do manifesto ilegivel: {e2.Message}"); }
                }
                return null;
            }
        }

        // ------------------------------------------------------------------- diff

        public Plano Montar(Manifest m, string versaoInstaladorAtual = null)
        {
            var plano = new Plano { Manifesto = m };

            // 1. arquivos avulsos: existe? tamanho bate? sha256 bate?
            int i = 0;
            foreach (var f in m.Files)
            {
                i++;
                Prog("conferindo", f.Path, m.Files.Count == 0 ? 1 : (double)i / m.Files.Count);

                if (!SafePath.TryCombine(_raiz, f.Path, out string dest))
                {
                    Log.Warn($"ignorando entrada com caminho inseguro: {f.Path}");
                    continue;
                }
                if (EhIntocavel(f.Path))
                {
                    // Conteúdo global do jogo (banlist/boosters/npcs) mora em store/,
                    // que é intocável por padrão. Só passa quem for arquivo direto —
                    // nunca nada dentro de store/users/ ou store/accounts/.
                    if (!ConteudoGlobalPermitido(f.Path))
                    {
                        Log.Warn($"manifesto tentou mexer em dado de conta, recusado: {f.Path}");
                        continue;
                    }
                }

                var item = new ItemPlano { Path = f.Path, Fonte = f, Bytes = f.Size };
                if (!File.Exists(dest)) { item.Acao = Acao.Baixar; item.Motivo = "faltando"; }
                else if (new FileInfo(dest).Length != f.Size) { item.Acao = Acao.Baixar; item.Motivo = "tamanho difere"; }
                else if (!string.Equals(_cache.Sha256(dest), f.Sha256, StringComparison.OrdinalIgnoreCase))
                { item.Acao = Acao.Baixar; item.Motivo = "sha256 difere"; }
                else { item.Acao = Acao.EmDia; item.Motivo = "em dia"; }

                plano.Arquivos.Add(item);
            }

            // 2. payloads: comparação de MARCADOR, não de conteúdo. É o que evita
            //    hashear 47 MB (ou 21 mil .lua) a cada boot para descobrir o óbvio.
            foreach (var p in m.Payloads)
            {
                string local = LerMarcador(p.Id);
                plano.Payloads.Add(new PayloadPlano
                {
                    Fonte = p,
                    VersaoLocal = local,
                    Precisa = !string.Equals(local, p.Version, StringComparison.Ordinal)
                });
            }

            // 3. órfãos: dentro das raízes gerenciadas, o que existe no disco e não
            //    é reivindicado por ninguém — nem pelos `files[]`, nem pelo
            //    INVENTÁRIO de nenhum pacote.
            //
            //    O molde original pula as pastas de payload inteiras aqui (senão os
            //    12.734 arquivos do ygo-data apareceriam todos como órfãos). Com o
            //    inventário não é preciso pular nada: sabemos exatamente quais
            //    arquivos cada pacote pôs ali, então um arquivo largado à mão dentro
            //    de `web/` é detectado, e os 12.734 legítimos não são.
            var esperados = new HashSet<string>(m.Files.Select(f => f.Path.Replace('\\', '/')),
                                                StringComparer.OrdinalIgnoreCase);
            foreach (var p in m.Payloads) esperados.UnionWith(LerInventario(p.Id));

            foreach (var raiz in m.ManagedRoots)
            {
                string modo = (raiz.RemoveMode ?? "keep").ToLowerInvariant();
                if (modo == "keep") continue;
                if (EhIntocavel(raiz.Path))
                {
                    Log.Warn($"managedRoot recusado (dado de conta): {raiz.Path}");
                    continue;
                }
                if (!SafePath.TryCombine(_raiz, raiz.Path, out string abs) || !Directory.Exists(abs)) continue;

                foreach (var arq in Directory.EnumerateFiles(abs, "*", SearchOption.AllDirectories))
                {
                    string rel = SafePath.Rel(_raiz, arq);
                    if (rel == null || esperados.Contains(rel)) continue;
                    if (rel.StartsWith(PastaMarcadores + "/", StringComparison.OrdinalIgnoreCase)) continue;

                    plano.Orfaos.Add(new ItemPlano
                    {
                        Path = rel,
                        Acao = Acao.Orfao,
                        Motivo = modo,
                        Bytes = new FileInfo(arq).Length
                    });
                }
            }

            // 4. o próprio exe
            if (m.Installer != null && !string.IsNullOrEmpty(versaoInstaladorAtual))
                plano.InstaladorDesatualizado = VersaoMaior(m.Installer.Version, versaoInstaladorAtual);

            _cache.Salvar();
            return plano;
        }

        static bool EhIntocavel(string rel) => Intocaveis.Any(t => SafePath.DentroDe(rel, t));

        /// <summary>
        /// Banlist, boosters, NPCs e as listas de cartas são CONTEÚDO do jogo
        /// (versionado de propósito), não progresso de ninguém — só estes podem
        /// ser atualizados dentro de uma pasta intocável.
        ///
        /// A lista é fechada por arquivo, e não por "qualquer .json solto em
        /// store/", justamente para um arquivo novo precisar de uma decisão:
        /// `store/wallet.json` também é um .json solto, e sobrescrevê-lo apagaria
        /// a coleção de quem joga.
        /// </summary>
        static readonly string[] GlobaisPermitidos =
        {
            "store/banlist.json", "store/boosters.json", "store/npcs.json",
            "store/npc-base-meta.json", "store/cardlists.json",
        };

        static bool ConteudoGlobalPermitido(string rel) =>
            GlobaisPermitidos.Contains((rel ?? "").Replace('\\', '/'), StringComparer.OrdinalIgnoreCase);

        static bool VersaoMaior(string a, string b)
        {
            if (Version.TryParse(a, out var va) && Version.TryParse(b, out var vb)) return va > vb;
            return !string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        }

        // ----------------------------------------------------------------- aplicar

        public async Task<bool> AplicarAsync(Plano plano, CancellationToken ct = default)
        {
            // `SemConteudo`, e nao `NadaAFazer`: o plano pode ter APENAS o exe
            // desatualizado, e ai nao ha' arquivo nenhum para trocar aqui — quem
            // troca o exe e' o `UpdateService`, depois desta chamada devolver
            // `true`. Sair por `NadaAFazer` deixaria de sair; entrar de vez
            // abriria uma pasta de backup vazia a cada boot.
            if (plano.SemConteudo) { Prog("pronto", "nada a fazer", 1); return true; }

            string backup = Path.Combine(_pastaBackups, DateTime.Now.ToString("yyyy-MM-dd-HHmmss"));
            long feitos = 0, total = Math.Max(1, plano.BytesConteudo);

            // Os marcadores/inventários de ANTES vão para o backup junto com os
            // arquivos. Sem eles, restaurar devolveria o conteúdo antigo deixando
            // os marcadores dizendo que a versão nova está instalada — o jogo
            // rodaria arquivos velhos se achando em dia, que é pior que não ter
            // como voltar. Ver <see cref="Restaurar"/>.
            GuardarEstadoNoBackup(backup);

            // --- arquivos avulsos
            foreach (var item in plano.ABaixar)
            {
                ct.ThrowIfCancellationRequested();
                string dest = SafePath.Combine(_raiz, item.Path);
                string part = dest + ".part";

                long baseItem = feitos;
                Prog("baixando", item.Path, (double)feitos / total);
                try
                {
                    await BaixarAsync(item.Fonte.Asset, item.Fonte.Url, part, ct,
                        lidos => Prog("baixando", item.Path, (double)(baseItem + lidos) / total));
                    string sha = HashCache.Computar(part);
                    if (!string.Equals(sha, item.Fonte.Sha256, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException(
                            $"sha256 nao confere (esperado {item.Fonte.Sha256}, veio {sha})");

                    if (File.Exists(dest)) MoverParaBackup(dest, backup);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    File.Move(part, dest, overwrite: true);
                }
                catch (Exception e)
                {
                    try { if (File.Exists(part)) File.Delete(part); } catch { }
                    Log.Err($"falhou ao instalar {item.Path}: {e.Message}");
                    if ((item.Fonte.Policy ?? "required").Equals("required", StringComparison.OrdinalIgnoreCase))
                        return false;   // aborta sem ter estragado nada
                }
                feitos += item.Bytes;
            }

            // --- payloads
            foreach (var p in plano.PayloadsPendentes)
            {
                ct.ThrowIfCancellationRequested();
                if (!await AplicarPayloadAsync(p.Fonte, backup, feitos, total, ct)) return false;
                feitos += p.Fonte.Size;
            }

            // --- órfãos
            foreach (var o in plano.Orfaos)
            {
                string abs = SafePath.Combine(_raiz, o.Path);
                if (!File.Exists(abs)) continue;
                try
                {
                    if (o.Motivo == "delete") { File.Delete(abs); Log.Info($"orfao apagado: {o.Path}"); }
                    else { MoverParaBackup(abs, backup); Log.Info($"orfao para backup: {o.Path}"); }
                }
                catch (Exception e) { Log.Warn($"nao consegui tratar o orfao {o.Path}: {e.Message}"); }
            }

            _cache.Salvar();
            PodarBackups();
            Prog("pronto", plano.Manifesto.GameVersion, 1);
            return true;
        }

        // ---------------------------------------------------------------- backups

        /// <summary>Quantas pastas de backup ficam no disco. Ver <see cref="PodarBackups"/>.</summary>
        public const int BackupsMantidos = 3;

        /// <summary>
        /// Nomes das pastas de backup, da mais nova para a mais velha.
        ///
        /// O nome é `AAAA-MM-DD-HHmmss`, então ordenar por TEXTO já é ordenar por
        /// tempo — e não depende da data de modificação, que mente depois de uma
        /// cópia, um zip ou uma restauração.
        /// </summary>
        public List<string> ListarBackups()
        {
            try
            {
                if (!Directory.Exists(_pastaBackups)) return new List<string>();
                return Directory.GetDirectories(_pastaBackups)
                    .Select(Path.GetFileName)
                    .OrderByDescending(n => n, StringComparer.Ordinal)
                    .ToList();
            }
            catch (Exception e) { Log.Warn($"nao consegui listar os backups: {e.Message}"); return new List<string>(); }
        }

        public string BackupMaisRecente() => ListarBackups().FirstOrDefault();

        /// <summary>
        /// Mantém as <see cref="BackupsMantidos"/> pastas mais recentes e remove as
        /// demais.
        ///
        /// "Nunca apaga sem backup" continua valendo — o que faltava era a poda.
        /// Cada atualização que substitui arquivos cria uma pasta nova, e nada
        /// nunca as apagava: depois de algumas dezenas de atualizações são vários
        /// GB que ninguém vai abrir. Rodar isto DEPOIS do apply bem-sucedido é de
        /// propósito: enquanto a instalação nova não terminou, todo backup ainda
        /// pode ser o caminho de volta.
        /// </summary>
        void PodarBackups()
        {
            foreach (var nome in ListarBackups().Skip(BackupsMantidos))
            {
                try
                {
                    Directory.Delete(Path.Combine(_pastaBackups, nome), true);
                    Log.Info($"backup antigo removido: {nome}");
                }
                catch (Exception e) { Log.Warn($"nao consegui remover o backup {nome}: {e.Message}"); }
            }
        }

        /// <summary>Copia os marcadores/inventários atuais para dentro da pasta de backup.</summary>
        void GuardarEstadoNoBackup(string backup)
        {
            try
            {
                string de = Path.Combine(_raiz, PastaMarcadores);
                if (!Directory.Exists(de)) return;
                string para = Path.Combine(backup, PastaMarcadores);
                Directory.CreateDirectory(para);
                foreach (var arq in Directory.EnumerateFiles(de))
                    File.Copy(arq, Path.Combine(para, Path.GetFileName(arq)), overwrite: true);
            }
            catch (Exception e) { Log.Warn($"nao consegui guardar o estado no backup: {e.Message}"); }
        }

        /// <summary>
        /// O caminho de volta: devolve à instalação tudo o que uma atualização
        /// substituiu.
        ///
        /// Se um Release ruim sair, a diferença entre "abre a tela de atualização e
        /// clica em voltar" e "explica por telefone onde fica o `%LOCALAPPDATA%`" é
        /// grande. O material sempre esteve lá — o backup preserva o caminho
        /// relativo de cada arquivo —, faltava o caminho inverso do
        /// <see cref="MoverParaBackup"/>.
        ///
        /// Os marcadores voltam junto (foram guardados por
        /// <see cref="GuardarEstadoNoBackup"/>), então o estado fica COERENTE: a
        /// instalação volta a ser a de antes, e a próxima checagem volta a oferecer
        /// a atualização — corretamente, porque o jogador está mesmo na versão
        /// velha. Ele decide de novo, com o botão "jogar sem atualizar".
        ///
        /// `store/` e `decks/` são pulados como em todo o resto: um backup nunca
        /// pode ter poder de reverter a carteira ou o deck de ninguém.
        /// </summary>
        public int Restaurar(string nomeBackup = null)
        {
            string nome = nomeBackup ?? BackupMaisRecente();
            if (nome == null) { Log.Warn("nao ha' backup para restaurar"); return 0; }

            string pasta = Path.Combine(_pastaBackups, nome);
            if (!Directory.Exists(pasta)) { Log.Warn($"backup inexistente: {nome}"); return 0; }

            int voltaram = 0;
            var arquivos = Directory.EnumerateFiles(pasta, "*", SearchOption.AllDirectories).ToList();
            int i = 0;
            foreach (var arq in arquivos)
            {
                i++;
                string rel = SafePath.Rel(pasta, arq);
                if (rel == null) continue;
                Prog("restaurando", rel, (double)i / Math.Max(1, arquivos.Count));

                if (EhIntocavel(rel) && !ConteudoGlobalPermitido(rel))
                {
                    Log.Warn($"backup tentou reverter dado de conta, recusado: {rel}");
                    continue;
                }
                if (!SafePath.TryCombine(_raiz, rel, out string destino)) continue;

                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(destino));
                    File.Copy(arq, destino, overwrite: true);
                    voltaram++;
                }
                catch (Exception e) { Log.Warn($"nao consegui restaurar {rel}: {e.Message}"); }
            }

            Log.Info($"backup '{nome}' restaurado: {voltaram} arquivo(s)");
            Prog("pronto", $"voltou para o backup de {nome}", 1);
            return voltaram;
        }

        async Task<bool> AplicarPayloadAsync(PayloadManifesto p, string backup, long feitos, long total,
                                             CancellationToken ct)
        {
            string tmp = Path.Combine(Path.GetTempPath(), $"duelacademy-{p.Id}-{Guid.NewGuid():N}.zip");

            // O peso do pacote é dividido entre baixar e instalar. Sem isso a barra
            // fica parada durante toda a extração — que para o `cards.zip` são ~15
            // segundos e 20.951 arquivos, tempo mais que suficiente para o jogador
            // achar que travou.
            const double FatiaDownload = 0.7;
            double Frac(double parcial) => (feitos + p.Size * parcial) / total;

            try
            {
                Prog("baixando", $"pacote '{p.Id}' ({p.Size / 1048576.0:0.#} MB)", Frac(0));
                await BaixarAsync(p.Asset, p.Url, tmp, ct,
                    lidos => Prog("baixando",
                                  $"pacote '{p.Id}' — {lidos / 1048576.0:0.#} de {p.Size / 1048576.0:0.#} MB",
                                  Frac(FatiaDownload * Math.Min(1.0, (double)lidos / Math.Max(1, p.Size)))));

                string sha = HashCache.Computar(tmp);
                if (!string.Equals(sha, p.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    Log.Err($"pacote '{p.Id}': sha256 nao confere — nada foi instalado");
                    return false;
                }

                // O marcador cai ANTES de mexer nos arquivos: se a extração morrer
                // no meio (falta de espaço, queda de energia), a próxima execução
                // refaz tudo em vez de rodar com meia atualização instalada.
                ApagarMarcador(p.Id);

                Prog("instalando", $"pacote '{p.Id}'", Frac(FatiaDownload));
                var extraidos = ExtrairComSeguranca(tmp, p, (feito, quantos) =>
                    Prog("instalando", $"pacote '{p.Id}' — {feito:N0} de {quantos:N0} arquivos",
                         Frac(FatiaDownload + (1 - FatiaDownload) * feito / Math.Max(1, quantos))));
                LimparRestos(p, extraidos, backup);

                GravarInventario(p.Id, extraidos);
                GravarMarcador(p.Id, p.Version);
                Log.Info($"pacote '{p.Id}' instalado ({extraidos.Count} arquivos) — {p.Version}");
                return true;
            }
            catch (Exception e)
            {
                Log.Err($"pacote '{p.Id}' falhou: {e.Message}");
                return false;
            }
            finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
        }

        /// <summary>
        /// Extrai POR CIMA da árvore existente, e só depois remove o que sobrou.
        ///
        /// Diferença proposital em relação ao molde original, que move as `roots`
        /// inteiras para backup ANTES de extrair: aquilo abre uma janela em que o
        /// jogo está instalado pela metade — e com o `cards.zip` (47 MB, ~21 mil
        /// arquivos) essa janela dura segundos. Aqui a árvore nunca fica vazia, e
        /// a limpeza é precisa porque a lista do que DEVIA existir é a lista de
        /// entradas do próprio zip.
        /// </summary>
        HashSet<string> ExtrairComSeguranca(string zipPath, PayloadManifesto p,
                                            Action<int, int> onProgresso = null)
        {
            var escritos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using var zip = ZipFile.OpenRead(zipPath);

            int quantos = zip.Entries.Count, feito = 0, ultimoAviso = 0;
            foreach (var entry in zip.Entries)
            {
                feito++;
                // Um evento a cada 250 arquivos: o front pergunta a cada 500 ms, e
                // avisar 20.951 vezes só gastaria CPU para ninguém ver.
                if (onProgresso != null && feito - ultimoAviso >= 250)
                { ultimoAviso = feito; onProgresso(feito, quantos); }

                if (string.IsNullOrEmpty(entry.Name)) continue;               // diretório
                if (!SafePath.TryCombine(_raiz, entry.FullName, out string dest))
                {
                    Log.Warn($"entrada insegura ignorada no pacote '{p.Id}': {entry.FullName}");
                    continue;
                }
                string rel = SafePath.Rel(_raiz, dest);
                if (rel != null && EhIntocavel(rel) && !ConteudoGlobalPermitido(rel))
                {
                    // Um zip publicado por engano com store/users/ dentro não pode
                    // ter o poder de sobrescrever a carteira de ninguém.
                    Log.Warn($"pacote '{p.Id}' trazia dado de conta, ignorado: {rel}");
                    continue;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                entry.ExtractToFile(dest, overwrite: true);
                if (rel != null) escritos.Add(rel);
            }
            return escritos;
        }

        /// <summary>
        /// O que a versão ANTERIOR deste pacote instalou e a nova não traz mais.
        ///
        /// Aqui não se varre `roots`, e o motivo custou um teste vermelho: o
        /// `game.zip` e o `cards.zip` compartilham a pasta `ygo-data/data` (os 5
        /// índices pequenos são voláteis, o `cards.json` de 14 MB é estável). Varrer
        /// a raiz fazia o segundo pacote apagar em silêncio o que o primeiro tinha
        /// acabado de instalar — e o jogo abria sem `cards.index.json`.
        ///
        /// Com inventário, cada pacote governa exatamente os arquivos que ELE pôs
        /// no disco. Raízes podem se sobrepor à vontade.
        /// </summary>
        void LimparRestos(PayloadManifesto p, HashSet<string> escritos, string backup)
        {
            foreach (var rel in LerInventario(p.Id))
            {
                if (escritos.Contains(rel)) continue;
                if (EhIntocavel(rel)) continue;
                if (!SafePath.TryCombine(_raiz, rel, out string abs) || !File.Exists(abs)) continue;
                try { MoverParaBackup(abs, backup); Log.Info($"  removido (nao existe mais): {rel}"); }
                catch (Exception e) { Log.Warn($"nao consegui arquivar {rel}: {e.Message}"); }
            }
        }

        // ---------------------------------------------------------------- utilidades

        /// <summary>
        /// Copia em blocos em vez de um `CopyToAsync` seco, só para poder avisar o
        /// progresso: uma barra que fica parada 15 segundos e pula para 100% é pior
        /// que barra nenhuma — o jogador conclui que travou e mata o processo no
        /// meio da instalação.
        /// </summary>
        async Task BaixarAsync(string asset, string url, string destino, CancellationToken ct,
                               Action<long> onBytes = null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(destino));
            using var origem = await _fonte.AbrirAsync(asset, url, ct);
            using var saida = File.Create(destino);

            var buffer = new byte[81920];
            long lidos = 0, ultimoAviso = 0;
            int n;
            while ((n = await origem.ReadAsync(buffer, ct)) > 0)
            {
                await saida.WriteAsync(buffer.AsMemory(0, n), ct);
                lidos += n;
                if (onBytes != null && lidos - ultimoAviso >= 262144) { ultimoAviso = lidos; onBytes(lidos); }
            }
            onBytes?.Invoke(lidos);
        }

        /// <summary>Move preservando o caminho relativo, para o backup ser restaurável a mão.</summary>
        void MoverParaBackup(string absoluto, string pastaBackup)
        {
            string rel = SafePath.Rel(_raiz, absoluto) ?? Path.GetFileName(absoluto);
            string dest = Path.Combine(pastaBackup, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(absoluto, dest);
        }

        string CaminhoMarcador(string id) =>
            Path.Combine(_raiz, PastaMarcadores, $"{id}.version");

        public string LerMarcador(string id)
        {
            try
            {
                string f = CaminhoMarcador(id);
                return File.Exists(f) ? File.ReadAllText(f).Trim() : null;
            }
            catch { return null; }
        }

        void GravarMarcador(string id, string versao)
        {
            string f = CaminhoMarcador(id);
            Directory.CreateDirectory(Path.GetDirectoryName(f));
            File.WriteAllText(f, versao);
        }

        void ApagarMarcador(string id)
        {
            try { string f = CaminhoMarcador(id); if (File.Exists(f)) File.Delete(f); } catch { }
        }

        string CaminhoInventario(string id) =>
            Path.Combine(_raiz, PastaMarcadores, $"{id}.files");

        /// <summary>Lista de caminhos relativos que a versão instalada deste pacote escreveu.</summary>
        HashSet<string> LerInventario(string id)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                string f = CaminhoInventario(id);
                if (File.Exists(f))
                    foreach (var l in File.ReadLines(f))
                        if (l.Length > 0) set.Add(l.Trim());
            }
            catch (Exception e) { Log.Warn($"inventario do pacote '{id}' ilegivel: {e.Message}"); }
            return set;
        }

        void GravarInventario(string id, IEnumerable<string> caminhos)
        {
            string f = CaminhoInventario(id);
            Directory.CreateDirectory(Path.GetDirectoryName(f));
            File.WriteAllLines(f, caminhos.OrderBy(x => x, StringComparer.Ordinal));
        }

        /// <summary>
        /// Registra um pacote que foi instalado por FORA daqui — hoje só o
        /// `payload.zip` embutido no executável (<see cref="DuelServer.Payload"/>),
        /// que traz os MESMOS `game.zip`/`cards.zip` do Release.
        ///
        /// Sem isto, quem baixa o exe pela primeira vez recebe no primeiro boot uma
        /// oferta de atualização de ~26 MB do conteúdo que o próprio exe acabou de
        /// instalar: o diff dos pacotes é por marcador, e quem grava marcador é o
        /// engine. Não dá para calcular o marcador por fora — dois
        /// `CreateFromDirectory` sobre o mesmo conteúdo não produzem bytes iguais
        /// (o zip guarda o timestamp de cada entrada) —, então o `pack.ps1` embute
        /// os zips PUBLICADOS e as versões deles vêm junto, prontas.
        /// </summary>
        public static void RegistrarPacoteInstalado(string raiz, string id, string versao,
                                                    IEnumerable<string> arquivos)
        {
            string pasta = Path.Combine(Path.GetFullPath(raiz), PastaMarcadores);
            Directory.CreateDirectory(pasta);
            File.WriteAllLines(Path.Combine(pasta, $"{id}.files"),
                               arquivos.OrderBy(x => x, StringComparer.Ordinal));
            // O marcador por ÚLTIMO: se o inventário falhar no meio, a ausência do
            // marcador faz a próxima checagem re-baixar o pacote — que é chato, mas
            // correto. O contrário deixaria o jogo achando que está em dia.
            File.WriteAllText(Path.Combine(pasta, $"{id}.version"), versao);
        }
    }
}
