import 'package:flutter/material.dart' hide Step;

import '../capabilities/capability_registry.dart';
import '../capabilities/device_capability.dart';
import '../l10n/app_strings.dart';
import '../services/device_tools_channel.dart';
import '../chat/voice_mic_button.dart';
import '../theme/ygg_theme.dart';
import 'automation_author.dart';
import 'local_workflow.dart';
import 'auto_trigger.dart';
import 'automation_trigger_sheet.dart';
import 'local_workflow_store.dart';
import 'trigger_arming.dart';

const _ops = ['eq', 'neq', 'contains', 'gt', 'lt', 'exists'];

String _newId() => DateTime.now().microsecondsSinceEpoch.toRadixString(36);

/// Editor for one automation: name + ordered steps (design §5). Branches of an
/// `si` step are edited on their own screen with the same list widget.
class AutomationEditorScreen extends StatefulWidget {
  final Automation? automation;
  const AutomationEditorScreen({super.key, this.automation});

  @override
  State<AutomationEditorScreen> createState() => _AutomationEditorScreenState();
}

class _AutomationEditorScreenState extends State<AutomationEditorScreen> {
  late final String _id = widget.automation?.id ?? _newId();
  late final TextEditingController _name = TextEditingController(text: widget.automation?.name ?? '');
  late List<Step> _steps = List.of(widget.automation?.steps ?? const []);
  late List<AutoTrigger> _triggers = List.of(widget.automation?.triggers ?? const []);
  bool _drafting = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('auto.nameRequired'))));
      return;
    }
    await requestTriggerPermissions(_triggers);
    await LocalWorkflowStore.save(Automation(
      id: _id,
      name: name,
      enabled: widget.automation?.enabled ?? true,
      steps: _steps,
      triggers: _triggers,
      updatedAt: DateTime.now().millisecondsSinceEpoch,
    ));
    try {
      await TriggerArmer.rearm();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('trig.armFailed'))));
      }
    }
    if (mounted) Navigator.pop(context);
  }

  Future<void> _fromVoice(String text) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _drafting = true);
    try {
      final draft = await AutomationAuthor.fromText(text);
      if (!mounted) return;
      setState(() {
        _name.text = draft.name;
        _steps = draft.steps;
        _triggers = draft.triggers;
      });
      messenger.showSnackBar(SnackBar(content: Text(AppStrings.t('auto.dictateDone'))));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${AppStrings.t('auto.dictateFailed')}: $e')));
    } finally {
      if (mounted) setState(() => _drafting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.automation == null ? AppStrings.t('auto.new') : AppStrings.t('auto.edit')),
        actions: [TextButton(onPressed: _save, child: Text(AppStrings.t('common.save')))],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _name,
              decoration: InputDecoration(labelText: AppStrings.t('auto.name')),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                VoiceMicButton(size: 44, enabled: !_drafting, onRecognized: _fromVoice),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _drafting ? AppStrings.t('auto.dictating') : AppStrings.t('auto.dictate'),
                    style: const TextStyle(color: YggColors.textMuted),
                  ),
                ),
              ],
            ),
          ),
          _TriggersSection(triggers: _triggers, onChanged: (t) => setState(() => _triggers = t)),
          const Divider(height: 1),
          Expanded(child: StepListView(steps: _steps, onChanged: (s) => setState(() => _steps = s))),
        ],
      ),
    );
  }
}

/// Disparadores de la automatización. Sin ninguno, solo corre a mano.
class _TriggersSection extends StatelessWidget {
  final List<AutoTrigger> triggers;
  final ValueChanged<List<AutoTrigger>> onChanged;
  const _TriggersSection({required this.triggers, required this.onChanged});

  Future<void> _add(BuildContext context) async {
    final t = await pickTrigger(context);
    if (t != null) onChanged([...triggers, t]);
  }

