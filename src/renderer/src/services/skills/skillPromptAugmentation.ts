import type { PreparedSkillContext } from './emitSkillChunks'

const SKILL_SYSTEM_OPEN = '<activated_skills>'
const SKILL_SYSTEM_CLOSE = '</activated_skills>'

export function appendSkillContextToSystemPrompt(
  basePrompt: string | undefined,
  preparedSkills: PreparedSkillContext[]
): string {
  if (preparedSkills.length === 0) {
    return basePrompt ?? ''
  }

  const skillSection = [
    SKILL_SYSTEM_OPEN,
    ...preparedSkills.map((skill) =>
      [`<skill id="${skill.skillId}" name="${escapeAttribute(skill.skillName)}">`, skill.content, '</skill>'].join('\n')
    ),
    SKILL_SYSTEM_CLOSE
  ].join('\n')

  return [basePrompt?.trim(), skillSection].filter(Boolean).join('\n\n')
}

function escapeAttribute(value: string): string {
  return value.replaceAll('"', '&quot;')
}
