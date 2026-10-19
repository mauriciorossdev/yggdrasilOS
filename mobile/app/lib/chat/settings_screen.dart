import 'package:flutter/material.dart';

import '../connectors/google_connector_screen.dart';
import '../l10n/app_strings.dart';
import '../workflows_local/automations_screen.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_editor_screen.dart';
import '../profiles/profile_store.dart';
import '../profiles/profiles_screen.dart';
import '../services/capabilities_store.dart';
import '../services/device_tool_specs.dart';
import '../services/locale_store.dart';
import '../services/user_name_store.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../gateway/gateway_settings_screen.dart';
import '../pi/pi_settings_screen.dart';
import '../local_projects/local_companion_settings_screen.dart';
import 'capabilities_screen.dart';
import 'config_page.dart';

/// Configuración — settings-consolidation-proposal.md. Replaces the old
/// "URL del gateway" standalone dialog + flat 3-item popup menu: the active
/// ConnectionProfile is now the only source of truth for "where do I
/// connect" (editing it here IS editing the connection), and "Configuración
/// de agente" only makes sense — and only shows — when that profile is a
/// gateway (direct mode has no gateway to ask config.get/config.patch,
/// which per yggdrasil_client.dart's call() hang forever on a dead/null
/// channel rather than failing clean).
class SettingsScreen extends StatefulWidget {
  final YggdrasilClient client;

  /// Called after anything here could have changed the active profile
  /// (editing it, activating a different one, creating the first one) so
  /// main.dart can re-sync its live connection to match.
  final Future<void> Function() onProfileChanged;

