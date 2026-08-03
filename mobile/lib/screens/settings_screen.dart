import 'package:flutter/material.dart';
import '../config/server_config.dart';
import '../api/api_client.dart';

class SettingsScreen extends StatefulWidget {
  final ServerConfig config;
  const SettingsScreen({super.key, required this.config});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _host;
  late final TextEditingController _port;
  String? _status;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _host = TextEditingController(text: widget.config.host);
    _port = TextEditingController(text: widget.config.port.toString());
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _status = null;
    });
    final cfg = ServerConfig(host: _host.text.trim(), port: int.tryParse(_port.text.trim()) ?? ServerConfig.defaultPort);
    final ok = await ApiClient(cfg).health();
    setState(() {
      _testing = false;
      _status = ok ? 'conectado!' : 'não alcancei o servidor';
    });
  }

  Future<void> _save() async {
    widget.config.host = _host.text.trim();
    widget.config.port = int.tryParse(_port.text.trim()) ?? ServerConfig.defaultPort;
    await widget.config.save();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Servidor')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Digite o IP do PC que está rodando o duel-server (rode lá com '
              '--app --lan e leia o IP impresso no console). O celular precisa '
              'estar na MESMA rede Wi-Fi.',
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _host,
              decoration: const InputDecoration(labelText: 'IP do servidor', hintText: '192.168.0.10'),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _port,
              decoration: const InputDecoration(labelText: 'Porta'),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                OutlinedButton(
                  onPressed: _testing ? null : _test,
                  child: Text(_testing ? 'testando…' : 'testar conexão'),
                ),
                const SizedBox(width: 12),
                if (_status != null)
                  Text(_status!, style: TextStyle(color: _status == 'conectado!' ? Colors.greenAccent : Colors.redAccent)),
              ],
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: _save, child: const Text('salvar')),
            ),
          ],
        ),
      ),
    );
  }
}
