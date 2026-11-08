import 'package:app/chat/voice_mic_button.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the recording clock formats as m:ss', () {
    expect(voiceClock(0), '0:00');
    expect(voiceClock(7), '0:07');
    expect(voiceClock(30), '0:30');
    expect(voiceClock(65), '1:05');
  });
}
