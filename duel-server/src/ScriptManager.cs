using System;
using System.IO;
using System.Collections.Generic;
using YGO;

// Portado de duel_academy/Assets/Scripts/YGO/ScriptManager.cs
// Mudancas para console app .NET 8:
//   - UnityEngine.Debug   -> Log
//   - Application.streamingAssetsPath -> caminho injetado no construtor
/// <summary>
/// Gerencia a leitura dos arquivos .lua (logica das cartas).
/// </summary>
public class ScriptManager
{
    private string scriptBasePath;
    private Dictionary<string, string> scriptCache = new Dictionary<string, string>();

    public ScriptManager(string streamingAssetsPath)
    {
        scriptBasePath = Path.Combine(streamingAssetsPath, "YGODemo/script");
        Log.Info($"[ScriptManager] Mapeando arquivos em: {scriptBasePath}");

        // Para performance, vamos mapear todos os arquivos lua existentes
        if (Directory.Exists(scriptBasePath))
        {
            string[] allFiles = Directory.GetFiles(scriptBasePath, "*.lua", SearchOption.AllDirectories);
            foreach (var file in allFiles)
            {
                string fileName = Path.GetFileName(file);
                if (!scriptCache.ContainsKey(fileName))
                {
                    scriptCache[fileName] = file;
                }
            }
            Log.Info($"[ScriptManager] {scriptCache.Count} scripts mapeados com sucesso.");
        }
        else
        {
            Log.Err($"[ScriptManager] Pasta nao encontrada: {scriptBasePath}");
        }
    }

    /// <summary>
    /// Carrega explicitamente um script (por nome) no duelo. Usado para os
    /// GLOBAIS (constant.lua, utility.lua) que a DLL NÃO pede pelo callback —
    /// o host precisa pré-carregar, senão `aux`/constantes ficam indefinidos e
    /// os efeitos das cartas falham ao se registrar.
    /// </summary>
    public bool LoadScript(IntPtr duel, string name)
    {
        if (!scriptCache.TryGetValue(name, out string fullPath))
        {
            Log.Warn($"[ScriptManager] global não encontrado: {name}");
            return false;
        }
        try
        {
            byte[] data = File.ReadAllBytes(fullPath);
            int r = YgoCoreAPI.OCG_LoadScript(duel, data, (uint)data.Length, name);
            Log.Info($"[ScriptManager] global carregado: {name} (r={r})");
            return r != 0;
        }
        catch (Exception e)
        {
            Log.Err($"[ScriptManager] erro ao carregar {name}: {e.Message}");
            return false;
        }
    }

    /// <summary>
    /// O callback que a DLL chama quando precisa de um script.
    /// Retorna 1 se o script foi carregado com sucesso, ou 0 se falhar.
    /// </summary>
    public int ScriptReaderCallback(IntPtr payload, IntPtr duel, string name)
    {
        // Se a DLL pediu um caminho relativo completo como "script/c123.lua", pegamos so o nome
        string fileName = Path.GetFileName(name);

        if (scriptCache.TryGetValue(fileName, out string fullPath))
        {
            try
            {
                byte[] scriptData = File.ReadAllBytes(fullPath);

                // Injeta na DLL
                int result = YgoCoreAPI.OCG_LoadScript(duel, scriptData, (uint)scriptData.Length, name);

                Log.Info($"[ScriptManager] Script carregado na DLL: {fileName}");
                return result != 0 ? 1 : 0; // OCG_LoadScript costuma retornar 1 em sucesso
            }
            catch (Exception e)
            {
                Log.Err($"[ScriptManager] Erro ao ler {fullPath}: {e.Message}");
                return 0;
            }
        }
        else
        {
            Log.Warn($"[ScriptManager] Script nao encontrado: {fileName}");
            return 0;
        }
    }
}
