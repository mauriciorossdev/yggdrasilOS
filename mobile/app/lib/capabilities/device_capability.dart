import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

/// Asks the user for [permissions] by some means other than the in-app dialog; true if all ended up granted.
typedef PermissionRequester = Future<bool> Function(List<Permission> permissions);

/// One phone_* device tool — the single place its declaration, UI copy and
/// execution live (notes/yggdrasil-mobile/on-device-workflows-design.md §1).
/// Gateway dispatch, standalone dispatch, chat cards, the Capabilities
/// screen and (later) the on-device workflow engine all derive from this.
class DeviceCapability {
  final String name;
  final String description;
  final Map<String, dynamic> parameters;

  /// "sync" | "interactive" (interactive = waits on the user, e.g. a picker).
  final String kind;

  /// "safe" | "moderate" | "destructive". Standalone-only gate — gateway mode
  /// maps risk server-side by name (methods.ts DEVICE_TOOL_RISK_LEVELS).
  final String riskLevel;

  /// l10n key of the Capabilities-screen group.
  final String categoryKey;
  final String titleKey;
  final String? descriptionKey;

  /// SyncToolCard copy; null falls back to the generic strings.
  final String? verbKey;
  final String? okKey;
  final String? errorKey;

  /// Launches an Activity — blocked when started from the background on
  /// Android 10+ (design doc §4).
  final bool needsForeground;

  /// Runtime permissions requested right before `run` (permission_handler).
  final List<Permission> permissions;

  /// Throws PlatformException on failure (code/message/details are forwarded
  /// verbatim to the model by both chat modes).
  final Future<Map<String, dynamic>> Function(Map<String, dynamic> args) run;

  /// Interactive only: best-effort close of the native UI still open.
  final Future<void> Function()? cancel;

  const DeviceCapability({
    required this.name,
    required this.description,
    required this.parameters,
    required this.kind,
    required this.riskLevel,
    required this.categoryKey,
    required this.titleKey,
    this.descriptionKey,
    this.verbKey,
    this.okKey,
    this.errorKey,
    this.needsForeground = false,
    this.permissions = const [],
    required this.run,
    this.cancel,
  });

  bool get isInteractive => kind == 'interactive';

  /// What both dispatchers call: asks for this capability's permissions first,
  /// then runs it. A refusal surfaces as PlatformException(permission_denied)
  /// with details.canAskAgain so the model can tell "ask again" from "open Settings".
  ///
  /// [requestPermissions] replaces the normal runtime dialog for callers with no
  /// Activity to ask from (the quick-access bubble's UI-less engine), where
  /// permission_handler fails with "Unable to detect current Android Activity".
  Future<Map<String, dynamic>> invoke(Map<String, dynamic> args, {PermissionRequester? requestPermissions}) async {
    if (permissions.isNotEmpty) {
      if (requestPermissions != null) {
        if (!await requestPermissions(permissions)) {
          throw PlatformException(
            code: 'permission_denied',
            message: 'Permission not granted for $name',
            details: {'canAskAgain': true},
          );
        }
      } else {
        final statuses = await permissions.request();
        if (!statuses.values.every((s) => s.isGranted)) {
          throw PlatformException(
            code: 'permission_denied',
            message: 'Permission not granted for $name',
            details: {'canAskAgain': !statuses.values.any((s) => s.isPermanentlyDenied)},
          );
        }
      }
    }
    return run(args);
  }

  /// Wire format of device.tools.register / standalone toolSpecs — unchanged
  /// from the former hand-written phoneDeviceToolSpecs list.
  Map<String, dynamic> toSpec() => {
        'name': name,
        'description': description,
        'parameters': parameters,
        'kind': kind,
        'riskLevel': riskLevel,
      };
}
