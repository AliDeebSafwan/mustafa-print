import { useTranslation } from 'react-i18next'
import type { ContentError } from '../../content'

/** One sentence for everything the website editor can run into. */
export function ContentErrorMessage({ error }: { error: ContentError | null }) {
  const { t } = useTranslation()
  if (!error) return null
  const detail = error.code === 'invalid_image' && error.detail ? t(`site.imageError.${error.detail}`, { defaultValue: '' }) : ''
  return <p role="alert" className="border-s-4 border-magenta bg-tint p-3 text-sm font-semibold">{detail || t(`site.error.${error.code}`, { defaultValue: t('site.error.server') })}</p>
}
