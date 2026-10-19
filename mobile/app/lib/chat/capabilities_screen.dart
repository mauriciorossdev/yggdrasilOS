import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../capabilities/capability_registry.dart';
import '../capabilities/device_capability.dart';
import '../l10n/app_strings.dart';
import '../services/capabilities_store.dart';
import '../services/phone_auto_approve_store.dart';
import '../services/device_tool_specs.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

class _Category {
  final String titleKey;
  final List<DeviceCapability> tools;
  const _Category(this.titleKey, this.tools);
}

// Grouping per capabilities-settings-ux.md §2 — visual grouping only, not the
// unit of control (each row toggles independently, §1 of the design doc).
// Derived from the registry so a new capability shows up here automatically.
final _categories = [
  for (final key in capabilityCategoryKeys)
    _Category(key, deviceCapabilities.where((c) => c.categoryKey == key).toList()),
];

/// Configuración → Capacidades — capabilities-settings-design.md +
/// capabilities-settings-ux.md. On/off per phone_* tool, always visible
/// (gateway and standalone alike, §1 of the UX doc).
class CapabilitiesScreen extends StatefulWidget {
  final YggdrasilClient client;

  /// Whether the active connection is a gateway (vs. direct/standalone) —
  /// only then does a toggle need to re-push device.tools.register
  /// (design doc §4 point 3); calling it in standalone would hang awaiting
  /// a response nothing ever sends.
  final bool isGatewayMode;

  const CapabilitiesScreen({super.key, required this.client, required this.isGatewayMode});

  @override
  State<CapabilitiesScreen> createState() => _CapabilitiesScreenState();
}

