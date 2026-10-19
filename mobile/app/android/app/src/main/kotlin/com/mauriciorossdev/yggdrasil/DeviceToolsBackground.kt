package com.mauriciorossdev.yggdrasil

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
import android.provider.CalendarContract
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * The `device_tools` channel for UI-less engines (the quick-access bubble's brain).
 * MainActivity serves the same channel for the app's own engine, but a headless
 * engine has no Activity: everything here needs only a Context (the launches use
 * FLAG_ACTIVITY_NEW_TASK, which Android allows while the bubble's overlay is
 * visible). Tools that need a screen — the file picker — say so instead of hanging.
 */
class BackgroundDeviceTools(private val ctx: Context) {
    companion object {
        const val CHANNEL = "com.yggdrasil.app/device_tools"
    }

    fun attach(engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "openApp" -> openApp(call.argument("packageName"), result)
                    "listInstalledApps" -> listInstalledApps(result)
                    "setAlarm" -> setAlarm(call.argument("hour"), call.argument("minute"), call.argument("label"), result)
                    "setTimer" -> setTimer(call.argument("seconds"), call.argument("label"), result)
                    "addCalendarEvent" -> addCalendarEvent(
                        call.argument("title"),
                        call.argument("location"),
                        call.argument("description"),
                        (call.argument<Number>("beginTime"))?.toLong(),
                        (call.argument<Number>("endTime"))?.toLong(),
                        call.argument("allDay"),
                        result,
                    )
                    "pickDocument", "cancelPickDocument", "uriSize", "readUriChunk" ->
                        result.error("needs_screen", "Esta acción necesita la pantalla de la app (selector de archivos).", null)
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("failed", e.message ?: e.javaClass.simpleName, null)
            }
        }
    }

    private fun launch(intent: Intent, notFoundCode: String, notFoundMessage: String, result: MethodChannel.Result) {
        try {
            ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error(notFoundCode, "$notFoundMessage: ${e.message}", null)
        }
    }

    private fun openApp(packageName: String?, result: MethodChannel.Result) {
        if (packageName.isNullOrEmpty()) return result.error("bad_args", "packageName required", null)
        val intent = ctx.packageManager.getLaunchIntentForPackage(packageName)
            ?: return result.error("not_found", "No launchable activity for $packageName", null)
        launch(intent, "not_found", "No launchable activity for $packageName", result)
    }

    private fun listInstalledApps(result: MethodChannel.Result) {
        val pm = ctx.packageManager
        val apps = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN, null).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { mapOf("packageName" to it.activityInfo.packageName, "appName" to it.loadLabel(pm).toString()) }
            .distinctBy { it["packageName"] }
        result.success(apps)
    }

    private fun setAlarm(hour: Int?, minute: Int?, label: String?, result: MethodChannel.Result) {
        if (hour == null || hour !in 0..23 || minute == null || minute !in 0..59) {
            return result.error("bad_args", "hour (0-23) and minute (0-59) required", null)
        }
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            if (!label.isNullOrEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
        }
        launch(intent, "no_clock_app", "No app can handle ACTION_SET_ALARM", result)
    }

    private fun setTimer(seconds: Int?, label: String?, result: MethodChannel.Result) {
        if (seconds == null || seconds <= 0) return result.error("bad_args", "seconds (positive integer) required", null)
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            if (!label.isNullOrEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
        }
        launch(intent, "no_clock_app", "No app can handle ACTION_SET_TIMER", result)
    }

    private fun addCalendarEvent(
        title: String?, location: String?, description: String?,
        beginTime: Long?, endTime: Long?, allDay: Boolean?, result: MethodChannel.Result,
    ) {
        if (beginTime == null) return result.error("bad_args", "beginTime (epoch millis) required", null)
        val intent = Intent(Intent.ACTION_INSERT).apply {
            data = CalendarContract.Events.CONTENT_URI
            putExtra(CalendarContract.Events.TITLE, title ?: "")
            if (!location.isNullOrEmpty()) putExtra(CalendarContract.Events.EVENT_LOCATION, location)
            if (!description.isNullOrEmpty()) putExtra(CalendarContract.Events.DESCRIPTION, description)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginTime)
            if (endTime != null) putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endTime)
            if (allDay == true) putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true)
        }
        launch(intent, "no_calendar_app", "No app can handle calendar ACTION_INSERT", result)
    }
}
