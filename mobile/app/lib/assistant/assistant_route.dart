import '../hub/hub_link.dart';
import '../hub/hub_rpc.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';

/// Where "talk to your assistant" goes (connection-ux-review-2026-11-25.md,
/// "Asistente por defecto"). Tried in this order, never answering "echo":
///
/// 1. [assistant] — the link server's always-on assistant (memory, reminders,
///    push), when it answers.
/// 2. [direct] — the phone's own API key (Provider directo profile), talking
///    to the model with no gateway.
/// 3. [gatewayDefault] — whatever gateway is active (a computer project),
///    with its default agent rather than the "assistant" it doesn't have.
/// 4. [none] — nothing to talk to: offer to connect.
enum AssistantRouteKind { assistant, direct, gatewayDefault, none }

class AssistantRoute {
  final AssistantRouteKind kind;
  final ConnectionProfile? profile;

  const AssistantRoute(this.kind, [this.profile]);
}

typedef AssistantProbe = Future<bool> Function(ConnectionProfile profile);

Future<bool> _probe(ConnectionProfile profile) => probeGateway(profile.baseUrl ?? '', profile.apiKey ?? '');

/// Picks the route from the saved profiles. [activeIsOpen] short-cuts the probe
/// when the assistant is already the live connection.
Future<AssistantRoute> resolveAssistantRoute({bool activeIsOpen = false, AssistantProbe probe = _probe}) async {
  final profiles = await ProfileStore.list();
  final activeId = await ProfileStore.getActiveId();
  final hub = await HubStore.saved();
  ConnectionProfile? active;
  for (final p in profiles) {
    if (p.id == activeId) active = p;
  }

  final assistants = profiles.where((p) => profileRole(p, hub) == ProfileRole.assistant).toList();
  for (final p in assistants) {
    if ((p.id == activeId && activeIsOpen) || await probe(p)) return AssistantRoute(AssistantRouteKind.assistant, p);
  }

  final directs = profiles.where((p) => p.type == ConnectionProfileType.direct).toList();
  if (directs.isNotEmpty) {
    final direct = active?.type == ConnectionProfileType.direct ? active! : directs.first;
    return AssistantRoute(AssistantRouteKind.direct, direct);
  }

  if (active != null && active.type == ConnectionProfileType.gateway) {
    // The assistant itself, just not answering right now: keep its chat (it
    // retries and offers "Conectar") rather than its agent-less default.
    if (profileRole(active, hub) == ProfileRole.assistant) return AssistantRoute(AssistantRouteKind.assistant, active);
    return AssistantRoute(AssistantRouteKind.gatewayDefault, active);
  }
  return const AssistantRoute(AssistantRouteKind.none);
}

/// The gateway the floating bubble talks to: the link server's assistant when
/// there is one, else the active gateway profile (with its default agent).
/// The bubble has no UI to fall back to the phone's API key. Null: no gateway.
Future<AssistantRoute?> bubbleGatewayRoute() async {
  final profiles = await ProfileStore.list();
  final hub = await HubStore.saved();
  for (final p in profiles) {
    if (profileRole(p, hub) == ProfileRole.assistant && (p.baseUrl ?? '').isNotEmpty) {
      return AssistantRoute(AssistantRouteKind.assistant, p);
    }
  }
  final active = await ProfileStore.getActive();
  if (active == null || active.type == ConnectionProfileType.direct || (active.baseUrl ?? '').isEmpty) return null;
  return AssistantRoute(AssistantRouteKind.gatewayDefault, active);
}
