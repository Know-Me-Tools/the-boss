import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CPU_WARN_PERCENT,
  RESOURCE_SAMPLE_MS,
  RSS_WARN_BYTES,
  SidecarProcessSupervisor,
  STDERR_RING_SIZE
} from '../SidecarProcessSupervisor'

interface FakeChildProcess extends EventEmitter {
  pid: number
  stdout: EventEmitter
  stderr: EventEmitter
  killed: boolean
  kill: ReturnType<typeof vi.fn>
}

function createChildProcess(pid = 4242): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess
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

function asChildProcess(child: FakeChildProcess): ChildProcess {
  return child as unknown as ChildProcess
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
      spawn: () => asChildProcess(child),
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
      spawn: () => asChildProcess(child),
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
      spawn: () => asChildProcess(child),
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
      spawn: () => asChildProcess(child),
      binaryPath: '/opt/bin/uar',
      onExit
    })

    child.emit('exit', 137, 'SIGKILL')

    expect(onExit).toHaveBeenCalledWith(137, 'SIGKILL')
    expect(handle.status().state).toBe('stopped')
  })

  describe('resource sampling', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('samples cpu/rss on the configured interval and reflects it in status', async () => {
      vi.useFakeTimers()
      const pidusage = vi.fn().mockResolvedValue({ cpu: 12, memory: 1000 })
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      const handle = sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)

      expect(pidusage).toHaveBeenCalledWith(1234)
      const status = sampler.get(handle.id)
      expect(status?.cpuPercent).toBe(12)
      expect(status?.rssBytes).toBe(1000)
      expect(status?.state).toBe('running')
    })

    it('warns when cpu meets the threshold without changing state', async () => {
      vi.useFakeTimers()
      const warnSpy = vi.spyOn(loggerService, 'warn').mockImplementation(() => undefined)
      const pidusage = vi.fn().mockResolvedValue({ cpu: CPU_WARN_PERCENT, memory: 1000 })
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      const handle = sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)

      expect(warnSpy).toHaveBeenCalled()
      expect(sampler.get(handle.id)?.state).toBe('running')

      warnSpy.mockRestore()
    })

    it('warns when rss meets the threshold without changing state', async () => {
      vi.useFakeTimers()
      const warnSpy = vi.spyOn(loggerService, 'warn').mockImplementation(() => undefined)
      const pidusage = vi.fn().mockResolvedValue({ cpu: 1, memory: RSS_WARN_BYTES })
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      const handle = sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)

      expect(warnSpy).toHaveBeenCalled()
      expect(sampler.get(handle.id)?.state).toBe('running')

      warnSpy.mockRestore()
    })

    it('swallows pidusage rejections and leaves the entry unchanged', async () => {
      vi.useFakeTimers()
      const pidusage = vi.fn().mockRejectedValue(new Error('gone'))
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      const handle = sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await expect(vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)).resolves.not.toThrow()

      const status = sampler.get(handle.id)
      expect(status?.state).toBe('running')
      expect(status?.cpuPercent).toBeUndefined()
      expect(status?.rssBytes).toBeUndefined()
    })

    it('stops sampling once the child exits', async () => {
      vi.useFakeTimers()
      const pidusage = vi.fn().mockResolvedValue({ cpu: 1, memory: 1000 })
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)
      const callsBeforeExit = pidusage.mock.calls.length
      expect(callsBeforeExit).toBeGreaterThan(0)

      child.emit('exit', 0, null)

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS * 3)
      expect(pidusage.mock.calls.length).toBe(callsBeforeExit)
    })
  })
})
