/** Kick requires a client secret on both the authorization-code and refresh grants, and
    documents no public-client alternative — so a build either ships one or has no Kick
    sign-in. Unlike the Twitch client id, this genuinely is a credential: anyone can lift
    it out of the binary, which is Kick's design and not something this app can fix.
    Empty means the Kick row reads "not configured". */
export const BUILT_IN_KICK_CLIENT_ID = ''

export const BUILT_IN_KICK_CLIENT_SECRET = ''
