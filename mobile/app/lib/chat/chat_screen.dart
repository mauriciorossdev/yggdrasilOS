import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';

import '../assistant/assistant_attachments.dart';
import '../assistant/assistant_tts.dart';
import '../assistant/assistant_usage.dart';
import '../assistant/assistant_usage_sheet.dart';
import '../capabilities/capability_registry.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'assistant_markdown.dart';
import 'composer_bar.dart';
import 'chat_list_extras.dart';
import 'copy_pill.dart';
import 'interactive_tool_card.dart';
import 'markdown_boundary.dart';
import 'root_ring.dart';
import 'sync_tool_card.dart';

enum _Kind { user, assistant, syncTool, approval, interactive, note }

/// tool.approval.requested doesn't carry the tool's sync/interactive `kind`
/// (design doc phone-gateway-connectivity-design.md §3.1 only puts `kind` on
/// device.tool.invoke.requested) — read from the local registry so the
/// approval card can show the "abre un selector" line ahead of the actual
/// invocation (UX doc §4).
bool _isInteractiveDeviceTool(String? name) => capabilityByName(name)?.isInteractive ?? false;

class _Item {
  final String id;
  final _Kind kind;
  String text;
  String status;
  String? detail;
  String? toolName;
  String? requestId;
  String? riskLevel;
  Map<String, dynamic>? args;
  bool respondedLocally = false;
  bool streaming;
  TurnUsage? usage;
  Timer? watchdog;

  _Item({
    required this.id,
    required this.kind,
    required this.text,
    this.status = '',
    this.toolName,
    this.requestId,
    this.riskLevel,
    this.args,
    this.streaming = false,
  });
}

/// One conversation. History comes from sessions.get (server-persisted, per
/// phone-gateway-connectivity-design.md §3.5); live turns come from the
/// shared gateway event stream, filtered here by payload.sessionKey. Card
/// states/copy follow notes/yggdrasil-mobile/mobile-chat-ux-flows.md §2-5.
/// All calls go through YggdrasilClient.call/sendMessage — the service file
/// itself stays Backend's territory (only one forwarding line was added
/// there, with the user's explicit go-ahead).
class ChatScreen extends StatefulWidget {
  final YggdrasilClient client;
  final Stream<Map<String, dynamic>> events;
  final Future<void> connected;
  final String sessionKey;

  /// Gateway agent to answer in this chat; null keeps the gateway's own
  /// defaultAgent (the key must stay out of chat.send entirely, never null —
  /// see YggdrasilClient.sendMessage).
  final String? agentId;
  final String? initialTitle;
  final String? initialMessage;
  final List<dynamic> slashCommands;

