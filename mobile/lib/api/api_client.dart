import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/server_config.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

/// Cliente fino do MESMO protocolo RPC que `web/duel.html` já usa
/// (`POST /start`, `POST /respond`) — ver `duel-server/src/WebServer.cs` e a
/// memória `ocgcore-protocolo`. Nenhuma regra de duelo mora aqui: o app só
/// manda a ação e desenha o que o servidor mandar de volta.
///
/// `/__decks` e `/__store` são só LEITURA daqui (GET) — o servidor recusa
/// qualquer escrita (POST) que não venha de localhost, de propósito
/// (StaticServer.cs). Criar/editar deck continua sendo coisa do PC.
class ApiClient {
  final ServerConfig config;
  ApiClient(this.config);

  Uri _uri(String path) => Uri.parse('${config.baseUrl}$path');

  Future<bool> health() async {
    try {
      final r = await http.get(_uri('/health')).timeout(const Duration(seconds: 4));
      return r.statusCode == 200 && r.body.trim() == 'ok';
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> start({
    required List<int> deck,
    List<int>? npcDeck,
    List<int>? extra,
    List<int>? npcExtra,
    int? fieldSpell,
    bool npc = true,
  }) {
    final body = <String, dynamic>{'deck': deck, 'npc': npc};
    if (npcDeck != null && npcDeck.isNotEmpty) body['npcDeck'] = npcDeck;
    if (extra != null && extra.isNotEmpty) body['extra'] = extra;
    if (npcExtra != null && npcExtra.isNotEmpty) body['npcExtra'] = npcExtra;
    if (fieldSpell != null) body['fieldSpell'] = fieldSpell;
    return _post('/start', body);
  }

  Future<Map<String, dynamic>> respond(String action, {int arg = 0, List<int>? args}) {
    final body = <String, dynamic>{'action': action, 'arg': arg};
    if (args != null) body['args'] = args;
    return _post('/respond', body);
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final r = await http
        .post(_uri(path), headers: {'content-type': 'application/json'}, body: jsonEncode(body))
        .timeout(const Duration(seconds: 15));
    if (r.statusCode != 200) throw ApiException('HTTP ${r.statusCode} em $path');
    return jsonDecode(r.body) as Map<String, dynamic>;
  }

  /// GET /__decks/list — devolve [{path, meta, content}], `content` é o
  /// `.ydk` cru (ver `models/ydk.dart` pra extrair main/extra).
  Future<List<Map<String, dynamic>>> listDecks() async {
    final r = await http.get(_uri('/__decks/list')).timeout(const Duration(seconds: 10));
    if (r.statusCode != 200) throw ApiException('HTTP ${r.statusCode} em /__decks/list');
    final j = jsonDecode(r.body) as Map<String, dynamic>;
    return (j['decks'] as List).cast<Map<String, dynamic>>();
  }

  /// GET `/__store/<nome>.json` — null se o arquivo ainda não existe (404).
  Future<dynamic> getStore(String name) async {
    final r = await http.get(_uri('/__store/$name.json')).timeout(const Duration(seconds: 10));
    if (r.statusCode == 404) return null;
    if (r.statusCode != 200) throw ApiException('HTTP ${r.statusCode} em /__store/$name.json');
    return jsonDecode(r.body);
  }

  /// Base pra pedir um arquivo estático servido junto (ygo-data/, etc.).
  Uri staticUri(String path) => _uri(path);
}
