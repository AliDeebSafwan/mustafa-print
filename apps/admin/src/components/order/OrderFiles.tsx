import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentErrorMessage } from '../site/ContentErrorMessage'
import { ordersApi, type OrderFile } from '../../content'
import { useResource } from '../../content/use-resource'

const KIND_ICON: Record<string, string> = { pdf: '📄', jpg: '🖼️', png: '🖼️', tiff: '🖼️', psd: '🎨', zip: '🗜️' }
const formatSize = (bytes: string) => `${(Number(bytes) / (1024 * 1024)).toFixed(1)} ${'MB'}`

/** The design files a customer attached to a web order. Downloads, never shown inline. */
export function OrderFiles({ orderId }: { orderId: string }) {
  const { t } = useTranslation()
  const load = useCallback(() => ordersApi.files(orderId), [orderId])
  const { data, error } = useResource<OrderFile[]>(load)

  async function download(fileId: string, name: string) {
    const url = await ordersApi.fileUrl(orderId, fileId)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  if (error) return <ContentErrorMessage error={error} />
  if (!data || data.length === 0) return null
  return (
    <div>
      <h2 className="mb-2 font-bold">{t('order.files.title')}</h2>
      <ul className="divide-y divide-rule border-y border-rule">
        {data.map((file) => (
          <li key={file.id}>
            <button type="button" className="flex w-full items-center gap-3 py-2.5 text-start" onClick={() => void download(file.id, file.original_name)}>
              <span className="text-xl" aria-hidden>{KIND_ICON[file.kind] ?? '📎'}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{file.original_name}</span>
              <span className="shrink-0 text-xs text-muted" dir="ltr">{formatSize(file.bytes)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
