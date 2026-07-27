using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using YGO;

/// <summary>
/// Gerencia a leitura dos arquivos .lua (lógica das cartas).
/// </summary>
public class ScriptManager
{
    private string scriptBasePath;
    private Dictionary<string, string> scriptCache = new Dictionary<string, string>();

    public ScriptManager()
    {
        scriptBasePath = Path.Combine(Application.streamingAssetsPath, "YGODemo/script");
        Debug.Log($"[ScriptManager] Mapeando arquivos em: {scriptBasePath}");

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
            Debug.Log($"[ScriptManager] {scriptCache.Count} scripts mapeados com sucesso.");
        }
        else
        {
            Debug.LogError($"[ScriptManager] Pasta não encontrada: {scriptBasePath}");
        }
    }

    /// <summary>
    /// O callback que a DLL chama quando precisa de um script.
    /// Retorna 1 se o script foi carregado com sucesso, ou 0 se falhar.
    /// </summary>
    public int ScriptReaderCallback(IntPtr payload, IntPtr duel, string name)
    {
        // Se a DLL pediu um caminho relativo completo como "script/c123.lua", pegamos só o nome
        string fileName = Path.GetFileName(name);

        if (scriptCache.TryGetValue(fileName, out string fullPath))
        {
            try
            {
                byte[] scriptData = File.ReadAllBytes(fullPath);
                
                // Injeta na DLL
                int result = YgoCoreAPI.OCG_LoadScript(duel, scriptData, (uint)scriptData.Length, name);
                
                Debug.Log($"[ScriptManager] Script carregado na DLL: {fileName}");
                return result != 0 ? 1 : 0; // OCG_LoadScript costuma retornar 1 em sucesso
            }
            catch (Exception e)
            {
                Debug.LogError($"[ScriptManager] Erro ao ler {fullPath}: {e.Message}");
                return 0;
            }
        }
        else
        {
            Debug.LogWarning($"[ScriptManager] Script não encontrado: {fileName}");
            return 0;
        }
    }
}
