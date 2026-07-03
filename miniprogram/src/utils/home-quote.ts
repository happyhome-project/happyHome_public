export function formatHomeQuoteCite(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.includes('《') || text.includes('》')) return text
  return `《${text}》`
}
