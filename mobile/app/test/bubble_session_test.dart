import 'package:app/bubble/bubble_assistant_session.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('describeApproval', () {
    test('turns a tool call into a short readable line', () {
      expect(describeApproval('phone_set_alarm', {'hour': 7, 'minute': 30}), 'set alarm: 7, 30');
      expect(describeApproval('phone_send_sms', {'to': '+56911112222', 'body': 'llego tarde'}), 'send sms: +56911112222, llego tarde');
    });

    test('handles missing args and truncates very long ones', () {
      expect(describeApproval('phone_flashlight', null), 'flashlight');
      final long = describeApproval('phone_show_notification', {'title': 'x' * 200});
      expect(long.length, 90);
      expect(long.endsWith('…'), isTrue);
    });

    test('ignores nested values', () {
      expect(describeApproval('phone_launch_intent', {'extras': {'a': 1}, 'action': 'VIEW'}), 'launch intent: VIEW');
    });
  });

  test('BubbleReply serializes for the native side', () {
    expect(const BubbleReply('hola', spoken: false).toMap(), {'text': 'hola', 'spoken': false});
  });
}
