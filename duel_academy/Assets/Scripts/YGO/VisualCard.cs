using UnityEngine;
using UnityEngine.Networking;
using System.Collections;
using UnityEngine.UI;

namespace YGO
{
    /// <summary>
    /// Componente anexado a um Prefab 3D/2D para representar uma carta visual.
    /// </summary>
    public class VisualCard : MonoBehaviour
    {
        public uint cardId;

        public void Initialize(uint id)
        {
            cardId = id;
            gameObject.name = $"Card_{id}";
            
            // Inicia o download da arte da carta!
            StartCoroutine(LoadCardImageRoutine(id));
        }

        private IEnumerator LoadCardImageRoutine(uint id)
        {
            // Puxamos direto da API oficial do YGOPRODeck
            string url = (id == 0) 
                ? "https://images.ygoprodeck.com/images/cards/back_high.jpg" 
                : $"https://images.ygoprodeck.com/images/cards/{id}.jpg";
            
            using (UnityWebRequest uwr = UnityWebRequestTexture.GetTexture(url))
            {
                yield return uwr.SendWebRequest();

                if (uwr.result == UnityWebRequest.Result.Success)
                {
                    // Pega a textura baixada
                    Texture2D tex = DownloadHandlerTexture.GetContent(uwr);
                    
                    // Aplica no Material do Quad (3D) ou na Image da HUD (2D)
                    MeshRenderer renderer = GetComponent<MeshRenderer>();
                    
                    // BUSCA INTELIGENTE: Procura a Image no filho "Visual" primeiro, depois no próprio objeto
                    Transform visualT = transform.Find("Visual");
                    Image uiImage = (visualT != null) ? visualT.GetComponent<Image>() : GetComponent<Image>();

                    if (renderer != null)
                    {
                        // O "Universal Render Pipeline/Unlit" é o shader oficial da URP que não recebe sombras.
                        Shader unlitUrp = Shader.Find("Universal Render Pipeline/Unlit");
                        Material mat;
                        
                        if (unlitUrp != null) {
                            mat = new Material(unlitUrp);
                            mat.SetTexture("_BaseMap", tex);
                        } else {
                            mat = new Material(renderer.material);
                            mat.mainTexture = tex;
                        }
                        
                        renderer.material = mat;
                    }
                    else if (uiImage != null)
                    {
                        // Se for uma carta da HUD (Canvas), cria um Sprite a partir da Textura 2D e aplica
                        uiImage.sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f));
                        // Garante que a cor seja branca para mostrar a imagem corretamente
                        uiImage.color = Color.white;
                    }
                }
                else
                {
                    Debug.LogWarning($"Não foi possível carregar a imagem da carta {id}: {uwr.error}");
                }
            }
        }
    }
}
