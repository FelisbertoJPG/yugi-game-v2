using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using YGO;

namespace DuelServer.Update
{
    /// <summary>
    /// Auto-update do PRÓPRIO executável.
    ///
    /// O Windows não deixa sobrescrever um `.exe` em execução, então a troca é
    /// feita por fora: baixamos `DuelAcademy.exe.new`, escrevemos um `.bat` no
    /// `%TEMP%` que espera este processo morrer, troca os arquivos e reabre o
    /// jogo. Só então encerramos.
    /// </summary>
    public static class SelfUpdater
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool DeleteFileW(string lpFileName);

        /// <summary>
        /// Tira a "Marca da Web" do arquivo baixado.
        ///
        /// Isto NÃO é opcional aqui, e é a armadilha mais cara deste projeto: todo
        /// arquivo vindo da internet carrega o fluxo alternativo `Zone.Identifier`,
        /// e o `Spawn` do launcher abre os processos com a janela OCULTA. Sem
        /// janela não há onde clicar na confirmação, então o Windows devolve na
        /// hora o erro 1223 ("cancelada pelo usuário") sem nunca ter perguntado
        /// nada — e o sintoma, do lado do jogador, é o jogo simplesmente não abrir
        /// depois de uma atualização bem-sucedida.
        ///
        /// O `launcher/Program.cs` (`OfferUnblock`) já trata o mesmo problema para
        /// os arquivos que vieram num zip; ali ele PERGUNTA antes, porque são
        /// arquivos que o usuário trouxe. Aqui não se pergunta: o arquivo foi
        /// baixado por nós, neste segundo, de um Release nosso cujo sha256 já
        /// conferimos. Pedir autorização para desmarcar o que nós mesmos trouxemos
        /// só produziria um diálogo que ninguém sabe responder.
        /// </summary>
        static void TirarMarcaDaWeb(string arquivo)
        {
            if (DeleteFileW(arquivo + ":Zone.Identifier"))
                Log.Info("  marca da web removida do executavel novo");
        }

        /// <summary>
        /// Baixa o exe novo se o manifesto anunciar versão maior que a compilada.
        /// Devolve o caminho do `.new` pronto, ou null se não havia o que fazer.
        /// </summary>
        /// <param name="exeAtual">
        /// Só os testes passam isto. Em produção é sempre o próprio executável —
        /// mas um `--test-selfupdate` que apontasse para o `Environment.ProcessPath`
        /// substituiria o binário que está rodando o teste, que é exatamente o tipo
        /// de estrago que este teste existe para evitar.
        /// </param>
        public static async Task<string> BaixarAsync(Manifest m, FonteDeAssets fonte,
                                                     CancellationToken ct = default,
                                                     string exeAtual = null)
        {
            if (m?.Installer == null || string.IsNullOrEmpty(m.Installer.Asset)) return null;

            string atual = exeAtual ?? Environment.ProcessPath;
            if (string.IsNullOrEmpty(atual)) { Log.Warn("nao sei qual e' o meu proprio executavel"); return null; }

            string novo = atual + ".new";
            try
            {
                Log.Info($"baixando o executavel novo ({m.Installer.Version})");
                using (var origem = await fonte.AbrirAsync(m.Installer.Asset, m.Installer.Url, ct))
                using (var saida = File.Create(novo))
                    await origem.CopyToAsync(saida, ct);

                // Trocar o exe por um binario que veio corrompido deixaria o jogo
                // sem NENHUMA versao que abre. Confere antes de qualquer troca.
                string sha = HashCache.Computar(novo);
                if (!string.IsNullOrEmpty(m.Installer.Sha256) &&
                    !string.Equals(sha, m.Installer.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    Log.Err($"executavel novo com sha256 errado (esperado {m.Installer.Sha256}, veio {sha})");
                    try { File.Delete(novo); } catch { }
                    return null;
                }

                TirarMarcaDaWeb(novo);
                return novo;
            }
            catch (Exception e)
            {
                Log.Err($"nao consegui baixar o executavel novo: {e.Message}");
                try { if (File.Exists(novo)) File.Delete(novo); } catch { }
                return null;
            }
        }

        /// <summary>
        /// Agenda a troca e devolve `true` se o chamador deve encerrar o processo.
        ///
        /// O `.bat` espera o PID atual sumir antes de mexer no arquivo — sem essa
        /// espera, o `copy` corre contra o processo ainda vivo e falha de forma
        /// intermitente (funciona na máquina de quem testou, quebra na de quem usa).
        /// </summary>
        /// <param name="exeAtual">Só os testes passam (ver <see cref="BaixarAsync"/>).</param>
        /// <param name="pidEsperar">
        /// Só os testes passam. O `.bat` espera ESTE processo morrer antes de tocar
        /// no arquivo; o teste passa o PID de um processo que já morreu, para a
        /// espera terminar na hora sem precisar encerrar quem está testando.
        /// </param>
        public static bool AgendarTroca(string exeNovo, bool reabrir = true,
                                        string exeAtual = null, int? pidEsperar = null)
        {
            string atual = exeAtual ?? Environment.ProcessPath;
            if (string.IsNullOrEmpty(atual) || !File.Exists(exeNovo)) return false;

            string bat = Path.Combine(Path.GetTempPath(), $"duelacademy-update-{Guid.NewGuid():N}.bat");
            int pid = pidEsperar ?? Environment.ProcessId;

            var sb = new StringBuilder();
            sb.AppendLine("@echo off");
            sb.AppendLine("setlocal");
            sb.AppendLine($"set ALVO=\"{atual}\"");
            sb.AppendLine($"set NOVO=\"{exeNovo}\"");
            sb.AppendLine();
            sb.AppendLine(":esperar");
            sb.AppendLine($"tasklist /fi \"PID eq {pid}\" 2>nul | find \"{pid}\" >nul");
            sb.AppendLine("if not errorlevel 1 (");
            // ping como sleep: o `timeout` do Windows exige console interativo e
            // aborta com "ERROR: Input redirection is not supported" quando o .bat
            // roda sem janela — exatamente o nosso caso.
            sb.AppendLine("  ping -n 2 127.0.0.1 >nul");
            sb.AppendLine("  goto esperar");
            sb.AppendLine(")");
            sb.AppendLine();
            sb.AppendLine("copy /y %NOVO% %ALVO% >nul");
            sb.AppendLine("if errorlevel 1 goto fim");
            sb.AppendLine("del %NOVO% >nul 2>&1");
            if (reabrir) sb.AppendLine("start \"\" %ALVO%");
            sb.AppendLine(":fim");
            sb.AppendLine("del \"%~f0\"");   // o .bat se autodeleta

            try
            {
                // ASCII de proposito: o cmd.exe interpreta o .bat na codepage do
                // console, e um .bat em UTF-8 com acento vira comando invalido.
                File.WriteAllText(bat, sb.ToString(), Encoding.ASCII);

                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c \"{bat}\"",
                    CreateNoWindow = true,
                    UseShellExecute = false
                });

                Log.Info("executavel novo instalado — reabrindo o Duel Academy");
                return true;
            }
            catch (Exception e)
            {
                Log.Err($"nao consegui agendar a troca do executavel: {e.Message}");
                return false;
            }
        }
    }
}
