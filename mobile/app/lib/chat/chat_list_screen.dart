import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/user_name_store.dart';
import '../services/yggdrasil_client.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import '../standalone/direct_chat_screen.dart';
import '../standalone/local_chat.dart';
import '../standalone/local_chat_store.dart';
import '../theme/ygg_theme.dart';
import '../workflows_local/automations_screen.dart';
import '../gateway/gateway_connection.dart';
import '../gateway/gateway_settings.dart';
import '../gateway/gateway_settings_screen.dart';
import '../local_projects/local_companion_settings.dart';
import '../local_projects/local_companion_settings_screen.dart';
import '../local_projects/local_projects_list_screen.dart';
import '../pi/pi_chat_screen.dart';
import '../pi/pi_settings.dart';
import '../pi/pi_settings_screen.dart';
import 'chat_screen.dart';
import 'composer_bar.dart';
import 'projects_screen.dart';
import 'root_ring.dart';
import 'settings_screen.dart';

/// Mirrors packages/sessions/src/types.ts SessionSummary — sessionKey/title/
/// agentId/messageCount/createdAt/updatedAt/lastMessage, as returned by
/// sessions.list. lastMessage is optional — a brand-new session with no
/// user/assistant text yet (e.g. tool_calls-only) sends it as undefined.
class SessionSummary {
  final String sessionKey;
  final String? title;
  final int messageCount;
  final int updatedAt;
  final String? lastMessagePreview;

  SessionSummary({
    required this.sessionKey,
    required this.title,
    required this.messageCount,
    required this.updatedAt,
    this.lastMessagePreview,
  });

