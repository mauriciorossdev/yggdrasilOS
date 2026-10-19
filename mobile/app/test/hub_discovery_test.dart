import 'package:app/hub/desktop_discovery.dart';
import 'package:app/hub/hub_link.dart';
import 'package:app/hub/hub_rpc.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:flutter_test/flutter_test.dart';

HubDesktop _desk({String? lan = '192.168.1.20', String? tailscale = '100.64.0.7'}) => HubDesktop.fromJson({
      'desktopId': 'desk-abc',
      'name': 'MacBook',
      'online': true,
      'lastSeen': 1,
      'projects': [
        {'id': 'p1', 'name': 'harness_pp', 'port': 51234},
        {'id': '', 'name': 'sin id', 'port': 1},
      ],
      'endpoints': {'lan': lan, 'tailscale': tailscale},
      'gatewayKey': 'ygd_key',
    });

void main() {
  group('HubLink.parse', () {
    test('reads the desktop QR payload', () {
      final link = HubLink.parse('yggdrasil://hub?url=https%3A%2F%2Fgw.up.railway.app%2F&key=abc%26def');
      expect(link?.url, 'https://gw.up.railway.app');
      expect(link?.key, 'abc&def');
    });

    test('rejects anything that is not a complete hub link', () {
      expect(HubLink.parse('https://example.com'), isNull);
      expect(HubLink.parse('yggdrasil://assistant'), isNull);
      expect(HubLink.parse('yggdrasil://hub?url=https%3A%2F%2Fx.app'), isNull);
      expect(HubLink.parse('yggdrasil://hub?url=ftp%3A%2F%2Fx&key=k'), isNull);
    });
  });

  test('wsUriFor maps http(s) to ws(s)', () {
    expect(wsUriFor('https://gw.app').toString(), 'wss://gw.app');
    expect(wsUriFor('http://192.168.1.20:51234').toString(), 'ws://192.168.1.20:51234');
  });

  test('adds the hub tunnel last, only when the desktop keeps it open', () {
    final withTunnel = HubDesktop.fromJson({
      'desktopId': 'desk-abc',
      'name': 'MacBook',
      'online': true,
      'tunnel': true,
      'projects': [
        {'id': 'p 1', 'name': 'harness_pp', 'port': 51234},
      ],
      'endpoints': {'lan': '192.168.1.20'},
      'gatewayKey': 'k',
    });
    final p = withTunnel.projects.first;
    expect(withTunnel.candidateBaseUrls(p, hubUrl: 'https://gw.app/'), [
      'http://192.168.1.20:51234',
      'https://gw.app/tunnel/desk-abc/p%201',
    ]);
    expect(isTunnelUrl('https://gw.app/tunnel/desk-abc/p1'), isTrue);
    expect(_desk().candidateBaseUrls(_desk().projects.first, hubUrl: 'https://gw.app'), hasLength(2)); // no tunnel flag
  });

  test('parses desktops, drops invalid projects and tries Tailscale before the LAN', () {
    final d = _desk();
    expect(d.projects.map((p) => p.id), ['p1']);
    expect(d.candidateBaseUrls(d.projects.first), ['http://100.64.0.7:51234', 'http://192.168.1.20:51234']);
    expect(_desk(tailscale: null).candidateBaseUrls(d.projects.first), ['http://192.168.1.20:51234']);
  });

  test('firstReachable returns the first address that accepts the key', () async {
    final d = _desk();
    final tried = <String>[];
    final url = await firstReachable(d, d.projects.first, probe: (u, k) async {
      tried.add('$u|$k');
      return u.contains('192.168');
    });
    expect(url, 'http://192.168.1.20:51234');
    expect(tried, ['http://100.64.0.7:51234|ygd_key', 'http://192.168.1.20:51234|ygd_key']);
    expect(await firstReachable(d, d.projects.first, probe: (_, _) async => false), isNull);
  });

  test('hub ids survive the profile JSON round trip', () {
    final p = ConnectionProfile(
      id: 'x',
      name: 'MacBook · harness_pp',
      type: ConnectionProfileType.gateway,
      baseUrl: 'http://192.168.1.20:51234',
      apiKey: 'ygd_key',
      hubDesktopId: 'desk-abc',
      hubProjectId: 'p1',
    );
    final back = ConnectionProfile.fromJson(p.toJson());
    expect(back.isFromHub, isTrue);
    expect(back.hubDesktopId, 'desk-abc');
    expect(ConnectionProfile(id: 'y', name: 'manual', type: ConnectionProfileType.gateway).isFromHub, isFalse);
  });
}
