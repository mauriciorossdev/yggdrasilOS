import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'pi_settings.dart';

/// Ajustes > Raspberry Pi — URL + api key of the Pi's term-bridge.
class PiSettingsScreen extends StatefulWidget {
  const PiSettingsScreen({super.key});

  @override
  State<PiSettingsScreen> createState() => _PiSettingsScreenState();
}

class _PiSettingsScreenState extends State<PiSettingsScreen> {
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();
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
      _baseUrlController.text = settings.baseUrl;
      _apiKeyController.text = settings.apiKey;
      _loading = false;
    });
  }

  @override
  void dispose() {
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await PiSettingsStore.save(PiSettings(
      baseUrl: _baseUrlController.text.trim(),
      apiKey: _apiKeyController.text.trim(),
    ));
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('settings.pi'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  AppStrings.t('pi.settingsSubtitle'),
                  style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _baseUrlController,
                  decoration: InputDecoration(
                    labelText: AppStrings.t('pi.urlLabel'),
                    hintText: 'https://shadow.tailnet.ts.net',
                  ),
                  keyboardType: TextInputType.url,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _apiKeyController,
                  decoration: InputDecoration(labelText: AppStrings.t('pi.apiKeyLabel')),
                  obscureText: true,
                ),
                const SizedBox(height: 24),
                ElevatedButton(onPressed: _save, child: Text(AppStrings.t('common.save'))),
              ],
            ),
    );
  }
}
