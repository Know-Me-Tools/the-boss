/**
 * designOrchestrator.default.ts — default-wired convenience entry point
 *
 * This file is intentionally SEPARATE from the core designOrchestrator.ts so
 * the core module stays free of any @renderer/services or window.* references
 * and remains fully unit-testable with injected mocks.
 *
 * Only this thin wrapper imports real renderer services, and it does so LAZILY
 * inside the function body to avoid module-scope side effects.
 *
 * NOT unit-tested (wiring only). Integration/E2E tests cover the live path.
 */

import type { RunDesignTurnInput, RunDesignTurnResult } from './designOrchestrator'
import { runDesignTurn } from './designOrchestrator'

/**
 * runDesignTurnDefault — convenience wrapper that injects the real renderer
 * services at call time.
 *
 * - `fetchGenerate` from @renderer/services/ApiService is imported lazily so
 *   the module graph stays clean for test environments that lack the service.
 * - `window.api.artifacts.compileReact` is accessed lazily inside the function
 *   body, avoiding any window reference at module scope.
 */
export async function runDesignTurnDefault(
  input: Omit<RunDesignTurnInput, 'state'> & { state: RunDesignTurnInput['state'] }
): Promise<RunDesignTurnResult> {
  // Lazy import — only resolved at call time, not at module parse time.
  // This keeps the core module pure and avoids pulling in ApiService in tests.
  const { fetchGenerate } = await import('@renderer/services/ApiService')

  return runDesignTurn(input, {
    generate: async ({ prompt, content }) => {
      const response = await fetchGenerate({ prompt, content })
      // fetchGenerate returns '' on a missing/uncfgured model or API key
      // (it swallows the error). Surface an actionable message instead of the
      // orchestrator's generic "Model returned empty response".
      if (response === '') {
        throw new Error(
          'No response from the model — check that a default model and its API key are configured.'
        )
      }
      return response
    },
    // window.api is only referenced at call time, never at module scope.
    // The injected CompileReactFn only supplies { source, title? }; the IPC
    // request type requires the CSS fields too (they have schema defaults but
    // are not optional at the TS layer), so we fill them with empty strings.
    compileReact: (request) =>
      window.api.artifacts.compileReact({
        source: request.source,
        title: request.title ?? 'React Artifact',
        baseCss: '',
        themeCss: '',
        customCss: ''
      })
  })
}
