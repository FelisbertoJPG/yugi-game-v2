/// Espelha `web/js/npcs.js`: os 3 NPCs fixos da fase 1 + os customizados
/// (lidos de `/__store/npcs.json`, mesmo arquivo que a Área de Teste grava).
class Npc {
  final String id;
  final String name;
  final String theme;
  final int? signatureId;
  final bool custom;
  final String? campaign;

  Npc({
    required this.id,
    required this.name,
    required this.theme,
    this.signatureId,
    this.custom = false,
    this.campaign,
  });

  /// Os 3 NPCs fixos — mesmos ids/temas de `BASE_NPCS` em `web/js/npcs.js`.
  static final List<Npc> base = [
    Npc(id: 'kaiba', name: 'Seto Kaiba', theme: 'Blue-Eyes', signatureId: 89631139),
    Npc(id: 'joey', name: 'Joey Wheeler', theme: 'Red-Eyes', signatureId: 74677422),
    Npc(id: 'yugi', name: 'Yugi Muto', theme: 'Dark Magician', signatureId: 46986414),
  ];

  static Npc fromJson(Map<String, dynamic> j) => Npc(
        id: j['id'] as String,
        name: j['name'] as String? ?? j['id'] as String,
        theme: j['theme'] as String? ?? '',
        signatureId: (j['signatureId'] as num?)?.toInt(),
        custom: true,
        campaign: j['campaign'] as String?,
      );
}
