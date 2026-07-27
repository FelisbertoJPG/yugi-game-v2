using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace YGO
{
    /// <summary>
    /// Gerencia a interação visual das cartas na mão (UI).
    /// </summary>
    public class HandCardInteraction : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler, IPointerClickHandler
    {
        public float liftAmount = 50f;
        public float animSpeed = 15f;

        private RectTransform _visualRect;
        private float _targetY = 0f;
        private bool _isSelected = false;
        private bool _isPlayable = false; // O motor diz se ela pode ser jogada

        public static HandCardInteraction SelectedInteraction;

        // Referência ao VisualCard para saber o ID da carta
        private VisualCard _visualCard;

        void Awake()
        {
            _visualCard = GetComponent<VisualCard>();

            // AUTO-FIX: Cria um contêiner visual se não existir
            Transform visual = transform.Find("Visual");
            
            if (visual == null)
            {
                GameObject visualObj = new GameObject("Visual", typeof(RectTransform));
                visualObj.transform.SetParent(this.transform);
                
                _visualRect = visualObj.GetComponent<RectTransform>();
                _visualRect.anchorMin = Vector2.zero;
                _visualRect.anchorMax = Vector2.one;
                _visualRect.sizeDelta = Vector2.zero;
                _visualRect.anchoredPosition = Vector2.zero;
                _visualRect.localScale = Vector3.one;

                Image oldImg = GetComponent<Image>();
                if (oldImg != null)
                {
                    Image newImg = visualObj.AddComponent<Image>();
                    newImg.sprite = oldImg.sprite;
                    newImg.color = oldImg.color;
                    newImg.material = oldImg.material;
                    newImg.raycastTarget = oldImg.raycastTarget;
                    Destroy(oldImg);
                }
            }
            else
            {
                _visualRect = visual.GetComponent<RectTransform>();
            }
        }

        void Update()
        {
            if (_visualRect == null) return;

            float currentY = _visualRect.anchoredPosition.y;
            float newY = Mathf.Lerp(currentY, _targetY, Time.deltaTime * animSpeed);
            _visualRect.anchoredPosition = new Vector2(0, newY);
        }

        /// <summary>
        /// Chamado pelo VisualDuelManager quando o motor informa quais cartas são jogáveis.
        /// </summary>
        public void SetPlayable(bool playable)
        {
            _isPlayable = playable;
            
            // Visual: cartas não-jogáveis ficam escurecidas
            Transform visual = transform.Find("Visual");
            Image img = (visual != null) ? visual.GetComponent<Image>() : GetComponent<Image>();
            if (img != null)
            {
                img.color = playable ? Color.white : new Color(0.5f, 0.5f, 0.5f, 1f);
            }
        }

        /// <summary>
        /// Retorna o ID da carta associada.
        /// </summary>
        public uint GetCardId()
        {
            return _visualCard != null ? _visualCard.cardId : 0;
        }

        public void OnPointerEnter(PointerEventData eventData)
        {
            if (!_isPlayable) return; // Carta não jogável não reage ao hover
            if (SelectedInteraction != null && SelectedInteraction != this) return;
            if (_isSelected) return;
            _targetY = liftAmount;
        }

        public void OnPointerExit(PointerEventData eventData)
        {
            if (_isSelected) return;
            _targetY = 0f;
        }

        public void OnPointerClick(PointerEventData eventData)
        {
            if (!_isPlayable) 
            {
                Debug.Log($"<color=red>[Mão]</color> Carta {gameObject.name} não pode ser jogada agora!");
                return;
            }

            if (SelectedInteraction == this) Deselect();
            else
            {
                if (SelectedInteraction != null) SelectedInteraction.Deselect();
                Select();
            }
        }

        private void Select()
        {
            _isSelected = true;
            SelectedInteraction = this;
            _targetY = liftAmount;
            Debug.Log($"<color=lime>[Mão]</color> Selecionada: <b>{gameObject.name}</b> (Clique no campo para invocar!)");
        }

        public void Deselect()
        {
            _isSelected = false;
            if (SelectedInteraction == this) SelectedInteraction = null;
            _targetY = 0f;
        }
    }
}
