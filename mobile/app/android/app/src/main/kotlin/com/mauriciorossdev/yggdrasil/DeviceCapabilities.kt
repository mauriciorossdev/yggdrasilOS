package com.mauriciorossdev.yggdrasil

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.location.Criteria
import android.location.LocationManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.view.KeyEvent
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Phase 2 device capabilities (notes/yggdrasil-mobile/on-device-workflows-design.md §2).
 * Context-only on purpose — no Activity reference — so it can later be attached
 * to a background FlutterEngine for on-device workflows (§4).
 */
class DeviceCapabilities(private val context: Context) {
    companion object {
        const val CHANNEL = "com.yggdrasil.app/device_caps"
        private const val NOTIFY_CHANNEL_ID = "yggdrasil_alerts"
        private const val YOUTUBE_MUSIC_PACKAGE = "com.google.android.apps.youtube.music"
    }

    // FCM pushes from the gateway name this channel; create it up front so the
    // first push doesn't fall back to a default low-importance one.
    private fun ensureAlertChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(NOTIFY_CHANNEL_ID, "Yggdrasil", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }

    fun attach(engine: FlutterEngine) {
        ensureAlertChannel()
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            try {
                dispatch(call, result)
            } catch (e: SecurityException) {
                result.error("permission_denied", e.message ?: "permission denied", null)
            } catch (e: Exception) {
                result.error("failed", e.message ?: e.javaClass.simpleName, null)
            }
        }
    }

    private fun dispatch(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "showNotification" -> showNotification(call.argument("title"), call.argument("body"), result)
            "clipboardGet" -> clipboardGet(result)
            "clipboardSet" -> clipboardSet(call.argument("text") ?: "", result)
            "deviceState" -> result.success(deviceState())
            "setRingerMode" -> setRingerMode(call.argument("mode") ?: "", result)
            "setVolume" -> setVolume(call.argument("stream") ?: "music", call.argument<Int>("percent") ?: -1, result)
            "setFlashlight" -> setFlashlight(call.argument("on") ?: false, result)
            "mediaControl" -> mediaControl(call.argument("action") ?: "play", call.argument("package"), result)
            "getLocation" -> getLocation(result)
            "readCalendar" -> readCalendar(
                (call.argument<Number>("beginMs") ?: 0).toLong(),
                (call.argument<Number>("endMs") ?: 0).toLong(),
                call.argument<Int>("limit") ?: 25,
                result,
            )
            "sendSms" -> sendSms(call.argument("to") ?: "", call.argument("body") ?: "", result)
            "composeSms" -> composeSms(call.argument("to") ?: "", call.argument("body") ?: "", result)
            "composeWhatsapp" -> composeWhatsapp(call.argument("number") ?: "", call.argument("body"), result)
            "dial" -> dial(call.argument("number") ?: "", result)
            "call" -> call(call.argument("number") ?: "", result)
            "searchContacts" -> searchContacts(call.argument("query") ?: "", call.argument<Int>("limit") ?: 10, result)
            "openUrl" -> openUrl(call.argument("url") ?: "", result)
            "shareText" -> shareText(call.argument("text") ?: "", call.argument("package"), result)
            "launchIntent" -> launchIntent(call.arguments as Map<*, *>, result)
            else -> result.notImplemented()
        }
    }

    private fun startActivityOrFail(intent: Intent, result: MethodChannel.Result) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            result.success(mapOf("ok" to true))
        } catch (e: android.content.ActivityNotFoundException) {
            result.error("no_handler", "No app on the phone can handle this", null)
        }
    }

    private fun showNotification(title: String?, body: String?, result: MethodChannel.Result) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(NOTIFY_CHANNEL_ID, "Automatizaciones", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            result.error("permission_denied", "Notifications are disabled for this app", null)
            return
        }
        val notification = NotificationCompat.Builder(context, NOTIFY_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title ?: "Yggdrasil")
            .setContentText(body ?: "")
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
        result.success(mapOf("ok" to true))
    }

    // Android 10+ only lets a foreground app read the clipboard; the Dart side
    // reports whatever this returns, so a background read simply comes back empty.
    private fun clipboardGet(result: MethodChannel.Result) {
        val cm = context.getSystemService(ClipboardManager::class.java)
        val text = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
        result.success(mapOf("text" to text))
    }

    private fun clipboardSet(text: String, result: MethodChannel.Result) {
        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("yggdrasil", text))
        result.success(mapOf("ok" to true))
    }

    private fun deviceState(): Map<String, Any?> {
        val battery = context.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val percent = if (level >= 0 && scale > 0) level * 100 / scale else null

        val cm = context.getSystemService(ConnectivityManager::class.java)
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        val network = when {
            caps == null -> "offline"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }

        val am = context.getSystemService(AudioManager::class.java)
        val ringer = when (am.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> "silent"
            AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
            else -> "normal"
        }
        val pm = context.getSystemService(PowerManager::class.java)
        return mapOf(
            "batteryPercent" to percent,
            "charging" to charging,
            "network" to network,
            "ringerMode" to ringer,
            "musicVolumePercent" to volumePercent(am, AudioManager.STREAM_MUSIC),
            "screenOn" to pm.isInteractive,
        )
    }

    private fun volumePercent(am: AudioManager, stream: Int): Int {
        val max = am.getStreamMaxVolume(stream)
        return if (max > 0) am.getStreamVolume(stream) * 100 / max else 0
    }

    private fun setRingerMode(mode: String, result: MethodChannel.Result) {
        val am = context.getSystemService(AudioManager::class.java)
        val target = when (mode) {
            "silent" -> AudioManager.RINGER_MODE_SILENT
            "vibrate" -> AudioManager.RINGER_MODE_VIBRATE
            "normal" -> AudioManager.RINGER_MODE_NORMAL
            else -> return result.error("bad_args", "mode must be silent|vibrate|normal", null)
        }
        // Silent/vibrate need Do-Not-Disturb access on Android 9+; without it the
        // platform throws SecurityException, which dispatch() maps to permission_denied.
        am.ringerMode = target
        result.success(mapOf("ok" to true))
    }

    private fun setVolume(stream: String, percent: Int, result: MethodChannel.Result) {
        if (percent !in 0..100) return result.error("bad_args", "percent must be 0-100", null)
        val am = context.getSystemService(AudioManager::class.java)
        val type = when (stream) {
            "music" -> AudioManager.STREAM_MUSIC
            "ring" -> AudioManager.STREAM_RING
            "alarm" -> AudioManager.STREAM_ALARM
            else -> return result.error("bad_args", "stream must be music|ring|alarm", null)
        }
        val max = am.getStreamMaxVolume(type)
        am.setStreamVolume(type, Math.round(max * percent / 100f), 0)
        result.success(mapOf("ok" to true, "percent" to volumePercent(am, type)))
    }

    private fun mediaControl(action: String, pkg: String?, result: MethodChannel.Result) {
        val code = when (action) {
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "toggle" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return result.error("bad_args", "Unknown media action: $action", null)
        }
        val target = pkg ?: YOUTUBE_MUSIC_PACKAGE
        try {
            context.packageManager.getPackageInfo(target, 0)
        } catch (e: PackageManager.NameNotFoundException) {
            return result.error("no_handler", "App $target is not installed", null)
        }
        for (type in listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
            val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
                .setPackage(target)
                .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(type, code))
            context.sendOrderedBroadcast(intent, null)
        }
        result.success(mapOf("ok" to true, "package" to target))
    }

    private fun setFlashlight(on: Boolean, result: MethodChannel.Result) {
        val cam = context.getSystemService(CameraManager::class.java)
        val id = cam.cameraIdList.firstOrNull { cam.getCameraCharacteristics(it)
            .get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            ?: return result.error("unsupported", "This phone has no flashlight", null)
        cam.setTorchMode(id, on)
        result.success(mapOf("ok" to true, "on" to on))
    }

    private fun getLocation(result: MethodChannel.Result) {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return result.error("permission_denied", "Location permission not granted", null)
        val lm = context.getSystemService(LocationManager::class.java)
        // Last known fix only — a fresh fix would need an async callback and a
        // timeout; a stale fix is good enough for "where am I roughly" workflows.
        val provider = lm.getBestProvider(Criteria(), true)
        val loc = provider?.let { lm.getLastKnownLocation(it) }
            ?: lm.getProviders(true).firstNotNullOfOrNull { lm.getLastKnownLocation(it) }
            ?: return result.error("unavailable", "No location fix available — turn on location and try again", null)
        result.success(
            mapOf("lat" to loc.latitude, "lng" to loc.longitude, "accuracyM" to loc.accuracy, "timeMs" to loc.time)
        )
    }

    private fun sendSms(to: String, body: String, result: MethodChannel.Result) {
        if (to.isBlank()) return result.error("bad_args", "to required", null)
        val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION") SmsManager.getDefault()
        }
        sms.sendTextMessage(to, null, body, null, null)
        result.success(mapOf("ok" to true, "mode" to "sent"))
    }

    private fun composeSms(to: String, body: String, result: MethodChannel.Result) {
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(to)}"))
            .putExtra("sms_body", body)
        startActivityOrFail(intent, result)
    }

    // wa.me takes international digits only, no +, spaces or dashes.
    private fun composeWhatsapp(number: String, body: String?, result: MethodChannel.Result) {
        val digits = number.filter { it.isDigit() }
        if (digits.isEmpty()) return result.error("bad_args", "number required (with country code)", null)
        val uri = StringBuilder("https://wa.me/$digits")
        if (!body.isNullOrEmpty()) uri.append("?text=").append(Uri.encode(body))
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri.toString())).setPackage("com.whatsapp")
        startActivityOrFail(intent, result)
    }

    private fun dial(number: String, result: MethodChannel.Result) {
        startActivityOrFail(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(number)}")), result)
    }

    private fun call(number: String, result: MethodChannel.Result) {
        startActivityOrFail(Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(number)}")), result)
    }

    private fun searchContacts(query: String, limit: Int, result: MethodChannel.Result) {
        val out = mutableListOf<Map<String, Any?>>()
        val cursor = context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$query%"),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC",
        )
        cursor?.use {
            while (it.moveToNext() && out.size < limit.coerceIn(1, 100)) {
                out.add(mapOf("name" to it.getString(0), "number" to it.getString(1)))
            }
        }
        result.success(mapOf("contacts" to out))
    }

    // Upcoming/occurring events between two instants. Uses the Instances table
    // (not Events) so recurring events are expanded into their real occurrences.
    // Times are epoch millis; all-day events are UTC-midnight based, which the
    // Dart side formats as plain dates.
    private fun readCalendar(beginMs: Long, endMs: Long, limit: Int, result: MethodChannel.Result) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            return result.error("permission_denied", "READ_CALENDAR not granted (Configuración → Capacidades)", null)
        }
        if (endMs <= beginMs) return result.error("bad_args", "endDateTime must be after startDateTime", null)
        val builder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        android.content.ContentUris.appendId(builder, beginMs)
        android.content.ContentUris.appendId(builder, endMs)
        val projection = arrayOf(
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.DESCRIPTION,
        )
        val out = mutableListOf<Map<String, Any?>>()
        val cap = limit.coerceIn(1, 100)
        context.contentResolver.query(builder.build(), projection, null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use {
            while (it.moveToNext() && out.size < cap) {
                out.add(
                    mapOf(
                        "title" to (it.getString(0) ?: ""),
                        "beginMs" to it.getLong(1),
                        "endMs" to it.getLong(2),
                        "allDay" to (it.getInt(3) == 1),
                        "location" to it.getString(4),
                        "description" to it.getString(5)?.take(300),
                    ),
                )
            }
        }
        result.success(mapOf("events" to out))
    }

    private fun openUrl(url: String, result: MethodChannel.Result) {
        if (url.isBlank()) return result.error("bad_args", "url required", null)
        startActivityOrFail(Intent(Intent.ACTION_VIEW, Uri.parse(url)), result)
    }

    private fun shareText(text: String, pkg: String?, result: MethodChannel.Result) {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        if (!pkg.isNullOrEmpty()) intent.setPackage(pkg)
        startActivityOrFail(intent, result)
    }

    // Generic Activity start — the Automate-style escape hatch for anything
    // without a dedicated capability. Only startActivity; no broadcast/service.
    private fun launchIntent(args: Map<*, *>, result: MethodChannel.Result) {
        val intent = Intent(args["action"] as? String ?: Intent.ACTION_VIEW)
        (args["data"] as? String)?.takeIf { it.isNotEmpty() }?.let { intent.data = Uri.parse(it) }
        (args["type"] as? String)?.takeIf { it.isNotEmpty() }?.let { intent.type = it }
        val pkg = (args["package"] as? String)?.takeIf { it.isNotEmpty() }
        val cls = (args["className"] as? String)?.takeIf { it.isNotEmpty() }
        if (pkg != null && cls != null) intent.setClassName(pkg, cls) else if (pkg != null) intent.setPackage(pkg)
        (args["extras"] as? Map<*, *>)?.forEach { (k, v) -> intent.putExtra(k.toString(), v.toString()) }
        startActivityOrFail(intent, result)
    }
}
