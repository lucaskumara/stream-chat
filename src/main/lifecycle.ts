/**
 * Swallows an error from a teardown step.
 *
 * Disconnecting a socket or deleting a remote subscription can fail because the
 * thing is already gone, which is exactly the outcome we wanted. The failure is
 * logged rather than silently dropped, and this is named so the intent reads as
 * deliberate instead of looking like a forgotten catch.
 */
export function ignoreTeardownFailure(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.debug(`[teardown] ${context} failed (already gone?):`, error)
  }
}
