import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../l10n/app_strings.dart';
import '../services/device_tools_channel.dart';
import '../services/yggdrasil_client.dart';

// 384 KB raw -> ~512 KB base64 per call; the gateway accepts up to 1 MB raw.
const _chunkBytes = 384 * 1024;

/// Mirrors the gateway's MAX_DOC_BYTES (packages/gateway/src/documentUpload.ts).
const maxAssistantDocBytes = 25 * 1024 * 1024;

/// Longest side photos are scaled to before upload. Claude downsizes anything
/// larger anyway; sending 1568 px keeps a photo to ~2.4k tokens and ~300 KB.
const photoMaxSide = 1568.0;

/// Where an attachment comes from.
enum AttachmentSource { camera, gallery, file }

const _imageExts = {'jpg', 'jpeg', 'png', 'webp', 'gif'};
const _audioExts = {'mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac', 'webm', 'aac', 'mp4'};

String _ext(String path) {
  final dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.substring(dot + 1).toLowerCase();
}

/// 'image' | 'audio' | 'document' — drives the label the assistant reads and the icons.
String attachmentKind(String path) {
  final ext = _ext(path);
  if (_imageExts.contains(ext)) return 'image';
  if (_audioExts.contains(ext)) return 'audio';
  return 'document';
}

/// The text put in the message; the assistant's system prompt maps each label to
/// the right tool (read_document for documents and images, transcribe_audio for audio).
String attachmentLabel(String path) {
  final label = switch (attachmentKind(path)) {
    'image' => 'Imagen adjunta',
    'audio' => 'Audio adjunto',
    _ => 'Documento adjunto',
  };
  return '[$label: $path] ';
}

String _uploadId() => '${DateTime.now().millisecondsSinceEpoch}${Random().nextInt(1 << 32).toRadixString(36)}';

Future<String> _sendChunk(YggdrasilClient client, String uploadId, String name, int index, Uint8List bytes, bool last) async {
  final res = await client.call('documents.upload', {
    'uploadId': uploadId,
    'name': name,
    'index': index,
    'data': base64Encode(bytes),
    'final': last,
  }, timeout: const Duration(seconds: 60));
  if (!last) return '';
  final path = res is Map ? res['path']?.toString() : null;
  if (path == null) throw Exception(AppStrings.t('assistant.attachNoPath'));
  return path;
}

/// Picks something on the phone, uploads it to the gateway's notes/assistant
/// folder (documents.upload, in chunks) and returns the text to put in the
/// message — e.g. `[Imagen adjunta: assistant/foto.jpg] `. Null if the user
/// cancelled. Photos are scaled to [photoMaxSide] on the phone first. Throws
/// with a readable message on failure.
Future<String?> pickAndUploadToAssistant(
  YggdrasilClient client, {
  AttachmentSource source = AttachmentSource.file,
}) async {
  if (source == AttachmentSource.file) return _pickFileAndUpload(client);
  return _pickPhotoAndUpload(client, source == AttachmentSource.camera ? ImageSource.camera : ImageSource.gallery);
}

Future<String?> _pickPhotoAndUpload(YggdrasilClient client, ImageSource source) async {
  final picked = await ImagePicker().pickImage(
    source: source,
    maxWidth: photoMaxSide,
    maxHeight: photoMaxSide,
    imageQuality: 85,
  );
  if (picked == null) return null;
  final bytes = await picked.readAsBytes();
  if (bytes.length > maxAssistantDocBytes) throw Exception(AppStrings.t('assistant.attachTooBig'));

  // The picker re-encodes resized photos (JPEG unless it was PNG/GIF/WebP); a HEIC or
  // unknown extension must not reach the gateway's allowlist as-is.
  var name = picked.name;
  if (!_imageExts.contains(_ext(name))) name = '${name.split('.').first}.jpg';
  if (source == ImageSource.camera) {
    final t = DateTime.now();
    String two(int n) => n.toString().padLeft(2, '0');
    name = 'foto-${t.year}${two(t.month)}${two(t.day)}-${two(t.hour)}${two(t.minute)}${two(t.second)}.${_ext(name)}';
  }

  await client.whenOpen();
  final uploadId = _uploadId();
  var index = 0;
  for (var offset = 0; offset < bytes.length || index == 0; offset += _chunkBytes) {
    final end = min(offset + _chunkBytes, bytes.length);
    final last = end >= bytes.length;
    final path = await _sendChunk(client, uploadId, name, index++, Uint8List.sublistView(bytes, offset, end), last);
    if (last) return attachmentLabel(path);
  }
  return null;
}

Future<String?> _pickFileAndUpload(YggdrasilClient client) async {
  final Map<String, dynamic> picked;
  try {
    picked = await DeviceToolsChannel.pickDocument();
  } on PlatformException catch (e) {
    if (e.code == 'cancelled') return null;
    rethrow;
  }
  final uri = picked['uri']?.toString();
  if (uri == null || uri.isEmpty) return null;
  final name = picked['name']?.toString() ?? 'documento';

  final size = await DeviceToolsChannel.uriSize(uri);
  if (size > maxAssistantDocBytes) throw Exception(AppStrings.t('assistant.attachTooBig'));

  await client.whenOpen();
  final uploadId = _uploadId();
  var offset = 0;
  var index = 0;
  while (true) {
    final bytes = await DeviceToolsChannel.readUriChunk(uri, offset, _chunkBytes);
    offset += bytes.length;
    final last = bytes.length < _chunkBytes || (size >= 0 && offset >= size);
    final path = await _sendChunk(client, uploadId, name, index++, bytes, last);
    if (last) return attachmentLabel(path);
  }
}
