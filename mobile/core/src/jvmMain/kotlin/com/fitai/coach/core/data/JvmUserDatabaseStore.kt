package com.fitai.coach.core.data

import androidx.room.Room
import java.io.File

/** User databases as files in [directory]. Used by the JVM target (tests, tools). */
public class JvmUserDatabaseStore(private val directory: File) : UserDatabaseStore {
    override fun open(userId: String): FitaiDatabase {
        directory.mkdirs()
        return Room.databaseBuilder<FitaiDatabase>(name = File(directory, databaseFileName(userId)).absolutePath)
            .configured()
            .build()
    }

    override fun delete(userId: String) {
        deleteFiles(databaseFileName(userId))
    }

    override fun deleteOthers(userId: String) {
        val keep = databaseFileName(userId)
        directory.listFiles().orEmpty()
            .map { it.name }
            .filter { isUserDatabaseFile(it) && it != keep }
            .forEach(::deleteFiles)
    }

    private fun deleteFiles(name: String) {
        // SQLite's write-ahead log and shared-memory files sit beside the database.
        listOf("", "-wal", "-shm", "-journal").forEach { File(directory, name + it).delete() }
    }
}
