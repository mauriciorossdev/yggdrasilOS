import 'dart:async';

import 'package:flutter/material.dart';

import '../chat/chat_list_extras.dart';
import '../chat/voice_mic_button.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import 'claude_transcript_view.dart';

const _pollInterval = Duration(milliseconds: 1500);

// Rough monospace metric (~0.6x font size per character) — precise glyph
// metrics aren't worth measuring here, this just needs to be "close enough"
// that lines wrap near the screen edge instead of at some unrelated width.
const _monoCharWidthRatio = 0.6;
const _bodyFontSize = 12.5;
const _bodyHorizontalPadding =
    24.0; // 12px each side, matches the SingleChildScrollView padding below.

/// The actual chat body (message area + composer) for one pane, factored out
/// of TerminalViewScreen so it can be embedded WITHOUT that screen's own
/// Scaffold/AppBar — ProjectWorkspaceScreen's split view puts this directly
/// next to a preview panel under one shared AppBar. TerminalViewScreen itself
/// is now just a thin Scaffold wrapper around this widget (unchanged
/// behavior/poll semantics for every existing caller).
class TerminalChatView extends StatefulWidget {
  final YggdrasilClient client;
  final String paneId;
  // "claude" -> parsed chat view (claude_transcript_view.dart) instead of
  // raw ANSI text, reading terminals.transcript instead of terminals.read.
  // Any other value (or null: plain shell, agy/omp/copilot, the Yggdrasil
  // TUI) keeps today's exact raw-text behavior unchanged.
  final String? harnessCommand;
  // Shows an attach button; returns text to insert into the input (e.g.
  // "@/home/mross/Inbox/chat/foto.jpg "), or null if nothing was attached.
  final Future<String?> Function()? onAttach;
  // Placeholder override for the composer — ProjectWorkspaceScreen uses a
  // more specific hint ("Escribe al orquestador…") than the plain
  // terminalInputHint every other caller keeps using.
  final String? inputHint;

  const TerminalChatView({
    super.key,
    required this.client,
    required this.paneId,
    this.harnessCommand,
    this.onAttach,
    this.inputHint,
  });

  @override
  State<TerminalChatView> createState() => _TerminalChatViewState();
}

class _TerminalChatViewState extends State<TerminalChatView> {
  final _scrollController = ScrollController();
  late final _tracker = ChatListTracker(_scrollController);
  final _inputController = TextEditingController();
  Timer? _pollTimer;
  String _text = '';
  List<TranscriptMessage> _transcript = [];
  bool _showTranscript = false;
  bool _loading = true;
  String? _error;
  bool _sending = false;
  bool _attaching = false;
  // Reasonable default for the very first poll (fired before didChangeDependencies
  // has a MediaQuery to compute the real value from).
  int _cols = 48;

