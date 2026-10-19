package com.mauriciorossdev.yggdrasil

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Home screen "Proyectos" widget — same static tap-to-launch pattern as
 * MicWidgetProvider, via the new yggdrasil://projects deep link
 * (main.dart's _handleDeepLink → openProjectsFromDeepLink).
 */
class ProjectsWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("yggdrasil://projects")).apply {
                setPackage(context.packageName)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pendingIntent = PendingIntent.getActivity(context, appWidgetId, intent, flags)

            val views = RemoteViews(context.packageName, R.layout.widget_projects)
            views.setOnClickPendingIntent(R.id.widget_projects_root, pendingIntent)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
