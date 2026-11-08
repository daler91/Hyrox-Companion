package com.fitai.coach.ui

import com.fitai.coach.ui.auth.SignInViewModel
import com.fitai.coach.ui.privacy.PrivacyNoticeViewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module

/** The shared UI's view models. The platform supplies AuthGateway and ApiClient. */
val uiModule = module {
    viewModelOf(::SignInViewModel)
    viewModelOf(::PrivacyNoticeViewModel)
}
