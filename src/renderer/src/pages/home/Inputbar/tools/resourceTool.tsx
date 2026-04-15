import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import ResourceButton from './components/ResourceButton'
import ResourceQuickPanelManager from './components/ResourceQuickPanelManager'

/**
 * Resource Tool
 *
 * Allows users to search files from accessible paths.
 * Uses @ trigger (same symbol as MentionModels, but different scope).
 */
const resourceTool = defineTool({
  key: 'resource_panel',
  label: (t) => t('chat.input.resource_panel.title'),
  visibleInScopes: [TopicType.Session],

  dependencies: {
    state: [] as const,
    actions: ['onTextChange'] as const
  },

  render: function ResourceToolRender(context) {
    const { quickPanel, quickPanelController, actions, session } = context
    const { onTextChange } = actions

    // Get accessible paths from session data
    const accessiblePaths = session?.accessiblePaths ?? []

    if (accessiblePaths.length === 0) {
      return null
    }

    return (
      <ResourceButton
        quickPanel={quickPanel}
        quickPanelController={quickPanelController}
        accessiblePaths={accessiblePaths}
        setText={onTextChange as React.Dispatch<React.SetStateAction<string>>}
      />
    )
  },

  quickPanelManager: ResourceQuickPanelManager
})

registerTool(resourceTool)

export default resourceTool
