import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A model the assistant chat can run on. [contextWindow] is what we compare
/// context usage against; [inUsdPerM]/[outUsdPerM] are USD per million tokens
/// and stay null when we don't know the price — spend is then not estimated
/// rather than guessed.
class AssistantModel {
  final String id;
  final String label;
  final int contextWindow;
  final double? inUsdPerM;
  final double? outUsdPerM;

  const AssistantModel({
    required this.id,
    required this.label,
    this.contextWindow = 200000,
    this.inUsdPerM,
    this.outUsdPerM,
  });

  bool get hasPrice => inUsdPerM != null && outUsdPerM != null;

  /// Anthropic bills prompt-cache writes at 1.25x and cache reads at 0.1x the
  /// input price; [inTokens] is the uncached input only.
  double? costUsd(int inTokens, int outTokens, {int cacheRead = 0, int cacheWrite = 0}) {
    if (!hasPrice) return null;
    return (inTokens * inUsdPerM! +
            cacheWrite * inUsdPerM! * 1.25 +
            cacheRead * inUsdPerM! * 0.1 +
            outTokens * outUsdPerM!) /
        1e6;
  }
}

const assistantModels = <AssistantModel>[
  AssistantModel(id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', inUsdPerM: 1.0, outUsdPerM: 5.0),
  AssistantModel(id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5'),
  AssistantModel(id: 'claude-opus-5-5', label: 'Claude Opus 5.5'),
];

/// What the gateway's `assistant` agent runs when no model is chosen.
const assistantDefaultModelId = 'claude-haiku-4-5-20251001';

AssistantModel assistantModelById(String? id) =>
    assistantModels.firstWhere((m) => m.id == id, orElse: () => assistantModels.first);

/// FNV-1a over the reply text — a stable key (String.hashCode isn't) so a
/// reply's token cost can be shown again when history is reloaded from the
/// server, which doesn't store usage.
String usageKeyFor(String text) {
  var h = 0x811c9dc5;
  for (final unit in text.codeUnits) {
    h ^= unit;
    h = (h * 0x01000193) & 0xffffffff;
  }
  return h.toRadixString(16);
}

String formatTokens(int n) {
  if (n >= 1000000) return '${(n / 1e6).toStringAsFixed(2)}M';
  if (n >= 10000) return '${(n / 1000).toStringAsFixed(0)}k';
  if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
  return '$n';
}

String formatUsd(double v) => v < 0.01 ? '\$${v.toStringAsFixed(4)}' : '\$${v.toStringAsFixed(2)}';

class TurnUsage {
  /// Uncached input tokens only.
  final int inTokens;
  final int outTokens;
  final double? usd;
  final int cacheRead;
  final int cacheWrite;

  const TurnUsage(this.inTokens, this.outTokens, this.usd, {this.cacheRead = 0, this.cacheWrite = 0});

  /// Everything the model read this turn, cached or not.
  int get totalInput => inTokens + cacheRead + cacheWrite;
  int get total => totalInput + outTokens;
}

/// Local, per-device accounting for the assistant chat: chosen model, running
/// token/spend totals, an optional USD budget and per-reply token costs.
/// Anthropic doesn't expose an account balance to API keys, so "what's left"
/// is the context window plus a budget the user sets here.
class AssistantUsage extends ChangeNotifier {
  AssistantUsage._();
  static final AssistantUsage instance = AssistantUsage._();

  static const _kModel = 'assistant_model';
  static const _kTotals = 'assistant_usage_totals';
  static const _kBudget = 'assistant_budget_usd';
  static const _kReplies = 'assistant_usage_replies';
  static const _maxStoredReplies = 400;

  String? _modelId;
  int totalIn = 0;
  int totalOut = 0;
  int totalCacheRead = 0;
  double totalUsd = 0;
  bool unpricedUsage = false;
  int lastInput = 0;
  double? budgetUsd;
  final Map<String, List<int>> _replies = {};
  bool _loaded = false;

  /// Null = let the gateway's agent decide (Haiku by default).
  String? get modelId => _modelId;
  AssistantModel get model => assistantModelById(_modelId ?? assistantDefaultModelId);
  double? get remainingUsd => budgetUsd == null ? null : budgetUsd! - totalUsd;
  int get contextRemaining => (model.contextWindow - lastInput).clamp(0, model.contextWindow);

  Future<void> load() async {
    if (_loaded) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      _modelId = prefs.getString(_kModel);
      budgetUsd = prefs.getDouble(_kBudget);
      final totals = prefs.getString(_kTotals);
      if (totals != null) {
        final m = jsonDecode(totals) as Map<String, dynamic>;
        totalIn = (m['in'] as num?)?.toInt() ?? 0;
        totalOut = (m['out'] as num?)?.toInt() ?? 0;
        totalCacheRead = (m['cached'] as num?)?.toInt() ?? 0;
        totalUsd = (m['usd'] as num?)?.toDouble() ?? 0;
        unpricedUsage = m['unpriced'] == true;
        lastInput = (m['last'] as num?)?.toInt() ?? 0;
      }
      final replies = prefs.getString(_kReplies);
      if (replies != null) {
        (jsonDecode(replies) as Map<String, dynamic>).forEach((k, v) {
          _replies[k] = (v as List).map((e) => (e as num).toInt()).toList();
        });
      }
    } catch (_) {
      // Corrupt/missing prefs: start from zero.
    }
    _loaded = true;
    notifyListeners();
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_modelId == null) {
        await prefs.remove(_kModel);
      } else {
        await prefs.setString(_kModel, _modelId!);
      }
      if (budgetUsd == null) {
        await prefs.remove(_kBudget);
      } else {
        await prefs.setDouble(_kBudget, budgetUsd!);
      }
      await prefs.setString(
        _kTotals,
        jsonEncode({'in': totalIn, 'out': totalOut, 'cached': totalCacheRead, 'usd': totalUsd, 'unpriced': unpricedUsage, 'last': lastInput}),
      );
      await prefs.setString(_kReplies, jsonEncode(_replies));
    } catch (_) {
      // Best effort — accounting must never break the chat.
    }
  }

  Future<void> setModel(String? id) async {
    _modelId = id;
    notifyListeners();
    await _save();
  }

  Future<void> setBudget(double? usd) async {
    budgetUsd = usd;
    notifyListeners();
    await _save();
  }

  Future<void> resetTotals() async {
    totalIn = 0;
    totalOut = 0;
    totalCacheRead = 0;
    totalUsd = 0;
    unpricedUsage = false;
    notifyListeners();
    await _save();
  }

  /// Records one finished turn and remembers its cost under [replyText].
  /// [inTokens] is uncached input; cache reads/writes arrive separately.
  TurnUsage record(int inTokens, int outTokens, String replyText, {int cacheRead = 0, int cacheWrite = 0}) {
    final usd = model.costUsd(inTokens, outTokens, cacheRead: cacheRead, cacheWrite: cacheWrite);
    final allInput = inTokens + cacheRead + cacheWrite;
    totalIn += allInput;
    totalOut += outTokens;
    totalCacheRead += cacheRead;
    if (usd != null) {
      totalUsd += usd;
    } else {
      unpricedUsage = true;
    }
    lastInput = allInput;
    if (replyText.isNotEmpty) {
      _replies[usageKeyFor(replyText)] = [inTokens, outTokens, cacheRead, cacheWrite];
      while (_replies.length > _maxStoredReplies) {
        _replies.remove(_replies.keys.first);
      }
    }
    notifyListeners();
    _save();
    return TurnUsage(inTokens, outTokens, usd, cacheRead: cacheRead, cacheWrite: cacheWrite);
  }

  TurnUsage? usageForReply(String text) {
    final v = _replies[usageKeyFor(text)];
    if (v == null) return null;
    // Entries saved before prompt caching have just [in, out].
    final read = v.length > 2 ? v[2] : 0;
    final write = v.length > 3 ? v[3] : 0;
    return TurnUsage(v[0], v[1], model.costUsd(v[0], v[1], cacheRead: read, cacheWrite: write),
        cacheRead: read, cacheWrite: write);
  }
}
