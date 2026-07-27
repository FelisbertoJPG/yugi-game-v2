using UnityEngine;
using System.Collections.Generic;

namespace YGO
{
    public class VisualDuelManager : MonoBehaviour
    {
        [Header("Referências")]
        public GameObject cardPrefab;
        public Transform player0HandZone;

        [Header("UI Canvas (Mão 2D)")]
        public GameObject uiCardPrefab;
        public RectTransform uiHandPanel;
        public RectTransform uiOpponentHandPanel;

        [Header("Configurações Visuais")]
        public float handSpacing = 1.2f;

        private List<VisualCard> player0Hand = new List<VisualCard>();
        public IdleCommandData CurrentIdleData { get; private set; }
        public static VisualDuelManager Instance { get; private set; }

        private void Awake()
        {
            Instance = this;
        }

        private void Start()
        {
            if (Camera.main != null)
            {
                // Câmera olhando para o centro do campo (Z=0)
                Camera.main.transform.position = new Vector3(0, 7f, -5f);
                Camera.main.transform.rotation = Quaternion.Euler(50, 0, 0);
                Camera.main.fieldOfView = 50; 
            }

            // Escala das mãos para não tampar o campo
            if (uiHandPanel != null) uiHandPanel.localScale = new Vector3(0.85f, 0.85f, 1f);
            if (uiOpponentHandPanel != null) uiOpponentHandPanel.localScale = new Vector3(0.6f, 0.6f, 1f);
        }

        private void OnEnable()
        {
            MessageParser.OnCardsDrawn += HandleCardsDrawn;
            MessageParser.OnIdleCommand += HandleIdleCommand;
            MessageParser.OnCardMoved += HandleCardMoved;
        }

        private void OnDisable()
        {
            MessageParser.OnCardsDrawn -= HandleCardsDrawn;
            MessageParser.OnIdleCommand -= HandleIdleCommand;
            MessageParser.OnCardMoved -= HandleCardMoved;
        }

        private void HandleCardsDrawn(int player, uint[] cardIds)
        {
            RectTransform targetPanel = (player == 0) ? uiHandPanel : uiOpponentHandPanel;

            if (targetPanel != null && uiCardPrefab != null)
            {
                foreach (uint id in cardIds)
                {
                    GameObject cardObj = Instantiate(uiCardPrefab, targetPanel);
                    VisualCard vc = cardObj.GetComponent<VisualCard>();
                    if (vc == null) vc = cardObj.AddComponent<VisualCard>();
                    
                    vc.Initialize(id);

                    if (player == 0)
                    {
                        if (cardObj.GetComponent<HandCardInteraction>() == null)
                            cardObj.AddComponent<HandCardInteraction>();
                        
                        player0Hand.Add(vc);
                    }
                }
                Debug.Log($"<color=green>[VisualManager]</color> Instanciados {cardIds.Length} Cartas Visuais na Mão do Jogador {player}!");
            }
        }

        private void HandleIdleCommand(IdleCommandData data)
        {
            if (data.player != 0) return;
            CurrentIdleData = data;

            foreach (VisualCard vc in player0Hand)
            {
                HandCardInteraction interaction = vc.GetComponent<HandCardInteraction>();
                if (interaction == null) continue;
                bool canPlay = data.CanNormalSummon(vc.cardId) || data.CanSet(vc.cardId);
                interaction.SetPlayable(canPlay);
            }
        }

        private void HandleCardMoved(uint cardId, byte prevCtrl, byte prevLoc, byte prevSeq,
                                      byte currCtrl, byte currLoc, byte currSeq)
        {
            const byte LOCATION_HAND = 2;
            const byte LOCATION_MZONE = 4;

            if (prevLoc == LOCATION_HAND && currLoc == LOCATION_MZONE)
            {
                VisualCard toRemove = null;
                foreach (VisualCard vc in player0Hand)
                {
                    if (vc.cardId == cardId) { toRemove = vc; break; }
                }

                if (toRemove != null)
                {
                    player0Hand.Remove(toRemove);
                    Destroy(toRemove.gameObject);
                }
                Debug.Log($"<color=cyan>[VisualManager]</color> Carta {cardId} movida para zona {currSeq}!");
            }
        }
    }
}
