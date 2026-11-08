import 'package:app/standalone/project_handoff.dart';
import 'package:app/standalone/suggestion.dart';
import 'package:flutter_test/flutter_test.dart';

const _suggestion = Suggestion(
  callId: 'c1',
  kind: SuggestionKind.newProject,
  title: 'App de plantas',
  summary: 'Registrar el riego',
  seedContext: 'Quiero saber cuándo regar cada planta.',
);

/// A host that records every call; [failOn] makes one method throw.
class _Host {
  final calls = <String>[];
  final writes = <Map<String, dynamic>>[];
  final uploads = <String, String>{};
  final String? failOn;
  final List<String> paneReads;

  _Host({this.failOn, this.paneReads = const ['claude…', 'claude…', 'claude…']});

  Future<dynamic> rpc(String method, Map<String, dynamic> params) async {
    calls.add(method);
    if (method == failOn) throw Exception('$method failed');
    switch (method) {
      case 'projects.create':
        return {'id': 'proj-app-de-plantas', 'name': params['name']};
      case 'terminals.read':
        final n = calls.where((c) => c == 'terminals.read').length;
        return {'text': paneReads[(n - 1).clamp(0, paneReads.length - 1)]};
      case 'terminals.write':
        writes.add(params);
        return {};
      default:
        return {};
    }
  }

  Future<String> upload(String name, String content) async {
    calls.add('upload');
    if (failOn == 'upload') throw Exception('upload failed');
    uploads[name] = content;
    return '/home/pi/Inbox/chat/$name';
  }
}

Future<HandoffResult> _run(_Host host) => handoffProject(
      rpc: host.rpc,
      upload: host.upload,
      suggestion: _suggestion,
      promptFor: (path) => 'Lee @$path y resume',
      wait: (_) async {},
    );

void main() {
  group('projectNameFor', () {
    test('keeps a normal title', () => expect(projectNameFor('App de plantas'), 'App de plantas'));

    test('drops what hosts reject and tidies spaces and dots', () {
      expect(projectNameFor('  ../mi:app*?  "v2" '), 'mi app v2');
      expect(projectNameFor('...'), 'Proyecto');
      expect(projectNameFor('a\nb\tc'), 'a b c');
    });

    test('is capped at 80 characters', () => expect(projectNameFor('x' * 200).length, 80));
  });

  test('the brief carries title, summary and context', () {
    final brief = projectBrief(_suggestion);
    expect(brief, startsWith('# App de plantas'));
    expect(brief, contains('Registrar el riego'));
    expect(brief, contains('cuándo regar'));
  });

  test('creates the project, uploads the brief and types a prompt pointing to it', () async {
    final host = _Host();
    final result = await _run(host);

    expect(result.projectId, 'proj-app-de-plantas');
    expect(result.briefSent, isTrue);
    expect(host.calls.first, 'projects.create');
    expect(host.calls, containsAllInOrder(['projects.create', 'upload', 'projects.open', 'terminals.read', 'terminals.write']));
    expect(host.uploads['brief.md'], contains('# App de plantas'));
    expect(host.writes.single, {
      'id': 'proj-app-de-plantas',
      'text': 'Lee @/home/pi/Inbox/chat/brief.md y resume',
      'pressEnter': true,
    });
  });

  test('waits for the pane to settle before typing', () async {
    // Output keeps changing, then holds still for two reads in a row.
    final host = _Host(paneReads: ['', 'booting', 'claude', 'claude ready', 'claude ready', 'claude ready']);
    await _run(host);
    expect(host.calls.where((c) => c == 'terminals.read').length, 6);
    expect(host.calls.last, 'terminals.write');
  });

  test('still types after the wait runs out on a pane that never answers', () async {
    final host = _Host(paneReads: ['']);
    final result = await _run(host);
    expect(result.briefSent, isTrue);
    expect(host.calls.where((c) => c == 'terminals.read').length, 25);
    expect(host.writes, hasLength(1));
  });

  test('a failure after creation keeps the project and reports the brief error', () async {
    final host = _Host(failOn: 'upload');
    final result = await _run(host);
    expect(result.projectId, 'proj-app-de-plantas');
    expect(result.briefSent, isFalse);
    expect(result.briefError, contains('upload failed'));
    expect(host.writes, isEmpty);
  });

  test('a failed creation throws, so nothing is marked as created', () async {
    final host = _Host(failOn: 'projects.create');
    await expectLater(_run(host), throwsException);
    expect(host.calls, ['projects.create']);
  });
}