class _CapabilitiesScreenState extends State<CapabilitiesScreen> {
  Map<String, bool> _states = {};
  bool _findFilesPermGranted = false;
  bool _findFilesJustDenied = false;
  bool _findFilesDeniedPermanently = false;
  bool _loading = true;
  bool _autoApprove = false;
  Map<Permission, PermissionStatus> _permStatuses = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final names = phoneDeviceToolSpecs.map((s) => s['name'] as String).toList();
    final states = await CapabilitiesStore.allStates(names);
    final permGranted = await _hasFindFilesPermission();
    final autoApprove = await PhoneAutoApproveStore.isEnabled();
    final perms = await _readPermStatuses();
    if (!mounted) return;
    setState(() {
      _states = states;
      _findFilesPermGranted = permGranted;
      _autoApprove = autoApprove;
      _permStatuses = perms;
      _loading = false;
    });
  }

  // Grant-screen permissions: the ones the phone capabilities need at runtime
  // (see capability_registry.dart). Shown here so the user can grant them once,
  // up front, instead of finding out mid-chat that send_sms was refused.
  static const _grantablePerms = [
    Permission.sms,
    Permission.phone,
    Permission.contacts,
    Permission.calendarFullAccess,
    Permission.locationWhenInUse,
    Permission.notification,
  ];

  Future<Map<Permission, PermissionStatus>> _readPermStatuses() async {
    return {for (final p in _grantablePerms) p: await p.status};
  }

  Future<void> _grantPermission(Permission p) async {
    final current = _permStatuses[p];
    if (current?.isPermanentlyDenied ?? false) {
      await openAppSettings();
      return;
    }
    await p.request();
    final perms = await _readPermStatuses();
    if (!mounted) return;
    setState(() => _permStatuses = perms);
  }

  // Read-only status check (no prompt) — phone_find_files is the only one of
  // the 8 tools with a real Android runtime permission (UX §3).
  Future<bool> _hasFindFilesPermission() async {
    final statuses = await Future.wait([Permission.photos.status, Permission.videos.status, Permission.audio.status]);
    return statuses.every((s) => s.isGranted);
  }

  Future<void> _toggle(String toolName, bool value) async {
    if (toolName == 'phone_find_files' && value) {
      // Proactive request (UX §4) — the user is already in an explicit
      // settings context, so asking right here isn't a mid-conversation
      // surprise.
      final statuses = await [Permission.photos, Permission.videos, Permission.audio].request();
      final granted = statuses.values.every((s) => s.isGranted);
      if (!granted) {
        // Switch never flips ON when the OS denies it — UX §4: "no queda en
        // un ON-pero-roto".
        if (!mounted) return;
        setState(() {
          _findFilesJustDenied = true;
          _findFilesDeniedPermanently = statuses.values.any((s) => s.isPermanentlyDenied);
        });
        return;
      }
    }

    await CapabilitiesStore.setEnabled(toolName, value);
    if (!mounted) return;
    setState(() {
      _states = {..._states, toolName: value};
      if (toolName == 'phone_find_files') _findFilesJustDenied = false;
    });
    if (toolName == 'phone_find_files') {
      final granted = await _hasFindFilesPermission();
      if (mounted) setState(() => _findFilesPermGranted = granted);
    }

    // §4 point 3 of the design doc — re-register so a gateway connection
    // picks up the change without needing a reconnect. Fire-and-forget,
    // same casual pattern yggdrasil_client.dart already uses for
    // device.tools.register.
    if (widget.isGatewayMode) unawaited(widget.client.refreshRegisteredTools());
  }

  // §7 addendum — MANAGE_EXTERNAL_STORAGE is a secondary action, not a
  // second switch: no immediate granted/denied is shown, Android doesn't
  // hand one back for this permission (lazy detection on the next real
  // search, same as phone-find-files-design.md §7.2).
  Future<void> _broadenAccess() async {
    unawaited(Permission.manageExternalStorage.request());
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator(color: YggColors.accent)));
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('capabilities.title'))),
      body: ListView(
        children: [
          _sectionHeader(AppStrings.t('capabilities.approvalSection')),
          _autoApproveCard(),
          _sectionHeader(AppStrings.t('capabilities.permissionsSection')),
          _permissionsCard(),
          for (final category in _categories) ...[
            _sectionHeader(AppStrings.t(category.titleKey)),
            ..._categoryCard(category),
          ],
        ],
      ),
    );
  }

  Widget _permissionsCard() {
    final labels = {
      Permission.sms: AppStrings.t('capabilities.permSms'),
      Permission.phone: AppStrings.t('capabilities.permPhone'),
      Permission.contacts: AppStrings.t('capabilities.permContacts'),
      Permission.calendarFullAccess: AppStrings.t('capabilities.permCalendar'),
      Permission.locationWhenInUse: AppStrings.t('capabilities.permLocation'),
      Permission.notification: AppStrings.t('capabilities.permNotification'),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Container(
        decoration: BoxDecoration(border: Border.all(color: YggColors.hairlineStrong), borderRadius: BorderRadius.circular(14)),
        child: Column(
          children: [
            for (final p in _grantablePerms) ...[
              if (p != _grantablePerms.first) const Divider(height: 1),
              _permissionTile(labels[p]!, p),
            ],
          ],
        ),
      ),
    );
  }

  Widget _permissionTile(String label, Permission p) {
    final status = _permStatuses[p];
    final granted = status?.isGranted ?? false;
    final permanent = status?.isPermanentlyDenied ?? false;
    final statusText = granted
        ? AppStrings.t('capabilities.permGranted')
        : permanent
            ? AppStrings.t('capabilities.permOpenSettings')
            : AppStrings.t('capabilities.permNotGranted');
    return ListTile(
      dense: true,
      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
      trailing: Text(
        statusText,
        style: TextStyle(fontSize: 12, color: granted ? YggColors.accent : YggColors.textFainter),
      ),
      onTap: granted ? null : () => _grantPermission(p),
    );
  }

  Widget _autoApproveCard() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Container(
        decoration: BoxDecoration(border: Border.all(color: YggColors.hairlineStrong), borderRadius: BorderRadius.circular(14)),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(AppStrings.t('capabilities.autoApprove'), style: const TextStyle(fontWeight: FontWeight.w500)),
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      AppStrings.t('capabilities.autoApproveDesc'),
                      style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
                    ),
                  ),
                ],
              ),
            ),
            Switch(
              value: _autoApprove,
              activeColor: YggColors.accent,
              onChanged: (v) async {
                await PhoneAutoApproveStore.setEnabled(v);
                if (mounted) setState(() => _autoApprove = v);
              },
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _categoryCard(_Category category) {
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Container(
          decoration: BoxDecoration(border: Border.all(color: YggColors.hairlineStrong), borderRadius: BorderRadius.circular(14)),
          child: Column(
            children: [
              for (var i = 0; i < category.tools.length; i++) ...[
                if (i > 0) const Divider(height: 1),
                _toolTile(category.tools[i]),
              ],
            ],
          ),
        ),
      ),
    ];
  }

  Widget _toolTile(DeviceCapability tool) {
    final enabled = _states[tool.name] ?? true;
    final isFindFiles = tool.name == 'phone_find_files';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(AppStrings.t(tool.titleKey), style: const TextStyle(fontWeight: FontWeight.w500)),
                    if (tool.descriptionKey != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          AppStrings.t(tool.descriptionKey!),
                          style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
                        ),
                      ),
                  ],
                ),
              ),
              Switch(
                value: enabled,
                activeColor: YggColors.accent,
                onChanged: (v) => _toggle(tool.name, v),
              ),
            ],
          ),
          // §3 of the UX doc — the lock badge is the ONLY signal shown for
          // the Android-permission axis, exactly as drawn there: no second
          // switch, no granted/denied chip, just this one conditional line
          // when the toggle is ON but Android hasn't granted the permission.
          if (isFindFiles && enabled && !_findFilesPermGranted)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                AppStrings.t('capabilities.findFilesPermBadge'),
                style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
              ),
            ),
          if (isFindFiles && _findFilesJustDenied) ...[
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                AppStrings.t('capabilities.findFilesPermDeniedText'),
                style: const TextStyle(fontSize: 12, color: YggColors.errorRed),
              ),
            ),
            if (_findFilesDeniedPermanently)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: GestureDetector(
                  onTap: openAppSettings,
                  child: Text(
                    AppStrings.t('capabilities.openSettings'),
                    style: const TextStyle(fontSize: 12, color: YggColors.accent, fontWeight: FontWeight.w500),
                  ),
                ),
              ),
          ],
          if (isFindFiles && enabled)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: GestureDetector(
                onTap: _broadenAccess,
                child: Text(
                  AppStrings.t('capabilities.broadenAccess'),
                  style: const TextStyle(fontSize: 12, color: YggColors.accent),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String label) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 6),
        child: Text(
          label.toUpperCase(),
          style: const TextStyle(fontFamily: 'monospace', fontSize: 11, letterSpacing: 1.2, color: YggColors.textFainter),
        ),
      );
}
