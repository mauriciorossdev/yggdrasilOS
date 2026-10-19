package com.mauriciorossdev.yggdrasil

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.annotation.NonNull
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val deviceToolsChannel = "com.yggdrasil.app/device_tools"
    private val voiceNotificationChannelMethod = "com.yggdrasil.app/voice_notification"
    private val pickDocumentRequestCode = 4201
    private val pickDirectoryRequestCode = 4202
    private val voiceNotificationId = 4301
    private val voiceNotificationChannelId = "voice_shortcut"

    // Only one SAF pick of each kind can be in flight at a time — the Dart
    // side never starts a second one while a turn is open (composer is
    // blocked for the whole turn per phone-gateway-connectivity-design.md §4
    // point 7), and this holds the callback across the async gap until
    // onActivityResult.
    private var pendingPickResult: MethodChannel.Result? = null
    private var pendingTreeResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        DeviceCapabilities(applicationContext).attach(flutterEngine)
        AutomationTriggersChannel.attach(applicationContext, flutterEngine)
        BubbleChannel.attach(applicationContext, flutterEngine)
        // The bubble's service dies with an app update or a force-stop: bring it back whenever the app opens.
        BubbleService.startIfEnabled(applicationContext)
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, deviceToolsChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "openApp" -> handleOpenApp(call.argument("packageName"), result)
                    "listInstalledApps" -> handleListInstalledApps(result)
                    "pickDocument" -> handlePickDocument(call.argument("mimeType"), result)
                    "cancelPickDocument" -> handleCancelPickDocument(result)
                    "uriSize" -> handleUriSize(call.argument("uri"), result)
                    "readUriChunk" -> handleReadUriChunk(
                        call.argument("uri"),
                        call.argument<Number>("offset")?.toLong(),
                        call.argument<Int>("length"),
                        result,
                    )
                    "findFiles" -> handleFindFiles(
                        call.argument("query"),
                        call.argument("extension"),
                        call.argument("mimeType"),
                        call.argument<Int>("limit"),
                        result,
                    )
                    "pickDirectory" -> handlePickDirectory(result)
                    "cancelPickDirectory" -> handleCancelPickDirectory(result)
                    "setAlarm" -> handleSetAlarm(
                        call.argument<Int>("hour"),
                        call.argument<Int>("minute"),
                        call.argument("label"),
                        result,
                    )
                    "setTimer" -> handleSetTimer(
                        call.argument<Int>("seconds"),
                        call.argument("label"),
                        result,
                    )
                    "addCalendarEvent" -> handleAddCalendarEvent(
                        call.argument("title"),
                        call.argument("location"),
                        call.argument("description"),
                        call.argument<Long>("beginTime"),
                        call.argument<Long>("endTime"),
                        call.argument<Boolean>("allDay"),
                        result,
                    )
                    else -> result.notImplemented()
                }
            }

        // Pi chat (lib/pi/): brings the Tailscale VPN up before connecting to
        // the Pi's term-bridge, which is only reachable inside the tailnet.
        // Uses Tailscale's documented automation broadcast (the one Tasker
        // uses); needs the VPN permission to have been granted once in the
        // Tailscale app itself. No-op (false) when Tailscale isn't installed.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.yggdrasil.app/tailscale")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "connect" -> {
                        val installed = try {
                            packageManager.getPackageInfo("com.tailscale.ipn", 0)
                            true
                        } catch (e: Exception) {
                            false
                        }
                        if (installed) {
                            sendBroadcast(
                                Intent("com.tailscale.ipn.CONNECT_VPN")
                                    .setClassName("com.tailscale.ipn", "com.tailscale.ipn.IPNReceiver")
                            )
                        }
                        result.success(installed)
                    }
                    else -> result.notImplemented()
                }
            }

        // voice-notification-shortcut-design.md §2 — separate channel on
        // purpose: this is app infrastructure posted once at startup, not a
        // phone_* tool the model invokes, so it doesn't belong on
        // deviceToolsChannel above.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, voiceNotificationChannelMethod)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "post" -> handlePostVoiceNotification(
                        call.argument("title"),
                        call.argument("body"),
                        call.argument("actionLabel"),
                        call.argument("channelName"),
                        call.argument("channelDescription"),
                        result,
                    )
                    else -> result.notImplemented()
                }
            }
    }

    // §2.1/§2.3: ongoing (non-swipeable), tapping the body OR the action both
    // open the same yggdrasil://voice/listen deep link (§1.1 of the design
    // doc) — main.dart's global AppLinks listener bumps VoiceTriggerBus from
    // there. No Service involved (§2.2): posting is a one-shot call, nothing
    // needs to keep running for the notification to stay ongoing.
    //
    // Channel importance is DEFAULT, not LOW: confirmed on a real Samsung
    // (One UI) that IMPORTANCE_LOW notifications get collapsed/hidden from
    // the shade instead of staying visible — wrong for a persistent shortcut
    // the user is meant to always be able to see and tap. DEFAULT keeps it
    // visibly present without escalating to a heads-up popup (that needs
    // HIGH, which is overkill for a standing shortcut, not a one-off alert).
    // setSilent(true) below is what actually keeps it sound/vibration/
    // heads-up-free — per NotificationCompat docs it overrides the channel's
    // importance for those three regardless, so bumping importance for
    // visibility doesn't reintroduce noise.
    private fun handlePostVoiceNotification(
        title: String?,
        body: String?,
        actionLabel: String?,
        channelName: String?,
        channelDescription: String?,
        result: MethodChannel.Result,
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            result.success(false)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(voiceNotificationChannelId, channelName, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = channelDescription
                setShowBadge(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }

        // setPackage keeps this same-app deep link from ever prompting a
        // chooser — this app is the only declared handler
        // (AndroidManifest.xml's yggdrasil://voice/listen filter) anyway, but
        // an explicit target is one less thing for the OS to decide.
        val tapIntent = Intent(Intent.ACTION_VIEW, Uri.parse("yggdrasil://voice/listen")).apply {
            setPackage(packageName)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(this, voiceNotificationId, tapIntent, flags)

        val notification = NotificationCompat.Builder(this, voiceNotificationChannelId)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOngoing(true)
            .setSilent(true)
            .setAutoCancel(false)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_btn_speak_now, actionLabel, pendingIntent)
            .build()

        try {
            NotificationManagerCompat.from(this).notify(voiceNotificationId, notification)
            result.success(true)
        } catch (_: SecurityException) {
            // Permission revoked between the check above and this call —
            // same non-fatal contract as the check itself.
            result.success(false)
        }
    }

    private fun handleOpenApp(packageName: String?, result: MethodChannel.Result) {
        if (packageName.isNullOrEmpty()) {
            result.error("bad_args", "packageName required", null)
            return
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent == null) {
            result.error("not_found", "No launchable activity for $packageName", null)
            return
        }
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(launchIntent)
        result.success(true)
    }

    // Uses queryIntentActivities against ACTION_MAIN/CATEGORY_LAUNCHER, which the
    // <queries> declaration in AndroidManifest.xml opts this app into seeing under
    // Android 11+ package visibility — deliberately avoids QUERY_ALL_PACKAGES, which
    // Play Store gates behind a declared-use review.
    private fun handleListInstalledApps(result: MethodChannel.Result) {
        val intent = Intent(Intent.ACTION_MAIN, null).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolveInfos = packageManager.queryIntentActivities(intent, 0)
        val apps = resolveInfos
            .map {
                mapOf(
                    "packageName" to it.activityInfo.packageName,
                    "appName" to it.loadLabel(packageManager).toString(),
                )
            }
            .distinctBy { it["packageName"] }
        result.success(apps)
    }

    // phone_pick_file (interactive, design doc §3.3) — ACTION_OPEN_DOCUMENT
    // needs no extra manifest permission on modern Android: SAF grants a
    // scoped, per-URI read grant on completion rather than broad storage
    // access, and the system picker is implicitly visible past Android 11
    // package-visibility rules (it's not a 3rd-party app we're querying for).
    private fun handlePickDocument(mimeType: String?, result: MethodChannel.Result) {
        if (pendingPickResult != null) {
            result.error("busy", "A document pick is already in progress", null)
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
        }
        try {
            pendingPickResult = result
            startActivityForResult(intent, pickDocumentRequestCode)
        } catch (e: Exception) {
            pendingPickResult = null
            result.error("no_picker", "No document picker available: ${e.message}", null)
        }
    }

    // Best-effort UI cleanup when the UI/gateway cancels — by the time this
    // is called the gateway has already resolved the tool call optimistically
    // (phone-gateway-connectivity-design.md §4 point 10), so this only exists
    // to close the stale system picker instead of leaving it on screen.
    // finishActivity's ability to still deliver onActivityResult isn't
    // guaranteed by the platform, so pendingPickResult is dropped
    // unconditionally here rather than waiting on that callback.
    private fun handleCancelPickDocument(result: MethodChannel.Result) {
        if (pendingPickResult != null) {
            finishActivity(pickDocumentRequestCode)
            pendingPickResult = null
        }
        result.success(true)
    }

    // phone_find_files (sync, phone-find-files-design.md §§1-2, 4) — single
    // MediaStore.Files query, no picker. Permission gate is a synchronous
    // checkSelfPermission with no system dialog: if the needed permission is
    // missing, this returns permission_required right away instead of
    // triggering the runtime prompt and blocking the turn on it — Flutter
    // (permission_handler, same split as voice_mic_button.dart's mic
    // permission) is responsible for actually asking the user.
    private fun handleFindFiles(
        query: String?,
        extension: String?,
        mimeType: String?,
        limit: Int?,
        result: MethodChannel.Result,
    ) {
        if (query.isNullOrBlank()) {
            result.success(mapOf("status" to "invalid_query", "reason" to "empty"))
            return
        }

        // §7.1: MANAGE_EXTERNAL_STORAGE ("All Files Access"), when granted,
        // subsumes READ_EXTERNAL_STORAGE/READ_MEDIA_* for read purposes —
        // checked first as a short-circuit that skips the granular gate
        // below entirely. Only meaningful API 30+ (isExternalStorageManager
        // doesn't exist before R); minSdk 24 (confirmed against the
        // installed Flutter SDK, see missingMediaPermissions' comment) means
        // this guard is required, not optional.
        val hasBroadAccess = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()

        if (!hasBroadAccess) {
            val missing = missingMediaPermissions(mimeType, extension)
            if (missing.isNotEmpty()) {
                // shouldShowRequestPermissionRationale only distinguishes "denied
                // once, can ask again" (true) from "never asked yet" OR
                // "permanently blocked" (both false) — Android doesn't expose a
                // 3-state read here. That's a real platform limitation, not a
                // product decision: UX's design assumed 2 clean states, this is
                // the closest available without extra persisted state of our own.
                val canAskAgain = missing.any { ActivityCompat.shouldShowRequestPermissionRationale(this, it) }
                result.error(
                    "permission_required",
                    "${missing.joinToString(", ") { it.substringAfterLast('.') }} not granted",
                    mapOf("canAskAgain" to canAskAgain, "permission" to friendlyPermissionText(missing)),
                )
                return
            }
        }

        val effectiveLimit = (limit ?: 25).coerceIn(1, 100)
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
        )
        val resolvedMimeType = resolveMimeType(mimeType, extension)
        val selectionArgs = mutableListOf("%$query%")
        var selection = "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?"
        if (resolvedMimeType != null) {
            selection += " AND ${MediaStore.Files.FileColumns.MIME_TYPE} = ?"
            selectionArgs.add(resolvedMimeType)
        } else if (!extension.isNullOrBlank()) {
            // Extension didn't resolve to a known MIME type — fall back to
            // matching the file name's suffix directly.
            selection += " AND ${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?"
            selectionArgs.add("%.$extension")
        }

        val matches = mutableListOf<Map<String, Any?>>()
        var total = 0
        try {
            contentResolver.query(
                collection,
                projection,
                selection,
                selectionArgs.toTypedArray(),
                "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC",
            )?.use { cursor ->
                total = cursor.count
                val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val sizeIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
                val mimeIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE)
                val dateIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
                while (cursor.moveToNext() && matches.size < effectiveLimit) {
                    val id = cursor.getLong(idIdx)
                    matches.add(
                        mapOf(
                            "name" to cursor.getString(nameIdx),
                            "uri" to ContentUris.withAppendedId(collection, id).toString(),
                            "size" to cursor.getLong(sizeIdx),
                            "mimeType" to cursor.getString(mimeIdx),
                            "modifiedAt" to cursor.getLong(dateIdx) * 1000L,
                        )
                    )
                }
            }
        } catch (_: Exception) {
            // Best-effort — fall through with whatever was collected so far.
        }

        val truncatedCount = (total - matches.size).coerceAtLeast(0)
        val status = when {
            total == 0 -> "empty"
            truncatedCount > 0 -> "truncated"
            else -> "ok"
        }
        // §7.3/§7.5: broaderAccessAvailable is present only when
        // MANAGE_EXTERNAL_STORAGE is NOT granted (absence-as-default, same
        // convention as scopeLimited) — flags that a wider door exists
        // regardless of how this search's own results turned out. When it
        // IS granted, `scope` collapses to a single honest string instead of
        // the media/Downloads-specific one, since the whole point of the
        // permission is that the type/folder distinction no longer applies.
        val envelope = mutableMapOf<String, Any?>(
            "status" to status,
            "query" to query,
            "matches" to matches,
            "total" to total,
            "truncatedCount" to truncatedCount,
            "scope" to if (hasBroadAccess) "todos los archivos del almacenamiento externo" else scopeDescription(mimeType, extension),
        )
        if (!hasBroadAccess) {
            envelope["broaderAccessAvailable"] = true
        }
        result.success(envelope)
    }

    // Android 13+ (API 33+) uses the granular READ_MEDIA_* permissions;
    // 10-12 (API 29-32) and everything back to minSdk 24 use the single
    // READ_EXTERNAL_STORAGE (build.gradle.kts pins no explicit minSdk/
    // targetSdk — they resolve to Flutter's defaults, minSdk 24 / targetSdk
    // 36, confirmed against the installed Flutter SDK's flutter.gradle
    // rather than assumed, per phone-find-files-design.md §1.2's open item).
    // A single type filter (mimeType/extension) narrows the check to just
    // that media type on 33+; a generic search checks the full applicable
    // set, same as design doc §4.
    private fun missingMediaPermissions(mimeType: String?, extension: String?): List<String> {
        val resolvedMimeType = resolveMimeType(mimeType, extension)
        val required = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                resolvedMimeType?.startsWith("image/") == true -> listOf(Manifest.permission.READ_MEDIA_IMAGES)
                resolvedMimeType?.startsWith("video/") == true -> listOf(Manifest.permission.READ_MEDIA_VIDEO)
                resolvedMimeType?.startsWith("audio/") == true -> listOf(Manifest.permission.READ_MEDIA_AUDIO)
                else -> listOf(
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_AUDIO,
                )
            }
        } else {
            listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        return required.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    }

    private fun resolveMimeType(mimeType: String?, extension: String?): String? {
        if (!mimeType.isNullOrBlank()) return mimeType
        if (extension.isNullOrBlank()) return null
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase())
    }

    // Honest description of what was actually searched, per §2's contract —
    // built from real API level + permission scope, not a fixed string.
    private fun scopeDescription(mimeType: String?, extension: String?): String {
        val resolvedMimeType = resolveMimeType(mimeType, extension)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                resolvedMimeType?.startsWith("image/") == true -> "fotos del almacenamiento"
                resolvedMimeType?.startsWith("video/") == true -> "videos del almacenamiento"
                resolvedMimeType?.startsWith("audio/") == true -> "audio del almacenamiento"
                else -> "fotos, videos y audio del almacenamiento"
            }
        } else {
            "fotos, videos y audio del almacenamiento, y archivos en Descargas"
        }
    }

    private fun friendlyPermissionText(missing: List<String>): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "acceso a tus archivos y almacenamiento"
        }
        return when {
            missing == listOf(Manifest.permission.READ_MEDIA_IMAGES) -> "acceso a tus fotos"
            missing == listOf(Manifest.permission.READ_MEDIA_VIDEO) -> "acceso a tus videos"
            missing == listOf(Manifest.permission.READ_MEDIA_AUDIO) -> "acceso a tu audio"
            else -> "acceso a tus fotos, videos y audio"
        }
    }

    // phone_list_documents (interactive) — ACTION_OPEN_DOCUMENT_TREE, one
    // directory pick, non-recursive top-level listing of its children. Scope
    // decision (Frontend, no semantics were specified for this tool beyond
    // "the 4th one"): a single directory pick + flat listing, not a
    // multi-select or recursive walk — keeps it a single human decision
    // point like the other 3 tools, and avoids returning unbounded result
    // sizes into the model's context.
    private fun handlePickDirectory(result: MethodChannel.Result) {
        if (pendingTreeResult != null) {
            result.error("busy", "A directory pick is already in progress", null)
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        try {
            pendingTreeResult = result
            startActivityForResult(intent, pickDirectoryRequestCode)
        } catch (e: Exception) {
            pendingTreeResult = null
            result.error("no_picker", "No directory picker available: ${e.message}", null)
        }
    }

    private fun handleCancelPickDirectory(result: MethodChannel.Result) {
        if (pendingTreeResult != null) {
            finishActivity(pickDirectoryRequestCode)
            pendingTreeResult = null
        }
        result.success(true)
    }

    // phone_set_alarm — external-actions-and-connectors-analysis.md §2.1.
    // Deliberately no EXTRA_SKIP_UI. Confirmed on the real Samsung
    // (SM-N770F, One UI): this OEM's clock app saves and enables the alarm
    // immediately regardless — there's no confirm-before-save screen to
    // gate on either way, EXTRA_SKIP_UI or not. The reason to still omit it
    // is different from what a "user must confirm" checkpoint would give:
    // without EXTRA_SKIP_UI the clock app opens and the user SEES the new
    // alarm on screen right after — that visibility (matching the
    // transparency principle used everywhere else in this app — approval
    // cards, tool-execute pills) is the only thing distinguishing the two
    // options here, since neither one requires a tap to actually save it.
    // No result contract comes back from the clock app either way (unlike
    // the SAF pickers), so this is startActivity + immediate return, same
    // shape as handleOpenApp.
    private fun handleSetAlarm(hour: Int?, minute: Int?, label: String?, result: MethodChannel.Result) {
        if (hour == null || hour !in 0..23 || minute == null || minute !in 0..59) {
            result.error("bad_args", "hour (0-23) and minute (0-59) required", null)
            return
        }
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            if (!label.isNullOrEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("no_clock_app", "No app can handle ACTION_SET_ALARM: ${e.message}", null)
        }
    }

    // phone_set_timer — external-actions-and-connectors-analysis.md §2.1.
    // Same shape/reasoning as handleSetAlarm: ACTION_SET_TIMER is AlarmClock's
    // "cousin" API for timers, plain startActivity (no onActivityResult), no
    // EXTRA_SKIP_UI for the same transparency reason. NOT assuming this OEM
    // needs no extra manifest permission just because AlarmClock docs don't
    // mention one — handleSetAlarm's ACTION_SET_ALARM surprise (Samsung
    // enforcing com.android.alarm.permission.SET_ALARM on the calling app,
    // undocumented by the AlarmClock API itself) is exactly why this got
    // verified live on hardware before being declared done, not assumed.
    private fun handleSetTimer(seconds: Int?, label: String?, result: MethodChannel.Result) {
        if (seconds == null || seconds <= 0) {
            result.error("bad_args", "seconds (positive integer) required", null)
            return
        }
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            if (!label.isNullOrEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("no_clock_app", "No app can handle ACTION_SET_TIMER: ${e.message}", null)
        }
    }

    // phone_add_calendar_event — external-actions-and-connectors-analysis.md
    // §2.2. ACTION_INSERT against CalendarContract.Events.CONTENT_URI opens
    // the calendar app's own add-event screen pre-filled with these extras —
    // it does NOT persist anything until the user taps Save there (unlike
    // ACTION_SET_ALARM, which some OEMs save immediately with no screen at
    // all). No READ_CALENDAR/WRITE_CALENDAR permission needed here — those
    // guard direct ContentResolver access; this UI intent runs inside the
    // calendar app's own process under ITS permissions, same reason
    // ACTION_OPEN_DOCUMENT needs no storage permission from this app. Still
    // verified live rather than assumed, same discipline as the alarm/timer
    // tools above.
    private fun handleAddCalendarEvent(
        title: String?,
        location: String?,
        description: String?,
        beginTime: Long?,
        endTime: Long?,
        allDay: Boolean?,
        result: MethodChannel.Result,
    ) {
        if (beginTime == null) {
            result.error("bad_args", "beginTime (epoch millis) required", null)
            return
        }
        val intent = Intent(Intent.ACTION_INSERT).apply {
            data = CalendarContract.Events.CONTENT_URI
            putExtra(CalendarContract.Events.TITLE, title ?: "")
            if (!location.isNullOrEmpty()) putExtra(CalendarContract.Events.EVENT_LOCATION, location)
            if (!description.isNullOrEmpty()) putExtra(CalendarContract.Events.DESCRIPTION, description)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginTime)
            if (endTime != null) putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endTime)
            if (allDay == true) putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("no_calendar_app", "No app can handle calendar ACTION_INSERT: ${e.message}", null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == pickDocumentRequestCode) {
            val pending = pendingPickResult
            pendingPickResult = null
            if (pending == null) {
                // Already resolved locally (handleCancelPickDocument ran first).
                return
            }
            val uri = data?.data
            if (resultCode == Activity.RESULT_OK && uri != null) {
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: SecurityException) {
                    // Some providers don't support a persistable grant — fine, this
                    // call only needs read access for the current tool invocation.
                }
                pending.success(mapOf("uri" to uri.toString(), "name" to queryDisplayName(uri)))
            } else {
                // "cancelled_by_user" is the exact error string the gateway protocol
                // expects (design doc §3.3) — yggdrasil_client.dart forwards
                // PlatformException.message as-is into device.tools.result.
                pending.error("cancelled", "cancelled_by_user", null)
            }
            return
        }
        if (requestCode == pickDirectoryRequestCode) {
            val pending = pendingTreeResult
            pendingTreeResult = null
            if (pending == null) return
            val treeUri = data?.data
            if (resultCode == Activity.RESULT_OK && treeUri != null) {
                try {
                    contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: SecurityException) {
                }
                pending.success(mapOf("uri" to treeUri.toString(), "files" to listChildren(treeUri)))
            } else {
                pending.error("cancelled", "cancelled_by_user", null)
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun listChildren(treeUri: Uri): List<Map<String, String>> {
        val docId = DocumentsContract.getTreeDocumentId(treeUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
        val out = mutableListOf<Map<String, String>>()
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                childrenUri,
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null,
                null,
                null,
            )
            while (cursor != null && cursor.moveToNext()) {
                val childId = cursor.getString(0)
                val name = cursor.getString(1) ?: childId
                val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId)
                out.add(mapOf("name" to name, "uri" to childUri.toString()))
            }
        } catch (_: Exception) {
            // Best-effort — return whatever was collected before the failure.
        } finally {
            cursor?.close()
        }
        return out
    }

    // Pi chat attachments (lib/pi/pi_attachments.dart): a picked document is
    // streamed to the Pi in chunks, so Dart never holds a whole (up to 100 MB)
    // file in memory. Size via the provider's OpenableColumns.SIZE, falling
    // back to the file descriptor's own size.
    private fun handleUriSize(uriString: String?, result: MethodChannel.Result) {
        if (uriString.isNullOrEmpty()) {
            result.error("bad_args", "uri required", null)
            return
        }
        val uri = Uri.parse(uriString)
        var size = -1L
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                val idx = c.getColumnIndex(OpenableColumns.SIZE)
                if (c.moveToFirst() && idx >= 0 && !c.isNull(idx)) size = c.getLong(idx)
            }
            if (size < 0) contentResolver.openFileDescriptor(uri, "r")?.use { size = it.statSize }
        } catch (e: Exception) {
            result.error("read_failed", e.message, null)
            return
        }
        result.success(size)
    }

    // Reads [offset, offset+length) off the main thread. Seeks through the file
    // descriptor when the provider gives one (O(1) per chunk); otherwise skips
    // through a plain stream.
    private fun handleReadUriChunk(uriString: String?, offset: Long?, length: Int?, result: MethodChannel.Result) {
        if (uriString.isNullOrEmpty() || offset == null || offset < 0 || length == null || length <= 0 || length > 4 * 1024 * 1024) {
            result.error("bad_args", "uri, offset >= 0 and 0 < length <= 4 MB required", null)
            return
        }
        val uri = Uri.parse(uriString)
        Thread {
            try {
                val buf = ByteArray(length)
                var read = 0
                val pfd = try { contentResolver.openFileDescriptor(uri, "r") } catch (_: Exception) { null }
                if (pfd != null) {
                    pfd.use {
                        java.io.FileInputStream(it.fileDescriptor).channel.use { ch ->
                            ch.position(offset)
                            val bb = java.nio.ByteBuffer.wrap(buf)
                            while (bb.hasRemaining()) {
                                if (ch.read(bb) < 0) break
                            }
                            read = bb.position()
                        }
                    }
                } else {
                    contentResolver.openInputStream(uri)?.use { input ->
                        var skipped = 0L
                        while (skipped < offset) {
                            val n = input.skip(offset - skipped)
                            if (n <= 0) break
                            skipped += n
                        }
                        while (read < length) {
                            val n = input.read(buf, read, length - read)
                            if (n < 0) break
                            read += n
                        }
                    } ?: throw IllegalStateException("cannot open $uriString")
                }
                val out = if (read == length) buf else buf.copyOf(read)
                runOnUiThread { result.success(out) }
            } catch (e: Exception) {
                runOnUiThread { result.error("read_failed", e.message, null) }
            }
        }.start()
    }

    private fun queryDisplayName(uri: Uri): String? {
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor != null && cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) return cursor.getString(idx)
            }
        } catch (_: Exception) {
            // Best-effort — a missing display name shouldn't fail the whole pick.
        } finally {
            cursor?.close()
        }
        return null
    }
}
