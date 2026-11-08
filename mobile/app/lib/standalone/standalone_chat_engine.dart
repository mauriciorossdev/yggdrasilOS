import 'dart:convert';
import 'package:flutter/services.dart';

import '../capabilities/capability_registry.dart';
import '../l10n/app_strings.dart';
import '../pi/pi_settings.dart';
import '../profiles/connection_profile.dart';
import '../services/capabilities_store.dart';
import '../services/phone_auto_approve_store.dart';
import '../services/device_tool_specs.dart';
import 'device_tool_executor.dart';
import 'local_chat.dart';
import 'local_chat_store.dart';
import 'local_message.dart';
import 'providers/anthropic_client.dart';
import 'providers/openai_compat_client.dart';
import 'providers/provider_client.dart';
import 'suggestion.dart';
import 'system_prompt_builder.dart';

/// Runs one direct-to-provider turn end to end: send history to the
/// provider, execute any tool calls it asks for locally (the 4 phone_*
/// tools, all "safe" — remote-access-analysis.md §7.2, no approval loop),
/// feed the results back, repeat until the provider replies with plain text.
/// Callback-driven rather than a stream — standalone has no gateway event
/// bus, this whole thing is one sequential await chain in the same process.
class StandaloneChatEngine {
  final ConnectionProfile profile;
  final DeviceToolExecutor executor = DeviceToolExecutor();
  late final ProviderClient _client;

  static const _maxToolIterations = 6;

  // Standalone-only local gate (Architect's ruling, external-actions-and-
  // connectors-analysis.md §6): device_tool_specs.dart's riskLevel is never
  // sent to/trusted from the gateway, but standalone has no gateway approval
  // machinery to fall back on, so it needs its own copy to know which tools
  // need a confirmation dialog before executing.
  String _riskLevelFor(String toolName) => capabilityByName(toolName)?.riskLevel ?? 'safe';

  /// [client] replaces the provider's own client (tests).
  StandaloneChatEngine(this.profile, {ProviderClient? client}) {
    if (client != null) {
      _client = client;
      return;
    }
    switch (profile.provider) {
      case DirectProvider.anthropic:
        _client = AnthropicClient();
        break;
      case DirectProvider.openai:
        _client = OpenAiCompatClient.openAi();
        break;
      case DirectProvider.ollamaCloud:
        _client = OpenAiCompatClient.ollamaCloud();
        break;
      case null:
        throw ArgumentError('profile has no provider set');
    }
  }

  /// The model the next turn will run on: the profile's pick, else the
  /// provider's default.
  String get currentModel => profile.model?.isNotEmpty == true ? profile.model! : _client.defaultModel;

