import 'package:flutter/material.dart';

import '../chat/voice_mic_button.dart';
import '../l10n/app_strings.dart';
import '../pi/pi_chat_screen.dart';
import '../pi/pi_settings.dart';
import '../pi/tailscale_channel.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Where a new project can be created from the phone.
class NewProjectTarget {
  final String label;
  final IconData icon;
  final Future<void> Function(String name) create;

  const NewProjectTarget({required this.label, required this.icon, required this.create});
}

/// Mac/PC target: the desktop gateway's projects.create makes `~/Yggdrasil/<name>`
/// (git init), registers it and opens it. [client] must already be connected.
NewProjectTarget desktopTarget({required String label, required Future<YggdrasilClient> Function() connect}) {
  return NewProjectTarget(
    label: label,
    icon: Icons.computer,
    create: (name) async {
      final client = await connect();
      try {
        await client.call('projects.create', {'name': name}, timeout: const Duration(seconds: 60));
      } finally {
        client.disconnect();
      }
    },
  );
}

/// Pi target: the term-bridge's projects.create makes ~/projects/<slug> with its
/// own tmux session running Claude; then opens that project's chat.
NewProjectTarget piTarget(BuildContext context, PiSettings settings) {
  return NewProjectTarget(
    label: AppStrings.t('settings.pi'),
    icon: Icons.memory,
    create: (name) async {
      await TailscaleChannel.connect();
      final client = YggdrasilClient(baseUrl: settings.baseUrl, apiKey: settings.apiKey);
      client.connectToMirror((_) {});
      dynamic created;
      try {
        await client.call('health', {}, timeout: const Duration(seconds: 8));
        created = await client.call('projects.create', {'name': name}, timeout: const Duration(seconds: 30));
      } finally {
        client.disconnect();
      }
      final id = created is Map ? created['id']?.toString() : null;
      if (id == null || !context.mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PiChatScreen(settings: settings, projectId: id, projectName: created['name']?.toString()),
        ),
      );
    },
  );
}

/// Bottom sheet: project name (typed or dictated) + destination. Returns true
/// when a project was created.
Future<bool?> showNewProjectSheet(BuildContext context, List<NewProjectTarget> targets) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: YggColors.surface,
    builder: (_) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: _NewProjectForm(targets: targets),
    ),
  );
}

class _NewProjectForm extends StatefulWidget {
  final List<NewProjectTarget> targets;

  const _NewProjectForm({required this.targets});

  @override
  State<_NewProjectForm> createState() => _NewProjectFormState();
}

class _NewProjectFormState extends State<_NewProjectForm> {
  final _name = TextEditingController();
  int _selected = 0;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _onDictated(String text) {
    // Spoken names come back sentence-cased with a trailing period.
    final clean = text.trim().replaceAll(RegExp(r'[.,;:!?]+$'), '');
    setState(() => _name.text = clean);
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.targets[_selected].create(name);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e is Map ? (e['message'] ?? e).toString() : '$e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(AppStrings.t('newProject.title'), style: const TextStyle(fontSize: 17, color: YggColors.text)),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _name,
                    autofocus: true,
                    enabled: !_busy,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(hintText: AppStrings.t('newProject.nameHint')),
                  ),
                ),
                const SizedBox(width: 8),
                VoiceMicButton(size: 44, enabled: !_busy, onRecognized: _onDictated),
              ],
            ),
            const SizedBox(height: 14),
            Text(AppStrings.t('newProject.where'), style: const TextStyle(fontSize: 12.5, color: YggColors.textMuted)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                for (var i = 0; i < widget.targets.length; i++)
                  ChoiceChip(
                    avatar: Icon(widget.targets[i].icon, size: 16),
                    label: Text(widget.targets[i].label),
                    selected: _selected == i,
                    onSelected: _busy ? null : (_) => setState(() => _selected = i),
                  ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(fontSize: 12.5, color: Colors.redAccent)),
            ],
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(AppStrings.t('newProject.create')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
