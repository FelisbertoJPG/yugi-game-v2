import '../models/npc.dart';
import '../models/ydk.dart';
import 'api_client.dart';

/// Um deck salvo, já resolvido: de onde veio (path) + o `.ydk` interpretado.
class SavedDeck {
  final String path;
  final ParsedDeck deck;
  SavedDeck(this.path, this.deck);
}

/// Junta NPCs (fixos + customizados) e decks salvos — tudo por LEITURA
/// (GET), que é o que o servidor libera de qualquer IP na rede. Espelha o
/// que `web/js/npcs.js`/`web/js/storage.js` fazem no navegador.
class GameRepository {
  final ApiClient api;
  GameRepository(this.api);

  List<Npc>? _npcs;
  List<SavedDeck>? _allDecks;

  Future<List<Npc>> loadNpcs({bool force = false}) async {
    if (_npcs != null && !force) return _npcs!;

    final list = <Npc>[];
    // NPCs fixos, com campanha do overlay (store/npc-base-meta.json), se houver.
    Map<String, dynamic>? baseMeta;
    try {
      baseMeta = await api.getStore('npc-base-meta') as Map<String, dynamic>?;
    } catch (_) {
      baseMeta = null;
    }
    for (final n in Npc.base) {
      final m = baseMeta?[n.id] as Map<String, dynamic>?;
      list.add(Npc(id: n.id, name: n.name, theme: n.theme, signatureId: n.signatureId, campaign: m?['campaign'] as String?));
    }

    // Customizados (store/npcs.json).
    try {
      final custom = await api.getStore('npcs');
      if (custom is List) {
        for (final c in custom) {
          list.add(Npc.fromJson(Map<String, dynamic>.from(c as Map)));
        }
      }
    } catch (_) {
      // sem servidor/arquivo: segue só com os fixos
    }

    _npcs = list;
    return list;
  }

  Future<List<SavedDeck>> _loadAllDecks({bool force = false}) async {
    if (_allDecks != null && !force) return _allDecks!;
    final raw = await api.listDecks();
    _allDecks = raw
        .map((d) => SavedDeck(d['path'] as String, ParsedDeck.fromYdk(d['content'] as String? ?? '')))
        .toList();
    return _allDecks!;
  }

  /// Decks do jogador (decks/player/*.ydk).
  Future<List<SavedDeck>> playerDecks({bool force = false}) async {
    final all = await _loadAllDecks(force: force);
    return all.where((d) => d.path.startsWith('player/')).toList();
  }

  /// Decks de UM NPC (`decks/npc/<id>/*.ydk`) — prefere o primeiro que bate
  /// com as regras oficiais (40–60 no Main); sem nenhum válido, pega
  /// qualquer um (melhor um deck "incompleto" do que nenhum).
  Future<SavedDeck?> npcDeck(String npcId, {bool force = false}) async {
    final all = await _loadAllDecks(force: force);
    final mine = all.where((d) => d.path.startsWith('npc/$npcId/')).toList();
    if (mine.isEmpty) return null;
    for (final d in mine) {
      if (d.deck.main.length >= 40 && d.deck.main.length <= 60) return d;
    }
    return mine.first;
  }
}
