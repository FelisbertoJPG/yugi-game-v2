using System;
using System.Runtime.InteropServices;
using UnityEngine;
using YGO;

public class DuelManager : MonoBehaviour
{
    public static DuelManager Instance { get; private set; }
    
    private IntPtr duelInstance = IntPtr.Zero;

    // Instâncias das nossas classes reais
    private DatabaseManager dbManager;
    private ScriptManager scriptManager;

    // Delegates (precisam ficar vivos para o GC não coletar)
    private OCG_DataReader realCardReader;
    private OCG_ScriptReader realScriptReader;

    void Start()
    {
        Instance = this;
        Debug.Log("Inicializando ygopro-core (edo9300)...");

        try
        {
            dbManager = new DatabaseManager();
            scriptManager = new ScriptManager();

            // Instanciar os callbacks reais
            realCardReader = dbManager.CardReaderCallback;
            realScriptReader = scriptManager.ScriptReaderCallback;

            // O novo padrão exige definir as opções do duelo num struct antes de criar
            OCG_DuelOptions options = new OCG_DuelOptions
            {
                seed0 = 12345, // Seed aleatória
                flags = 0,
                team1 = new OCG_Player { startingLP = 8000, startingDrawCount = 5, drawCountPerTurn = 1 },
                team2 = new OCG_Player { startingLP = 8000, startingDrawCount = 5, drawCountPerTurn = 1 },
                cardReader = Marshal.GetFunctionPointerForDelegate(realCardReader),
                scriptReader = Marshal.GetFunctionPointerForDelegate(realScriptReader),
                logHandler = IntPtr.Zero,
                cardReaderDone = IntPtr.Zero,
                enableUnsafeLibraries = 0
            };

            // 1. Criar o duelo no backend nativo
            int status = YgoCoreAPI.OCG_CreateDuel(out duelInstance, ref options);

            if (status == 0 && duelInstance != IntPtr.Zero)
            {
                Debug.Log($"<color=green>Sucesso ABSOLUTO!</color> Duelo criado no ponteiro: {duelInstance}");
                
                // --- INJEÇÃO DOS BARALHOS (FASE 3 / PASSO 4.1) ---
                // Vamos usar um deck misto para ver IDs variados no saque!
                uint[] mixedDeck = new uint[] { 
                    89631139, // Dragão Branco
                    46986414, // Mago Negro
                    83764718, // Monstro Renascido (Monster Reborn)
                    70903634  // Força Espelho (Mirror Force)
                };

                // Injetar 40 cartas no Deck (loc=1) do Jogador 0
                for (int i = 0; i < 40; i++)
                {
                    OCG_NewCardInfo cardInfo = new OCG_NewCardInfo
                    {
                        team = 0,
                        duelist = 0,
                        code = mixedDeck[i % mixedDeck.Length], 
                        con = 0,
                        loc = 1, // LOCATION_DECK
                        seq = 0,
                        pos = 8  // POS_FACEDOWN_DEFENSE
                    };
                    YgoCoreAPI.OCG_DuelNewCard(duelInstance, ref cardInfo);
                }

                // Injetar 40 cartas no Deck do Jogador 1
                for (int i = 0; i < 40; i++)
                {
                    OCG_NewCardInfo cardInfo = new OCG_NewCardInfo
                    {
                        team = 1,
                        duelist = 0, // Corrigido: Para 1v1, o duelista do time 1 é o 0
                        code = mixedDeck[i % mixedDeck.Length],
                        con = 1,
                        loc = 1, // LOCATION_DECK
                        seq = 0,
                        pos = 8  // POS_FACEDOWN_DEFENSE
                    };
                    YgoCoreAPI.OCG_DuelNewCard(duelInstance, ref cardInfo);
                }
                Debug.Log("Baralhos Mistos de Teste injetados com sucesso!");
                // -------------------------------------

                // 2. Iniciar o duelo
                YgoCoreAPI.OCG_StartDuel(duelInstance);
                Debug.Log("Duelo Iniciado com a nova API. A máquina de estados vai começar!");
            }
            else
            {
                Debug.LogError($"Falha ao criar o duelo. Código de erro: {status}");
            }
        }
        catch (DllNotFoundException e)
        {
            Debug.LogError($"<color=red>DLL NÃO ENCONTRADA!</color>\nErro: {e.Message}");
        }
        catch (Exception e)
        {
            Debug.LogError($"Erro genérico ao tentar falar com o core: {e.Message}");
        }
    }

