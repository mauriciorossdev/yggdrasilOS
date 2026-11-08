import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:app/chat/interactive_tool_card.dart';
import 'package:app/chat/sync_tool_card.dart';
import 'package:app/theme/ygg_theme.dart';
import 'package:app/ui/ui.dart';

Future<void> _pump(WidgetTester tester, YggPalette palette, Widget child, {double width = 360}) async {
  await YggThemeController.instance.select(palette);
  tester.view.physicalSize = Size(width * 3, 1600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildYggTheme(palette),
      home: Scaffold(body: SingleChildScrollView(padding: const EdgeInsets.all(16), child: child)),
    ),
  );
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final palette in YggPalette.all) {
    group('shared UI in ${palette.id}', () {
      testWidgets('chips, buttons, cards and list rows lay out without errors', (tester) async {
        await _pump(
          tester,
          palette,
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Wrap(spacing: 8, children: [
                YggChip('neutral'),
                YggChip('accent', tone: YggChipTone.accent),
                YggChip('trabajando', tone: YggChipTone.working, dot: true, pulse: true),
                YggChip('verificando', tone: YggChipTone.checking, dot: true),
                YggChip('listo', tone: YggChipTone.ready, dot: true),
                YggChip('falló', tone: YggChipTone.danger, dot: true),
              ]),
              const SizedBox(height: 12),
              Row(children: [
                YggIconButton(icon: Icons.menu, onTap: () {}, tooltip: 'Menú'),
                const SizedBox(width: 8),
                YggIconButton(icon: Icons.mic, onTap: () {}, circle: true, style: YggIconButtonStyle.accent, tooltip: 'Hablar'),
                const SizedBox(width: 8),
                YggIconButton(icon: Icons.attach_file, onTap: null, circle: true, style: YggIconButtonStyle.tint, tooltip: 'Adjuntar'),
              ]),
              const SizedBox(height: 12),
              YggNavButton(icon: Icons.add, label: 'Nuevo chat', primary: true, onTap: () {}),
              const SizedBox(height: 8),
              YggNavButton(icon: Icons.folder_outlined, label: 'Proyectos', dimmed: true, onTap: () {}),
              const SizedBox(height: 12),
              const YggSectionLabel('Personalización'),
              YggListGroup(children: [
                YggListRow(title: 'Idioma', value: 'Español', onTap: () {}),
                YggListRow(title: 'Una fila con un título bastante largo que tiene que envolver sin romper', subtitle: 'Y un subtítulo', onTap: () {}),
                const YggListRow(title: 'Próximamente', leading: Icon(Icons.lock_outline), dimmed: true, trailing: YggChip('pronto')),
                YggListRow(title: 'Conectar', accent: true, leading: const Icon(Icons.add_link), onTap: () {}),
              ]),
              const SizedBox(height: 12),
              const YggHeader(
                eyebrow: 'Chat',
                eyebrowTrailing: YggChip('12k tok', tone: YggChipTone.accent),
                title: 'Un título de chat extremadamente largo que debe truncarse con puntos suspensivos',
                trailing: [Icon(Icons.add)],
              ),
              const YggToolCard(name: 'phone_find_files', detail: 'factura · pdf · descargas recientes', statusLabel: 'trabajando', tone: YggChipTone.working, pulse: true),
            ],
          ),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('Nuevo chat'), findsOneWidget);
        expect(find.text('Idioma'), findsOneWidget);
      });

      testWidgets('every sync and interactive tool state renders', (tester) async {
        await _pump(
          tester,
          palette,
          Column(children: [
            for (final status in ['running', 'ok', 'timeout', 'denied', 'error'])
              SyncToolCard(status: status, toolName: 'phone_open_app', detail: 'Spotify', onRetry: () {}),
            for (final status in ['opening', 'awaitingUser', 'cancelling', 'resolvedOk', 'cancelledByPhone', 'cancelled', 'timedOut', 'disconnected', 'failed'])
              InteractiveToolCard(status: status, toolName: 'phone_pick_file', detail: 'factura.pdf', onCancel: () {}, onRetry: () {}),
          ]),
        );
        expect(tester.takeException(), isNull);
      });

      testWidgets('the theme picker lists every theme and marks the current one', (tester) async {
        await _pump(tester, palette, Builder(builder: (context) => ElevatedButton(onPressed: () => showYggThemePicker(context), child: const Text('abrir'))));
        await tester.tap(find.text('abrir'));
        await tester.pumpAndSettle();
        for (final p in YggPalette.all) {
          expect(find.text(p.name), findsOneWidget);
        }
        expect(find.byIcon(Icons.check), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    });
  }

  testWidgets('choosing a theme in the picker switches the active palette', (tester) async {
    await _pump(tester, YggPalette.yggdrasil, Builder(builder: (context) => ElevatedButton(onPressed: () => showYggThemePicker(context), child: const Text('abrir'))));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Daylight'));
    await tester.pumpAndSettle();
    expect(YggThemeController.instance.palette.id, 'daylight');
  });
}
