import 'dart:convert';
import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../chat/chat_list_extras.dart';
import '../chat/composer_bar.dart';
import '../chat/copy_pill.dart';
import '../chat/interactive_tool_card.dart';
import '../chat/root_ring.dart';
import '../chat/sync_tool_card.dart';
import '../profiles/connection_profile.dart';
import '../theme/ygg_theme.dart';
import 'local_chat.dart';
import 'local_chat_store.dart';
import 'local_message.dart';
import 'standalone_chat_engine.dart';

enum _Kind { user, assistant, syncTool, interactive, note }

const _interactiveTools = {'phone_pick_file', 'phone_list_documents'};

class _Item {
  final String id;
  final _Kind kind;
  String text;
  String status;
  String? detail;
  String? toolName;

  _Item({required this.id, required this.kind, required this.text, this.status = '', this.toolName});
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
    final chat = existing ?? LocalChat(id: widget.chatId, profileId: widget.profile.id, title: widget.initialTitle);
    if (existing == null) await LocalChatStore.upsert(chat);
    if (!mounted) return;
    setState(() {
      _chat = chat;
      _title = chat.title ?? _title;
      for (final m in chat.messages) {
        if (m.role == LocalRole.user) {
          _items.add(_Item(id: _nextId(), kind: _Kind.user, text: m.text));
        } else if (m.role == LocalRole.assistant && m.text.trim().isNotEmpty) {
          _items.add(_Item(id: _nextId(), kind: _Kind.assistant, text: m.text));
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
                  child: Text(toolName.toUpperCase(), style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: YggColors.accent)),
                  child: Text(
                    AppStrings.t('dialog.moderateRiskBadge'),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: YggColors.accent),
                  ),
                ),
              ],
            ),
            if (args.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(_prettyJson(args), style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
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
          if (m.text.trim().isNotEmpty) {
            _items.add(_Item(id: _nextId(), kind: _Kind.assistant, text: m.text));
          }
          break;
        case LocalRole.tool:
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

  void _cancelInteractive(_Item item) {
    setState(() => item.status = 'cancelling');
    _engine.executor.cancelPending();
  }

  void _retry(_Item item) {
    final label = item.toolName ?? AppStrings.t('chat.retryLabelFallback');
    _send('${AppStrings.t('common.retry')}: $label');
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
                  ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
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
                  Text(AppStrings.t('chat.headerLabel'), style: const TextStyle(fontSize: 13, letterSpacing: 2.2, color: YggColors.textMuted, fontWeight: FontWeight.w500)),
                  Text(
                    (_title?.isNotEmpty ?? false) ? _title! : 'Nuevo chat',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15, color: YggColors.text),
                  ),
                ],
              ),
            ),
          ),
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
        decoration: const BoxDecoration(color: YggColors.cardFillHigh, shape: BoxShape.circle),
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
          const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent)),
          const SizedBox(width: 8),
          Text(AppStrings.t('common.thinking'), style: const TextStyle(color: YggColors.textMuted)),
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
      case _Kind.note:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Center(child: Text(item.text, style: const TextStyle(color: YggColors.textMuted, fontSize: 12.5))),
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
            decoration: const BoxDecoration(
              color: YggColors.text,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(20),
                topRight: Radius.circular(20),
                bottomRight: Radius.circular(6),
                bottomLeft: Radius.circular(20),
              ),
            ),
            child: Text(item.text, style: const TextStyle(color: YggColors.surface, fontSize: 15, height: 1.45)),
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
                    child: Text(
                      item.text.isEmpty ? '…' : item.text,
                      style: const TextStyle(fontWeight: FontWeight.w300, fontSize: 15.5, height: 1.6, color: YggColors.text),
                    ),
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
