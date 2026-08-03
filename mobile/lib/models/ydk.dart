/// Porte em Dart do parser `.ydk` de `web/js/deck.js` (`Deck.fromYdk`) — o
/// mesmo formato do ygopro, com metadados nossos em comentários `#chave valor`.
class ParsedDeck {
  final String name;
  final List<int> main;
  final List<int> extra;
  final int? signatureId;
  final int? coverId;
  final int? rewardDp;

  ParsedDeck({
    required this.name,
    required this.main,
    required this.extra,
    this.signatureId,
    this.coverId,
    this.rewardDp,
  });

  int? get cover => coverId ?? signatureId ?? (main.isNotEmpty ? main.first : (extra.isNotEmpty ? extra.first : null));

  static ParsedDeck fromYdk(String text, {String fallbackName = 'Deck'}) {
    final main = <int>[];
    final extra = <int>[];
    String? zone;
    final meta = <String, String>{};

    for (final raw in text.split(RegExp(r'\r?\n'))) {
      final line = raw.trim();
      if (line.isEmpty) continue;
      if (line.startsWith('#main')) {
        zone = 'main';
        continue;
      }
      if (line.startsWith('#extra')) {
        zone = 'extra';
        continue;
      }
      if (line.startsWith('!side')) {
        zone = null;
        continue;
      }
      if (line.startsWith('#')) {
        final m = RegExp(r'^#([a-zA-Z][\w-]*)\s+(.+)$').firstMatch(line);
        if (m != null) meta[m.group(1)!.toLowerCase()] = m.group(2)!.trim();
        continue;
      }
      if (zone == null) continue;
      final id = int.tryParse(line);
      if (id != null && id > 0) {
        if (zone == 'main') {
          main.add(id);
        } else {
          extra.add(id);
        }
      }
    }

    return ParsedDeck(
      name: meta['name'] ?? fallbackName,
      main: main,
      extra: extra,
      signatureId: int.tryParse(meta['signature'] ?? ''),
      coverId: int.tryParse(meta['cover'] ?? ''),
      rewardDp: int.tryParse(meta['reward'] ?? ''),
    );
  }
}
