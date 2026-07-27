using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace YGO
{
    public class PhaseHUD : MonoBehaviour
    {
        [Header("Referências UI")]
        public TextMeshProUGUI phaseText;
        public Button nextPhaseButton; // O seu "EndTurnButton" agora é o "NextPhaseButton"
        private TextMeshProUGUI _buttonText;

        [Header("Cores das Fases")]
        public Color activePhaseColor = Color.yellow;
        public Color inactivePhaseColor = Color.gray;

        private int _currentPhaseCode = 0;
        private int _currentPlayer = 0;
        private bool _canGoToBP = false;
        private bool _canGoToEP = false;

        void Awake()
        {
            // Tenta achar o texto dentro do botão automaticamente
            if (nextPhaseButton != null)
                _buttonText = nextPhaseButton.GetComponentInChildren<TextMeshProUGUI>();
        }

        void OnEnable()
        {
            MessageParser.OnNewPhase += HandleNewPhase;
            MessageParser.OnNewTurn += HandleNewTurn;
            MessageParser.OnIdleCommand += HandleIdleCommand;
        }

        void OnDisable()
        {
            MessageParser.OnNewPhase -= HandleNewPhase;
            MessageParser.OnNewTurn -= HandleNewTurn;
            MessageParser.OnIdleCommand -= HandleIdleCommand;
        }

        void Start()
        {
            if (nextPhaseButton != null)
            {
                nextPhaseButton.onClick.AddListener(OnNextPhaseClicked);
                nextPhaseButton.interactable = false;
                UpdateButtonText("Aguardando...");
            }
        }

        private void HandleNewPhase(int phaseId)
        {
            _currentPhaseCode = phaseId;
            string name = GetPhaseName(phaseId);
            if (phaseText != null) phaseText.text = name;
            
            // Quando a fase muda, desativamos o botão até o próximo IdleCommand
            if (nextPhaseButton != null) nextPhaseButton.interactable = false;
            
            if (_currentPlayer == 1) UpdateButtonText("Turno do Oponente");
            else UpdateButtonText("Processando...");
        }

        private void HandleNewTurn(int player)
        {
            _currentPlayer = player;
            if (nextPhaseButton != null)
            {
                nextPhaseButton.interactable = false;
                if (player == 1) UpdateButtonText("Turno do Oponente");
                else UpdateButtonText("Seu Turno...");
            }
        }

        private void HandleIdleCommand(IdleCommandData data)
        {
            // O motor só manda IdleCommand para o jogador que tem que agir
            if (data.player != 0) 
            {
                if (nextPhaseButton != null)
                {
                    nextPhaseButton.interactable = false;
                    UpdateButtonText("Turno do Oponente");
                }
                return;
            }

            _canGoToBP = data.canBattlePhase;
            _canGoToEP = data.canEndPhase;

            if (nextPhaseButton != null)
            {
                nextPhaseButton.interactable = true;
                
                // Decide o texto do botão baseado em onde estamos
                if (_canGoToBP) UpdateButtonText("Ir para Battle Phase");
                else if (_canGoToEP) UpdateButtonText("Ir para End Phase");
                else UpdateButtonText("Sua Vez");
            }
        }

        private void OnNextPhaseClicked()
        {
            if (nextPhaseButton != null) nextPhaseButton.interactable = false;

            if (_canGoToBP)
            {
                Debug.Log("[PhaseHUD] Solicitando Battle Phase...");
                DuelManager.Instance?.SendBattlePhaseResponse();
            }
            else if (_canGoToEP)
            {
                Debug.Log("[PhaseHUD] Solicitando End Phase...");
                DuelManager.Instance?.SendEndTurnResponse();
            }
        }

        private void UpdateButtonText(string text)
        {
            if (_buttonText != null) _buttonText.text = text;
        }

        private string GetPhaseName(int id)
        {
            switch (id)
            {
                case 0x01: return "DRAW PHASE";
                case 0x02: return "STANDBY PHASE";
                case 0x04: return "MAIN PHASE 1";
                case 0x80: return "BATTLE PHASE";
                case 0x100: return "MAIN PHASE 2";
                case 0x200: return "END PHASE";
                default: return "FASE ATUAL";
            }
        }
    }
}
