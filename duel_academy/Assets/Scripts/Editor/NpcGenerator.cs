using UnityEngine;
using UnityEditor;
using TMPro;

public class NpcGenerator : EditorWindow
{
    [MenuItem("GameObject/Custom/Generate NPC Structure", false, 10)]
    public static void GenerateNPC()
    {
        // 1. Root NPC
        GameObject npcRoot = new GameObject("Npc");

        // 2. Body
        GameObject body = new GameObject("Body");
        body.transform.SetParent(npcRoot.transform);

        // 3. InteractionTrigger
        GameObject interactionTrigger = new GameObject("InteractionTrigger");
        interactionTrigger.transform.SetParent(npcRoot.transform);
        SphereCollider collider = interactionTrigger.AddComponent<SphereCollider>();
        collider.isTrigger = true;
        collider.radius = 2f;
        // Adiciona o script InteractablePoint que você já usa no PlayerInteraction
        interactionTrigger.AddComponent<InteractablePoint>();

        // 4. SpeechBalloon root
        GameObject speechBalloon = new GameObject("SpeechBalloon");
        speechBalloon.transform.SetParent(npcRoot.transform);
        speechBalloon.SetActive(false); // Inicia desativado como padrão

        // 5. Canvas
        GameObject canvasObj = new GameObject("Canvas");
        canvasObj.transform.SetParent(speechBalloon.transform);
        Canvas canvas = canvasObj.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.WorldSpace;
        
        RectTransform canvasRect = canvasObj.GetComponent<RectTransform>();
        canvasRect.sizeDelta = new Vector2(2, 1); // Tamanho pequeno para o WorldSpace
        canvasObj.AddComponent<UnityEngine.UI.CanvasScaler>();
        canvasObj.AddComponent<UnityEngine.UI.GraphicRaycaster>();

        // 6. Panel
        GameObject panelObj = new GameObject("Panel");
        panelObj.transform.SetParent(canvasObj.transform, false);
        UnityEngine.UI.Image panelImage = panelObj.AddComponent<UnityEngine.UI.Image>();
        panelImage.color = new Color(1f, 1f, 1f, 0.8f);
        
        RectTransform panelRect = panelObj.GetComponent<RectTransform>();
        panelRect.anchorMin = Vector2.zero;
        panelRect.anchorMax = Vector2.one;
        panelRect.sizeDelta = Vector2.zero;
        panelRect.anchoredPosition = Vector2.zero;

        // 7. Text (TMP)
        GameObject textObj = new GameObject("Text (TMP)");
        textObj.transform.SetParent(panelObj.transform, false);
        TextMeshProUGUI textTmp = textObj.AddComponent<TextMeshProUGUI>();
        textTmp.text = "Hello!";
        textTmp.color = Color.black;
        textTmp.alignment = TextAlignmentOptions.Center;
        
        RectTransform textRect = textObj.GetComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.sizeDelta = new Vector2(-0.2f, -0.2f); // Padding

        // Posição padrão do SpeechBalloon pra ficar acima da "cabeça" do NPC
        speechBalloon.transform.localPosition = new Vector3(0, 2f, 0);

        // Seleciona o recém-criado na Hierarchy p/ facilitar
        Undo.RegisterCreatedObjectUndo(npcRoot, "Created NPC Structure");
        Selection.activeGameObject = npcRoot;
    }
}
