export function hasValidLocationCoordinate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  const lat = Number(raw.lat)
  const lng = Number(raw.lng)
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

export function isRequiredLocationComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  const text = String(raw.address || raw.name || '').trim()
  return Boolean(text) && hasValidLocationCoordinate(value)
}
