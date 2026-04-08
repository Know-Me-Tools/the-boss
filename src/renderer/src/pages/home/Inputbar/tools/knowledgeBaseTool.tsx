import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { KnowledgeBase } from '@renderer/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/assistant'
import { useCallback } from 'react'

import KnowledgeBaseButton from './components/KnowledgeBaseButton'

/**
 * Knowledge Base Tool
 *
 * Allows users to select knowledge bases to provide context for their messages.
 * Only visible when knowledge base sidebar is enabled.
 */
const knowledgeBaseTool = defineTool({
  key: 'knowledge_base',
  label: (t) => t('chat.input.knowledge_base'),
  // ✅ 移除 icon 属性，不在 ToolDefinition 类型中
  // icon: FileSearch,

  visibleInScopes: [TopicType.Chat, TopicType.Session],
  condition: ({ assistant, scope }) =>
    scope === TopicType.Session || isSupportedToolUse(assistant) || isPromptToolUse(assistant),

  dependencies: {
    state: ['selectedKnowledgeBases', 'files'] as const,
    actions: ['setSelectedKnowledgeBases'] as const
  },

  render: function KnowledgeBaseToolRender(context) {
    const { assistant, state, actions, quickPanel } = context

    const { updateAssistant } = useAssistant(assistant.id)
    const { updateSession } = useUpdateSession(context.session?.agentId ?? null)

    const handleSelect = useCallback(
      (bases: KnowledgeBase[]) => {
        if (context.scope === TopicType.Session && context.session?.sessionId) {
          void updateSession(
            {
              id: context.session.sessionId,
              knowledge_bases: bases
            },
            { showSuccessToast: false }
          )
        } else {
          updateAssistant({ knowledge_bases: bases })
        }
        actions.setSelectedKnowledgeBases?.(bases)
      },
      [actions, context.scope, context.session?.sessionId, updateAssistant, updateSession]
    )

    return (
      <KnowledgeBaseButton
        quickPanel={quickPanel}
        selectedBases={state.selectedKnowledgeBases}
        onSelect={handleSelect}
        disabled={Array.isArray(state.files) && state.files.length > 0}
      />
    )
  }
})

registerTool(knowledgeBaseTool)

export default knowledgeBaseTool