  /// Keeps the trigger's id so the native armed entry is replaced, not duplicated.
  Future<void> _edit(BuildContext context, int i) async {
    final t = await pickTrigger(context);
    if (t == null) return;
    onChanged([...triggers]..[i] = AutoTrigger(id: triggers[i].id, type: t.type, params: t.params));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 4, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(AppStrings.tp('trig.count', {'n': '${triggers.length}'}),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11, letterSpacing: 1.2, color: YggColors.textFainter)),
              ),
              TextButton.icon(onPressed: () => _add(context), icon: const Icon(Icons.add, size: 18), label: Text(AppStrings.t('trig.add'))),
            ],
          ),
          if (triggers.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(AppStrings.t('trig.manualOnly'), style: const TextStyle(fontSize: 12, color: YggColors.textFainter)),
            )
          else
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 150),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (var i = 0; i < triggers.length; i++)
                    ListTile(
                      dense: true,
                      leading: Icon(_iconFor(triggers[i].type), size: 20),
                      title: Text(triggers[i].label),
                      subtitle: Text(AppStrings.t('trig.tapToEdit'), style: const TextStyle(fontSize: 11, color: YggColors.textFainter)),
                      onTap: () => _edit(context, i),
                      trailing: IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => onChanged([...triggers]..removeAt(i)),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static IconData _iconFor(TriggerType t) => switch (t) {
        TriggerType.schedule => Icons.schedule,
        TriggerType.battery => Icons.battery_std_outlined,
        TriggerType.network => Icons.wifi,
        TriggerType.boot => Icons.restart_alt,
        TriggerType.geofence => Icons.place_outlined,
      };
}

/// Reorderable-by-delete list of steps plus the add-step sheet. Used for the
/// top level and for each branch of an `si` step.
class StepListView extends StatelessWidget {
  final List<Step> steps;
  final ValueChanged<List<Step>> onChanged;
  const StepListView({super.key, required this.steps, required this.onChanged});

  Future<void> _add(BuildContext context) async {
    final step = await showModalBottomSheet<Step>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _AddStepSheet(),
    );
    if (step != null) onChanged([...steps, step]);
  }

  Future<void> _edit(BuildContext context, int i) async {
    final step = steps[i];
    if (step.kind == StepKind.ifCondition) {
      final updated = await Navigator.push<Step>(context, MaterialPageRoute(builder: (_) => _IfStepScreen(step: step)));
      if (updated != null) onChanged([...steps]..[i] = updated);
      return;
    }
    if (step.kind == StepKind.capability) {
      final cap = capabilityByName(step.capability);
      if (cap == null) return;
      final updated = await showModalBottomSheet<Step>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _CapabilityFormSheet(capability: cap, existing: step),
      );
      if (updated != null) onChanged([...steps]..[i] = updated);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: steps.isEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(AppStrings.t('auto.noSteps'), textAlign: TextAlign.center, style: const TextStyle(color: YggColors.textMuted))))
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  itemCount: steps.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final s = steps[i];
                    return ListTile(
                      leading: Icon(_iconFor(s)),
                      title: Text(_titleFor(s)),
                      subtitle: Text(_subtitleFor(s), style: const TextStyle(fontSize: 12, color: YggColors.textFainter)),
                      onTap: () => _edit(context, i),
                      trailing: IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => onChanged([...steps]..removeAt(i)),
                      ),
                    );
                  },
                ),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _add(context),
              icon: const Icon(Icons.add),
              label: Text(AppStrings.t('auto.addStep')),
            ),
          ),
        ),
      ],
    );
  }

  static IconData _iconFor(Step s) => switch (s.kind) {
        StepKind.capability => Icons.bolt_outlined,
        StepKind.ifCondition => Icons.call_split,
        StepKind.delay => Icons.timer_outlined,
      };

  static String _titleFor(Step s) => switch (s.kind) {
        StepKind.capability => capabilityByName(s.capability)?.name ?? s.capability ?? '?',
        StepKind.ifCondition => AppStrings.t('auto.ifStep'),
        StepKind.delay => AppStrings.tp('auto.delayStep', {'s': '${s.seconds ?? 0}'}),
      };

  static String _subtitleFor(Step s) => switch (s.kind) {
        StepKind.capability => [
            if (s.saveAs != null) '→ steps.${s.saveAs}',
            if (s.args.isNotEmpty) s.args.entries.map((e) => '${e.key}=${e.value}').join(', '),
          ].join('  '),
        StepKind.ifCondition => s.condition == null
            ? AppStrings.t('auto.noCondition')
            : '${s.condition!.left} ${s.condition!.op} ${s.condition!.right ?? ''}',
        StepKind.delay => '',
      };
}

