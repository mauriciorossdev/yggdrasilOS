import 'package:permission_handler/permission_handler.dart';

import '../services/device_caps_channel.dart';
import 'calendar_format.dart';
import '../services/device_tools_channel.dart';
import 'device_capability.dart';

Map<String, dynamic> _ok(void _) => {'ok': true};

final List<DeviceCapability> deviceCapabilities = [
  DeviceCapability(
    name: 'phone_open_app',
    description: 'Open an installed app on the phone by its package name.',
    parameters: {
      'type': 'object',
      'properties': {
        'packageName': {'type': 'string'}
      },
      'required': ['packageName']
    },
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryApps',
    titleKey: 'capabilities.openApp',
    descriptionKey: 'capabilities.openAppDesc',
    verbKey: 'tool.openApp.verb',
    okKey: 'tool.openApp.ok',
    errorKey: 'tool.openApp.error',
    needsForeground: true,
    run: (args) => DeviceToolsChannel.openApp(args['packageName'] as String).then(_ok),
  ),
  DeviceCapability(
    name: 'phone_list_installed_apps',
    description: 'List apps installed on the phone that have a launcher entry.',
    parameters: {'type': 'object', 'properties': {}},
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryApps',
    titleKey: 'capabilities.listApps',
    descriptionKey: 'capabilities.listAppsDesc',
    verbKey: 'tool.listApps.verb',
    okKey: 'tool.listApps.ok',
    run: (args) async => {'apps': await DeviceToolsChannel.listInstalledApps()},
  ),
  DeviceCapability(
    name: 'phone_find_files',
    description:
        "Searches for files by name among those indexed by the phone's MediaStore (photos, videos, audio, and on Android 10-12 also whatever is in Downloads) WITHOUT opening any picker — the result comes back directly. Partial scope: it cannot see loose documents in other folders or other apps' private folders; to pick a file by hand or open the files app, use phone_pick_file instead.",
    parameters: {
      'type': 'object',
      'properties': {
        'query': {'type': 'string', 'description': 'Text to search for in the file name (substring, not regex).'},
        'extension': {'type': 'string', 'description': 'Optional extension filter, e.g. "pdf" (no dot). Don\'t combine with mimeType.'},
        'mimeType': {'type': 'string', 'description': 'Optional exact MIME type filter, e.g. "application/pdf". Don\'t combine with extension.'},
        'limit': {'type': 'integer', 'description': 'Maximum number of results to return, default 25, cap 100.'}
      },
      'required': ['query']
    },
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryFiles',
    titleKey: 'capabilities.findFiles',
    descriptionKey: 'capabilities.findFilesDesc',
    run: (args) => DeviceToolsChannel.findFiles(
      query: args['query'] as String,
      extension: args['extension'] as String?,
      mimeType: args['mimeType'] as String?,
      limit: (args['limit'] as num?)?.toInt(),
    ),
  ),
  DeviceCapability(
    name: 'phone_pick_file',
    description:
        'Opens the phone\'s document picker (Storage Access Framework) so the USER manually picks a single file. Does not search anything — if the request is "find file X", use phone_find_files instead. Use this only when the user explicitly asks to pick or open the files app. Waits on the user, can take a while or be cancelled.',
    parameters: {
      'type': 'object',
      'properties': {
        'mimeType': {'type': 'string', 'description': 'Optional MIME type filter, e.g. "application/pdf". Defaults to any type.'}
      },
    },
    kind: 'interactive',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryFiles',
    titleKey: 'capabilities.pickFile',
    descriptionKey: 'capabilities.pickFileDesc',
    needsForeground: true,
    run: (args) => DeviceToolsChannel.pickDocument(mimeType: args['mimeType'] as String?),
    cancel: DeviceToolsChannel.cancelPickDocument,
  ),
  DeviceCapability(
    name: 'phone_list_documents',
    description:
        'Open the phone\'s directory picker so the user can pick a folder, then list the files directly inside it (not recursive). Waits on the user, can take a while or be cancelled.',
    parameters: {'type': 'object', 'properties': {}},
    kind: 'interactive',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryFiles',
    titleKey: 'capabilities.pickDirectory',
    descriptionKey: 'capabilities.pickDirectoryDesc',
    needsForeground: true,
    run: (args) => DeviceToolsChannel.pickDirectory(),
    cancel: DeviceToolsChannel.cancelPickDirectory,
  ),
  // Alarm/timer/calendar: plain startActivity, no onActivityResult — "sync".
  // Confirmed on the real Samsung (SM-N770F): the clock app saves the
  // alarm/timer immediately, no confirm screen.
  DeviceCapability(
    name: 'phone_set_alarm',
    description:
        "Set an alarm on the phone's clock app for a specific time. The alarm is saved right away and the clock app opens showing it.",
    parameters: {
      'type': 'object',
      'properties': {
        'hour': {'type': 'integer', 'description': '0-23, 24-hour format'},
        'minute': {'type': 'integer', 'description': '0-59'},
        'label': {'type': 'string', 'description': 'Optional alarm label/name'}
      },
      'required': ['hour', 'minute']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryReminders',
    titleKey: 'capabilities.setAlarm',
    verbKey: 'tool.setAlarm.verb',
    okKey: 'tool.setAlarm.ok',
    errorKey: 'tool.setAlarm.error',
    needsForeground: true,
    run: (args) => DeviceToolsChannel.setAlarm(
      hour: (args['hour'] as num).toInt(),
      minute: (args['minute'] as num).toInt(),
      label: args['label'] as String?,
    ).then(_ok),
  ),
  DeviceCapability(
    name: 'phone_set_timer',
    description:
        "Set a countdown timer on the phone's clock app for a given duration. The timer is saved right away and the clock app opens showing it.",
    parameters: {
      'type': 'object',
      'properties': {
        'seconds': {'type': 'integer', 'description': 'Duration in seconds, e.g. 300 for 5 minutes'},
        'label': {'type': 'string', 'description': 'Optional timer label/name'}
      },
      'required': ['seconds']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryReminders',
    titleKey: 'capabilities.setTimer',
    verbKey: 'tool.setTimer.verb',
    okKey: 'tool.setTimer.ok',
    errorKey: 'tool.setTimer.error',
    needsForeground: true,
    run: (args) => DeviceToolsChannel.setTimer(
      seconds: (args['seconds'] as num).toInt(),
      label: args['label'] as String?,
    ).then(_ok),
  ),
  DeviceCapability(
    name: 'phone_add_calendar_event',
    description:
        "Create a calendar event using the phone's default calendar app (native Android intent, not a Google Calendar API call — no account linking needed, writes to whichever calendar account is already configured on the device). Opens the calendar app's add-event screen pre-filled for the user to review and save.",
    parameters: {
      'type': 'object',
      'properties': {
        'title': {'type': 'string'},
        'location': {'type': 'string', 'description': 'Optional location text'},
        'description': {'type': 'string', 'description': 'Optional notes/description'},
        'startDateTime': {'type': 'string', 'description': 'ISO-8601 local date-time, e.g. 2026-09-06T15:00:00'},
        'endDateTime': {
          'type': 'string',
          'description': 'Optional ISO-8601 local date-time. Calendar app defaults to +1h from start if omitted.'
        },
        'allDay': {'type': 'boolean', 'description': 'Optional, defaults to false'}
      },
      'required': ['title', 'startDateTime']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryReminders',
    titleKey: 'capabilities.addCalendarEvent',
    verbKey: 'tool.addCalendarEvent.verb',
    okKey: 'tool.addCalendarEvent.ok',
    errorKey: 'tool.addCalendarEvent.error',
    needsForeground: true,
    // ISO-8601 from the model (an LLM computing epoch millis is unreliable),
    // converted only here at the platform-channel boundary.
    run: (args) => DeviceToolsChannel.addCalendarEvent(
      title: args['title'] as String,
      location: args['location'] as String?,
      description: args['description'] as String?,
      beginTimeEpochMillis: DateTime.parse(args['startDateTime'] as String).millisecondsSinceEpoch,
      endTimeEpochMillis:
          args['endDateTime'] != null ? DateTime.parse(args['endDateTime'] as String).millisecondsSinceEpoch : null,
      allDay: args['allDay'] as bool? ?? false,
    ).then(_ok),
  ),
  DeviceCapability(
    name: 'phone_read_calendar',
    description:
        "Read the user's calendar events (all calendars on the phone, recurring events expanded) between two moments. Defaults to the next 7 days from now. Returns title, start, end (local ISO date-times; all-day events as plain dates), location and notes. Use phone_current_time first to resolve relative dates like \"tomorrow\" or \"Friday\".",
    parameters: {
      'type': 'object',
      'properties': {
        'startDateTime': {'type': 'string', 'description': 'ISO-8601 local date-time, e.g. 2026-10-08T00:00:00. Default: now.'},
        'endDateTime': {'type': 'string', 'description': 'ISO-8601 local date-time. Default: 7 days after the start.'},
        'limit': {'type': 'integer', 'description': 'Default 25, max 100'}
      }
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryReminders',
    titleKey: 'capabilities.readCalendar',
    descriptionKey: 'capabilities.readCalendarDesc',
    verbKey: 'tool.readCalendar.verb',
    okKey: 'tool.readCalendar.ok',
    permissions: [Permission.calendarFullAccess],
    run: (args) async {
      final begin = args['startDateTime'] != null ? DateTime.parse(args['startDateTime'] as String) : DateTime.now();
      final end = args['endDateTime'] != null
          ? DateTime.parse(args['endDateTime'] as String)
          : begin.add(const Duration(days: 7));
      final native = await DeviceCapsChannel.readCalendar(
        beginMs: begin.millisecondsSinceEpoch,
        endMs: end.millisecondsSinceEpoch,
        limit: (args['limit'] as num?)?.toInt(),
      );
      return formatCalendarResult(native);
    },
  ),
  DeviceCapability(
    name: 'phone_show_notification',
    description: 'Show a notification on the phone with a title and body. Use for alerts the user should see.',
    parameters: {
      'type': 'object',
      'properties': {
        'title': {'type': 'string'},
        'body': {'type': 'string'}
      },
      'required': ['body']
    },
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryNotify',
    titleKey: 'capabilities.showNotification',
    descriptionKey: 'capabilities.showNotificationDesc',
    verbKey: 'tool.showNotification.verb',
    okKey: 'tool.showNotification.ok',
    permissions: [Permission.notification],
    run: (args) => DeviceCapsChannel.showNotification(title: args['title'] as String?, body: args['body'] as String?),
  ),
  DeviceCapability(
    name: 'phone_clipboard_get',
    description:
        "Read the phone's clipboard text. Android only allows this while the app is in the foreground, so it can come back empty when run in the background.",
    parameters: {'type': 'object', 'properties': {}},
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryNotify',
    titleKey: 'capabilities.clipboardGet',
    descriptionKey: 'capabilities.clipboardGetDesc',
    verbKey: 'tool.clipboardGet.verb',
    okKey: 'tool.clipboardGet.ok',
    run: (args) => DeviceCapsChannel.clipboardGet(),
  ),
  DeviceCapability(
    name: 'phone_clipboard_set',
    description: "Copy text to the phone's clipboard so the user can paste it anywhere.",
    parameters: {
      'type': 'object',
      'properties': {
        'text': {'type': 'string'}
      },
      'required': ['text']
    },
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryNotify',
    titleKey: 'capabilities.clipboardSet',
    descriptionKey: 'capabilities.clipboardSetDesc',
    verbKey: 'tool.clipboardSet.verb',
    okKey: 'tool.clipboardSet.ok',
    run: (args) => DeviceCapsChannel.clipboardSet(args['text'] as String),
  ),
  DeviceCapability(
    name: 'phone_device_state',
    description:
        'Read the phone state: battery percent, whether it is charging, network (wifi|cellular|offline), ringer mode (normal|vibrate|silent), music volume percent, and whether the screen is on.',
    parameters: {'type': 'object', 'properties': {}},
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.deviceState',
    descriptionKey: 'capabilities.deviceStateDesc',
    verbKey: 'tool.deviceState.verb',
    okKey: 'tool.deviceState.ok',
    run: (args) => DeviceCapsChannel.deviceState(),
  ),
  DeviceCapability(
    name: 'phone_set_ringer_mode',
    description:
        'Set the ringer to normal, vibrate, or silent. Silent needs Do-Not-Disturb access granted to the app; if that is missing the result is an error.',
    parameters: {
      'type': 'object',
      'properties': {
        'mode': {'type': 'string', 'enum': ['normal', 'vibrate', 'silent']}
      },
      'required': ['mode']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.setRingerMode',
    descriptionKey: 'capabilities.setRingerModeDesc',
    verbKey: 'tool.setRingerMode.verb',
    okKey: 'tool.setRingerMode.ok',
    run: (args) => DeviceCapsChannel.setRingerMode(args['mode'] as String),
  ),
  DeviceCapability(
    name: 'phone_set_volume',
    description: 'Set the volume of a stream to a percent (0-100). Streams: music (media), ring, alarm.',
    parameters: {
      'type': 'object',
      'properties': {
        'stream': {'type': 'string', 'enum': ['music', 'ring', 'alarm']},
        'percent': {'type': 'integer', 'description': '0-100'}
      },
      'required': ['stream', 'percent']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.setVolume',
    descriptionKey: 'capabilities.setVolumeDesc',
    verbKey: 'tool.setVolume.verb',
    okKey: 'tool.setVolume.ok',
    run: (args) => DeviceCapsChannel.setVolume(
      stream: args['stream'] as String,
      percent: (args['percent'] as num).toInt(),
    ),
  ),
  DeviceCapability(
    name: 'phone_current_time',
    description:
        'Get the current local time of the phone: hour, minute, hhmm ("03:33"), and epoch ms. Use it with saveAs, then compare {{steps.<name>.hhmm}} in an if step.',
    parameters: {'type': 'object', 'properties': {}},
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.currentTime',
    descriptionKey: 'capabilities.currentTimeDesc',
    verbKey: 'tool.currentTime.verb',
    okKey: 'tool.currentTime.ok',
    run: (args) async {
      final now = DateTime.now();
      String two(int n) => n.toString().padLeft(2, '0');
      return {
        'hour': now.hour,
        'minute': now.minute,
        'hhmm': '${two(now.hour)}:${two(now.minute)}',
        'epochMs': now.millisecondsSinceEpoch,
      };
    },
  ),
  DeviceCapability(
    name: 'phone_flashlight',
    description: 'Turn the phone flashlight (torch) on or off.',
    parameters: {
      'type': 'object',
      'properties': {
        'on': {'type': 'boolean'}
      },
      'required': ['on']
    },
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.flashlight',
    descriptionKey: 'capabilities.flashlightDesc',
    verbKey: 'tool.flashlight.verb',
    okKey: 'tool.flashlight.ok',
    run: (args) => DeviceCapsChannel.setFlashlight(args['on'] as bool),
  ),
  DeviceCapability(
    name: 'phone_media_play',
    description:
        'Control playback in a music app (default YouTube Music) by sending a media key: play, pause, toggle, next or previous. The app must already have the track loaded; this does not search or pick a song.',
    parameters: {
      'type': 'object',
      'properties': {
        'action': {
          'type': 'string',
          'enum': ['play', 'pause', 'toggle', 'next', 'previous'],
        },
        'package': {'type': 'string'},
      },
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.mediaPlay',
    descriptionKey: 'capabilities.mediaPlayDesc',
    verbKey: 'tool.mediaPlay.verb',
    okKey: 'tool.mediaPlay.ok',
    run: (args) => DeviceCapsChannel.mediaControl(
      action: (args['action'] as String?) ?? 'play',
      package: args['package'] as String?,
    ),
  ),
  DeviceCapability(
    name: 'phone_get_location',
    description:
        'Get the phone\'s last known GPS location (lat, lng, accuracy in meters, time in epoch ms). It uses the last fix the phone has, not a fresh one.',
    parameters: {'type': 'object', 'properties': {}},
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryDevice',
    titleKey: 'capabilities.getLocation',
    descriptionKey: 'capabilities.getLocationDesc',
    verbKey: 'tool.getLocation.verb',
    okKey: 'tool.getLocation.ok',
    permissions: [Permission.locationWhenInUse],
    run: (args) => DeviceCapsChannel.getLocation(),
  ),
  DeviceCapability(
    name: 'phone_send_sms',
    description:
        'Send an SMS right away to a phone number, without the user reviewing it. Use this when the user asks you to send, text or message someone ("mandá un SMS a X diciendo Y", "enviale...", "mandale un mensaje..."). Only when the user asked to send it, not just to draft it. If the user wants to review or edit first, use phone_compose_sms. Requires the SMS permission (see Configuración → Capacidades).',
    parameters: {
      'type': 'object',
      'properties': {
        'to': {'type': 'string', 'description': 'Phone number'},
        'body': {'type': 'string'}
      },
      'required': ['to', 'body']
    },
    kind: 'sync',
    riskLevel: 'destructive',
    categoryKey: 'capabilities.categoryComm',
    titleKey: 'capabilities.sendSms',
    descriptionKey: 'capabilities.sendSmsDesc',
    verbKey: 'tool.sendSms.verb',
    okKey: 'tool.sendSms.ok',
    permissions: [Permission.sms],
    run: (args) => DeviceCapsChannel.sendSms(to: args['to'] as String, body: args['body'] as String),
  ),
  DeviceCapability(
    name: 'phone_compose_sms',
    description:
        'Open the SMS app with a recipient and pre-filled text so the user reviews and sends it themselves. Use only when the user wants to review, edit, or just open the messages app. Do not use it when the user asked you to send the message; use phone_send_sms for that.',
    parameters: {
      'type': 'object',
      'properties': {
        'to': {'type': 'string', 'description': 'Phone number'},
        'body': {'type': 'string'}
      },
      'required': ['to']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryComm',
    titleKey: 'capabilities.composeSms',
    descriptionKey: 'capabilities.composeSmsDesc',
    verbKey: 'tool.composeSms.verb',
    okKey: 'tool.composeSms.ok',
    needsForeground: true,
    run: (args) => DeviceCapsChannel.composeSms(to: args['to'] as String, body: args['body'] as String?),
  ),
  DeviceCapability(
    name: 'phone_call',
    description: 'Place a phone call to a number immediately. Only use when the user clearly asked to call.',
    parameters: {
      'type': 'object',
      'properties': {
        'number': {'type': 'string'}
      },
      'required': ['number']
    },
    kind: 'sync',
    riskLevel: 'destructive',
    categoryKey: 'capabilities.categoryComm',
    titleKey: 'capabilities.call',
    descriptionKey: 'capabilities.callDesc',
    verbKey: 'tool.call.verb',
    okKey: 'tool.call.ok',
    needsForeground: true,
    permissions: [Permission.phone],
    run: (args) => DeviceCapsChannel.call(args['number'] as String),
  ),
  DeviceCapability(
    name: 'phone_dial',
    description: 'Open the phone dialer with a number filled in, so the user presses call themselves.',
    parameters: {
      'type': 'object',
      'properties': {
        'number': {'type': 'string'}
      },
      'required': ['number']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryComm',
    titleKey: 'capabilities.dial',
    descriptionKey: 'capabilities.dialDesc',
    verbKey: 'tool.dial.verb',
    okKey: 'tool.dial.ok',
    needsForeground: true,
    run: (args) => DeviceCapsChannel.dial(args['number'] as String),
  ),
  DeviceCapability(
    name: 'phone_compose_whatsapp',
    description:
        'Open WhatsApp on the phone with a chat to a number and the message pre-filled, so the user reviews and taps send. Use when the user asks to send a WhatsApp message and WhatsApp can not be sent directly. Number with country code, digits only (e.g. 5491112345678).',
    parameters: {
      'type': 'object',
      'properties': {
        'number': {'type': 'string', 'description': 'Phone number with country code'},
        'text': {'type': 'string', 'description': 'Message text to pre-fill'}
      },
      'required': ['number']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryComm',
    titleKey: 'capabilities.composeWhatsapp',
    descriptionKey: 'capabilities.composeWhatsappDesc',
    verbKey: 'tool.composeWhatsapp.verb',
    okKey: 'tool.composeWhatsapp.ok',
    needsForeground: true,
    run: (args) => DeviceCapsChannel.composeWhatsapp(number: args['number'] as String, body: args['text'] as String?),
  ),
  DeviceCapability(
    name: 'phone_search_contacts',
    description: 'Search the phone contacts by name. Returns name and phone number pairs.',
    parameters: {
      'type': 'object',
      'properties': {
        'query': {'type': 'string', 'description': 'Part of the contact name'},
        'limit': {'type': 'integer', 'description': 'Default 10, max 100'}
      },
      'required': ['query']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryComm',
    titleKey: 'capabilities.searchContacts',
    descriptionKey: 'capabilities.searchContactsDesc',
    verbKey: 'tool.searchContacts.verb',
    okKey: 'tool.searchContacts.ok',
    permissions: [Permission.contacts],
    run: (args) => DeviceCapsChannel.searchContacts(
      query: args['query'] as String,
      limit: (args['limit'] as num?)?.toInt(),
    ),
  ),
  DeviceCapability(
    name: 'phone_open_url',
    description:
        'Open a URL or deep link on the phone. Web links open in the browser; app deep links open that app directly. Examples: https://maps.google.com/?q=..., whatsapp://send?phone=5491112345678&text=hola, spotify:search:..., tel:..., geo:lat,lng.',
    parameters: {
      'type': 'object',
      'properties': {
        'url': {'type': 'string'}
      },
      'required': ['url']
    },
    kind: 'sync',
    riskLevel: 'safe',
    categoryKey: 'capabilities.categoryLinks',
    titleKey: 'capabilities.openUrl',
    descriptionKey: 'capabilities.openUrlDesc',
    verbKey: 'tool.openUrl.verb',
    okKey: 'tool.openUrl.ok',
    needsForeground: true,
    run: (args) => DeviceCapsChannel.openUrl(args['url'] as String),
  ),
  DeviceCapability(
    name: 'phone_share_text',
    description:
        'Share text through the Android share sheet. Pass package to send it straight to one app (e.g. com.whatsapp), otherwise the user picks the target.',
    parameters: {
      'type': 'object',
      'properties': {
        'text': {'type': 'string'},
        'package': {'type': 'string', 'description': 'Optional target app package name'}
      },
      'required': ['text']
    },
    kind: 'sync',
    riskLevel: 'moderate',
    categoryKey: 'capabilities.categoryLinks',
    titleKey: 'capabilities.shareText',
    descriptionKey: 'capabilities.shareTextDesc',
    verbKey: 'tool.shareText.verb',
    okKey: 'tool.shareText.ok',
    needsForeground: true,
    run: (args) => DeviceCapsChannel.shareText(text: args['text'] as String, package: args['package'] as String?),
  ),
  DeviceCapability(
    name: 'phone_launch_intent',
    description:
        'Start any Android activity by intent: action (e.g. android.intent.action.VIEW), optional data URI, type, package, className, and string extras. Escape hatch for anything without a dedicated tool. Only start activities, not broadcasts or services.',
    parameters: {
      'type': 'object',
      'properties': {
        'action': {'type': 'string'},
        'data': {'type': 'string'},
        'type': {'type': 'string', 'description': 'MIME type'},
        'package': {'type': 'string'},
        'className': {'type': 'string'},
        'extras': {
          'type': 'object',
          'description': 'String key/value extras',
          'additionalProperties': {'type': 'string'}
        }
      },
      'required': ['action']
    },
    kind: 'sync',
    riskLevel: 'destructive',
    categoryKey: 'capabilities.categoryLinks',
    titleKey: 'capabilities.launchIntent',
    descriptionKey: 'capabilities.launchIntentDesc',
    verbKey: 'tool.launchIntent.verb',
    okKey: 'tool.launchIntent.ok',
    needsForeground: true,
    run: (args) => DeviceCapsChannel.launchIntent(args),
  ),
];

final Map<String, DeviceCapability> _byName = {for (final c in deviceCapabilities) c.name: c};

DeviceCapability? capabilityByName(String? name) => name == null ? null : _byName[name];

/// Category keys in first-appearance order (Capabilities screen grouping).
List<String> get capabilityCategoryKeys {
  final seen = <String>[];
  for (final c in deviceCapabilities) {
    if (!seen.contains(c.categoryKey)) seen.add(c.categoryKey);
  }
  return seen;
}
