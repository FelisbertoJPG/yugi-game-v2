using System;

namespace DuelServer
{
    /// <summary>
    /// A porta de entrada do MOTOR, chamada pela casca (`../host/Program.cs`).
    ///
    /// Existe porque o motor deixou de ser um executavel: ele e' um
    /// `DuelServer.Engine.dll` que a casca carrega DO DISCO, para uma mudanca de
    /// C# poder chegar ao jogador como um pacote de ~400 KB em vez de um
    /// executavel de 67,8 MB (ver `engine/duel-engine.csproj`).
    ///
    /// A casca chama isto por REFLEXAO, pelo nome. Nao mude a assinatura sem
    /// mudar `Motor.cs` junto - e lembre que a casca velha do jogador vai chamar
    /// a assinatura ANTIGA num motor novo: quem tem de aguentar as duas pontas e'
    /// esta classe, nao a casca.
    /// </summary>
    public static class EngineEntry
    {
        /// <summary>
        /// Argumentos com que este processo subiu. Guardados aqui porque a casca
        /// e' quem os recebe do sistema, e o `UpdateService` precisa deles para
        /// reabrir o jogo do mesmo jeito depois de trocar o motor.
        /// </summary>
        public static string[] Argumentos { get; private set; } = Array.Empty<string>();

        /// <summary>
        /// Onde o jogo esta' instalado (a raiz que a casca resolveu). Null em
        /// desenvolvimento, onde nao ha' instalacao nenhuma.
        /// </summary>
        public static string RaizInstalacao { get; private set; }

        public static int Main(string[] args) => Main(args, null);

        public static int Main(string[] args, string raizInstalacao)
        {
            Argumentos = args ?? Array.Empty<string>();
            RaizInstalacao = raizInstalacao;

            // Antes de tudo: a primeira chamada nativa do boot e' o
            // `OCG_GetVersion`, e sem o resolvedor no lugar ela procuraria a
            // ocgcore "ao lado do assembly" — que nao existe, porque a casca
            // carrega este motor por bytes.
            Nativas.Ligar();
            return Program.Executar(Argumentos);
        }
    }
}
