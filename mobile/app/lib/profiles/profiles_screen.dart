import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import 'connection_profile.dart';
import 'profile_editor_screen.dart';
import 'profile_store.dart';
import '../hub/desktops_screen.dart';
import '../hub/hub_scan_screen.dart';

/// Manual profile selector (remote-access-analysis.md §1.1) — the user picks
/// which saved connection to use by hand, no auto-failover. This screen only
/// manages the list + which profile is marked active; actually switching the
/// live connection over to a selected profile is separate follow-up work
/// (standalone tool-loop for provider-directo profiles isn't built yet).
class ProfilesScreen extends StatefulWidget {
  const ProfilesScreen({super.key});

  @override
  State<ProfilesScreen> createState() => _ProfilesScreenState();
}

class _ProfilesScreenState extends State<ProfilesScreen> {
  List<ConnectionProfile> _profiles = [];
  String? _activeId;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final profiles = await ProfileStore.list();
    final activeId = await ProfileStore.getActiveId();
    if (!mounted) return;
    setState(() {
      _profiles = profiles;
      _activeId = activeId;
      _loading = false;
    });
  }

  Future<void> _setActive(ConnectionProfile profile) async {
    await ProfileStore.setActiveId(profile.id);
    if (!mounted) return;
    setState(() => _activeId = profile.id);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(AppStrings.tp('dialog.activeProfileSnackbar', {'name': profile.name}))),
    );
  }

  Future<void> _newProfile() async {
    final created = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const ProfileEditorScreen()),
    );
    if (created == true) _load();
  }

  Future<void> _editProfile(ConnectionProfile profile) async {
    final edited = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => ProfileEditorScreen(existing: profile)),
    );
    if (edited == true) _load();
  }

  Future<void> _deleteProfile(ConnectionProfile profile) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('dialog.deleteProfileTitle')),
        content: Text(AppStrings.tp('dialog.deleteProfileConfirm', {'name': profile.name})),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: Text(AppStrings.t('common.delete'))),
        ],
      ),
    );
    if (confirmed != true) return;
    await ProfileStore.delete(profile.id);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppStrings.t('profiles.title')),
        actions: [
          IconButton(
            tooltip: AppStrings.t('hub.scanTitle'),
            icon: const Icon(Icons.qr_code_scanner),
            onPressed: () async {
              await Navigator.push(context, MaterialPageRoute(builder: (_) => const HubScanScreen()));
              _load();
            },
          ),
          IconButton(
            tooltip: AppStrings.t('hub.desktopsTitle'),
            icon: const Icon(Icons.computer),
            onPressed: () async {
              await Navigator.push(context, MaterialPageRoute(builder: (_) => const DesktopsScreen()));
              _load();
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _profiles.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          AppStrings.t('profiles.empty'),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton.icon(
                          onPressed: _newProfile,
                          icon: const Icon(Icons.add),
                          label: Text(AppStrings.t('profiles.newProfile')),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView.separated(
                  itemCount: _profiles.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final profile = _profiles[i];
                    final isActive = profile.id == _activeId;
                    return ListTile(
                      leading: Icon(
                        profile.type == ConnectionProfileType.gateway ? Icons.dns_outlined : Icons.cloud_outlined,
                      ),
                      title: Text(profile.name.isNotEmpty ? profile.name : AppStrings.t('profiles.unnamed')),
                      subtitle: Text(profile.subtitle),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (isActive)
                            Padding(
                              padding: const EdgeInsets.only(right: 4),
                              child: Icon(Icons.check_circle, color: Theme.of(context).colorScheme.primary),
                            ),
                          PopupMenuButton<String>(
                            onSelected: (value) {
                              if (value == 'edit') _editProfile(profile);
                              if (value == 'delete') _deleteProfile(profile);
                            },
                            itemBuilder: (context) => [
                              PopupMenuItem(value: 'edit', child: Text(AppStrings.t('common.edit'))),
                              PopupMenuItem(value: 'delete', child: Text(AppStrings.t('common.delete'))),
                            ],
                          ),
                        ],
                      ),
                      onTap: () => _setActive(profile),
                    );
                  },
                ),
      floatingActionButton: _profiles.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: _newProfile,
              icon: const Icon(Icons.add),
              label: Text(AppStrings.t('profiles.newProfile')),
            ),
    );
  }
}
