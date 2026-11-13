package com.fitai.coach.core.data

import android.content.Context
import androidx.room.Room

/** User databases in the app's private database directory. */
public class AndroidUserDatabaseStore(context: Context) : UserDatabaseStore {
    private val context = context.applicationContext

    override fun open(userId: String): FitaiDatabase {
        val file = context.getDatabasePath(databaseFileName(userId))
        return Room.databaseBuilder<FitaiDatabase>(context, file.absolutePath).buildConfigured()
    }

    // deleteDatabase also removes the journal, write-ahead log and shared-memory files.
    override fun delete(userId: String) {
        context.deleteDatabase(databaseFileName(userId))
    }

    override fun deleteOthers(userId: String) {
        val keep = databaseFileName(userId)
        context.databaseList()
            .filter { isUserDatabaseFile(it) && it != keep }
            .forEach { context.deleteDatabase(it) }
    }
}
