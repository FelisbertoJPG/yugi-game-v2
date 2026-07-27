using UnityEngine;
using UnityEditor;
using System.IO;

public class SafeSQLiteSetup : MonoBehaviour
{
    [MenuItem("Yu-Gi-Oh/Instalar APENAS o Mono.Data.Sqlite")]
    public static void ExtrairSQLiteSeguro()
    {
        string editorPath = EditorApplication.applicationContentsPath;
        string monoPath = Path.Combine(editorPath, "MonoBleedingEdge/lib/mono/4.7.1-api");
        
        string file = Path.Combine(monoPath, "Mono.Data.Sqlite.dll");
        string pluginsDir = Path.Combine(Application.dataPath, "Plugins/YGO");
        
        if (!Directory.Exists(pluginsDir))
            Directory.CreateDirectory(pluginsDir);

        if (File.Exists(file))
        {
            File.Copy(file, Path.Combine(pluginsDir, "Mono.Data.Sqlite.dll"), true);
            Debug.Log("<color=green>Mono.Data.Sqlite.dll copiado com sucesso! (Sem causar loop infinito)</color>");
            Debug.Log("<b>Instalação concluída!</b> A Unity vai recarregar agora.");
            AssetDatabase.Refresh();
        }
        else
        {
            Debug.LogError("Não foi possível achar a DLL na pasta da Unity. Avise a IA.");
        }
    }
}
