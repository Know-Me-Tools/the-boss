export interface SkillActivatedStreamPayload {
  skillId: string
  skillName: string
  triggerTokens: string[]
  selectionReason: string
  activationMethod: string
  similarityScore?: number
  matchedKeywords?: string[]
  contextManagementMethod: string
  content: string
  originalTokenCount: number
  managedTokenCount: number
  tokensSaved: number
  truncated: boolean
}

export interface SkillContentDeltaStreamPayload {
  skillId: string
  delta: string
}

export interface SkillCompleteStreamPayload {
  skillId: string
  finalTokenCount: number
}
