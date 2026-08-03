import 'package:shared_preferences/shared_preferences.dart';

/// Onde o duel-server (o MESMO servidor que o web/ usa) está escutando.
/// Persiste no aparelho — sem isso o usuário digitaria o IP toda vez.
///
/// Pré-requisito no PC: rodar `duel-academy.exe --app --lan` (ou
/// `duel-server --serve --lan` em dev) — sem `--lan` o servidor só aceita
/// localhost e o celular nunca alcança. Ver duel-server/src/Program.cs.
class ServerConfig {
  static const _keyHost = 'server_host';
  static const _keyPort = 'server_port';
  static const defaultPort = 8770;

  String host;
  int port;

  ServerConfig({required this.host, required this.port});

  String get baseUrl => 'http://$host:$port';

  static Future<ServerConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    return ServerConfig(
      host: prefs.getString(_keyHost) ?? '',
      port: prefs.getInt(_keyPort) ?? defaultPort,
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyHost, host);
    await prefs.setInt(_keyPort, port);
  }
}
