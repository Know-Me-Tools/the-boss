import SkillSettings from '@renderer/pages/settings/SkillSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/skill')({
  component: SkillSettings
})
