import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(__dirname, '..', '..')

const productionRoots = ['src', 'packages', 'scripts', 'resources/scripts', 'electron-builder.yml', 'package.json']

const ignoredPathFragments = [
  'src/renderer/src/store/migrate.ts',
  '/__tests__/',
  '.test.',
  '.spec.',
  'docs/',
  'resources/skills/',
  'resources/licenses/'
]

const forbiddenPatterns = [
  /api\.cherry-ai\.com/i,
  /analytics\.cherry-ai\.com/i,
  /open\.cherryin\.(ai|net|cc|dev)/i,
  /gitcode\.com\/CherryHQ/i,
  /github\.com\/CherryHQ/i,
  /api\.github\.com\/repos\/CherryHQ/i,
  /api\.ipinfo\.io\/lite\/me/i
]

function collectFiles(target: string): string[] {
  const absoluteTarget = path.join(rootDir, target)

  if (!fs.existsSync(absoluteTarget)) {
    return []
  }

  const stat = fs.statSync(absoluteTarget)
  if (stat.isFile()) {
    return [absoluteTarget]
  }

  return fs.readdirSync(absoluteTarget).flatMap((entry) => {
    if (['node_modules', 'dist', 'out', 'vendor'].includes(entry)) {
      return []
    }

    return collectFiles(path.join(target, entry))
  })
}

describe('service independence guard', () => {
  it('keeps production code free of Cherry-owned service endpoints', () => {
    const findings = productionRoots
      .flatMap(collectFiles)
      .filter((file) => !ignoredPathFragments.some((fragment) => file.includes(fragment)))
      .flatMap((file) => {
        const content = fs.readFileSync(file, 'utf8')
        return forbiddenPatterns
          .filter((pattern) => pattern.test(content))
          .map((pattern) => `${path.relative(rootDir, file)} matches ${pattern}`)
      })

    expect(findings).toEqual([])
  })
})
