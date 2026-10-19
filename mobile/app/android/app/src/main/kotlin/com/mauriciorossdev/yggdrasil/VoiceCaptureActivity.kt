package com.mauriciorossdev.yggdrasil

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Invisible, translucent activity that listens for one utterance on behalf of
 * the bubble and hands the text to [BubbleService]. It exists because Android
 * only guarantees microphone access to something in the foreground; a service
 * started in the background (e.g. after a reboot) can't rely on it. It draws
 * nothing — the bubble's own animation is the only feedback.
 */
class VoiceCaptureActivity : Activity() {
    private var recognizer: SpeechRecognizer? = null
    private val main = Handler(Looper.getMainLooper())
    private var delivered = false
    private val giveUp = Runnable { finishWith(null, "timeout") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        } else {
            startListening()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startListening()
        else finishWith(null, "permission_denied")
    }

    private fun startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return finishWith(null, "unavailable")
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                finishWith(text, null)
            }

            override fun onError(error: Int) = finishWith(null, "error_$error")
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CL")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }
        r.startListening(intent)
        main.postDelayed(giveUp, 15_000)
    }

    private fun finishWith(text: String?, error: String?) {
        if (delivered) return
        delivered = true
        main.removeCallbacks(giveUp)
        BubbleService.instance?.onVoiceResult(text, error)
        finish()
        overridePendingTransition(0, 0)
    }

    override fun onDestroy() {
        main.removeCallbacks(giveUp)
        recognizer?.destroy()
        recognizer = null
        if (!delivered) BubbleService.instance?.onVoiceResult(null, "closed")
        delivered = true
        super.onDestroy()
    }
}
