using System;
using System.IO;
using System.Linq;
using System.Reflection;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// Teste de aceitacao da CASCA — `--test-casca`.
    ///
    /// O que ele cobre e' o caminho que so' existe na maquina do jogador: o motor
    /// baixado ficou em `.staged/`, e a troca acontece no boot seguinte. Nada
    /// disso passa pelo `--test-update` (que exercita o updater ate' o disco) nem
    /// pelo `--test-selfupdate` (que exercita a troca do .exe).
    ///
    /// Roda em pastas descartaveis no %TEMP%, sem rede e sem carregar motor
    /// nenhum, entao serve numa maquina que nem tem o `cards.cdb`.
    ///
    /// O caso mais importante e' o ULTIMO: um motor quebrado nao pode deixar
    /// ninguem sem jogo. Como e' um .dll que o jogador baixa sozinho, se ele
    /// puder travar o boot ninguem tem como consertar do outro lado.
    /// </summary>
    internal static class TestCasca
    {
        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Console.WriteLine("  ok   " + nome); }
        static void Falha(string nome, string porque) { _fail++; Console.WriteLine("  FALHA " + nome + ": " + porque); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run()
        {
            Console.WriteLine("=== teste: CASCA (troca do motor em disco) ===\n");

            string bancada = Path.Combine(Path.GetTempPath(),
                "classicduels-test-casca-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                CaminhosDeEstagio();
                AplicaOQueEstavaEmEstagio(Sub(bancada, "1-aplicar"));
                RecusaOQueNaoEMotor(Sub(bancada, "2-fora-do-motor"));
                PrimeiraFalhaEToleradaSegundaReverte(Sub(bancada, "3-sentinela"));
                RevertePorCimaSemAnterior(Sub(bancada, "4-sem-anterior"));
                QuarentenaNaoAcumula(Sub(bancada, "5-poda"));
                ConstantesBatemComOMotor();
            }
            finally
            {
                try { if (Directory.Exists(bancada)) Directory.Delete(bancada, true); } catch { }
            }

            Console.WriteLine();
            Console.WriteLine(_fail == 0
                ? "TUDO CERTO — " + _pass + " checagens"
                : _fail + " FALHA(S) em " + (_pass + _fail) + " checagens");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- casos

        /// <summary>O prefixo `.staged/` sai, e caminho que escapa da raiz e' recusado.</summary>
        static void CaminhosDeEstagio()
        {
            Console.WriteLine("[1] caminhos das entradas do pacote");
            Checa(Estagio.SemPrefixoDeEstagio(".staged/engine/DuelServer.Engine.dll") == "engine/DuelServer.Engine.dll",
                  "o prefixo .staged/ sai");
            Checa(Estagio.SemPrefixoDeEstagio("engine/ocgcore.dll") == "engine/ocgcore.dll",
                  "sem prefixo, o caminho passa igual");
            Checa(Estagio.SemPrefixoDeEstagio(".staged/../../store/wallet.json") == null,
                  "caminho com .. e' recusado");
            Checa(Estagio.SemPrefixoDeEstagio("C:/Windows/system32/x.dll") == null,
                  "caminho absoluto e' recusado");
            Console.WriteLine();
        }

        /// <summary>O boot aplica o que o updater deixou pronto e guarda o anterior.</summary>
        static void AplicaOQueEstavaEmEstagio(string raiz)
        {
            Console.WriteLine("[2] o que estava em estagio e' aplicado no boot");

            Escrever(Path.Combine(raiz, "engine", Estagio.DLL), "MOTOR VELHO");
            Escrever(Path.Combine(raiz, "engine", "ocgcore.dll"), "CORE VELHO");
            Escrever(Path.Combine(raiz, ".staged", "engine", Estagio.DLL), "MOTOR NOVO");

            int n = Estagio.AplicarPendentes(raiz);

            Checa(n == 1, "trocou 1 arquivo", "trocou " + n);
            Checa(Ler(Path.Combine(raiz, "engine", Estagio.DLL)) == "MOTOR NOVO", "o motor novo esta' no lugar");
            Checa(Ler(Path.Combine(raiz, "engine", "ocgcore.dll")) == "CORE VELHO",
                  "o que o pacote nao trazia continua onde estava");
            Checa(Ler(Path.Combine(raiz, ".staged-bak", "engine", Estagio.DLL)) == "MOTOR VELHO",
                  "o anterior foi guardado para poder voltar");
            Checa(!Directory.Exists(Path.Combine(raiz, ".staged")),
                  "o estagio foi limpo (senao ele seria aplicado de novo todo boot)");
            Console.WriteLine();
        }

        /// <summary>Um pacote nao pode escrever fora de `engine/` por este caminho.</summary>
        static void RecusaOQueNaoEMotor(string raiz)
        {
            Console.WriteLine("[3] estagio so' pode escrever em engine/");

            Escrever(Path.Combine(raiz, "store", "wallet.json"), "A CARTEIRA DE QUEM JOGA");
            Escrever(Path.Combine(raiz, ".staged", "store", "wallet.json"), "CARTEIRA FORJADA");
            Escrever(Path.Combine(raiz, ".staged", "engine", Estagio.DLL), "MOTOR NOVO");

            Estagio.AplicarPendentes(raiz);

            Checa(Ler(Path.Combine(raiz, "store", "wallet.json")) == "A CARTEIRA DE QUEM JOGA",
                  "a carteira do jogador nao foi tocada");
            Checa(Ler(Path.Combine(raiz, "engine", Estagio.DLL)) == "MOTOR NOVO",
                  "o motor do mesmo pacote foi aplicado assim mesmo");
            Console.WriteLine();
        }

        /// <summary>
        /// A sentinela: uma sobra e' tolerada (o jogo pode ter sido morto pelo
        /// Gerenciador de Tarefas), duas viram quarentena.
        /// </summary>
        static void PrimeiraFalhaEToleradaSegundaReverte(string raiz)
        {
            Console.WriteLine("[4] motor que nao sobe: uma vez passa, duas reverte");

            Escrever(Path.Combine(raiz, "engine", Estagio.DLL), "MOTOR NOVO QUEBRADO");
            Escrever(Path.Combine(raiz, ".staged-bak", "engine", Estagio.DLL), "MOTOR ANTERIOR BOM");

            Estagio.MarcarTentativa(raiz);
            Checa(Estagio.LerTentativas(raiz) == 1, "a tentativa ficou marcada");

            bool reverteu = Estagio.TratarQuebrado(raiz);
            Checa(!reverteu, "a primeira sobra NAO reverte");
            Checa(Ler(Path.Combine(raiz, "engine", Estagio.DLL)) == "MOTOR NOVO QUEBRADO",
                  "o motor continua no lugar depois da primeira");

            Estagio.MarcarTentativa(raiz);
            Checa(Estagio.LerTentativas(raiz) == 2, "a segunda tentativa soma");

            reverteu = Estagio.TratarQuebrado(raiz);
            Checa(reverteu, "a segunda sobra reverte");
            Checa(Ler(Path.Combine(raiz, "engine", Estagio.DLL)) == "MOTOR ANTERIOR BOM",
                  "o motor anterior voltou");
            Checa(Directory.GetDirectories(raiz, "engine.ruim-*").Length == 1,
                  "o motor ruim ficou de castigo (nao foi apagado — da' para investigar)");
            Checa(Estagio.LerTentativas(raiz) == 0,
                  "a sentinela foi limpa (senao o motor bom seria revertido em seguida)");
            Console.WriteLine();
        }

        /// <summary>
        /// Sem anterior guardado, reverter ainda tem de funcionar: o `engine/`
        /// some e o boot cai no motor que veio dentro do executavel.
        /// </summary>
        static void RevertePorCimaSemAnterior(string raiz)
        {
            Console.WriteLine("[5] reverter sem motor anterior no disco");

            Escrever(Path.Combine(raiz, "engine", Estagio.DLL), "MOTOR RUIM");
            bool ok = Estagio.Reverter(raiz, "teste");

            Checa(ok, "reverteu sem estourar");
            Checa(!File.Exists(Estagio.CaminhoDoMotor(raiz)),
                  "nao sobrou motor no disco — o embutido assume");
            Checa(Directory.GetDirectories(raiz, "engine.ruim-*").Length == 1, "o ruim ficou de castigo");
            Console.WriteLine();
        }

        /// <summary>Quarentena antiga nao pode encher o disco de copias do motor.</summary>
        static void QuarentenaNaoAcumula(string raiz)
        {
            Console.WriteLine("[6] a quarentena guarda so' a mais recente");

            for (int i = 0; i < 3; i++)
            {
                Escrever(Path.Combine(raiz, "engine", Estagio.DLL), "MOTOR RUIM " + i);
                Estagio.Reverter(raiz, "teste " + i);
                // Os nomes tem carimbo de SEGUNDOS; sem isto os tres cairiam no
                // mesmo nome e o teste provaria menos do que parece.
                System.Threading.Thread.Sleep(1100);
            }

            var castigo = Directory.GetDirectories(raiz, "engine.ruim-*");
            Checa(castigo.Length == 1, "sobrou 1 pasta de quarentena", "sobraram " + castigo.Length);
            Console.WriteLine();
        }

        /// <summary>
        /// A casca duplica as constantes de caminho do `DuelServer.Payload` —
        /// ela precisa saber onde o jogo mora ANTES de poder olhar dentro do
        /// motor. Duplicata sem guarda envelhece: se as duas discordarem, a casca
        /// procura o motor numa pasta e o motor instala o jogo noutra.
        /// </summary>
        static void ConstantesBatemComOMotor()
        {
            Console.WriteLine("[7] a casca e o motor concordam sobre onde o jogo mora");
            try
            {
                var asm = Assembly.Load(new AssemblyName(Motor.NOME));
                var payload = asm.GetType("DuelServer.Payload", throwOnError: true);

                string pasta = (string)payload.GetField("PASTA").GetRawConstantValue();
                string antiga = (string)payload.GetField("PASTA_ANTIGA").GetRawConstantValue();

                Checa(pasta == Instalacao.PASTA, "a pasta da instalacao e' a mesma",
                      "casca=" + Instalacao.PASTA + " motor=" + pasta);
                Checa(antiga == Instalacao.PASTA_ANTIGA, "a pasta antiga e' a mesma",
                      "casca=" + Instalacao.PASTA_ANTIGA + " motor=" + antiga);
            }
            catch (Exception e)
            {
                Falha("comparar as constantes", e.Message);
            }
            Console.WriteLine();
        }

        // -------------------------------------------------------------- util

        static string Sub(string bancada, string nome)
        {
            string d = Path.Combine(bancada, nome);
            Directory.CreateDirectory(d);
            return d;
        }

        static void Escrever(string caminho, string conteudo)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(caminho));
            File.WriteAllText(caminho, conteudo);
        }

        static string Ler(string caminho)
        {
            try { return File.Exists(caminho) ? File.ReadAllText(caminho) : null; }
            catch { return null; }
        }
    }
}
