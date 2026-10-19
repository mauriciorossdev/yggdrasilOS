import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import 'assistant_attachments.dart' show attachmentKind;
import '../theme/ygg_theme.dart';

class _Doc {
  final String name;
  final int bytes;
  final int modifiedAt;

  _Doc({required this.name, required this.bytes, required this.modifiedAt});

  factory _Doc.fromJson(Map<String, dynamic> json) => _Doc(
        name: json['name']?.toString() ?? '',
        bytes: (json['bytes'] as num?)?.toInt() ?? 0,
        modifiedAt: (json['modifiedAt'] as num?)?.toInt() ?? 0,
      );
}

/// The files attached to the assistant from this phone (gateway
/// notes/assistant folder): see what's there and delete what's no longer needed.
class DocumentsScreen extends StatefulWidget {
  final YggdrasilClient client;

  const DocumentsScreen({super.key, required this.client});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  List<_Doc> _docs = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.client.whenOpen();
      final res = await widget.client.call('documents.list', {}, timeout: const Duration(seconds: 20));
      final list = (res is Map ? res['documents'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _docs = list.map((e) => _Doc.fromJson((e as Map).cast<String, dynamic>())).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _delete(_Doc doc) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('documents.deleteTitle')),
        content: Text(doc.name),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(AppStrings.t('common.cancel'))),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(AppStrings.t('common.delete'), style: const TextStyle(color: YggColors.errorRed)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.client.call('documents.delete', {'name': doc.name});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${AppStrings.t('common.errorPrefix')}: $e')));
    }
    await _load();
  }

  String _size(int bytes) {
    if (bytes >= 1024 * 1024) return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
    if (bytes >= 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '$bytes B';
  }

  String _date(int ms) {
    if (ms == 0) return '';
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: YggColors.bg,
      appBar: AppBar(
        backgroundColor: YggColors.bg,
        title: Text(AppStrings.t('documents.title')),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(AppStrings.t('documents.loadError'), style: const TextStyle(color: YggColors.textMuted)),
                      const SizedBox(height: 12),
                      TextButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
                    ],
                  ),
                )
              : _docs.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(
                          AppStrings.t('documents.empty'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: YggColors.textMuted, height: 1.5),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: _docs.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final d = _docs[i];
                        return Container(
                          decoration: BoxDecoration(color: YggColors.cardFill, borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
                          child: Row(
                            children: [
                              Icon(
                                switch (attachmentKind(d.name)) {
                                  'image' => Icons.image_outlined,
                                  'audio' => Icons.audiotrack_outlined,
                                  _ => Icons.description_outlined,
                                },
                                color: YggColors.accent,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(d.name, overflow: TextOverflow.ellipsis, style: const TextStyle(color: YggColors.text, fontSize: 15)),
                                    const SizedBox(height: 4),
                                    Text(
                                      [_size(d.bytes), _date(d.modifiedAt)].where((s) => s.isNotEmpty).join(' · '),
                                      style: const TextStyle(color: YggColors.textFaint, fontSize: 12),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                onPressed: () => _delete(d),
                                icon: const Icon(Icons.delete_outline, color: YggColors.textMuted, size: 20),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
    );
  }
}
