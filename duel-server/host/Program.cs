using System;
using System.Diagnostics;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// A CASCA do Classic Duels.
    ///
    /// Este executavel nao joga nada: ele resolve onde o jogo esta' instalado,
    /// aplica a atualizacao de motor que ficou preparada no boot anterior, e
    /// entrega o processo ao motor (`DuelServer.Engine.dll`).
    ///
    /// POR QUE ELE EXISTE. Ate' 19/08/2026 o motor inteiro morava dentro do .exe,
    /// e entregar uma mudanca de C# ao jogador significava trocar o executavel:
    /// 67,8 MB — dos quais ~30 MB eram `game.zip` e `cards.zip` que ele ja' tinha
    /// no disco — mais um ritual manual (`pack`, bump da InstallerVersion,
    /// `-ComExe`) que ja' foi esquecido em producao pelo menos uma vez: o front
    /// subiu, o motor ficou velho, e nenhum teste acusou.
    ///
    /// Com a casca, o motor e' um pacote do manifesto como qualquer outro e uma
    /// correcao no `NpcBrain` custa ~400 KB. A troca do proprio .exe continua
    /// existindo (`SelfUpdater`), mas so' e' necessaria quando ESTE arquivo aqui
    /// muda — o que deve ser raro, e e' por isso que ele e' curto de proposito:
    /// quanto menos ele faz, menos motivo tem para mudar.
    /// </summary>
    internal static class Program
    {
        static int Main(string[] args)
        {
            // Suite da propria casca. Vem antes de tudo: nao carrega motor
            // nenhum, so' mexe em pastas descartaveis no %TEMP%.
            if (Array.IndexOf(args, "--test-casca") >= 0) return TestCasca.Run();

            string raiz = null;
            try
            {
                raiz = Instalacao.Resolver();
                if (raiz != null)
                {
                    // Ordem que importa: primeiro aplica o que foi baixado (nada
                    // esta' carregado ainda), depois cuida do motor que nao subiu
                    // da ultima vez, e so' entao repoe o embutido se faltar.
                    Estagio.AplicarPendentes(raiz);
                    Estagio.TratarQuebrado(raiz);
                    Estagio.GarantirMotor(raiz);
                }
            }
            catch (Exception e)
            {
                // Nada disto pode impedir o jogo de abrir: sem a raiz, o motor
                // embutido roda igual ao que rodava antes desta casca existir.
                CascaLog.Err("preparacao do motor falhou (" + e.Message + ") — seguindo com o embutido");
                raiz = null;
            }

            bool forcarEmbutido = Array.IndexOf(args, "--motor-embutido") >= 0;

            Motor.Carga carga;
            try
            {
                carga = forcarEmbutido ? Motor.CarregarEmbutido(raiz) : Motor.Carregar(raiz);
            }
            catch (Exception e)
            {
                CascaLog.Err("nao consegui carregar o motor do jogo: " + e.Message);
                return Segurar(5);
            }

            if (carga.DoDisco) CascaLog.Info("motor: " + carga.Caminho);

            var relogio = Stopwatch.StartNew();
            try
            {
                return Motor.Invocar(carga, args, raiz);
            }
            catch (Exception e)
            {
                CascaLog.Err("o motor morreu: " + e);

                // Morreu LOGO — cheiro de motor novo quebrado, e nao de defeito
                // que apareceu no meio da partida. Poe de castigo e tenta na
                // mesma hora com o que veio dentro do executavel: uma atualizacao
                // ruim nao pode custar nem um boot ao jogador.
                if (carga.DoDisco && relogio.Elapsed < Motor.TempoDeConfianca)
                {
                    Estagio.Reverter(raiz, "o motor novo quebrou ao subir");
                    try
                    {
                        CascaLog.Warn("tentando de novo com o motor anterior");
                        return Motor.Invocar(Motor.CarregarEmbutido(raiz), args, raiz);
                    }
                    catch (Exception e2) { CascaLog.Err("o motor de reserva tambem morreu: " + e2.Message); }
                }
                return Segurar(6);
            }
        }

        /// <summary>
        /// Segura a janela aberta para a mensagem de erro poder ser lida. So' faz
        /// sentido no executavel distribuido (dois cliques, janela propria); em
        /// desenvolvimento so' atrapalharia o terminal.
        /// </summary>
        static int Segurar(int codigo)
        {
            if (!Instalacao.TemPayload) return codigo;
            Console.WriteLine();
            Console.WriteLine("  (pressione qualquer tecla para fechar)");
            try { Console.ReadKey(true); } catch { System.Threading.Thread.Sleep(8000); }
            return codigo;
        }
    }
}
