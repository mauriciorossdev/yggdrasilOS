package com.mauriciorossdev.yggdrasil

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.pm.ServiceInfo
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Armed device triggers (notes/yggdrasil-mobile/on-device-workflows-design.md §4).
 * Dart writes the full list here via the automation_triggers channel; native only
 * detects and forwards to the background Dart engine (BackgroundRunner).
 */
object TriggerStore {
    private const val PREFS = "yggdrasil_automation_triggers"
    private const val KEY_ARMED = "armed"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readArmed(ctx: Context): JSONArray = JSONArray(prefs(ctx).getString(KEY_ARMED, "[]") ?: "[]")

    fun writeArmed(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY_ARMED, json).apply()
    }

    fun hasAny(ctx: Context): Boolean = readArmed(ctx).length() > 0

    /** Last known match state of a level/state trigger, so only transitions fire. */
    fun edge(ctx: Context, triggerId: String): Boolean = prefs(ctx).getBoolean("edge_$triggerId", false)

    fun setEdge(ctx: Context, triggerId: String, value: Boolean) {
        prefs(ctx).edit().putBoolean("edge_$triggerId", value).apply()
    }

    fun clearEdge(ctx: Context, triggerId: String) {
        prefs(ctx).edit().remove("edge_$triggerId").apply()
    }

    fun findArmed(ctx: Context, triggerId: String): JSONObject? {
        val list = readArmed(ctx)
        for (i in 0 until list.length()) {
            val t = list.getJSONObject(i)
            if (t.getString("triggerId") == triggerId) return t
        }
        return null
    }
}

object TriggerRegistrar {
    private const val ACTION_ALARM = "com.mauriciorossdev.yggdrasil.TRIGGER_ALARM"
    private const val ACTION_GEOFENCE = "com.mauriciorossdev.yggdrasil.TRIGGER_GEOFENCE"
    private val networkCallbacks = mutableMapOf<String, ConnectivityManager.NetworkCallback>()

    /** Dart replaced the armed list: tear down what the old list registered, then store the new one. */
    fun replace(ctx: Context, json: String) {
        clearAll(ctx, TriggerStore.readArmed(ctx))
        TriggerStore.writeArmed(ctx, json)
    }

    private fun clearAll(ctx: Context, armed: JSONArray) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val lm = ctx.getSystemService(LocationManager::class.java)
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        for (i in 0 until armed.length()) {
            val t = armed.getJSONObject(i)
            val id = t.getString("triggerId")
            when (t.getString("type")) {
                "schedule" -> PendingIntent.getBroadcast(ctx, id.hashCode(), alarmIntent(ctx, id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE)
                    ?.let { am.cancel(it) }
                "geofence" -> geofencePendingIntent(ctx, id, create = false)?.let {
                    try {
                        lm.removeProximityAlert(it)
                    } catch (_: SecurityException) {
                    }
                }
            }
            TriggerStore.clearEdge(ctx, id)
        }
        networkCallbacks.values.forEach { cm.unregisterNetworkCallback(it) }
        networkCallbacks.clear()
    }

    /** Registers every armed trigger with the system. Called by AutomationService on each start. */
    fun armAll(ctx: Context) {
        val armed = TriggerStore.readArmed(ctx)
        val am = ctx.getSystemService(AlarmManager::class.java)
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val lm = ctx.getSystemService(LocationManager::class.java)
        networkCallbacks.values.forEach { cm.unregisterNetworkCallback(it) }
        networkCallbacks.clear()
        for (i in 0 until armed.length()) {
            val t = armed.getJSONObject(i)
            val id = t.getString("triggerId")
            val p = t.getJSONObject("params")
            when (t.getString("type")) {
                "schedule" -> scheduleNext(ctx, am, id, p.getString("time"))
                "battery" -> TriggerStore.setEdge(ctx, id, batteryMatches(ctx, p))
                "network" -> registerNetwork(ctx, cm, id, p)
                "geofence" -> try {
                    lm.addProximityAlert(
                        p.getDouble("lat"), p.getDouble("lng"), p.getDouble("radius").toFloat(), -1,
                        geofencePendingIntent(ctx, id, create = true)!!
                    )
                } catch (_: SecurityException) {
                    // Location permission not granted yet — the editor asks before arming.
                }
            }
        }
    }

    fun batteryMatches(ctx: Context, p: JSONObject): Boolean {
        val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val percent = if (level >= 0 && scale > 0) level * 100 / scale else -1
        return when (p.getString("op")) {
            "below" -> percent >= 0 && percent < p.getInt("percent")
            "above" -> percent >= 0 && percent > p.getInt("percent")
            "charging" -> charging
            "unplugged" -> !charging
            else -> false
        }
    }

    /** Battery broadcasts land here (service keeps the receiver registered only when a battery trigger is armed). */
    fun onBatteryChanged(ctx: Context, intent: Intent) {
        val armed = TriggerStore.readArmed(ctx)
        for (i in 0 until armed.length()) {
            val t = armed.getJSONObject(i)
            if (t.getString("type") != "battery") continue
            val id = t.getString("triggerId")
            val now = batteryMatches(ctx, t.getJSONObject("params"))
            val before = TriggerStore.edge(ctx, id)
            TriggerStore.setEdge(ctx, id, now)
            if (now && !before) TriggerDispatch.fire(ctx, t, JSONObject().put("type", "battery"))
        }
    }