  factory SessionSummary.fromJson(Map<String, dynamic> json) {
    final lastMessage = json['lastMessage'];
    return SessionSummary(
      sessionKey: json['sessionKey']?.toString() ?? '',
      title: json['title']?.toString(),
      messageCount: (json['messageCount'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      lastMessagePreview: lastMessage is Map ? lastMessage['preview']?.toString() : null,
    );
  }
}

/// One rendered row, built from either a gateway SessionSummary or a local
/// direct-mode LocalChat — remote-access-analysis.md §7.3: the list always
/// reflects only the active profile, never a merged view, but the two data
/// sources share the same row chrome (avatar/title/subtitle/time/dismiss).
class _Row {
  final String key;
  final String title;
  final String subtitle;
  final int updatedAt;
  final bool pending;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final Future<void> Function() onDismissed;

  _Row({
    required this.key,
    required this.title,
    required this.subtitle,
    required this.updatedAt,
    this.pending = false,
    required this.onTap,
    required this.onLongPress,
    required this.onDismissed,
  });
}

/// Home screen. Gateway mode: one entry per gateway session
/// (phone-gateway-connectivity-design.md §3.5). Direct/standalone mode: one
/// entry per local chat under the active profile (remote-access-analysis.md
/// §7.3) — never mixed, never migrated between profiles.
class ChatListScreen extends StatefulWidget {
  final YggdrasilClient client;
  final Stream<Map<String, dynamic>> events;
  final Future<void> connected;
  final String status;
  final List<dynamic> slashCommands;

  /// Re-syncs main.dart's live gateway connection to whatever ConnectionProfile
  /// is now active — settings-consolidation-proposal.md §1/§4.1. Called after
  /// anything that could have changed which profile is active (editing it,
  /// activating a different one, creating the first one).
  final Future<void> Function() onProfileChanged;
  final Set<String> pendingSessions;
  final void Function(String sessionKey) onOpenSession;

  const ChatListScreen({
    super.key,
    required this.client,
    required this.events,
    required this.connected,
    required this.status,
    required this.slashCommands,
    required this.onProfileChanged,
    required this.pendingSessions,
    required this.onOpenSession,
  });

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  List<SessionSummary> _sessions = [];
  List<LocalChat> _localChats = [];
  ConnectionProfile? _activeProfile;
  bool _loading = true;
  String? _error;
  String _searchQuery = '';
  String? _userNamePref;
  bool _gatewayReady = false;
  LocalCompanionSettings? _localCompanionSettings;
  bool get _localCompanionReady => _localCompanionSettings?.isReady ?? false;

  bool get _isDirectMode => _activeProfile?.type == ConnectionProfileType.direct;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _editUserName() async {
    final controller = TextEditingController(text: _userNamePref ?? '');
    final newName = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('settings.yourName')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(hintText: AppStrings.t('settings.yourNameHint')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, controller.text), child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
    if (newName == null || newName.trim().isEmpty) return;
    await UserNameStore.set(newName.trim());
    if (!mounted) return;
    setState(() => _userNamePref = newName.trim());
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final profile = await ProfileStore.getActive();
    final userName = await UserNameStore.get();
    // Independent of `profile`/`_isDirectMode` on purpose — Proyectos runs on
    // its own Gateway config (Ajustes > Gateway), not the active chat profile.
    final gatewaySettings = await GatewaySettingsStore.load();
    // Same reasoning as gatewaySettings above — Proyectos Locales runs
    // entirely on-device (Termux), independent of chat's ConnectionProfile.
    final localCompanionSettings = await LocalCompanionSettingsStore.load();
    if (mounted) {
      setState(() {
        _userNamePref = userName;
        _gatewayReady = gatewaySettings.isReady;
        _localCompanionSettings = localCompanionSettings;
      });
    }

    if (profile != null && profile.type == ConnectionProfileType.direct) {
      final chats = await LocalChatStore.listForProfile(profile.id);
      if (!mounted) return;
      setState(() {
        _activeProfile = profile;
        _localChats = chats;
        _error = null;
        _loading = false;
      });
      return;
    }

    // Gateway mode (default, and unchanged from before profiles existed).
    try {
      await widget.connected;
      final res = await widget.client.call('sessions.list', {});
      final list = (res is Map ? res['sessions'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _activeProfile = profile;
        _sessions = list.map((e) => SessionSummary.fromJson(e as Map<String, dynamic>)).toList();
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _activeProfile = profile;
        _error = '$e';
        _loading = false;
      });
    }
  }

  String _newSessionKey() => 'mobile-${DateTime.now().millisecondsSinceEpoch}';

  Future<void> _openChat(String sessionKey, String? title, {String? initialMessage}) async {
    widget.onOpenSession(sessionKey);
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          client: widget.client,
          events: widget.events,
          connected: widget.connected,
          sessionKey: sessionKey,
          initialTitle: title,
          initialMessage: initialMessage,
          slashCommands: widget.slashCommands,
        ),
      ),
    );
    _load();
    // The chat header's "+" (new chat) pops with this sentinel instead of
    // just leaving — matches the artboard's newChat() button living inside
    // the chat view itself rather than only in the drawer.
    if (result == 'new') _startNewChat();
  }

  Future<void> _openDirectChat(String chatId, String? title, {String? initialMessage}) async {
    final profile = _activeProfile;
    if (profile == null) return;
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DirectChatScreen(
          profile: profile,
          chatId: chatId,
          initialTitle: title,
          initialMessage: initialMessage,
        ),
      ),
    );
    _load();
    if (result == 'new') _startNewChat();
  }

  Future<void> _startNewChat({String? initialMessage}) {
    if (_isDirectMode) {
      return _openDirectChat(DateTime.now().millisecondsSinceEpoch.toString(), null, initialMessage: initialMessage);
    }
    return _openChat(_newSessionKey(), null, initialMessage: initialMessage);
  }

  // The Pi chat has its own settings (Ajustes > Raspberry Pi), independent
  // of both the chat profile and the Gateway — the Pi is a separate machine.
  Future<void> _openPiChat() async {
    var settings = await PiSettingsStore.load();
    if (!mounted) return;
    if (!settings.isReady) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('pi.notConfigured'))));
      final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const PiSettingsScreen()));
      if (saved != true || !mounted) return;
      settings = await PiSettingsStore.load();
      if (!settings.isReady || !mounted) return;
    }
    await Navigator.push(context, MaterialPageRoute(builder: (_) => PiChatScreen(settings: settings)));
  }

  Future<void> _openProjects() async {
    if (!_gatewayReady) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(AppStrings.t('projects.gatewayDisabled')),
        action: SnackBarAction(
          label: AppStrings.t('settings.gateway'),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const GatewaySettingsScreen())).then((_) => _load()),
        ),
      ));
      return;
    }
    final client = await GatewayConnection.resolve();
    if (!mounted) return;
    if (client == null) {
      // Settings changed between the readiness check above and now (e.g.
      // toggled off in another screen) — same fallback as the disabled path.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('projects.gatewayDisabled'))));
      return;
    }
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ProjectsScreen(client: client)));
  }

  Future<void> _openLocalProjects() async {
    if (!_localCompanionReady) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(AppStrings.t('localProjects.disabledHint')),
        action: SnackBarAction(
          label: AppStrings.t('settings.localCompanion'),
          onPressed: () =>
              Navigator.push(context, MaterialPageRoute(builder: (_) => const LocalCompanionSettingsScreen())).then((_) => _load()),
        ),
      ));
      return;
    }
    await Navigator.push(context, MaterialPageRoute(builder: (_) => LocalProjectsListScreen(settings: _localCompanionSettings!)));
  }

  Future<void> _deleteSession(SessionSummary s) async {
    try {
      // sessions.delete doesn't exist (design doc gap, §6.2) — reset unlinks
      // the session file server-side, which is effectively delete for v1.
      await widget.client.call('sessions.reset', {'sessionKey': s.sessionKey});
    } catch (_) {
      // best-effort — refresh either way so the list matches server state
    }
    _load();
  }

  Future<void> _renameSession(SessionSummary s) async {
    final newTitle = await _promptForTitle(s.title);
    if (newTitle == null) return;
    try {
      await widget.client.call('sessions.patch', {'sessionKey': s.sessionKey, 'title': newTitle});
    } catch (_) {}
    _load();
  }

  Future<void> _renameLocalChat(LocalChat c) async {
    final newTitle = await _promptForTitle(c.title);
    if (newTitle == null) return;
    c.title = newTitle;
    await LocalChatStore.upsert(c);
    _load();
  }

  Future<String?> _promptForTitle(String? current) async {
    final controller = TextEditingController(text: current ?? '');
    final newTitle = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('dialog.renameChatTitle')),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, controller.text), child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
    if (newTitle == null || newTitle.trim().isEmpty) return null;
    return newTitle.trim();
  }

  void _showItemMenu({required VoidCallback onRename, required VoidCallback onDelete}) {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: Text(AppStrings.t('common.rename')),
              onTap: () {
                Navigator.pop(context);
                onRename();
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: Text(AppStrings.t('common.delete')),
              onTap: () {
                Navigator.pop(context);
                onDelete();
              },
            ),
          ],
        ),
      ),
    );
  }


  List<_Row> _buildRows() {
    if (_isDirectMode) {
      return _localChats
          .map((c) => _Row(
                key: c.id,
                title: (c.title?.isNotEmpty ?? false) ? c.title! : AppStrings.t('drawer.untitledSession'),
                subtitle: c.lastMessagePreview ?? '${c.messages.length} ${AppStrings.t('drawer.messagesSuffix')}',
                updatedAt: c.updatedAt,
                onTap: () => _openDirectChat(c.id, c.title),
                onLongPress: () => _showItemMenu(
                  onRename: () => _renameLocalChat(c),
                  onDelete: () async {
                    await LocalChatStore.delete(c.id);
                    _load();
                  },
                ),
                onDismissed: () => LocalChatStore.delete(c.id).then((_) => _load()),
              ))
          .toList();
    }
    return _sessions
        .map((s) => _Row(
              key: s.sessionKey,
              title: (s.title?.isNotEmpty ?? false) ? s.title! : AppStrings.t('drawer.untitledSession'),
              subtitle: (s.lastMessagePreview?.isNotEmpty ?? false)
                  ? s.lastMessagePreview!
                  : '${s.messageCount} ${AppStrings.t('drawer.messagesSuffix')}',
              updatedAt: s.updatedAt,
              pending: widget.pendingSessions.contains(s.sessionKey),
              onTap: () => _openChat(s.sessionKey, s.title),
              onLongPress: () => _showItemMenu(
                onRename: () => _renameSession(s),
                onDelete: () => _deleteSession(s),
              ),
              onDismissed: () => _deleteSession(s),
            ))
        .toList();
  }

  bool get _hasUserName => _userNamePref?.isNotEmpty ?? false;
  String get _userName => _hasUserName ? _userNamePref! : AppStrings.t('drawer.you');

  Widget _avatar(double size, {double fontSize = 14}) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(color: YggColors.accent, shape: BoxShape.circle),
      child: Center(
        child: _hasUserName
            ? Text(_userName.substring(0, 1).toUpperCase(), style: TextStyle(color: YggColors.surface, fontWeight: FontWeight.w500, fontSize: fontSize))
            : Icon(Icons.person_outline, color: YggColors.surface, size: size * 0.55),
      ),
    );
  }

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 5) return AppStrings.t('home.greetingLateNight');
    if (hour < 12) return AppStrings.t('home.greetingMorning');
    if (hour < 19) return AppStrings.t('home.greetingAfternoon');
    return AppStrings.t('home.greetingNight');
  }

  // Real capabilities the phone_* tools already implement — not invented
  // copy, matches phone-gateway-connectivity-design.md's 4 device tools.
  List<(String, String)> get _suggestions => [
        (AppStrings.t('home.suggestion1Tag'), AppStrings.t('home.suggestion1Text')),
        (AppStrings.t('home.suggestion2Tag'), AppStrings.t('home.suggestion2Text')),
        (AppStrings.t('home.suggestion3Tag'), AppStrings.t('home.suggestion3Text')),
      ];

  final _scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: YggColors.bg,
      drawer: _buildDrawer(context),
      body: Stack(
        children: [
          Positioned(
            top: -140,
            left: MediaQuery.of(context).size.width / 2 - 260,
            child: IgnorePointer(
              child: Container(
                width: 520,
                height: 420,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(colors: [Color.fromRGBO(201, 165, 78, 0.20), Color.fromRGBO(0, 56, 51, 0)]),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                _buildHomeHeader(context),
                Expanded(child: _buildHomeBody(context)),
                ComposerBar(onSubmit: (text) => _startNewChat(initialMessage: text)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHomeHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 10),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => _scaffoldKey.currentState?.openDrawer(),
            child: Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(color: YggColors.cardFillHigh, shape: BoxShape.circle),
              child: const Icon(Icons.menu, color: YggColors.text, size: 18),
            ),
          ),
          const Expanded(
            child: Padding(
              padding: EdgeInsets.only(left: 12),
              child: Text('YGGDRASIL', style: TextStyle(fontSize: 13, letterSpacing: 2.2, color: YggColors.textMuted, fontWeight: FontWeight.w500)),
            ),
          ),
          _avatar(36),
        ],
      ),
    );
  }

  Widget _buildHomeBody(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 0, 22, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          const RootRing(size: 26, opacity: 0.7),
          const SizedBox(height: 14),
          Text('$_greeting,', style: const TextStyle(fontSize: 38, height: 1.05, fontFamily: 'serif', color: YggColors.text)),
          Text(
            _userName,
            style: const TextStyle(fontSize: 38, height: 1.05, fontFamily: 'serif', fontStyle: FontStyle.italic, color: YggColors.accent),
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(bottom: 22),
            child: Text(
              AppStrings.t('home.subtitle'),
              style: const TextStyle(fontWeight: FontWeight.w300, fontSize: 15, height: 1.5, color: YggColors.textMuted),
            ),
          ),
          SizedBox(
            height: 112,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _suggestions.length,
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (context, i) {
                final (tag, text) = _suggestions[i];
                return GestureDetector(
                  onTap: () => _startNewChat(initialMessage: text),
                  child: Container(
                    width: 158,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: YggColors.cardFill, borderRadius: BorderRadius.circular(18), border: Border.all(color: YggColors.hairline)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(tag.toUpperCase(), style: const TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.3, color: YggColors.accent)),
                        const Spacer(),
                        Text(
                          text,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14, height: 1.3, color: Color.fromRGBO(244, 239, 230, 0.92)),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  // Buckets rows by day so the drawer reads like the artboard's grouped
  // thread list, without inventing the mock's week/month granularity.
  Map<String, List<_Row>> _groupedRows(List<_Row> rows) {
    final sorted = [...rows]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    final now = DateTime.now();
    String bucketFor(int ms) {
      if (ms == 0) return AppStrings.t('drawer.bucketOlder');
      final dt = DateTime.fromMillisecondsSinceEpoch(ms);
      final days = DateTime(now.year, now.month, now.day).difference(DateTime(dt.year, dt.month, dt.day)).inDays;
      if (days <= 0) return AppStrings.t('drawer.bucketToday');
      if (days == 1) return AppStrings.t('drawer.bucketYesterday');
      if (days <= 7) return AppStrings.t('drawer.bucketThisWeek');
      return AppStrings.t('drawer.bucketOlder');
    }

    final grouped = <String, List<_Row>>{};
    for (final row in sorted) {
      grouped.putIfAbsent(bucketFor(row.updatedAt), () => []).add(row);
    }
    return grouped;
  }

  Future<void> _openSettings() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => SettingsScreen(client: widget.client, onProfileChanged: widget.onProfileChanged)),
    );
    _load();
  }

  Widget _buildDrawer(BuildContext context) {
    final rows = _buildRows();
    final grouped = _groupedRows(rows);
    return Drawer(
      backgroundColor: YggColors.surface,
      width: MediaQuery.of(context).size.width * 0.86,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text('Yggdrasil', style: TextStyle(fontSize: 22, fontFamily: 'serif', color: YggColors.text)),
                      ),
                      GestureDetector(
                        onTap: () {
                          Navigator.pop(context);
                          Navigator.push(context, MaterialPageRoute(builder: (_) => const AutomationsScreen()));
                        },
                        child: Container(
                          width: 34,
                          height: 34,
                          decoration: const BoxDecoration(color: YggColors.cardFillHigh, shape: BoxShape.circle),
                          child: const Icon(Icons.auto_mode_outlined, color: YggColors.text, size: 16),
                        ),
                      ),
                      const SizedBox(width: 8),
                      GestureDetector(
                        onTap: _openSettings,
                        child: Container(
                          width: 34,
                          height: 34,
                          decoration: const BoxDecoration(color: YggColors.cardFillHigh, shape: BoxShape.circle),
                          child: const Icon(Icons.settings_outlined, color: YggColors.text, size: 16),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    height: 40,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(color: YggColors.cardFillHigh, borderRadius: BorderRadius.circular(999)),
                    child: TextField(
                      onChanged: (v) => setState(() => _searchQuery = v.trim().toLowerCase()),
                      style: const TextStyle(color: YggColors.text, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: AppStrings.t('drawer.searchHint'),
                        hintStyle: const TextStyle(color: Color.fromRGBO(244, 239, 230, 0.42)),
                        border: InputBorder.none,
                        isDense: true,
                        prefixIcon: const Icon(Icons.search, color: Color.fromRGBO(244, 239, 230, 0.45), size: 18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      _startNewChat();
                    },
                    child: Container(
                      height: 44,
                      padding: const EdgeInsets.symmetric(horizontal: 15),
                      decoration: BoxDecoration(color: YggColors.accent, borderRadius: BorderRadius.circular(14)),
                      child: Row(
                        children: [
                          const Icon(Icons.add, color: YggColors.surface, size: 18),
                          const SizedBox(width: 8),
                          Text(AppStrings.t('common.newChat'), style: const TextStyle(color: YggColors.surface, fontWeight: FontWeight.w500, fontSize: 14.5)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      _openPiChat();
                    },
                    child: Container(
                      height: 44,
                      padding: const EdgeInsets.symmetric(horizontal: 15),
                      decoration: BoxDecoration(
                        color: YggColors.cardFillHigh,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: YggColors.hairline),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.terminal, color: YggColors.text, size: 18),
                          const SizedBox(width: 8),
                          Text(AppStrings.t('common.chat'), style: const TextStyle(color: YggColors.text, fontWeight: FontWeight.w500, fontSize: 14.5)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      _openProjects();
                    },
                    child: Container(
                      height: 44,
                      padding: const EdgeInsets.symmetric(horizontal: 15),
                      decoration: BoxDecoration(
                        color: YggColors.cardFillHigh,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: YggColors.hairline),
                      ),
                      child: Opacity(
                        opacity: _gatewayReady ? 1 : 0.5,
                        child: Row(
                          children: [
                            const Icon(Icons.folder_outlined, color: YggColors.text, size: 18),
                            const SizedBox(width: 8),
                            Text(AppStrings.t('common.projects'), style: const TextStyle(color: YggColors.text, fontWeight: FontWeight.w500, fontSize: 14.5)),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      _openLocalProjects();
                    },
                    child: Container(
                      height: 44,
                      padding: const EdgeInsets.symmetric(horizontal: 15),
                      decoration: BoxDecoration(
                        color: YggColors.cardFillHigh,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: YggColors.hairline),
                      ),
                      child: Opacity(
                        opacity: _localCompanionReady ? 1 : 0.5,
                        child: Row(
                          children: [
                            const Icon(Icons.terminal, color: YggColors.text, size: 18),
                            const SizedBox(width: 8),
                            Text(AppStrings.t('localProjects.title'), style: const TextStyle(color: YggColors.text, fontWeight: FontWeight.w500, fontSize: 14.5)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
                  : _error != null
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
                          children: [
                            for (final entry in grouped.entries) ...[
                              Padding(
                                padding: const EdgeInsets.fromLTRB(8, 16, 8, 7),
                                child: Text(
                                  entry.key.toUpperCase(),
                                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.4, color: YggColors.textFainter),
                                ),
                              ),
                              for (final row in entry.value.where((r) =>
                                  _searchQuery.isEmpty || r.title.toLowerCase().contains(_searchQuery) || r.subtitle.toLowerCase().contains(_searchQuery)))
                                Dismissible(
                                  key: ValueKey(row.key),
                                  direction: DismissDirection.endToStart,
                                  background: Container(
                                    color: YggColors.errorRed,
                                    alignment: Alignment.centerRight,
                                    padding: const EdgeInsets.only(right: 20),
                                    child: const Icon(Icons.delete, color: YggColors.text),
                                  ),
                                  onDismissed: (_) => row.onDismissed(),
                                  child: GestureDetector(
                                    onTap: () {
                                      Navigator.pop(context);
                                      row.onTap();
                                    },
                                    onLongPress: row.onLongPress,
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 12),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Expanded(
                                                child: Text(row.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, color: YggColors.text)),
                                              ),
                                              if (row.pending)
                                                Container(width: 8, height: 8, margin: const EdgeInsets.only(left: 6), decoration: const BoxDecoration(color: YggColors.accent, shape: BoxShape.circle)),
                                            ],
                                          ),
                                          const SizedBox(height: 3),
                                          Text(row.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: YggColors.textFaint)),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ],
                        ),
            ),
            GestureDetector(
              onTap: () {
                Navigator.pop(context);
                _editUserName();
              },
              child: Container(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: YggColors.hairline))),
                child: Row(
                  children: [
                    _avatar(32, fontSize: 13),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Text(
                        _hasUserName ? _userName : AppStrings.t('settings.addYourName'),
                        style: const TextStyle(fontSize: 14, color: Color.fromRGBO(244, 239, 230, 0.8)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
