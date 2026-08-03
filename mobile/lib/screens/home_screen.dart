import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../config/server_config.dart';
import '../models/card_db.dart';
import 'settings_screen.dart';
import 'adversario_screen.dart';

class HomeScreen extends StatefulWidget {
  final ServerConfig config;
  const HomeScreen({super.key, required this.config});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final CardDb _cardDb = CardDb();
  bool _connecting = false;
  String? _status;

  ApiClient get _api => ApiClient(widget.config);

  Future<void> _abrirAdversario() async {
    if (widget.config.host.trim().isEmpty) {
      final ok = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => SettingsScreen(config: widget.config)),
      );
      if (ok != true) return;
    }
    setState(() {
      _connecting = true;
      _status = null;
    });
    final api = _api;
    final alive = await api.health();
    if (!alive) {
      setState(() {
        _connecting = false;
        _status = 'não alcancei ${widget.config.baseUrl} — confira o IP em Configurações e se o PC está com --lan ligado';
      });
      return;
    }
    try {
      if (!_cardDb.loaded) await _cardDb.load(api);
    } catch (e) {
      setState(() {
        _connecting = false;
        _status = 'conectei, mas não consegui carregar as cartas: $e';
      });
      return;
    }
    setState(() => _connecting = false);
    if (!mounted) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => AdversarioScreen(api: api, cardDb: _cardDb)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('▚ DUEL ACADEMY'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SettingsScreen(config: widget.config)));
              setState(() {});
            },
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.style, size: 64, color: Color(0xFFE8C46A)),
              const SizedBox(height: 16),
              Text(
                widget.config.host.isEmpty ? 'nenhum servidor configurado' : 'servidor: ${widget.config.baseUrl}',
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _connecting ? null : _abrirAdversario,
                icon: _connecting
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.sports_kabaddi),
                label: Text(_connecting ? 'conectando…' : 'Adversário'),
              ),
              if (_status != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(_status!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
