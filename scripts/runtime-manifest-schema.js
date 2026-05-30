// Zod schema for the managed runtime binary manifest.
//
// This schema is the single source of truth for manifest shape at build time.
// It is intentionally compatible with the consumer-side TypeScript interfaces in
// src/main/services/agents/services/runtime/ManagedBinaryService.ts
// (ManagedBinaryManifest / ManagedBinaryManifestEntry / ManagedBinarySignatureFields):
// every field the consumer reads is accepted here, plus the new optional
// release-matrix fields (archive metadata + signing/notarization). All new fields
// are optional so older minimal manifests remain valid.
const { z } = require('zod')

const SHA256_HEX = /^[a-f0-9]{64}$/

const sha256Schema = z.string().regex(SHA256_HEX, 'must be a 64-character lowercase hex sha256')
const positiveIntSchema = z.number().int().positive()

// Mirrors ManagedBinarySignatureFields; passthrough keeps forward-compatibility
// with additional signature material the consumer may not yet model.
const signaturesSchema = z
  .object({
    minisign: z.string().optional(),
    cosignBundle: z.string().optional(),
    certificateSha256: z.string().optional()
  })
  .passthrough()

const notarizationSchema = z.object({
  notarized: z.boolean(),
  ticketId: z.string().optional()
})

/**
 * Per-platform binary entry. Required fields match the consumer's minimum
 * (platform, binaryName, size, sha256); everything else is optional.
 */
const manifestEntrySchema = z.object({
  platform: z.string().min(1),
  binaryName: z.string().min(1),
  size: positiveIntSchema,
  maxSize: positiveIntSchema.optional(),
  sha256: sha256Schema,
  httpsUrl: z.string().url().optional(),
  ipfsCid: z.string().optional(),
  ipfsPath: z.string().optional(),
  archiveName: z.string().optional(),
  archiveSha256: sha256Schema.optional(),
  archiveSize: positiveIntSchema.optional(),
  archiveFormat: z.enum(['tar.zst', 'zip']).optional(),
  signingIdentity: z.string().optional(),
  teamId: z.string().optional(),
  notarization: notarizationSchema.optional(),
  signatures: signaturesSchema.optional()
})

/**
 * Per-runtime manifest. supportedPlatforms is optional in the consumer type but
 * the builder always emits it; binaries must contain at least one entry.
 */
const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  sourceCommit: z.string().optional(),
  supportedPlatforms: z.array(z.string()).optional(),
  binaries: z.array(manifestEntrySchema).min(1, 'manifest must contain at least one binary')
})

/**
 * @param {unknown} obj
 * @returns {z.infer<typeof manifestSchema>}
 */
function validateManifest(obj) {
  const result = manifestSchema.safeParse(obj)
  if (!result.success) {
    throw new Error(`Invalid runtime manifest:\n${formatIssues(result.error)}`)
  }
  return result.data
}

/**
 * @param {unknown} obj
 * @returns {z.infer<typeof manifestEntrySchema>}
 */
function validateManifestEntry(obj) {
  const result = manifestEntrySchema.safeParse(obj)
  if (!result.success) {
    throw new Error(`Invalid runtime manifest entry:\n${formatIssues(result.error)}`)
  }
  return result.data
}

/**
 * @param {import('zod').ZodError} error
 * @returns {string}
 */
function formatIssues(error) {
  return error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n')
}

module.exports = {
  manifestEntrySchema,
  manifestSchema,
  validateManifest,
  validateManifestEntry
}
