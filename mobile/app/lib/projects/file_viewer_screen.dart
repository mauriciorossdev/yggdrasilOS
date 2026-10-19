import 'package:flutter/material.dart';

import '../services/yggdrasil_client.dart';
import 'file_content_view.dart';

/// Full-screen Scaffold shell around FileContentView — pushed from FilesTab.
/// ProjectWorkspaceScreen's split view uses FileContentView directly instead
/// (no second Scaffold/AppBar needed there).
class FileViewerScreen extends StatelessWidget {
  final YggdrasilClient client;
  final String relativePath;

  const FileViewerScreen({super.key, required this.client, required this.relativePath});

  @override
  Widget build(BuildContext context) {
    final fileName = relativePath.split('/').last;
    return Scaffold(
      appBar: AppBar(title: Text(fileName, overflow: TextOverflow.ellipsis)),
      body: FileContentView(client: client, relativePath: relativePath),
    );
  }
}
