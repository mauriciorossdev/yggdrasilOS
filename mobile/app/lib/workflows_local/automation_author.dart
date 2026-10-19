import 'dart:convert';

import '../capabilities/capability_registry.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import '../services/yggdrasil_client.dart';
import '../standalone/local_message.dart';
import '../standalone/providers/anthropic_client.dart';
import '../standalone/providers/openai_compat_client.dart';
import 'auto_trigger.dart';
import 'local_workflow.dart';

/// Turns dictated text into a draft Automation (design §6, phase 5 on-device).
/// The draft is returned disabled; the editor shows it and the user saves.
class AutomationAuthor {
  static int _seq = 0;

  static String _newId() => '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}${_seq++}';

  static String systemPrompt() {
    final caps = deviceCapabilities
        .map((c) => '- ${c.name} (${c.riskLevel}): ${c.description} Parámetros: ${jsonEncode(c.parameters)}')
        .join('\n');
    return '''
Sos el redactor de automatizaciones de Yggdrasil para Android. Convertí la descripción del usuario en UNA automatización en JSON.

Respondé SOLO con un objeto JSON, sin texto ni markdown, con esta forma:
{"name": "texto corto", "triggers": [{"type": "...", "params": {...}}], "steps": [...]}

Disparadores (triggers) — type y params:
- schedule: {"time": "HH:mm"} (24 h)
- battery: {"op": "below"|"above"|"charging"|"unplugged", "percent": 0-100} (percent no aplica con charging ni unplugged)
- network: {"transport": "wifi"|"cellular", "on": "connected"|"disconnected"}
- boot: {}
- geofence: {"lat": número, "lng": número, "radius": metros, "on": "enter"|"exit"}

Pasos (steps) — cada uno es uno de:
- {"kind": "capability", "capability": "<nombre>", "args": {...}, "saveAs": "<nombre opcional>", "onError": "stop"|"continue"}
- {"kind": "if", "condition": {"left": "{{steps.<nombre>.<campo>}}", "op": "eq"|"neq"|"contains"|"gt"|"lt"|"exists", "right": "valor"}, "then": [...], "else": [...]}
- {"kind": "delay", "seconds": n}

Usá solo las capacidades de esta lista y sus parámetros exactos. Si algo no se puede hacer con ellas, devolvé el JSON con los pasos posibles y un campo "unsupported": "qué falta".

Capacidades disponibles:
$caps
''';
  }

  static Automation parse(String raw) {
    final start = raw.indexOf('{');
    final end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw const FormatException('El modelo no devolvió JSON.');
    final Map<String, dynamic> j;
    try {
      j = (jsonDecode(raw.substring(start, end + 1)) as Map).cast<String, dynamic>();
    } on FormatException {
      throw const FormatException('El JSON del modelo no es válido.');
    }
    final triggers = <AutoTrigger>[];
    for (final t in (j['triggers'] as List? ?? const []).cast<Map>()) {
      final type = TriggerType.values.cast<TriggerType?>().firstWhere(
            (v) => v?.name == t['type'],
            orElse: () => null,
          );
      if (type == null) throw FormatException('Disparador desconocido: ${t['type']}');
      triggers.add(AutoTrigger(
        id: _newId(),
        type: type,
        params: (t['params'] as Map?)?.cast<String, dynamic>() ?? const {},
      ));
    }
    final steps = _steps(j['steps'] as List? ?? const []);
    if (steps.isEmpty) throw const FormatException('La automatización no tiene pasos.');
    return Automation(
      id: _newId(),
      name: (j['name'] as String?)?.trim().isNotEmpty == true ? (j['name'] as String).trim() : 'Automatización por voz',
      enabled: false,
      steps: steps,
      triggers: triggers,
      updatedAt: DateTime.now().millisecondsSinceEpoch,
    );
  }

  static List<Step> _steps(List raw) => raw.cast<Map>().map(_step).toList();

  static Step _step(Map raw) {
    final m = raw.cast<String, dynamic>();
    switch (m['kind']) {
      case 'capability':
        final name = m['capability'] as String?;
        if (name == null || capabilityByName(name) == null) {
          throw FormatException('Capacidad desconocida: $name');
        }
        return Step(
          id: _newId(),
          kind: StepKind.capability,
          capability: name,
          args: (m['args'] as Map?)?.cast<String, dynamic>() ?? const {},
          saveAs: m['saveAs'] as String?,
          onError: m['onError'] as String? ?? 'stop',
        );
      case 'if':
        final cond = m['condition'];
        if (cond is! Map) throw const FormatException('Un paso "si" no tiene condición.');
        return Step(
          id: _newId(),
          kind: StepKind.ifCondition,
          condition: Condition.fromJson(cond.cast<String, dynamic>()),
          thenSteps: _steps(m['then'] as List? ?? const []),
          elseSteps: _steps(m['else'] as List? ?? const []),
        );
      case 'delay':
        return Step(id: _newId(), kind: StepKind.delay, seconds: (m['seconds'] as num?)?.toInt() ?? 0);
      default:
        throw FormatException('Paso desconocido: ${m['kind']}');
    }
  }

  /// Sends the prompt to whichever backend the active profile uses.
  static Future<String> ask({required String system, required String user}) async {
    final profile = await ProfileStore.getActive();
    if (profile == null) throw StateError('No hay un perfil activo.');
    if (profile.type == ConnectionProfileType.direct) {
      final client = switch (profile.provider) {
        DirectProvider.anthropic => AnthropicClient(),
        DirectProvider.openai => OpenAiCompatClient.openAi(),
        DirectProvider.ollamaCloud => OpenAiCompatClient.ollamaCloud(),
        null => throw StateError('El perfil directo no tiene proveedor.'),
      };
      final result = await client.chat(
        apiKey: profile.apiKey ?? '',
        model: profile.model,
        history: [LocalMessage(role: LocalRole.user, text: '$system\n\n$user')],
        toolSpecs: const [],
      );
      return result.text;
    }
    final client = YggdrasilClient(baseUrl: profile.baseUrl ?? '', apiKey: profile.apiKey ?? '');
    client.connectToMirror((_) {});
    try {
      await client.call('health', {});
      final res = await client.call(
        'automation.author',
        {'system': system, 'user': user},
        timeout: const Duration(seconds: 120),
      );
      return ((res as Map)['text'] as String?) ?? '';
    } finally {
      client.disconnect();
    }
  }

  static Future<Automation> fromText(String text) async {
    final raw = await ask(system: systemPrompt(), user: text);
    return parse(raw);
  }
}
