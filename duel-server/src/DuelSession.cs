using System;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Encapsula um duelo do ocgcore: cria, injeta os baralhos, inicia, e dá um
    /// passo por vez no loop de processo drenando as mensagens do motor. As
    /// mensagens saem pelos eventos estáticos do MessageParser (a UI/servidor
    /// assina). Reaproveita DatabaseManager/ScriptManager/YgoCoreAPI do console.
    /// </summary>
    public sealed class DuelSession : IDisposable
    {
        public const int STATUS_END = 0;
        public const int STATUS_AWAITING = 1;
        public const int STATUS_CONTINUE = 2;

        private IntPtr _duel = IntPtr.Zero;
        private readonly DatabaseManager _db;
        private readonly ScriptManager _sm;

        // Delegates precisam de referência viva enquanto o nativo guarda o ponteiro.
        private readonly OCG_DataReader _cardReader;
        private readonly OCG_ScriptReader _scriptReader;

        public bool Alive => _duel != IntPtr.Zero;

        /// <summary>Ponteiro nativo do duelo (uso interno: harness de diagnóstico).</summary>
        internal IntPtr Handle => _duel;

        /// <summary>Banco de cartas — a IA do NPC consulta ATK/DEF/nível por aqui.</summary>
        public DatabaseManager Cards => _db;

        public DuelSession(string streamingAssets, uint[] deck0, uint[] deck1, ulong seed = 12345, ulong flags = 0)
        {
            _db = new DatabaseManager(streamingAssets);
            _sm = new ScriptManager(streamingAssets);
            _cardReader = _db.CardReaderCallback;
            _scriptReader = _sm.ScriptReaderCallback;

            // O RNG do edo9300 usa 4 seeds (seed0..3). Setar só a seed0 deixa o
            // embaralhamento quase fixo — derivamos as 4 com splitmix64.
            ulong sm = seed;
            ulong Next()
            {
                sm += 0x9E3779B97F4A7C15UL;
                ulong z = sm;
                z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
                z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
                return z ^ (z >> 31);
            }

            var options = new OCG_DuelOptions
            {
                seed0 = Next(),
                seed1 = Next(),
                seed2 = Next(),
                seed3 = Next(),
                flags = flags,
                team1 = new OCG_Player { startingLP = 8000, startingDrawCount = 5, drawCountPerTurn = 1 },
                team2 = new OCG_Player { startingLP = 8000, startingDrawCount = 5, drawCountPerTurn = 1 },
                cardReader = Marshal.GetFunctionPointerForDelegate(_cardReader),
                scriptReader = Marshal.GetFunctionPointerForDelegate(_scriptReader),
                logHandler = IntPtr.Zero,
                cardReaderDone = IntPtr.Zero,
                enableUnsafeLibraries = 0
            };

            int status = YgoCoreAPI.OCG_CreateDuel(out _duel, ref options);
            if (status != 0 || _duel == IntPtr.Zero)
                throw new InvalidOperationException($"OCG_CreateDuel falhou (código {status}).");

            // Pré-carrega os scripts GLOBAIS (a DLL não os pede) — sem eles os
            // efeitos das cartas não se registram (aux/constantes indefinidos).
            _sm.LoadScript(_duel, "constant.lua");
            _sm.LoadScript(_duel, "utility.lua");

            // O ocgcore NÃO embaralha o deck sozinho (a mão sairia sempre igual),
            // então embaralhamos nós, com um RNG derivado da seed.
            var rng = new Random(unchecked((int)seed));
            InjectDeck(team: 0, controller: 0, deck: Shuffle(deck0, rng));
            InjectDeck(team: 1, controller: 1, deck: Shuffle(deck1, rng));
            YgoCoreAPI.OCG_StartDuel(_duel);
        }

        private static uint[] Shuffle(uint[] src, Random rng)
        {
            var a = (uint[])src.Clone();
            for (int i = a.Length - 1; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                (a[i], a[j]) = (a[j], a[i]);
            }
            return a;
        }

        private void InjectDeck(byte team, byte controller, uint[] deck)
        {
            foreach (uint code in deck)
            {
                var card = new OCG_NewCardInfo
                {
                    team = team,
                    duelist = 0,
                    code = code,
                    con = controller,
                    loc = 1, // LOCATION_DECK
                    seq = 0,
                    pos = 8  // POS_FACEDOWN_DEFENSE
                };
                YgoCoreAPI.OCG_DuelNewCard(_duel, ref card);
            }
        }

        /// <summary>
        /// Um passo do motor: processa e drena as mensagens (que disparam os
        /// eventos do MessageParser). Devolve o status (END/AWAITING/CONTINUE).
        /// </summary>
        public int Step()
        {
            if (_duel == IntPtr.Zero) return STATUS_END;
            int status = YgoCoreAPI.OCG_DuelProcess(_duel);

            IntPtr msgPtr = YgoCoreAPI.OCG_DuelGetMessage(_duel, out uint length);
            if (msgPtr != IntPtr.Zero && length > 0)
            {
                byte[] data = new byte[length];
                Marshal.Copy(msgPtr, data, 0, (int)length);
                MessageParser.Parse(data);
            }
            return status;
        }

        /// <summary>Envia uma resposta ao motor (formato depende da pergunta).</summary>
        public void Respond(byte[] response)
        {
            if (_duel == IntPtr.Zero) return;
            YgoCoreAPI.OCG_DuelSetResponse(_duel, response, (uint)response.Length);
        }

        public void Dispose()
        {
            if (_duel != IntPtr.Zero)
            {
                YgoCoreAPI.OCG_DestroyDuel(_duel);
                _duel = IntPtr.Zero;
            }
        }
    }
}
