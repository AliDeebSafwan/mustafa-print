import { useCallback, useEffect, useState } from 'react'
import { ContentError } from './api'

interface State<T> { data: T | null; error: ContentError | null; loading: boolean }

const asError = (err: unknown) => (err instanceof ContentError ? err : new ContentError('server'))

/**
 * Loads something from the server for a screen, with the three states a screen must show: loading, failed, ready.
 * `reload` is what a screen calls after saving, so it always shows the server's version.
 * State only changes when an answer arrives, and an answer that arrives after the screen closed is ignored.
 */
export function useResource<T>(load: () => Promise<T>): State<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let current = true
    load().then(
      (data) => { if (current) setState({ data, error: null, loading: false }) },
      (err: unknown) => { if (current) setState((s) => ({ ...s, error: asError(err), loading: false })) },
    )
    return () => { current = false }
  }, [load])

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const data = await load()
      setState({ data, error: null, loading: false })
    } catch (err) {
      setState((s) => ({ ...s, error: asError(err), loading: false }))
    }
  }, [load])

  return { ...state, reload }
}
