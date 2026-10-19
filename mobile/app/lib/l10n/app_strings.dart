import 'package:flutter/foundation.dart';

/// Multi-idioma — mobile-i18n-proposal.md. Mapa liviano en vez de intl/ARB
/// (decisión de Architect: con 2 idiomas fijos, ~100 strings y cero
/// plurales/date-time-pickers nativos, ARB traía más aparato del que el
/// caso pide — ver el doc para el razonamiento completo). `localeNotifier`
/// es un ValueNotifier así que un solo `ValueListenableBuilder` en la raíz
/// de main.dart reconstruye toda la app cuando cambia, sin tener que pasar
/// un callback de pantalla en pantalla como con onProfileChanged.
///
/// Nombres de marca/tagline (Yggdrasil, "ROOTED MODEL") y nombres de idioma
/// (Español/English) quedan sin traducir a propósito — son nombres propios,
/// no contenido de UI.
class AppStrings {
  AppStrings._();

  static final ValueNotifier<String> localeNotifier = ValueNotifier<String>('es');

  static String get current => localeNotifier.value;
  static set current(String value) => localeNotifier.value = value;

  /// Exposed only so the en/es key-parity test can walk every entry without
  /// reaching into a private field — mitigation for the one real risk of a
  /// plain map instead of ARB (mobile-i18n-proposal.md §3): a translation
  /// silently missing for one locale.
  static Iterable<String> get keys => _strings.keys;
  static Set<String> localesFor(String key) => _strings[key]?.keys.toSet() ?? {};

  static String t(String key) {
    final entry = _strings[key];
    if (entry == null) return key;
    return entry[current] ?? entry['es'] ?? key;
  }

  /// Sustitución simple `{param}` — no hace falta ICU/plurales (confirmado,
  /// ningún caso real hoy), esto alcanza para los ~10 strings con datos
  /// interpolados (nombre de tool, nombre de perfil, etc).
  static String tp(String key, Map<String, String> params) {
    var value = t(key);
    params.forEach((k, v) {
      value = value.replaceAll('{$k}', v);
    });
    return value;
  }