  @override
  void initState() {
    super.initState();
    // Widens the REAL pty so a TUI (Ink-based `claude` panes) re-renders its
    // own output at a phone-readable width — a real side effect visible on
    // the desktop pane too while this screen is open (see
    // terminals.ts's expandTerminalForMobile). Fire-and-forget: the first
    // poll(s) may still show the narrow pre-expand content for a moment,
    // self-corrects on the next tick.
    unawaited(widget.client.call('terminals.expand', {'id': widget.paneId}).catchError((_) {}));
    _poll();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _poll());
  }

  @override
  void didUpdateWidget(covariant TerminalChatView oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Switching panes (Workspace's pane switcher) reuses this same State via
    // Flutter's element reuse — reset and start polling the new pane instead
    // of continuing to show/poll the old one.
    if (oldWidget.paneId != widget.paneId || oldWidget.client != widget.client) {
      unawaited(oldWidget.client.call('terminals.restore', {'id': oldWidget.paneId}).catchError((_) {}));
      unawaited(widget.client.call('terminals.expand', {'id': widget.paneId}).catchError((_) {}));
      setState(() {
        _text = '';
        _transcript = [];
        _showTranscript = false;
        _loading = true;
        _error = null;
      });
      _poll();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final width = MediaQuery.of(context).size.width - _bodyHorizontalPadding;
    final charWidth = _bodyFontSize * _monoCharWidthRatio;
    _cols = (width / charWidth).floor().clamp(30, 120);
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    // Pairs with the terminals.expand call in initState — restores the
    // desktop pane's own native size (widget.client stays alive, owned by
    // whichever screen created it, so this send still goes out after this
    // widget itself is torn down).
    // catchError: the client may already be closed (PiChatScreen swaps in a
    // fresh one after a reconnect, disposing this screen).
    unawaited(widget.client.call('terminals.restore', {'id': widget.paneId}).catchError((_) {}));
    _tracker.dispose();
    _scrollController.dispose();
    _inputController.dispose();
    super.dispose();
  }

  Future<void> _poll() async {
    final isClaude = widget.harnessCommand == 'claude';
    try {
      List<TranscriptMessage>? transcript;
      String? text;

      if (isClaude) {
        final res = await widget.client.call('terminals.transcript', {'id': widget.paneId});
        final available = res is Map && res['available'] == true;
        if (available) {
          final rawMessages = (res['messages'] as List?) ?? const [];
          transcript = rawMessages
              .whereType<Map>()
              .map((m) => TranscriptMessage.fromJson(m))
              .toList();
        }
      }

      // Either this isn't a claude pane, or terminals.transcript came back
      // unavailable (discovery failed) — degrade to the same raw text every
      // other pane shows, transparently, on this same tick.
      if (transcript == null) {
        final res = await widget.client.call('terminals.read', {
          'id': widget.paneId,
          'maxChars': 8000,
          'cols': _cols,
        });
        text = (res is Map ? res['text'] : null)?.toString() ?? '';
      }

      if (!mounted) return;
      final wasAtBottom =
          !_scrollController.hasClients ||
          _scrollController.position.pixels >=
              _scrollController.position.maxScrollExtent - 40;
      setState(() {
        if (transcript != null) {
          _transcript = transcript;
          _showTranscript = true;
        } else {
          _text = text!;
          _showTranscript = false;
        }
        _loading = false;
        _error = null;
      });
      if (wasAtBottom) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!_scrollController.hasClients) return;
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  // Transcribes into the input only — the human still presses send, unlike
  // the main chat's ComposerBar which auto-submits on recognition (this
  // input is a raw terminal command, worth a chance to double-check/edit
  // before it goes anywhere).
  void _onVoiceRecognized(String text) {
    final current = _inputController.text;
    _inputController.text = current.isEmpty ? text : '$current $text';
    _inputController.selection = TextSelection.collapsed(
      offset: _inputController.text.length,
    );
  }

  // Prompt-card buttons (Pi chat): one whitelisted key, then refresh right
  // away so the card reflects it without waiting for the next poll.
  Future<void> _sendKey(String key) async {
    try {
      await widget.client.call('terminals.key', {'id': widget.paneId, 'key': key}, timeout: const Duration(seconds: 10));
      await Future<void>.delayed(const Duration(milliseconds: 250));
    } catch (e) {
      if (mounted) {
        final msg = e is Map ? (e['message'] ?? e).toString() : '$e';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      }
    }
    await _poll();
  }

  Future<void> _attach() async {
    final onAttach = widget.onAttach;
    if (onAttach == null || _attaching) return;
    setState(() => _attaching = true);
    try {
      final text = await onAttach();
      if (text == null || !mounted) return;
      final current = _inputController.text;
      _inputController.text = current.isEmpty || current.endsWith(' ') ? '$current$text' : '$current $text';
      _inputController.selection = TextSelection.collapsed(offset: _inputController.text.length);
    } finally {
      if (mounted) setState(() => _attaching = false);
    }
  }

  // Quick keys: a phone keyboard has no Esc/Ctrl/arrows, so these write the raw
  // control sequences straight to the pty through terminals.write (which hands the
  // text to the pane untouched) with no Enter appended — except Enter itself.
  Future<void> _sendRaw(String text, {bool pressEnter = false}) async {
    try {
      await widget.client.call('terminals.write', {'id': widget.paneId, 'text': text, 'pressEnter': pressEnter});
      await Future<void>.delayed(const Duration(milliseconds: 250));
    } catch (e) {
      if (mounted) {
        final msg = e is Map ? (e['message'] ?? e).toString() : '$e';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      }
    }
    await _poll();
  }

  Widget _quickKeys() {
    Widget key(String label, VoidCallback onTap, {String? semantics}) => Semantics(
          button: true,
          label: semantics ?? label,
          excludeSemantics: true,
          child: Material(
            color: YggColors.surface,
            shape: StadiumBorder(side: BorderSide(color: YggColors.border)),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap,
              child: Container(
                height: 36,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                child: Text(label, style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, color: YggColors.text2)),
              ),
            ),
          ),
        );
    return SizedBox(
      height: 36,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          key('Enter', () => _sendRaw('', pressEnter: true)),
          const SizedBox(width: 8),
          key('Esc', () => _sendRaw('\x1b')),
          const SizedBox(width: 8),
          key('Ctrl+C', () => _sendRaw('\x03')),
          const SizedBox(width: 8),
          key('Tab', () => _sendRaw('\t')),
          const SizedBox(width: 8),
          key('↑', () => _sendRaw('\x1b[A'), semantics: AppStrings.t('terminal.keyUp')),
          const SizedBox(width: 8),
          key('↓', () => _sendRaw('\x1b[B'), semantics: AppStrings.t('terminal.keyDown')),
        ],
      ),
    );
  }

  Future<void> _send() async {
    final text = _inputController.text;
    if (text.trim().isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.client.call('terminals.write', {
        'id': widget.paneId,
        'text': text,
        'pressEnter': true,
      });
      _inputController.clear();
      await _poll();
    } catch (_) {
      // Best-effort — the next poll tick will show whatever actually happened.
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              Positioned.fill(
                child: _loading
              ? Center(
                  child: CircularProgressIndicator(color: YggColors.accent),
                )
              : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    '${AppStrings.t('common.errorPrefix')}: $_error',
                    style: TextStyle(color: YggColors.textMuted),
                  ),
                )
              : _showTranscript
              ? ClaudeTranscriptView(messages: _transcript, scrollController: _scrollController, onPromptKey: _sendKey, tracker: _tracker)
              : SingleChildScrollView(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(12),
                  child: SelectableText(
                    _text.isEmpty
                        ? AppStrings.t('projects.terminalEmpty')
                        : _text,
                    style: TextStyle(
                      fontFamily: YggFonts.mono,
                      fontSize: 12.5,
                      color: YggColors.text,
                      height: 1.4,
                    ),
                  ),
                ),
              ),
              Positioned(right: 16, bottom: 12, child: ScrollToBottomButton(tracker: _tracker)),
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Pi chats (they pass onAttach) drive their own prompt cards.
                if (widget.onAttach == null) ...[_quickKeys(), const SizedBox(height: 10)],
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: YggColors.surface,
                    borderRadius: BorderRadius.circular(28),
                    border: Border.all(color: YggColors.borderStrong),
                  ),
                  child: Row(
                    // Buttons stay on the bottom line while the input grows.
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (widget.onAttach != null) ...[
                        _attaching
                            ? SizedBox(width: 40, height: 40, child: Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent))))
                            : YggIconButton(
                                icon: Icons.attach_file,
                                size: 40,
                                iconSize: 18,
                                circle: true,
                                style: YggIconButtonStyle.tint,
                                tooltip: AppStrings.t('pi.attach'),
                                onTap: _attach,
                              ),
                        const SizedBox(width: 6),
                      ] else
                        const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          controller: _inputController,
                          cursorColor: YggColors.accent,
                          style: TextStyle(fontFamily: YggFonts.mono, fontSize: 13.5, color: YggColors.text),
                          decoration: InputDecoration(
                            hintText: widget.inputHint ?? AppStrings.t('projects.terminalInputHint'),
                            hintStyle: TextStyle(fontFamily: YggFonts.mono, fontSize: 13, color: YggColors.textFaint),
                            border: InputBorder.none,
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(vertical: 10),
                          ),
                          // Grows with the text up to 4 lines, then scrolls. Enter
                          // adds a newline (multi-line prompts); send is the button.
                          minLines: 1,
                          maxLines: 4,
                          keyboardType: TextInputType.multiline,
                          textInputAction: TextInputAction.newline,
                        ),
                      ),
                      const SizedBox(width: 6),
                      VoiceMicButton(size: 40, onRecognized: _onVoiceRecognized),
                      const SizedBox(width: 6),
                      _sending
                          ? SizedBox(width: 40, height: 40, child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent))))
                          : YggIconButton(
                              icon: Icons.arrow_upward,
                              size: 40,
                              iconSize: 18,
                              circle: true,
                              style: YggIconButtonStyle.accent,
                              tooltip: AppStrings.t('terminal.send'),
                              onTap: _send,
                            ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