  Future<void> sendMessage({
    required LocalChat chat,
    required String userText,
    required void Function() onThinkingStart,
    required void Function() onThinkingEnd,
    required void Function(LocalMessage message) onMessageAdded,
    required void Function(String toolName, String status) onToolActivity,
    required void Function(String toolName, String status) onInteractiveProgress,
    required Future<bool> Function(String toolName, Map<String, dynamic> args) onConfirmModerateAction,
    // A voice conversation: the model is told to answer for the ear and isn't offered
    // suggestion cards (nothing to show them on).
    bool voiceMode = false,
    // Called when the provider call fails (the error is also recorded as an assistant message).
    void Function(Object error)? onProviderError,
  }) async {
    void addAndPersist(LocalMessage m) {
      chat.messages.add(m);
      onMessageAdded(m);
    }

    addAndPersist(LocalMessage(role: LocalRole.user, text: userText));
    await LocalChatStore.upsert(chat);

    // Creating a project needs the user's host; without one the model isn't told about it.
    final projectsAvailable = (await PiSettingsStore.load()).isReady;

    for (var iteration = 0; iteration < _maxToolIterations; iteration++) {
      onThinkingStart();
      ProviderChatResult result;
      try {
        result = await _client.chat(
          apiKey: profile.apiKey ?? '',
          model: profile.model,
          history: chat.messages,
          toolSpecs: [
            ...await enabledDeviceToolSpecs(),
            if (!voiceMode) buildSuggestActionSpec(projectsAvailable: projectsAvailable),
          ],
          systemPrompt: await SystemPromptBuilder.forCurrentUser(
            personaId: chat.personaId,
            extraSections: [voiceMode ? voiceModeGuidance : buildSuggestionGuidance(projectsAvailable: projectsAvailable)],
          ),
        );
      } catch (e) {
        onThinkingEnd();
        onProviderError?.call(e);
        addAndPersist(LocalMessage(role: LocalRole.assistant, text: '${AppStrings.t('common.errorPrefix')}: $e'));
        await LocalChatStore.upsert(chat);
        return;
      }
      onThinkingEnd();

      addAndPersist(LocalMessage(
        role: LocalRole.assistant,
        text: result.text,
        toolCalls: result.toolCalls.isEmpty ? null : result.toolCalls,
        usage: result.usage,
      ));
      await LocalChatStore.upsert(chat);

      if (result.toolCalls.isEmpty) return;

      for (final call in result.toolCalls) {
        // Not a device capability: the offer shows as a card and the user answers it
        // there, so the model just gets an acknowledgement to carry on from.
        if (call.name == suggestActionToolName) {
          final valid = Suggestion.fromCall(call) != null;
          addAndPersist(LocalMessage(
            role: LocalRole.tool,
            text: jsonEncode(valid
                ? {'status': suggestionPending, 'note': suggestionResultNote}
                : {'error': 'invalid_suggestion'}),
            toolCallId: call.id,
            toolName: call.name,
            toolOk: valid,
          ));
          await LocalChatStore.upsert(chat);
          continue;
        }
        // Defense-in-depth (capabilities-settings-design.md §4 point 5),
        // checked before the risk gate so a disabled capability never even
        // reaches onConfirmModerateAction — same edge case as
        // yggdrasil_client.dart's equivalent guard.
        if (!(await CapabilitiesStore.isEnabled(call.name))) {
          onToolActivity(call.name, 'running');
          addAndPersist(LocalMessage(
            role: LocalRole.tool,
            text: jsonEncode({'error': 'capability_disabled'}),
            toolCallId: call.id,
            toolName: call.name,
            toolOk: false,
          ));
          onToolActivity(call.name, 'error');
          await LocalChatStore.upsert(chat);
          continue;
        }
        if (_riskLevelFor(call.name) != 'safe' && !(await PhoneAutoApproveStore.isEnabled())) {
          final approved = await onConfirmModerateAction(call.name, call.args);
          if (!approved) {
            onToolActivity(call.name, 'running');
            addAndPersist(LocalMessage(
              role: LocalRole.tool,
              text: jsonEncode({'error': AppStrings.t('tool.deniedByUser')}),
              toolCallId: call.id,
              toolName: call.name,
              toolOk: false,
            ));
            onToolActivity(call.name, 'denied');
            await LocalChatStore.upsert(chat);
            continue;
          }
        }
        onToolActivity(call.name, 'running');
        try {
          final toolResult = await executor.execute(
            call.name,
            call.args,
            onProgress: (status) => onInteractiveProgress(call.name, status),
          );
          addAndPersist(LocalMessage(
            role: LocalRole.tool,
            text: jsonEncode(toolResult),
            toolCallId: call.id,
            toolName: call.name,
            toolOk: true,
          ));
          onToolActivity(call.name, 'ok');
        } on PlatformException catch (e) {
          addAndPersist(LocalMessage(
            role: LocalRole.tool,
            text: jsonEncode({
              'error': e.message ?? e.code,
              if (e.details != null) 'details': e.details,
            }),
            toolCallId: call.id,
            toolName: call.name,
            toolOk: false,
          ));
          onToolActivity(call.name, e.code == 'cancelled' ? 'cancelled' : 'error');
        } catch (e) {
          addAndPersist(LocalMessage(
            role: LocalRole.tool,
            text: jsonEncode({'error': e.toString()}),
            toolCallId: call.id,
            toolName: call.name,
            toolOk: false,
          ));
          onToolActivity(call.name, 'error');
        }
        await LocalChatStore.upsert(chat);
      }
    }

    addAndPersist(LocalMessage(
      role: LocalRole.assistant,
      text: AppStrings.t('chat.toolStepLimitReached'),
    ));
    await LocalChatStore.upsert(chat);
  }
}
