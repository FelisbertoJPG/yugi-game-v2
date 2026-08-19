using System;
using System.IO;
using System.Runtime.InteropServices;

namespace DuelServer
{
    /// <summary>
    /// De onde saem a `ocgcore` e a `sqlite3` deste processo.
    ///
    /// O .NET aceita UM resolvedor por assembly, e este e' ele. Estava dentro do
    /// `DatabaseManager` (so' para achar a libsqlite3 no Linux), mas dois motivos
    /// o tiraram de la':
    ///
    ///  1. o construtor estatico do `DatabaseManager` so' roda quando alguem
    ///     toca no banco — e a `ocgcore` e' carregada ANTES disso, no
    ///     `OCG_GetVersion` do boot. Quem chegasse primeiro nao seria resolvido;
    ///  2. o motor virou um .dll carregado POR BYTES pela casca
    ///     (`host/Motor.cs`), e um assembly sem caminho em disco nao tem "ao
    ///     lado" onde sondar. A casca diz onde as nativas estao pela variavel
    ///     <see cref="VarPasta"/>, e e' aqui que isso e' usado.
    ///
    /// Devolver Zero nao e' desistir: e' pedir ao runtime que tente do jeito
    /// dele, que e' o que resolve em desenvolvimento (as duas ficam ao lado do
    /// .exe) e no executavel empacotado.
    /// </summary>
    public static class Nativas
    {
        /// <summary>A pasta do motor no disco, informada pela casca. Vazia em desenvolvimento.</summary>
        public const string VarPasta = "CLASSICDUELS_ENGINE_DIR";

        static bool _ligado;
        static readonly object _trava = new();

        public static void Ligar()
        {
            lock (_trava)
            {
                if (_ligado) return;
                _ligado = true;
                try
                {
                    NativeLibrary.SetDllImportResolver(typeof(Nativas).Assembly, Resolver);
                }
                catch (InvalidOperationException)
                {
                    // Alguem ja' registrou um (um host antigo, ou um teste): o
                    // primeiro vale e nao ha' o que fazer aqui.
                }
            }
        }

        static IntPtr Resolver(string nome, System.Reflection.Assembly asm, DllImportSearchPath? busca)
        {
            string pasta = Environment.GetEnvironmentVariable(VarPasta);
            if (!string.IsNullOrWhiteSpace(pasta))
            {
                foreach (var arquivo in Candidatos(nome))
                {
                    string caminho = Path.Combine(pasta, arquivo);
                    if (File.Exists(caminho) && NativeLibrary.TryLoad(caminho, out var h)) return h;
                }
            }

            // A SQLite do Linux pelo nome que uma maquina SEM o pacote de
            // desenvolvimento tem. `DllImport("sqlite3")` procura `libsqlite3.so`
            // (o nome do -dev); sem ele o banco de cartas ficava vazio, o NPC nao
            // enxergava carta nenhuma e 24 testes ficavam vermelhos parecendo bug
            // de regra.
            if (nome == "sqlite3" && RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                foreach (var tentativa in new[] { "libsqlite3.so.0", "libsqlite3.so" })
                    if (NativeLibrary.TryLoad(tentativa, out var h)) return h;
            }

            return IntPtr.Zero;
        }

        static string[] Candidatos(string nome)
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                return new[] { nome + ".dll", nome };
            return new[] { "lib" + nome + ".so", nome + ".so", nome };
        }
    }
}
