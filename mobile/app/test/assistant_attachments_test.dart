import 'package:app/assistant/assistant_attachments.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('classifies attachments by extension', () {
    expect(attachmentKind('assistant/foto.JPG'), 'image');
    expect(attachmentKind('assistant/captura.png'), 'image');
    expect(attachmentKind('assistant/nota de voz.m4a'), 'audio');
    expect(attachmentKind('assistant/whatsapp.opus'), 'audio');
    expect(attachmentKind('assistant/contrato.pdf'), 'document');
    expect(attachmentKind('assistant/sin_extension'), 'document');
  });

  test('labels tell the assistant which tool to use', () {
    expect(attachmentLabel('assistant/foto.jpg'), '[Imagen adjunta: assistant/foto.jpg] ');
    expect(attachmentLabel('assistant/nota.m4a'), '[Audio adjunto: assistant/nota.m4a] ');
    expect(attachmentLabel('assistant/informe.pdf'), '[Documento adjunto: assistant/informe.pdf] ');
  });

  test('photos are scaled to the size Claude actually uses', () {
    expect(photoMaxSide, 1568);
    expect(maxAssistantDocBytes, 25 * 1024 * 1024);
  });
}
