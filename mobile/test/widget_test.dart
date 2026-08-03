import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:duel_academy_mobile/main.dart';

void main() {
  testWidgets('app boots on the home screen', (tester) async {
    // Sem isto o SharedPreferences.getInstance() nunca resolve no teste
    // (não há canal de plataforma de verdade) e o pumpAndSettle trava.
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const DuelAcademyApp());
    // A tela inicial carrega a config (async) antes de desenhar a Home.
    await tester.pumpAndSettle();
    expect(find.text('▚ DUEL ACADEMY'), findsOneWidget);
    expect(find.text('Adversário'), findsOneWidget);
  });
}
