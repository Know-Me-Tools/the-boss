import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CPU_WARN_PERCENT,
  IDLE_SHUTDOWN_MS,
  KILL_ESCALATION_MS,
  RESOURCE_SAMPLE_MS,
  RESTART_BACKOFF_MS,
  RESTART_WINDOW_MS,
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

  it('marks state stopped and fires onExit on an intentional stop', async () => {
    const child = createChildProcess()
    const onExit = vi.fn()
    const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill: vi.fn() })

    const handle = supervisor2.spawn({
      name: 'uar',
      spawn: () => asChildProcess(child),
      binaryPath: '/opt/bin/uar',
      onExit
    })

    // Operator-initiated stop is terminal: onExit fires once and the entry
    // settles to 'stopped' without being restarted.
    const stopped = supervisor2.stop(handle.id)
    await Promise.resolve()
    child.emit('exit', 137, 'SIGKILL')
    await stopped

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

    it('drops a sample that resolves after the child has exited (no warn, no write)', async () => {
      vi.useFakeTimers()
      const warnSpy = vi.spyOn(loggerService, 'warn').mockImplementation(() => undefined)
      // Manually-resolved pidusage so we can interleave the exit between the
      // sample starting and its promise resolving. The sample reports high CPU,
      // so without the post-await stopped guard this would emit a warning.
      let resolvePidusage: ((sample: { cpu: number; memory: number }) => void) | undefined
      const pidusage = vi.fn().mockImplementation(
        () =>
          new Promise<{ cpu: number; memory: number }>((resolve) => {
            resolvePidusage = resolve
          })
      )
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      const handle = sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      // Fire the interval so a sample starts; its promise stays pending.
      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)
      expect(pidusage).toHaveBeenCalledWith(1234)
      expect(resolvePidusage).toBeDefined()

      // Operator stops the sidecar (terminal) while the sample is in flight.
      const stopped = sampler.stop(handle.id)
      await Promise.resolve()
      child.emit('exit', 0, null)
      await stopped
      expect(handle.status().state).toBe('stopped')

      // Now resolve the in-flight sample and flush microtasks.
      resolvePidusage?.({ cpu: CPU_WARN_PERCENT, memory: RSS_WARN_BYTES })
      await vi.runAllTicks()
      await Promise.resolve()

      const status = handle.status()
      expect(status.state).toBe('stopped')
      expect(status.cpuPercent).toBeUndefined()
      expect(status.rssBytes).toBeUndefined()
      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('stops sampling once the child exits', async () => {
      vi.useFakeTimers()
      const pidusage = vi.fn().mockResolvedValue({ cpu: 1, memory: 1000 })
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })
      const child = createChildProcess(1234)

      const handle = sampler.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)
      const callsBeforeExit = pidusage.mock.calls.length
      expect(callsBeforeExit).toBeGreaterThan(0)

      // Terminal (operator-initiated) exit: the sampler must be torn down and
      // not respawned, so no further pidusage calls occur.
      const stopped = sampler.stop(handle.id)
      await Promise.resolve()
      child.emit('exit', 0, null)
      await stopped

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS * 3)
      expect(pidusage.mock.calls.length).toBe(callsBeforeExit)
    })
  })

  describe('stop and kill', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('stop sends SIGTERM and resolves on exit without escalating to SIGKILL', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      const stopped = supervisor2.stop(handle.id)
      await Promise.resolve()

      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGTERM')

      // Child exits before the escalation timeout fires.
      child.emit('exit', 0, null)
      await stopped

      expect(treeKill).not.toHaveBeenCalledWith(1234, 'SIGKILL')
      expect(treeKill).toHaveBeenCalledTimes(1)
      expect(supervisor2.get(handle.id)?.state).toBe('stopped')
    })

    it('stop escalates to SIGKILL when the child does not exit in time', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      const stopped = supervisor2.stop(handle.id)
      await Promise.resolve()
      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGTERM')

      // Process never emits 'exit'; advancing past the escalation window escalates.
      await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS)
      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGKILL')

      await stopped
    })

    it('kill sends SIGKILL immediately without SIGTERM', async () => {
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await supervisor2.kill(handle.id)

      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGKILL')
      expect(treeKill).not.toHaveBeenCalledWith(1234, 'SIGTERM')
      expect(treeKill).toHaveBeenCalledTimes(1)
    })

    it('stop and kill are no-ops for unknown ids', async () => {
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })

      await expect(supervisor2.stop('nope')).resolves.toBeUndefined()
      await expect(supervisor2.kill('nope')).resolves.toBeUndefined()
      expect(treeKill).not.toHaveBeenCalled()
    })

    it('concurrent stop() sends a single SIGTERM and leaks no escalation timer', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      // Two concurrent stop() calls without awaiting between them. The second
      // must short-circuit on state === 'stopping' so we get exactly one
      // SIGTERM, one 'exit' listener, and one escalation timer.
      const p1 = supervisor2.stop(handle.id)
      const p2 = supervisor2.stop(handle.id)
      await Promise.resolve()

      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGTERM')
      expect(treeKill).toHaveBeenCalledTimes(1)

      // Real exit resolves both pending stop() promises.
      child.emit('exit', 0, null)
      await Promise.all([p1, p2])

      // No leaked timer: advancing past the escalation window must not SIGKILL.
      await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS * 2)
      expect(treeKill).not.toHaveBeenCalledWith(1234, 'SIGKILL')
      expect(treeKill).toHaveBeenCalledTimes(1)
      expect(supervisor2.get(handle.id)?.state).toBe('stopped')
    })

    it('stop on a pidless entry settles in the terminal failed state', async () => {
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)
      // Simulate a child that never received an OS pid.
      ;(child as { pid: number | undefined }).pid = undefined

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      await supervisor2.stop(handle.id)

      expect(treeKill).not.toHaveBeenCalled()
      expect(supervisor2.get(handle.id)?.state).toBe('failed')

      // Subsequent stop/kill are clean no-ops now that the entry is terminal.
      await supervisor2.stop(handle.id)
      await supervisor2.kill(handle.id)
      expect(treeKill).not.toHaveBeenCalled()
    })

    it('stop and kill are no-ops once the child has already exited', async () => {
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      // Drive a terminal (operator-initiated) exit: exactly one SIGTERM.
      const stopped = supervisor2.stop(handle.id)
      await Promise.resolve()
      child.emit('exit', 0, null)
      await stopped
      expect(supervisor2.get(handle.id)?.state).toBe('stopped')

      const callsAfterStop = treeKill.mock.calls.length
      // Subsequent stop/kill are clean no-ops on the terminal entry.
      await supervisor2.stop(handle.id)
      await supervisor2.kill(handle.id)
      expect(treeKill.mock.calls.length).toBe(callsAfterStop)
    })
  })

  describe('idle shutdown', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('stops the sidecar after IDLE_SHUTDOWN_MS once marked idle', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      supervisor2.markIdle(handle.id)
      await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS)

      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGTERM')
    })

    it('markActive cancels a pending idle shutdown', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      supervisor2.markIdle(handle.id)
      // Becomes active again before the idle window elapses.
      await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS / 2)
      supervisor2.markActive(handle.id)
      await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS)

      expect(treeKill).not.toHaveBeenCalled()
      expect(supervisor2.get(handle.id)?.state).toBe('running')
    })

    it('markActive then markIdle re-arms a fresh idle timer', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const child = createChildProcess(1234)

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(child),
        binaryPath: '/opt/bin/uar'
      })

      supervisor2.markIdle(handle.id)
      await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS / 2)
      // Reset: active then idle re-arms a fresh full window.
      supervisor2.markActive(handle.id)
      supervisor2.markIdle(handle.id)
      // Advancing the remaining half of the original window must NOT fire.
      await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS / 2)
      expect(treeKill).not.toHaveBeenCalled()

      // Advancing the rest of the fresh window fires the shutdown.
      await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS / 2)
      expect(treeKill).toHaveBeenCalledWith(1234, 'SIGTERM')
    })
  })

  describe('restart budget and backoff', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('restarts a sidecar after backoff on an unexpected exit', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const spawnThunk = vi.fn(() => asChildProcess(createChildProcess()))
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: spawnThunk,
        binaryPath: '/opt/bin/uar'
      })

      expect(spawnThunk).toHaveBeenCalledTimes(1)

      // Unexpected exit (no stop/kill); supervisor should schedule a restart.
      handle.process.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0])

      expect(spawnThunk).toHaveBeenCalledTimes(2)
      expect(supervisor2.list()).toHaveLength(1)
      const status = supervisor2.get(handle.id)
      expect(status?.restartCount).toBe(1)
      expect(status?.state).toBe('running')
    })

    it('marks failed and stops restarting once the budget is exceeded', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const children: FakeChildProcess[] = []
      const spawnThunk = vi.fn(() => {
        const c = createChildProcess()
        children.push(c)
        return asChildProcess(c)
      })
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: spawnThunk,
        binaryPath: '/opt/bin/uar'
      })

      // 4 unexpected exits within the window. The first 3 restart (budget = 3),
      // the 4th exceeds the budget and must NOT restart.
      // Crash 1 -> restart 1 (backoff[0])
      children[0].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0])
      expect(spawnThunk).toHaveBeenCalledTimes(2)

      // Crash 2 -> restart 2 (backoff[1])
      children[1].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[1])
      expect(spawnThunk).toHaveBeenCalledTimes(3)

      // Crash 3 -> restart 3 (backoff[2])
      children[2].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[2])
      expect(spawnThunk).toHaveBeenCalledTimes(4)

      // Crash 4 -> exceeds budget, no further restart.
      children[3].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[2])
      expect(spawnThunk).toHaveBeenCalledTimes(4)
      expect(supervisor2.get(handle.id)?.state).toBe('failed')
    })

    it('stop() during the restart-backoff window settles terminally without hanging', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const spawnThunk = vi.fn(() => asChildProcess(createChildProcess(1234)))
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: spawnThunk,
        binaryPath: '/opt/bin/uar'
      })

      // Crash: the old child's 'exit' is consumed and a restart is pending.
      handle.process.emit('exit', 1, null)
      expect(supervisor2.get(handle.id)?.state).toBe('restarting')

      // Stop during the backoff window must resolve promptly (no SIGTERM/once
      // 'exit' on the dead child, so no 3s escalation hang) and cancel the restart.
      const p = supervisor2.stop(handle.id)
      await p

      // No signal was sent to the dead pid on this path.
      expect(treeKill).not.toHaveBeenCalled()

      // Terminal and stable: the restart never fires.
      expect(supervisor2.get(handle.id)?.state).toBe('failed')
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1] * 4)
      expect(spawnThunk).toHaveBeenCalledTimes(1)
      expect(supervisor2.get(handle.id)?.state).toBe('failed')
    })

    it('prunes stale restart timestamps so the budget window slides', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const children: FakeChildProcess[] = []
      const spawnThunk = vi.fn(() => {
        const c = createChildProcess()
        children.push(c)
        return asChildProcess(c)
      })
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: spawnThunk,
        binaryPath: '/opt/bin/uar'
      })

      // Exhaust the full budget (3 restarts) rapidly.
      children[0].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0])
      children[1].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[1])
      children[2].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[2])
      expect(spawnThunk).toHaveBeenCalledTimes(4)
      expect(supervisor2.get(handle.id)?.state).toBe('running')

      // Let the sliding window fully elapse so the prior timestamps age out.
      await vi.advanceTimersByTimeAsync(RESTART_WINDOW_MS + 1000)

      // A fresh crash must restart (timestamps pruned) rather than fail.
      children[3].emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1])
      expect(spawnThunk).toHaveBeenCalledTimes(5)
      expect(supervisor2.get(handle.id)?.state).toBe('running')
    })

    it('drops a stale sample from the old child after a crash restart (no warn, no write)', async () => {
      vi.useFakeTimers()
      const warnSpy = vi.spyOn(loggerService, 'warn').mockImplementation(() => undefined)
      // Manually-resolved pidusage so we can interleave a crash restart between
      // the sample starting and its promise resolving with stale high values.
      let resolvePidusage: ((sample: { cpu: number; memory: number }) => void) | undefined
      const pidusage = vi.fn().mockImplementation(
        () =>
          new Promise<{ cpu: number; memory: number }>((resolve) => {
            resolvePidusage = resolve
          })
      )
      const oldChild = createChildProcess(1111)
      const newChild = createChildProcess(2222)
      const children = [oldChild, newChild]
      let spawnCount = 0
      const spawnThunk = vi.fn(() => asChildProcess(children[spawnCount++]))
      const sampler = new SidecarProcessSupervisor({ pidusage, treeKill: vi.fn() })

      const handle = sampler.spawn({
        name: 'uar',
        spawn: spawnThunk,
        binaryPath: '/opt/bin/uar'
      })

      // Start a sample against the OLD child (pid 1111); its promise stays pending.
      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_MS)
      expect(pidusage).toHaveBeenCalledWith(1111)
      expect(resolvePidusage).toBeDefined()

      // Crash the old child so a restart swaps in the new child (pid 2222).
      oldChild.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0])
      expect(handle.process.pid).toBe(2222)
      expect(sampler.get(handle.id)?.state).toBe('running')

      // Resolve the stale OLD sample with high cpu/mem; it must be discarded.
      resolvePidusage?.({ cpu: CPU_WARN_PERCENT, memory: RSS_WARN_BYTES })
      await vi.runAllTicks()
      await Promise.resolve()

      const status = sampler.get(handle.id)
      expect(status?.cpuPercent).toBeUndefined()
      expect(status?.rssBytes).toBeUndefined()
      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('does not restart after an intentional stop()', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const spawnThunk = vi.fn(() => asChildProcess(createChildProcess()))
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })

      const handle = supervisor2.spawn({
        name: 'uar',
        spawn: spawnThunk,
        binaryPath: '/opt/bin/uar'
      })

      const stopped = supervisor2.stop(handle.id)
      await Promise.resolve()
      // Simulate the OS reporting the process exit after SIGTERM.
      handle.process.emit('exit', 0, 'SIGTERM')
      await stopped

      // Advance well past every backoff window: nothing should respawn.
      await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1] * 4)
      expect(spawnThunk).toHaveBeenCalledTimes(1)
      expect(supervisor2.get(handle.id)?.state).toBe('stopped')
    })
  })

  describe('shutdownAll', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('gracefully stops every live entry and resolves once all settle', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const childA = createChildProcess(111)
      const childB = createChildProcess(222)

      supervisor2.spawn({ name: 'uar', spawn: () => asChildProcess(childA), binaryPath: '/opt/bin/uar' })
      supervisor2.spawn({ name: 'opencode', spawn: () => asChildProcess(childB), binaryPath: '/opt/bin/opencode' })

      const done = supervisor2.shutdownAll()
      await Promise.resolve()

      // Each live entry was SIGTERM'd via the graceful stop() path.
      expect(treeKill).toHaveBeenCalledWith(111, 'SIGTERM')
      expect(treeKill).toHaveBeenCalledWith(222, 'SIGTERM')

      // Drive both children's exits so the graceful stops resolve.
      childA.emit('exit', 0, null)
      childB.emit('exit', 0, null)

      await expect(done).resolves.toBeUndefined()

      const states = supervisor2.list().map((s) => s.state)
      expect(states).toEqual(['stopped', 'stopped'])
    })

    it('resolves without throwing when there are zero entries', async () => {
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill: vi.fn() })
      await expect(supervisor2.shutdownAll()).resolves.toBeUndefined()
    })

    it('only stops live entries and still resolves with a mix of terminal ones', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const liveChild = createChildProcess(111)
      const deadChild = createChildProcess(222)

      const liveHandle = supervisor2.spawn({
        name: 'uar',
        spawn: () => asChildProcess(liveChild),
        binaryPath: '/opt/bin/uar'
      })
      const deadHandle = supervisor2.spawn({
        name: 'opencode',
        spawn: () => asChildProcess(deadChild),
        binaryPath: '/opt/bin/opencode'
      })

      // Pre-stop the second entry so it is already terminal before shutdownAll.
      const preStopped = supervisor2.stop(deadHandle.id)
      await Promise.resolve()
      deadChild.emit('exit', 0, null)
      await preStopped
      expect(supervisor2.get(deadHandle.id)?.state).toBe('stopped')

      const sigtermsBefore = treeKill.mock.calls.length

      const done = supervisor2.shutdownAll()
      await Promise.resolve()

      // Only the live entry receives a fresh SIGTERM; the terminal one is a no-op.
      expect(treeKill).toHaveBeenCalledWith(111, 'SIGTERM')
      expect(treeKill.mock.calls.length).toBe(sigtermsBefore + 1)

      liveChild.emit('exit', 0, null)
      await expect(done).resolves.toBeUndefined()
      expect(supervisor2.get(liveHandle.id)?.state).toBe('stopped')
    })

    it('resolves even when an entry must escalate to SIGKILL', async () => {
      vi.useFakeTimers()
      const treeKill = vi.fn()
      const supervisor2 = new SidecarProcessSupervisor({ pidusage: vi.fn(), treeKill })
      const stubborn = createChildProcess(999)

      supervisor2.spawn({ name: 'uar', spawn: () => asChildProcess(stubborn), binaryPath: '/opt/bin/uar' })

      const done = supervisor2.shutdownAll()
      await Promise.resolve()
      expect(treeKill).toHaveBeenCalledWith(999, 'SIGTERM')

      // The child never emits 'exit'; advancing past the escalation window
      // forces SIGKILL and lets the graceful stop resolve.
      await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS)
      expect(treeKill).toHaveBeenCalledWith(999, 'SIGKILL')

      await expect(done).resolves.toBeUndefined()
    })
  })
})
