import '../chat/chat_list_extras.dart';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../chat/assistant_markdown.dart';
import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';

/// One parsed turn from Claude Code's own JSONL transcript — mirrors
/// app-desktop's main/claudeTranscript.ts TranscriptMessage union
/// (terminals.transcript RPC), already flattened server-side so a single
/// assistant turn's thinking/tool_use/text blocks arrive as separate,
/// ordered entries here.
class TranscriptMessage {
  final String kind; // user | assistant_text | thinking | tool_use | tool_result | turn_stats
  final String? text;
  final String? toolId; // tool_use
  final String? name; // tool_use
  final dynamic input; // tool_use
  final String? toolUseId; // tool_result
  final bool isError; // tool_result
  // turn_stats — end-of-turn caption. Only the Pi's term-bridge
  // (rpi-command-center backend/src/term/transcript.js) emits it so far.
  final String? model;
  final int durationMs;
  final int outputTokens;
  final int inputTokens;
  final int cacheReadTokens;
  final int contextTokens;
  // prompt — an interactive Claude form open on screen (question, permission,
  // multi-select with tabs). Kept as the raw map; see _PromptCard.
  final Map<dynamic, dynamic>? prompt;

  TranscriptMessage.fromJson(Map<dynamic, dynamic> j)
    : kind = j['kind']?.toString() ?? '',
      prompt = j['kind'] == 'prompt' ? j : null,
      text = j['text']?.toString(),
      toolId = j['toolId']?.toString(),
      name = j['name']?.toString(),
      input = j['input'],
      toolUseId = j['toolUseId']?.toString(),
      isError = j['isError'] == true,
      model = j['model']?.toString(),
      durationMs = (j['durationMs'] as num?)?.toInt() ?? 0,
      outputTokens = (j['outputTokens'] as num?)?.toInt() ?? 0,
      inputTokens = (j['inputTokens'] as num?)?.toInt() ?? 0,
      cacheReadTokens = (j['cacheReadTokens'] as num?)?.toInt() ?? 0,
      contextTokens = (j['contextTokens'] as num?)?.toInt() ?? 0;
}

/// Renders a `claude` pane's transcript as a chat-like list — same spirit
/// as https://github.com/daaain/claude-code-log — instead of the raw ANSI
/// text terminal_view_screen.dart shows for every other harness.
class ClaudeTranscriptView extends StatelessWidget {
  final List<TranscriptMessage> messages;
  final ScrollController scrollController;
  // Sends one key to the pane (terminals.key) from a prompt card's buttons.
  // Without it, prompt cards render read-only.
  final Future<void> Function(String key)? onPromptKey;
  // When set, items added after the first render fade in (0.5s).
  final ChatListTracker? tracker;

  const ClaudeTranscriptView({
    super.key,
    required this.messages,
    required this.scrollController,
    this.onPromptKey,
    this.tracker,
  });

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) {
      return Center(
        child: Text(
          AppStrings.t('projects.transcriptEmpty'),
          style: const TextStyle(color: YggColors.textMuted),
        ),
      );
    }

    // tool_result entries are rendered paired with their tool_use, never as
    // their own list item — build the lookup first so pairing doesn't
    // depend on a tool_result always immediately following its tool_use.
    final resultsByToolUseId = <String, TranscriptMessage>{
      for (final m in messages)
        if (m.kind == 'tool_result' && m.toolUseId != null) m.toolUseId!: m,
    };

    final items = <Widget>[];
    for (final m in messages) {
      switch (m.kind) {
        case 'tool_result':
          continue;
        case 'tool_use':
          final result = m.toolId != null ? resultsByToolUseId[m.toolId] : null;
          items.add(
            ClaudeToolCard(
              name: m.name ?? '?',
              input: m.input,
              resultText: result?.text,
              isError: result?.isError ?? false,
              pending: result == null,
            ),
          );
          break;
        case 'user':
          items.add(_UserBubble(text: m.text ?? ''));
          break;
        case 'assistant_text':
          if ((m.text ?? '').isNotEmpty) {
            items.add(
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: AssistantMarkdown(data: m.text!),
              ),
            );
          }
          break;
        case 'thinking':
          items.add(_ThinkingBlock(text: m.text ?? ''));
          break;
        case 'turn_stats':
          items.add(_TurnStatsCaption(m: m));
          break;
        case 'prompt':
          if (m.prompt != null) items.add(_PromptCard(prompt: m.prompt!, onKey: onPromptKey));
          break;
      }
    }

    final t = tracker;
    if (t != null && !t.historyDone) {
      t.markHistory([for (var i = 0; i < items.length; i++) 'i$i']);
    }
    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.all(12),
      itemCount: items.length,
      itemBuilder: (context, i) => t == null
          ? items[i]
          : FadeInBubble(key: ValueKey('i$i'), animate: t.shouldAnimate('i$i'), child: items[i]),
    );
  }
}

