package com.fitai.coach.ui.auth

/** Callbacks from the sign-in form. */
interface SignInActions {
    fun onEmailChange(value: String)
    fun onCodeChange(value: String)
    fun submitEmail()
    fun submitCode()
    fun resendCode()
    fun changeEmail()
    fun signInWithGoogle()
}
