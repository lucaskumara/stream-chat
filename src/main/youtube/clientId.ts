/** A Google OAuth client of type "Desktop app". Google states plainly that installed
    apps cannot keep secrets, so the secret — if the console issues one — identifies the
    build and authorises nothing on its own; the PKCE verifier is what actually protects
    the exchange. Empty means the YouTube row reads "not configured" and no sign-in is
    offered, which is the correct state for a build nobody has provisioned. */
export const BUILT_IN_YOUTUBE_CLIENT_ID = ''

export const BUILT_IN_YOUTUBE_CLIENT_SECRET = ''
