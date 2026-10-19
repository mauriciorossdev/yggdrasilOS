import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'local_companion_client.dart';
import 'local_companion_settings.dart';

/// Ajustes > Terminal Local — config for the Termux companion, independent
/// of GatewaySettings/ConnectionProfile (same idiom as GatewaySettingsScreen).
class LocalCompanionSettingsScreen extends StatefulWidget {
  const LocalCompanionSettingsScreen({super.key});

  @override
  State<LocalCompanionSettingsScreen> createState() => _LocalCompanionSettingsScreenState();
}

class _LocalCompanionSettingsScreenState extends State<LocalCompanionSettingsScreen> {
  final _baseUrlController = TextEditingController();
  final _tokenController = TextEditingController();
  bool _enabled = false;
  bool _loading = true;
  bool _testing = false;
  String? _testResult;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final settings = await LocalCompanionSettingsStore.load();
    if (!mounted) return;
    setState(() {
      _enabled = settings.enabled;
      _baseUrlController.text = settings.baseUrl;
      _tokenController.text = settings.token ?? '';
      _loading = false;
    });
  }

  @override
  void dispose() {
    _baseUrlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  LocalCompanionSettings _currentDraft() => LocalCompanionSettings(
        enabled: _enabled,
        baseUrl: _baseUrlController.text.trim(),
        token: _tokenController.text.trim(),
      );

  Future<void> _testConnection() async {
    setState(() {
      _testing = true;
      _testResult = null;
    });
    final ok = await LocalCompanionClient(_currentDraft()).health();
    if (!mounted) return;
    setState(() {
      _testing = false;
      _testResult = ok
          ? AppStrings.t('localCompanion.testOk')
          : AppStrings.t('localCompanion.testFailed');
    });
  }

  Future<void> _save() async {
    await LocalCompanionSettingsStore.save(_currentDraft());
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: Text(AppStrings.t('settings.localCompanion'))),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('settings.localCompanion'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(AppStrings.t('localCompanion.enableLabel'), style: const TextStyle(fontWeight: FontWeight.w500)),
                    const SizedBox(height: 2),
                    Text(
                      AppStrings.t('localCompanion.enableSubtitle'),
                      style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
                    ),
                  ],
                ),
              ),
              Switch(
                value: _enabled,
                activeColor: YggColors.accent,
                onChanged: (v) => setState(() => _enabled = v),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _baseUrlController,
            decoration: InputDecoration(labelText: AppStrings.t('localCompanion.baseUrlLabel')),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _tokenController,
            decoration: InputDecoration(labelText: AppStrings.t('localCompanion.tokenLabel')),
            obscureText: true,
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: _testing ? null : _testConnection,
            child: Text(_testing ? AppStrings.t('localCompanion.testing') : AppStrings.t('localCompanion.testConnection')),
          ),
          if (_testResult != null) ...[
            const SizedBox(height: 8),
            Text(_testResult!, style: const TextStyle(color: YggColors.textMuted)),
          ],
          const SizedBox(height: 24),
          ElevatedButton(onPressed: _save, child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
  }
}
