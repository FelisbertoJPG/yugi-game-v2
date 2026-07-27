using UnityEngine;
using UnityEngine.InputSystem; // Adicionado para o novo sistema

namespace YGO
{
    public class DuelInputManager : MonoBehaviour
    {
        private FieldZone _lastHoveredZone;

        void Start()
        {
            Debug.Log("<color=yellow>[InputManager]</color> Iniciado usando o NOVO Input System!");
            if (Camera.main == null) Debug.LogError("ERRO: Nenhuma câmera com a Tag 'MainCamera' foi encontrada!");
        }

        void Update()
        {
            HandleFieldSelection();
        }

        private void HandleFieldSelection()
        {
            if (Camera.main == null) return;

            // No novo sistema, pegamos a posição assim:
            Vector2 mousePos = Mouse.current.position.ReadValue();
            
            Ray ray = Camera.main.ScreenPointToRay(mousePos);
            RaycastHit hit;

            // Laser para depuração
            Debug.DrawRay(ray.origin, ray.direction * 50, Color.red);

            if (Physics.Raycast(ray, out hit, 100f))
            {
                FieldZone zone = hit.collider.GetComponent<FieldZone>();

                if (zone != null)
                {
                    if (_lastHoveredZone != zone)
                    {
                        if (_lastHoveredZone != null) _lastHoveredZone.SetHighlight(false);
                        _lastHoveredZone = zone;
                        _lastHoveredZone.SetHighlight(true);
                    }

                    // No novo sistema, verificamos o clique assim:
                    if (Mouse.current.leftButton.wasPressedThisFrame)
                    {
                        zone.OnClick();
                    }
                }
                else
                {
                    ClearHighlight();
                }
            }
            else
            {
                ClearHighlight();
            }
        }

        private void ClearHighlight()
        {
            if (_lastHoveredZone != null)
            {
                _lastHoveredZone.SetHighlight(false);
                _lastHoveredZone = null;
            }
        }
    }
}
