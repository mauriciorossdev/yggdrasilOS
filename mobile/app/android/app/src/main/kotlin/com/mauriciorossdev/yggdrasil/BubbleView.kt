package com.mauriciorossdev.yggdrasil

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.min

/**
 * The floating bubble itself: Yggdrasil's dark-green disc with a gold ring and
 * the root mark, plus a state animation — a halo while listening/speaking, a
 * spinning arc while thinking. Nothing about the conversation is ever drawn.
 */
class BubbleView(context: Context) : View(context) {
    enum class State { IDLE, LISTENING, THINKING, SPEAKING }

    var state: State = State.IDLE
        set(value) {
            if (field == value) return
            field = value
            if (value == State.IDLE) {
                animator.cancel()
                phase = 0f
            } else if (!animator.isRunning) {
                animator.start()
            }
            invalidate()
        }

    // Everything is drawn at 1.2x the original design (the bubble was made 20% larger).
    private val density = resources.displayMetrics.density * 1.2f
    private val gold = 0xFFC9A54E.toInt()
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF003833.toInt(); style = Paint.Style.FILL }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = gold; style = Paint.Style.STROKE; strokeWidth = 2f * density
    }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = gold; style = Paint.Style.FILL }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = gold; style = Paint.Style.STROKE; strokeWidth = 3.5f * density; strokeCap = Paint.Cap.ROUND
    }
    private val mark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = gold; style = Paint.Style.STROKE; strokeWidth = 1.6f * density; strokeCap = Paint.Cap.ROUND
    }
    private val oval = RectF()
    private var phase = 0f

    /** 0..1: how far a long press has progressed toward voice mode (drawn as a gold arc). */
    var holdProgress: Float = 0f
        set(value) {
            field = value
            invalidate()
        }
    private val holdArc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFE0BE6B.toInt(); style = Paint.Style.STROKE; strokeWidth = 3f * density; strokeCap = Paint.Cap.ROUND
    }

    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1100
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
            phase = it.animatedValue as Float
            invalidate()
        }
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val r = min(cx, cy) - 8f * density // keep room for the halo

        if (state == State.LISTENING || state == State.SPEAKING) {
            // Two staggered rings expanding and fading out.
            for (offset in floatArrayOf(0f, 0.5f)) {
                val t = (phase + offset) % 1f
                glow.alpha = ((1f - t) * 120).toInt()
                canvas.drawCircle(cx, cy, r + t * 8f * density, glow)
            }
        }

        canvas.drawCircle(cx, cy, r, fill)
        canvas.drawCircle(cx, cy, r, ring)

        if (state == State.THINKING) {
            oval.set(cx - r, cy - r, cx + r, cy + r)
            canvas.drawArc(oval, phase * 360f, 100f, false, arc)
        }

        if (holdProgress > 0f) {
            val hr = r + 4f * density
            oval.set(cx - hr, cy - hr, cx + hr, cy + hr)
            canvas.drawArc(oval, -90f, 360f * holdProgress, false, holdArc)
        }

        // Root mark: a small ring crossed by a vertical line (same as the in-app logo).
        val m = r * 0.38f
        canvas.drawCircle(cx, cy, m, mark)
        canvas.drawLine(cx, cy - m * 1.55f, cx, cy + m * 1.55f, mark)
    }
}
