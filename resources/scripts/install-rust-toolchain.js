#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`)
  }
}

function has(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return result.status === 0
}

const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo')
const cargoBin = path.join(cargoHome, 'bin')
const env = {
  ...process.env,
  PATH: `${cargoBin}${path.delimiter}${process.env.PATH || ''}`
}

function hasWithEnv(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32', env })
  return result.status === 0
}

function rustTargetInstalled(target) {
  const result = spawnSync('rustup', ['target', 'list', '--installed'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env
  })
  return result.status === 0 && result.stdout.split(/\r?\n/).map((line) => line.trim()).includes(target)
}

if (!has('rustup') && !hasWithEnv('rustup')) {
  if (has('cargo') && has('rustc')) {
    throw new Error(
      'Rust and Cargo are already installed, but rustup is not available to add the wasm32-unknown-unknown target. Install rustup or add the wasm target with your Rust distribution, then rerun this action.'
    )
  }

  if (process.platform === 'win32') {
    throw new Error('Rust is not installed. Install rustup from https://rustup.rs, then rerun this action.')
  }
  run('sh', ['-c', 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y'])
}

if (!hasWithEnv('cargo') || !hasWithEnv('rustc')) {
  run('rustup', ['toolchain', 'install', 'stable'], { env })
  run('rustup', ['default', 'stable'], { env })
}

if (!rustTargetInstalled('wasm32-unknown-unknown')) {
  run('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { env })
}
