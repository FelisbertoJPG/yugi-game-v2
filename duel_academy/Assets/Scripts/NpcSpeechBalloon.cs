using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;

public class NpcSpeechBalloon : MonoBehaviour
{
    [Header("Referências")]
    [SerializeField] private GameObject balloonRoot;
    [SerializeField] private TMP_Text balloonText;

    [Header("Conteúdo")]
    [TextArea(2, 5)]
    [SerializeField] private string message = "Olá. Bem-vindo à Academia de Duelos.";

    [Header("Interação")]
    [SerializeField] private bool hideWhenPlayerLeaves = true;

    private bool playerInRange = false;
    private bool isShowing = false;

    private void Start()
    {
        if (balloonText != null)
        {
            balloonText.text = message;
        }

        if (balloonRoot != null)
        {
            balloonRoot.SetActive(false);
        }
    }

    private void Update()
    {
        if (!playerInRange)
        {
            return;
        }

        if (Keyboard.current != null && Keyboard.current.fKey.wasPressedThisFrame)
        {
            ToggleBalloon();
        }
    }

    private void ToggleBalloon()
    {
        if (balloonRoot == null)
        {
            return;
        }

        isShowing = !isShowing;
        balloonRoot.SetActive(isShowing);

        if (balloonText != null)
        {
            balloonText.text = message;
        }
    }

    private void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag("Player"))
        {
            return;
        }

        playerInRange = true;
    }

    private void OnTriggerExit(Collider other)
    {
        if (!other.CompareTag("Player"))
        {
            return;
        }

        playerInRange = false;

        if (hideWhenPlayerLeaves && balloonRoot != null)
        {
            isShowing = false;
            balloonRoot.SetActive(false);
        }
    }
}