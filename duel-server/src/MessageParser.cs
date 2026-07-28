using System;

// Portado de duel_academy/Assets/Scripts/YGO/MessageParser.cs
// Unica mudanca para console app .NET 8: UnityEngine.Debug -> Log.
// Os eventos (Action<...>) sao C# puro e ficam disponiveis para uma futura
// camada de UI/WebSocket assinar; no milestone de terminal ninguem assina.
namespace YGO
{
    public static class MessageParser
    {
        // IDs do EDO9300
        public const byte MSG_RETRY = 1;
        public const byte MSG_HINT = 2;
        public const byte MSG_WAITING = 3;
        public const byte MSG_START = 4;
        public const byte MSG_SELECT_IDLECMD = 11;
        public const byte MSG_NEW_TURN = 40;     // 0x28
        public const byte MSG_NEW_PHASE = 41;    // 0x29
        public const byte MSG_MOVE = 50;         // 0x32
        public const byte MSG_SUMMONING = 60;    // 0x3C
        public const byte MSG_DRAW = 90;         // 0x5A

        // Eventos visuais para a camada de UI assinar!
        public static event Action<int, uint[]> OnCardsDrawn;
        public static event Action<IdleCommandData> OnIdleCommand;
        public static event Action<uint, byte, byte, byte, byte, byte, byte> OnCardMoved;
        public static event Action<int> OnNewPhase;
        public static event Action<int> OnNewTurn;

        public static void Parse(byte[] messageData)
        {
            if (messageData == null || messageData.Length == 0)
                return;

            int offset = 0;

            // O buffer pode conter MULTIPLAS mensagens.
            // A API edo9300 envia o formato: [4 bytes de tamanho] + [N bytes da mensagem]
            while (offset < messageData.Length)
            {
                // Le o tamanho da mensagem atual (4 bytes)
                int msgLen = BitConverter.ToInt32(messageData, offset);
                offset += 4;

                if (msgLen <= 0 || offset + msgLen > messageData.Length)
                    break;

                // O primeiro byte do payload e o Tipo da Mensagem
                byte msgType = messageData[offset];

                switch (msgType)
                {
                    case MSG_NEW_TURN:
                        byte player = messageData[offset + 1];
                        Log.Info($"<color=yellow>[MSG_NEW_TURN]</color> O Turno passou para o Jogador {player}!");
                        OnNewTurn?.Invoke(player);
                        break;

                    case MSG_NEW_PHASE:
                        short phase = BitConverter.ToInt16(messageData, offset + 1);
                        Log.Info($"<color=orange>[MSG_NEW_PHASE]</color> Fase avancou para o ID: {phase}");
                        OnNewPhase?.Invoke(phase);
                        break;

                    case MSG_DRAW:
                        ParseDraw(messageData, offset);
                        break;

                    case MSG_SELECT_IDLECMD:
                        ParseIdleCommand(messageData, offset);
                        break;

                    case MSG_MOVE:
                        ParseMove(messageData, offset);
                        break;

                    case MSG_SUMMONING:
                        ParseSummoning(messageData, offset);
                        break;

                    case MSG_RETRY:
                        // Ignoramos o retry, e so a engine dizendo "Estou esperando sua resposta"
                        break;

                    default:
                        // Logamos os que ainda nao conhecemos
                        // Log.Info($"[MSG DESCONHECIDO] Tipo: {msgType} (Hex: {msgType:X2}) | Tamanho: {msgLen}");
                        break;
                }

                // Avanca o ponteiro para a proxima mensagem dentro do mesmo array
                offset += msgLen;
            }
        }

        // ========================================
        // DRAW
        // ========================================
        private static void ParseDraw(byte[] data, int offset)
        {
            byte p = data[offset + 1];
            byte count = (byte)BitConverter.ToUInt32(data, offset + 2);
            string drawnCards = "";

            // O cabecalho ocupa 6 bytes (1 do tipo + 1 do player + 4 do count)
            int readOffset = offset + 6;
            uint[] drawnIds = new uint[count];

            for (int i = 0; i < count; i++)
            {
                // A nova API usa 8 bytes por carta (4 para ID e 4 para status/posicao)
                uint cardId = BitConverter.ToUInt32(data, readOffset);

                bool isHidden = (cardId & 0x80000000) != 0;
                uint realId = cardId & 0x7FFFFFFF;

                drawnIds[i] = realId;

                if (isHidden) drawnCards += "[Oculta] ";
                else drawnCards += $"[{realId}] ";

                readOffset += 8; // Pula os 8 bytes desta carta
            }
            Log.Info($"<color=lightblue>[MSG_DRAW]</color> Jogador {p} sacou {count} cartas: {drawnCards}");

            // Dispara o evento visual!
            OnCardsDrawn?.Invoke(p, drawnIds);
        }

