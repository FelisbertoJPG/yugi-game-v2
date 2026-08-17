using System;
using System.Threading;
using System.Threading.Tasks;
using YGO;

namespace DuelServer.Update
{
    /// <summary>
    /// Cola entre o <see cref="UpdateEngine"/> e o resto do processo: guarda o
    /// estado da checagem/instalação num lugar só, para o boot do `--app` decidir
    /// que página abrir e para as rotas `/__update/*` reportarem progresso.
    ///
    /// Regra de ouro do boot: **offline nunca trava o jogo**. A checagem tem um
    /// timeout curto e qualquer falha vira "sem atualização" — o jogador entra
    /// com o que já tem instalado. Um updater que impede de jogar quando o
    /// GitHub está fora do ar é pior que nenhum updater.
    /// </summary>
    public static class UpdateService
    {
        public enum Estado { Ocioso, Checando, Disponivel, Instalando, Concluido, Falhou, Indisponivel, Reiniciando }

        static readonly object _trava = new();
        static UpdateEngine _engine;
        static FonteDeAssets _fonte;
        static Manifest _manifesto;
        static Plano _plano;

        public static Estado Situacao { get; private set; } = Estado.Ocioso;
        public static string Etapa { get; private set; } = "";
        public static string Detalhe { get; private set; } = "";
        public static double Fracao { get; private set; }
        public static string Erro { get; private set; }
        public static string Raiz { get; private set; }

        /// <summary>Resumo humano do que falta baixar ("pacote 'game' — 0,8 MB").</summary>
        public static string Resumo => _plano?.Resumo() ?? "";
        public static long Bytes => _plano?.BytesTotais ?? 0;
        public static string VersaoDisponivel => _manifesto?.GameVersion ?? "";
        public static bool InstaladorDesatualizado => _plano?.InstaladorDesatualizado ?? false;

        static void Estagio(Estado s, string etapa = null, string detalhe = null, double? fracao = null)
        {
            lock (_trava)
            {
                Situacao = s;
                if (etapa != null) Etapa = etapa;
                if (detalhe != null) Detalhe = detalhe;
                if (fracao.HasValue) Fracao = fracao.Value;
            }
        }

        /// <summary>
        /// Checa se há atualização. Devolve `true` se houver algo a baixar.
        /// Chamado no boot do `--app`, ANTES de abrir o navegador.
        /// </summary>
        public static bool Checar(string raiz, TimeSpan timeout)
        {
            Raiz = raiz;
            Estagio(Estado.Checando, "procurando atualizacao", BuildConfig.Repo, 0);

            try
            {
                _fonte = new FonteGitHub(BuildConfig.Owner, BuildConfig.Repo,
                                         BuildConfig.Tag, BuildConfig.Token);
                _engine = new UpdateEngine(raiz, _fonte,
                    onProgresso: p => Estagio(Situacao, p.Etapa, p.Detalhe, p.Fracao));

                using var cts = new CancellationTokenSource(timeout);
                _manifesto = _engine.CarregarManifestoAsync(cts.Token).GetAwaiter().GetResult();
                if (_manifesto == null)
                {
                    Estagio(Estado.Indisponivel, "sem conexao", "jogando com o que ja' esta instalado", 1);
                    return false;
                }

                _plano = _engine.Montar(_manifesto, BuildConfig.InstallerVersion);
                if (_plano.NadaAFazer)
                {
                    Estagio(Estado.Concluido, "tudo em dia", _manifesto.GameVersion, 1);
                    Log.Info($"jogo em dia ({_manifesto.GameVersion})");
                    return false;
                }

                Estagio(Estado.Disponivel, "atualizacao disponivel", _plano.Resumo(), 0);
                Log.Info($"atualizacao disponivel: {_plano.Resumo()}");
                return true;
            }
            catch (Exception e)
            {
                // Inclui o timeout: uma rede lenta não pode segurar o boot.
                Erro = e.Message;
                Estagio(Estado.Indisponivel, "sem conexao", e.Message, 1);
                Log.Warn($"checagem de atualizacao falhou ({e.Message}) — seguindo offline");
                return false;
            }
        }

        static Task _emAndamento;

        /// <summary>Dispara a instalação em segundo plano (idempotente).</summary>
        public static void Aplicar()
        {
            lock (_trava)
            {
                if (_emAndamento != null && !_emAndamento.IsCompleted) return;
                if (_engine == null || _plano == null) return;
                Situacao = Estado.Instalando;
                _emAndamento = Task.Run(Rodar);
            }
        }

