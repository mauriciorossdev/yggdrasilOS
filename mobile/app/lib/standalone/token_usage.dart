import '../assistant/assistant_usage.dart' show AssistantModel;

/// Token accounting for one provider call, in a vendor-neutral shape: each
/// provider client maps its own response fields into this (Anthropic's
/// `usage.input_tokens`, OpenAI's `usage.prompt_tokens`, ...), so everything
/// downstream — storage, the chip, the sheet — never knows which provider ran.
class TokenUsage {
  /// Uncached input tokens (Anthropic bills cache reads/writes separately).
  final int inTokens;
  final int outTokens;
  final int cacheRead;
  final int cacheWrite;

  /// The model that answered. Kept per call because a chat can switch models
  /// midway, and each reply must be priced with the model that produced it.
  final String? model;

  const TokenUsage({
    this.inTokens = 0,
    this.outTokens = 0,
    this.cacheRead = 0,
    this.cacheWrite = 0,
    this.model,
  });

  /// Everything the model had to read this call: what the context window is
  /// measured against.
  int get contextTokens => inTokens + cacheRead + cacheWrite;

  factory TokenUsage.fromJson(Map<String, dynamic> json) => TokenUsage(
        inTokens: (json['in'] as num?)?.toInt() ?? 0,
        outTokens: (json['out'] as num?)?.toInt() ?? 0,
        cacheRead: (json['cacheRead'] as num?)?.toInt() ?? 0,
        cacheWrite: (json['cacheWrite'] as num?)?.toInt() ?? 0,
        model: json['model']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'in': inTokens,
        'out': outTokens,
        if (cacheRead != 0) 'cacheRead': cacheRead,
        if (cacheWrite != 0) 'cacheWrite': cacheWrite,
        if (model != null) 'model': model,
      };
}

/// Totals over a chat's replies. Derived from the stored per-reply usage on
/// demand rather than kept as a second counter, so it can never drift from the
/// messages and survives restarts for free.
class UsageSummary {
  final int calls;
  final int inTokens;
  final int outTokens;
  final int cacheRead;
  final int cacheWrite;

  /// Estimated spend over the calls whose model has a known price; null when
  /// none do. Prices are never guessed, so [unpricedCalls] says how much of the
  /// usage this figure leaves out.
  final double? costUsd;
  final int unpricedCalls;

  /// Context the last call used, to compare against the model's window.
  final int lastContextTokens;
  final String? lastModel;

  const UsageSummary({
    this.calls = 0,
    this.inTokens = 0,
    this.outTokens = 0,
    this.cacheRead = 0,
    this.cacheWrite = 0,
    this.costUsd,
    this.unpricedCalls = 0,
    this.lastContextTokens = 0,
    this.lastModel,
  });

  bool get isEmpty => calls == 0;
  int get totalTokens => inTokens + outTokens + cacheRead + cacheWrite;

  /// [modelById] resolves a stored model id to its catalog entry (price,
  /// context window); null for models the catalog doesn't know.
  factory UsageSummary.of(Iterable<TokenUsage> usages, AssistantModel? Function(String? modelId) modelById) {
    var calls = 0, inT = 0, outT = 0, cacheR = 0, cacheW = 0, unpriced = 0, lastCtx = 0;
    double? cost;
    String? lastModel;
    for (final u in usages) {
      calls++;
      inT += u.inTokens;
      outT += u.outTokens;
      cacheR += u.cacheRead;
      cacheW += u.cacheWrite;
      lastCtx = u.contextTokens;
      lastModel = u.model ?? lastModel;
      final c = modelById(u.model)?.costUsd(u.inTokens, u.outTokens, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite);
      if (c == null) {
        unpriced++;
      } else {
        cost = (cost ?? 0) + c;
      }
    }
    return UsageSummary(
      calls: calls,
      inTokens: inT,
      outTokens: outT,
      cacheRead: cacheR,
      cacheWrite: cacheW,
      costUsd: cost,
      unpricedCalls: unpriced,
      lastContextTokens: lastCtx,
      lastModel: lastModel,
    );
  }
}
