import '../l10n/app_strings.dart';
import '../services/user_name_store.dart';
import 'persona.dart';

/// What the model is told in a voice conversation: its words are read aloud, so
/// it must write for the ear.
const voiceModeGuidance = 'The user is talking to you by voice and hears your answer through text-to-speech. '
    'Reply in one to three short sentences unless they ask for more. Never use markdown, lists, headings, '
    'code blocks or emoji. Write numbers, units and symbols the way you would say them. Ask at most one '
    'question at a time. If the answer is long, give the gist and offer to go on.';

/// Builds the system prompt of a direct chat: who the user is, which language
/// to answer in, and any extra behavior sections (a personality, the
/// suggestion protocol) that later features contribute as [extraSections].
class SystemPromptBuilder {
  SystemPromptBuilder._();

  /// [userName] null or blank leaves the user unnamed. [locale] is an
  /// [AppStrings] locale code.
  static String build({String? userName, required String locale, List<String> extraSections = const []}) {
    final name = userName?.trim() ?? '';
    final language = locale == 'en' ? 'English' : 'Spanish';
    final sections = <String>[
      'You are Yggdrasil, a personal assistant that lives in the user\'s phone app.',
      if (name.isNotEmpty) 'The user\'s name is $name.',
      'Answer in $language unless the user writes in another language. '
          '${locale == 'en' ? '' : 'In Spanish use neutral tuteo (tú, tienes, quieres) and never voseo (vos, tenés, querés). '}'
          'Keep replies short enough to read comfortably on a phone.',
      ...extraSections.where((s) => s.trim().isNotEmpty),
    ];
    return sections.join('\n\n');
  }

  /// The prompt for the signed-in user, the app's current language and the chat's
  /// personality ([personaId] null means the default one).
  static Future<String> forCurrentUser({String? personaId, List<String> extraSections = const []}) async {
    final persona = await PersonaStore.resolve(personaId);
    return build(
      userName: await UserNameStore.get(),
      locale: AppStrings.current,
      extraSections: [persona.instructions, ...extraSections],
    );
  }
}
