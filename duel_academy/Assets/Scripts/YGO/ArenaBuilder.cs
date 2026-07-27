using UnityEngine;

namespace YGO
{
    /// <summary>
    /// Gera o tabuleiro 3D do duelo (Master Rule 5).
    /// Layout simétrico: centro do campo em Z=0, Player 0 abaixo, Player 1 acima.
    /// </summary>
    public class ArenaBuilder : MonoBehaviour
    {
        [Header("Configurações do Campo")]
        public float cardSpacingX = 1.1f;   // Distância horizontal entre slots
        public float rowSpacingZ  = 1.3f;   // Distância vertical entre fileiras
        public Vector3 slotScale  = new Vector3(0.85f, 1.2f, 1f); // Proporção carta YGO (~59x86mm)

        // Cores semitransparentes para identificar as zonas
        private Color monsterColor   = new Color(0.9f, 0.55f, 0.2f, 0.30f); // Laranja
        private Color spellTrapColor = new Color(0.2f, 0.7f, 0.7f, 0.25f);  // Ciano
        private Color extraMZColor   = new Color(0.3f, 0.5f, 1.0f, 0.30f);  // Azul
        private Color deckColor      = new Color(0.4f, 0.25f, 0.1f, 0.30f); // Marrom
        private Color gyColor        = new Color(0.5f, 0.5f, 0.5f, 0.25f);  // Cinza
        private Color extraDeckColor = new Color(0.6f, 0.2f, 0.7f, 0.25f);  // Roxo
        private Color fieldColor     = new Color(0.2f, 0.8f, 0.3f, 0.20f);  // Verde

        [ContextMenu("Construir Arena 3D")]
        public void BuildArena()
        {
            // Limpa tudo
            for (int i = transform.childCount - 1; i >= 0; i--)
                DestroyImmediate(transform.GetChild(i).gameObject);

            // ============================================================
            //  Cálculo baseado no tamanho real do slot para ZERO sobreposição.
            //  slotScale.y = altura do slot no eixo Z (porque o Quad é rotacionado 90°)
            //
            //  Layout (de baixo pra cima):
            //    P0 Spell → P0 Monster → [gap] → Extra MZ → [gap] → P1 Monster → P1 Spell
            // ============================================================

            float h = slotScale.y;          // Altura de cada slot no campo
            float tightGap = 0.06f;         // Espaço entre Monster e Spell (mesmo lado)
            float centerGap = 0.2f;         // Espaço entre Monster e Extra Monster Zone
            float fieldShift = 0.8f;        // Desloca tudo pra cima pra P0 Spell não ficar sob a mão

            // Centro do campo
            float centerZ = fieldShift;

            // Extra Monster Zones (centro)
            float extraZ = centerZ;

            // P0 Monster: logo abaixo do centro, com folga
            float p0MonsterZ = centerZ - h * 0.5f - centerGap - h * 0.5f;
            // P0 Spell: colado logo abaixo do P0 Monster
            float p0SpellZ = p0MonsterZ - h * 0.5f - tightGap - h * 0.5f;

            // P1 Monster: logo acima do centro, com folga
            float p1MonsterZ = centerZ + h * 0.5f + centerGap + h * 0.5f;
            // P1 Spell: colado logo acima do P1 Monster
            float p1SpellZ = p1MonsterZ + h * 0.5f + tightGap + h * 0.5f;

            // --- PLAYER 0 (VOCÊ) ---
            GameObject p0Root = CreateRoot("Player_0_Zones");
            CreateRow("P0_Monster", 5, p0MonsterZ, monsterColor, p0Root.transform);
            CreateRow("P0_Spell",   5, p0SpellZ,   spellTrapColor, p0Root.transform);

            float sideX = 3.2f * cardSpacingX;
            CreateZone("P0_Deck",      sideX, p0SpellZ,   deckColor,      p0Root.transform);
            CreateZone("P0_GY",        sideX, p0MonsterZ, gyColor,        p0Root.transform);
            CreateZone("P0_ExtraDeck",-sideX, p0SpellZ,   extraDeckColor, p0Root.transform);
            CreateZone("P0_Field",    -sideX, p0MonsterZ, fieldColor,     p0Root.transform);

            // --- EXTRA MONSTER ZONES ---
            CreateZone("ExtraMonster_Left",  -cardSpacingX, extraZ, extraMZColor);
            CreateZone("ExtraMonster_Right",  cardSpacingX, extraZ, extraMZColor);

            // --- PLAYER 1 (OPONENTE) ---
            GameObject p1Root = CreateRoot("Player_1_Zones");
            CreateRow("P1_Monster", 5, p1MonsterZ, monsterColor, p1Root.transform);
            CreateRow("P1_Spell",   5, p1SpellZ,   spellTrapColor, p1Root.transform);

            CreateZone("P1_Deck",     -sideX, p1SpellZ,   deckColor,      p1Root.transform);
            CreateZone("P1_GY",       -sideX, p1MonsterZ, gyColor,        p1Root.transform);
            CreateZone("P1_ExtraDeck", sideX, p1SpellZ,   extraDeckColor, p1Root.transform);
            CreateZone("P1_Field",     sideX, p1MonsterZ, fieldColor,     p1Root.transform);

            Debug.Log("<color=green>Arena construída!</color> Layout sem sobreposições.");
        }

        // ========================================
        //  Helpers
        // ========================================

        private GameObject CreateRoot(string name)
        {
            GameObject root = new GameObject(name);
            root.transform.SetParent(this.transform);
            root.transform.localPosition = Vector3.zero;
            return root;
        }

        private void CreateRow(string prefix, int count, float z, Color color, Transform parent)
        {
            float startX = -(count - 1) * cardSpacingX * 0.5f;
            for (int i = 0; i < count; i++)
            {
                CreateZone($"{prefix}_{i}", startX + i * cardSpacingX, z, color, parent);
            }
        }

        private void CreateZone(string zoneName, float x, float z, Color color, Transform parent = null)
        {
            GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = zoneName;
            quad.transform.SetParent(parent != null ? parent : this.transform);
            quad.transform.localPosition = new Vector3(x, 0.01f, z);
            quad.transform.localRotation = Quaternion.Euler(90, 0, 0);
            quad.transform.localScale = slotScale;

            MeshRenderer mr = quad.GetComponent<MeshRenderer>();
            if (mr != null)
            {
                Material mat = new Material(Shader.Find("Unlit/Color"));
                mat.color = color;
                mr.sharedMaterial = mat;
            }

            // Adiciona FieldZone para interação
            FieldZone fz = quad.AddComponent<FieldZone>();
        }
    }
}
