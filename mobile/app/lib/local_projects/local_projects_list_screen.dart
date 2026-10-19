import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'local_companion_client.dart';
import 'local_companion_settings.dart';
import 'local_project_detail_screen.dart';

/// "Proyectos Locales" — list of project folders living under ~/projects/
/// inside Termux on this phone, backed by the companion server (see
/// mobile/termux/companion.js). Independent of the desktop-mirroring
/// ProjectsScreen (chat/projects_screen.dart), which reads a remote
/// gateway's projects.list instead.
class LocalProjectsListScreen extends StatefulWidget {
  final LocalCompanionSettings settings;

  const LocalProjectsListScreen({super.key, required this.settings});

  @override
  State<LocalProjectsListScreen> createState() => _LocalProjectsListScreenState();
}

class _LocalProjectsListScreenState extends State<LocalProjectsListScreen> {
  late final LocalCompanionClient _client = LocalCompanionClient(widget.settings);
  List<LocalProject> _projects = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final projects = await _client.listProjects();
      if (!mounted) return;
      setState(() {
        _projects = projects;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _createProject() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(AppStrings.t('localProjects.newProject')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(hintText: AppStrings.t('localProjects.newProjectHint')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(AppStrings.t('common.cancel'))),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: Text(AppStrings.t('common.save')),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      await _client.createProject(name);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  void _openDetail(LocalProject project) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => LocalProjectDetailScreen(settings: widget.settings, project: project)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('localProjects.title'))),
      floatingActionButton: FloatingActionButton(onPressed: _createProject, child: const Icon(Icons.add)),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
                )
              : _projects.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(AppStrings.t('localProjects.empty'), style: const TextStyle(color: YggColors.textFaint)),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: YggColors.accent,
                      child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
                        itemCount: _projects.length,
                        itemBuilder: (_, i) {
                          final project = _projects[i];
                          return GestureDetector(
                            onTap: () => _openDetail(project),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 12),
                              child: Row(
                                children: [
                                  const Icon(Icons.folder_outlined, color: YggColors.text, size: 18),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      project.name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontSize: 14.5, color: YggColors.text),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
