package com.mauriciorossdev.yggdrasil

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

class BrainException(val code: String, message: String?) : Exception(message ?: code)

/**
 * The bubble's brain: a UI-less Flutter engine (Dart entrypoint
 * `bubbleAssistantMain`) that talks to the gateway and speaks the reply.
 * Created on first use, destroyed after a few idle minutes — same engine
 * recipe as [BackgroundRunner], but long-lived instead of one-shot.
 */
class BubbleBrain(private val app: Context, private val listener: Listener) {
    interface Listener {
        fun onState(state: String)
        fun onApproval(requestId: String, toolName: String, summary: String, riskLevel: String)
    }

    companion object {
        private const val CHANNEL = "com.yggdrasil.app/bubble_bg"
        private const val IDLE_SHUTDOWN_MS = 5 * 60_000L
    }

    private val main = Handler(Looper.getMainLooper())
    private var engine: FlutterEngine? = null
    private var channel: MethodChannel? = null
    private var ready = false
    private val whenReady = mutableListOf<() -> Unit>()
    private val idleShutdown = Runnable { shutdown() }

    private fun ensureEngine(block: () -> Unit) {
        if (engine != null && ready) return block()
        whenReady.add(block)
        if (engine != null) return // starting up; block runs on "ready"

        val loader = FlutterInjector.instance().flutterLoader()
        loader.startInitialization(app)
        loader.ensureInitializationComplete(app, null)
        val eng = FlutterEngine(app)
        engine = eng
        GeneratedPluginRegistrant.registerWith(eng)
        DeviceCapabilities(app).attach(eng)
        BackgroundDeviceTools(app).attach(eng) // open app, alarms, calendar... (the app's own engine gets these from MainActivity)
        val ch = MethodChannel(eng.dartExecutor.binaryMessenger, CHANNEL)
        channel = ch
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "ready" -> {
                    ready = true
                    val pending = whenReady.toList()
                    whenReady.clear()
                    pending.forEach { it() }
                    result.success(null)
                }
                "state" -> {
                    listener.onState(call.argument<String>("state") ?: "idle")
                    result.success(null)
                }
                "requestPermissions" -> {
                    // A UI-less engine can't show the system dialog itself: borrow an invisible activity.
                    val names = call.argument<List<String>>("permissions").orEmpty()
                    PermissionRequestActivity.request(app, names) { granted -> main.post { result.success(granted) } }
                }
                "approval" -> {
                    listener.onApproval(
                        call.argument("requestId") ?: "",
                        call.argument("toolName") ?: "",
                        call.argument("summary") ?: "",
                        call.argument("riskLevel") ?: "moderate",
                    )
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        eng.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "bubbleAssistantMain"))
    }

    /** Sends [text] to the assistant; [done] gets {text, spoken} or a [BrainException]. */
    fun ask(text: String, done: (Result<Map<String, Any?>>) -> Unit) {
        main.removeCallbacks(idleShutdown)
        ensureEngine {
            channel?.invokeMethod("ask", mapOf("text" to text), object : MethodChannel.Result {
                override fun success(result: Any?) {
                    @Suppress("UNCHECKED_CAST")
                    done(Result.success((result as? Map<String, Any?>) ?: emptyMap()))
                    scheduleShutdown()
                }

                override fun error(code: String, message: String?, details: Any?) {
                    done(Result.failure(BrainException(code, message)))
                    scheduleShutdown()
                }

                override fun notImplemented() {
                    done(Result.failure(BrainException("failed", "not implemented")))
                    scheduleShutdown()
                }
            })
        }
    }

    fun answerApproval(requestId: String, approved: Boolean) {
        if (!ready) return
        channel?.invokeMethod("approve", mapOf("requestId" to requestId, "approved" to approved))
    }

    private fun scheduleShutdown() {
        main.removeCallbacks(idleShutdown)
        main.postDelayed(idleShutdown, IDLE_SHUTDOWN_MS)
    }

    fun shutdown() {
        main.removeCallbacks(idleShutdown)
        try {
            channel?.invokeMethod("dispose", null)
        } catch (_: Exception) {
        }
        engine?.destroy()
        engine = null
        channel = null
        ready = false
        whenReady.clear()
    }
}
