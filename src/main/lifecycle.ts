export function ignoreTeardownFailure(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.debug(`[teardown] ${context} failed (already gone?):`, error)
  }
}
