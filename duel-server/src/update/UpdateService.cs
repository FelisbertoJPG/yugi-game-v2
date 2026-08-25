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
    /// **A regra do boot mudou em 23/08/2026.** Ela era "offline nunca trava o
    /// jogo": qualquer falha de rede virava "sem atualização" e o jogador entrava
    /// com o que tinha. Hoje é o contrário — sem falar com o servidor, o jogo
    /// espera na tela de atualização, que reconsulta sozinha até a rede voltar.
    ///
    /// O motivo é que a premissa da regra antiga deixou de valer: login, carteira,
    /// coleção, decks, adversários e trilha moram todos no Supabase, então "entrar
    /// offline" já não entregava um jogo — entregava uma home vazia com cara de
    /// quebrada. E a versão desatualizada, essa sim, custava caro: front novo
    /// falando com motor velho, deck que o servidor recusa por uma regra que só
    /// existe na versão nova, e o cliente congelado de 19/08/2026, que passou dias
    /// recebendo front e nunca motor.
    ///
    /// O que NÃO mudou: nada disto pode lançar exceção até o boot. A checagem tem
    /// timeout curto e toda falha vira um ESTADO (`Indisponivel`) que a tela sabe
    /// mostrar — nunca um jogo que não abre e não diz por quê.
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

                // Sem manifesto NENHUM, ou com um que veio do cache: nos dois casos
                // nao falamos com o servidor, e nos dois a resposta e' a mesma desde
                // 23/08/2026 — o jogo espera. O cache diz o que era verdade da
                // ultima vez; aceita-lo como resposta deixaria passar justamente o
                // cliente velho que nao consegue perguntar se esta' velho.
                if (_manifesto == null || _engine.ManifestoVeioDoCache)
                {
                    _manifesto = null;
                    Estagio(Estado.Indisponivel, "sem conexao",
                            "o Classic Duels precisa se conectar para abrir", 1);
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

        static Task _rechecando;

        /// <summary>
        /// Refaz a checagem, em segundo plano (idempotente).
        ///
        /// Existe porque a tela de atualizacao deixou de ter saida: sem conexao o
        /// jogo PARA nela, entao ela precisa de um jeito de tentar de novo que nao
        /// seja fechar e reabrir o jogo. Um boot inteiro por tentativa era o custo
        /// antes disto — e quem esta' sem rede tende a tentar varias vezes.
        ///
        /// Recusa enquanto uma instalacao roda: rechecar no meio dela trocaria o
        /// `_plano` que o `AplicarAsync` esta' usando.
        /// </summary>
        public static void Rechecar(TimeSpan timeout)
        {
            lock (_trava)
            {
                if (Raiz == null) return;
                if (_emAndamento != null && !_emAndamento.IsCompleted) return;
                if (_rechecando != null && !_rechecando.IsCompleted) return;
                Erro = null;
                _rechecando = Task.Run(() => Checar(Raiz, timeout));
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

                // O MOTOR novo esta' baixado, mas em `.staged/`: ele so' vale
                // quando a casca o aplicar, e ela so' roda no boot. Sem reabrir,
                // o jogador continuaria com o motor velho — vendo "pronto" na
                // tela, que e' a pior das duas mentiras possiveis aqui.
                if (_plano.TrocaMotor && ReabrirParaTrocarMotor()) return;

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

        /// <summary>
        /// Fecha o jogo e reabre, para a casca aplicar o motor que ficou em
        /// estágio. A pausa antes do `Exit` não é frescura: sem ela o servidor
        /// morre antes do próximo poll do front, e o jogador vê a página
        /// congelar em vez de ler "reiniciando".
        /// </summary>
        static bool ReabrirParaTrocarMotor()
        {
            Estagio(Estado.Reiniciando, "reiniciando", "aplicando o motor novo", 1);

            Task.Run(() =>
            {
                Thread.Sleep(1200);
                if (SelfUpdater.AgendarReabertura()) Environment.Exit(0);
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