    private fun registerNetwork(ctx: Context, cm: ConnectivityManager, id: String, p: JSONObject) {
        val transport = if (p.getString("transport") == "cellular") NetworkCapabilities.TRANSPORT_CELLULAR else NetworkCapabilities.TRANSPORT_WIFI
        val request = NetworkRequest.Builder().addTransportType(transport).build()
        val on = p.getString("on")
        val current = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }?.hasTransport(transport) == true
        TriggerStore.setEdge(ctx, id, current)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val before = TriggerStore.edge(ctx, id)
                TriggerStore.setEdge(ctx, id, true)
                if (!before && on == "connected") fireArmed(ctx, id, "network")
            }

            override fun onLost(network: Network) {
                val before = TriggerStore.edge(ctx, id)
                TriggerStore.setEdge(ctx, id, false)
                if (before && on == "disconnected") fireArmed(ctx, id, "network")
            }
        }
        cm.registerNetworkCallback(request, callback)
        networkCallbacks[id] = callback
    }

    private fun geofencePendingIntent(ctx: Context, id: String, create: Boolean): PendingIntent? {
        val intent = Intent(ctx, TriggerReceiver::class.java).setAction(ACTION_GEOFENCE).setData(Uri.parse("yggdrasil://geo/$id"))
            .putExtra("triggerId", id)
        val flags = PendingIntent.FLAG_MUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE
        return PendingIntent.getBroadcast(ctx, id.hashCode(), intent, flags)
    }

    private fun alarmIntent(ctx: Context, id: String): Intent =
        Intent(ctx, TriggerReceiver::class.java).setAction(ACTION_ALARM).setData(Uri.parse("yggdrasil://alarm/$id"))
            .putExtra("triggerId", id)

    /** Next occurrence of HH:mm (today if still ahead, else tomorrow). Re-armed after each firing. */
    fun scheduleNext(ctx: Context, am: AlarmManager, id: String, hhmm: String) {
        val parts = hhmm.split(":")
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, parts[0].toInt())
            set(Calendar.MINUTE, parts[1].toInt())
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        val pi = PendingIntent.getBroadcast(ctx, id.hashCode(), alarmIntent(ctx, id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // Exact alarms need the special access on Android 14+; without it fall back to a
        // window the system may shift by minutes (the editor says so).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
        }
    }

    /** Fired by the alarm/geofence/boot receivers. */
    fun fireArmed(ctx: Context, id: String, type: String) {
        val t = TriggerStore.findArmed(ctx, id) ?: return
        TriggerDispatch.fire(ctx, t, JSONObject().put("type", type))
    }
}

object TriggerDispatch {
    /** Starts one background Dart run for an armed automation. `detail` lands in the workflow's `trigger` context. */
    fun fire(ctx: Context, armed: JSONObject, detail: JSONObject) {
        val payload = JSONObject()
            .put("automationId", armed.getString("automationId"))
            .put("trigger", JSONObject(detail.toString()).put("id", armed.getString("triggerId")))
        BackgroundRunner.run(ctx, payload)
    }
}

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> {
                val armed = TriggerStore.readArmed(ctx)
                for (i in 0 until armed.length()) {
                    val t = armed.getJSONObject(i)
                    if (t.getString("type") == "boot") TriggerDispatch.fire(ctx, t, JSONObject().put("type", "boot"))
                }
                if (TriggerStore.hasAny(ctx)) ContextCompat.startForegroundService(ctx, Intent(ctx, AutomationService::class.java))
                BubbleService.startIfEnabled(ctx) // the quick-access bubble comes back after a reboot
            }
            "com.mauriciorossdev.yggdrasil.TRIGGER_ALARM" -> {
                val id = intent.getStringExtra("triggerId") ?: return
                val armed = TriggerStore.findArmed(ctx, id) ?: return
                TriggerDispatch.fire(ctx, armed, JSONObject().put("type", "schedule").put("time", armed.getJSONObject("params").getString("time")))
                TriggerRegistrar.scheduleNext(ctx, ctx.getSystemService(AlarmManager::class.java), id, armed.getJSONObject("params").getString("time"))
            }
            "com.mauriciorossdev.yggdrasil.TRIGGER_GEOFENCE" -> {
                val id = intent.getStringExtra("triggerId") ?: return
                val entering = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)
                val armed = TriggerStore.findArmed(ctx, id) ?: return
                val wanted = armed.getJSONObject("params").getString("on") == "enter"
                if (entering == wanted) {
                    TriggerDispatch.fire(ctx, armed, JSONObject().put("type", "geofence").put("entering", entering))
                }
            }
        }
    }
}

/**
 * Keeps the armed triggers alive: a foreground service (persistent low-priority
 * notification "automatizaciones activas") that owns the battery receiver and
 * re-arms everything on each start (design §4 — "servicio en primer plano").
 */
class AutomationService : Service() {
    companion object {
        private const val CHANNEL_ID = "automation_service"
        private const val NOTIFICATION_ID = 4501
    }

    private var batteryReceiver: BroadcastReceiver? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        TriggerRegistrar.armAll(this)
        registerBatteryIfNeeded()
        if (!TriggerStore.hasAny(this)) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        batteryReceiver?.let { unregisterReceiver(it) }
        batteryReceiver = null
        super.onDestroy()
    }

    private fun registerBatteryIfNeeded() {
        val armed = TriggerStore.readArmed(this)
        var needed = false
        for (i in 0 until armed.length()) if (armed.getJSONObject(i).getString("type") == "battery") needed = true
        if (needed && batteryReceiver == null) {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) = TriggerRegistrar.onBatteryChanged(ctx, intent)
            }
            ContextCompat.registerReceiver(this, receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
            batteryReceiver = receiver
        } else if (!needed && batteryReceiver != null) {
            unregisterReceiver(batteryReceiver)
            batteryReceiver = null
        }
    }

    private fun startForegroundCompat() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Automatizaciones", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Yggdrasil")
            .setContentText("Automatizaciones activas")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }
}
