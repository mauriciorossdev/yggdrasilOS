package com.mauriciorossdev.yggdrasil

import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.InputType
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.Locale
import kotlin.math.abs

/** On/off switch and last position of the quick-access bubble. */
object BubblePrefs {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("yggdrasil_bubble", Context.MODE_PRIVATE)
    fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", false)
    fun setEnabled(ctx: Context, value: Boolean) = prefs(ctx).edit().putBoolean("enabled", value).apply()
    fun position(ctx: Context): Pair<Int, Int>? {
        val p = prefs(ctx)
        return if (p.contains("x")) Pair(p.getInt("x", 0), p.getInt("y", 0)) else null
    }

    fun savePosition(ctx: Context, x: Int, y: Int) = prefs(ctx).edit().putInt("x", x).putInt("y", y).apply()
}

/**
 * Quick-access assistant bubble: a foreground service that keeps a draggable
 * overlay on top of every app. Tap -> the main chat. Hold -> a menu: talk
 * (voice in, voice out, nothing shown), open the chat, or type a quick message.
 * The conversation itself runs in [BubbleBrain] and is spoken, never displayed.
 */
class BubbleService : Service(), BubbleBrain.Listener {
    companion object {
        const val ACTION_STOP = "com.mauriciorossdev.yggdrasil.BUBBLE_STOP"
        private const val CHANNEL_ID = "bubble_service"
        private const val NOTIFICATION_ID = 4502
        private const val GOLD = 0xFFC9A54E.toInt()
        private const val SURFACE = 0xFF00302B.toInt()
        private const val TEXT = 0xFFF4EFE6.toInt()

        /** Bubble window size in dp (the visible disc is a bit smaller, leaving room for the halo). 77 = the original 64 + 20 %. */
        private const val BUBBLE_SIZE_DP = 77

        /** Total press time, from first touch, after which holding switches to voice mode. */
        private const val VOICE_HOLD_MS = 3000

        @Volatile
        var instance: BubbleService? = null

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, BubbleService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, BubbleService::class.java))
        }

        fun startIfEnabled(ctx: Context) {
            if (BubblePrefs.enabled(ctx) && Settings.canDrawOverlays(ctx)) start(ctx)
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var wm: WindowManager
    private lateinit var brain: BubbleBrain

    private var bubble: BubbleView? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var menuView: View? = null
    private var inputView: View? = null
    private var approvalView: View? = null
    private val approvals = ArrayDeque<List<String>>() // requestId, toolName, summary, risk
    private var approvalTimeout: Runnable? = null

    private var busy = false
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val resetListening = Runnable { if (bubble?.state == BubbleView.State.LISTENING) finishExchange() }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun screenW() = resources.displayMetrics.widthPixels
    private fun screenH() = resources.displayMetrics.heightPixels

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        brain = BubbleBrain(applicationContext, this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        if (intent?.action == ACTION_STOP) {
            BubblePrefs.setEnabled(this, false)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!Settings.canDrawOverlays(this)) {
            BubblePrefs.setEnabled(this, false)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        showBubble()
        return START_STICKY
    }

    override fun onDestroy() {
        instance = null
        main.removeCallbacksAndMessages(null)
        removeMenu()
        removeInput()
        removeApproval()
        bubble?.let { runCatching { wm.removeView(it) } }
        bubble = null
        brain.shutdown()
        tts?.shutdown()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        // Rotation: keep the bubble on screen.
        val p = bubbleParams ?: return
        p.x = p.x.coerceIn(0, (screenW() - dp(BUBBLE_SIZE_DP)).coerceAtLeast(0))
        p.y = p.y.coerceIn(0, (screenH() - dp(BUBBLE_SIZE_DP)).coerceAtLeast(0))
        bubble?.let { runCatching { wm.updateViewLayout(it, p) } }
    }

    // ---- foreground notification ----

    private fun startForegroundCompat() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Burbuja del asistente", NotificationManager.IMPORTANCE_LOW))
        }
        val openChat = PendingIntent.getActivity(this, 0, chatIntent(), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val hide = PendingIntent.getService(
            this, 1, Intent(this, BubbleService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Yggdrasil")
            .setContentText("Burbuja del asistente activa")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openChat)
            .addAction(0, "Ocultar burbuja", hide)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun chatIntent(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("yggdrasil://assistant"))
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    private fun openChat() {
        removeMenu()
        removeInput()
        startActivity(chatIntent())
    }

    // ---- the bubble ----

    private fun overlayParams(w: Int, h: Int, flags: Int) = WindowManager.LayoutParams(
        w, h, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, flags, PixelFormat.TRANSLUCENT,
    )

    private fun showBubble() {
        if (bubble != null) return
        val size = dp(BUBBLE_SIZE_DP)
        val saved = BubblePrefs.position(this)
        val params = overlayParams(
            size, size,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = saved?.first ?: (screenW() - size)
            y = saved?.second ?: (screenH() * 0.4f).toInt()
        }
        val view = BubbleView(this)
        view.contentDescription = "Asistente Yggdrasil"
        view.setOnTouchListener(BubbleTouch())
        try {
            wm.addView(view, params)
        } catch (e: Exception) { // overlay permission revoked or window refused
            BubblePrefs.setEnabled(this, false)
            stopSelf()
            return
        }
        bubble = view
        bubbleParams = params
    }

    private inner class BubbleTouch : View.OnTouchListener {
        private var downX = 0f
        private var downY = 0f
        private var startX = 0
        private var startY = 0
        private var moved = false
        private var longFired = false
        private val slop = ViewConfiguration.get(this@BubbleService).scaledTouchSlop
        private var holdAnimator: ValueAnimator? = null
        private val longPress = Runnable {
            longFired = true
            bubble?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            showMenu()
            startHoldToTalk()
        }

        // Keep holding after the menu opens and, 3 s after the first touch, the
        // bubble switches straight to voice mode. A gold arc fills up meanwhile.
        private fun startHoldToTalk() {
            holdAnimator?.cancel()
            var cancelled = false
            holdAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = (VOICE_HOLD_MS - ViewConfiguration.getLongPressTimeout()).coerceAtLeast(500).toLong()
                addUpdateListener { bubble?.holdProgress = it.animatedValue as Float }
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationCancel(animation: android.animation.Animator) {
                        cancelled = true
                    }

                    override fun onAnimationEnd(animation: android.animation.Animator) {
                        bubble?.holdProgress = 0f
                        if (cancelled) return
                        bubble?.performHapticFeedback(
                            if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS,
                        )
                        removeMenu()
                        startVoice()
                    }
                })
                start()
            }
        }

        private fun stopHoldToTalk() {
            holdAnimator?.cancel()
            holdAnimator = null
            bubble?.holdProgress = 0f
        }

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            val p = bubbleParams ?: return false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX
                    downY = e.rawY
                    startX = p.x
                    startY = p.y
                    moved = false
                    longFired = false
                    main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!moved && !longFired && (abs(dx) > slop || abs(dy) > slop)) {
                        moved = true
                        main.removeCallbacks(longPress)
                    }
                    if (moved && !longFired) {
                        p.x = (startX + dx).toInt().coerceIn(0, (screenW() - p.width).coerceAtLeast(0))
                        p.y = (startY + dy).toInt().coerceIn(0, (screenH() - p.height).coerceAtLeast(0))
                        runCatching { wm.updateViewLayout(v, p) }
                    }
                }
                MotionEvent.ACTION_UP -> {
                    main.removeCallbacks(longPress)
                    stopHoldToTalk()
                    if (!longFired) {
                        if (moved) snapToEdge() else onBubbleTap()
                    }
                }
                MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(longPress)
                    stopHoldToTalk()
                }
            }
            return true
        }
    }

    private fun onBubbleTap() {
        // Tapping while it is listening/thinking just opens the chat too.
        openChat()
    }

    private fun snapToEdge() {
        val p = bubbleParams ?: return
        val view = bubble ?: return
        val target = if (p.x + p.width / 2 < screenW() / 2) 0 else screenW() - p.width
        ValueAnimator.ofInt(p.x, target).apply {
            duration = 180
            addUpdateListener {
                p.x = it.animatedValue as Int
                runCatching { wm.updateViewLayout(view, p) }
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    BubblePrefs.savePosition(this@BubbleService, p.x, p.y)
                }
            })
            start()
        }
    }

    // ---- small view helpers ----

    private fun rounded(color: Int, radiusDp: Int, strokeColor: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
        if (strokeColor != null) setStroke(dp(1), strokeColor)
    }

    private fun ripple(): RippleDrawable =
        RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), null, ColorDrawable(Color.WHITE))

    private fun menuRow(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 15f
        setTextColor(TEXT)
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(18), 0, dp(18), 0)
        minimumWidth = dp(190)
        minimumHeight = dp(48)
        background = ripple()
        setOnClickListener { onClick() }
    }

    private val fullScreenFlags =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS

    // ---- hold menu ----

    private fun showMenu() {
        removeMenu()
        val p = bubbleParams ?: return
        val root = FrameLayout(this)
        root.setOnClickListener { removeMenu() }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(SURFACE, 16, 0x33F4EFE6)
            setPadding(0, dp(6), 0, dp(6))
            elevation = dp(8).toFloat()
            addView(menuRow("🎤  Hablar") { removeMenu(); startVoice() })
            addView(menuRow("💬  Abrir chat") { openChat() })
            addView(menuRow("⌨️  Escribir") { removeMenu(); showInput() })
        }
        val cardW = dp(210)
        val cardH = dp(48 * 3 + 12)
        val lp = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP or Gravity.START
            leftMargin = if (p.x + p.width / 2 < screenW() / 2) p.x + p.width else (p.x - cardW).coerceAtLeast(dp(8))
            topMargin = (p.y - dp(40)).coerceIn(dp(24), (screenH() - cardH - dp(24)).coerceAtLeast(dp(24)))
        }
        root.addView(card, lp)
        val params = overlayParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, fullScreenFlags)
        runCatching { wm.addView(root, params) }.onSuccess { menuView = root }
    }

    private fun removeMenu() {
        menuView?.let { runCatching { wm.removeView(it) } }
        menuView = null
    }

    // ---- quick typed message ----

    private class BackAwareFrame(ctx: Context, private val onBack: () -> Unit) : FrameLayout(ctx) {
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                onBack()
                return true
            }
            return super.dispatchKeyEvent(event)
        }
    }

    private fun showInput() {
        removeInput()
        if (busy) return
        val root = BackAwareFrame(this) { removeInput() }
        root.setBackgroundColor(0x66000000)
        root.setOnClickListener { removeInput() }

        val edit = EditText(this).apply {
            hint = "Escribe tu mensaje…"
            setHintTextColor(0x99F4EFE6.toInt())
            setTextColor(TEXT)
            textSize = 16f
            background = null
            setSingleLine(true)
            imeOptions = EditorInfo.IME_ACTION_SEND
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val send = TextView(this).apply {
            text = "➤"
            textSize = 18f
            setTextColor(SURFACE)
            gravity = Gravity.CENTER
            background = rounded(GOLD, 20)
        }
        fun submitTyped() {
            val text = edit.text.toString().trim()
            if (text.isEmpty()) return
            removeInput()
            submit(text)
        }
        send.setOnClickListener { submitTyped() }
        edit.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEND) { submitTyped(); true } else false
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(SURFACE, 28, 0x33F4EFE6)
            setPadding(dp(18), dp(6), dp(8), dp(6))
            addView(edit, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(send, LinearLayout.LayoutParams(dp(40), dp(40)))
            isClickable = true // taps on the card must not dismiss the overlay behind it
        }
        val lp = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP
            topMargin = dp(96)
            leftMargin = dp(16)
            rightMargin = dp(16)
        }
        root.addView(card, lp)

        val params = overlayParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        ).apply {
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN
        }
        runCatching { wm.addView(root, params) }.onSuccess {
            inputView = root
            edit.requestFocus()
            edit.postDelayed({
                (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
            }, 150)
        }
    }

    private fun removeInput() {
        inputView?.let {
            (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it.windowToken, 0)
            runCatching { wm.removeView(it) }
        }
        inputView = null
    }

    // ---- voice in ----

    private fun startVoice() {
        if (busy) return
        busy = true
        bubble?.state = BubbleView.State.LISTENING
        bubble?.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        main.postDelayed(resetListening, 25_000) // safety net if the capture screen never reports back
        startActivity(
            Intent(this, VoiceCaptureActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS),
        )
    }

    /** Called by [VoiceCaptureActivity] with what the user said (or why nothing was heard). */
    fun onVoiceResult(text: String?, error: String?) {
        main.post {
            main.removeCallbacks(resetListening)
            if (text.isNullOrBlank()) {
                busy = false
                finishExchange()
                if (error == "permission_denied") {
                    Toast.makeText(this, "Concede el permiso de micrófono a Yggdrasil", Toast.LENGTH_LONG).show()
                }
                return@post
            }
            busy = false // submit() takes over the flag
            submit(text)
        }
    }

    // ---- the exchange (text in -> brain -> spoken reply) ----

    private fun submit(text: String) {
        if (busy) return
        busy = true
        bubble?.state = BubbleView.State.THINKING
        brain.ask(text) { result ->
            main.post {
                result.onSuccess { reply ->
                    val spoken = reply["spoken"] as? Boolean ?: true
                    val answer = (reply["text"] as? String).orEmpty()
                    if (!spoken && answer.isNotBlank()) speakFallback(answer) else finishExchange()
                }.onFailure { e ->
                    val code = (e as? BrainException)?.code
                    speakFallback(
                        if (code == "gateway_required") "Necesito que configures la conexión al gateway en la app."
                        else "No pude hablar con el asistente. Intenta de nuevo.",
                    )
                }
            }
        }
    }

    private fun finishExchange() {
        busy = false
        bubble?.state = BubbleView.State.IDLE
    }

    // Used only when the cloud voice (Replicate) failed: Android's own text-to-speech.
    private fun speakFallback(text: String) {
        bubble?.state = BubbleView.State.SPEAKING
        val say = { engine: TextToSpeech ->
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { main.post { finishExchange() } }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { main.post { finishExchange() } }
            })
            engine.speak(text.take(400), TextToSpeech.QUEUE_FLUSH, null, "bubble")
            Unit
        }
        val existing = tts
        if (existing != null && ttsReady) {
            say(existing)
            return
        }
        tts = TextToSpeech(this) { status ->
            val engine = tts
            if (status != TextToSpeech.SUCCESS || engine == null) return@TextToSpeech finishExchange()
            if (engine.setLanguage(Locale("es", "CL")) < TextToSpeech.LANG_AVAILABLE) engine.setLanguage(Locale("es"))
            ttsReady = true
            say(engine)
        }
    }

    // ---- BubbleBrain.Listener ----

    override fun onState(state: String) {
        main.post {
            bubble?.state = when (state) {
                "thinking" -> BubbleView.State.THINKING
                "speaking" -> BubbleView.State.SPEAKING
                else -> if (busy) bubble?.state ?: BubbleView.State.IDLE else BubbleView.State.IDLE
            }
        }
    }

    override fun onApproval(requestId: String, toolName: String, summary: String, riskLevel: String) {
        main.post {
            approvals.addLast(listOf(requestId, toolName, summary, riskLevel))
            if (approvalView == null) showNextApproval()
        }
    }

    private fun showNextApproval() {
        val next = approvals.removeFirstOrNull() ?: return
        val (requestId, _, summary, risk) = next
        val answer = { approved: Boolean ->
            approvalTimeout?.let { main.removeCallbacks(it) }
            brain.answerApproval(requestId, approved)
            removeApproval()
            showNextApproval()
        }
        val label = TextView(this).apply {
            text = "¿Aprobar? $summary"
            setTextColor(TEXT)
            textSize = 15f
            setPadding(dp(18), dp(14), dp(18), dp(6))
        }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(dp(8), 0, dp(8), dp(8))
            addView(menuRow("Rechazar") { answer(false) }.apply { minimumWidth = dp(100) })
            addView(menuRow("Aprobar") { answer(true) }.apply { minimumWidth = dp(100); setTextColor(GOLD) })
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(SURFACE, 16, if (risk == "destructive") 0xFFC1633B.toInt() else 0x33F4EFE6)
            elevation = dp(8).toFloat()
            addView(label)
            addView(buttons)
        }
        val params = overlayParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(56)
        }
        runCatching { wm.addView(card, params) }.onSuccess {
            approvalView = card
            val timeout = Runnable { answer(false) } // an unanswered card must not block the assistant forever
            approvalTimeout = timeout
            main.postDelayed(timeout, 45_000)
        }.onFailure { brain.answerApproval(requestId, false) }
    }

    private fun removeApproval() {
        approvalView?.let { runCatching { wm.removeView(it) } }
        approvalView = null
    }
}

/** Dart <-> native bridge for the settings switch (channel `com.yggdrasil.app/bubble`). */
object BubbleChannel {
    const val CHANNEL = "com.yggdrasil.app/bubble"

    fun attach(ctx: Context, engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "isEnabled" -> result.success(BubblePrefs.enabled(ctx) && Settings.canDrawOverlays(ctx))
                "canDrawOverlays" -> result.success(Settings.canDrawOverlays(ctx))
                "openOverlaySettings" -> {
                    ctx.startActivity(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    result.success(null)
                }
                "setEnabled" -> {
                    val enabled = call.argument<Boolean>("enabled") ?: false
                    if (enabled && !Settings.canDrawOverlays(ctx)) {
                        result.success(false)
                    } else {
                        BubblePrefs.setEnabled(ctx, enabled)
                        if (enabled) BubbleService.start(ctx) else BubbleService.stop(ctx)
                        result.success(true)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