/// "Opus 5.5 · 1m 30s · ↓926 · ↑1.2k · ctx 39.1k" under each finished reply.
/// ↓ = tokens generated, ↑ = new (uncached) input, ctx = context size of the
/// turn's last call; cache reads are in the tooltip.
class _TurnStatsCaption extends StatelessWidget {
  final TranscriptMessage m;

  const _TurnStatsCaption({required this.m});

  static String _tokens(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }

  static String _duration(int ms) {
    final s = ms / 1000;
    if (s < 60) return '${s.toStringAsFixed(s < 10 ? 1 : 0)}s';
    final mins = s ~/ 60;
    return '${mins}m ${(s % 60).round()}s';
  }

  static String _modelLabel(String? id) {
    if (id == null || id.isEmpty) return '';
    // claude-opus-5-5 -> Opus 5.5 ; claude-haiku-4-5-20251001 -> Haiku 4.5
    final parts = id.replaceFirst('claude-', '').split('-').where((p) => !RegExp(r'^\d{8}$').hasMatch(p)).toList();
    if (parts.isEmpty) return id;
    final name = parts.first[0].toUpperCase() + parts.first.substring(1);
    return parts.length > 1 ? '$name ${parts.skip(1).join('.')}' : name;
  }

  @override
  Widget build(BuildContext context) {
    final bits = [
      if ((m.model ?? '').isNotEmpty) _modelLabel(m.model),
      _duration(m.durationMs),
      '↓${_tokens(m.outputTokens)}',
      '↑${_tokens(m.inputTokens)}',
      if (m.contextTokens > 0) 'ctx ${_tokens(m.contextTokens)}',
    ];
    return Padding(
      padding: const EdgeInsets.only(top: 2, bottom: 10),
      child: Tooltip(
        message: '${AppStrings.t('pi.statsOutput')}: ${m.outputTokens}\n'
            '${AppStrings.t('pi.statsInput')}: ${m.inputTokens}\n'
            '${AppStrings.t('pi.statsCache')}: ${m.cacheReadTokens}\n'
            '${AppStrings.t('pi.statsContext')}: ${m.contextTokens}',
        child: Text(
          bits.join(' · '),
          style: const TextStyle(fontSize: 11.5, color: YggColors.textFainter, fontFeatures: [FontFeature.tabularFigures()]),
        ),
      ),
    );
  }
}

/// A Claude form waiting for an answer. Each option is a button sending its
/// number (selects it; toggles it in multi-select). Tabs (multi-question
/// forms) get Previous/Next, and every form can be cancelled (Esc).
class _PromptCard extends StatefulWidget {
  final Map<dynamic, dynamic> prompt;
  final Future<void> Function(String key)? onKey;

  const _PromptCard({required this.prompt, required this.onKey});

  @override
  State<_PromptCard> createState() => _PromptCardState();
}

class _PromptCardState extends State<_PromptCard> {
  bool _busy = false;

  Future<void> _press(String key) async {
    final onKey = widget.onKey;
    if (onKey == null || _busy) return;
    setState(() => _busy = true);
    try {
      await onKey(key);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.prompt;
    final question = p['question']?.toString() ?? '';
    final body = p['body']?.toString() ?? '';
    final multi = p['multiSelect'] == true;
    final tabs = ((p['tabs'] as List?) ?? const []).whereType<Map>().toList();
    final options = ((p['options'] as List?) ?? const []).whereType<Map>().toList();
    final enabled = widget.onKey != null && !_busy;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: YggColors.cardFillHigh,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: YggColors.accent.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.help_outline, size: 16, color: YggColors.accent),
              const SizedBox(width: 6),
              Text(AppStrings.t('pi.promptWaiting'), style: const TextStyle(fontSize: 12, color: YggColors.accent, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (_busy) const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 1.5, color: YggColors.accent)),
            ],
          ),
          if (tabs.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final t in tabs)
                  Chip(
                    visualDensity: VisualDensity.compact,
                    avatar: Icon(t['done'] == true ? Icons.check_box : Icons.check_box_outline_blank, size: 14, color: YggColors.textMuted),
                    label: Text(t['label'].toString(), style: const TextStyle(fontSize: 11.5)),
                  ),
              ],
            ),
          ],
          if (body.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(body, style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: YggColors.textMuted, height: 1.35)),
          ],
          if (question.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(question, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: YggColors.text)),
          ],
          const SizedBox(height: 10),
          for (final o in options)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  side: BorderSide(color: o['selected'] == true ? YggColors.accent : YggColors.hairline),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: enabled ? () => _press(o['key'].toString()) : null,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (o['checked'] != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 8, top: 1),
                        child: Icon(o['checked'] == true ? Icons.check_box : Icons.check_box_outline_blank, size: 18, color: YggColors.accent),
                      )
                    else
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Text('${o['key']}.', style: const TextStyle(color: YggColors.textMuted)),
                      ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(o['label'].toString(), style: const TextStyle(color: YggColors.text, fontSize: 14)),
                          if ((o['description'] ?? '').toString().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(o['description'].toString(), style: const TextStyle(color: YggColors.textFainter, fontSize: 12)),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 4),
          Row(
            children: [
              TextButton(onPressed: enabled ? () => _press('Escape') : null, child: Text(AppStrings.t('pi.promptCancel'))),
              const Spacer(),
              if (tabs.isNotEmpty) ...[
                TextButton(onPressed: enabled ? () => _press('BTab') : null, child: Text('‹ ${AppStrings.t('pi.promptPrev')}')),
                FilledButton(onPressed: enabled ? () => _press('Tab') : null, child: Text('${AppStrings.t('pi.promptNext')} ›')),
              ],
            ],
          ),
          if (multi)
            Text(AppStrings.t('pi.promptMultiHint'), style: const TextStyle(fontSize: 11, color: YggColors.textFainter)),
        ],
      ),
    );
  }
}