    void Update()
    {
        // Se o duelo não foi instanciado ainda, não faz nada
        if (duelInstance == IntPtr.Zero)
            return;

        // Avisa a DLL para processar um "passo" da lógica do jogo
        int processStatus = YgoCoreAPI.OCG_DuelProcess(duelInstance);

        // Busca a mensagem de estado que a DLL gerou neste frame
        uint length = 0;
        IntPtr msgPtr = YgoCoreAPI.OCG_DuelGetMessage(duelInstance, out length);
        
        // Se existe uma mensagem (comprimento > 0)
        if (msgPtr != IntPtr.Zero && length > 0)
        {
            // Puxa os dados da memória nativa do C++ para o array C#
            byte[] messageData = new byte[length];
            Marshal.Copy(msgPtr, messageData, 0, (int)length);

            // Manda para o tradutor!
            MessageParser.Parse(messageData);
        }
    }

    void OnDestroy()
    {
        if (duelInstance != IntPtr.Zero)
        {
            YgoCoreAPI.OCG_DestroyDuel(duelInstance);
            Debug.Log("Duelo finalizado e memória limpa via API moderna.");
        }
    }

    // ========================================
    // RESPOSTAS AO MOTOR
    // ========================================

    /// <summary>
    /// Envia uma resposta de Invocação Normal ao motor.
    /// O formato é: [tipo_ação (int32)] + [índice (int32)]
    /// Tipo 0 = Normal Summon
    /// </summary>
    public void SendNormalSummonResponse(int summonIndex)
    {
        if (duelInstance == IntPtr.Zero) return;
        
        byte[] response = new byte[8];
        BitConverter.GetBytes(0).CopyTo(response, 0);  // Tipo 0 = Normal Summon
        BitConverter.GetBytes(summonIndex).CopyTo(response, 4);
        
        YgoCoreAPI.OCG_DuelSetResponse(duelInstance, response, (uint)response.Length);
        Debug.Log($"<color=lime>[Resposta]</color> Enviada Invocação Normal (índice {summonIndex})");
    }

    /// <summary>
    /// Envia uma resposta de Setar carta ao motor.
    /// Tipo 4 = Set Monster
    /// </summary>
    public void SendSetResponse(int setIndex)
    {
        if (duelInstance == IntPtr.Zero) return;
        
        byte[] response = new byte[8];
        BitConverter.GetBytes(3).CopyTo(response, 0);  // Tipo 3 = Set
        BitConverter.GetBytes(setIndex).CopyTo(response, 4);
        
        YgoCoreAPI.OCG_DuelSetResponse(duelInstance, response, (uint)response.Length);
        Debug.Log($"<color=lime>[Resposta]</color> Enviada ação Set (índice {setIndex})");
    }

    /// <summary>
    /// Envia uma resposta para entrar na Battle Phase ao motor.
    /// Tipo 5 = Battle Phase
    /// </summary>
    public void SendBattlePhaseResponse()
    {
        if (duelInstance == IntPtr.Zero) return;
        
        byte[] response = new byte[8];
        BitConverter.GetBytes(5).CopyTo(response, 0);  // Tipo 5 = To Battle Phase
        BitConverter.GetBytes(0).CopyTo(response, 4);
        
        YgoCoreAPI.OCG_DuelSetResponse(duelInstance, response, (uint)response.Length);
        Debug.Log("<color=orange>[Resposta]</color> Entrando na Battle Phase!");
    }

    /// <summary>
    /// Envia uma resposta de Fim de Turno ao motor.
    /// Tipo 6 = End Phase
    /// </summary>
    public void SendEndTurnResponse()
    {
        if (duelInstance == IntPtr.Zero) return;
        
        byte[] response = new byte[8];
        BitConverter.GetBytes(6).CopyTo(response, 0);  // Tipo 6 = End Turn
        BitConverter.GetBytes(0).CopyTo(response, 4);
        
        YgoCoreAPI.OCG_DuelSetResponse(duelInstance, response, (uint)response.Length);
        Debug.Log($"<color=lime>[Resposta]</color> Enviado Fim de Turno");
    }
}
