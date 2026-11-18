import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

/// The QA gateway lists exactly one project, "ygg-qa-mobile" (a throwaway
/// workspace with README.md, src/hello.ts and notes/todo.md), open on the
/// same gateway — see scripts/mobile-e2e.mjs.
const qaProject = 'ygg-qa-mobile';

Future<void> openQaProject(WidgetTester tester) async {
  await openHome(tester);
  await openDrawer(tester);
  await pumpUntil(tester, find.text(s('common.projects')), reason: 'Proyectos en el menú lateral');
  await tapAndPump(tester, find.text(s('common.projects')));
  await pumpUntil(tester, find.text(qaProject), reason: 'el proyecto de QA en Proyectos');
  await shot('projects-list');
  await tapAndPump(tester, find.text(qaProject));
  await pumpUntil(tester, find.text(s('projects.tabFiles')), reason: 'detalle del proyecto');
  await shot('project-detail');
}

/// Opens a section of the project detail, waits for it to show something
/// other than a spinner, and returns to the detail.
Future<void> visitSection(WidgetTester tester, String labelKey, String shotName, {Finder? expectShown}) async {
  await tapAndPump(tester, find.text(s(labelKey)));
  await pumpFor(tester, const Duration(seconds: 3));
  final end = DateTime.now().add(const Duration(seconds: 15));
  while (find.byType(CircularProgressIndicator).evaluate().isNotEmpty && DateTime.now().isBefore(end)) {
    await pumpFor(tester, const Duration(seconds: 1));
  }
  await shot(shotName);
  expect(find.byType(CircularProgressIndicator), findsNothing, reason: '$labelKey sigue cargando después de 18 s');
  expect(tester.takeException(), isNull);
  if (expectShown != null) expect(expectShown, findsWidgets);
  await goBack(tester);
  await pumpUntil(tester, find.text(s('projects.tabFiles')), reason: 'volver al detalle');
}

void projectsFlow() {
  group('proyectos', () {
    e2eTest('lista el proyecto de QA y abre su detalle', (tester) async {
      await openQaProject(tester);
      for (final key in [
        'projects.tabTerminals',
        'projects.tabSessions',
        'projects.tabAgentFlow',
        'projects.tabWorkflows',
        'projects.tabComplementos',
      ]) {
        expect(find.text(s(key)), findsWidgets, reason: 'sección $key en el detalle');
      }
    });

    e2eTest('Archivos muestra el workspace y abre un archivo', (tester) async {
      await openQaProject(tester);
      await tapAndPump(tester, find.text(s('projects.tabFiles')));
      await pumpUntil(tester, find.text('README.md'), reason: 'fs.list del workspace');
      expect(find.text('src'), findsWidgets);
      expect(find.text('notes'), findsWidgets);
      await shot('files-root');
      await tapAndPump(tester, find.text('README.md'));
      await pumpUntil(
        tester,
        findTextContaining('Proyecto desechable para las pruebas E2E'),
        reason: 'contenido de README.md (fs.read)',
      );
      await shot('file-readme');
    });

    e2eTest('Archivos entra a una carpeta', (tester) async {
      await openQaProject(tester);
      await tapAndPump(tester, find.text(s('projects.tabFiles')));
      await pumpUntil(tester, find.text('src'));
      await tapAndPump(tester, find.text('src'));
      await pumpUntil(tester, find.text('hello.ts'), reason: 'contenido de src/');
      await shot('files-src');
    });

    e2eTest('Terminales responde sin quedarse cargando', (tester) async {
      await openQaProject(tester);
      await visitSection(tester, 'projects.tabTerminals', 'terminals');
    });

    e2eTest('Sesiones responde sin quedarse cargando', (tester) async {
      await openQaProject(tester);
      await visitSection(tester, 'projects.tabSessions', 'sessions');
    });

    e2eTest('Agent Flow responde sin quedarse cargando', (tester) async {
      await openQaProject(tester);
      await visitSection(tester, 'projects.tabAgentFlow', 'agent-flow');
    });

    e2eTest('Workflows responde sin quedarse cargando', (tester) async {
      await openQaProject(tester);
      // The CLI gateway has no workflows plugin: a friendly empty state, not
      // the raw {code: METHOD_NOT_FOUND} map (F-workflows-error-crudo).
      await visitSection(tester, 'projects.tabWorkflows', 'workflows',
          expectShown: find.text(s('projects.workflowsUnsupported')));
    });

    e2eTest('Complementos responde sin quedarse cargando', (tester) async {
      await openQaProject(tester);
      await visitSection(tester, 'projects.tabComplementos', 'complementos');
    });
  });
}
