package com.mauriciorossdev.yggdrasil

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Home screen "Hablar" widget — a static tap-to-launch shortcut, no live data
 * synced from Flutter (that's why this is a plain AppWidgetProvider, not the
 * home_widget plugin: nothing to sync). Reuses the exact
 * yggdrasil://voice/listen deep link the tap-to-listen notification already
 * uses (MainActivity's handlePostVoiceNotification, main.dart's
 * _handleDeepLink) — tapping this widget opens the app and starts listening,
 * same as tapping that notification.
 */
class MicWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("yggdrasil://voice/listen")).apply {
                setPackage(context.packageName)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pendingIntent = PendingIntent.getActivity(context, appWidgetId, intent, flags)

            val views = RemoteViews(context.packageName, R.layout.widget_mic)
            views.setOnClickPendingIntent(R.id.widget_mic_root, pendingIntent)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
