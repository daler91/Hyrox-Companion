package com.fitai.coach.core.data

import java.io.File
import java.nio.file.Files

actual fun testDatabaseStore(): TestDatabaseStore {
    val directory = Files.createTempDirectory("fitai-db-test").toFile().apply { deleteOnExit() }
    val store = JvmUserDatabaseStore(directory)
    return object : TestDatabaseStore, UserDatabaseStore by store {
        override fun exists(userId: String): Boolean = File(directory, databaseFileName(userId)).exists()
    }
}
