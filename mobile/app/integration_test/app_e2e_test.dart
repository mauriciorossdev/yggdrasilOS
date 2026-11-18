// Mobile E2E suite. Run it with `node scripts/mobile-e2e.mjs` from the repo
// root: that boots the emulator, the QA gateway and the control server these
// tests use. Running this file directly with `flutter test` needs both up.
//
// One entry point (one build/install) with a group per area in flows/.

import 'package:integration_test/integration_test.dart';

import 'flows/chat_flow.dart';
import 'flows/connect_flow.dart';
import 'flows/projects_flow.dart';
import 'flows/settings_flow.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  connectFlow();
  chatFlow();
  projectsFlow();
  settingsFlow();
}
