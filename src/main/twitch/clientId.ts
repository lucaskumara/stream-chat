/**
 * Twitch Client ID for this application.
 *
 * This is deliberately a build-time constant rather than something the user
 * enters. Twitch public clients have no secret: the Client ID identifies the
 * application and authorises nothing by itself, which is why every third-party
 * Twitch client ships one inside the binary. Asking the user to register their
 * own app would be developer setup masquerading as a feature.
 *
 * Override with the TWITCH_CLIENT_ID environment variable when testing against
 * a different registration. If this repo ever becomes public, move the value
 * into an untracked .env rather than leaving it here.
 */
export const BUILT_IN_TWITCH_CLIENT_ID = 'tyzv1eylpzq8z5mz3c2b8yez0beui0'
