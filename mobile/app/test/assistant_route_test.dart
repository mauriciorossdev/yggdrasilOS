import 'package:app/assistant/assistant_route.dart';
import 'package:app/hub/hub_link.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:app/profiles/profile_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _hub = HubLink('https://gw.example.com', 'k');

ConnectionProfile _assistant() => ConnectionProfile(id: 'hub', name: 'Tu asistente', type: ConnectionProfileType.gateway, baseUrl: _hub.url, apiKey: 'k');
ConnectionProfile _computer() => ConnectionProfile(
      id: 'desk',
      name: 'Mac · proyecto',
      type: ConnectionProfileType.gateway,
      baseUrl: 'http://192.168.1.20:51234',
      hubDesktopId: 'd',
      hubProjectId: 'p',
    );
ConnectionProfile _direct() => ConnectionProfile(id: 'key', name: 'Claude', type: ConnectionProfileType.direct, provider: DirectProvider.anthropic, apiKey: 'sk');

Future<void> _save(List<ConnectionProfile> profiles, {String? active}) async {
  await HubStore.save(_hub);
  for (final p in profiles) {
    await ProfileStore.upsert(p);
  }
  if (active != null) await ProfileStore.setActiveId(active);
}

Future<bool> _up(ConnectionProfile _) async => true;
Future<bool> _down(ConnectionProfile _) async => false;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('Railway first: the assistant wins even when a computer is the active connection', () async {
    await _save([_assistant(), _computer(), _direct()], active: 'desk');
    final route = await resolveAssistantRoute(probe: _up);
    expect(route.kind, AssistantRouteKind.assistant);
    expect(route.profile!.id, 'hub');
  });

  test('assistant down → the phone API key', () async {
    await _save([_assistant(), _computer(), _direct()], active: 'desk');
    final route = await resolveAssistantRoute(probe: _down);
    expect(route.kind, AssistantRouteKind.direct);
    expect(route.profile!.id, 'key');
  });

  test('no assistant and no API key → the computer with its default agent, never echo', () async {
    await _save([_computer()], active: 'desk');
    final route = await resolveAssistantRoute(probe: _down);
    expect(route.kind, AssistantRouteKind.gatewayDefault);
    expect(route.profile!.id, 'desk');
  });

  test('the live assistant skips the probe', () async {
    await _save([_assistant()], active: 'hub');
    var probed = false;
    final route = await resolveAssistantRoute(activeIsOpen: true, probe: (_) async => probed = true);
    expect(route.kind, AssistantRouteKind.assistant);
    expect(probed, isFalse);
  });

  test('an active assistant that is down, with nothing else, keeps its own chat', () async {
    await _save([_assistant()], active: 'hub');
    final route = await resolveAssistantRoute(probe: _down);
    expect(route.kind, AssistantRouteKind.assistant);
  });

  test('nothing saved → connect', () async {
    final route = await resolveAssistantRoute(probe: _down);
    expect(route.kind, AssistantRouteKind.none);
  });

  test('the bubble talks to the assistant even when a computer is active, else the active gateway', () async {
    await _save([_assistant(), _computer()], active: 'desk');
    expect((await bubbleGatewayRoute())!.kind, AssistantRouteKind.assistant);

    SharedPreferences.setMockInitialValues({});
    await ProfileStore.upsert(_computer());
    await ProfileStore.setActiveId('desk');
    final route = await bubbleGatewayRoute();
    expect(route!.kind, AssistantRouteKind.gatewayDefault);
    expect(route.profile!.id, 'desk');
  });
}
