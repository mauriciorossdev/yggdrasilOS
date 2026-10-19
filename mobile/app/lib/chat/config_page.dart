import 'package:flutter/material.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Provider/model picker for the default agent, backed by config.get/
/// config.patch. This used to save a flat top-level {provider, model} —
/// stale from before the gateway moved to multiple named agents
/// (packages/config/src/patch.ts only accepts agents/providers/... as
/// patch keys; "provider"/"model" alone were never valid, and neither was
/// wrapping the patch in a {config: ...} envelope, both confirmed on-device
/// via config.patch's real "forbidden keys" error). Now edits the
/// `defaultAgent` entry inside the real `agents` array and patches just
/// that one agent object — config.patch merges agents by id, so this never
/// touches any other agent (e.g. "plan").
class ConfigPage extends StatefulWidget {
  final YggdrasilClient client;
  const ConfigPage({super.key, required this.client});

  @override
  State<ConfigPage> createState() => _ConfigPageState();
}

class _ConfigPageState extends State<ConfigPage> {
  List<dynamic> _providers = [];
  String? _selectedProvider;
  List<dynamic> _models = [];
  String? _selectedModel;
  bool _loading = true;
  String? _loadError;
  // Set from the selected provider's own `error` (providers.list catches each
  // provider's listModels() independently — see gateway/methods.ts's
  // providers.list — so an unreachable Ollama daemon, say, surfaces here
  // instead of just leaving the model dropdown silently empty).
  String? _providerError;

  Map<String, dynamic>? _defaultAgent;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final providers = await widget.client.getProviders();
    final configRes = await widget.client.getConfig();
    final config = configRes is Map ? (configRes['config'] ?? {}) : {};

    final agents = (config['agents'] as List<dynamic>?) ?? [];
    final defaultAgentId = config['defaultAgent']?.toString() ?? 'default';
    final agentRaw = agents.firstWhere(
      (a) => a is Map && a['id'] == defaultAgentId,
      orElse: () => agents.isNotEmpty ? agents.first : null,
    );
    final agent = agentRaw is Map ? Map<String, dynamic>.from(agentRaw) : null;

    setState(() {
      _providers = providers;
      _defaultAgent = agent;
      _loadError = agent == null ? 'No agent config found (defaultAgent: $defaultAgentId)' : null;
      _selectedProvider = agent?['provider']?.toString();
      _selectedModel = agent?['model']?.toString();

      if (_selectedProvider != null) {
        _updateModels(_selectedProvider);
      }
      _loading = false;
    });
  }

  void _updateModels(String? providerId) {
    final provider = _providers.firstWhere(
      (p) => p['id'] == providerId,
      orElse: () => {'models': []},
    );
    _models = provider['models'] ?? [];
    _providerError = provider['error']?.toString();
  }

  Future<void> _saveConfig() async {
    if (_defaultAgent == null) {
      // Nothing to merge provider/model into — bailing rather than
      // fabricating a bare {id, provider, model} agent object, which would
      // silently drop its real label/systemPrompt/scope on the server.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_loadError ?? 'No agent to update')));
      return;
    }
    if (_selectedProvider == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('config.selectProviderHint'))));
      return;
    }
    if (_selectedModel == null) {
      // Silently no-op-ing here (the bug this fixed) left no clue why
      // "Guardar" did nothing — usually because the provider's own
      // listModels() failed (see _providerError) and left the model dropdown
      // with nothing to pick.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(_providerError != null
            ? AppStrings.tp('config.providerUnavailable', {'error': _providerError!})
            : AppStrings.t('config.selectModelHint')),
      ));
      return;
    }
    final updatedAgent = {..._defaultAgent!, 'provider': _selectedProvider, 'model': _selectedModel};
    try {
      // config.patch merges the `agents` array by id (gateway/src/
      // methods.ts) — sending just this one agent leaves every other agent
      // (e.g. "plan") untouched.
      await widget.client.updateConfig({'agents': [updatedAgent]});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      return;
    }
    await widget.client.savePreference('provider', _selectedProvider!);
    await widget.client.savePreference('model', _selectedModel!);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('config.title'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                children: [
                  DropdownButtonFormField<String>(
                    value: _selectedProvider,
                    // Without isExpanded, the button sizes itself to its
                    // widest item and overflows once a real (possibly long)
                    // label shows up — e.g. a long Ollama model tag; this
                    // provider dropdown never hit it before only because
                    // every provider's `label` here happens to be short.
                    isExpanded: true,
                    hint: Text(AppStrings.t('config.selectProviderHint')),
                    items: _providers.map((p) {
                      final id = p['id']?.toString() ?? '';
                      final label = p['label']?.toString() ?? 'Sin nombre';
                      return DropdownMenuItem<String>(value: id, child: Text(label, overflow: TextOverflow.ellipsis));
                    }).toList(),
                    onChanged: (val) {
                      setState(() {
                        _selectedProvider = val;
                        _selectedModel = null;
                        _updateModels(val);
                      });
                    },
                    decoration: InputDecoration(labelText: AppStrings.t('config.providerLabel')),
                  ),
                  DropdownButtonFormField<String>(
                    value: _selectedModel,
                    // Same overflow reasoning as the provider dropdown above
                    // — this is the one that actually hit it: Ollama model
                    // tags (e.g. "nomic-embed-text:latest") are long enough
                    // to overflow without isExpanded.
                    isExpanded: true,
                    hint: Text(AppStrings.t('config.selectModelHint')),
                    items: _models.map((m) {
                      // Each entry is a ProviderModel (packages/sdk/src/
                      // provider.ts): {id, label, provider, ...} — NOT a
                      // plain string. Using `m.toString()` here used to save
                      // the whole map's Dart-default string rendering
                      // ("{id: qwen3.5:9b, label: ...}") as the model id,
                      // which the gateway would never actually resolve.
                      final id = m['id']?.toString() ?? '';
                      final label = m['label']?.toString() ?? id;
                      return DropdownMenuItem<String>(value: id, child: Text(label, overflow: TextOverflow.ellipsis));
                    }).toList(),
                    onChanged: (val) => setState(() => _selectedModel = val),
                    decoration: InputDecoration(labelText: AppStrings.t('config.modelLabel')),
                  ),
                  if (_providerError != null) ...[
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        AppStrings.tp('config.providerUnavailable', {'error': _providerError!}),
                        style: const TextStyle(color: YggColors.errorRed, fontSize: 12.5),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  ElevatedButton(onPressed: _saveConfig, child: Text(AppStrings.t('config.saveButton'))),
                ],
              ),
            ),
    );
  }
}
