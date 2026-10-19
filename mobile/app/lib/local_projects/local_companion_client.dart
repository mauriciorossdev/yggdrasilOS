import 'dart:convert';
import 'package:http/http.dart' as http;

import 'local_companion_settings.dart';

/// Thrown for any non-2xx response or network failure — screens catch this
/// and show `.message` directly (already a short, user-facing string).
class LocalCompanionException implements Exception {
  final String message;
  LocalCompanionException(this.message);
  @override
  String toString() => message;
}

class LocalProject {
  final String name;
  final String createdAt;
  LocalProject({required this.name, required this.createdAt});
  factory LocalProject.fromJson(Map<String, dynamic> json) =>
      LocalProject(name: json['name'] as String, createdAt: json['createdAt'] as String);
}

class LocalFileEntry {
  final String name;
  final String type; // "dir" | "file"
  final int? size;
  LocalFileEntry({required this.name, required this.type, this.size});
  factory LocalFileEntry.fromJson(Map<String, dynamic> json) =>
      LocalFileEntry(name: json['name'] as String, type: json['type'] as String, size: json['size'] as int?);
  bool get isDir => type == 'dir';
}

class LocalTerminalInfo {
  final int port;
  final String url;
  final String token;
  LocalTerminalInfo({required this.port, required this.url, required this.token});
  factory LocalTerminalInfo.fromJson(Map<String, dynamic> json) => LocalTerminalInfo(
        port: json['port'] as int,
        url: json['url'] as String,
        token: json['token'] as String,
      );
}

/// Thin wrapper around mobile/termux/companion.js's HTTP API — one method
/// per endpoint, matching its exact request/response shapes (see that file's
/// own header comment for the full API surface).
class LocalCompanionClient {
  final LocalCompanionSettings settings;
  LocalCompanionClient(this.settings);

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse(settings.baseUrl.replaceAll(RegExp(r'/+$'), '') + path).replace(queryParameters: query);

  Map<String, String> get _authHeaders => {'Authorization': 'Bearer ${settings.token}'};

  Future<T> _handle<T>(Future<http.Response> Function() send, T Function(dynamic body) onOk) async {
    http.Response res;
    try {
      res = await send().timeout(const Duration(seconds: 10));
    } catch (_) {
      throw LocalCompanionException('No se pudo conectar al companion — ¿está corriendo en Termux?');
    }
    if (res.statusCode == 401) {
      throw LocalCompanionException('Token incorrecto — revisá los ajustes de Terminal Local.');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      String message = 'Error ${res.statusCode}';
      try {
        final body = jsonDecode(res.body);
        if (body is Map && body['error'] is String) message = body['error'] as String;
      } catch (_) {
        // keep the generic message
      }
      throw LocalCompanionException(message);
    }
    return onOk(res.body.isEmpty ? null : jsonDecode(res.body));
  }

  Future<bool> health() async {
    try {
      final res = await http.get(_uri('/health')).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<List<LocalProject>> listProjects() => _handle(
        () => http.get(_uri('/projects'), headers: _authHeaders),
        (body) => (body['projects'] as List).map((e) => LocalProject.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Future<LocalProject> createProject(String name) => _handle(
        () => http.post(_uri('/projects'), headers: {..._authHeaders, 'Content-Type': 'application/json'}, body: jsonEncode({'name': name})),
        (body) => LocalProject.fromJson(body as Map<String, dynamic>),
      );

  Future<List<LocalFileEntry>> listFiles(String project, String path) => _handle(
        () => http.get(_uri('/projects/$project/files', {'path': path}), headers: _authHeaders),
        (body) => (body['entries'] as List).map((e) => LocalFileEntry.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Future<String> readFile(String project, String path) => _handle(
        () => http.get(_uri('/projects/$project/file', {'path': path}), headers: _authHeaders),
        (body) => body['content'] as String,
      );

  Future<LocalTerminalInfo> startTerminal(String project, String cli) => _handle(
        () => http.post(
          _uri('/projects/$project/terminal'),
          headers: {..._authHeaders, 'Content-Type': 'application/json'},
          body: jsonEncode({'cli': cli}),
        ),
        (body) => LocalTerminalInfo.fromJson(body as Map<String, dynamic>),
      );
}
