import 'dart:convert';
import 'package:http/http.dart' as http;
import '../api/api_client.dart';

/// Resumo de uma carta — mesmos campos de `ygo-data/data/cards.index.json`
/// (o índice enxuto que `web/js/ygodb.js` também usa: id/name/t/tl/atk/def/lv).
class CardBrief {
  final int id;
  final String name;
  final String typeLabel;
  final int? atk;
  final int? def;
  final int? level;

  CardBrief({
    required this.id,
    required this.name,
    required this.typeLabel,
    this.atk,
    this.def,
    this.level,
  });

  static CardBrief fromJson(Map<String, dynamic> j) => CardBrief(
        id: j['id'] as int,
        name: j['name'] as String? ?? '${j['id']}',
        typeLabel: j['tl'] as String? ?? '',
        atk: (j['atk'] as num?)?.toInt(),
        def: (j['def'] as num?)?.toInt(),
        level: (j['lv'] as num?)?.toInt(),
      );
}

/// Índice de cartas em memória — carregado uma vez do MESMO servidor
/// (`ygo-data/data/cards.index.json`, ~2 MB, estático, sem restrição de IP).
class CardDb {
  final Map<int, CardBrief> _byId = {};
  bool get loaded => _byId.isNotEmpty;

  Future<void> load(ApiClient api) async {
    final uri = api.staticUri('/ygo-data/data/cards.index.json');
    final r = await http.get(uri).timeout(const Duration(seconds: 30));
    if (r.statusCode != 200) throw Exception('não consegui carregar o índice de cartas (HTTP ${r.statusCode})');
    final List list = jsonDecode(r.body);
    _byId.clear();
    for (final c in list) {
      final b = CardBrief.fromJson(c as Map<String, dynamic>);
      _byId[b.id] = b;
    }
  }

  CardBrief? brief(int id) => _byId[id];
  String nameOf(int id) => _byId[id]?.name ?? '#$id';

  static String artUrl(int id, {bool small = true}) =>
      'https://images.ygoprodeck.com/images/cards${small ? '_small' : ''}/$id.jpg';
}
