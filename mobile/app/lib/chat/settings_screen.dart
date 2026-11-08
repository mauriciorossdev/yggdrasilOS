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
import '../ui/ui.dart';
import '../gateway/gateway_settings_screen.dart';
import '../pi/pi_settings_screen.dart';
import '../local_projects/local_companion_settings_screen.dart';
import '../standalone/persona.dart';
import '../voice/tts_settings.dart';
import 'capabilities_screen.dart';
import 'personas_screen.dart';
import 'voice_settings_screen.dart';
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
  String _personaName = '';
  String _voiceLabel = '';
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
    final persona = await PersonaStore.resolve(null);
    final tts = await TtsSettingsStore.load();
    if (!mounted) return;
    setState(() {
      _voiceLabel = _voiceEngineLabel(tts);
      _activeProfile = profile;
      _userName = name;
      _personaName = persona.name;
      _enabledCapabilitiesCount = states.values.where((v) => v).length;
      _loading = false;
    });
  }

  String _voiceEngineLabel(TtsSettings tts) =>
      tts.effectiveEngine == TtsEngine.replicate ? 'Replicate' : AppStrings.t('voice.settings.system');

  Future<void> _loadVoiceLabel() async {
    final tts = await TtsSettingsStore.load();
    if (mounted) setState(() => _voiceLabel = _voiceEngineLabel(tts));
  }

  Future<void> _loadPersonaName() async {
    final persona = await PersonaStore.resolve(null);
    if (mounted) setState(() => _personaName = persona.name);
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
                if (AppStrings.current == 'es') Icon(Icons.check, size: 18, color: YggColors.accent) else const SizedBox(width: 18),
                const SizedBox(width: 10),
                const Text('Español'),
              ],
            ),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, 'en'),
            child: Row(
              children: [
                if (AppStrings.current == 'en') Icon(Icons.check, size: 18, color: YggColors.accent) else const SizedBox(width: 18),
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
    if (_loading) return Scaffold(body: Center(child: CircularProgressIndicator(color: YggColors.accent)));
    final profile = _activeProfile;
    return Scaffold(
      appBar: AppBar(
        leadingWidth: 68,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16),
          child: Align(
            alignment: Alignment.centerLeft,
            child: YggIconButton(icon: Icons.arrow_back, tooltip: MaterialLocalizations.of(context).backButtonTooltip, onTap: () => Navigator.maybePop(context)),
          ),
        ),
        title: Text(AppStrings.t('settings.title')),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          YggSectionLabel(AppStrings.t('settings.personalization')),
          YggListGroup(
            children: [
              YggListRow(
                title: AppStrings.t('settings.yourName'),
                value: (_userName?.isNotEmpty ?? false) ? _userName! : AppStrings.t('settings.addYourName'),
                onTap: _editUserName,
              ),
              YggListRow(
                title: AppStrings.t('settings.language'),
                value: AppStrings.current == 'en' ? 'English' : 'Español',
                onTap: _pickLanguage,
              ),
              YggListRow(
                title: AppStrings.t('settings.theme'),
                value: YggThemeController.instance.palette.name,
                onTap: () async {
                  await showYggThemePicker(context);
                  if (mounted) setState(() {});
                },
              ),
              YggListRow(
                title: AppStrings.t('settings.personalityTitle'),
                value: _personaName,
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => const PersonasScreen()));
                  await _loadPersonaName();
                },
              ),
              YggListRow(
                title: AppStrings.t('voice.settings.title'),
                value: _voiceLabel,
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => const VoiceSettingsScreen()));
                  await _loadVoiceLabel();
                },
              ),
            ],
          ),
          const SizedBox(height: 22),
          YggSectionLabel(AppStrings.t('settings.activeConnection')),
          YggListGroup(
            children: [
              if (profile != null)
                YggListRow(
                  leading: Icon(profile.type == ConnectionProfileType.gateway ? Icons.dns_outlined : Icons.cloud_outlined),
                  title: profile.name.isNotEmpty ? profile.name : AppStrings.t('profiles.unnamed'),
                  subtitle: profile.subtitle,
                  onTap: _openActiveConnection,
                )
              else
                YggListRow(
                  leading: const Icon(Icons.add_link),
                  title: AppStrings.t('settings.connectToGateway'),
                  accent: true,
                  onTap: _openActiveConnection,
                ),
            ],
          ),
          if (!_isDirectMode) ...[
            const SizedBox(height: 22),
            YggSectionLabel(AppStrings.t('settings.agentSection')),
            YggListGroup(
              children: [
                YggListRow(
                  title: AppStrings.t('settings.agentConfig'),
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ConfigPage(client: widget.client))),
                ),
              ],
            ),
            // Connectors need a gateway to hold the OAuth token
            // (external-actions-and-connectors-analysis.md §1.2) — hidden in
            // direct/standalone mode the same way Configuración de agente is.
            const SizedBox(height: 22),
            YggSectionLabel(AppStrings.t('settings.connectorsRow')),
            YggListGroup(
              children: [
                YggListRow(
                  title: 'Google',
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => GoogleConnectorScreen(client: widget.client))),
                ),
              ],
            ),
          ],
          const SizedBox(height: 22),
          // Always visible (not gated by !_isDirectMode) — the phone_* tools run in
          // gateway and standalone mode alike, capabilities-settings-ux.md §1.
          YggListGroup(
            children: [
              YggListRow(
                title: AppStrings.t('settings.capabilitiesRow'),
                value: AppStrings.tp('settings.capabilitiesSubtitle', {
                  'enabled': '$_enabledCapabilitiesCount',
                  'total': '${phoneDeviceToolSpecs.length}',
                }),
                onTap: _openCapabilities,
              ),
              YggListRow(
                title: AppStrings.t('settings.automations'),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AutomationsScreen())),
              ),
            ],
          ),
          const SizedBox(height: 22),
          // Also always visible — independent of the active chat ConnectionProfile:
          // these power "manage the computer" features (Proyectos) and Proyectos
          // Locales, which runs entirely on-device (Termux).
          YggListGroup(
            children: [
              YggListRow(
                title: AppStrings.t('settings.gateway'),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const GatewaySettingsScreen())),
              ),
              YggListRow(
                title: AppStrings.t('settings.host'),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PiSettingsScreen())),
              ),
              YggListRow(
                title: AppStrings.t('settings.localCompanion'),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LocalCompanionSettingsScreen())),
              ),
            ],
          ),
          const SizedBox(height: 22),
          YggSectionLabel(AppStrings.t('settings.general')),
          YggListGroup(
            children: [
              YggListRow(
                title: AppStrings.t('settings.profilesRow'),
                subtitle: profile != null
                    ? AppStrings.tp('settings.profilesActiveSuffix', {'name': profile.name})
                    : AppStrings.t('settings.profilesNoneActive'),
                onTap: _openProfiles,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
