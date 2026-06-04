import type { SidebarIcon } from '@renderer/types'

/**
 * 默认显示的侧边栏图标
 * 这些图标会在侧边栏中默认显示
 */
export const DEFAULT_SIDEBAR_ICONS: SidebarIcon[] = [
  'assistants',
  'agents',
  'artifacts',
  'store',
  'paintings',
  'translate',
  'minapp',
  'knowledge',
  'files',
  'code_tools',
  'notes',
  'openclaw'
]

/**
 * 必须显示的侧边栏图标（不能被隐藏）
 * 这些图标必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_ICONS: SidebarIcon[] = ['assistants']

export function backfillArtifactsSidebarIcon(sidebarIcons: { visible?: string[]; disabled?: string[] } | undefined) {
  if (!sidebarIcons?.visible || !Array.isArray(sidebarIcons.visible)) {
    return
  }

  const disabled = Array.isArray(sidebarIcons.disabled) ? sidebarIcons.disabled : []
  const hasArtifacts = sidebarIcons.visible.includes('artifacts') || disabled.includes('artifacts')

  if (hasArtifacts) {
    return
  }

  const anchors = ['minapp', 'files', 'notes']
  const anchorIndex = anchors.map((anchor) => sidebarIcons.visible!.indexOf(anchor)).find((index) => index !== -1)

  if (anchorIndex !== undefined && anchorIndex !== -1) {
    sidebarIcons.visible.splice(anchorIndex + 1, 0, 'artifacts')
    return
  }

  sidebarIcons.visible.push('artifacts')
}