class _AddStepSheet extends StatelessWidget {
  const _AddStepSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        builder: (context, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(12),
          children: [
            ListTile(
              leading: const Icon(Icons.call_split),
              title: Text(AppStrings.t('auto.ifStep')),
              subtitle: Text(AppStrings.t('auto.ifStepDesc')),
              onTap: () => Navigator.pop(
                context,
                Step(
                  id: _newId(),
                  kind: StepKind.ifCondition,
                  condition: const Condition(left: '{{steps.}}', op: 'exists'),
                ),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.timer_outlined),
              title: Text(AppStrings.t('auto.delay')),
              subtitle: Text(AppStrings.t('auto.delayDesc')),
              onTap: () async {
                final seconds = await _askSeconds(context);
                if (seconds != null && context.mounted) {
                  Navigator.pop(context, Step(id: _newId(), kind: StepKind.delay, seconds: seconds));
                }
              },
            ),
            const Divider(),
            for (final category in capabilityCategoryKeys)
              ExpansionTile(
                tilePadding: const EdgeInsets.symmetric(horizontal: 4),
                title: Text(AppStrings.t(category).toUpperCase(),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11, letterSpacing: 1.2, color: YggColors.textFainter)),
                children: [
                  for (final cap in deviceCapabilities.where((c) => c.categoryKey == category)) _capabilityTile(context, cap),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _capabilityTile(BuildContext context, DeviceCapability cap) {
    final title = Text(AppStrings.t(cap.titleKey));
    final subtitle = Text(cap.name, style: const TextStyle(fontSize: 11, color: YggColors.textFainter));
    if (cap.name == 'phone_open_app') {
      return _InstalledAppsTile(cap: cap, onPick: (pkg) => _pick(context, cap, {'packageName': pkg}));
    }
    final props = ((cap.parameters['properties'] as Map?) ?? {}).cast<String, dynamic>();
    final options = <MapEntry<String, Map<String, dynamic>>>[];
    for (final prop in props.entries) {
      final values = ((prop.value as Map)['enum'] as List?)?.cast<String>() ?? const <String>[];
      for (final value in values) {
        options.add(MapEntry(value, {prop.key: value}));
      }
    }
    if (options.isEmpty) {
      return ListTile(dense: true, title: title, subtitle: subtitle, onTap: () => _pick(context, cap));
    }
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(horizontal: 12),
      title: title,
      subtitle: subtitle,
      children: [
        for (final option in options)
          ListTile(
            dense: true,
            contentPadding: const EdgeInsets.only(left: 32, right: 12),
            title: Text(option.key),
            onTap: () => _pick(context, cap, option.value),
          ),
      ],
    );
  }

  Future<void> _pick(BuildContext context, DeviceCapability cap, [Map<String, dynamic> args = const {}]) async {
    final template = args.isEmpty ? null : Step(id: _newId(), kind: StepKind.capability, capability: cap.name, args: args);
    final step = await showModalBottomSheet<Step>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CapabilityFormSheet(capability: cap, existing: template),
    );
    if (step != null && context.mounted) Navigator.pop(context, step);
  }

  static Future<int?> _askSeconds(BuildContext context) async {
    final c = TextEditingController(text: '5');
    return showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(AppStrings.t('auto.delay')),
        content: TextField(
          controller: c,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: AppStrings.t('auto.seconds')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(AppStrings.t('common.cancel'))),
          TextButton(
            onPressed: () => Navigator.pop(ctx, int.tryParse(c.text.trim())?.clamp(1, 300)),
            child: Text(AppStrings.t('common.save')),
          ),
        ],
      ),
    );
  }
}

