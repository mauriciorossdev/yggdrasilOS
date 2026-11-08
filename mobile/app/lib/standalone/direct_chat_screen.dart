import 'dart:convert';
import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../chat/chat_list_extras.dart';
import '../chat/composer_bar.dart';
import '../chat/copy_pill.dart';
import '../chat/interactive_tool_card.dart';
import '../chat/root_ring.dart';
import '../assistant/assistant_usage.dart' show formatTokens;
import '../chat/assistant_markdown.dart';
import '../chat/sync_tool_card.dart';
import '../pi/pi_attachments.dart';
import '../pi/pi_chat_screen.dart';
import '../pi/pi_settings.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import '../services/yggdrasil_client.dart';
import '../voice/voice_mode_screen.dart';
import '../theme/ygg_theme.dart';
import 'local_chat.dart';
import 'local_chat_store.dart';
import 'local_message.dart';
import 'model_catalog.dart';
import 'persona.dart';
import 'persona_picker.dart';
import 'project_handoff.dart';
import 'direct_usage_sheet.dart';
import 'standalone_chat_engine.dart';
import 'suggestion.dart';
import 'suggestion_card.dart';
import 'token_usage.dart';

enum _Kind { user, assistant, syncTool, interactive, note, suggestion }

const _interactiveTools = {'phone_pick_file', 'phone_list_documents'};

class _Item {
  final String id;
  final _Kind kind;
  String text;
  String status;
  String? detail;
  String? toolName;
  Suggestion? suggestion;

  _Item({required this.id, required this.kind, required this.text, this.status = '', this.toolName, this.suggestion});
}

/// Standalone (direct-to-provider) chat — remote-access-analysis.md §7.
/// No gateway, no WS, no approval loop (all 4 phone_* tools are "safe").
/// Reuses SyncToolCard/InteractiveToolCard from chat/ per Architect's
/// instruction not to duplicate that UI between the two modes.
class DirectChatScreen extends StatefulWidget {
  final ConnectionProfile profile;
  final String chatId;
  final String? initialTitle;
  final String? initialMessage;

  const DirectChatScreen({
    super.key,
    required this.profile,
    required this.chatId,
    this.initialTitle,
    this.initialMessage,
  });

  @override
  State<DirectChatScreen> createState() => _DirectChatScreenState();
}

class _DirectChatScreenState extends State<DirectChatScreen> {
  late final StandaloneChatEngine _engine;
  LocalChat? _chat;
  Persona? _persona;
  final List<_Item> _items = [];
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  late final _tracker = ChatListTracker(_scrollController);
  bool _thinking = false;
  bool _loading = true;
  int _seq = 0;
  String? _title;
  String? _pendingToolDetail;

  @override
  void initState() {
    super.initState();
    _engine = StandaloneChatEngine(widget.profile);
    _title = widget.initialTitle;
    _init();
  }

  Future<void> _init() async {
    final existing = await LocalChatStore.get(widget.chatId);
    // A new chat pins the default personality now, so changing the default later
    // doesn't change how this one behaves.
    final chat = existing ??
        LocalChat(
          id: widget.chatId,
          profileId: widget.profile.id,
          title: widget.initialTitle,
          personaId: await PersonaStore.defaultId(),
        );
    if (existing == null) await LocalChatStore.upsert(chat);
    final persona = await PersonaStore.resolve(chat.personaId);
    if (!mounted) return;
    setState(() {
      _chat = chat;
      _persona = persona;
      _title = chat.title ?? _title;
      for (final m in chat.messages) {
        if (m.role == LocalRole.user) {
          _items.add(_Item(id: _nextId(), kind: _Kind.user, text: m.text));
        } else if (m.role == LocalRole.assistant) {
          _addAssistantItems(m);
        }
      }
      _loading = false;
      _tracker.markHistory(_items.map((e) => e.id));
    });
    _scrollToBottom();
    final initial = widget.initialMessage?.trim();
    if (initial != null && initial.isNotEmpty) _send(initial);
  }

