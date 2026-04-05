export async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: unknown }>,
  maxRetries = 2,
  baseDelayMs = 1000
): Promise<{ data: T | null; error: unknown }> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn()
    if (!result.error) return result
    lastError = result.error
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * (attempt + 1)))
    }
  }
  return { data: null, error: lastError }
}
