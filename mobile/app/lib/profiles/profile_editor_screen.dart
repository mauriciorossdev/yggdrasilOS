import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import 'connection_profile.dart';
import 'profile_store.dart';

/// Create/edit one connection profile. Fields shown depend on the type
/// picked (gateway vs direct) — shape per remote-access-analysis.md §7.1.
class ProfileEditorScreen extends StatefulWidget {
  final ConnectionProfile? existing;

  const ProfileEditorScreen({super.key, this.existing});

  @override
  State<ProfileEditorScreen> createState() => _ProfileEditorScreenState();
}

class _ProfileEditorScreenState extends State<ProfileEditorScreen> {
  late ConnectionProfileType _type;
  final _nameController = TextEditingController();
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();
  final _modelController = TextEditingController();
  DirectProvider _provider = DirectProvider.anthropic;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _type = existing?.type ?? ConnectionProfileType.gateway;
    _nameController.text = existing?.name ?? '';
    _baseUrlController.text = existing?.baseUrl ?? '';
    _apiKeyController.text = existing?.apiKey ?? '';
    _modelController.text = existing?.model ?? '';
    _provider = existing?.provider ?? DirectProvider.anthropic;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    _modelController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppStrings.t('dialog.profileNeedsName'))),
      );
      return;
    }
    final id = widget.existing?.id ?? DateTime.now().millisecondsSinceEpoch.toString();
    final profile = ConnectionProfile(
      id: id,
      name: name,
      type: _type,
      createdAt: widget.existing?.createdAt,
      lastUsedAt: widget.existing?.lastUsedAt,
      baseUrl: _type == ConnectionProfileType.gateway ? _baseUrlController.text.trim() : null,
      apiKey: _apiKeyController.text.trim(),
      provider: _type == ConnectionProfileType.direct ? _provider : null,
      model: _type == ConnectionProfileType.direct && _modelController.text.trim().isNotEmpty
          ? _modelController.text.trim()
          : null,
    );
    await ProfileStore.upsert(profile);
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? AppStrings.t('editor.newProfileTitle') : AppStrings.t('editor.editProfileTitle'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _nameController,
            decoration: InputDecoration(
              labelText: AppStrings.t('editor.nameLabel'),
              hintText: AppStrings.t('editor.nameHint'),
            ),
          ),
          const SizedBox(height: 16),
          SegmentedButton<ConnectionProfileType>(
            segments: [
              ButtonSegment(value: ConnectionProfileType.gateway, label: Text(AppStrings.t('editor.gatewaySegment')), icon: const Icon(Icons.dns_outlined)),
              ButtonSegment(
                value: ConnectionProfileType.direct,
                label: Text(AppStrings.t('editor.directSegment')),
                icon: const Icon(Icons.cloud_outlined),
              ),
            ],
            selected: {_type},
            onSelectionChanged: (selection) => setState(() => _type = selection.first),
          ),
          const SizedBox(height: 16),
          if (_type == ConnectionProfileType.gateway) ..._buildGatewayFields() else ..._buildDirectFields(),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: _save, child: Text(AppStrings.t('common.save'))),
        ],
      ),
    );
  }

  List<Widget> _buildGatewayFields() {
    return [
      TextField(
        controller: _baseUrlController,
        decoration: InputDecoration(labelText: AppStrings.t('editor.gatewayUrlLabel'), hintText: AppStrings.t('editor.gatewayUrlHint')),
        keyboardType: TextInputType.url,
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _apiKeyController,
        decoration: InputDecoration(labelText: AppStrings.t('editor.apiKeyOptionalLabel')),
        obscureText: true,
      ),
    ];
  }

  List<Widget> _buildDirectFields() {
    return [
      DropdownButtonFormField<DirectProvider>(
        initialValue: _provider,
        decoration: InputDecoration(labelText: AppStrings.t('editor.providerLabel')),
        items: DirectProvider.values
            .map((p) => DropdownMenuItem(value: p, child: Text(p.label)))
            .toList(),
        onChanged: (value) {
          if (value != null) setState(() => _provider = value);
        },
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _apiKeyController,
        decoration: InputDecoration(labelText: AppStrings.t('editor.apiKeyLabel')),
        obscureText: true,
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _modelController,
        decoration: InputDecoration(labelText: AppStrings.t('editor.modelOptionalLabel'), hintText: AppStrings.t('editor.modelOptionalHint')),
      ),
      const SizedBox(height: 12),
      Text(
        AppStrings.t('editor.standaloneNote'),
        style: Theme.of(context).textTheme.bodySmall,
      ),
    ];
  }
}