class _UserBubble extends StatelessWidget {
  final String text;

  const _UserBubble({required this.text});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
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
        child: Text(text, style: const TextStyle(color: YggColors.surface, fontSize: 15, height: 1.45)),
      ),
    );
  }
}

class _ThinkingBlock extends StatefulWidget {
  final String text;

  const _ThinkingBlock({required this.text});

  @override
  State<_ThinkingBlock> createState() => _ThinkingBlockState();
}

class _ThinkingBlockState extends State<_ThinkingBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final firstLine = widget.text.split('\n').first;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: GestureDetector(
        onTap: () => setState(() => _expanded = !_expanded),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: YggColors.cardFill,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: YggColors.hairline),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(_expanded ? Icons.expand_less : Icons.expand_more, size: 16, color: YggColors.textFaint),
                  const SizedBox(width: 6),
                  Text(
                    AppStrings.t('projects.thinkingLabel'),
                    style: const TextStyle(color: YggColors.textFaint, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  if (!_expanded) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        firstLine,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: YggColors.textFainter, fontSize: 12, fontStyle: FontStyle.italic),
                      ),
                    ),
                  ],
                ],
              ),
              if (_expanded)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    widget.text,
                    style: const TextStyle(color: YggColors.textMuted, fontSize: 12.5, fontStyle: FontStyle.italic, height: 1.4),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Generalized version of chat/sync_tool_card.dart's pill aesthetic for an
/// arbitrary Claude Code tool (Bash/Read/Edit/Grep/Task/...) rather than a
/// fixed enum of phone device-tools — shows the raw input/result on tap
/// since there's no per-tool copy to fall back to here.
class ClaudeToolCard extends StatefulWidget {
  final String name;
  final dynamic input;
  final String? resultText;
  final bool isError;
  final bool pending;

  const ClaudeToolCard({
    super.key,
    required this.name,
    required this.input,
    required this.resultText,
    required this.isError,
    required this.pending,
  });

  @override
  State<ClaudeToolCard> createState() => _ClaudeToolCardState();
}

class _ClaudeToolCardState extends State<ClaudeToolCard> {
  bool _expanded = false;

  static const _maxDetailChars = 4000;
  static const _encoder = JsonEncoder.withIndent('  ');

  String get _inputText {
    if (widget.input == null) return '';
    try {
      return _encoder.convert(widget.input);
    } catch (_) {
      return widget.input.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final Widget icon;
    if (widget.pending) {
      icon = const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent));
    } else if (widget.isError) {
      icon = const Icon(Icons.error_outline, size: 16, color: YggColors.errorRed);
    } else {
      icon = const Icon(Icons.check_circle_outline, size: 16, color: YggColors.accent);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: GestureDetector(
        onTap: () => setState(() => _expanded = !_expanded),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: YggColors.cardFillHigh,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  icon,
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.name,
                      style: const TextStyle(color: YggColors.text, fontSize: 13, fontWeight: FontWeight.w600, fontFamily: 'monospace'),
                    ),
                  ),
                  Icon(_expanded ? Icons.expand_less : Icons.expand_more, size: 18, color: YggColors.textFaint),
                ],
              ),
              if (_expanded) ...[
                if (_inputText.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  _detailBlock(_inputText),
                ],
                const SizedBox(height: 6),
                _detailBlock(
                  (widget.resultText != null && widget.resultText!.isNotEmpty)
                      ? widget.resultText!
                      : AppStrings.t('projects.toolResultEmpty'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _detailBlock(String text) {
    final truncated = text.length > _maxDetailChars;
    final shown = truncated ? '${text.substring(0, _maxDetailChars)}\n…' : text;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: YggColors.bg, borderRadius: BorderRadius.circular(8)),
      child: SelectableText(
        shown,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 11.5, color: YggColors.textMuted, height: 1.4),
      ),
    );
  }
}
