using UnityEngine;

namespace YGO
{
    /// <summary>
    /// Script anexado a cada slot do campo para detectar cliques e destacar a zona.
    /// </summary>
    public class FieldZone : MonoBehaviour
    {
        private MeshRenderer _renderer;
        private Color _originalColor;
        private bool _isHighlighted = false;

        void Start()
        {
            _renderer = GetComponent<MeshRenderer>();
            if (_renderer != null && _renderer.sharedMaterial != null)
            {
                _originalColor = _renderer.sharedMaterial.color;
            }
        }

        // Chamado pelo DuelInputManager quando o mouse passa por cima
        public void SetHighlight(bool active)
        {
            if (_renderer == null || _isHighlighted == active) return;
            
            _isHighlighted = active;
            
            if (active)
            {
                Color highlightColor = _originalColor;
                highlightColor.a = 0.8f;
                highlightColor.r += 0.25f;
                highlightColor.g += 0.25f;
                highlightColor.b += 0.25f;
                _renderer.material.color = highlightColor;
            }
            else
            {
                _renderer.material.color = _originalColor;
            }
        }

        // Chamado pelo DuelInputManager quando clicamos
        public void OnClick()
        {
            // Verifica se tem uma carta selecionada na mão
            if (HandCardInteraction.SelectedInteraction == null)
            {
                Debug.Log($"<color=cyan>[Campo]</color> Zona {gameObject.name} clicada (nenhuma carta selecionada)");
                return;
            }

            // Verifica se é uma zona de monstro (só monstros vão aqui por enquanto)
            if (!gameObject.name.Contains("Monster"))
            {
                Debug.Log($"<color=yellow>[Campo]</color> Zona {gameObject.name} não é de monstro. Tente uma zona de Monstro!");
                return;
            }

            // Pega o ID da carta selecionada
            uint cardId = HandCardInteraction.SelectedInteraction.GetCardId();
            
            // Consulta o motor: essa carta pode ser invocada?
            var idleData = VisualDuelManager.Instance?.CurrentIdleData;
            if (idleData == null)
            {
                Debug.Log($"<color=red>[Campo]</color> Nenhum comando idle ativo. Espere o motor pausar.");
                return;
            }

            int summonIndex = idleData.GetSummonIndex(cardId);
            if (summonIndex >= 0)
            {
                // INVOCAÇÃO NORMAL!
                Debug.Log($"<color=lime>[INVOCAÇÃO]</color> Invocando carta {cardId} na zona {gameObject.name}!");
                HandCardInteraction.SelectedInteraction.Deselect();
                DuelManager.Instance.SendNormalSummonResponse(summonIndex);
            }
            else
            {
                Debug.Log($"<color=red>[Campo]</color> Carta {cardId} não pode ser invocada normalmente!");
                // Tenta setar
                int setIndex = idleData.GetSetIndex(cardId);
                if (setIndex >= 0)
                {
                    Debug.Log($"<color=yellow>[SET]</color> Setando carta {cardId}!");
                    HandCardInteraction.SelectedInteraction.Deselect();
                    DuelManager.Instance.SendSetResponse(setIndex);
                }
            }
        }
    }
}
