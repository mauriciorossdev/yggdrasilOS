import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'gateway_settings.dart';

/// Ajustes > Gateway — config for gateway-backed "manage the computer"
/// features (Proyectos and whatever follows), independent of whichever
/// ConnectionProfile is active for chat.
class GatewaySettingsScreen extends StatefulWidget {
  const GatewaySettingsScreen({super.key});

  @override
  State<GatewaySettingsScreen> createState() => _GatewaySettingsScreenState();
}

class _GatewaySettingsScreenState extends State<GatewaySettingsScreen> {
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();
  bool _enabled = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final settings = await GatewaySettingsStore.load();
    if (!mounted) return;
    setState(() {
      _enabled = settings.enabled;
      _baseUrlController.text = settings.baseUrl;
      _apiKeyController.text = settings.apiKey ?? '';
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
    await GatewaySettingsStore.save(GatewaySettings(
      enabled: _enabled,
      baseUrl: _baseUrlController.text.trim(),
      apiKey: _apiKeyController.text.trim(),
    ));
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: Text(AppStrings.t('settings.gateway'))),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('settings.gateway'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(AppStrings.t('gateway.enableLabel'), style: const TextStyle(fontWeight: FontWeight.w500)),
                    const SizedBox(height: 2),
                    Text(
                      AppStrings.t('gateway.enableSubtitle'),
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
            decoration: InputDecoration(
              labelText: AppStrings.t('editor.gatewayUrlLabel'),
              hintText: AppStrings.t('editor.gatewayUrlHint'),
            ),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _apiKeyController,
            decoration: InputDecoration(labelText: AppStrings.t('editor.apiKeyOptionalLabel')),
            obscureText: true,
          ),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: _save, child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
  }
}
