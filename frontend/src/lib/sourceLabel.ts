export function deriveSourceLabel(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null

  try {
    const parsed = sourceUrl.includes('://') ? new URL(sourceUrl) : new URL(`https://${sourceUrl}`)
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname) return null

    const parts = hostname.split('.').filter(Boolean)
    let base = hostname

    if (parts.length >= 3 && parts[parts.length - 2] === 'gov' && parts[parts.length - 1] === 'np') {
      base = parts[0]
    } else if (parts.length >= 2) {
      base = parts[parts.length - 2]
      if (['co', 'com', 'org', 'net'].includes(base) && parts.length >= 3) {
        base = parts[parts.length - 3]
      }
    }

    return base
      .split(/[-_]/g)
      .filter(Boolean)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ')
  } catch {
    return null
  }
}