  const SettingsScreen({super.key, required this.client, required this.onProfileChanged});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  ConnectionProfile? _activeProfile;
  String? _userName;
  int _enabledCapabilitiesCount = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final profile = await ProfileStore.getActive();
    final name = await UserNameStore.get();
    final names = phoneDeviceToolSpecs.map((s) => s['name'] as String).toList();
    final states = await CapabilitiesStore.allStates(names);
    if (!mounted) return;
    setState(() {
      _activeProfile = profile;
      _userName = name;
      _enabledCapabilitiesCount = states.values.where((v) => v).length;
      _loading = false;
    });
  }

  Future<void> _openCapabilities() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => CapabilitiesScreen(client: widget.client, isGatewayMode: !_isDirectMode)),
    );
    await _load();
  }

  bool get _isDirectMode => _activeProfile?.type == ConnectionProfileType.direct;

  Future<void> _editUserName() async {
    final controller = TextEditingController(text: _userName ?? '');
    final newName = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('settings.yourName')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(hintText: AppStrings.t('settings.yourNameHint')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, controller.text), child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
    if (newName == null || newName.trim().isEmpty) return;
    await UserNameStore.set(newName.trim());
    if (!mounted) return;
    setState(() => _userName = newName.trim());
  }

  // Language names shown in their own language (Español/English) rather than
  // translated — a language picker listing itself in the current UI language
  // would be confusing for whoever doesn't read that language yet.
  Future<void> _pickLanguage() async {
    final chosen = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(AppStrings.t('settings.language')),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, 'es'),
            child: Row(
              children: [
                if (AppStrings.current == 'es') const Icon(Icons.check, size: 18, color: YggColors.accent) else const SizedBox(width: 18),
                const SizedBox(width: 10),
                const Text('Español'),
              ],
            ),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, 'en'),
            child: Row(
              children: [
                if (AppStrings.current == 'en') const Icon(Icons.check, size: 18, color: YggColors.accent) else const SizedBox(width: 18),
                const SizedBox(width: 10),
                const Text('English'),
              ],
            ),
          ),
        ],
      ),
    );
    if (chosen == null || chosen == AppStrings.current) return;
    AppStrings.current = chosen;
    await LocaleStore.set(chosen);
    if (mounted) setState(() {});
  }

  Future<void> _openActiveConnection() async {
    final hadNoProfile = _activeProfile == null;
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => ProfileEditorScreen(existing: _activeProfile)),
    );
    if (result != true) return;
    if (hadNoProfile) {
      // "Conectar a un gateway" saved a profile that nothing points to yet —
      // make it active, otherwise the user sees no change at all.
      final profiles = await ProfileStore.list();
      if (profiles.isNotEmpty) {
        profiles.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        await ProfileStore.setActiveId(profiles.first.id);
      }
    }
    await widget.onProfileChanged();
    await _load();
  }

  Future<void> _openProfiles() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfilesScreen()));
    await widget.onProfileChanged();
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator(color: YggColors.accent)));
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('settings.title'))),
      body: ListView(
        children: [
          _sectionHeader(AppStrings.t('settings.personalization')),
          ListTile(
            title: Text(AppStrings.t('settings.yourName')),
            subtitle: Text((_userName?.isNotEmpty ?? false) ? _userName! : AppStrings.t('settings.addYourName')),
            onTap: _editUserName,
          ),
          ListTile(
            title: Text(AppStrings.t('settings.language')),
            subtitle: Text(AppStrings.current == 'en' ? 'English' : 'Español'),
            onTap: _pickLanguage,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Opacity(
              opacity: 0.5,
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(border: Border.all(color: YggColors.hairlineStrong), borderRadius: BorderRadius.circular(14)),
                child: Row(
                  children: [
                    const Icon(Icons.lock_outline, size: 18),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(AppStrings.t('settings.personalityTitle'), style: const TextStyle(fontWeight: FontWeight.w500)),
                          const SizedBox(height: 2),
                          Text(AppStrings.t('settings.personalityBody'), style: const TextStyle(fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const Divider(height: 1),
          _sectionHeader(AppStrings.t('settings.activeConnection')),
          if (_activeProfile != null)
            ListTile(
              leading: Icon(_activeProfile!.type == ConnectionProfileType.gateway ? Icons.dns_outlined : Icons.cloud_outlined),
              title: Text(_activeProfile!.name.isNotEmpty ? _activeProfile!.name : AppStrings.t('profiles.unnamed')),
              subtitle: Text(_activeProfile!.subtitle),
              onTap: _openActiveConnection,
            )
          else
            ListTile(
              leading: const Icon(Icons.add_link),
              title: Text(AppStrings.t('settings.connectToGateway')),
              onTap: _openActiveConnection,
            ),
          if (!_isDirectMode) ...[
            const Divider(height: 1),
            _sectionHeader(AppStrings.t('settings.agentSection')),
            ListTile(
              title: Text(AppStrings.t('settings.agentConfig')),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ConfigPage(client: widget.client))),
            ),
            // Connectors need a gateway to hold the OAuth token
            // (external-actions-and-connectors-analysis.md §1.2) — hidden in
            // direct/standalone mode the same way Configuración de agente is.
            _sectionHeader(AppStrings.t('settings.connectorsRow')),
            ListTile(
              title: const Text('Google'),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => GoogleConnectorScreen(client: widget.client))),
            ),
          ],
          // Always visible (not gated by !_isDirectMode) — the phone_* tools
          // run in gateway and standalone mode alike, capabilities-settings-
          // ux.md §1.
          const Divider(height: 1),
          ListTile(
            title: Text(AppStrings.t('settings.capabilitiesRow')),
            subtitle: Text(
              AppStrings.tp('settings.capabilitiesSubtitle', {
                'enabled': '$_enabledCapabilitiesCount',
                'total': '${phoneDeviceToolSpecs.length}',
              }),
            ),
            onTap: _openCapabilities,
          ),
          ListTile(
            title: Text(AppStrings.t('settings.automations')),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AutomationsScreen())),
          ),
          // Also always visible — independent of the active chat
          // ConnectionProfile, this powers "manage the computer" features
          // like Proyectos regardless of whether chat is gateway or direct.
          const Divider(height: 1),
          ListTile(
            title: Text(AppStrings.t('settings.gateway')),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const GatewaySettingsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            title: Text(AppStrings.t('settings.pi')),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PiSettingsScreen())),
          ),
          const Divider(height: 1),
          // Also always visible, same reasoning as Gateway above — Proyectos
          // Locales runs entirely on-device (Termux), independent of both
          // the chat ConnectionProfile and GatewaySettings.
          ListTile(
            title: Text(AppStrings.t('settings.localCompanion')),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LocalCompanionSettingsScreen())),
          ),
          const Divider(height: 1),
          _sectionHeader(AppStrings.t('settings.general')),
          ListTile(
            title: Text(AppStrings.t('settings.profilesRow')),
            subtitle: Text(
              _activeProfile != null
                  ? AppStrings.tp('settings.profilesActiveSuffix', {'name': _activeProfile!.name})
                  : AppStrings.t('settings.profilesNoneActive'),
            ),
            onTap: _openProfiles,
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