/// Abrir app: despliega las apps instaladas (se cargan al primer despliegue).
class _InstalledAppsTile extends StatefulWidget {
  final DeviceCapability cap;
  final void Function(String packageName) onPick;
  const _InstalledAppsTile({required this.cap, required this.onPick});

  @override
  State<_InstalledAppsTile> createState() => _InstalledAppsTileState();
}

class _InstalledAppsTileState extends State<_InstalledAppsTile> {
  Future<List<Map<String, String>>>? _apps;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(horizontal: 12),
      title: Text(AppStrings.t(widget.cap.titleKey)),
      subtitle: Text(widget.cap.name, style: const TextStyle(fontSize: 11, color: YggColors.textFainter)),
      onExpansionChanged: (open) {
        if (open && _apps == null) {
          setState(() {
            _apps = DeviceToolsChannel.listInstalledApps();
          });
        }
      },
      children: [
        if (_apps != null)
          FutureBuilder<List<Map<String, String>>>(
            future: _apps,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator());
              }
              if (snap.hasError) {
                return ListTile(dense: true, title: Text('${snap.error}'));
              }
              final apps = snap.data ?? const [];
              return Column(
                children: [
                  for (final app in apps)
                    ListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.only(left: 32, right: 12),
                      title: Text(app['appName'] ?? app['packageName'] ?? ''),
                      subtitle: Text(app['packageName'] ?? '',
                          style: const TextStyle(fontSize: 11, color: YggColors.textFainter)),
                      onTap: () => widget.onPick(app['packageName'] ?? ''),
                    ),
                ],
              );
            },
          ),
      ],
    );
  }
}

/// Form generated from the capability's JSON schema. Values may be literals or
/// `{{steps.<name>.<field>}}` templates; numbers/booleans are coerced on save.
class _CapabilityFormSheet extends StatefulWidget {
  final DeviceCapability capability;
  final Step? existing;
  const _CapabilityFormSheet({required this.capability, this.existing});

  @override
  State<_CapabilityFormSheet> createState() => _CapabilityFormSheetState();
}

class _CapabilityFormSheetState extends State<_CapabilityFormSheet> {
  late final Map<String, TextEditingController> _fields;
  late final TextEditingController _saveAs = TextEditingController(text: widget.existing?.saveAs ?? '');
  late String _onError = widget.existing?.onError ?? 'stop';

  Map<String, dynamic> get _props => ((widget.capability.parameters['properties'] as Map?) ?? {}).cast<String, dynamic>();
  List<String> get _required => ((widget.capability.parameters['required'] as List?) ?? const []).cast<String>();

  @override
  void initState() {
    super.initState();
    _fields = {
      for (final key in _props.keys)
        key: TextEditingController(text: widget.existing?.args[key]?.toString() ?? ''),
    };
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    _saveAs.dispose();
    super.dispose();
  }

  static Object _coerce(String raw, String? type) {
    if (raw.contains('{{')) return raw;
    if (type == 'integer' || type == 'number') return num.tryParse(raw) ?? raw;
    if (type == 'boolean') return raw.toLowerCase() == 'true';
    return raw;
  }

