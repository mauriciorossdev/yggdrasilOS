import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../standalone/persona.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';

/// Settings > Personalities: pick the one new chats start with, and manage the
/// user's own. A chat can switch personality on its own afterwards.
class PersonasScreen extends StatefulWidget {
  const PersonasScreen({super.key});

  @override
  State<PersonasScreen> createState() => _PersonasScreenState();
}

class _PersonasScreenState extends State<PersonasScreen> {
  List<Persona> _custom = [];
  String _defaultId = defaultPersonaId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final custom = await PersonaStore.custom();
    final defaultId = await PersonaStore.defaultId();
    if (!mounted) return;
    setState(() {
      _custom = custom;
      _defaultId = defaultId;
    });
  }

  Future<void> _setDefault(String id) async {
    await PersonaStore.setDefault(id);
    await _load();
  }

  Future<void> _edit([Persona? existing]) async {
    final name = TextEditingController(text: existing?.name ?? '');
    final instructions = TextEditingController(text: existing?.instructions ?? '');
    final action = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t(existing == null ? 'personas.create' : 'personas.edit')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: name, autofocus: true, decoration: InputDecoration(labelText: AppStrings.t('personas.name'))),
              const SizedBox(height: 12),
              TextField(
                controller: instructions,
                minLines: 4,
                maxLines: 8,
                decoration: InputDecoration(
                  labelText: AppStrings.t('personas.instructions'),
                  hintText: AppStrings.t('personas.instructionsHint'),
                ),
              ),
            ],
          ),
        ),
        actions: [
          if (existing != null) TextButton(onPressed: () => Navigator.pop(context, 'delete'), child: Text(AppStrings.t('common.delete'))),
          TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, 'save'), child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
    if (action == 'delete' && existing != null) {
      await PersonaStore.delete(existing.id);
    } else if (action == 'save' && name.text.trim().isNotEmpty && instructions.text.trim().isNotEmpty) {
      await PersonaStore.upsert(
        Persona(id: existing?.id ?? PersonaStore.newId(), name: name.text.trim(), instructions: instructions.text.trim()),
      );
    }
    await _load();
  }

  Widget? _check(String id) => id == _defaultId ? Icon(Icons.check, color: YggColors.accent) : null;

  @override
  Widget build(BuildContext context) {
    return YggScreen(
      title: AppStrings.t('personas.title'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Text(AppStrings.t('personas.intro'), style: TextStyle(fontSize: 13, color: YggColors.textMuted)),
          ),
          YggSectionLabel(AppStrings.t('personas.builtinSection')),
          YggListGroup(
            children: [
              for (final p in builtinPersonas())
                YggListRow(
                  title: p.name,
                  subtitle: AppStrings.t('persona.${p.id}.desc'),
                  trailing: _check(p.id),
                  chevron: false,
                  onTap: () => _setDefault(p.id),
                ),
            ],
          ),
          const SizedBox(height: 22),
          YggSectionLabel(AppStrings.t('personas.customSection')),
          YggListGroup(
            children: [
              for (final p in _custom)
                YggListRow(
                  title: p.name,
                  subtitle: p.instructions,
                  subtitleLines: 2,
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_check(p.id) != null) _check(p.id)!,
                      IconButton(icon: Icon(Icons.edit_outlined, size: 20, color: YggColors.textMuted), onPressed: () => _edit(p)),
                    ],
                  ),
                  chevron: false,
                  onTap: () => _setDefault(p.id),
                ),
              YggListRow(title: AppStrings.t('personas.create'), accent: true, onTap: _edit, chevron: false),
            ],
          ),
        ],
      ),
    );
  }
}
