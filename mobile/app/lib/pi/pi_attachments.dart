import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';

import '../services/device_tools_channel.dart';
import '../services/yggdrasil_client.dart';

// 384 KB raw -> ~512 KB base64 per files.upload call (bridge accepts 1 MB).
const _chunkBytes = 384 * 1024;
const _maxBytes = 100 * 1024 * 1024;

/// Picks a document on the phone and streams it to the Pi (files.upload,
/// saved under ~/Inbox/chat). Returns `@path ` — Claude Code's own file
/// reference syntax — to insert into the prompt, or null if the user
/// cancelled. Throws with a readable message on failure.
Future<String?> pickAndUploadToPi(YggdrasilClient client) async {
  final Map<String, dynamic> picked;
  try {
    picked = await DeviceToolsChannel.pickDocument();
  } on PlatformException catch (e) {
    if (e.code == 'cancelled') return null;
    rethrow;
  }
  final uri = picked['uri']?.toString();
  if (uri == null || uri.isEmpty) return null;
  final name = picked['name']?.toString() ?? 'archivo';

  final size = await DeviceToolsChannel.uriSize(uri);
  if (size > _maxBytes) throw Exception('Archivo demasiado grande (máx. 100 MB)');

  final uploadId = '${DateTime.now().millisecondsSinceEpoch}${Random().nextInt(1 << 32).toRadixString(36)}';
  var offset = 0;
  var index = 0;
  while (true) {
    final bytes = await DeviceToolsChannel.readUriChunk(uri, offset, _chunkBytes);
    offset += bytes.length;
    // Last chunk: short read, or exactly at the known size.
    final last = bytes.length < _chunkBytes || (size >= 0 && offset >= size);
    final res = await client.call('files.upload', {
      'uploadId': uploadId,
      'name': name,
      'index': index++,
      'data': base64Encode(bytes),
      'final': last,
    }, timeout: const Duration(seconds: 60));
    if (last) {
      final path = res is Map ? res['path']?.toString() : null;
      if (path == null) throw Exception('La Pi no devolvió la ruta del archivo');
      // Paths with spaces are already sanitized to "_" by the bridge.
      return '@$path ';
    }
  }
}