  void _submit() {
    final args = <String, dynamic>{};
    for (final entry in _fields.entries) {
      final raw = entry.value.text.trim();
      if (raw.isEmpty) continue;
      final type = (_props[entry.key] as Map?)?['type'] as String?;
      args[entry.key] = _coerce(raw, type);
    }
    final missing = _required.where((k) => !args.containsKey(k)).toList();
    if (missing.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.tp('auto.missingFields', {'fields': missing.join(', ')}))));
      return;
    }
    final saveAs = _saveAs.text.trim();
    Navigator.pop(
      context,
      Step(
        id: widget.existing?.id ?? _newId(),
        kind: StepKind.capability,
        capability: widget.capability.name,
        args: args,
        saveAs: saveAs.isEmpty ? null : saveAs,
        onError: _onError,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 12, bottom: MediaQuery.of(context).viewInsets.bottom + 12),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(AppStrings.t(widget.capability.titleKey), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(widget.capability.name, style: const TextStyle(fontSize: 11, color: YggColors.textFainter)),
              const SizedBox(height: 12),
              for (final entry in _props.entries)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TextField(
                    controller: _fields[entry.key],
                    decoration: InputDecoration(
                      labelText: '${entry.key}${_required.contains(entry.key) ? ' *' : ''}',
                      helperText: _helperFor(entry.value as Map),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
              if (widget.capability.name == 'phone_launch_intent')
                Text(AppStrings.t('auto.extrasUnsupported'), style: const TextStyle(fontSize: 12, color: YggColors.textFainter)),
              TextField(
                controller: _saveAs,
                decoration: InputDecoration(labelText: AppStrings.t('auto.saveAs'), helperText: AppStrings.t('auto.saveAsHint'), border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _onError,
                decoration: InputDecoration(labelText: AppStrings.t('auto.onError'), border: const OutlineInputBorder()),
                items: [
                  DropdownMenuItem(value: 'stop', child: Text(AppStrings.t('auto.onErrorStop'))),
                  DropdownMenuItem(value: 'continue', child: Text(AppStrings.t('auto.onErrorContinue'))),
                ],
                onChanged: (v) => setState(() => _onError = v ?? 'stop'),
              ),
              const SizedBox(height: 14),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: _submit, child: Text(AppStrings.t('common.save')))),
            ],
          ),
        ),
      ),
    );
  }

  static String? _helperFor(Map schema) {
    final desc = schema['description'] as String?;
    final enums = schema['enum'] as List?;
    final parts = [if (desc != null) desc, if (enums != null) enums.join(' | ')];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

/// `si` step: condition + the two branch lists, each edited with StepListView.
class _IfStepScreen extends StatefulWidget {
  final Step step;
  const _IfStepScreen({required this.step});

  @override
  State<_IfStepScreen> createState() => _IfStepScreenState();
}

class _IfStepScreenState extends State<_IfStepScreen> {
  late final TextEditingController _left = TextEditingController(text: widget.step.condition?.left ?? '');
  late final TextEditingController _right = TextEditingController(text: widget.step.condition?.right ?? '');
  late String _op = widget.step.condition?.op ?? 'exists';
  late List<Step> _then = List.of(widget.step.thenSteps);
  late List<Step> _else = List.of(widget.step.elseSteps);

  @override
  void dispose() {
    _left.dispose();
    _right.dispose();
    super.dispose();
  }

  void _done() {
    Navigator.pop(
      context,
      Step(
        id: widget.step.id,
        kind: StepKind.ifCondition,
        condition: Condition(left: _left.text.trim(), op: _op, right: _right.text.trim().isEmpty ? null : _right.text.trim()),
        thenSteps: _then,
        elseSteps: _else,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppStrings.t('auto.ifStep')),
        actions: [TextButton(onPressed: _done, child: Text(AppStrings.t('common.save')))],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _left,
            decoration: InputDecoration(labelText: AppStrings.t('auto.condLeft'), helperText: '{{steps.nombre.campo}}', border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _op,
            decoration: InputDecoration(labelText: AppStrings.t('auto.condOp'), border: const OutlineInputBorder()),
            items: [for (final op in _ops) DropdownMenuItem(value: op, child: Text(op))],
            onChanged: (v) => setState(() => _op = v ?? 'exists'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _right,
            decoration: InputDecoration(labelText: AppStrings.t('auto.condRight'), border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 16),
          Text(AppStrings.t('auto.thenBranch'), style: const TextStyle(fontWeight: FontWeight.w600)),
          SizedBox(height: 260, child: StepListView(steps: _then, onChanged: (s) => setState(() => _then = s))),
          const SizedBox(height: 12),
          Text(AppStrings.t('auto.elseBranch'), style: const TextStyle(fontWeight: FontWeight.w600)),
          SizedBox(height: 260, child: StepListView(steps: _else, onChanged: (s) => setState(() => _else = s))),
        ],
      ),
    );
  }
}