        // ========================================
        // SELECT IDLE COMMAND (O coracao das regras!)
        // ========================================
        private static void ParseIdleCommand(byte[] data, int offset)
        {
            try
            {
                int pos = offset + 1; // Pula o byte do tipo da mensagem

                IdleCommandData idleData = new IdleCommandData();
                idleData.player = data[pos++];

                // --- Cartas Invocaveis Normalmente ---
                // Na API moderna do edo9300, os contadores sao uint32 (4 bytes)
                int summonCount = (int)BitConverter.ToUInt32(data, pos); pos += 4;
                for (int i = 0; i < summonCount; i++)
                {
                    CardAction action = new CardAction();
                    action.code = BitConverter.ToUInt32(data, pos); pos += 4;
                    action.controller = data[pos++];
                    action.location = data[pos++];
                    action.sequence = (byte)BitConverter.ToUInt32(data, pos); pos += 4;
                    action.index = i;
                    idleData.summonable.Add(action);
                }

                // --- Cartas Special Summonable ---
                int spSummonCount = (int)BitConverter.ToUInt32(data, pos); pos += 4;
                for (int i = 0; i < spSummonCount; i++)
                {
                    CardAction action = new CardAction();
                    action.code = BitConverter.ToUInt32(data, pos); pos += 4;
                    action.controller = data[pos++];
                    action.location = data[pos++];
                    action.sequence = (byte)BitConverter.ToUInt32(data, pos); pos += 4;
                    action.index = i;
                    idleData.spSummonable.Add(action);
                }

                // --- Cartas com posicao alteravel ---
                int posChangeCount = (int)BitConverter.ToUInt32(data, pos); pos += 4;
                for (int i = 0; i < posChangeCount; i++)
                {
                    CardAction action = new CardAction();
                    action.code = BitConverter.ToUInt32(data, pos); pos += 4;
                    action.controller = data[pos++];
                    action.location = data[pos++];
                    action.sequence = (byte)BitConverter.ToUInt32(data, pos); pos += 4;
                    action.index = i;
                    idleData.repositionable.Add(action);
                }

                // --- Cartas Setaveis (virar pra baixo) ---
                int setCount = (int)BitConverter.ToUInt32(data, pos); pos += 4;
                for (int i = 0; i < setCount; i++)
                {
                    CardAction action = new CardAction();
                    action.code = BitConverter.ToUInt32(data, pos); pos += 4;
                    action.controller = data[pos++];
                    action.location = data[pos++];
                    action.sequence = (byte)BitConverter.ToUInt32(data, pos); pos += 4;
                    action.index = i;
                    idleData.settable.Add(action);
                }

                // --- Efeitos Ativaveis ---
                int chainCount = (int)BitConverter.ToUInt32(data, pos); pos += 4;
                for (int i = 0; i < chainCount; i++)
                {
                    CardAction action = new CardAction();
                    action.code = BitConverter.ToUInt32(data, pos); pos += 4;
                    action.controller = data[pos++];
                    action.location = data[pos++];
                    action.sequence = (byte)BitConverter.ToUInt32(data, pos); pos += 4;
                    /* description */ pos += 4; // Pula o uint32 do description
                    action.index = i;
                    idleData.activatable.Add(action);
                }

                // --- Flags de Fase ---
                idleData.canBattlePhase = data[pos++] != 0;
                idleData.canEndPhase = data[pos++] != 0;

                // Log detalhado
                Log.Info($"<color=green>[MSG_SELECT_IDLECMD]</color> Jogador {idleData.player}: " +
                          $"Invocaveis={idleData.summonable.Count}, SpSummon={idleData.spSummonable.Count}, " +
                          $"Set={idleData.settable.Count}, Efeitos={idleData.activatable.Count}, " +
                          $"BattlePhase={idleData.canBattlePhase}, EndPhase={idleData.canEndPhase}");

                // Log das cartas invocaveis para debug
                foreach (var s in idleData.summonable)
                    Log.Info($"  <color=yellow>Invocavel:</color> ID={s.code} loc={s.location} seq={s.sequence}");

                // Dispara o evento!
                OnIdleCommand?.Invoke(idleData);
            }
            catch (System.Exception e)
            {
                Log.Warn($"<color=orange>[ParseIdleCommand]</color> Erro ao parsear: {e.Message}");
            }
        }

        // ========================================
        // MOVE (Carta mudou de lugar)
        // ========================================
        private static void ParseMove(byte[] data, int offset)
        {
            int pos = offset + 1; // Pula o byte do tipo

            uint cardCode = BitConverter.ToUInt32(data, pos); pos += 4;
            uint realCode = cardCode & 0x7FFFFFFF;

            // Posicao anterior
            byte prevController = data[pos++];
            byte prevLocation = data[pos++];
            byte prevSequence = data[pos++];
            byte prevPosition = data[pos++];

            // Posicao atual
            byte currController = data[pos++];
            byte currLocation = data[pos++];
            byte currSequence = data[pos++];
            byte currPosition = data[pos++];
            /* reason */ pos += 4; // Pula 4 bytes do reason

            Log.Info($"<color=magenta>[MSG_MOVE]</color> Carta {realCode}: " +
                      $"[P{prevController} Loc={prevLocation} Seq={prevSequence}] -> " +
                      $"[P{currController} Loc={currLocation} Seq={currSequence}]");

            OnCardMoved?.Invoke(realCode, prevController, prevLocation, prevSequence,
                               currController, currLocation, currSequence);
        }

        // ========================================
        // SUMMONING (Efeito visual de invocacao)
        // ========================================
        private static void ParseSummoning(byte[] data, int offset)
        {
            int pos = offset + 1;
            uint cardCode = BitConverter.ToUInt32(data, pos); pos += 4;
            uint realCode = cardCode & 0x7FFFFFFF;
            Log.Info($"<color=cyan>[MSG_SUMMONING]</color> Invocando carta: {realCode}!");
        }
    }
}
