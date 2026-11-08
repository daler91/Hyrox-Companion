package com.fitai.coach.core.data

/**
 * Where each user's database file lives. A file belongs to exactly one user,
 * so a write one athlete queued offline can never be replayed into another
 * athlete's account on a shared device (the bug `.jules/sentinel.md` records
 * for the web's offline queue).
 */
public interface UserDatabaseStore {
    /** Opens (creating if needed) [userId]'s database. */
    public fun open(userId: String): FitaiDatabase

    /** Deletes [userId]'s database file. Close it first. */
    public fun delete(userId: String)

    /** Deletes every user's database file except [userId]'s. */
    public fun deleteOthers(userId: String)
}

private const val PREFIX = "fitai-"
private const val SUFFIX = ".db"
private val SAFE_ID = Regex("[A-Za-z0-9_-]{1,100}")

/**
 * The file name of [userId]'s database. Clerk user ids (`user_…`) are used as
 * they are; anything else is hex-encoded, so an id can never name a path.
 */
@OptIn(ExperimentalStdlibApi::class)
public fun databaseFileName(userId: String): String {
    val safe = if (SAFE_ID.matches(userId)) {
        userId
    } else {
        "x" + userId.encodeToByteArray().toHexString()
    }
    return "$PREFIX$safe$SUFFIX"
}

/** Whether [fileName] is a user database this app created. */
public fun isUserDatabaseFile(fileName: String): Boolean = fileName.startsWith(PREFIX) && fileName.endsWith(SUFFIX)
