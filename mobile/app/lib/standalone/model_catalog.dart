import '../assistant/assistant_usage.dart' show AssistantModel, assistantModels;
import '../profiles/connection_profile.dart';

/// Models a direct chat can switch between, per provider. Empty means "no
/// catalog yet": the chat keeps working on the profile's model, it just can't
/// be switched from the chat nor priced. To support another provider, add its
/// models here (and have its client fill [ProviderChatResult.usage]).
List<AssistantModel> modelsFor(DirectProvider? provider) => switch (provider) {
      DirectProvider.anthropic => assistantModels,
      DirectProvider.openai => const [],
      DirectProvider.ollamaCloud => const [],
      null => const [],
    };

/// The catalog entry for [id], or null when the provider's catalog doesn't
/// list it (an id typed by hand in the profile, a model released since).
AssistantModel? findModel(DirectProvider? provider, String? id) {
  if (id == null) return null;
  for (final m in modelsFor(provider)) {
    if (m.id == id) return m;
  }
  return null;
}