        static void Rodar()
        {
            try
            {
                bool ok = _engine.AplicarAsync(_plano).GetAwaiter().GetResult();
                if (!ok)
                {
                    Erro = "a instalacao falhou; nada foi trocado";
                    Estagio(Estado.Falhou, "falhou", Erro, 1);
                    return;
                }

                // O exe por ULTIMO, de proposito: se a troca do executavel
                // acontecesse antes, uma falha no meio dos arquivos do jogo
                // deixaria um exe novo rodando conteudo velho.
                if (_plano.InstaladorDesatualizado && TrocarExecutavel()) return;

                Estagio(Estado.Concluido, "pronto", _manifesto.GameVersion, 1);
            }
            catch (Exception e)
            {
                Erro = e.Message;
                Estagio(Estado.Falhou, "falhou", e.Message, 1);
                Log.Err($"atualizacao falhou: {e.Message}");
            }
        }

        /// <summary>
        /// Baixa e agenda a troca do próprio executável. `true` se o processo vai
        /// encerrar (o `.bat` reabre a versão nova).
        ///
        /// A pausa antes do `Exit` não é frescura: sem ela o servidor morre antes
        /// do próximo poll do front, e o jogador vê a página congelar em vez de
        /// ler "reiniciando".
        /// </summary>
        static bool TrocarExecutavel()
        {
            string novo = SelfUpdater.BaixarAsync(_manifesto, _fonte).GetAwaiter().GetResult();
            if (novo == null) return false;

            Estagio(Estado.Reiniciando, "reiniciando",
                    $"versao nova do Classic Duels ({_manifesto.Installer.Version})", 1);

            Task.Run(() =>
            {
                Thread.Sleep(1200);
                if (SelfUpdater.AgendarTroca(novo)) Environment.Exit(0);
            });
            return true;
        }

        /// <summary>Nome do backup mais recente, ou null. É o que habilita o botão de voltar.</summary>
        public static string BackupDisponivel => _engine?.BackupMaisRecente();

        /// <summary>
        /// Desfaz a última atualização (rota `/__update/restaurar`).
        ///
        /// Síncrono de propósito, ao contrário do <see cref="Aplicar"/>: não há
        /// download nenhum, são cópias locais, e quem clicou em "voltar" acabou de
        /// descobrir que o jogo não abre — deixar isso em segundo plano só
        /// adicionaria uma tela de espera a mais.
        /// </summary>
        public static object Restaurar(string nome = null)
        {
            lock (_trava)
            {
                if (_engine == null) return new { ok = false, erro = "o updater nao foi iniciado" };
                if (_emAndamento != null && !_emAndamento.IsCompleted)
                    return new { ok = false, erro = "espere a instalacao em andamento terminar" };
            }

            try
            {
                Estagio(Estado.Instalando, "restaurando", "voltando para o backup", 0);
                int n = _engine.Restaurar(nome);
                if (n == 0)
                {
                    Erro = "nao havia backup para restaurar";
                    Estagio(Estado.Falhou, "falhou", Erro, 1);
                    return new { ok = false, erro = Erro };
                }

                // O plano em memória descreve um disco que não existe mais; refaz.
                if (_manifesto != null) _plano = _engine.Montar(_manifesto, BuildConfig.InstallerVersion);
                Erro = null;
                Estagio(Estado.Disponivel, "versao anterior restaurada",
                        $"{n} arquivo(s) voltaram", 1);
                return new { ok = true, arquivos = n };
            }
            catch (Exception e)
            {
                Erro = e.Message;
                Estagio(Estado.Falhou, "falhou", e.Message, 1);
                Log.Err($"restauracao falhou: {e.Message}");
                return new { ok = false, erro = e.Message };
            }
        }

        /// <summary>Fotografia do estado, para a rota `/__update/status`.</summary>
        public static object Snapshot()
        {
            lock (_trava)
            {
                return new
                {
                    estado = Situacao.ToString().ToLowerInvariant(),
                    etapa = Etapa,
                    detalhe = Detalhe,
                    fracao = Math.Round(Fracao, 4),
                    resumo = Resumo,
                    bytes = Bytes,
                    versao = VersaoDisponivel,
                    instaladorDesatualizado = InstaladorDesatualizado,
                    backup = BackupDisponivel,
                    erro = Erro
                };
            }
        }
    }
}
