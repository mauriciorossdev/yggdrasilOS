import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../capabilities/capability_registry.dart';
import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'auto_trigger.dart';

String _newTriggerId() => DateTime.now().microsecondsSinceEpoch.toRadixString(36);

/// Picks a trigger type, then asks for its parameters. Returns null if cancelled.
Future<AutoTrigger?> pickTrigger(BuildContext context) async {
  final type = await showModalBottomSheet<TriggerType>(
    context: context,
    builder: (_) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(12),
        children: [
          for (final t in TriggerType.values)
            ListTile(
              leading: Icon(_iconFor(t)),
              title: Text(_titleFor(t)),
              subtitle: Text(_hintFor(t), style: const TextStyle(fontSize: 12, color: YggColors.textFainter)),
              onTap: () => Navigator.pop(context, t),
            ),
        ],
      ),
    ),
  );
  if (type == null || !context.mounted) return null;
  final params = await _paramsFor(context, type);
  if (params == null) return null;
  return AutoTrigger(id: _newTriggerId(), type: type, params: params);
}

IconData _iconFor(TriggerType t) => switch (t) {
      TriggerType.schedule => Icons.schedule,
      TriggerType.battery => Icons.battery_std_outlined,
      TriggerType.network => Icons.wifi,
      TriggerType.boot => Icons.restart_alt,
      TriggerType.geofence => Icons.place_outlined,
    };

String _titleFor(TriggerType t) => switch (t) {
      TriggerType.schedule => AppStrings.t('trig.schedule'),
      TriggerType.battery => AppStrings.t('trig.battery'),
      TriggerType.network => AppStrings.t('trig.network'),
      TriggerType.boot => AppStrings.t('trig.boot'),
      TriggerType.geofence => AppStrings.t('trig.geofence'),
    };

String _hintFor(TriggerType t) => switch (t) {
      TriggerType.schedule => AppStrings.t('trig.scheduleHint'),
      TriggerType.battery => AppStrings.t('trig.batteryHint'),
      TriggerType.network => AppStrings.t('trig.networkHint'),
      TriggerType.boot => AppStrings.t('trig.bootHint'),
      TriggerType.geofence => AppStrings.t('trig.geofenceHint'),
    };

Future<Map<String, dynamic>?> _paramsFor(BuildContext context, TriggerType type) async {
  switch (type) {
    case TriggerType.schedule:
      final time = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 9, minute: 0));
      if (time == null) return null;
      return {'time': '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}'};
    case TriggerType.boot:
      return {};
    case TriggerType.battery:
      return showDialog<Map<String, dynamic>>(context: context, builder: (_) => const _BatteryDialog());
    case TriggerType.network:
      return showDialog<Map<String, dynamic>>(context: context, builder: (_) => const _NetworkDialog());
    case TriggerType.geofence:
      return showDialog<Map<String, dynamic>>(context: context, builder: (_) => const _GeofenceDialog());
  }
}

class _BatteryDialog extends StatefulWidget {
  const _BatteryDialog();

  @override
  State<_BatteryDialog> createState() => _BatteryDialogState();
}

class _BatteryDialogState extends State<_BatteryDialog> {
  String _op = 'below';
  final _percent = TextEditingController(text: '20');

  @override
  void dispose() {
    _percent.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final needsPercent = _op == 'below' || _op == 'above';
    return AlertDialog(
      title: Text(AppStrings.t('trig.battery')),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<String>(
            initialValue: _op,
            items: [
              DropdownMenuItem(value: 'below', child: Text(AppStrings.t('trig.opBelow'))),
              DropdownMenuItem(value: 'above', child: Text(AppStrings.t('trig.opAbove'))),
              DropdownMenuItem(value: 'charging', child: Text(AppStrings.t('trig.opCharging'))),
              DropdownMenuItem(value: 'unplugged', child: Text(AppStrings.t('trig.opUnplugged'))),
            ],
            onChanged: (v) => setState(() => _op = v ?? 'below'),
          ),
          if (needsPercent)
            TextField(
              controller: _percent,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: AppStrings.t('trig.percent')),
            ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
        TextButton(
          onPressed: () {
            final pct = int.tryParse(_percent.text.trim());
            if (needsPercent && (pct == null || pct < 1 || pct > 100)) return;
            Navigator.pop(context, {'op': _op, if (needsPercent) 'percent': pct});
          },
          child: Text(AppStrings.t('common.save')),
        ),
      ],
    );
  }
}

