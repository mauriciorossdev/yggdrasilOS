/// Device triggers for an automation (design §4). Each one is armed natively
/// by TriggerArmer.rearm(); firing starts a background run of that automation.
library;

enum TriggerType { schedule, battery, network, boot, geofence }

class AutoTrigger {
  final String id;
  final TriggerType type;

  /// schedule: {time: "HH:mm"} · battery: {op: below|above|charging|unplugged, percent}
  /// network: {transport: wifi|cellular, on: connected|disconnected} · boot: {}
  /// geofence: {lat, lng, radius, on: enter|exit}
  final Map<String, dynamic> params;

  const AutoTrigger({required this.id, required this.type, this.params = const {}});

  factory AutoTrigger.fromJson(Map<String, dynamic> j) => AutoTrigger(
        id: j['id'] as String,
        type: TriggerType.values.byName(j['type'] as String),
        params: (j['params'] as Map?)?.cast<String, dynamic>() ?? const {},
      );

  Map<String, dynamic> toJson() => {'id': id, 'type': type.name, 'params': params};

  String get label => switch (type) {
        TriggerType.schedule => 'Horario ${params['time'] ?? ''}',
        TriggerType.battery => switch (params['op']) {
            'below' => 'Batería menos de ${params['percent']}%',
            'above' => 'Batería más de ${params['percent']}%',
            'charging' => 'Al conectar el cargador',
            _ => 'Al desconectar el cargador',
          },
        TriggerType.network => '${params['transport'] == 'cellular' ? 'Datos' : 'Wifi'} ${params['on'] == 'connected' ? 'conectado' : 'desconectado'}',
        TriggerType.boot => 'Al reiniciar el teléfono',
        TriggerType.geofence => '${params['on'] == 'enter' ? 'Al entrar a' : 'Al salir de'} zona (${params['radius']} m)',
      };
}
