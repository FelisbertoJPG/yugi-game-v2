using System;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// A troca do MOTOR em disco: o que o auto-updater deixou preparado e a casca
    /// aplica no boot seguinte, antes de qualquer coisa ser carregada.
    ///
    /// POR QUE NAO APLICAR NA HORA. Quem baixa a atualizacao e' o proprio motor
    /// (ele e' quem tem a tela `web/atualizando.html` e as rotas `/__update/*`),
    /// e nesse instante a `ocgcore.dll` ja' esta' carregada no processo — o
    /// Windows nao deixa sobrescrever uma DLL em uso. Entao o pacote e' extraido
    /// para `.staged/` e a troca acontece AQUI, no boot seguinte, quando nada
    /// disso foi aberto ainda.
    ///
    ///   raiz/.staged/engine/...    o que o updater baixou (ainda nao aplicado)
    ///   raiz/engine/...            o motor que roda
    ///   raiz/.staged-bak/engine/   o motor anterior, para voltar atras
    ///   raiz/.engine-tentativa     "estou tentando rodar o motor do disco"
    ///
    /// A sentinela e' o que impede um motor quebrado de deixar o jogo sem abrir
    /// para sempre: ela e' apagada quando o motor roda, e sobra quando ele morre
    /// de excecao. Duas sobras seguidas e o motor vai para a quarentena.
    /// </summary>
    internal static class Estagio
    {
        public const string PASTA = ".staged";
        public const string BACKUP = ".staged-bak";
        public const string MOTOR = "engine";
        public const string DLL = "DuelServer.Engine.dll";
        const string Sentinela = ".engine-tentativa";

        /// <summary>
        /// A UNICA pasta que um pacote em estagio pode escrever. Um zip publicado
        /// por engano com `store/` ou `web/` dentro nao pode ter o poder de
        /// sobrescrever a carteira de ninguem por este caminho — o updater ja'
        /// recusa isso na extracao, e aqui recusa de novo.
        /// </summary>
        static bool Permitido(string rel)
        {
            return rel.Equals(MOTOR, StringComparison.OrdinalIgnoreCase)
                || rel.StartsWith(MOTOR + "/", StringComparison.OrdinalIgnoreCase);
        }

        public static string CaminhoDoMotor(string raiz)
        {
            return Path.Combine(raiz, MOTOR, DLL);
        }

        // ------------------------------------------------------------ aplicar

        /// <summary>
        /// Aplica o que estiver em `.staged/`, guardando o que for substituido em
        /// `.staged-bak/`. Devolve quantos arquivos foram trocados.
        /// </summary>
        public static int AplicarPendentes(string raiz)
        {
            string estagio = Path.Combine(raiz, PASTA);
            if (!Directory.Exists(estagio)) return 0;

            var arquivos = Directory.GetFiles(estagio, "*", SearchOption.AllDirectories);
            if (arquivos.Length == 0) { Apagar(estagio); return 0; }

            string backup = Path.Combine(raiz, BACKUP);
            Apagar(backup);

            int trocados = 0;
            foreach (var origem in arquivos)
            {
                string rel = Rel(estagio, origem);
                if (rel == null || !Permitido(rel))
                {
                    CascaLog.Warn("pacote em estagio trazia algo fora de " + MOTOR + "/, ignorado: " + (rel ?? "?"));
                    continue;
                }

                string destino = Path.Combine(raiz, rel.Replace('/', Path.DirectorySeparatorChar));
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(destino));
                    if (File.Exists(destino))
                    {
                        string guardado = Path.Combine(backup, rel.Replace('/', Path.DirectorySeparatorChar));
                        Directory.CreateDirectory(Path.GetDirectoryName(guardado));
                        File.Copy(destino, guardado, overwrite: true);
                    }
                    File.Copy(origem, destino, overwrite: true);
                    trocados++;
                }
                catch (Exception e)
                {
                    // Meia troca e' pior que nenhuma: desfaz o que ja' foi feito e
                    // deixa o `.staged/` no lugar para tentar no proximo boot.
                    CascaLog.Err("nao consegui trocar " + rel + ": " + e.Message);
                    Reverter(raiz, "a troca do motor falhou no meio");
                    return trocados;
                }
            }

            Apagar(estagio);
            if (trocados > 0) CascaLog.Info("motor novo aplicado (" + trocados + " arquivo(s))");
            return trocados;
        }

        // ---------------------------------------------------------- sentinela

        /// <summary>Marca que vamos rodar o motor DO DISCO (o embutido nao precisa de rede de seguranca).</summary>
        public static void MarcarTentativa(string raiz)
        {
            if (raiz == null) return;
            try
            {
                int n = LerTentativas(raiz);
                File.WriteAllText(Path.Combine(raiz, Sentinela), (n + 1).ToString());
            }
            catch { }
        }

        public static void LimparTentativa(string raiz)
        {
            if (raiz == null) return;
            try
            {
                string arq = Path.Combine(raiz, Sentinela);
                if (File.Exists(arq)) File.Delete(arq);
            }
            catch { }
        }

        public static int LerTentativas(string raiz)
        {
            try
            {
                string arq = Path.Combine(raiz, Sentinela);
                if (!File.Exists(arq)) return 0;
                int n;
                return int.TryParse(File.ReadAllText(arq).Trim(), out n) ? n : 1;
            }
            catch { return 0; }
        }

        /// <summary>
        /// Chamado no boot: havia uma tentativa pendente, ou seja, o motor do
        /// disco nao terminou de rodar da ultima vez.
        ///
        /// A PRIMEIRA sobra e' tolerada de proposito — o jogo pode ter sido
        /// fechado pelo Gerenciador de Tarefas, ou a maquina desligada no tombo,
        /// e jogar fora um motor bom por isso seria pior que o problema. Na
        /// segunda, ele vai para a quarentena e o anterior volta.
        /// </summary>
        public static bool TratarQuebrado(string raiz)
        {
            int n = LerTentativas(raiz);
            if (n <= 0) return false;
            if (n < 2)
            {
                CascaLog.Warn("o motor nao terminou de rodar da ultima vez — tentando de novo");
                return false;
            }
            return Reverter(raiz, "o motor do disco nao abre");
        }

        // ----------------------------------------------------------- reverter

        /// <summary>
        /// Poe o motor atual de castigo e devolve o anterior. Sem anterior, o
        /// `engine/` fica vazio e o <see cref="GarantirMotor"/> repoe o que veio
        /// dentro do executavel — que e' o pior caso e ainda assim joga.
        /// </summary>
        public static bool Reverter(string raiz, string motivo)
        {
            string motor = Path.Combine(raiz, MOTOR);
            string backup = Path.Combine(raiz, BACKUP, MOTOR);
            LimparTentativa(raiz);

            try
            {
                if (Directory.Exists(motor))
                {
                    string castigo = Path.Combine(raiz, MOTOR + ".ruim-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                    if (Directory.Exists(castigo)) Apagar(castigo);
                    Directory.Move(motor, castigo);
                    CascaLog.Err(motivo + " — motor movido para " + Path.GetFileName(castigo));
                    PodarQuarentena(raiz);
                }

                if (Directory.Exists(backup))
                {
                    Copiar(backup, motor);
                    CascaLog.Info("motor anterior restaurado");
                }
                else
                {
                    CascaLog.Warn("nao havia motor anterior — usando o que veio dentro do executavel");
                }
                return true;
            }
            catch (Exception e)
            {
                CascaLog.Err("nao consegui reverter o motor: " + e.Message);
                return false;
            }
        }

        /// <summary>Guarda so' a quarentena mais recente: sao ~5 MB por copia.</summary>
        static void PodarQuarentena(string raiz)
        {
            try
            {
                var velhas = Directory.GetDirectories(raiz, MOTOR + ".ruim-*")
                                      .OrderByDescending(d => d)
                                      .Skip(1);
                foreach (var d in velhas) Apagar(d);
            }
            catch { }
        }

        // ------------------------------------------------------------ semente

        /// <summary>
        /// Primeira execucao: nao ha' motor no disco, entao ele sai de dentro do
        /// proprio executavel (`payload.zip` -> `engine.zip` + `native.zip`).
        ///
        /// Os pacotes embutidos sao os MESMOS bytes publicados no Release, e
        /// dentro deles as entradas vem com o prefixo `.staged/` (e' assim que o
        /// updater as pousa em estagio). Aqui o prefixo e' removido: no primeiro
        /// boot nao ha' nada carregado para atrapalhar, entao o motor vai direto
        /// para o lugar definitivo.
        /// </summary>
        public static bool GarantirMotor(string raiz)
        {
            if (File.Exists(CaminhoDoMotor(raiz))) return true;
            if (!Instalacao.TemPayload) return false;

            CascaLog.Info("primeira execucao — instalando o motor");
            int escritos = 0;
            try
            {
                using (var payload = Instalacao.AbrirPayload())
                using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    foreach (var entrada in zip.Entries)
                    {
                        string nome = entrada.FullName.Replace('\\', '/');
                        if (!nome.Equals("engine.zip", StringComparison.OrdinalIgnoreCase) &&
                            !nome.Equals("native.zip", StringComparison.OrdinalIgnoreCase)) continue;
                        escritos += ExtrairPacoteAninhado(entrada, raiz);
                    }
                }
            }
            catch (Exception e)
            {
                CascaLog.Err("nao consegui instalar o motor embutido: " + e.Message);
                return false;
            }

            if (escritos == 0)
            {
                // Executavel empacotado por um `pack` anterior a esta mudanca: o
                // payload nao tem os pacotes do motor. Nao e' erro — o motor que
                // vamos rodar e' o que veio compilado junto (ver Motor.Carregar).
                CascaLog.Info("o payload deste executavel nao traz o motor — usando o embutido");
                return false;
            }
            CascaLog.Info("motor instalado (" + escritos + " arquivo(s))");
            return File.Exists(CaminhoDoMotor(raiz));
        }

        /// <summary>
        /// O zip DENTRO do zip precisa passar por um arquivo temporario: o stream
        /// de uma entrada nao e' navegavel, e o ZipArchive em leitura exige
        /// navegar (o diretorio central fica no FIM do arquivo).
        /// </summary>
        static int ExtrairPacoteAninhado(ZipArchiveEntry entrada, string raiz)
        {
            string tmp = Path.Combine(Path.GetTempPath(), "classicduels-motor-" + Guid.NewGuid().ToString("N") + ".zip");
            int escritos = 0;
            try
            {
                using (var origem = entrada.Open())
                using (var saida = File.Create(tmp))
                    origem.CopyTo(saida);

                using (var interno = ZipFile.OpenRead(tmp))
                {
                    foreach (var e in interno.Entries)
                    {
                        if (string.IsNullOrEmpty(e.Name)) continue;              // diretorio
                        string rel = SemPrefixoDeEstagio(e.FullName);
                        if (rel == null || !Permitido(rel)) continue;

                        string destino = Path.Combine(raiz, rel.Replace('/', Path.DirectorySeparatorChar));
                        Directory.CreateDirectory(Path.GetDirectoryName(destino));
                        e.ExtractToFile(destino, overwrite: true);
                        escritos++;
                    }
                }
            }
            finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
            return escritos;
        }

        /// <summary>`.staged/engine/x` vira `engine/x`. Recusa `..` e caminho absoluto.</summary>
        internal static string SemPrefixoDeEstagio(string caminho)
        {
            string rel = (caminho ?? "").Replace('\\', '/').TrimStart('/');
            if (rel.Length == 0 || rel.Contains("..") || Path.IsPathRooted(rel)) return null;
            if (rel.StartsWith(PASTA + "/", StringComparison.OrdinalIgnoreCase))
                rel = rel.Substring(PASTA.Length + 1);
            return rel.Length == 0 ? null : rel;
        }

        // --------------------------------------------------------------- util

        static string Rel(string raiz, string caminho)
        {
            try
            {
                string rel = Path.GetRelativePath(raiz, caminho).Replace('\\', '/');
                if (rel.StartsWith("..") || Path.IsPathRooted(rel)) return null;
                return rel;
            }
            catch { return null; }
        }

        static void Apagar(string dir)
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); } catch { }
        }

        static void Copiar(string de, string para)
        {
            Directory.CreateDirectory(para);
            foreach (var arq in Directory.GetFiles(de, "*", SearchOption.AllDirectories))
            {
                string rel = Rel(de, arq);
                if (rel == null) continue;
                string destino = Path.Combine(para, rel.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(destino));
                File.Copy(arq, destino, overwrite: true);
            }
        }
    }
}
