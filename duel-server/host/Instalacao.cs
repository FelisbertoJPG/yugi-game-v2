using System;
using System.IO;
using System.Reflection;

namespace ClassicDuels.Casca
{
    /// <summary>
    /// Onde o jogo mora no disco, do ponto de vista da CASCA.
    ///
    /// Estas constantes sao as MESMAS do `DuelServer.Payload` (o motor continua
    /// resolvendo a raiz por conta propria para instalar o conteudo). Estao
    /// duplicadas de proposito: a casca nao pode olhar dentro do motor, porque
    /// ela precisa saber onde ele esta' ANTES de carrega-lo. Mudou de um lado,
    /// mude do outro — `--test-casca` confere que as duas concordam.
    /// </summary>
    internal static class Instalacao
    {
        public const string PASTA = "ClassicDuels";
        public const string PASTA_ANTIGA = "DuelAcademy";

        /// <summary>Recurso embutido pelo `npm run pack`. Sem ele, isto e' um build de desenvolvimento.</summary>
        public const string RecursoPayload = "payload.zip";

        public static Assembly Asm => typeof(Instalacao).Assembly;

        /// <summary>Este executavel foi empacotado (leva o jogo dentro)?</summary>
        public static bool TemPayload
        {
            get
            {
                try { return Asm.GetManifestResourceInfo(RecursoPayload) != null; }
                catch { return false; }
            }
        }

        public static Stream AbrirPayload() => Asm.GetManifestResourceStream(RecursoPayload);

        /// <summary>
        /// A raiz da instalacao (`%LOCALAPPDATA%\ClassicDuels\game`), ja' com a
        /// migracao da pasta com o nome antigo do jogo feita.
        ///
        /// Devolve null em desenvolvimento (sem payload embutido): ali nao existe
        /// instalacao nenhuma, o motor vem de `bin/` e o conteudo, do repositorio.
        ///
        /// A MIGRACAO PRECISA ACONTECER AQUI, e nao mais so' dentro do motor: a
        /// casca cria `ClassicDuels\game` para pousar o motor, e `Directory.Move`
        /// se recusa a mover para um destino que ja' existe. Fazer isto depois
        /// abandonaria os decks e a carteira de quem jogava antes da troca de nome.
        /// </summary>
        /// <summary>
        /// Raiz forcada na mao. Existe para PROVAR o caminho do jogador numa
        /// maquina de desenvolvimento — sem ela, `Resolver` devolve null aqui
        /// (nao ha' payload) e o motor do disco nunca seria exercitado fora de um
        /// `npm run pack`. Tambem serve para investigar uma instalacao alheia.
        /// </summary>
        public const string VarRaiz = "CLASSICDUELS_RAIZ";

        public static string Resolver(bool criar = true)
        {
            string forcada = Environment.GetEnvironmentVariable(VarRaiz);
            if (!string.IsNullOrWhiteSpace(forcada))
            {
                try { if (criar) Directory.CreateDirectory(forcada); } catch { }
                CascaLog.Info("raiz forcada por " + VarRaiz + ": " + forcada);
                return forcada;
            }

            if (!TemPayload) return null;

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Migrar(Path.Combine(local, PASTA_ANTIGA), Path.Combine(local, PASTA));

            string raiz = Path.Combine(local, PASTA, "game");
            if (criar)
            {
                try { Directory.CreateDirectory(raiz); }
                catch (Exception e) { CascaLog.Err($"nao consegui criar {raiz}: {e.Message}"); return null; }
            }
            return raiz;
        }

        /// <summary>
        /// Move a instalacao inteira do nome antigo para o novo. Nunca sobrescreve:
        /// se a pasta nova ja' existe, ela e' a verdade. Falhar nao e' fatal — o
        /// pior caso e' instalar do zero, e nada e' apagado.
        /// </summary>
        public static bool Migrar(string velha, string nova)
        {
            try
            {
                if (string.IsNullOrEmpty(velha) || string.IsNullOrEmpty(nova)) return false;
                if (!Directory.Exists(velha) || Directory.Exists(nova)) return false;

                Directory.CreateDirectory(Path.GetDirectoryName(nova) ?? ".");
                Directory.Move(velha, nova);
                CascaLog.Info($"instalacao antiga migrada: {velha} -> {nova}");
                return true;
            }
            catch (Exception e)
            {
                CascaLog.Warn($"nao consegui migrar a instalacao antiga ({e.Message}) — " +
                              "o jogo vai instalar do zero na pasta nova");
                return false;
            }
        }
    }
}
