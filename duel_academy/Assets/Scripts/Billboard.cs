using UnityEngine;

public class Billboard : MonoBehaviour
{
    private Camera mainCamera;

    void Start()
    {
        // Encontra a câmera principal na cena (a câmera deve ter a tag "MainCamera")
        mainCamera = Camera.main;
    }

    // Usamos LateUpdate para garantir que a câmera já tenha se movido neste frame
    // antes de rotacionarmos o nosso objeto (evita stuttering/tremidas)
    void LateUpdate()
    {
        if (mainCamera != null)
        {
            // Faz o objeto olhar para a mesma direção que a câmera está olhando.
            // Isso é o ideal para balões de UI e Sprites em World Space, 
            // pois evita deformações quando o objeto vai pros cantos da tela.
            transform.LookAt(transform.position + mainCamera.transform.forward);
        }
    }
}
