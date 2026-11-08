import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/app_strings.dart';

/// A way for the assistant to behave: [instructions] become a section of the
/// chat's system prompt. Built-ins ship with the app (their [name] follows the
/// app language); custom ones are the user's own.
class Persona {
  final String id;
  final String name;
  final String instructions;
  final bool builtin;

  const Persona({required this.id, required this.name, required this.instructions, this.builtin = false});

  factory Persona.fromJson(Map<String, dynamic> json) => Persona(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        instructions: json['instructions']?.toString() ?? '',
      );

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'instructions': instructions};
}

const defaultPersonaId = 'general';

// Instructions are written in English: the model reads them whatever language
// the user speaks, and the language rule of the system prompt picks the reply.
const _builtinInstructions = {
  'general': 'Be a helpful, balanced all-round assistant: clear, direct and warm.',
  'tech': 'Act as a pragmatic technical partner. Challenge shaky assumptions, prefer the simplest solution that '
      'works, propose concrete next steps and ask for any constraint you are missing before committing to a design.',
  'tutor': "Teach instead of only answering: explain the why, go step by step at the user's level, and check "
      'understanding with one short question before moving on.',
  'coach': 'Act as a supportive coach. Help the user clarify what they want, ask one focused question at a time, '
      'turn ideas into small actionable steps and keep them moving without lecturing.',
};

/// The built-in personalities, with names in the current app language.
List<Persona> builtinPersonas() => [
      for (final e in _builtinInstructions.entries)
        Persona(id: e.key, name: AppStrings.t('persona.${e.key}.name'), instructions: e.value, builtin: true),
    ];

/// The user's own personalities and which one new chats start with.
class PersonaStore {
  static const _customKey = 'yggdrasil_pref_personas';
  static const _defaultKey = 'yggdrasil_pref_default_persona';

  static Future<List<Persona>> custom() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_customKey);
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List<dynamic>).map((e) => Persona.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<List<Persona>> all() async => [...builtinPersonas(), ...await custom()];

  static Future<String> defaultId() async {
    final prefs = await SharedPreferences.getInstance();
    final id = prefs.getString(_defaultKey);
    return id != null && (await get(id)) != null ? id : defaultPersonaId;
  }

  static Future<void> setDefault(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_defaultKey, id);
  }

  static Future<Persona?> get(String id) async {
    for (final p in await all()) {
      if (p.id == id) return p;
    }
    return null;
  }

  /// The persona a chat runs on: its own, else the default (a chat whose persona
  /// was deleted falls back too).
  static Future<Persona> resolve(String? id) async {
    final own = id == null ? null : await get(id);
    if (own != null) return own;
    return (await get(await defaultId()))!;
  }

  /// Adds the persona, or replaces the custom one with the same id.
  static Future<void> upsert(Persona persona) async {
    final list = await custom();
    final i = list.indexWhere((p) => p.id == persona.id);
    if (i >= 0) {
      list[i] = persona;
    } else {
      list.add(persona);
    }
    await _saveCustom(list);
  }

  static Future<void> delete(String id) async {
    final list = await custom();
    list.removeWhere((p) => p.id == id);
    await _saveCustom(list);
  }

  static String newId() => 'custom-${DateTime.now().millisecondsSinceEpoch}';

  static Future<void> _saveCustom(List<Persona> list) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_customKey, jsonEncode(list.map((p) => p.toJson()).toList()));
  }
}
