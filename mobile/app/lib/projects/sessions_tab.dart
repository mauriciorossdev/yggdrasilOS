import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../chat/session_transcript_screen.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';

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
  String _query = '';

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

  bool _matches(ProjectSessionSummary s) {
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    return (s.title ?? '').toLowerCase().contains(q) || (s.lastMessagePreview ?? '').toLowerCase().contains(q);
  }

  Widget _row(ProjectSessionSummary s) {
    final hasTitle = s.title?.isNotEmpty ?? false;
    final meta = [
      yggCount(s.messageCount, oneKey: 'sessions.messagesOne', manyKey: 'sessions.messagesMany'),
      yggTimeAgo(s.updatedAt),
    ].join(' · ');
    return YggListRow(
      title: hasTitle ? s.title! : AppStrings.t('sessions.untitled'),
      subtitle: s.lastMessagePreview,
      subtitleLines: 2,
      meta: meta,
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
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: YggColors.accent));
    }
    if (_error != null) {
      return YggEmptyState(
        icon: Icons.error_outline,
        message: '${AppStrings.t('common.errorPrefix')}: $_error',
        action: OutlinedButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
      );
    }
    if (_sessions.isEmpty) {
      return YggEmptyState(icon: Icons.forum_outlined, message: AppStrings.t('projects.noSessions'));
    }

    final sorted = _sessions.where(_matches).toList()..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    // Insertion-ordered: today first, then yesterday... because the list is newest-first.
    final groups = <String, List<ProjectSessionSummary>>{};
    for (final s in sorted) {
      groups.putIfAbsent(yggDateBucketKey(s.updatedAt), () => []).add(s);
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          YggSearchField(hint: AppStrings.t('sessions.searchHint'), onChanged: (v) => setState(() => _query = v.trim())),
          const SizedBox(height: 18),
          if (sorted.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 40),
              child: YggEmptyState(icon: Icons.search_off, message: AppStrings.t('projects.noMatches')),
            ),
          for (final entry in groups.entries) ...[
            YggSectionLabel(AppStrings.t(entry.key)),
            YggListGroup(children: [for (final s in entry.value) _row(s)]),
            const SizedBox(height: 20),
          ],
        ],
      ),
    );
  }
}
