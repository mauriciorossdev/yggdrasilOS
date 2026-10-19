import 'package:flutter/foundation.dart';

/// App-wide "start listening" signal — voice-notification-shortcut-design.md
/// §1.3. `main.dart`'s global deep-link listener bumps this on
/// `yggdrasil://voice/listen`; whichever `VoiceMicButton` is mounted right
/// now reacts as if it had been tapped. A plain `ValueNotifier` rather than
/// a `Stream`: `VoiceMicButton.initState` needs to read the *current* value
/// (not just future changes) to not lose a trigger that fired before it
/// mounted (cold start from the notification) — `.value` gives that for
/// free.
class VoiceTriggerBus {
  VoiceTriggerBus._();

  static final ValueNotifier<int> trigger = ValueNotifier<int>(0);

  static void fire() => trigger.value++;
}
