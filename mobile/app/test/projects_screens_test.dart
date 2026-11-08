import 'dart:convert';

import 'package:app/chat/projects_screen.dart';
import 'package:app/plugins/complementos_tab.dart';
import 'package:app/projects/agent_flow_tab.dart';
import 'package:app/projects/files_browser_view.dart';
import 'package:app/projects/project_detail_screen.dart';
import 'package:app/projects/sessions_tab.dart';
import 'package:app/projects/terminals_tab.dart';
import 'package:app/projects/workflows_tab.dart';
import 'fake_client.dart';
import 'package:app/theme/ygg_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _project = ProjectRecord(id: 'p1', name: 'Default Workspace', path: r'C:\Users\me\AppData\Roaming\@yggdrasil\app-desktop', lastOpenedAt: 0, isOpen: true, gatewayPort: 5000);

Future<void> _pumpScreen(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildYggTheme(), home: Scaffold(body: child)));
  // Fixed steps, not pumpAndSettle: a pulsing status dot animates forever.
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

String _ago(Duration d) => '${DateTime.now().subtract(d).millisecondsSinceEpoch}';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('TerminalsTab', () {
    testWidgets('titles a UUID pane readably and shows its state, path and command', (tester) async {
      final client = FakeClient({
        'terminals.list': (_) => {
              'panes': [
                {'id': 'a', 'title': '0be211c8-83d6-4f36-b905-adc39a000000', 'cwd': r'C:\Users\me\AppData\Roaming\@yggdrasil\app-desktop', 'working': true, 'command': 'claude'},
                {'id': 'b', 'title': 'build watcher', 'cwd': r'D:\proj', 'working': false},
              ],
            },
      });
      await _pumpScreen(tester, TerminalsTab(client: client));
      expect(find.text('Terminal · 0be211c8'), findsOneWidget);
      expect(find.text('build watcher'), findsOneWidget);
      expect(find.text('Trabajando'), findsOneWidget);
      expect(find.text('Corriendo'), findsOneWidget);
      expect(find.text('claude'), findsOneWidget);
      expect(find.text(r'…\@yggdrasil\app-desktop'), findsOneWidget);
    });

    testWidgets('says what is going on when there are none, or the project is closed', (tester) async {
      await _pumpScreen(tester, TerminalsTab(client: FakeClient({'terminals.list': (_) => {'panes': []}})));
      expect(find.text('No hay terminales abiertas.'), findsOneWidget);

      await _pumpScreen(tester, const TerminalsTab(client: null));
      expect(find.textContaining('abierto'), findsWidgets);
    });
  });

  group('SessionsTab', () {
    FakeClient sessions() => FakeClient({
          'projects.sessions.list': (_) => {
                'sessions': [
                  {'sessionKey': 's1', 'title': 'Revisar el PR', 'messageCount': 24, 'updatedAt': int.parse(_ago(const Duration(minutes: 12))), 'lastMessage': {'preview': 'Los tests pasan'}},
                  {'sessionKey': 's2', 'title': '', 'messageCount': 1, 'updatedAt': int.parse(_ago(const Duration(days: 3))), 'lastMessage': {'preview': 'Sin nombre'}},
                  {'sessionKey': 's3', 'title': 'Vieja', 'messageCount': 4, 'updatedAt': int.parse(_ago(const Duration(days: 60)))},
                ],
              },
        });

    testWidgets('groups by date and shows count, preview and a fallback title', (tester) async {
      await _pumpScreen(tester, SessionsTab(client: sessions(), project: _project));
      expect(find.text('HOY'), findsOneWidget);
      expect(find.text('ESTA SEMANA'), findsOneWidget);
      expect(find.text('ANTERIORES'), findsOneWidget);
      expect(find.text('Revisar el PR'), findsOneWidget);
      expect(find.text('Sin título'), findsOneWidget);
      expect(find.text('24 mensajes · hace 12 min'), findsOneWidget);
      expect(find.text('1 mensaje · hace 3 d'), findsOneWidget);
    });

    testWidgets('the search narrows the list', (tester) async {
      await _pumpScreen(tester, SessionsTab(client: sessions(), project: _project));
      await tester.enterText(find.byType(TextField), 'vieja');
      await tester.pumpAndSettle();
      expect(find.text('Vieja'), findsOneWidget);
      expect(find.text('Revisar el PR'), findsNothing);
      await tester.enterText(find.byType(TextField), 'zzz');
      await tester.pumpAndSettle();
      expect(find.text('Ningún proyecto coincide.'), findsOneWidget);
    });
  });

  group('FilesBrowserView', () {
    testWidgets('lists folders before files, breadcrumbs the path and goes up', (tester) async {
      final client = FakeClient({
        'fs.list': (p) => (p['relativePath'] ?? '') == ''
            ? {
                'entries': [
                  {'name': 'zeta.md', 'type': 'file'},
                  {'name': 'notes', 'type': 'directory'},
                  {'name': 'alpha.md', 'type': 'file'},
                  {'name': '.claude', 'type': 'directory'},
                ],
              }
            : {
                'entries': [
                  {'name': 'plan.md', 'type': 'file'},
                ],
              },
      });
      await _pumpScreen(tester, FilesBrowserView(client: client, onOpenFile: (_, _) {}));
      expect(find.text('CARPETAS · 2'), findsOneWidget);
      expect(find.text('ARCHIVOS · 2'), findsOneWidget);
      // Folders first, each group alphabetical.
      final order = ['.claude', 'notes', 'alpha.md', 'zeta.md'].map((n) => tester.getTopLeft(find.text(n)).dy).toList();
      expect(order, [...order]..sort());

      await tester.tap(find.text('notes'));
      await tester.pumpAndSettle();
      expect(find.text('plan.md'), findsOneWidget);
      expect(find.text('›'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Subir un nivel'));
      await tester.pumpAndSettle();
      expect(find.text('CARPETAS · 2'), findsOneWidget);
    });

    testWidgets('an empty folder says so', (tester) async {
      final client = FakeClient({'fs.list': (_) => {'entries': []}});
      await _pumpScreen(tester, FilesBrowserView(client: client, onOpenFile: (_, _) {}));
      expect(find.text('Esta carpeta está vacía.'), findsOneWidget);
    });
  });

  group('WorkflowsTab', () {
    FakeClient workflows(List<String> ran) => FakeClient({
          'workflows.list': (_) => {
                'workflows': [
                  {'workflow': {'id': 'w1', 'name': 'resumen-diario', 'enabled': true, 'settings': {'allowRemoteTrigger': true}}, 'grantStatus': 'granted'},
                  {'workflow': {'id': 'w2', 'name': 'deploy-staging', 'enabled': false, 'settings': {'allowRemoteTrigger': true}}, 'grantStatus': 'pending'},
                ],
              },
          'workflows.runs.list': (p) => {
                'runs': p['workflowId'] == 'w1'
                    ? [
                        {'id': 'r1', 'status': 'succeeded', 'trigger': {'type': 'cron'}, 'startedAt': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String()},
                      ]
                    : [],
              },
          'workflows.run': (p) {
            ran.add(p['id'] as String);
            return {'run': null, 'skipped': true, 'reason': 'test'};
          },
        });

    testWidgets('each card shows permission, state and how it last went', (tester) async {
      await _pumpScreen(tester, WorkflowsTab(client: workflows([])));
      expect(find.text('resumen-diario'), findsOneWidget);
      expect(find.text('permiso concedido'), findsOneWidget);
      expect(find.text('ok'), findsOneWidget);
      expect(find.text('cron · hace 2 h'), findsOneWidget);
      expect(find.text('deploy-staging'), findsOneWidget);
      expect(find.text('permiso pendiente'), findsOneWidget);
      expect(find.text('Sin ejecuciones todavía.'), findsNothing); // the disabled one explains itself instead
      expect(find.textContaining('Habilítalo'), findsOneWidget);
    });

    testWidgets('only an enabled, remotely triggerable workflow can be run', (tester) async {
      final ran = <String>[];
      await _pumpScreen(tester, WorkflowsTab(client: workflows(ran)));
      final buttons = tester.widgetList<FilledButton>(find.byType(FilledButton)).toList();
      expect(buttons.length, 2);
      expect(buttons[0].onPressed, isNotNull);
      expect(buttons[1].onPressed, isNull);

      await tester.tap(find.byType(FilledButton).first);
      await tester.pumpAndSettle();
      expect(ran, ['w1']);
    });
  });

  group('AgentFlowTab', () {
    testWidgets('numbers the agents, shows their harness, connections and saved teams', (tester) async {
      final client = FakeClient({
        'projects.agentFlow.get': (_) => {
              'agentFlow': {
                'name': 'Equipo de revisión',
                'supervisor': {'type': 'yggdrasil'},
                'nodes': [
                  {'name': 'Planificador', 'harness': {'type': 'yggdrasil', 'agentId': 'assistant'}},
                  {'name': 'Desarrollador', 'harness': {'type': 'claude', 'model': 'sonnet'}},
                ],
                'edges': [
                  {'from': 'Planificador', 'to': 'Desarrollador', 'label': 'tarea'},
                ],
              },
            },
        'projects.agentTeams.list': (_) => {
              'teams': [
                {'name': 'Equipo guardado', 'nodes': [{'name': 'Solo', 'harness': {'type': 'claude'}}]},
              ],
            },
      });
      await _pumpScreen(tester, AgentFlowTab(client: client, project: _project));
      expect(find.text('Equipo de revisión'), findsOneWidget);
      expect(find.text('Supervisor · yggdrasil'), findsOneWidget);
      expect(find.text('2 nodos · 1 conexiones'), findsOneWidget);
      expect(find.text('Yggdrasil (assistant)'), findsOneWidget);
      expect(find.text('claude · sonnet'), findsOneWidget);
      expect(find.text('tarea'), findsOneWidget);
      expect(find.text('Equipo guardado'), findsOneWidget);
    });

    testWidgets('no flow and no teams is an empty state', (tester) async {
      final client = FakeClient({
        'projects.agentFlow.get': (_) => {'agentFlow': null},
        'projects.agentTeams.list': (_) => {'teams': []},
      });
      await _pumpScreen(tester, AgentFlowTab(client: client, project: _project));
      expect(find.text('Este proyecto no tiene Agent Flow configurado.'), findsOneWidget);
    });
  });

  group('ComplementosTab', () {
    testWidgets('lists the ones enabled for mobile with their count', (tester) async {
      final client = FakeClient({
        'fs.list': (_) => {
              'entries': [
                {'name': 'kanban', 'type': 'directory'},
                {'name': 'solo-desktop', 'type': 'directory'},
              ],
            },
        'fs.read': (p) {
          final path = p['relativePath'] as String;
          final mobile = path.contains('kanban');
          return {'content': jsonEncode({'id': path.contains('kanban') ? 'kanban' : 'solo-desktop', 'name': mobile ? 'Tablero Kanban' : 'Métricas', 'entry': 'index.html', 'views': mobile ? ['tab', 'mobile'] : ['tab']})};
        },
      });
      await _pumpScreen(tester, ComplementosTab(client: client, project: _project));
      expect(find.text('HABILITADOS PARA MOBILE · 1'), findsOneWidget);
      expect(find.text('Tablero Kanban'), findsOneWidget);
      expect(find.text('Métricas'), findsNothing);
    });
  });

  group('ProjectDetailScreen', () {
    testWidgets('each tile shows its live number', (tester) async {
      final diskAndLive = FakeClient({
        'projects.sessions.list': (_) => {'sessions': List.generate(12, (i) => {'sessionKey': 's$i'})},
        'projects.agentFlow.get': (_) => {
              'agentFlow': {
                'nodes': [{'name': 'a'}, {'name': 'b'}, {'name': 'c'}],
              },
            },
        'terminals.list': (_) => {
              'panes': [
                {'id': 'a', 'title': 't', 'cwd': '', 'working': true},
                {'id': 'b', 'title': 'u', 'cwd': '', 'working': false},
              ],
            },
        'workflows.list': (_) => {'workflows': [{}, {}]},
        'fs.list': (_) => {'entries': []},
      });
      await _pumpScreen(tester, ProjectDetailScreen(client: diskAndLive, projectClient: diskAndLive, project: _project));
      expect(find.text('12 sesiones'), findsOneWidget);
      expect(find.text('3 agentes'), findsOneWidget);
      expect(find.text('1 trabajando'), findsOneWidget);
      expect(find.text('2 workflows'), findsOneWidget);
      expect(find.text('Ninguno en mobile'), findsOneWidget);
      expect(find.text('Navegar el proyecto'), findsOneWidget);
    });

    testWidgets('one idle terminal reads "1 activa", not "1 activas"', (tester) async {
      final client = FakeClient({
        'projects.sessions.list': (_) => {'sessions': []},
        'projects.agentFlow.get': (_) => {'agentFlow': null},
        'terminals.list': (_) => {
              'panes': [
                {'id': 'a', 'title': 't', 'cwd': '', 'working': false},
              ],
            },
        'workflows.list': (_) => {'workflows': []},
        'fs.list': (_) => {'entries': []},
      });
      await _pumpScreen(tester, ProjectDetailScreen(client: client, projectClient: client, project: _project));
      expect(find.text('1 activa'), findsOneWidget);
    });

    testWidgets('a closed project says its live sections need the desktop, and the disk ones still show', (tester) async {
      final disk = FakeClient({
        'projects.sessions.list': (_) => {'sessions': [{'sessionKey': 's1'}]},
        'projects.agentFlow.get': (_) => {'agentFlow': null},
      });
      final closed = ProjectRecord(id: 'p2', name: 'Cerrado', path: r'D:\x', lastOpenedAt: 0);
      await _pumpScreen(tester, ProjectDetailScreen(client: disk, project: closed));
      expect(find.text('1 sesión'), findsOneWidget);
      expect(find.text('Sin configurar'), findsOneWidget);
      expect(find.text('Ábrelo en el escritorio'), findsWidgets);
      expect(find.text('cerrado'), findsOneWidget);
    });

    testWidgets('a number that fails to load leaves the tile on its static line', (tester) async {
      final broken = FakeClient({
        'projects.sessions.list': (_) => throw StateError('boom'),
        'projects.agentFlow.get': (_) => {'agentFlow': null},
      });
      final closed = ProjectRecord(id: 'p2', name: 'Cerrado', path: r'D:\x', lastOpenedAt: 0);
      await _pumpScreen(tester, ProjectDetailScreen(client: broken, project: closed));
      expect(find.textContaining('sesion'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('ProjectsScreen', () {
    FakeClient projects() => FakeClient({
          'projects.list': (_) => {
                'projects': [
                  {'id': '1', 'name': 'Default Workspace', 'path': r'C:\a\b\c\d\e\f\g\h\i\j\k\app-desktop', 'lastOpenedAt': DateTime.now().millisecondsSinceEpoch, 'isOpen': true, 'gatewayPort': 5000},
                  {'id': '2', 'name': 'voxel-rs', 'path': r'D:\godot games\voxel editor\voxel-rs', 'lastOpenedAt': DateTime.now().subtract(const Duration(days: 1)).millisecondsSinceEpoch},
                  {'id': '3', 'name': 'open-gym', 'path': r'D:\side\open-gym', 'lastOpenedAt': DateTime.now().subtract(const Duration(days: 3)).millisecondsSinceEpoch},
                ],
              },
        });

    testWidgets('highlights the open project and lists the rest with when they were opened', (tester) async {
      await _pumpScreen(tester, ProjectsScreen(client: projects()));
      expect(find.text('ABIERTO EN EL ESCRITORIO'), findsOneWidget);
      expect(find.text('abierto'), findsOneWidget);
      expect(find.text('TODOS LOS PROYECTOS · 2'), findsOneWidget);
      expect(find.text('voxel-rs'), findsOneWidget);
      expect(find.text('ayer'), findsOneWidget);
      expect(find.text('hace 3 d'), findsOneWidget);
      expect(find.text(r'…\app-desktop'), findsNothing); // 2 segments of a long path
      expect(find.byType(FloatingActionButton), findsOneWidget);
    });

    testWidgets('the search filters by name or path', (tester) async {
      await _pumpScreen(tester, ProjectsScreen(client: projects()));
      await tester.enterText(find.byType(TextField), 'gym');
      await tester.pumpAndSettle();
      expect(find.text('open-gym'), findsOneWidget);
      expect(find.text('voxel-rs'), findsNothing);
      expect(find.text('Default Workspace'), findsNothing);
    });
  });
}
