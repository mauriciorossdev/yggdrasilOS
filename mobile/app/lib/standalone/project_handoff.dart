import 'suggestion.dart';

/// One call to the host: the term-bridge's JSON-RPC, abstracted so the hand-off
/// can be tested without a socket.
typedef HostRpc = Future<dynamic> Function(String method, Map<String, dynamic> params);

/// Uploads text to the host and returns the path it was saved at.
typedef HostUpload = Future<String> Function(String name, String content);

class HandoffResult {
  final String projectId;
  final String projectName;

  /// Null when the brief reached the project's Claude session; otherwise why it
  /// didn't (the project exists either way).
  final String? briefError;

  const HandoffResult({required this.projectId, required this.projectName, this.briefError});

  bool get briefSent => briefError == null;
}

/// A project name the hosts accept: the desktop rejects `\/:*?"<>|`, control
/// characters, names over 80 characters and leading or trailing dots.
String projectNameFor(String title) {
  var name = title.replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (name.length > 80) name = name.substring(0, 80).trim();
  name = name.replaceAll(RegExp(r'^\.+|\.+$'), '').trim();
  return name.isEmpty ? 'Proyecto' : name;
}

/// The context the new project's Claude starts from, as a markdown file.
String projectBrief(Suggestion s) {
  final b = StringBuffer('# ${s.title}\n');
  if (s.summary.isNotEmpty) b.write('\n${s.summary}\n');
  if (s.seedContext.isNotEmpty) b.write('\n## Contexto de la conversación\n\n${s.seedContext}\n');
  return b.toString();
}

/// Creates [s] as a project on the host and hands its Claude session the brief.
///
/// Sends the brief as an uploaded file the prompt points to with `@path` (the
/// chat's own attachment syntax): a multi-line text typed into the pane would
/// submit at every line break, a file never does. If anything after the
/// creation fails the project still exists, so that is reported in
/// [HandoffResult.briefError] rather than thrown.
///
/// [promptFor] builds the single-line prompt from the uploaded file's path.
/// [wait] is injectable so tests don't sleep.
Future<HandoffResult> handoffProject({
  required HostRpc rpc,
  required HostUpload upload,
  required Suggestion suggestion,
  required String Function(String path) promptFor,
  Future<void> Function(Duration) wait = Future.delayed,
}) async {
  final created = await rpc('projects.create', {'name': projectNameFor(suggestion.title)});
  final id = created is Map ? created['id']?.toString() : null;
  if (id == null || id.isEmpty) throw Exception('The host did not return the project id');
  final name = (created as Map)['name']?.toString() ?? suggestion.title;

  try {
    final path = await upload('brief.md', projectBrief(suggestion));
    // tmux doesn't survive a host reboot: make sure the project's session is up.
    await rpc('projects.open', {'id': id});
    await _waitForPane(rpc, id, wait);
    await rpc('terminals.write', {'id': id, 'text': promptFor(path), 'pressEnter': true});
    return HandoffResult(projectId: id, projectName: name);
  } catch (e) {
    final message = e is Map ? (e['message'] ?? e).toString() : '$e';
    return HandoffResult(projectId: id, projectName: name, briefError: message);
  }
}

/// Claude takes a few seconds to draw its prompt; typing before that can lose
/// the text. Waits until the pane's output stops changing (or gives up and lets
/// the caller type anyway).
Future<void> _waitForPane(HostRpc rpc, String id, Future<void> Function(Duration) wait) async {
  String? last;
  var stable = 0;
  for (var i = 0; i < 25; i++) {
    var text = '';
    try {
      final res = await rpc('terminals.read', {'id': id, 'maxChars': 2000});
      text = (res is Map ? res['text'] : null)?.toString() ?? '';
    } catch (_) {}
    if (text.trim().isNotEmpty && text == last) {
      if (++stable >= 2) return;
    } else {
      stable = 0;
    }
    last = text;
    await wait(const Duration(seconds: 1));
  }
}
