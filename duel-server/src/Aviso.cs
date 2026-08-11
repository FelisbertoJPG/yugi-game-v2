using System;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Avisa o JOGADOR — não o log.
    ///
    /// Por que existe: quando o jogo não sobe, tudo o que o usuário vê é uma
    /// janela de terminal piscando e sumindo. A explicação existe (vai inteira
    /// para `logs/duel-server.log`), mas ninguém lê log de jogo. Pior: aberto
    /// pelo launcher, o processo roda com a janela OCULTA — não há console
    /// nenhum onde a mensagem pudesse aparecer.
    ///
    /// Uma caixa de diálogo do Windows aparece nos dois casos. Fora do Windows
    /// (o servidor de arena roda em Linux) cai no console, que ali é o certo.
    /// </summary>
    public static class Aviso
    {
        const uint MB_OK = 0x0;
        const uint MB_ICONERROR = 0x10;
        const uint MB_TOPMOST = 0x40000;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

        public static void Erro(string titulo, string texto)
        {
            Log.Err(texto.Replace("\n", " "));

            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return;

            // MB_TOPMOST porque a janela do jogo pode estar oculta: sem isso o
            // diálogo nasceria atrás de tudo e o sintoma continuaria sendo
            // "não abriu e não disse nada".
            try { MessageBoxW(IntPtr.Zero, texto, titulo, MB_OK | MB_ICONERROR | MB_TOPMOST); }
            catch (Exception e) { Log.Warn($"nao consegui mostrar o aviso: {e.Message}"); }
        }

        /// <summary>
        /// Mensagem de "não consegui abrir a porta", escrita para quem joga.
        ///
        /// A causa é quase sempre a mesma e tem solução de um clique: já existe
        /// um Duel Academy aberto (ou um `npm run dev`). O texto diz isso antes
        /// de qualquer coisa técnica — quem precisa do `netsh` sabe procurar no
        /// log.
        /// </summary>
        public static void PortaOcupada(string url, string detalhe)
        {
            Erro("Duel Academy não conseguiu abrir",
                 "O jogo não conseguiu usar a porta de que precisa.\n\n" +
                 "Quase sempre é porque JÁ EXISTE UM DUEL ACADEMY ABERTO — " +
                 "procure na barra de tarefas, ou rode o duel-academy-stop.exe " +
                 "que fica na pasta do jogo.\n\n" +
                 "Se você estiver desenvolvendo, um 'npm run dev' aberto também " +
                 "ocupa a mesma porta.\n\n" +
                 $"Detalhe técnico: {url}\n{detalhe}");
        }
    }
}
