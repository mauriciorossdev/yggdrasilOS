import 'package:app/assistant/assistant_usage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('Haiku turn cost uses per-million prices', () {
    final usd = assistantModelById('claude-haiku-4-5-20251001').costUsd(1000000, 200000);
    expect(usd, closeTo(2.0, 1e-9)); // 1.00 in + 0.20*5.00 out
  });

  test('cache reads bill at 0.1x and writes at 1.25x of the input price', () {
    final usd = assistantModelById('claude-haiku-4-5-20251001')
        .costUsd(0, 0, cacheRead: 1000000, cacheWrite: 1000000);
    expect(usd, closeTo(0.10 + 1.25, 1e-9));
  });

  test('turn totals count cached input and context uses the full prompt', () async {
    final u = AssistantUsage.instance;
    await u.load();
    await u.resetTotals();
    await u.setBudget(null);
    final turn = u.record(3, 20, 'con cache', cacheRead: 4500, cacheWrite: 40);
    expect(turn.totalInput, 4543);
    expect(u.totalIn, 4543);
    expect(u.totalCacheRead, 4500);
    expect(u.lastInput, 4543);
    expect(u.usageForReply('con cache')?.cacheRead, 4500);
  });

  test('models without a known price do not estimate spend', () {
    expect(assistantModelById('claude-sonnet-5-5').costUsd(1000, 1000), isNull);
  });

  test('usage key is stable and text-specific', () {
    expect(usageKeyFor('hola'), usageKeyFor('hola'));
    expect(usageKeyFor('hola'), isNot(usageKeyFor('hola!')));
  });

  test('record accumulates totals, remembers per-reply cost and tracks budget', () async {
    final u = AssistantUsage.instance;
    await u.load();
    await u.resetTotals();
    await u.setBudget(1.0);
    await u.setModel(null);

    final turn = u.record(2000, 500, 'respuesta');
    expect(turn.total, 2500);
    expect(u.totalIn, 2000);
    expect(u.lastInput, 2000);
    expect(u.usageForReply('respuesta')?.outTokens, 500);
    expect(u.usageForReply('otra'), isNull);
    expect(u.remainingUsd, closeTo(1.0 - (2000 * 1.0 + 500 * 5.0) / 1e6, 1e-9));
    expect(u.contextRemaining, 200000 - 2000);
  });
}
