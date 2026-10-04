'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiResult } from '@/contracts/common'
import { request, readOperation, type Command } from '@/components/api'

export function useMutationOperation<T>() {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'reconciling'>('idle')
  const active = useRef<{ command: Command<T>; key: string; operationId?: string } | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const transmit = useCallback(async (): Promise<ApiResult<T> | null> => {
    if (!active.current || busy.current) return null
    busy.current = true; setPhase('submitting')
    const { command, key } = active.current
    const result = await request(command.method, command.url, command.schema, command.payload, key)
    busy.current = false
    if (!mounted.current) return null
    if (!result.ok && result.meta.outcome !== 'not_applied') {
      active.current.operationId = result.meta.operationId; setPhase('reconciling')
    } else { active.current = null; setPhase('idle') }
    return result
  }, [])
  const run = useCallback(async (command: Command<T>) => {
    if (active.current || busy.current) return null
    active.current = { command: { ...command, payload: structuredClone(command.payload) }, key: crypto.randomUUID() }
    return transmit()
  }, [transmit])
  const recover = useCallback(async (): Promise<ApiResult<T> | null> => {
    if (!active.current || busy.current) return null
    busy.current = true; setPhase('submitting')
    const { command, key, operationId } = active.current
    const status = await readOperation(command.kind, key, operationId)
    busy.current = false
    if (!mounted.current) return null
    if (status.ok && status.data.state === 'running') { setPhase('reconciling'); return null }
    if (!status.ok && status.error.code !== 'not_found') { setPhase('reconciling'); return status }
    // A replay retrieves the operation's original result, never the latest resource as proof.
    // not_found and interrupted also use precisely the same frozen command and key.
    return transmit()
  }, [transmit])
  return { phase, run, recover, pending: phase !== 'idle' }
}
