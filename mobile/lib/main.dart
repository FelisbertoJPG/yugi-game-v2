import 'package:flutter/material.dart';
import 'config/server_config.dart';
import 'screens/home_screen.dart';

/// Duel Academy Mobile — cliente fino do MESMO `duel-server` que `web/`
/// usa (nenhuma regra de duelo é reimplementada aqui; ver README.md desta
/// pasta e `duel-server/src/Program.cs` --lan).
void main() {
  runApp(const DuelAcademyApp());
}

class DuelAcademyApp extends StatelessWidget {
  const DuelAcademyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Duel Academy',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0B0E14),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFE8C46A),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: FutureBuilder<ServerConfig>(
        future: ServerConfig.load(),
        builder: (context, snap) {
          if (!snap.hasData) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          return HomeScreen(config: snap.data!);
        },
      ),
    );
  }
}
