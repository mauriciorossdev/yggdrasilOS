import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'bubble_assistant_session.dart';

/// Body of the `bubbleAssistantMain` engine entrypoint (BubbleBrain.kt): a
/// UI-less engine the bubble service keeps warm while it is in use. Native
/// says "ask"/"approve"; Dart reports "state"/"approval" back.
void runBubbleAssistant() {
  WidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.yggdrasil.app/bubble_bg');
  final session = BubbleAssistantSession(
    reportState: (state) => channel.invokeMethod<void>('state', {'state': state}),
    requestApproval: (id, tool, summary, risk) => channel.invokeMethod<void>(
      'approval',
      {'requestId': id, 'toolName': tool, 'summary': summary, 'riskLevel': risk},
    ),
    requestAndroidPermissions: (names) async =>
        await channel.invokeMethod<bool>('requestPermissions', {'permissions': names}) ?? false,
  );
  channel.setMethodCallHandler((call) async {
    switch (call.method) {
      case 'ask':
        try {
          return (await session.ask((call.arguments as Map)['text'] as String)).toMap();
        } catch (e) {
          // Surfaces to native as an error it can speak/show without crashing the engine.
          throw PlatformException(code: e.toString().contains('gateway_required') ? 'gateway_required' : 'failed', message: '$e');
        }
      case 'approve':
        final args = call.arguments as Map;
        await session.answerApproval(args['requestId'] as String, args['approved'] as bool);
        return null;
      case 'dispose':
        session.dispose();
        return null;
    }
    return null;
  });
  channel.invokeMethod<void>('ready');
}