  const ChatScreen({
    super.key,
    required this.client,
    required this.events,
    required this.connected,
    required this.sessionKey,
    required this.slashCommands,
    this.agentId,
    this.initialTitle,
    this.initialMessage,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final List<_Item> _items = [];
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  late final _tracker = ChatListTracker(_scrollController);
  List<dynamic> _suggestions = [];
  StreamSubscription<Map<String, dynamic>>? _sub;
  String? _title;
  bool _thinking = false;

  // True from the moment THIS screen sends a message until its reply lands. The
  // gateway broadcasts every chat.final to all of the phone's connections, so
  // a turn started elsewhere (the quick-access bubble speaks its own replies)
  // must not also be read aloud here — it would play twice.
  bool _localTurn = false;
  int _seq = 0;
  _Item? _streamingReply;

  // markdown-streaming-render-design.md §3 — throttle, not debounce: caps
  // rebuild frequency during streaming (~16/sec) instead of waiting for a
  // pause that a continuous stream may never give. First chunk of a message
  // still renders immediately (see _onDelta) so the reply doesn't feel late.
  Timer? _renderThrottle;
  static const _throttleInterval = Duration(milliseconds: 60);

  @override
  void initState() {
    super.initState();
    _title = widget.initialTitle;
    _sub = widget.events.listen(_onEvent);
    if (_isAssistantChat) {
      AssistantUsage.instance.load();
      AssistantTts.instance.load();
    }
    _init();
  }

  Future<void> _init() async {
    await _loadHistory();
    if (mounted) _tracker.markHistory(_items.map((e) => e.id));
    final initial = widget.initialMessage?.trim();
    if (initial != null && initial.isNotEmpty) {
      _send(initial);
    }
  }

  @override
  void dispose() {
    if (_isAssistantChat) AssistantTts.instance.stop();
    _sub?.cancel();
    _renderThrottle?.cancel();
    for (final it in _items) {
      it.watchdog?.cancel();
    }
    _inputController.dispose();
    _tracker.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String _nextId() => 'i${_seq++}';

  // Usage/model controls only make sense for the assistant chat (explicit agent).
  bool get _isAssistantChat => widget.agentId != null;

  bool _forThisSession(Map payload) {
    final sk = payload['sessionKey'];
    return sk == null || sk == widget.sessionKey;
  }

  Future<void> _loadHistory() async {
    // The socket may be mid-reconnect (gateway redeploy, network switch):
    // retry a few times before telling the user the history didn't load.
    for (var attempt = 0; attempt < 4; attempt++) {
      if (!mounted) return;
      try {
        await widget.connected;
        await widget.client.whenOpen();
        await _loadHistoryOnce();
        return;
      } catch (_) {
        await Future.delayed(Duration(seconds: 1 + attempt * 2));
      }
    }
    if (!mounted) return;
    setState(() => _items.add(_Item(id: _nextId(), kind: _Kind.note, text: AppStrings.t('chat.historyError'))));
  }

  Future<void> _loadHistoryOnce() async {
    final res = await widget.client.call('sessions.get', {'sessionKey': widget.sessionKey});
    final session = res is Map ? res['session'] : null;
    // null = a new chat with no server-side history yet — nothing to show.
    if (session is! Map) return;
    final messages = (session['messages'] as List<dynamic>?) ?? [];
    if (!mounted) return;
    setState(() {
      _title = session['title']?.toString() ?? _title;
      for (final m in messages) {
        final map = m as Map<String, dynamic>;
        final roleName = map['role']?.toString();
        final text = map['content']?.toString() ?? '';
        // The stored transcript also holds the tool loop's internals: tool
        // results (role "tool") and assistant turns that only carry tool
        // calls (no text). Neither is something the user said or was told.
        if (roleName != 'user' && roleName != 'assistant') continue;
        if (roleName == 'assistant' && text.trim().isEmpty) continue;
        final role = roleName == 'user' ? _Kind.user : _Kind.assistant;
        final item = _Item(id: _nextId(), kind: role, text: text);
        if (_isAssistantChat && role == _Kind.assistant) {
          item.usage = AssistantUsage.instance.usageForReply(text);
        }
        _items.add(item);
      }
    });
    _scrollToBottom();
  }

  void _onEvent(Map<String, dynamic> message) {
    final event = message['event']?.toString();
    final rawPayload = message['payload'];
    final p = rawPayload is Map ? rawPayload : const {};
    if (!_forThisSession(p)) return;

    switch (event) {
      case 'chat.delta':
        _onDelta(p['text']?.toString() ?? '');
        break;
      case 'chat.final':
        _onFinal(p['text']?.toString() ?? '', p['usage'], p['harnessId']?.toString());
        break;
      case 'turn.start':
        setState(() => _thinking = true);
        break;
      case 'turn.end':
        _onTurnEnd(p);
        break;
      case 'tool.execute':
        _onToolExecute(p);
        break;
      case 'tool.approval.requested':
        _onApprovalRequested(p);
        break;
      case 'tool.approval.resolved':
        _onApprovalResolved(p);
        break;
      case 'device.tool.invoke.requested':
        _onDeviceToolInvoke(p);
        break;
      case 'device.tool.invoke.progress':
        _onDeviceToolProgress(p);
        break;
      case 'device.tool.invoke.cancel':
        _onDeviceToolCancel(p);
        break;
      default:
        break;
    }
  }

  void _onDelta(String text) {
    if (text.isEmpty) return;
    final reply = _streamingReply;
    if (reply == null) {
      // First chunk of the message: setState immediately, no throttle — the
      // reply shouldn't feel late to start.
      setState(() {
        _thinking = false;
        final item = _Item(id: _nextId(), kind: _Kind.assistant, text: text, streaming: true);
        _streamingReply = item;
        _items.add(item);
      });
    } else {
      _thinking = false;
      reply.text += text; // outside setState — doesn't trigger a rebuild by itself
      if (_renderThrottle?.isActive ?? false) {
        _scrollToBottom();
        return;
      }
      _renderThrottle = Timer(_throttleInterval, () {
        if (mounted) setState(() {}); // next build reads the already-updated item.text
      });
    }
    _scrollToBottom();
  }

  void _onFinal(String text, [dynamic rawUsage, String? harnessId]) {
    _renderThrottle?.cancel(); // don't let a pending tick land after this setState
    TurnUsage? turnUsage;
    if (_isAssistantChat && rawUsage is Map) {
      final inTok = (rawUsage['inputTokens'] as num?)?.toInt() ?? 0;
      final outTok = (rawUsage['outputTokens'] as num?)?.toInt() ?? 0;
      final cacheRead = (rawUsage['cacheReadTokens'] as num?)?.toInt() ?? 0;
      final cacheWrite = (rawUsage['cacheWriteTokens'] as num?)?.toInt() ?? 0;
      if (inTok + outTok + cacheRead + cacheWrite > 0) {
        turnUsage = AssistantUsage.instance.record(inTok, outTok, text, cacheRead: cacheRead, cacheWrite: cacheWrite);
      }
    }
    setState(() {
      _thinking = false;
      final reply = _streamingReply;
      if (reply != null) {
        reply.streaming = false;
        reply.usage = turnUsage;
      } else if (text.isNotEmpty) {
        _items.add(_Item(id: _nextId(), kind: _Kind.assistant, text: text)..usage = turnUsage);
      }
      _streamingReply = null;
    });
    // Mine = a reply to something this screen sent, or a server-initiated
    // message (reminders) that nobody else will speak.
    final mine = _localTurn || harnessId == 'assistant-service';
    _localTurn = false;
    final tts = AssistantTts.instance;
    if (_isAssistantChat && tts.enabled && text.isNotEmpty && mine) {
      tts.speak(widget.client, text);
    }
    _scrollToBottom();
  }

  // Sync device tools (open_app/list_installed_apps) resolve inside the
  // client with no explicit gateway->UI "done" event, and today nothing in
  // the gateway even emits tool.execute yet (grepped — dead event). Turn
  // ending is the safety net that stops any still-"running"/"pending" card
  // from looking stuck forever.
  void _onTurnEnd(Map payload) {
    final isError = payload['classification'] == 'error';
    setState(() {
      _thinking = false;
      if (isError) {
        _items.add(_Item(id: _nextId(), kind: _Kind.note, text: AppStrings.t('chat.turnError')));
      }
      for (final it in _items) {
        if (it.kind == _Kind.syncTool && it.status == 'running') {
          _resolveItem(it, isError ? 'error' : 'ok');
        } else if (it.kind == _Kind.interactive &&
            (it.status == 'opening' || it.status == 'awaitingUser' || it.status == 'cancelling')) {
          _resolveItem(it, isError ? 'failed' : 'resolvedOk');
        }
      }
    });
    _scrollToBottom();
  }

  void _resolveItem(_Item item, String status, {String? detail}) {
    item.watchdog?.cancel();
    item.watchdog = null;
    item.status = status;
    if (detail != null) item.detail = detail;
  }

  void _armWatchdog(_Item item, Duration duration, String timeoutStatus, bool Function() stillPending) {
    item.watchdog?.cancel();
    item.watchdog = Timer(duration, () {
      if (!mounted || !stillPending()) return;
      setState(() => item.status = timeoutStatus);
    });
  }

  // Generic tool-loop resolution (sync AND interactive device tools are
  // still just tool calls from the LLM's tool-loop perspective, UX doc §3/§5
  // — once the gateway actually emits tool.execute around them this is the
  // precise signal; turn.end above is only the fallback).
  void _onToolExecute(Map payload) {
    final toolName = payload['toolName']?.toString() ?? '?';
    final status = payload['status']?.toString() ?? 'running';
    if (status == 'running') return;
    final error = payload['error']?.toString();
    final result = payload['result']?.toString();

    setState(() {
      _Item? match;
      for (final it in _items.reversed) {
        final pending = (it.kind == _Kind.syncTool && it.status == 'running') ||
            (it.kind == _Kind.interactive &&
                (it.status == 'opening' || it.status == 'awaitingUser' || it.status == 'cancelling'));
        if (pending && it.toolName == toolName) {
          match = it;
          break;
        }
      }
      if (match == null) return;

      if (match.kind == _Kind.syncTool) {
        _resolveItem(match, status == 'ok' ? 'ok' : 'error', detail: status == 'ok' ? result : (error ?? 'Error desconocido'));
      } else if (status == 'ok') {
        _resolveItem(match, 'resolvedOk', detail: result);
      } else if (error != null && error.toLowerCase().contains('cancel')) {
        _resolveItem(match, 'cancelledByPhone', detail: error);
      } else {
        _resolveItem(match, 'failed', detail: error ?? 'Error desconocido');
      }
    });
    _scrollToBottom();
  }

  void _onApprovalRequested(Map payload) {
    final toolName = payload['toolName']?.toString() ?? '?';
    setState(() {
      _items.add(_Item(
        id: _nextId(),
        kind: _Kind.approval,
        text: toolName,
        status: 'pending',
        requestId: payload['requestId']?.toString(),
        toolName: toolName,
        riskLevel: payload['riskLevel']?.toString(),
        args: (payload['args'] as Map?)?.cast<String, dynamic>(),
      ));
    });
    _scrollToBottom();
  }

  // If tool.approval.resolved lands for an item the user never tapped
  // locally, that means approvalMode auto-resolved it (e.g. "yolo") — shown
  // distinctly per UX doc §4 so it's never a silent surprise.
  void _onApprovalResolved(Map payload) {
    final requestId = payload['requestId']?.toString();
    final approved = payload['approved'] == true;
    setState(() {
      for (final it in _items) {
        if (it.kind == _Kind.approval && it.requestId == requestId) {
          it.status = approved
              ? (it.respondedLocally ? 'approved' : 'autoApproved')
              : (it.respondedLocally ? 'denied' : 'autoDenied');
        }
      }
    });
  }

  Future<void> _respondApproval(_Item item, bool approved) async {
    final requestId = item.requestId;
    if (requestId == null) return;
    setState(() {
      item.respondedLocally = true;
      item.status = approved ? 'approved' : 'denied';
    });
    try {
      await widget.client.call('tools.approve', {'requestId': requestId, 'approved': approved});
    } catch (_) {
      // tool.approval.resolved will correct local state if it still arrives
    }
  }

  void _onDeviceToolInvoke(Map payload) {
    final toolName = payload['toolName']?.toString() ?? '?';
    final requestId = payload['requestId']?.toString();
    final kind = payload['kind']?.toString() ?? 'sync';
    setState(() {
      if (kind == 'interactive') {
        final item = _Item(
          id: _nextId(),
          kind: _Kind.interactive,
          text: toolName,
          status: 'opening',
          toolName: toolName,
          requestId: requestId,
        );
        _items.add(item);
        // Long ceiling only — SAF waits on a human, per design doc §3.3.
        _armWatchdog(
          item,
          const Duration(minutes: 10),
          'timedOut',
          () => item.status == 'opening' || item.status == 'awaitingUser' || item.status == 'cancelling',
        );
      } else {
        final item = _Item(
          id: _nextId(),
          kind: _Kind.syncTool,
          text: toolName,
          status: 'running',
          toolName: toolName,
          requestId: requestId,
        );
        _items.add(item);
        _armWatchdog(item, const Duration(seconds: 30), 'timeout', () => item.status == 'running');
      }
    });
    _scrollToBottom();
  }

  void _onDeviceToolProgress(Map payload) {
    final requestId = payload['requestId']?.toString();
    final status = payload['status']?.toString();
    if (requestId == null || status != 'awaiting_user') return;
    setState(() {
      for (final it in _items) {
        if (it.kind == _Kind.interactive && it.requestId == requestId) {
          it.status = 'awaitingUser';
        }
      }
    });
  }

  void _onDeviceToolCancel(Map payload) {
    final requestId = payload['requestId']?.toString();
    if (requestId == null) return;
    setState(() {
      for (final it in _items) {
        if (it.kind == _Kind.interactive && it.requestId == requestId) {
          _resolveItem(it, 'cancelled');
        }
      }
    });
  }

  // Confirmed real client->gateway RPC (methods.ts:841-851) — cancellation
  // is optimistic: the gateway deletes the pending call and rejects it the
  // moment this RPC lands, without waiting for the phone to actually close
  // the picker. So 'cancelled' is set as soon as the call resolves, not on
  // a timer; the watchdog below is only a safety net for a dead socket.
  // A device.tools.result that arrives late for this requestId is rejected
  // gateway-side (no pending entry left) and never reaches the UI as an
  // event, so there's nothing to special-case here.
  Future<void> _cancelInteractive(_Item item) async {
    final requestId = item.requestId;
    if (requestId == null) return;
    setState(() => item.status = 'cancelling');
    try {
      await widget.client.call('device.tool.invoke.cancel', {'requestId': requestId});
      if (!mounted) return;
      setState(() => _resolveItem(item, 'cancelled'));
      return;
    } catch (_) {
      // socket/call didn't resolve — fall through to the watchdog below
    }
    _armWatchdog(item, const Duration(seconds: 8), 'cancelled', () => item.status == 'cancelling');
  }

  // Confirmed UX decision (design doc §4 point 11), not a protocol gap:
  // retry is a plain chat.send nudge, not a re-invoke RPC — reusing the
  // normal tool-loop/approval path keeps it attributable to a real LLM turn.
  // Rendered as a system line, not a user bubble, per the doc's suggestion —
  // chat.send doesn't care how the client displays the text it sends.
  void _retry(_Item item) {
    final label = item.toolName ?? AppStrings.t('chat.retryLabelFallback');
    final text = '${AppStrings.t('common.retry')}: $label';
    setState(() {
      _items.add(_Item(id: _nextId(), kind: _Kind.note, text: AppStrings.tp('chat.retryingNote', {'label': label})));
      _suggestions = [];
      _thinking = true;
    });
    _localTurn = true;
    widget.client.sendMessage(text, sessionKey: widget.sessionKey, agentId: widget.agentId, model: _isAssistantChat ? AssistantUsage.instance.modelId : null);
    _scrollToBottom();
  }

  Future<String?> _attachDocument() async {
    final source = await showModalBottomSheet<AttachmentSource>(
      context: context,
      backgroundColor: YggColors.surface,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (src, icon, key) in const [
              (AttachmentSource.camera, Icons.photo_camera_outlined, 'attach.camera'),
              (AttachmentSource.gallery, Icons.photo_library_outlined, 'attach.gallery'),
              (AttachmentSource.file, Icons.attach_file, 'attach.file'),
            ])
              ListTile(
                leading: Icon(icon, color: YggColors.accent),
                title: Text(AppStrings.t(key), style: const TextStyle(color: YggColors.text)),
                onTap: () => Navigator.pop(context, src),
              ),
          ],
        ),
      ),
    );
    if (source == null) return null;
    try {
      return await pickAndUploadToAssistant(widget.client, source: source);
    } catch (e) {
      if (mounted) {
        final msg = '$e'.replaceFirst('Exception: ', '');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${AppStrings.t('assistant.attachFailed')}: $msg')),
        );
      }
      return null;
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
    final value = (text ?? _inputController.text).trim();
    if (value.isEmpty) return;
    if (_isAssistantChat) AssistantTts.instance.stop();
    setState(() {
      _items.add(_Item(id: _nextId(), kind: _Kind.user, text: value));
      _suggestions = [];
      _thinking = true;
    });
    _localTurn = true;
    widget.client.sendMessage(value, sessionKey: widget.sessionKey, agentId: widget.agentId, model: _isAssistantChat ? AssistantUsage.instance.modelId : null);
    _inputController.clear();
    _scrollToBottom();
  }

  Future<void> _renameTitle() async {
    final controller = TextEditingController(text: _title ?? '');
    final newTitle = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('dialog.renameChatTitle')),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: Text(AppStrings.t('common.save')),
          ),
        ],
      ),
    );
    if (newTitle == null || newTitle.trim().isEmpty) return;
    try {
      await widget.client.call('sessions.patch', {'sessionKey': widget.sessionKey, 'title': newTitle.trim()});
      if (!mounted) return;
      setState(() => _title = newTitle.trim());
    } catch (_) {
      // best-effort rename
    }
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
              child: Stack(
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
            if (_suggestions.isNotEmpty) _buildSuggestions(),
            ComposerBar(
              controller: _inputController,
              enabled: !_thinking,
              onAttach: _isAssistantChat ? _attachDocument : null,
              onChanged: (text) {
                if (text.startsWith('/')) {
                  final query = text.substring(1).toLowerCase();
                  setState(() {
                    _suggestions = widget.slashCommands
                        .where((cmd) => cmd['name'].toString().toLowerCase().contains(query))
                        .toList();
                  });
                } else if (_suggestions.isNotEmpty) {
                  setState(() => _suggestions = []);
                }
              },
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
                      Text(
                        AppStrings.t('chat.headerLabel'),
                        style: const TextStyle(fontSize: 13, letterSpacing: 2.2, color: YggColors.textMuted, fontWeight: FontWeight.w500),
                      ),
                      if (_isAssistantChat) ...[
                        const SizedBox(width: 10),
                        _buildUsageChip(context),
                      ],
                    ],
                  ),
                  Text(
                    (_title?.isNotEmpty ?? false) ? _title! : AppStrings.t('common.newChat'),
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

  Widget _buildSpeakButton(String text) {
    final tts = AssistantTts.instance;
    return AnimatedBuilder(
      animation: tts,
      builder: (context, _) => GestureDetector(
        onTap: () => tts.speaking ? tts.stop() : tts.speak(widget.client, text),
        child: Tooltip(
          message: AppStrings.t(tts.speaking ? 'tts.stop' : 'tts.speak'),
          child: Container(
            width: 30,
            height: 26,
            decoration: BoxDecoration(color: YggColors.cardFillHigh, borderRadius: BorderRadius.circular(13)),
            child: Icon(tts.speaking ? Icons.stop_rounded : Icons.volume_up_rounded, size: 15, color: YggColors.textMuted),
          ),
        ),
      ),
    );
  }

  /// Running usage next to the "CHAT" label; tap for model/budget details.
  Widget _buildUsageChip(BuildContext context) {
    final usage = AssistantUsage.instance;
    return AnimatedBuilder(
      animation: usage,
      builder: (context, _) {
        final remaining = usage.remainingUsd;
        final label = remaining != null
            ? '${formatTokens(usage.totalIn + usage.totalOut)} tok · ${formatUsd(remaining < 0 ? 0 : remaining)} ${AppStrings.t('usage.chipLeft')}'
            : usage.totalUsd > 0
                ? '${formatTokens(usage.totalIn + usage.totalOut)} tok · ${formatUsd(usage.totalUsd)}'
                : '${formatTokens(usage.totalIn + usage.totalOut)} tok';
        return GestureDetector(
          onTap: () => showAssistantUsageSheet(context, client: widget.client),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: YggColors.cardFillHigh,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: remaining != null && remaining <= 0 ? YggColors.errorRed : YggColors.hairline),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label, style: const TextStyle(fontSize: 11.5, color: YggColors.accent)),
                const SizedBox(width: 4),
                const Icon(Icons.tune, size: 12, color: YggColors.textMuted),
              ],
            ),
          ),
        );
      },
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
        return _buildSyncToolCard(context, item);
      case _Kind.approval:
        return _buildApprovalCard(context, item);
      case _Kind.interactive:
        return _buildInteractiveCard(context, item);
      case _Kind.note:
        return _pill(context, [Flexible(child: Text(item.text, style: const TextStyle(color: YggColors.textMuted, fontSize: 12.5)))]);
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
        // markdown-streaming-render-design.md §1/§2 — while streaming, only
        // the "safe prefix" (up to the last unclosed marker) is parsed as
        // markdown; the "unsafe tail" keeps rendering through the same
        // RichText/TextSpan/_BlinkingCaret this always used, just fed the
        // tail instead of the full text. Once streaming ends, the whole
        // message is markdown and the plain-text path disappears entirely.
        final text = item.text;
        final boundary = item.streaming ? findSafeMarkdownBoundary(text) : text.length;
        final safePrefix = text.substring(0, boundary);
        final unsafeTail = text.substring(boundary);
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
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (safePrefix.isNotEmpty) AssistantMarkdown(data: safePrefix),
                        if (unsafeTail.isNotEmpty || text.isEmpty)
                          RichText(
                            text: TextSpan(
                              style: kAssistantProseStyle,
                              children: [
                                TextSpan(text: text.isEmpty ? '…' : unsafeTail),
                                if (item.streaming)
                                  const WidgetSpan(
                                    alignment: PlaceholderAlignment.middle,
                                    child: Padding(
                                      padding: EdgeInsets.only(left: 3),
                                      child: _BlinkingCaret(),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              if (!item.streaming)
                Padding(
                  padding: const EdgeInsets.only(left: 31, top: 8),
                  child: Row(
                    children: [
                      CopyPill(text: item.text),
                      if (_isAssistantChat) ...[
                        const SizedBox(width: 8),
                        _buildSpeakButton(item.text),
                      ],
                      if (item.usage != null) ...[
                        const SizedBox(width: 10),
                        Flexible(
                          child: Text(
                            '↑${formatTokens(item.usage!.totalInput)} ↓${formatTokens(item.usage!.outTokens)} tok'
                            '${item.usage!.cacheRead > 0 ? ' · ⚡${formatTokens(item.usage!.cacheRead)}' : ''}'
                            '${item.usage!.usd != null ? ' · ${formatUsd(item.usage!.usd!)}' : ''}',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11.5, color: YggColors.textFaint),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        );
    }
  }

  // Compact centered pill — used by note/sync-tool/interactive cards (UX doc
  // §3/§5: no expanding, one line + optional action below).
  Widget _pill(BuildContext context, List<Widget> content, {Widget? action}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(mainAxisSize: MainAxisSize.min, children: content),
              ?action,
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSyncToolCard(BuildContext context, _Item item) {
    return SyncToolCard(
      status: item.status,
      toolName: item.toolName,
      detail: item.detail,
      onRetry: () => _retry(item),
    );
  }

  String _riskLabel(String? riskLevel) {
    switch (riskLevel) {
      case 'destructive':
        return 'alto';
      case 'moderate':
        return 'medio';
      case 'safe':
        return 'bajo';
      default:
        return 'sin clasificar';
    }
  }

  String _prettyJson(Map<String, dynamic> value) {
    try {
      return const JsonEncoder.withIndent('  ').convert(value);
    } catch (_) {
      return value.toString();
    }
  }

  Widget _buildApprovalCard(BuildContext context, _Item item) {
    if (item.status != 'pending') {
      final String line;
      final toolName = item.toolName ?? '';
      switch (item.status) {
        case 'approved':
          line = AppStrings.tp('chat.approvedLine', {'tool': toolName});
          break;
        case 'autoApproved':
          line = AppStrings.tp('chat.autoApprovedLine', {'tool': toolName});
          break;
        case 'denied':
          line = AppStrings.tp('chat.rejectedLine', {'tool': toolName});
          break;
        case 'autoDenied':
          line = AppStrings.tp('chat.autoRejectedLine', {'tool': toolName});
          break;
        default:
          line = '$toolName: ${item.status}';
      }
      return Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(color: YggColors.cardFill, borderRadius: BorderRadius.circular(14), border: Border.all(color: YggColors.hairline)),
          child: Text(line, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: Color.fromRGBO(244, 239, 230, 0.55))),
        ),
      );
    }

    final isInteractive = _isInteractiveDeviceTool(item.toolName);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(color: YggColors.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: YggColors.hairline)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  (item.toolName ?? '').toUpperCase(),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 11, letterSpacing: 1.1, color: Color.fromRGBO(244, 239, 230, 0.55)),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: const Color.fromRGBO(201, 165, 78, 0.55))),
                child: Text(
                  _riskLabel(item.riskLevel).toUpperCase(),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 0.8, color: YggColors.accent),
                ),
              ),
            ],
          ),
          if (item.args != null && item.args!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              _prettyJson(item.args!),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12, height: 1.5, color: Color.fromRGBO(244, 239, 230, 0.6)),
            ),
          ],
          if (isInteractive) ...[
            const SizedBox(height: 8),
            Text(
              AppStrings.t('chat.opensFilePicker'),
              style: const TextStyle(fontWeight: FontWeight.w300, fontSize: 13, color: Color.fromRGBO(244, 239, 230, 0.7)),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: () => _respondApproval(item, false),
                  child: Container(
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: YggColors.hairlineStrong)),
                    child: Text(AppStrings.t('common.reject'), style: const TextStyle(fontSize: 13.5, color: Color.fromRGBO(244, 239, 230, 0.75))),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: GestureDetector(
                  onTap: () => _respondApproval(item, true),
                  child: Container(
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: YggColors.accent, borderRadius: BorderRadius.circular(999)),
                    child: Text(AppStrings.t('common.approve'), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: YggColors.surface)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildInteractiveCard(BuildContext context, _Item item) {
    return InteractiveToolCard(
      status: item.status,
      detail: item.detail,
      toolName: item.toolName,
      onCancel: () => _cancelInteractive(item),
      onRetry: () => _retry(item),
    );
  }

  Widget _buildSuggestions() {
    return Container(
      constraints: const BoxConstraints(maxHeight: 160),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: Theme.of(context).dividerColor))),
      child: ListView.builder(
        shrinkWrap: true,
        itemCount: _suggestions.length,
        itemBuilder: (context, index) {
          final cmd = _suggestions[index];
          return ListTile(
            dense: true,
            title: Text('/${cmd['name']}'),
            subtitle: Text(cmd['description']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () {
              final name = cmd['name'].toString();
              _inputController.text = name.startsWith('/') ? name : '/$name';
              setState(() => _suggestions = []);
            },
          );
        },
      ),
    );
  }

}

class _BlinkingCaret extends StatefulWidget {
  const _BlinkingCaret();

  @override
  State<_BlinkingCaret> createState() => _BlinkingCaretState();
}

class _BlinkingCaretState extends State<_BlinkingCaret> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) => Opacity(opacity: _controller.value < 0.5 ? 1 : 0.15, child: child),
      child: Container(width: 7, height: 15, color: YggColors.accent),
    );
  }
}
