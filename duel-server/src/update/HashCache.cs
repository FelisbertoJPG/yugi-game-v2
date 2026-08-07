using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using YGO;

namespace DuelServer.Update
{
    /// <summary>
    /// Cache de sha256 chaveado por <c>(caminho | tamanho | mtime)</c>. Se os três
    /// baterem, o arquivo não mudou e o hash salvo é reusado; só o que mudou é
    /// re-hasheado.
    ///
    /// Sem isto, o custo de abrir o jogo cresce com o TAMANHO TOTAL instalado —
    /// hashear ~50 MB (ou, se um dia listarmos o `ygo-data/data` arquivo a arquivo,
    /// 12.734 arquivos) a cada boot. Com ele, o custo é o do que mudou.
    ///
    /// Persistido como TSV (uma linha por arquivo) porque o formato precisa
    /// sobreviver a ser truncado no meio: uma linha quebrada é uma linha ignorada,
    /// não um arquivo inteiro corrompido — que é o que aconteceria com JSON.
    /// </summary>
    public sealed class HashCache
    {
        readonly string _arquivo;
        readonly Dictionary<string, string> _map = new(StringComparer.Ordinal);
        bool _sujo;

        public HashCache(string arquivo)
        {
            _arquivo = arquivo;
            Carregar();
        }

        static string KeyFor(FileInfo fi) => $"{fi.FullName}|{fi.Length}|{fi.LastWriteTimeUtc.Ticks}";

        /// <summary>sha256 em hex minúsculo. Null se o arquivo não existe.</summary>
        public string Sha256(string path)
        {
            var fi = new FileInfo(path);
            if (!fi.Exists) return null;

            string key = KeyFor(fi);
            if (_map.TryGetValue(key, out var cached)) return cached;

            string hash = Computar(path);
            _map[key] = hash;
            _sujo = true;
            return hash;
        }

        public static string Computar(string path)
        {
            using var s = File.OpenRead(path);
            return Computar(s);
        }

        public static string Computar(Stream s)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(s)).ToLowerInvariant();
        }

        void Carregar()
        {
            try
            {
                if (!File.Exists(_arquivo)) return;
                foreach (var linha in File.ReadLines(_arquivo))
                {
                    int t = linha.LastIndexOf('\t');
                    if (t <= 0) continue;                       // linha truncada: ignora
                    _map[linha.Substring(0, t)] = linha.Substring(t + 1);
                }
            }
            catch (Exception e) { Log.Warn($"cache de hash ilegível ({e.Message}); recomeçando"); }
        }

        public void Salvar()
        {
            if (!_sujo) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_arquivo));
                var sb = new StringBuilder();
                foreach (var kv in _map) sb.Append(kv.Key).Append('\t').Append(kv.Value).Append('\n');
                File.WriteAllText(_arquivo, sb.ToString());
                _sujo = false;
            }
            catch (Exception e) { Log.Warn($"nao consegui salvar o cache de hash: {e.Message}"); }
        }
    }
}
