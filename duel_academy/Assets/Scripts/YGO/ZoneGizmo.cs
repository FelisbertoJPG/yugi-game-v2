using UnityEngine;

namespace YGO
{
    /// <summary>
    /// Apenas um script auxiliar para desenhar o quadrado invisível no Scene View da Unity.
    /// Fica em seu próprio arquivo para a Unity não perder a referência.
    /// </summary>
    public class ZoneGizmo : MonoBehaviour
    {
        private void OnDrawGizmos()
        {
            // Muda a cor dependendo do nome
            if (gameObject.name.Contains("Monster")) Gizmos.color = new Color(0.8f, 0.5f, 0.2f, 0.5f); // Laranja
            else if (gameObject.name.Contains("Spell")) Gizmos.color = new Color(0.2f, 0.6f, 0.5f, 0.5f); // Verde-Água
            else if (gameObject.name.Contains("Field")) Gizmos.color = new Color(0.2f, 0.8f, 0.2f, 0.5f); // Verde Claro
            else Gizmos.color = new Color(0.5f, 0.5f, 0.5f, 0.5f); // Cinza (Deck/Cemitério)

            Gizmos.DrawCube(transform.position, new Vector3(1f, 0.05f, 1.4f));
            Gizmos.DrawWireCube(transform.position, new Vector3(1f, 0.05f, 1.4f));
        }
    }
}
