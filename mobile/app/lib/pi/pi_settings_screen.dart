import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'pi_settings.dart';

/// Ajustes > Host — name, URL, api key, chat pane and Tailscale toggle of the
/// remote host's term-bridge. Saving with an empty URL/key, or removing the
/// host, makes the home chat button disappear.
class PiSettingsScreen extends StatefulWidget {
  const PiSettingsScreen({super.key});

  @override
  State<PiSettingsScreen> createState() => _PiSettingsScreenState();
}

class _PiSettingsScreenState extends State<PiSettingsScreen> {
  final _nameController = TextEditingController();
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();
  final _paneController = TextEditingController();
  bool _useTailscale = true;
  bool _configured = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final settings = await PiSettingsStore.load();
    if (!mounted) return;
    setState(() {
      _nameController.text = settings.name;
      _baseUrlController.text = settings.baseUrl;
      _apiKeyController.text = settings.apiKey;
      _paneController.text = settings.paneId;
      _useTailscale = settings.useTailscale;
      _configured = settings.isReady;
      _loading = false;
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    _paneController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await PiSettingsStore.save(PiSettings(
      baseUrl: _baseUrlController.text.trim(),
      apiKey: _apiKeyController.text.trim(),
      name: _nameController.text.trim(),
      paneId: _paneController.text.trim().isEmpty ? PiSettings.defaultPaneId : _paneController.text.trim(),
      useTailscale: _useTailscale,
    ));
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  Future<void> _remove() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('host.remove')),
        content: Text(AppStrings.t('host.removeConfirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(AppStrings.t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: Text(AppStrings.t('host.remove'))),
        ],
      ),
    );
    if (confirmed != true) return;
    await PiSettingsStore.clear();
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('settings.host'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  AppStrings.t('host.settingsSubtitle'),
                  style: TextStyle(fontSize: 12, color: YggColors.textFainter),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _nameController,
                  decoration: InputDecoration(
                    labelText: AppStrings.t('host.nameLabel'),
                    hintText: 'Claude @ shadow',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _baseUrlController,
                  decoration: InputDecoration(
                    labelText: AppStrings.t('host.urlLabel'),
                    hintText: 'https://my-pi.example.ts.net',
                  ),
                  keyboardType: TextInputType.url,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _apiKeyController,
                  decoration: InputDecoration(labelText: AppStrings.t('pi.apiKeyLabel')),
                  obscureText: true,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _paneController,
                  decoration: InputDecoration(
                    labelText: AppStrings.t('host.paneLabel'),
                    hintText: PiSettings.defaultPaneId,
                    helperText: AppStrings.t('host.paneHelp'),
                    helperMaxLines: 3,
                  ),
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(AppStrings.t('host.useTailscale')),
                  subtitle: Text(AppStrings.t('host.useTailscaleHelp')),
                  value: _useTailscale,
                  onChanged: (v) => setState(() => _useTailscale = v),
                ),
                const SizedBox(height: 16),
                ElevatedButton(onPressed: _save, child: Text(AppStrings.t('common.save'))),
                if (_configured) ...[
                  const SizedBox(height: 8),
                  TextButton(onPressed: _remove, child: Text(AppStrings.t('host.remove'))),
                ],
              ],
            ),
    );
  }
}
