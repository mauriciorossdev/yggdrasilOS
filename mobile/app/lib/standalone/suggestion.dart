import 'dart:convert';

import 'local_chat.dart';
import 'local_message.dart';

/// The app-level tool the model calls to *offer* something to the user — it
/// never acts on its own: the offer shows as a card and the user decides.
/// Unlike the phone_* device tools it isn't a capability (nothing to toggle in
/// Settings), so the engine handles it directly.
const suggestActionToolName = 'suggest_action';

enum SuggestionKind {
  /// Continue an idea in a dedicated chat, seeded with the relevant context.
  newChat('new_chat'),

  /// Start it as a project on the user's host, with the context as its brief.
  newProject('new_project');

  final String wire;
  const SuggestionKind(this.wire);

  static SuggestionKind? parse(Object? value) {
    for (final k in values) {
      if (k.wire == value) return k;
    }
    return null;
  }
}

/// Where a suggestion stands; kept in the tool-result message so it survives
/// reloading the chat.
const suggestionPending = 'pending';
const suggestionAccepted = 'accepted';
const suggestionDismissed = 'dismissed';

class Suggestion {
  final String callId;
  final SuggestionKind kind;
  final String title;
  final String summary;
  final String seedContext;

  const Suggestion({
    required this.callId,
    required this.kind,
    required this.title,
    required this.summary,
    required this.seedContext,
  });

  /// Null when the call is malformed (unknown kind or no title) — the engine
  /// then answers the model with an error instead of showing a broken card.
  static Suggestion? fromCall(LocalToolCall call) {
    if (call.name != suggestActionToolName) return null;
    final kind = SuggestionKind.parse(call.args['kind']);
    final title = call.args['title']?.toString().trim() ?? '';
    if (kind == null || title.isEmpty) return null;
    return Suggestion(
      callId: call.id,
      kind: kind,
      title: title,
      summary: call.args['summary']?.toString().trim() ?? '',
      seedContext: call.args['seed_context']?.toString().trim() ?? '',
    );
  }
}

/// The suggestions an assistant message offers, in order.
List<Suggestion> suggestionsOf(LocalMessage message) => [
      for (final call in message.toolCalls ?? const <LocalToolCall>[])
        ?Suggestion.fromCall(call),
    ];

LocalMessage? _resultOf(LocalChat chat, String callId) {
  for (final m in chat.messages) {
    if (m.role == LocalRole.tool && m.toolCallId == callId) return m;
  }
  return null;
}

String suggestionStatusOf(LocalChat chat, String callId) {
  final result = _resultOf(chat, callId);
  if (result == null) return suggestionPending;
  try {
    return (jsonDecode(result.text) as Map)['status']?.toString() ?? suggestionPending;
  } catch (_) {
    return suggestionPending;
  }
}

/// The caller persists the chat afterwards.
void setSuggestionStatus(LocalChat chat, String callId, String status) {
  final result = _resultOf(chat, callId);
  if (result == null) return;
  result.text = jsonEncode({'status': status, 'note': suggestionResultNote});
}

/// What the model reads back as the tool's output.
const suggestionResultNote = 'Shown to the user as a card they can accept or dismiss. '
    'Do not repeat the offer in text; say in one short sentence that you offered it and carry on.';

/// The tool declaration. [projectsAvailable] (the user has a host configured)
/// decides whether new_project is offered at all.
Map<String, dynamic> buildSuggestActionSpec({required bool projectsAvailable}) => {
      'name': suggestActionToolName,
      'description': 'Offer the user a next step as a card they can accept or dismiss. Never acts by itself.',
      'parameters': {
        'type': 'object',
        'properties': {
          'kind': {
            'type': 'string',
            'enum': [
              SuggestionKind.newChat.wire,
              if (projectsAvailable) SuggestionKind.newProject.wire,
            ],
            'description': 'new_chat: open a dedicated chat to develop an idea further.'
                '${projectsAvailable ? ' new_project: start it as a project on the user\'s computer.' : ''}',
          },
          'title': {'type': 'string', 'description': 'Short title for the card and what it opens.'},
          'summary': {'type': 'string', 'description': 'One sentence on what it would work on.'},
          'seed_context': {
            'type': 'string',
            'description': 'The relevant context from this conversation, written so what it opens can start from it.',
          },
        },
        'required': ['kind', 'title'],
      },
    };

/// System-prompt section that tells the model when to use suggest_action.
String buildSuggestionGuidance({required bool projectsAvailable}) => 'You can offer the user a next step with the '
    'suggest_action tool. Use kind "new_chat" when the user is clearly exploring a loose idea that deserves its '
    'own focused conversation (something they are brainstorming or a plan to flesh out). '
    '${projectsAvailable ? 'Use kind "new_project" instead when what they describe is something to build or work on over time '
        'with files (an app, a repo, a set of documents) and it has a clear enough name and scope; it creates a project on '
        'their computer with your seed_context as the brief. ' : ''}'
    'Offer at most once per idea, never for simple questions, and never when this chat already is that focused '
    'conversation. You only offer: the user decides on the card. After calling the tool, reply with one short sentence.';