  @override
  void dispose() {
    _inputController.dispose();
    _tracker.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String _nextId() => 'i${_seq++}';

  /// An assistant message's text, then a card for each thing it offers.
  void _addAssistantItems(LocalMessage m) {
    if (m.text.trim().isNotEmpty) _items.add(_Item(id: _nextId(), kind: _Kind.assistant, text: m.text));
    for (final s in suggestionsOf(m)) {
      _items.add(_Item(
        id: _nextId(),
        kind: _Kind.suggestion,
        text: s.title,
        suggestion: s,
        status: suggestionStatusOf(_chat!, s.callId),
      ));
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  void _send([String? text]) {
    final chat = _chat;
    if (chat == null) return;
    final value = (text ?? _inputController.text).trim();
    if (value.isEmpty || _thinking) return;
    _inputController.clear();
    _engine.sendMessage(
      chat: chat,
      userText: value,
      onThinkingStart: () {
        if (mounted) setState(() => _thinking = true);
      },
      onThinkingEnd: () {
        if (mounted) setState(() => _thinking = false);
      },
      onMessageAdded: _onMessageAdded,
      onToolActivity: _onToolActivity,
      onInteractiveProgress: _onInteractiveProgress,
      onConfirmModerateAction: _confirmModerateAction,
    );
  }

  // Standalone-only local gate for non-"safe" tools (Architect's ruling,
  // external-actions-and-connectors-analysis.md §6) — a plain AlertDialog,
  // not the gateway's richer approval card/machinery, since standalone has
  // no gateway to route that through. No configurable approvalMode for v1:
  // every non-safe tool always confirms.
  Future<bool> _confirmModerateAction(String toolName, Map<String, dynamic> args) async {
    final approved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('dialog.confirmActionTitle')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(toolName.toUpperCase(), style: const TextStyle(fontFamily: YggFonts.mono, fontWeight: FontWeight.bold)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: YggColors.accent)),
                  child: Text(
                    AppStrings.t('dialog.moderateRiskBadge'),
                    style: TextStyle(fontFamily: YggFonts.mono, fontSize: 10, color: YggColors.accent),
                  ),
                ),
              ],
            ),
            if (args.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(_prettyJson(args), style: const TextStyle(fontFamily: YggFonts.mono, fontSize: 12)),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(AppStrings.t('common.reject'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: Text(AppStrings.t('common.approve'))),
        ],
      ),
    );
    return approved ?? false;
  }

  String _prettyJson(Map<String, dynamic> value) {
    try {
      return const JsonEncoder.withIndent('  ').convert(value);
    } catch (_) {
      return value.toString();
    }
  }

  void _onMessageAdded(LocalMessage m) {
    if (!mounted) return;
    setState(() {
      switch (m.role) {
        case LocalRole.user:
          _items.add(_Item(id: _nextId(), kind: _Kind.user, text: m.text));
          break;
        case LocalRole.assistant:
          _addAssistantItems(m);
          break;
        case LocalRole.tool:
          if (m.toolName == suggestActionToolName) break;
          // Stashed for the onToolActivity('ok'/'error') that follows right
          // after in the engine's sequential await chain.
          _pendingToolDetail = m.text;
          break;
      }
    });
    _scrollToBottom();
  }

  void _onToolActivity(String toolName, String status) {
    if (!mounted) return;
    setState(() {
      if (status == 'running') {
        final interactive = _interactiveTools.contains(toolName);
        _items.add(_Item(
          id: _nextId(),
          kind: interactive ? _Kind.interactive : _Kind.syncTool,
          text: toolName,
          toolName: toolName,
          status: interactive ? 'opening' : 'running',
        ));
        return;
      }
      _Item? match;
      for (final it in _items.reversed) {
        final pending = (it.kind == _Kind.syncTool && it.status == 'running') ||
            (it.kind == _Kind.interactive && (it.status == 'opening' || it.status == 'awaitingUser' || it.status == 'cancelling'));
        if (pending && it.toolName == toolName) {
          match = it;
          break;
        }
      }
      if (match == null) return;
      final detail = _pendingToolDetail;
      _pendingToolDetail = null;
      if (match.kind == _Kind.syncTool) {
        match.status = switch (status) {
          'ok' => 'ok',
          'denied' => 'denied',
          _ => 'error',
        };
        if (status != 'denied') match.detail = detail;
      } else if (status == 'ok') {
        match.status = 'resolvedOk';
        match.detail = detail;
      } else if (status == 'cancelled') {
        // Same local call backs a user-tapped Cancelar and a native
        // back-press on the picker — no way (or need) to tell them apart
        // in standalone mode, unlike gateway mode's cancelledByPhone.
        match.status = 'cancelled';
      } else {
        match.status = 'failed';
        match.detail = detail;
      }
    });
    _scrollToBottom();
  }

  void _onInteractiveProgress(String toolName, String status) {
    if (!mounted || status != 'awaiting_user') return;
    setState(() {
      for (final it in _items.reversed) {
        if (it.kind == _Kind.interactive && it.toolName == toolName && it.status == 'opening') {
          it.status = 'awaitingUser';
          break;
        }
      }
    });
  }

  Future<void> _answerSuggestion(_Item item, String status) async {
    final chat = _chat;
    final s = item.suggestion;
    if (chat == null || s == null) return;
    if (status == suggestionAccepted && s.kind == SuggestionKind.newProject) return _createProject(item, s);
    setState(() => item.status = status);
    setSuggestionStatus(chat, s.callId, status);
    await LocalChatStore.upsert(chat);
    if (status != suggestionAccepted || !mounted) return;
    final context = s.seedContext.isNotEmpty ? s.seedContext : s.summary;
    final seed = AppStrings.tp('suggest.seed', {'title': s.title, 'context': context}).trim();
    await Navigator.of(this.context).push(MaterialPageRoute(
      builder: (_) => DirectChatScreen(
        profile: widget.profile,
        chatId: DateTime.now().millisecondsSinceEpoch.toString(),
        initialTitle: s.title,
        initialMessage: seed,
      ),
    ));
  }

  /// Creates the offered project on the host and opens it. The card only turns to
  /// "created" once that worked, so a failure leaves it there to try again.
  Future<void> _createProject(_Item item, Suggestion s) async {
    final chat = _chat;
    final host = await PiSettingsStore.load();
    if (chat == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    if (!host.isReady) {
      messenger.showSnackBar(SnackBar(content: Text(AppStrings.t('suggest.noHost'))));
      return;
    }
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => PopScope(
        canPop: false,
        child: AlertDialog(
          content: Row(
            children: [
              SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: YggColors.accent)),
              const SizedBox(width: 16),
              Expanded(child: Text(AppStrings.tp('suggest.creatingOnHost', {'host': host.displayName}))),
            ],
          ),
        ),
      ),
    );
    HandoffResult? result;
    Object? error;
    YggdrasilClient? client;
    try {
      await host.connectNetwork();
      final c = client = YggdrasilClient(baseUrl: host.baseUrl, apiKey: host.apiKey);
      c.connectToMirror((_) {});
      await c.call('health', {}, timeout: const Duration(seconds: 8));
      result = await handoffProject(
        rpc: (method, params) => c.call(method, params, timeout: const Duration(seconds: 60)),
        upload: (name, content) => uploadTextToPi(c, name, content),
        suggestion: s,
        promptFor: (path) => AppStrings.tp('suggest.projectPrompt', {'path': path}),
      );
    } catch (e) {
      error = e;
    } finally {
      client?.disconnect();
    }
    navigator.pop();
    if (result == null) {
      final msg = error is Map ? (error['message'] ?? error).toString() : '$error';
      messenger.showSnackBar(SnackBar(content: Text('${AppStrings.t('suggest.createFailed')}: $msg')));
      return;
    }
    if (mounted) setState(() => item.status = suggestionAccepted);
    setSuggestionStatus(chat, s.callId, suggestionAccepted);
    await LocalChatStore.upsert(chat);
    if (!result.briefSent) {
      messenger.showSnackBar(SnackBar(content: Text('${AppStrings.t('suggest.briefFailed')}: ${result.briefError}')));
    }
    if (!mounted) return;
    await navigator.push(MaterialPageRoute(
      builder: (_) => PiChatScreen(settings: host, projectId: result!.projectId, projectName: result.projectName),
    ));
  }

  void _cancelInteractive(_Item item) {
    setState(() => item.status = 'cancelling');
    _engine.executor.cancelPending();
  }

  void _retry(_Item item) {
    final label = item.toolName ?? AppStrings.t('chat.retryLabelFallback');
    _send('${AppStrings.t('common.retry')}: $label');
  }

  UsageSummary _usageSummary() => UsageSummary.of(
        (_chat?.messages ?? const <LocalMessage>[]).map((m) => m.usage).whereType<TokenUsage>(),
        (id) => findModel(widget.profile.provider, id),
      );

  // The engine reads the same ConnectionProfile instance, so mutating it makes
  // the next turn run on the new model; persisting keeps it for later chats.
  Future<void> _selectModel(String modelId) async {
    widget.profile.model = modelId;
    await ProfileStore.upsert(widget.profile);
    if (mounted) setState(() {});
  }

  Future<void> _openUsageSheet() => showDirectUsageSheet(
        context,
        provider: widget.profile.provider,
        currentModelId: _engine.currentModel,
        summary: _usageSummary(),
        onSelectModel: _selectModel,
      );

  /// Current model next to the "CHAT" label, with the chat's running token
  /// count once there is any; tap for the model picker and usage details.
  Widget _buildModelChip() {
    final modelId = _engine.currentModel;
    final label = findModel(widget.profile.provider, modelId)?.label ?? modelId;
    final summary = _usageSummary();
    final text = summary.isEmpty ? label : '$label · ${formatTokens(summary.inTokens + summary.outTokens)} tok';
    return GestureDetector(
      onTap: _openUsageSheet,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: YggColors.cardFillHigh,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: YggColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(text, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, color: YggColors.accent)),
            ),
            const SizedBox(width: 4),
            Icon(Icons.tune, size: 12, color: YggColors.textMuted),
          ],
        ),
      ),
    );
  }

  Future<void> _pickPersona() async {
    final chat = _chat;
    if (chat == null) return;
    final id = await showPersonaPicker(context, selectedId: _persona?.id ?? defaultPersonaId);
    if (id == null) return;
    final persona = await PersonaStore.resolve(id);
    chat.personaId = persona.id;
    await LocalChatStore.upsert(chat);
    if (mounted) setState(() => _persona = persona);
  }

  /// The chat's personality; tap to switch it for this chat.
  Widget _buildPersonaChip() {
    return GestureDetector(
      onTap: _pickPersona,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.psychology_outlined, size: 13, color: YggColors.textMuted),
          const SizedBox(width: 3),
          Text(_persona?.name ?? '', style: TextStyle(fontSize: 11.5, color: YggColors.textMuted)),
        ],
      ),
    );
  }

  Future<void> _renameTitle() async {
    final chat = _chat;
    if (chat == null) return;
    final controller = TextEditingController(text: _title ?? '');
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
    if (newTitle == null || newTitle.trim().isEmpty) return;
    chat.title = newTitle.trim();
    await LocalChatStore.upsert(chat);
    if (!mounted) return;
    setState(() => _title = chat.title);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: YggColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(context),
            Expanded(
              child: _loading
                  ? Center(child: CircularProgressIndicator(color: YggColors.accent))
                  : Stack(
                      children: [
                        Positioned.fill(child: ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
                      itemCount: _items.length + (_thinking ? 1 : 0),
                      itemBuilder: (context, i) {
                        if (i == _items.length) return _buildThinking(context);
                        final item = _items[i];
                  return FadeInBubble(
                    key: ValueKey(item.id),
                    animate: _tracker.shouldAnimate(item.id),
                    child: _buildItem(context, item),
                  );
                      },
                    )),
                        Positioned(right: 16, bottom: 12, child: ScrollToBottomButton(tracker: _tracker)),
                      ],
                    ),
            ),
            ComposerBar(
              controller: _inputController,
              enabled: !_thinking,
              onSubmit: (text) => _send(text),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
      child: Row(
        children: [
          _headerIconButton(icon: Icons.menu, onTap: () => Navigator.of(context).pop()),
          const SizedBox(width: 12),
          Expanded(
            child: GestureDetector(
              onTap: _renameTitle,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(AppStrings.t('chat.headerLabel'), style: TextStyle(fontSize: 13, letterSpacing: 2.2, color: YggColors.textMuted, fontWeight: FontWeight.w500)),
                      const SizedBox(width: 10),
                      Flexible(child: _buildModelChip()),
                    ],
                  ),
                  Text(
                    (_title?.isNotEmpty ?? false) ? _title! : 'Nuevo chat',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 15, color: YggColors.text),
                  ),
                  _buildPersonaChip(),
                ],
              ),
            ),
          ),
          Tooltip(
            message: AppStrings.t('voice.mode.entry'),
            child: _headerIconButton(
              icon: Icons.graphic_eq,
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => VoiceModeScreen(profile: widget.profile))),
            ),
          ),
          const SizedBox(width: 8),
          _headerIconButton(icon: Icons.add, onTap: () => Navigator.of(context).pop('new')),
        ],
      ),
    );
  }

  Widget _headerIconButton({required IconData icon, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: YggColors.cardFillHigh, shape: BoxShape.circle),
        child: Icon(icon, color: YggColors.text, size: 18),
      ),
    );
  }

  Widget _buildThinking(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent)),
          const SizedBox(width: 8),
          Text(AppStrings.t('common.thinking'), style: TextStyle(color: YggColors.textMuted)),
        ],
      ),
    );
  }

  Widget _buildItem(BuildContext context, _Item item) {
    switch (item.kind) {
      case _Kind.syncTool:
        return SyncToolCard(status: item.status, toolName: item.toolName, detail: item.detail, onRetry: () => _retry(item));
      case _Kind.interactive:
        return InteractiveToolCard(
          status: item.status,
          detail: item.detail,
          toolName: item.toolName,
          onCancel: () => _cancelInteractive(item),
          onRetry: () => _retry(item),
        );
      case _Kind.suggestion:
        return SuggestionCard(
          suggestion: item.suggestion!,
          status: item.status,
          onAccept: () => _answerSuggestion(item, suggestionAccepted),
          onDismiss: () => _answerSuggestion(item, suggestionDismissed),
        );
      case _Kind.note:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Center(child: Text(item.text, style: TextStyle(color: YggColors.textMuted, fontSize: 12.5))),
        );
      case _Kind.user:
        return Align(
          alignment: Alignment.centerRight,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
          Container(
            margin: const EdgeInsets.symmetric(vertical: 4),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
            decoration: BoxDecoration(
              color: YggColors.text,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(20),
                topRight: Radius.circular(20),
                bottomRight: Radius.circular(6),
                bottomLeft: Radius.circular(20),
              ),
            ),
            child: Text(item.text, style: TextStyle(color: YggColors.surface, fontSize: 15, height: 1.45)),
          ),
              Padding(padding: const EdgeInsets.only(bottom: 4), child: CopyPill(text: item.text)),
            ],
          ),
        );
      case _Kind.assistant:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 7),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(padding: EdgeInsets.only(top: 3), child: RootRing(size: 20)),
                  const SizedBox(width: 11),
                  Expanded(
                    child: item.text.isEmpty ? Text('…', style: kAssistantProseStyle) : AssistantMarkdown(data: item.text),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(left: 31, top: 8),
                child: CopyPill(text: item.text),
              ),
            ],
          ),
        );
    }
  }
}
