import type { MediaRow } from '../../content'
import { API_URL } from '../../lib/config'

/** Shows an uploaded picture at the smallest size that looks sharp in its box. */
export function Picture({ media, className = '', sizes = '200px' }: { media: Pick<MediaRow, 'srcset' | 'alt_ar' | 'width' | 'height'>; className?: string; sizes?: string }) {
  const srcset = media.srcset.map((v) => `${API_URL}${v.src} ${v.width}w`).join(', ')
  const smallest = media.srcset[0]
  if (!smallest) return null
  return <img className={className} src={`${API_URL}${smallest.src}`} srcSet={srcset} sizes={sizes} width={media.width} height={media.height} alt={media.alt_ar ?? ''} loading="lazy" />
}
