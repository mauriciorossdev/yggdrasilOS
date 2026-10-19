package com.mauriciorossdev.yggdrasil

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant
import org.json.JSONObject

/**
 * One short-lived background FlutterEngine per trigger firing. The Dart entrypoint
 * `workflowBackgroundMain` says "ready"; we answer with the automation payload, it
 * replies with the run status, and the engine is destroyed (design §4).
 */
object BackgroundRunner {
    private const val CHANNEL = "com.yggdrasil.app/automation_bg"
    private const val TIMEOUT_MS = 180_000L
    private val live = mutableSetOf<FlutterEngine>()

    fun run(ctx: Context, payload: JSONObject) {
        val app = ctx.applicationContext
        val main = Handler(Looper.getMainLooper())
        main.post {
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(app)
            loader.ensureInitializationComplete(app, null)
            val engine = FlutterEngine(app)
            live.add(engine)
            GeneratedPluginRegistrant.registerWith(engine)
            DeviceCapabilities(app).attach(engine)
            val channel = MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL)
            fun finish() {
                main.post {
                    live.remove(engine)
                    engine.destroy()
                }
            }
            channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "ready" -> {
                        channel.invokeMethod("run", payload.toString(), object : MethodChannel.Result {
                            override fun success(res: Any?) = finish()
                            override fun error(code: String, message: String?, details: Any?) = finish()
                            override fun notImplemented() = finish()
                        })
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
            engine.dartExecutor.executeDartEntrypoint(
                DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "workflowBackgroundMain")
            )
            main.postDelayed({ if (live.contains(engine)) finish() }, TIMEOUT_MS)
        }
    }
}

/** Dart replaces the armed list here (called from the automation_triggers channel in MainActivity). */
object AutomationTriggersChannel {
    const val CHANNEL = "com.yggdrasil.app/automation_triggers"

    fun attach(ctx: Context, engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "arm" -> {
                    try {
                        TriggerRegistrar.replace(ctx, call.arguments as String)
                        if (TriggerStore.hasAny(ctx)) {
                            androidx.core.content.ContextCompat.startForegroundService(
                                ctx, android.content.Intent(ctx, AutomationService::class.java)
                            )
                        } else {
                            ctx.stopService(android.content.Intent(ctx, AutomationService::class.java))
                        }
                        result.success(null)
                    } catch (e: Exception) {
                        result.error("failed", e.message ?: e.javaClass.simpleName, null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
