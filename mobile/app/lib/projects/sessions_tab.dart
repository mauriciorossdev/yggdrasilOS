import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../chat/session_transcript_screen.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Mirrors packages/sessions/src/types.ts SessionSummary, as returned by
/// projects.sessions.list (same shape sessions.list already uses — see
/// SessionSummary in chat/chat_list_screen.dart, kept separate here since
/// this one is cross-project and that one is scoped to the active chat
/// connection).
class ProjectSessionSummary {
  final String sessionKey;
  final String? title;
  final int messageCount;
  final int updatedAt;
  final String? lastMessagePreview;

  ProjectSessionSummary({
    required this.sessionKey,
    required this.title,
    required this.messageCount,
    required this.updatedAt,
    this.lastMessagePreview,
  });

  factory ProjectSessionSummary.fromJson(Map<String, dynamic> json) {
    final lastMessage = json['lastMessage'];
    return ProjectSessionSummary(
      sessionKey: json['sessionKey']?.toString() ?? '',
      title: json['title']?.toString(),
      messageCount: (json['messageCount'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      lastMessagePreview: lastMessage is Map
          ? lastMessage['preview']?.toString()
          : null,
    );
  }
}

/// Cross-project session list — reads that project's session files directly
/// off disk (projects.sessions.list), so it works whether or not that
/// project's own gateway is currently running.
class SessionsTab extends StatefulWidget {
  final YggdrasilClient client;
  final ProjectRecord project;

  const SessionsTab({super.key, required this.client, required this.project});

  @override
  State<SessionsTab> createState() => _SessionsTabState();
}

class _SessionsTabState extends State<SessionsTab> {
  List<ProjectSessionSummary> _sessions = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.client.call('projects.sessions.list', {
        'projectPath': widget.project.path,
      });
      final list =
          (res is Map ? res['sessions'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _sessions = list
            .map(
              (e) => ProjectSessionSummary.fromJson(e as Map<String, dynamic>),
            )
            .toList();
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
    if (_loading)
      return const Center(
        child: CircularProgressIndicator(color: YggColors.accent),
      );
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          '${AppStrings.t('common.errorPrefix')}: $_error',
          style: const TextStyle(color: YggColors.textMuted),
        ),
      );
    }
    if (_sessions.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            AppStrings.t('projects.noSessions'),
            style: const TextStyle(color: YggColors.textFaint),
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
        itemCount: _sessions.length,
        itemBuilder: (_, i) {
          final s = _sessions[i];
          return GestureDetector(
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => SessionTranscriptScreen(
                  client: widget.client,
                  project: widget.project,
                  sessionKey: s.sessionKey,
                ),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (s.title?.isNotEmpty ?? false) ? s.title! : s.sessionKey,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14.5,
                      color: YggColors.text,
                    ),
                  ),
                  if (s.lastMessagePreview != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      s.lastMessagePreview!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: YggColors.textFaint,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
