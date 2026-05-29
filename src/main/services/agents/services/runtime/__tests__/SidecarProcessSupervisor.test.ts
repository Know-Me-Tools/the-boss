import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SidecarProcessSupervisor, STDERR_RING_SIZE } from '../SidecarProcessSupervisor'

function createChildProcess(pid = 4242): any {
  const child = new EventEmitter() as any
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    queueMicrotask(() => child.emit('exit', 0, null))
    return true
  })
  return child
}

describe('SidecarProcessSupervisor', () => {
  let supervisor: SidecarProcessSupervisor

  beforeEach(() => {
    supervisor = new SidecarProcessSupervisor()
  })

  it('tracks a spawned sidecar with running status', () => {
    const child = createChildProcess(1234)
    const startedBefore = Date.now()

    const handle = supervisor.spawn({
      name: 'uar',
      spawn: () => child,
      binaryPath: '/opt/bin/uar'
    })

    expect(handle.process).toBe(child)

    const list = supervisor.list()
    expect(list).toHaveLength(1)

    const status = list[0]
    expect(status.id).toBe('uar:default')
    expect(status.name).toBe('uar')
    expect(status.state).toBe('running')
    expect(status.pid).toBe(1234)
    expect(status.binaryPath).toBe('/opt/bin/uar')
    expect(status.restartCount).toBe(0)
    expect(typeof status.startedAt).toBe('number')
    expect(status.startedAt).toBeGreaterThanOrEqual(startedBefore)
    expect(status.recentStderr).toEqual([])
  })

  it('captures stderr into a ring buffer capped at STDERR_RING_SIZE', () => {
    const child = createChildProcess()
    const handle = supervisor.spawn({
      name: 'uar',
      spawn: () => child,
      binaryPath: '/opt/bin/uar'
    })

    for (let i = 0; i < 60; i++) {
      child.stderr.emit('data', Buffer.from(`line ${i}\n`))
    }

    const { recentStderr } = handle.status()
    expect(recentStderr).toHaveLength(STDERR_RING_SIZE)
    // Kept the most recent lines (10..59), dropped the oldest (0..9).
    expect(recentStderr[0]).toBe('line 10')
    expect(recentStderr[recentStderr.length - 1]).toBe('line 59')
  })

  it('returns status by id and undefined for unknown ids', () => {
    const child = createChildProcess()
    supervisor.spawn({
      name: 'opencode',
      key: 'session-1',
      spawn: () => child,
      binaryPath: '/opt/bin/opencode'
    })

    const status = supervisor.get('opencode:session-1')
    expect(status).toBeDefined()
    expect(status?.name).toBe('opencode')
    expect(status?.key).toBe('session-1')

    expect(supervisor.get('nope')).toBeUndefined()
  })

  it('marks state stopped and fires onExit when the child exits', async () => {
    const child = createChildProcess()
    const onExit = vi.fn()

    const handle = supervisor.spawn({
      name: 'uar',
      spawn: () => child,
      binaryPath: '/opt/bin/uar',
      onExit
    })

    child.emit('exit', 137, 'SIGKILL')

    expect(onExit).toHaveBeenCalledWith(137, 'SIGKILL')
    expect(handle.status().state).toBe('stopped')
  })
})
