using UnityEngine;
using UnityEngine.InputSystem;

public class PlayerInteraction : MonoBehaviour
{       
    [SerializeField] private GameObject speechBalloon;
    private bool interactionEnabled = false;


    // Start is called once before the first execution of Update after the MonoBehaviour is created
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        if (interactionEnabled && Keyboard.current != null && Keyboard.current.fKey.wasPressedThisFrame)
        {
            if (speechBalloon != null)
            {
                speechBalloon.SetActive(true);
            }
        }
    }
    void OnTriggerEnter(Collider other)
    {
        if (other.TryGetComponent<InteractablePoint>(out InteractablePoint interactable))
        {
            interactionEnabled = true;
        }
    }
    void OnTriggerExit(Collider other)
    {
        if (other.TryGetComponent<InteractablePoint>(out InteractablePoint interactable))
        {
            interactionEnabled = false;
            if (speechBalloon != null)
            {
                speechBalloon.SetActive(false);
            }
        }
    }
}
