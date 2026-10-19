import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'assistant_markdown.dart';
import 'projects_screen.dart';

class _Message {
  final String role;
  final String text;

  _Message({required this.role, required this.text});
}

// Same text-extraction shape as packages/sessions/src/store.ts's
// contentToText — content is either a plain string or a list of parts,
// only "text" parts matter for a read-only transcript.
String _textFromContent(dynamic content) {
  if (content is String) return content;
  if (content is List) {
    return content
        .whereType<Map>()
        .where((part) => part['type'] == 'text')
        .map((part) => part['text']?.toString() ?? '')
        .join(' ');
  }
  return '';
}

/// Read-only transcript for a session belonging to ANY project (not
/// necessarily the one the connected Gateway is backing right now) — reads
/// via projects.sessions.get, which works off that project's disk directly.
/// No composer, no sending: a project that isn't currently open on the
/// computer has no live gateway to actually deliver a new message to.
class SessionTranscriptScreen extends StatefulWidget {
  final YggdrasilClient client;
  final ProjectRecord project;
  final String sessionKey;

  const SessionTranscriptScreen({super.key, required this.client, required this.project, required this.sessionKey});

  @override
  State<SessionTranscriptScreen> createState() => _SessionTranscriptScreenState();
}

class _SessionTranscriptScreenState extends State<SessionTranscriptScreen> {
  List<_Message> _messages = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await widget.client.call(
        'projects.sessions.get',
        {'projectPath': widget.project.path, 'sessionKey': widget.sessionKey},
      );
      final session = res is Map ? res['session'] : null;
      final rawMessages = (session is Map ? session['messages'] : null) as List<dynamic>? ?? [];
      final messages = rawMessages
          .whereType<Map>()
          .where((m) => m['role'] == 'user' || m['role'] == 'assistant')
          .map((m) => _Message(role: m['role'].toString(), text: _textFromContent(m['content'])))
          .where((m) => m.text.trim().isNotEmpty)
          .toList();
      if (!mounted) return;
      setState(() {
        _messages = messages;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.sessionKey, overflow: TextOverflow.ellipsis)),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (_, i) {
                    final m = _messages[i];
                    final isUser = m.role == 'user';
                    return Align(
                      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: isUser ? YggColors.accent : YggColors.cardFill,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: isUser
                            ? Text(m.text, style: const TextStyle(color: YggColors.surface, fontSize: 14.5))
                            : AssistantMarkdown(data: m.text),
                      ),
                    );
                  },
                ),
    );
  }
}
