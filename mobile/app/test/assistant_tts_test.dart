import 'package:app/assistant/assistant_tts.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('speakableText', () {
    test('strips markdown and code so only prose is read aloud', () {
      expect(speakableText('# Título\n\n**Hola** `mundo` y [enlace](http://x.y)\n\n```\ncódigo\n```'), 'Título. Hola mundo y enlace.');
    });

    test('caps long replies on a sentence boundary', () {
      final long = '${'Frase de prueba. ' * 200}fin';
      final out = speakableText(long);
      expect(out.length, lessThanOrEqualTo(ttsMaxChars));
      expect(out.endsWith('.'), isTrue);
    });
  });
}
