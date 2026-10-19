import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

class _MemoryEntry {
  final int id;
  String content;
  final String type;
  final int updatedAt;

  _MemoryEntry({required this.id, required this.content, required this.type, required this.updatedAt});

  factory _MemoryEntry.fromJson(Map<String, dynamic> json) => _MemoryEntry(
        id: (json['id'] as num).toInt(),
        content: json['content']?.toString() ?? '',
        type: json['type']?.toString() ?? 'fact',
        updatedAt: (json['updated_at'] as num?)?.toInt() ?? 0,
      );
}

/// What the assistant remembers about the user, straight from the gateway's
/// memory store (`memory.list/add/update/remove`). Lets the user see, fix
/// and delete anything the assistant saved — or add a fact themselves.
class MemoryScreen extends StatefulWidget {
  final YggdrasilClient client;

  const MemoryScreen({super.key, required this.client});

  @override
  State<MemoryScreen> createState() => _MemoryScreenState();
}

class _MemoryScreenState extends State<MemoryScreen> {
  List<_MemoryEntry> _entries = [];
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
      final res = await widget.client.call('memory.list', {}, timeout: const Duration(seconds: 20));
      final list = (res is Map ? res['memories'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _entries = list.map((e) => _MemoryEntry.fromJson((e as Map).cast<String, dynamic>())).toList();
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

  Future<String?> _askText(String title, {String initial = ''}) {
    final controller = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller, autofocus: true, maxLines: null, minLines: 2),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: Text(AppStrings.t('common.save')),
          ),
        ],
      ),
    );
  }

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${AppStrings.t('common.errorPrefix')}: $e')));
    }
    await _load();
  }

  Future<void> _add() async {
    final text = await _askText(AppStrings.t('memory.add'));
    if (text == null || text.isEmpty) return;
    await _run(() => widget.client.call('memory.add', {'content': text}));
  }

  Future<void> _edit(_MemoryEntry entry) async {
    final text = await _askText(AppStrings.t('memory.edit'), initial: entry.content);
    if (text == null || text.isEmpty || text == entry.content) return;
    await _run(() => widget.client.call('memory.update', {'id': entry.id, 'content': text}));
  }

  Future<void> _delete(_MemoryEntry entry) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('memory.deleteTitle')),
        content: Text(entry.content),
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
    await _run(() => widget.client.call('memory.remove', {'id': entry.id}));
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
        title: Text(AppStrings.t('memory.title')),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: YggColors.accent,
        foregroundColor: YggColors.surface,
        onPressed: _add,
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(AppStrings.t('memory.loadError'), style: const TextStyle(color: YggColors.textMuted)),
                        const SizedBox(height: 12),
                        TextButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
                      ],
                    ),
                  ),
                )
              : _entries.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(
                          AppStrings.t('memory.empty'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: YggColors.textMuted, height: 1.5),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                      itemCount: _entries.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final e = _entries[i];
                        return Material(
                          color: YggColors.cardFill,
                          borderRadius: BorderRadius.circular(14),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: () => _edit(e),
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(e.content, style: const TextStyle(color: YggColors.text, fontSize: 15, height: 1.4)),
                                        const SizedBox(height: 6),
                                        Text(
                                          [e.type, _date(e.updatedAt)].where((s) => s.isNotEmpty).join(' · '),
                                          style: const TextStyle(color: YggColors.textFaint, fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ),
                                  IconButton(
                                    onPressed: () => _delete(e),
                                    icon: const Icon(Icons.delete_outline, color: YggColors.textMuted, size: 20),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
    );
  }
}
