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
        {'id': 'p1', 'name': 'my-project', 'port': 51234},
        {'id': '', 'name': 'sin id', 'port': 1},
      ],
      'endpoints': {'lan': lan, 'tailscale': tailscale},
      'gatewayKey': 'ygd_key',
    });

void main() {
  group('HubLink.parse', () {
    test('reads the desktop QR payload', () {
      final link = HubLink.parse('yggdrasil://hub?url=https%3A%2F%2Fgw.example.com%2F&key=abc%26def');
      expect(link?.url, 'https://gw.example.com');
      expect(link?.key, 'abc&def');
    });

    String payload(String url) => 'yggdrasil://hub?url=${Uri.encodeComponent(url)}&key=k';

    test('accepts wss and ws, stored in the form the app uses', () {
      expect(HubLink.parse(payload('wss://gw.example.com/'))?.url, 'https://gw.example.com');
      expect(HubLink.parse(payload('ws://192.168.1.5:8787'))?.url, 'http://192.168.1.5:8787');
    });

    test('allows unencrypted only on local networks and tailnets', () {
      for (final url in [
        'http://localhost:8787',
        'http://127.0.0.1:8787',
        'http://[::1]:8787',
        'http://192.168.1.5:8787',
        'http://10.0.0.2:8787',
        'http://172.20.0.1:8787',
        'http://100.88.1.2:8787',
        'http://box.example.ts.net:8787',
        'http://nas:8787',
        'http://nas.local:8787',
      ]) {
        expect(HubLink.parse(payload(url)), isNotNull, reason: url);
        expect(HubLink.isInsecurePayload(payload(url)), isFalse, reason: url);
      }
    });

    test('blocks unencrypted public hosts, including ones dressed up as private', () {
      for (final url in [
        'http://gw.example.com',
        'ws://gw.example.com',
        'http://203.0.113.9:8787',
        'http://172.32.0.1',
        'http://192.168.evil.com',
        'http://10.0.0.evil.com',
        'http://100.64.evil.com',
        'http://127.0.0.1.evil.com',
        'http://localhost.evil.com',
        'http://ts.net.evil.com',
      ]) {
        expect(HubLink.parse(payload(url)), isNull, reason: url);
        expect(HubLink.isInsecurePayload(payload(url)), isTrue, reason: url);
      }
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
        {'id': 'p 1', 'name': 'my-project', 'port': 51234},
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
      name: 'MacBook · my-project',
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