  static const Map<String, Map<String, String>> _strings = {
    // ---- assistant home ----
    'assistant.brand': {'es': 'YGGDRASIL', 'en': 'YGGDRASIL'},
    'assistant.tapToTalk': {'es': 'Toca para hablar con tu asistente', 'en': 'Tap to talk to your assistant'},
    'assistant.allChats': {'es': 'Todos los chats', 'en': 'All chats'},
    'assistant.openButton': {'es': 'Abrir asistente', 'en': 'Open assistant'},
    'assistant.chatTitle': {'es': 'Asistente', 'en': 'Assistant'},
    'attach.camera': {'es': 'Tomar una foto', 'en': 'Take a photo'},
    'attach.gallery': {'es': 'Elegir una imagen', 'en': 'Choose an image'},
    'attach.file': {'es': 'Archivo, documento o audio', 'en': 'File, document or audio'},
    'assistant.attachFailed': {'es': 'No se pudo adjuntar', 'en': 'Could not attach'},
    'assistant.attachTooBig': {'es': 'Archivo demasiado grande (máx. 25 MB)', 'en': 'File too large (max 25 MB)'},
    'assistant.attachNoPath': {'es': 'El servidor no devolvió la ruta del archivo', 'en': 'The server did not return the file path'},
    'usage.sheetTitle': {'es': 'Ajustes del asistente', 'en': 'Assistant settings'},
    'usage.model': {'es': 'Modelo', 'en': 'Model'},
    'usage.modelDefault': {'es': 'Predeterminado (Haiku)', 'en': 'Default (Haiku)'},
    'usage.context': {'es': 'Contexto de la conversación', 'en': 'Conversation context'},
    'usage.contextLeft': {'es': '{left} restantes de {total}', 'en': '{left} left of {total}'},
    'usage.total': {'es': 'Uso acumulado', 'en': 'Total usage'},
    'usage.tokens': {'es': '{inTokens} entrada · {outTokens} salida', 'en': '{inTokens} in · {outTokens} out'},
    'usage.spent': {'es': 'Gasto estimado', 'en': 'Estimated spend'},
    'usage.noPrice': {'es': 'Sin precio configurado para este modelo; solo se cuentan tokens.', 'en': 'No price set for this model; only tokens are counted.'},
    'usage.budget': {'es': 'Presupuesto (USD)', 'en': 'Budget (USD)'},
    'usage.budgetHint': {'es': 'Ej. 5.00 — vacío para quitarlo', 'en': 'e.g. 5.00 — empty to remove'},
    'usage.budgetLeft': {'es': 'Te quedan {left}', 'en': '{left} left'},
    'usage.budgetNote': {'es': 'Anthropic no entrega el saldo de tu cuenta: es un presupuesto propio.', 'en': 'Anthropic does not expose your account balance: this is your own budget.'},
    'usage.reset': {'es': 'Reiniciar contador', 'en': 'Reset counter'},
    'usage.save': {'es': 'Guardar', 'en': 'Save'},
    'usage.estimate': {'es': 'aprox.', 'en': 'approx.'},
    'usage.chipLeft': {'es': 'restan', 'en': 'left'},
    'usage.cached': {'es': '⚡ {n} leídos de la caché (10 % del precio)', 'en': '⚡ {n} read from cache (10% of the price)'},
    'documents.title': {'es': 'Documentos adjuntos', 'en': 'Attached documents'},
    'documents.open': {'es': 'Ver y borrar documentos adjuntos', 'en': 'View and delete attached documents'},
    'documents.empty': {'es': 'No has adjuntado documentos. Usa el clip del chat para enviarle uno al asistente.', 'en': 'No documents attached. Use the paperclip in the chat to send one to the assistant.'},
    'documents.deleteTitle': {'es': '¿Borrar este documento?', 'en': 'Delete this document?'},
    'documents.loadError': {'es': 'No se pudieron cargar los documentos.', 'en': 'Could not load documents.'},
    'bubble.title': {'es': 'Burbuja de acceso rápido', 'en': 'Quick-access bubble'},
    'bubble.subtitle': {'es': 'Flota sobre cualquier app. Toque: abrir el chat. Mantener: hablar, escribir o abrir.', 'en': 'Floats over any app. Tap: open the chat. Hold: talk, type or open.'},
    'bubble.permTitle': {'es': 'Falta un permiso', 'en': 'Permission needed'},
    'bubble.permBody': {'es': 'Para mostrar la burbuja sobre otras apps, Android pide que actives "Mostrar sobre otras apps" para Yggdrasil. Se abrirá esa pantalla; actívalo y vuelve aquí.', 'en': 'To show the bubble over other apps, Android needs "Display over other apps" turned on for Yggdrasil. That screen will open; enable it and come back.'},
    'bubble.permOpen': {'es': 'Abrir ajustes', 'en': 'Open settings'},
    'bubble.hint': {'es': 'Si Android la cierra con el tiempo, excluye Yggdrasil del ahorro de batería.', 'en': 'If Android closes it over time, exclude Yggdrasil from battery optimization.'},
    'hub.scanTitle': {'es': 'Escanear QR del desktop', 'en': 'Scan the desktop QR'},
    'hub.scanHint': {'es': 'En el desktop: Ajustes → Teléfono → Mostrar QR. Apunta la cámara al código.', 'en': 'On the desktop: Settings → Phone → Show QR. Point the camera at the code.'},
    'hub.notOurQr': {'es': 'Ese QR no es de Yggdrasil. Usa el de Ajustes → Teléfono en el desktop.', 'en': 'That QR is not a Yggdrasil one. Use the one in Settings → Phone on the desktop.'},
    'hub.linked': {'es': 'Enlazado con tu gateway de Railway', 'en': 'Linked to your Railway gateway'},
    'hub.desktopsTitle': {'es': 'Escritorios', 'en': 'Desktops'},
    'hub.noHub': {'es': 'Aún no sabes dónde está tu gateway de Railway. Escanea el QR que muestra el desktop en Ajustes → Teléfono.', 'en': "This phone doesn't know your Railway gateway yet. Scan the QR the desktop shows in Settings → Phone."},
    'hub.noDesktops': {'es': 'Ningún escritorio publicado. En el desktop, activa "Publicar este equipo en Railway" (Ajustes → Teléfono).', 'en': 'No desktop published. On the desktop, turn on "Publish this computer to Railway" (Settings → Phone).'},
    'hub.noProjectsOpen': {'es': 'Sin proyectos abiertos.', 'en': 'No projects open.'},
    'hub.online': {'es': 'En línea', 'en': 'Online'},
    'hub.offline': {'es': 'Sin conexión', 'en': 'Offline'},
    'hub.justNow': {'es': 'hace un momento', 'en': 'just now'},
    'hub.minutesAgo': {'es': 'hace {n} min', 'en': '{n} min ago'},
    'hub.hoursAgo': {'es': 'hace {n} h', 'en': '{n} h ago'},
    'hub.unreachable': {'es': 'No se alcanza: no está en tu misma red y su túnel no está activo. En el desktop revisa Ajustes → Teléfono ("Túnel: conectado").', 'en': 'Not reachable: not on your network and its tunnel is not active. On the desktop check Settings → Phone ("Tunnel: connected").'},
    'hub.onComputers': {'es': 'Abiertos en tus computadoras', 'en': 'Open on your computers'},
    'hub.connectingProject': {'es': 'Conectando…', 'en': 'Connecting…'},
    'hub.viaTunnel': {'es': 'vía Railway (túnel)', 'en': 'via Railway (tunnel)'},
    'hub.connected': {'es': 'Conectado a {name}', 'en': 'Connected to {name}'},
    'hub.loadError': {'es': 'No se pudo consultar el gateway de Railway.', 'en': 'Could not reach the Railway gateway.'},
    'memory.title': {'es': 'Memoria del asistente', 'en': 'Assistant memory'},
    'memory.open': {'es': 'Ver y editar la memoria', 'en': 'View and edit memory'},
    'memory.empty': {'es': 'Aún no recuerda nada. Dile "recuerda que…" en el chat, o añade algo con +.', 'en': 'Nothing remembered yet. Tell it "remember that…" in the chat, or add something with +.'},
    'memory.add': {'es': 'Añadir a la memoria', 'en': 'Add to memory'},
    'memory.edit': {'es': 'Editar recuerdo', 'en': 'Edit memory'},
    'memory.deleteTitle': {'es': '¿Olvidar esto?', 'en': 'Forget this?'},
    'memory.loadError': {'es': 'No se pudo cargar la memoria.', 'en': 'Could not load memory.'},
    'tts.section': {'es': 'Voz', 'en': 'Voice'},
    'tts.enable': {'es': 'Leer respuestas en voz alta', 'en': 'Read replies aloud'},
    'tts.voiceHint': {'es': 'Voz (vacío = predeterminada)', 'en': 'Voice (empty = default)'},
    'tts.note': {'es': 'Usa MiniMax en Replicate, desde el gateway.', 'en': 'Uses MiniMax on Replicate, via the gateway.'},
    'tts.speak': {'es': 'Escuchar', 'en': 'Listen'},
    'tts.stop': {'es': 'Detener', 'en': 'Stop'},
    'tts.error': {'es': 'No se pudo generar la voz', 'en': 'Could not generate speech'},
    // ---- common ----
    'common.cancel': {'es': 'Cancelar', 'en': 'Cancel'},
    'common.save': {'es': 'Guardar', 'en': 'Save'},
    'common.retry': {'es': 'Reintentar', 'en': 'Retry'},
    'common.delete': {'es': 'Borrar', 'en': 'Delete'},
    'common.rename': {'es': 'Renombrar', 'en': 'Rename'},
    'common.edit': {'es': 'Editar', 'en': 'Edit'},
    'common.copy': {'es': 'Copiar', 'en': 'Copy'},
    'common.approve': {'es': 'Aprobar', 'en': 'Approve'},
    'common.reject': {'es': 'Rechazar', 'en': 'Reject'},
    'common.thinking': {'es': 'Pensando…', 'en': 'Thinking…'},
    'common.errorPrefix': {'es': 'Error', 'en': 'Error'},
    'common.newChat': {'es': 'Nuevo chat', 'en': 'New chat'},

    // ---- dialogs ----
    'dialog.renameChatTitle': {'es': 'Nombre del chat', 'en': 'Chat name'},
    'dialog.profileNeedsName': {'es': 'Ponle un nombre al perfil', 'en': 'Give the profile a name'},
    'dialog.deleteProfileTitle': {'es': 'Borrar perfil', 'en': 'Delete profile'},
    'dialog.deleteProfileConfirm': {'es': '¿Borrar "{name}"?', 'en': 'Delete "{name}"?'},
    'dialog.activeProfileSnackbar': {'es': 'Perfil activo: {name}', 'en': 'Active profile: {name}'},

    // ---- home ----
    'home.greetingLateNight': {'es': 'Sigues despierto', 'en': 'Still up'},
    'home.greetingMorning': {'es': 'Buenos días', 'en': 'Good morning'},
    'home.greetingAfternoon': {'es': 'Buenas tardes', 'en': 'Good afternoon'},
    'home.greetingNight': {'es': 'Buenas noches', 'en': 'Good evening'},
    'home.subtitle': {
      'es': 'Pídeme lo que sea, o retoma un hilo de las raíces de abajo.',
      'en': 'Ask me anything, or pick up a thread from the roots below.',
    },
    'home.suggestion1Tag': {'es': 'Empezar', 'en': 'Get started'},
    'home.suggestion1Text': {'es': '¿Qué puedes hacer?', 'en': 'What can you do?'},
    'home.suggestion2Tag': {'es': 'Acción en el teléfono', 'en': 'Action on your phone'},
    'home.suggestion2Text': {'es': 'Abre Spotify', 'en': 'Open Spotify'},
    'home.suggestion3Tag': {'es': 'Archivos', 'en': 'Files'},
    'home.suggestion3Text': {
      'es': 'Busca la factura de luz en mis archivos',
      'en': 'Find the electricity bill in my files',
    },

    // ---- composer ----
    'composer.hint': {'es': 'Pregúntale algo a Yggdrasil', 'en': 'Ask Yggdrasil anything'},
    'composer.waitingHint': {'es': 'Esperando respuesta…', 'en': 'Waiting for a reply…'},

    // ---- drawer ----
    'drawer.searchHint': {'es': 'Buscar chats', 'en': 'Search chats'},
    'drawer.bucketToday': {'es': 'Hoy', 'en': 'Today'},
    'drawer.bucketYesterday': {'es': 'Ayer', 'en': 'Yesterday'},
    'drawer.bucketThisWeek': {'es': 'Esta semana', 'en': 'This week'},
    'drawer.bucketOlder': {'es': 'Anteriores', 'en': 'Earlier'},
    'drawer.untitledSession': {'es': 'Sesión sin título', 'en': 'Untitled session'},
    'drawer.messagesSuffix': {'es': 'mensajes', 'en': 'messages'},
    'drawer.you': {'es': 'tú', 'en': 'you'},

    // ---- chat ----
    'chat.headerLabel': {'es': 'CHAT', 'en': 'CHAT'},
    'chat.approvedLine': {'es': 'Aprobado — {tool}', 'en': 'Approved — {tool}'},
    'chat.autoApprovedLine': {'es': 'Auto-aprobado — {tool}', 'en': 'Auto-approved — {tool}'},
    'chat.rejectedLine': {'es': 'Rechazado — {tool}', 'en': 'Rejected — {tool}'},
    'chat.autoRejectedLine': {
      'es': 'Rechazado automáticamente — {tool}',
      'en': 'Automatically rejected — {tool}',
    },
    'chat.opensFilePicker': {
      'es': 'Esto va a abrir el selector de archivos en tu teléfono.',
      'en': "This will open the file picker on your phone.",
    },
    'chat.retryingNote': {'es': '🔄 Reintentando: {label}', 'en': '🔄 Retrying: {label}'},
    'chat.retryLabelFallback': {'es': 'la acción', 'en': 'the action'},
    'chat.turnError': {'es': 'Error en el turno', 'en': 'Turn error'},
    'chat.historyError': {'es': 'No se pudo cargar el historial. Reintenta al volver a entrar.', 'en': 'Could not load history. Reopen the chat to retry.'},
    'chat.toolStepLimitReached': {
      'es': 'Se alcanzó el límite de pasos de herramientas para este turno.',
      'en': 'Reached the tool-step limit for this turn.',
    },

    // ---- voice sheet ----
    'voice.listening': {'es': 'Escuchando', 'en': 'Listening'},
    'voice.transcribing': {'es': 'Transcribiendo', 'en': 'Transcribing'},
    'voice.notUnderstood': {
      'es': 'No se entendió, inténtalo de nuevo',
      'en': "Didn't catch that, try again",
    },
    // voice-stt-quality-investigation.md §1 — replace the generic
    // voice.notUnderstood above for the specific cases the recognizer
    // actually distinguishes (silence also covers §4b's no-onError case).
    'voice.error.silence': {'es': 'No te escuché, probá de nuevo', 'en': "Didn't hear you, try again"},
    'voice.error.noMatch': {'es': 'No entendí lo que dijiste', 'en': "Didn't understand what you said"},
    'voice.error.network': {'es': 'Sin conexión, revisá tu internet', 'en': "No connection, check your internet"},
    'voice.error.busy': {'es': 'Probá de nuevo en un momento', 'en': 'Try again in a moment'},
    // §5 — SODA on-device language pack not downloaded for the requested
    // locale, confirmed on real hardware (logcat error 13).
    'voice.error.languageUnavailable': {
      'es': 'El idioma no está descargado, revisá tu conexión',
      'en': 'Language pack not downloaded, check your connection',
    },
    // Shown as a brief toast when the notification's tap-to-listen shortcut
    // (voice-notification-shortcut-design.md §1/§3) fires while a turn is
    // in flight — the composer is already blocked but that's not visible
    // coming from the notification tray, unlike a manual tap on the
    // (visibly dimmed) mic button.
    'voice.turnInProgress': {
      'es': 'Hay un turno en curso, esperá a que termine',
      'en': 'A turn is in progress, wait for it to finish',
    },

    // ---- voice notification (voice-notification-shortcut-design.md §2) ----
    'voiceNotification.title': {'es': 'Yggdrasil', 'en': 'Yggdrasil'},
    'voiceNotification.body': {
      'es': 'Tocá para hablar con Yggdrasil',
      'en': 'Tap to talk to Yggdrasil',
    },
    'voiceNotification.action': {'es': 'Hablar', 'en': 'Speak'},
    'voiceNotification.channelName': {
      'es': 'Acceso rápido por voz',
      'en': 'Quick voice access',
    },
    'voiceNotification.channelDescription': {
      'es': 'Notificación permanente para activar el micrófono sin abrir la app',
      'en': 'Ongoing notification to activate the mic without opening the app',
    },

    // ---- device tool cards (interactive) ----
    'tool.openingPicker': {'es': 'Abriendo selector…', 'en': 'Opening picker…'},
    'tool.waitingOnPhone': {
      'es': 'Esperando selección en tu teléfono…',
      'en': 'Waiting for a selection on your phone…',
    },
    'tool.cancelling': {'es': 'Cancelando…', 'en': 'Cancelling…'},
    'tool.cancelledOnPhone': {'es': 'Cancelado en el teléfono', 'en': 'Cancelled on the phone'},
    'tool.cancelled': {'es': 'Cancelado', 'en': 'Cancelled'},
    'tool.fileSelectedWithDetail': {'es': 'Archivo seleccionado — {detail}', 'en': 'File selected — {detail}'},
    'tool.fileSelected': {'es': 'Archivo seleccionado', 'en': 'File selected'},
    'tool.phoneNoResponse': {'es': 'El teléfono no respondió', 'en': "The phone didn't respond"},
    'tool.connectionLostWaiting': {
      'es': 'Se perdió la conexión con el teléfono mientras esperaba',
      'en': 'Lost connection to the phone while waiting',
    },
    'tool.failedGeneric': {'es': 'Falló {tool}', 'en': '{tool} failed'},

    // ---- device tool cards (sync) ----
    'tool.syncNoResponse': {'es': 'Sin respuesta del teléfono', 'en': 'No response from the phone'},
    'tool.genericVerb': {'es': 'Ejecutando {tool}', 'en': 'Running {tool}'},
    'tool.genericOkWithDetail': {'es': '{tool} listo — {detail}', 'en': '{tool} ready — {detail}'},
    'tool.genericOk': {'es': '{tool} listo', 'en': '{tool} ready'},
    'tool.openApp.verb': {'es': 'Abriendo app', 'en': 'Opening app'},
    'tool.openApp.ok': {'es': 'Abrió la app', 'en': 'Opened the app'},
    'tool.openApp.error': {'es': 'No se pudo abrir la app', 'en': "Couldn't open the app"},
    'tool.listApps.verb': {'es': 'Listando apps instaladas', 'en': 'Listing installed apps'},
    'tool.listApps.ok': {'es': 'Apps listadas', 'en': 'Apps listed'},
    'tool.setAlarm.verb': {'es': 'Creando alarma', 'en': 'Setting alarm'},
    'tool.setAlarm.ok': {'es': 'Alarma creada', 'en': 'Alarm created'},
    'tool.setAlarm.error': {'es': 'No se pudo abrir la app de reloj', 'en': "Couldn't open the clock app"},
    'tool.setTimer.verb': {'es': 'Creando temporizador', 'en': 'Setting timer'},
    'tool.setTimer.ok': {'es': 'Temporizador creado', 'en': 'Timer created'},
    'tool.setTimer.error': {'es': 'No se pudo abrir la app de reloj', 'en': "Couldn't open the clock app"},
    'tool.addCalendarEvent.verb': {'es': 'Creando evento', 'en': 'Creating event'},
    'tool.addCalendarEvent.ok': {'es': 'Evento creado', 'en': 'Event created'},
    'tool.addCalendarEvent.error': {'es': 'No se pudo abrir el calendario', 'en': "Couldn't open the calendar app"},
    'tool.deniedByUser': {'es': 'Acción cancelada por el usuario', 'en': 'Action cancelled by the user'},

    // ---- standalone local confirmation (moderate-risk tools, no gateway
    // approval machinery available — mobile-i18n-proposal.md pattern reused,
    // Architect's ruling: local AlertDialog gate, no configurable
    // approvalMode for v1) ----
    'dialog.confirmActionTitle': {'es': 'Confirmar acción', 'en': 'Confirm action'},
    'dialog.moderateRiskBadge': {'es': 'MODERADO', 'en': 'MODERATE'},

    // ---- settings ----
    'settings.title': {'es': 'Configuración', 'en': 'Settings'},
    'settings.personalization': {'es': 'Personalización', 'en': 'Personalization'},
    'settings.yourName': {'es': 'Tu nombre', 'en': 'Your name'},
    'settings.yourNameHint': {'es': 'Cómo te saludamos', 'en': 'How should we greet you'},
    'settings.addYourName': {'es': 'Agregar tu nombre', 'en': 'Add your name'},
    'settings.personalityTitle': {'es': 'Personalidad de Yggdrasil', 'en': "Yggdrasil's personality"},
    'settings.personalityBody': {
      'es': 'Próximamente: vas a poder ajustar el tono y comportamiento del agente aquí.',
      'en': "Coming soon: you'll be able to adjust the agent's tone and behavior here.",
    },
    'settings.activeConnection': {'es': 'Conexión activa', 'en': 'Active connection'},
    'settings.connectToGateway': {'es': 'Conectar a un gateway', 'en': 'Connect to a gateway'},
    'settings.agentSection': {'es': 'Agente', 'en': 'Agent'},
    'settings.agentConfig': {'es': 'Configuración de agente', 'en': 'Agent configuration'},
    'settings.general': {'es': 'General', 'en': 'General'},
    'settings.profilesRow': {'es': 'Perfiles de conexión', 'en': 'Connection profiles'},
    'settings.profilesActiveSuffix': {'es': '{name} activo', 'en': '{name} active'},
    'settings.profilesNoneActive': {'es': 'Ninguno activo', 'en': 'None active'},
    'settings.language': {'es': 'Idioma', 'en': 'Language'},
    'settings.connectorsRow': {'es': 'Conectores', 'en': 'Connectors'},
    'settings.capabilitiesRow': {'es': 'Capacidades', 'en': 'Capabilities'},
    'settings.capabilitiesSubtitle': {'es': '{enabled} de {total} activas', 'en': '{enabled} of {total} active'},
    'settings.gateway': {'es': 'Gateway', 'en': 'Gateway'},
    'settings.pi': {'es': 'Raspberry Pi', 'en': 'Raspberry Pi'},

    // ---- always-on Claude chat on the Raspberry Pi (pi/) ----
    'common.chat': {'es': 'Chat', 'en': 'Chat'},
    'pi.chatTitle': {'es': 'Claude @ shadow', 'en': 'Claude @ shadow'},
    'pi.settingsSubtitle': {
      'es': 'Chat con Claude corriendo siempre en la Pi. Se conecta por Tailscale (URL de tailscale serve) con la key de deploy/set-term-key.sh.',
      'en': 'Chat with Claude always running on the Pi. Connects over Tailscale (tailscale serve URL) with the key from deploy/set-term-key.sh.',
    },
    'pi.urlLabel': {'es': 'URL de la Pi', 'en': 'Pi URL'},
    'pi.apiKeyLabel': {'es': 'API key', 'en': 'API key'},
    'pi.notConfigured': {'es': 'Configura la Raspberry Pi para usar el chat.', 'en': 'Set up the Raspberry Pi to use the chat.'},
    'pi.reconnecting': {'es': 'Conectando con la Pi…', 'en': 'Connecting to the Pi…'},
    'pi.retryNow': {'es': 'Reintentar ahora', 'en': 'Retry now'},
    'pi.model': {'es': 'Modelo', 'en': 'Model'},
    'pi.attach': {'es': 'Adjuntar archivo', 'en': 'Attach file'},
    'pi.attachFailed': {'es': 'No se pudo adjuntar', 'en': 'Could not attach'},
    'pi.usageTitle': {'es': 'Uso de la cuenta Claude', 'en': 'Claude account usage'},
    'pi.usageEmpty': {'es': 'Sin datos de uso.', 'en': 'No usage data.'},
    'pi.plan': {'es': 'Plan', 'en': 'Plan'},
    'pi.resetsIn': {'es': 'Se reinicia en {in} ({at})', 'en': 'Resets in {in} ({at})'},
    'pi.limit.session': {'es': 'Sesión (5 h)', 'en': 'Session (5 h)'},
    'pi.limit.weekly_all': {'es': 'Semanal (todos los modelos)', 'en': 'Weekly (all models)'},
    'pi.limit.weekly_opus': {'es': 'Semanal Opus', 'en': 'Weekly Opus'},
    'pi.limit.weekly_sonnet': {'es': 'Semanal Sonnet', 'en': 'Weekly Sonnet'},
    'pi.limit.weekly_scoped': {'es': 'Semanal (por modelo)', 'en': 'Weekly (per model)'},
    'pi.statsOutput': {'es': 'Tokens generados', 'en': 'Output tokens'},
    'pi.statsInput': {'es': 'Tokens de entrada nuevos', 'en': 'New input tokens'},
    'pi.statsCache': {'es': 'Leídos de caché', 'en': 'Cache reads'},
    'pi.promptWaiting': {'es': 'Claude espera tu respuesta', 'en': 'Claude is waiting for your answer'},
    'pi.promptCancel': {'es': 'Cancelar', 'en': 'Cancel'},
    'pi.promptPrev': {'es': 'Anterior', 'en': 'Previous'},
    'pi.promptNext': {'es': 'Siguiente', 'en': 'Next'},
    'pi.promptMultiHint': {
      'es': 'Toca las opciones para marcarlas o desmarcarlas; luego Siguiente.',
      'en': 'Tap options to check or uncheck them, then Next.',
    },
    'pi.statsContext': {'es': 'Contexto (última llamada)', 'en': 'Context (last call)'},

    // ---- gateway settings (independent of the active chat profile) ----
    'gateway.enableLabel': {'es': 'Activar Gateway', 'en': 'Enable Gateway'},
    'gateway.enableSubtitle': {
      'es': 'Usado para funciones que manejan cosas en la computadora, como Proyectos.',
      'en': 'Used for features that manage things on the computer, like Projects.',
    },

    // ---- local companion settings (Termux, independent of gateway/chat) ----
    'settings.localCompanion': {'es': 'Terminal Local', 'en': 'Local Terminal'},
    'localCompanion.enableLabel': {'es': 'Activar Terminal Local', 'en': 'Enable Local Terminal'},
    'localCompanion.enableSubtitle': {
      'es': 'Corre en Termux, en este mismo teléfono — no depende de la computadora.',
      'en': 'Runs in Termux, on this same phone — no computer needed.',
    },
    'localCompanion.baseUrlLabel': {'es': 'Dirección del companion', 'en': 'Companion address'},
    'localCompanion.tokenLabel': {'es': 'Token', 'en': 'Token'},
    'localCompanion.testConnection': {'es': 'Probar conexión', 'en': 'Test connection'},
    'localCompanion.testing': {'es': 'Probando…', 'en': 'Testing…'},
    'localCompanion.testOk': {'es': 'Conexión OK', 'en': 'Connection OK'},
    'localCompanion.testFailed': {
      'es': 'No se pudo conectar — ¿corriste bootstrap.sh en Termux?',
      'en': 'Could not connect — did you run bootstrap.sh in Termux?',
    },

    // ---- local projects (Termux-hosted, independent of the desktop mirror) ----
    'localProjects.title': {'es': 'Proyectos Locales', 'en': 'Local Projects'},
    'localProjects.disabledHint': {
      'es': 'Activá Terminal Local en Ajustes para usar esta función.',
      'en': 'Enable Local Terminal in Settings to use this feature.',
    },
    'localProjects.empty': {'es': 'Todavía no hay proyectos locales.', 'en': 'No local projects yet.'},
    'localProjects.emptyFiles': {'es': 'Esta carpeta está vacía.', 'en': 'This folder is empty.'},
    'localProjects.newProject': {'es': 'Nuevo proyecto', 'en': 'New project'},
    'localProjects.newProjectHint': {'es': 'Nombre del proyecto', 'en': 'Project name'},
    'localProjects.cliClaude': {'es': 'Claude', 'en': 'Claude'},
    'localProjects.cliAntigravity': {'es': 'Antigravity', 'en': 'Antigravity'},
    'localProjects.cliShell': {'es': 'Shell', 'en': 'Shell'},
    'localProjects.terminalConnectError': {
      'es': 'No se pudo conectar a la terminal.',
      'en': 'Could not connect to the terminal.',
    },

    // ---- projects (mirrors the desktop sidebar's Projects section) ----
    'common.projects': {'es': 'Proyectos', 'en': 'Projects'},
    'newProject.fab': {'es': 'Nuevo proyecto', 'en': 'New project'},
    'newProject.title': {'es': 'Nuevo proyecto', 'en': 'New project'},
    'newProject.nameHint': {'es': 'Nombre (escrito o dictado)', 'en': 'Name (typed or dictated)'},
    'newProject.where': {'es': 'Dónde crearlo', 'en': 'Where to create it'},
    'newProject.create': {'es': 'Crear', 'en': 'Create'},
    'newProject.thisComputer': {'es': 'Esta computadora', 'en': 'This computer'},
    'newProject.noTargets': {
      'es': 'No hay ninguna computadora ni Raspberry Pi disponible para crear el proyecto.',
      'en': 'No computer or Raspberry Pi available to create the project on.',
    },
    'newProject.onPi': {'es': 'En la Raspberry Pi', 'en': 'On the Raspberry Pi'},
    'newProject.created': {'es': 'Proyecto creado', 'en': 'Project created'},
    'projects.empty': {'es': 'Todavía no hay proyectos en la computadora.', 'en': 'No projects on the computer yet.'},
    'projects.lastOpened': {'es': 'Última vez abierto', 'en': 'Last opened'},
    'projects.gatewayDisabled': {
      'es': 'Activá el Gateway en Ajustes para usar esta función.',
      'en': 'Enable the Gateway in Settings to use this feature.',
    },

    // ---- project detail (tabs: Terminales/Sessions/Agent Flow/Workflows/Files) ----
    'projects.tabTerminals': {'es': 'Terminales', 'en': 'Terminals'},
    'projects.tabSessions': {'es': 'Sessions', 'en': 'Sessions'},
    'projects.tabAgentFlow': {'es': 'Agent Flow', 'en': 'Agent Flow'},
    'projects.tabWorkflows': {'es': 'Workflows', 'en': 'Workflows'},
    'projects.tabFiles': {'es': 'Files', 'en': 'Files'},
    'projects.tabComplementos': {'es': 'Complementos', 'en': 'Add-ons'},
    'projects.notOpenOnComputer': {
      'es': 'Este proyecto no está abierto en la computadora ahora.',
      'en': 'This project isn\'t open on the computer right now.',
    },
    'projects.noTerminals': {'es': 'No hay terminales abiertas.', 'en': 'No terminals open.'},
    'projects.statusWorking': {'es': 'Trabajando', 'en': 'Working'},
    'projects.statusRunning': {'es': 'Corriendo', 'en': 'Running'},
    'projects.noSessions': {'es': 'Este proyecto no tiene sesiones todavía.', 'en': 'This project has no sessions yet.'},
    'projects.noAgentFlow': {'es': 'Este proyecto no tiene Agent Flow configurado.', 'en': 'This project has no Agent Flow set up.'},
    'projects.supervisor': {'es': 'Supervisor', 'en': 'Supervisor'},
    'projects.nodes': {'es': 'NODOS', 'en': 'NODES'},
    'projects.edges': {'es': 'CONEXIONES', 'en': 'EDGES'},
    'projects.teams': {'es': 'TEAMS GUARDADOS', 'en': 'SAVED TEAMS'},
    'projects.filesComingSoon': {'es': 'Próximamente: navegador de archivos.', 'en': 'Coming soon: file browser.'},
    'projects.terminalEmpty': {'es': '(sin output todavía)', 'en': '(no output yet)'},
    'projects.terminalInputHint': {'es': 'Escribir en esta terminal…', 'en': 'Type into this terminal…'},
    'projects.transcriptEmpty': {'es': '(esperando la primera respuesta…)', 'en': '(waiting for the first reply…)'},
    'projects.thinkingLabel': {'es': 'Pensando', 'en': 'Thinking'},
    'projects.toolResultEmpty': {'es': '(sin resultado todavía)', 'en': '(no result yet)'},

    // ---- project detail: Workflows tab ----
    'projects.noWorkflows': {'es': 'Este proyecto no tiene workflows.', 'en': 'This project has no workflows.'},
    'projects.workflowRun': {'es': 'Correr', 'en': 'Run'},
    'projects.workflowCancel': {'es': 'Cancelar', 'en': 'Cancel'},
    'projects.workflowDisabled': {'es': 'Deshabilitado', 'en': 'Disabled'},
    'projects.workflowRemoteTriggerOff': {
      'es': 'Este workflow no permite disparo remoto — activá "allowRemoteTrigger" desde la app de escritorio.',
      'en': 'This workflow doesn\'t allow remote trigger — turn on "allowRemoteTrigger" from the desktop app.',
    },
    'projects.workflowRunHistory': {'es': 'HISTORIAL', 'en': 'RUN HISTORY'},
    'projects.workflowNoRuns': {'es': 'Todavía no corrió.', 'en': 'Never run yet.'},
    'projects.workflowArtifactsNote': {
      'es': 'Ningún tipo de nodo produce artifacts todavía en esta build.',
      'en': 'No node type in this build produces artifacts yet.',
    },

    // ---- project detail: Complementos tab ----
    'projects.noComplementos': {
      'es': 'Ningún complemento de este proyecto está habilitado para mobile todavía.',
      'en': 'No complemento in this project is enabled for mobile yet.',
    },
    'projects.complementoLoadError': {'es': 'No se pudo cargar el complemento.', 'en': 'Could not load the complemento.'},
    'projects.complementoUnsupported': {
      'es': 'Esta función no está disponible desde el teléfono.',
      'en': 'This feature isn\'t available from the phone.',
    },

    // ---- project workspace (split chat + file/web preview) ----
    'projects.workspace': {'es': 'Workspace', 'en': 'Workspace'},
    'projects.workspacePreviewTab': {'es': 'Vista previa', 'en': 'Preview'},
    'projects.workspaceChatHint': {'es': 'Escribe al orquestador…', 'en': 'Message the orchestrator…'},
    'projects.orchestrator': {'es': 'Orquestador', 'en': 'Orchestrator'},
    'projects.noPanesForWorkspace': {
      'es': 'No hay terminales activas para chatear.',
      'en': 'No active terminals to chat with.',
    },
    'projects.previewFile': {'es': 'Archivo', 'en': 'File'},
    'projects.previewWeb': {'es': 'Web', 'en': 'Web'},
    'projects.webPortHint': {'es': 'ej. 5173', 'en': 'e.g. 5173'},
    'projects.webPortEmpty': {
      'es': 'Escribe un puerto y toca la flecha para abrir un servidor local.',
      'en': 'Type a port and tap the arrow to open a local server.',
    },
    'projects.fileTruncated': {
      'es': 'Archivo grande — mostrando solo el inicio.',
      'en': 'Large file — showing only the start.',
    },

    // ---- capabilities-settings-design.md / capabilities-settings-ux.md —
    // Configuración → Capacidades, on/off per phone_* tool. ----
    'capabilities.title': {'es': 'Capacidades', 'en': 'Capabilities'},
    'capabilities.categoryApps': {'es': 'Apps', 'en': 'Apps'},
    'capabilities.categoryFiles': {'es': 'Archivos', 'en': 'Files'},
    'capabilities.categoryReminders': {'es': 'Recordatorios', 'en': 'Reminders'},
    'capabilities.openApp': {'es': 'Abrir apps', 'en': 'Open apps'},
    'capabilities.openAppDesc': {'es': 'Abrir apps instaladas del cel', 'en': "Open apps installed on your phone"},
    'capabilities.listApps': {'es': 'Listar apps', 'en': 'List apps'},
    'capabilities.listAppsDesc': {'es': 'Ver qué apps tenés instaladas', 'en': 'See what apps you have installed'},
    'capabilities.findFiles': {'es': 'Buscar archivos', 'en': 'Find files'},
    'capabilities.findFilesDesc': {
      'es': 'Buscar por nombre en fotos, videos, audio y descargas',
      'en': 'Search by name across photos, videos, audio and downloads',
    },
    'capabilities.findFilesPermBadge': {'es': '🔒 Necesita permiso de Android', 'en': '🔒 Needs Android permission'},
    'capabilities.findFilesPermDeniedText': {
      'es': 'Sin permiso no puedo buscar archivos',
      'en': "Without permission I can't search files",
    },
    'capabilities.openSettings': {'es': 'Abrir ajustes', 'en': 'Open settings'},
    'capabilities.broadenAccess': {
      'es': 'Ampliar acceso (ver también documentos, no solo fotos/video/audio)',
      'en': 'Broaden access (also see documents, not just photos/video/audio)',
    },
    'capabilities.pickFile': {'es': 'Elegir archivo a mano', 'en': 'Pick a file manually'},
    'capabilities.pickFileDesc': {'es': 'Abrir el selector de archivos', 'en': 'Open the file picker'},
    'capabilities.pickDirectory': {'es': 'Elegir carpeta a mano', 'en': 'Pick a folder manually'},
    'capabilities.pickDirectoryDesc': {'es': 'Abrir el selector de carpetas', 'en': 'Open the folder picker'},
    'capabilities.setAlarm': {'es': 'Alarmas', 'en': 'Alarms'},
    'capabilities.setTimer': {'es': 'Temporizador', 'en': 'Timer'},
    'capabilities.addCalendarEvent': {'es': 'Eventos de calendario', 'en': 'Calendar events'},
    'capabilities.showNotification': {'es': 'Notificaciones', 'en': 'Notifications'},
    'capabilities.showNotificationDesc': {'es': 'Mostrar un aviso en el cel', 'en': 'Show a notification on the phone'},
    'tool.showNotification.verb': {'es': 'Mostrando notificación', 'en': 'Showing notification'},
    'tool.showNotification.ok': {'es': 'Notificación mostrada', 'en': 'Notification shown'},
    'capabilities.clipboardGet': {'es': 'Leer portapapeles', 'en': 'Read clipboard'},
    'capabilities.clipboardGetDesc': {'es': 'Leer el texto copiado (solo con la app en primer plano)', 'en': 'Read copied text (app in foreground only)'},
    'tool.clipboardGet.verb': {'es': 'Leyendo portapapeles', 'en': 'Reading clipboard'},
    'tool.clipboardGet.ok': {'es': 'Portapapeles leído', 'en': 'Clipboard read'},
    'capabilities.clipboardSet': {'es': 'Copiar al portapapeles', 'en': 'Copy to clipboard'},
    'capabilities.clipboardSetDesc': {'es': 'Dejar un texto copiado para pegar', 'en': 'Put text on the clipboard'},
    'tool.clipboardSet.verb': {'es': 'Copiando texto', 'en': 'Copying text'},
    'tool.clipboardSet.ok': {'es': 'Texto copiado', 'en': 'Text copied'},
    'capabilities.deviceState': {'es': 'Estado del cel', 'en': 'Phone status'},
    'capabilities.deviceStateDesc': {'es': 'Batería, carga, red, modo de sonido y pantalla', 'en': 'Battery, charging, network, sound mode and screen'},
    'tool.deviceState.verb': {'es': 'Leyendo estado del cel', 'en': 'Reading phone status'},
    'tool.deviceState.ok': {'es': 'Estado leído', 'en': 'Status read'},
    'capabilities.setRingerMode': {'es': 'Modo de sonido', 'en': 'Sound mode'},
    'capabilities.setRingerModeDesc': {'es': 'Normal, vibración o silencio', 'en': 'Normal, vibrate or silent'},
    'tool.setRingerMode.verb': {'es': 'Cambiando modo de sonido', 'en': 'Changing sound mode'},
    'tool.setRingerMode.ok': {'es': 'Modo de sonido cambiado', 'en': 'Sound mode changed'},
    'capabilities.setVolume': {'es': 'Volumen', 'en': 'Volume'},
    'capabilities.setVolumeDesc': {'es': 'Subir o bajar volumen de música, timbre o alarma', 'en': 'Set music, ring or alarm volume'},
    'tool.setVolume.verb': {'es': 'Cambiando volumen', 'en': 'Changing volume'},
    'tool.setVolume.ok': {'es': 'Volumen cambiado', 'en': 'Volume changed'},
    'capabilities.flashlight': {'es': 'Linterna', 'en': 'Flashlight'},
    'capabilities.mediaPlay': {'es': 'Controlar música', 'en': 'Control music'},
    'capabilities.mediaPlayDesc': {'es': 'Reproducir, pausar o cambiar pista en YouTube Music', 'en': 'Play, pause or skip in YouTube Music'},
    'tool.mediaPlay.verb': {'es': 'Controlando música', 'en': 'Controlling music'},
    'tool.mediaPlay.ok': {'es': 'Música controlada', 'en': 'Music controlled'},
    'capabilities.flashlightDesc': {'es': 'Encender o apagar la linterna', 'en': 'Turn the flashlight on or off'},
    'tool.flashlight.verb': {'es': 'Cambiando linterna', 'en': 'Changing flashlight'},
    'tool.flashlight.ok': {'es': 'Linterna cambiada', 'en': 'Flashlight changed'},
    'capabilities.getLocation': {'es': 'Ubicación', 'en': 'Location'},
    'capabilities.getLocationDesc': {'es': 'Última ubicación conocida del cel', 'en': 'Last known phone location'},
    'tool.getLocation.verb': {'es': 'Leyendo ubicación', 'en': 'Reading location'},
    'tool.getLocation.ok': {'es': 'Ubicación leída', 'en': 'Location read'},
    'capabilities.sendSms': {'es': 'Enviar SMS', 'en': 'Send SMS'},
    'capabilities.sendSmsDesc': {'es': 'Envía un SMS sin revisión', 'en': 'Sends an SMS without review'},
    'tool.sendSms.verb': {'es': 'Enviando SMS', 'en': 'Sending SMS'},
    'tool.sendSms.ok': {'es': 'SMS enviado', 'en': 'SMS sent'},
    'capabilities.composeSms': {'es': 'Redactar SMS', 'en': 'Compose SMS'},
    'capabilities.composeSmsDesc': {'es': 'Abre la app de mensajes para revisar y enviar', 'en': 'Opens the messages app to review and send'},
    'tool.composeSms.verb': {'es': 'Abriendo mensajes', 'en': 'Opening messages'},
    'tool.composeSms.ok': {'es': 'Mensajes abiertos', 'en': 'Messages opened'},
    'capabilities.call': {'es': 'Llamar', 'en': 'Call'},
    'capabilities.callDesc': {'es': 'Llama de inmediato', 'en': 'Calls immediately'},
    'tool.call.verb': {'es': 'Llamando', 'en': 'Calling'},
    'tool.call.ok': {'es': 'Llamada iniciada', 'en': 'Call started'},
    'capabilities.dial': {'es': 'Marcador', 'en': 'Dialer'},
    'capabilities.dialDesc': {'es': 'Abre el marcador con el número', 'en': 'Opens the dialer with the number'},
    'tool.dial.verb': {'es': 'Abriendo marcador', 'en': 'Opening dialer'},
    'tool.dial.ok': {'es': 'Marcador abierto', 'en': 'Dialer opened'},
    'capabilities.readCalendar': {'es': 'Leer calendario', 'en': 'Read calendar'},
    'capabilities.readCalendarDesc': {'es': 'Consulta tus eventos por rango de fechas', 'en': 'Reads your events for a date range'},
    'tool.readCalendar.verb': {'es': 'Leyendo calendario', 'en': 'Reading calendar'},
    'tool.readCalendar.ok': {'es': 'Calendario leído', 'en': 'Calendar read'},
    'capabilities.searchContacts': {'es': 'Buscar contactos', 'en': 'Search contacts'},
    'capabilities.searchContactsDesc': {'es': 'Busca contactos por nombre', 'en': 'Search contacts by name'},
    'tool.searchContacts.verb': {'es': 'Buscando contactos', 'en': 'Searching contacts'},
    'tool.searchContacts.ok': {'es': 'Contactos encontrados', 'en': 'Contacts found'},
    'capabilities.openUrl': {'es': 'Abrir enlace o app', 'en': 'Open link or app'},
    'capabilities.openUrlDesc': {'es': 'Web o deep link (whatsapp://, spotify:, maps)', 'en': 'Web or deep link (whatsapp://, spotify:, maps)'},
    'tool.openUrl.verb': {'es': 'Abriendo enlace', 'en': 'Opening link'},
    'tool.openUrl.ok': {'es': 'Enlace abierto', 'en': 'Link opened'},
    'capabilities.shareText': {'es': 'Compartir texto', 'en': 'Share text'},
    'capabilities.shareTextDesc': {'es': 'Hoja de compartir o una app puntual', 'en': 'Share sheet or a specific app'},
    'tool.shareText.verb': {'es': 'Compartiendo', 'en': 'Sharing'},
    'tool.shareText.ok': {'es': 'Texto compartido', 'en': 'Text shared'},
    'capabilities.launchIntent': {'es': 'Acción Android', 'en': 'Android action'},
    'capabilities.launchIntentDesc': {'es': 'Iniciar cualquier actividad por intent', 'en': 'Start any activity by intent'},
    'tool.launchIntent.verb': {'es': 'Ejecutando acción', 'en': 'Running action'},
    'tool.launchIntent.ok': {'es': 'Acción ejecutada', 'en': 'Action run'},
    'capabilities.approvalSection': {'es': 'Aprobación', 'en': 'Approval'},
    'capabilities.autoApprove': {'es': 'Aceptar acciones del teléfono automáticamente', 'en': 'Auto-accept phone actions'},
    'capabilities.autoApproveDesc': {'es': 'El modelo usa las capacidades del cel sin pedir confirmación. Incluye SMS, llamadas e intents.', 'en': 'The model uses phone capabilities without asking first. Includes SMS, calls and intents.'},
    'capabilities.permissionsSection': {'es': 'Permisos', 'en': 'Permissions'},
    'capabilities.permSms': {'es': 'SMS (enviar)', 'en': 'SMS (send)'},
    'capabilities.permPhone': {'es': 'Llamadas', 'en': 'Calls'},
    'capabilities.permContacts': {'es': 'Contactos', 'en': 'Contacts'},
    'capabilities.permCalendar': {'es': 'Calendario', 'en': 'Calendar'},
    'capabilities.permLocation': {'es': 'Ubicación', 'en': 'Location'},
    'capabilities.permNotification': {'es': 'Notificaciones', 'en': 'Notifications'},
    'capabilities.permGranted': {'es': 'Concedido', 'en': 'Granted'},
    'capabilities.permNotGranted': {'es': 'Tocar para dar', 'en': 'Tap to grant'},
    'capabilities.permOpenSettings': {'es': 'Abrir ajustes', 'en': 'Open settings'},
    'capabilities.composeWhatsapp': {'es': 'Redactar WhatsApp', 'en': 'Compose WhatsApp'},
    'capabilities.composeWhatsappDesc': {'es': 'Abre WhatsApp con el chat y el texto listos para revisar y enviar', 'en': 'Opens WhatsApp with the chat and text ready to review and send'},
    'tool.composeWhatsapp.verb': {'es': 'Abriendo WhatsApp', 'en': 'Opening WhatsApp'},
    'tool.composeWhatsapp.ok': {'es': 'WhatsApp abierto', 'en': 'WhatsApp opened'},
    'auto.title': {'es': 'Automatizaciones', 'en': 'Automations'},
    'auto.new': {'es': 'Nueva', 'en': 'New'},
    'auto.edit': {'es': 'Editar automatización', 'en': 'Edit automation'},
    'auto.empty': {'es': 'Todavía no hay automatizaciones. Creá una con + Nueva: elegí capacidades del teléfono y el orden en que corren.', 'en': 'No automations yet. Create one with + New: pick phone capabilities and the order they run in.'},
    'auto.stepCount': {'es': '{n} pasos', 'en': '{n} steps'},
    'auto.neverRun': {'es': 'nunca ejecutada', 'en': 'never run'},
    'auto.lastOk': {'es': 'última: ok', 'en': 'last: ok'},
    'auto.lastFailed': {'es': 'última: falló', 'en': 'last: failed'},
    'auto.history': {'es': 'Historial', 'en': 'History'},
    'auto.historyTitle': {'es': 'Historial', 'en': 'History'},
    'auto.noRuns': {'es': 'Sin ejecuciones todavía', 'en': 'No runs yet'},
    'auto.run': {'es': 'Ejecutar', 'en': 'Run'},
    'auto.runOk': {'es': 'Automatización ejecutada', 'en': 'Automation ran'},
    'auto.runFailed': {'es': 'Falló en {step}: {error}', 'en': 'Failed at {step}: {error}'},
    'auto.deleteConfirm': {'es': '¿Borrar "{name}" y su historial?', 'en': 'Delete "{name}" and its history?'},
    'auto.nameRequired': {'es': 'Ponele un nombre', 'en': 'Give it a name'},
    'auto.dictate': {'es': 'Dictá lo que querés automatizar', 'en': 'Dictate what you want to automate'},
    'auto.dictating': {'es': 'Armando la automatización…', 'en': 'Building the automation…'},
    'auto.dictateDone': {'es': 'Borrador listo. Revisalo y guardalo.', 'en': 'Draft ready. Review and save it.'},
    'auto.dictateFailed': {'es': 'No pude armar la automatización', 'en': 'Could not build the automation'},
    'auto.name': {'es': 'Nombre', 'en': 'Name'},
    'auto.noSteps': {'es': 'Sin pasos. Agregá una capacidad, una condición o una espera.', 'en': 'No steps. Add a capability, a condition or a wait.'},
    'auto.addStep': {'es': 'Agregar paso', 'en': 'Add step'},
    'auto.ifStep': {'es': 'Si (condición)', 'en': 'If (condition)'},
    'auto.ifStepDesc': {'es': 'Ramas: entonces / si no', 'en': 'Branches: then / else'},
    'auto.delay': {'es': 'Esperar', 'en': 'Wait'},
    'auto.delayDesc': {'es': 'Pausa en segundos (máx 300)', 'en': 'Pause in seconds (max 300)'},
    'auto.delayStep': {'es': 'Esperar {s}s', 'en': 'Wait {s}s'},
    'auto.seconds': {'es': 'Segundos', 'en': 'Seconds'},
    'auto.noCondition': {'es': 'Sin condición', 'en': 'No condition'},
    'auto.missingFields': {'es': 'Faltan campos: {fields}', 'en': 'Missing fields: {fields}'},
    'auto.extrasUnsupported': {'es': 'Los extras de intents todavía no se editan desde acá.', 'en': 'Intent extras cannot be edited here yet.'},
    'auto.saveAs': {'es': 'Guardar resultado como', 'en': 'Save result as'},
    'auto.saveAsHint': {'es': 'Después se usa como {{steps.nombre.campo}}', 'en': 'Then use it as {{steps.name.field}}'},
    'auto.onError': {'es': 'Si falla', 'en': 'On failure'},
    'auto.onErrorStop': {'es': 'Detener la automatización', 'en': 'Stop the automation'},
    'auto.onErrorContinue': {'es': 'Seguir con el próximo paso', 'en': 'Continue with the next step'},
    'auto.condLeft': {'es': 'Valor', 'en': 'Value'},
    'auto.condOp': {'es': 'Operador', 'en': 'Operator'},
    'auto.condRight': {'es': 'Comparar con (vacío si es "existe")', 'en': 'Compare with (empty for "exists")'},
    'auto.thenBranch': {'es': 'Entonces', 'en': 'Then'},
    'auto.elseBranch': {'es': 'Si no', 'en': 'Else'},
    'settings.automations': {'es': 'Automatizaciones', 'en': 'Automations'},
    'trig.schedule': {'es': 'Horario', 'en': 'Schedule'},
    'trig.scheduleHint': {'es': 'Todos los días a una hora fija', 'en': 'Every day at a fixed time'},
    'trig.battery': {'es': 'Batería', 'en': 'Battery'},
    'trig.batteryHint': {'es': 'Bajar de un nivel o cargador conectado/desconectado', 'en': 'Below a level, or charger plugged/unplugged'},
    'trig.network': {'es': 'Wifi o datos', 'en': 'Wifi or data'},
    'trig.networkHint': {'es': 'Al conectarse o desconectarse de la red', 'en': 'When connecting or disconnecting from a network'},
    'trig.boot': {'es': 'Reinicio', 'en': 'Reboot'},
    'trig.bootHint': {'es': 'Al encender el teléfono', 'en': 'When the phone starts'},
    'trig.geofence': {'es': 'Zona (GPS)', 'en': 'Zone (GPS)'},
    'trig.geofenceHint': {'es': 'Al entrar o salir de un radio', 'en': 'When entering or leaving a radius'},
    'trig.opBelow': {'es': 'Menos de (%)', 'en': 'Below (%)'},
    'trig.opAbove': {'es': 'Más de (%)', 'en': 'Above (%)'},
    'trig.opCharging': {'es': 'Al conectar el cargador', 'en': 'When charger connects'},
    'trig.opUnplugged': {'es': 'Al desconectar el cargador', 'en': 'When charger disconnects'},
    'trig.percent': {'es': 'Porcentaje (1-100)', 'en': 'Percent (1-100)'},
    'trig.wifi': {'es': 'Wifi', 'en': 'Wifi'},
    'trig.cellular': {'es': 'Datos móviles', 'en': 'Mobile data'},
    'trig.onConnected': {'es': 'Se conecta', 'en': 'Connects'},
    'trig.onDisconnected': {'es': 'Se desconecta', 'en': 'Disconnects'},
    'trig.lat': {'es': 'Latitud', 'en': 'Latitude'},
    'trig.lng': {'es': 'Longitud', 'en': 'Longitude'},
    'trig.radius': {'es': 'Radio en metros (mín 50)', 'en': 'Radius in meters (min 50)'},
    'trig.onEnter': {'es': 'Al entrar', 'en': 'When entering'},
    'trig.onExit': {'es': 'Al salir', 'en': 'When leaving'},
    'trig.useCurrent': {'es': 'Usar ubicación actual', 'en': 'Use current location'},
    'trig.noLocation': {'es': 'No se pudo leer la ubicación', 'en': 'Could not read the location'},
    'trig.geoInvalid': {'es': 'Revisá latitud, longitud y radio (mín 50 m)', 'en': 'Check latitude, longitude and radius (min 50 m)'},
    'trig.count': {'es': 'DISPARADORES ({n})', 'en': 'TRIGGERS ({n})'},
    'trig.add': {'es': 'Agregar', 'en': 'Add'},
    'trig.manualOnly': {'es': 'Sin disparadores: solo corre con ▶', 'en': 'No triggers: runs only with ▶'},
    'trig.armFailed': {'es': 'No se pudieron armar los disparadores', 'en': 'Could not arm the triggers'},
    'capabilities.currentTime': {'es': 'Hora actual', 'en': 'Current time'},
    'capabilities.currentTimeDesc': {'es': 'Hora local del teléfono (hh:mm)', 'en': 'Phone local time (hh:mm)'},
    'tool.currentTime.verb': {'es': 'Leyendo la hora', 'en': 'Reading the time'},
    'tool.currentTime.ok': {'es': 'Hora leída', 'en': 'Time read'},
    'trig.tapToEdit': {'es': 'Tocá para editar', 'en': 'Tap to edit'},
    'capabilities.categoryDevice': {'es': 'Dispositivo', 'en': 'Device'},
    'capabilities.categoryComm': {'es': 'Comunicación', 'en': 'Communication'},
    'capabilities.categoryLinks': {'es': 'Enlaces y apps', 'en': 'Links and apps'},
    'capabilities.categoryNotify': {'es': 'Notificaciones y texto', 'en': 'Notifications and text'},

    // ---- Google connector (external-actions-and-connectors-analysis.md
    // §1.3-b) — the token itself never touches the phone, only this status
    // text does. ----
    'connectors.title': {'es': 'Conectores', 'en': 'Connectors'},
    'connectors.connect': {'es': 'Conectar Google', 'en': 'Connect Google'},
    'connectors.connected': {'es': 'Conectado', 'en': 'Connected'},
    'connectors.notConnected': {'es': 'No conectado', 'en': 'Not connected'},
    'connectors.connecting': {'es': 'Conectando…', 'en': 'Connecting…'},
    'connectors.checkingStatus': {'es': 'Verificando estado…', 'en': 'Checking status…'},
    'connectors.statusUnknown': {'es': 'Estado desconocido', 'en': 'Unknown status'},
    'connectors.errorGeneric': {'es': 'No se pudo conectar. Intenta de nuevo.', 'en': "Couldn't connect. Try again."},
    'connectors.googleDescription': {
      'es': 'Conectá tu cuenta de Google para que Yggdrasil pueda usar Calendar y Gmail. El token queda guardado solo en tu gateway, nunca en este teléfono.',
      'en': "Connect your Google account so Yggdrasil can use Calendar and Gmail. The token is stored only on your gateway, never on this phone.",
    },

    // ---- config page (agent provider/model) ----
    'config.title': {'es': 'Configuración', 'en': 'Settings'},
    'config.selectProviderHint': {'es': 'Selecciona un Provider', 'en': 'Select a provider'},
    'config.selectModelHint': {'es': 'Selecciona un Modelo', 'en': 'Select a model'},
    'config.providerLabel': {'es': 'Provider', 'en': 'Provider'},
    'config.modelLabel': {'es': 'Model', 'en': 'Model'},
    'config.saveButton': {'es': 'Guardar Configuración', 'en': 'Save configuration'},
    'config.providerUnavailable': {
      'es': 'Este provider no tiene modelos disponibles: {error}',
      'en': 'This provider has no models available: {error}',
    },

    // ---- profiles list ----
    'profiles.title': {'es': 'Perfiles de conexión', 'en': 'Connection profiles'},
    'profiles.empty': {
      'es': 'Sin perfiles guardados. Agrega uno para elegir manualmente entre, por ejemplo, '
          'tu gateway de casa y un provider cloud directo.',
      'en': 'No saved profiles yet. Add one to manually pick between, for example, your home '
          'gateway and a direct cloud provider.',
    },
    'profiles.newProfile': {'es': 'Nuevo perfil', 'en': 'New profile'},
    'profiles.unnamed': {'es': '(sin nombre)', 'en': '(unnamed)'},

    // ---- profile editor ----
    'editor.newProfileTitle': {'es': 'Nuevo perfil', 'en': 'New profile'},
    'editor.editProfileTitle': {'es': 'Editar perfil', 'en': 'Edit profile'},
    'editor.nameLabel': {'es': 'Nombre', 'en': 'Name'},
    'editor.nameHint': {'es': 'ej. Gateway de casa vía Tailscale', 'en': 'e.g. Home gateway via Tailscale'},
    'editor.gatewaySegment': {'es': 'Gateway', 'en': 'Gateway'},
    'editor.directSegment': {'es': 'Provider directo', 'en': 'Direct provider'},
    'editor.gatewayUrlLabel': {'es': 'URL del gateway', 'en': 'Gateway URL'},
    'editor.gatewayUrlHint': {'es': 'ws://100.x.x.x:18889', 'en': 'ws://100.x.x.x:18889'},
    'editor.apiKeyOptionalLabel': {'es': 'API key (opcional)', 'en': 'API key (optional)'},
    'editor.apiKeyLabel': {'es': 'API key', 'en': 'API key'},
    'editor.providerLabel': {'es': 'Provider', 'en': 'Provider'},
    'editor.modelOptionalLabel': {'es': 'Modelo (opcional)', 'en': 'Model (optional)'},
    'editor.modelOptionalHint': {'es': 'ej. claude-sonnet-5', 'en': 'e.g. claude-sonnet-5'},
    'editor.standaloneNote': {
      'es': 'Modo standalone: los chats de este perfil no comparten historial con el gateway y '
          'ejecutan las 4 acciones del teléfono (abrir apps, listar apps, elegir archivo, listar '
          'una carpeta) sin pedir aprobación.',
      'en': "Standalone mode: this profile's chats don't share history with the gateway and run "
          'the 4 phone actions (open apps, list apps, pick a file, list a folder) without asking '
          'for approval.',
    },
  };
}
