import 'package:app/standalone/local_chat.dart';
import 'package:app/standalone/persona.dart';
import 'package:app/standalone/system_prompt_builder.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('the catalog ships the four built-ins and starts on the general one', () async {
    final all = await PersonaStore.all();
    expect(all.map((p) => p.id), ['general', 'tech', 'tutor', 'coach']);
    expect(all.every((p) => p.builtin && p.instructions.isNotEmpty), isTrue);
    expect(await PersonaStore.defaultId(), defaultPersonaId);
  });

  test('custom personas can be added, edited and deleted', () async {
    await PersonaStore.upsert(const Persona(id: 'custom-1', name: 'Pirata', instructions: 'Talk like a pirate.'));
    expect((await PersonaStore.get('custom-1'))?.name, 'Pirata');
    expect(await PersonaStore.custom(), hasLength(1));

    await PersonaStore.upsert(const Persona(id: 'custom-1', name: 'Capitán', instructions: 'Talk like a captain.'));
    expect(await PersonaStore.custom(), hasLength(1));
    expect((await PersonaStore.get('custom-1'))?.name, 'Capitán');

    await PersonaStore.delete('custom-1');
    expect(await PersonaStore.get('custom-1'), isNull);
  });

  test('the default is stored, and falls back to general when its persona is deleted', () async {
    await PersonaStore.upsert(const Persona(id: 'custom-1', name: 'Pirata', instructions: 'Arr.'));
    await PersonaStore.setDefault('custom-1');
    expect(await PersonaStore.defaultId(), 'custom-1');

    await PersonaStore.delete('custom-1');
    expect(await PersonaStore.defaultId(), defaultPersonaId);
  });

  test('resolve prefers the chat persona, then the default, ignoring unknown ids', () async {
    await PersonaStore.setDefault('tutor');
    expect((await PersonaStore.resolve('coach')).id, 'coach');
    expect((await PersonaStore.resolve(null)).id, 'tutor');
    expect((await PersonaStore.resolve('gone')).id, 'tutor');
  });

  test('the system prompt carries the chat persona instructions', () async {
    final coach = (await PersonaStore.get('coach'))!;
    final prompt = await SystemPromptBuilder.forCurrentUser(personaId: 'coach');
    expect(prompt, contains(coach.instructions));
  });

  test('LocalChat keeps personaId and reads chats saved without it', () {
    final chat = LocalChat(id: 'c', profileId: 'p', personaId: 'tech');
    expect(LocalChat.fromJson(chat.toJson()).personaId, 'tech');
    expect(LocalChat.fromJson({'id': 'old', 'profileId': 'p'}).personaId, isNull);
    expect(LocalChat(id: 'c', profileId: 'p').toJson().containsKey('personaId'), isFalse);
  });
}
