// Minimal smoke test — replaces the stock `flutter create` counter-app test,
// which referenced widgets (a "0"/"1" counter) this app never had.
//
// Only checks the first frame renders; deliberately doesn't pumpAndSettle()
// past it, since initState kicks off a real WebSocket connection attempt
// (YggdrasilApp._init -> _connect) that has no gateway to reach in a
// test environment and would otherwise hang the test on that async work.

import 'package:flutter_test/flutter_test.dart';

import 'package:app/main.dart';

void main() {
  testWidgets('renders the home header brand label', (WidgetTester tester) async {
    await tester.pumpWidget(const YggdrasilApp());
    await tester.pump();

    // Home header shows the uppercase "YGGDRASIL" brand label (Main.dc.html
    // artboard re-skin) — the app no longer has a plain AppBar title.
    expect(find.text('YGGDRASIL'), findsOneWidget);
  });
}
