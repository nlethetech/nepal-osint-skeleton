/**
 * Type declarations for Google Identity Services (GIS) library.
 * Loaded dynamically via script tag.
 */
declare namespace google.accounts.id {
  interface IdConfiguration {
    client_id: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    context?: 'signin' | 'signup' | 'use'
    itp_support?: boolean
    login_uri?: string
    native_callback?: (response: CredentialResponse) => void
    nonce?: string
    prompt_parent_id?: string
    state_cookie_domain?: string
    ux_mode?: 'popup' | 'redirect'
  }

  interface CredentialResponse {
    credential: string
    select_by: string
    clientId?: string
  }

  interface GsiButtonConfiguration {
    type?: 'standard' | 'icon'
    theme?: 'outline' | 'filled_blue' | 'filled_black'
    size?: 'large' | 'medium' | 'small'
    text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
    shape?: 'rectangular' | 'pill' | 'circle' | 'square'
    logo_alignment?: 'left' | 'center'
    width?: number | string
    locale?: string
  }

  function initialize(config: IdConfiguration): void
  function prompt(momentListener?: (notification: PromptMomentNotification) => void): void
  function renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void
  function disableAutoSelect(): void
  function storeCredential(credential: { id: string; password: string }, callback?: () => void): void
  function cancel(): void
  function revoke(hint: string, callback?: (response: RevocationResponse) => void): void

  interface PromptMomentNotification {
    isDisplayMoment(): boolean
    isDisplayed(): boolean
    isNotDisplayed(): boolean
    getNotDisplayedReason(): string
    isSkippedMoment(): boolean
    getSkippedReason(): string
    isDismissedMoment(): boolean
    getDismissedReason(): string
  }

  interface RevocationResponse {
    successful: boolean
    error?: string
  }
}
