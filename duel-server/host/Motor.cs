using System;
using System.IO;
using System.Reflection;
using System.Threading;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// Carrega o motor (`DuelServer.Engine.dll`) e chama ele.
    ///
    /// A ordem e' sempre a mesma: o motor DO DISCO manda, e o que veio dentro do
    /// executavel e' a rede de seguranca. E' isso que faz uma correcao no
    /// `NpcBrain` chegar ao jogador como um pacote de ~400 KB, sem trocar o .exe.
    ///
    /// O .dll e' carregado POR BYTES, nunca pelo caminho. `Assembly.LoadFrom`
    /// mapeia o arquivo em memoria e o Windows passa a recusar qualquer escrita
    /// nele — ou seja, a atualizacao seguinte nao conseguiria substituir o motor
    /// que esta' rodando. Lendo os bytes, o arquivo fica livre no disco.
    /// </summary>
    internal static class Motor
    {
        /// <summary>Nome simples do assembly do motor (o mesmo do `duel-engine.csproj`).</summary>
        public const string NOME = "DuelServer.Engine";

        /// <summary>Quanto tempo o motor precisa sobreviver para a tentativa ser dada como boa.</summary>
        public static readonly TimeSpan TempoDeConfianca = TimeSpan.FromSeconds(20);

        public sealed class Carga
        {
            public Assembly Assembly;
            /// <summary>Veio do disco (atualizavel) ou de dentro do executavel?</summary>
            public bool DoDisco;
            public string Caminho;
        }

        /// <summary>
        /// Devolve o motor pronto para ser chamado. Nunca devolve null: se o do
        /// disco nao carregar, ele e' posto de castigo e o embutido assume — um
        /// .dll corrompido no meio do download nao pode deixar ninguem sem jogo.
        /// </summary>
        public static Carga Carregar(string raiz)
        {
            if (raiz != null)
            {
                string caminho = Estagio.CaminhoDoMotor(raiz);
                if (File.Exists(caminho))
                {
                    try
                    {
                        var asm = DeBytes(caminho);
                        ApontarNativas(raiz);
                        return new Carga { Assembly = asm, DoDisco = true, Caminho = caminho };
                    }
                    catch (Exception e)
                    {
                        // Falha de CARGA e' inequivoca (arquivo truncado, bitness
                        // errado, dll que nao e' .NET): nao espera duas tentativas
                        // como a sentinela faz, reverte agora.
                        CascaLog.Err("o motor do disco nao carrega: " + e.Message);
                        Estagio.Reverter(raiz, "motor invalido no disco");
                        try
                        {
                            string voltou = Estagio.CaminhoDoMotor(raiz);
                            if (File.Exists(voltou))
                            {
                                var asm = DeBytes(voltou);
                                ApontarNativas(raiz);
                                return new Carga { Assembly = asm, DoDisco = true, Caminho = voltou };
                            }
                        }
                        catch (Exception e2) { CascaLog.Err("o motor anterior tambem nao carrega: " + e2.Message); }
                    }
                }
            }

            return CarregarEmbutido(raiz);
        }

        /// <summary>
        /// O motor que veio DENTRO do executavel: em desenvolvimento e' o .dll ao
        /// lado do .exe (o ProjectReference o copia); no executavel empacotado ele
        /// vem de dentro do bundle. Nos dois casos quem acha e' o proprio runtime.
        ///
        /// E' a rede de seguranca — e o que `--motor-embutido` forca na mao,
        /// quando se quer ignorar o que esta' no disco.
        /// </summary>
        public static Carga CarregarEmbutido(string raiz)
        {
            var interno = Assembly.Load(new AssemblyName(NOME));
            if (raiz != null) ApontarNativas(raiz);
            return new Carga { Assembly = interno, DoDisco = false, Caminho = null };
        }

        static Assembly DeBytes(string caminho)
        {
            byte[] dll = File.ReadAllBytes(caminho);
            string pdbPath = Path.ChangeExtension(caminho, ".pdb");
            byte[] pdb = null;
            try { if (File.Exists(pdbPath)) pdb = File.ReadAllBytes(pdbPath); } catch { }
            return pdb != null ? Assembly.Load(dll, pdb) : Assembly.Load(dll);
        }

        /// <summary>
        /// Diz ao motor onde estao a `ocgcore.dll` e a `sqlite3.dll`.
        ///
        /// A casca NAO registra o resolvedor de nativas ela mesma, e isso custou
        /// um teste vermelho: o .NET aceita UM resolvedor por assembly, o motor
        /// ja' registra o dele (`DuelServer.Nativas`) e o segundo registro morre
        /// com "A resolver is already set for the assembly" — arrastando o boot
        /// inteiro junto. Quem resolve e' o motor; a casca so' aponta a pasta,
        /// por variavel de ambiente, que atravessa a fronteira da reflexao e um
        /// motor mais antigo simplesmente ignora.
        ///
        /// E' isto que faz as nativas serem conteudo atualizavel (pacote
        /// `native`) em vez de carga presa dentro do executavel.
        /// </summary>
        static void ApontarNativas(string raiz)
        {
            if (raiz == null) return;
            try
            {
                Environment.SetEnvironmentVariable("CLASSICDUELS_ENGINE_DIR",
                                                   Path.Combine(raiz, Estagio.MOTOR));
            }
            catch { }
        }

        /// <summary>
        /// Chama `DuelServer.EngineEntry.Main`. A sobrecarga de dois argumentos e'
        /// a atual; a de um existe para a casca conseguir rodar um motor ANTERIOR
        /// a ela — o jogador pode ter um `engine/` mais velho que o executavel.
        /// </summary>
        public static int Invocar(Carga carga, string[] args, string raiz)
        {
            var tipo = carga.Assembly.GetType("DuelServer.EngineEntry", throwOnError: false)
                       ?? throw new InvalidOperationException(
                           "este " + Estagio.DLL + " nao tem DuelServer.EngineEntry");

            var comRaiz = tipo.GetMethod("Main", new[] { typeof(string[]), typeof(string) });
            var soArgs = tipo.GetMethod("Main", new[] { typeof(string[]) });
            var metodo = comRaiz ?? soArgs
                         ?? throw new InvalidOperationException("EngineEntry sem um Main que eu saiba chamar");

            object[] parametros = comRaiz != null ? new object[] { args, raiz } : new object[] { args };

            // A sentinela so' existe para o motor do disco: o embutido nao tem
            // como ser revertido, e marcar tentativa nele so' produziria
            // quarentena de um motor que e' o ultimo recurso.
            if (carga.DoDisco) Estagio.MarcarTentativa(raiz);

            Timer confianca = null;
            if (carga.DoDisco)
            {
                // O `--app` nunca RETORNA (ele fica servindo ate' o jogador
                // fechar a janela), entao "voltou sem explodir" nao serve
                // sozinho como prova de que o motor presta. Sobreviver aos
                // primeiros 20 segundos serve.
                confianca = new Timer(_ => Estagio.LimparTentativa(raiz), null,
                                      TempoDeConfianca, Timeout.InfiniteTimeSpan);
            }

            try
            {
                object r = metodo.Invoke(null, parametros);
                // Qualquer retorno NORMAL conta como motor bom, inclusive codigo
                // de erro: `porta ocupada` devolve 4 e nao e' defeito do motor.
                if (carga.DoDisco) Estagio.LimparTentativa(raiz);
                return r is int i ? i : 0;
            }
            catch (TargetInvocationException e)
            {
                throw e.InnerException ?? e;
            }
            finally
            {
                if (confianca != null) confianca.Dispose();
            }
        }
    }
}