class _NetworkDialog extends StatefulWidget {
  const _NetworkDialog();

  @override
  State<_NetworkDialog> createState() => _NetworkDialogState();
}

class _NetworkDialogState extends State<_NetworkDialog> {
  String _transport = 'wifi';
  String _on = 'connected';

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(AppStrings.t('trig.network')),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<String>(
            initialValue: _transport,
            items: [
              DropdownMenuItem(value: 'wifi', child: Text(AppStrings.t('trig.wifi'))),
              DropdownMenuItem(value: 'cellular', child: Text(AppStrings.t('trig.cellular'))),
            ],
            onChanged: (v) => setState(() => _transport = v ?? 'wifi'),
          ),
          DropdownButtonFormField<String>(
            initialValue: _on,
            items: [
              DropdownMenuItem(value: 'connected', child: Text(AppStrings.t('trig.onConnected'))),
              DropdownMenuItem(value: 'disconnected', child: Text(AppStrings.t('trig.onDisconnected'))),
            ],
            onChanged: (v) => setState(() => _on = v ?? 'connected'),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
        TextButton(
          onPressed: () => Navigator.pop(context, {'transport': _transport, 'on': _on}),
          child: Text(AppStrings.t('common.save')),
        ),
      ],
    );
  }
}

class _GeofenceDialog extends StatefulWidget {
  const _GeofenceDialog();

  @override
  State<_GeofenceDialog> createState() => _GeofenceDialogState();
}

class _GeofenceDialogState extends State<_GeofenceDialog> {
  final _lat = TextEditingController();
  final _lng = TextEditingController();
  final _radius = TextEditingController(text: '200');
  String _on = 'enter';
  String? _error;

  @override
  void dispose() {
    _lat.dispose();
    _lng.dispose();
    _radius.dispose();
    super.dispose();
  }

  Future<void> _useCurrent() async {
    try {
      final cap = capabilityByName('phone_get_location')!;
      final loc = await cap.invoke({});
      setState(() {
        _lat.text = '${loc['lat']}';
        _lng.text = '${loc['lng']}';
        _error = null;
      });
    } catch (e) {
      setState(() => _error = AppStrings.t('trig.noLocation'));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(AppStrings.t('trig.geofence')),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: _lat, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: AppStrings.t('trig.lat'))),
            TextField(controller: _lng, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: AppStrings.t('trig.lng'))),
            TextField(controller: _radius, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: AppStrings.t('trig.radius'))),
            DropdownButtonFormField<String>(
              initialValue: _on,
              items: [
                DropdownMenuItem(value: 'enter', child: Text(AppStrings.t('trig.onEnter'))),
                DropdownMenuItem(value: 'exit', child: Text(AppStrings.t('trig.onExit'))),
              ],
              onChanged: (v) => setState(() => _on = v ?? 'enter'),
            ),
            TextButton.icon(onPressed: _useCurrent, icon: const Icon(Icons.my_location), label: Text(AppStrings.t('trig.useCurrent'))),
            if (_error != null) Text(_error!, style: const TextStyle(color: YggColors.errorRed, fontSize: 12)),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
        TextButton(
          onPressed: () {
            final lat = double.tryParse(_lat.text.trim());
            final lng = double.tryParse(_lng.text.trim());
            final radius = double.tryParse(_radius.text.trim());
            if (lat == null || lng == null || radius == null || radius < 50) {
              setState(() => _error = AppStrings.t('trig.geoInvalid'));
              return;
            }
            Navigator.pop(context, {'lat': lat, 'lng': lng, 'radius': radius, 'on': _on});
          },
          child: Text(AppStrings.t('common.save')),
        ),
      ],
    );
  }
}

/// Permissions a set of triggers needs before arming: background location for
/// geofences, and notifications for the foreground service's persistent notice.
Future<void> requestTriggerPermissions(List<AutoTrigger> triggers) async {
  if (triggers.isEmpty) return;
  await Permission.notification.request();
  if (triggers.any((t) => t.type == TriggerType.geofence)) {
    await Permission.locationWhenInUse.request();
    await Permission.locationAlways.request();
  }
}
