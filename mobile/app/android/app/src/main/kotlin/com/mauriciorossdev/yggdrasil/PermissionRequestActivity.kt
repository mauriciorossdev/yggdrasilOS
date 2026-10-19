package com.mauriciorossdev.yggdrasil

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle

/**
 * Invisible activity that shows Android's runtime-permission dialog on behalf of
 * the bubble's UI-less engine (which has no Activity to ask from). The system
 * dialog appears over whatever app is open; the answer goes back to Dart.
 */
class PermissionRequestActivity : Activity() {
    companion object {
        private const val EXTRA = "permissions"

        @Volatile
        private var pending: ((Boolean) -> Unit)? = null

        /** Asks for [permissions]; [done] gets true only if every one ended up granted. */
        fun request(ctx: Context, permissions: List<String>, done: (Boolean) -> Unit) {
            pending?.invoke(false) // a newer request supersedes a stuck one
            pending = done
            ctx.startActivity(
                Intent(ctx, PermissionRequestActivity::class.java)
                    .putExtra(EXTRA, permissions.toTypedArray())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS),
            )
        }

        private fun deliver(granted: Boolean) {
            val cb = pending
            pending = null
            cb?.invoke(granted)
        }
    }

    private var delivered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)
        val perms = intent.getStringArrayExtra(EXTRA)?.toList().orEmpty()
        val missing = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) return finishWith(perms.isNotEmpty())
        requestPermissions(missing.toTypedArray(), 7)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        finishWith(grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED })
    }

    private fun finishWith(granted: Boolean) {
        if (delivered) return
        delivered = true
        deliver(granted)
        finish()
        overridePendingTransition(0, 0)
    }

    override fun onDestroy() {
        if (!delivered) {
            delivered = true
            deliver(false)
        }
        super.onDestroy()
    }
}
