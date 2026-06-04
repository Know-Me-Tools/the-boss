## ADDED Requirements

### Requirement: Conversation Artifact Designer Entrypoints

Assistant and agent conversation surfaces MUST expose artifact designer entrypoints through the shared artifact card renderers for supported HTML/HTMX and React artifact sources, while preserving normal code rendering for non-artifact content.

#### Scenario: Assistant HTML or HTMX artifact code fence

- **WHEN** an assistant message contains an HTML or HTMX artifact code fence
- **THEN** the renderer routes the source through the HTML artifact card path
- **AND** the card preserves the message block and code block origin for editing

#### Scenario: Assistant React artifact code fence

- **WHEN** an assistant message contains a React/TSX artifact code fence
- **THEN** the renderer routes the source through the React artifact card path
- **AND** the card preserves the message block and code block origin for editing

#### Scenario: Agent session assistant artifact message

- **WHEN** an agent session assistant response is rendered in the conversation
- **THEN** the session renderer passes the assistant message to the shared message rendering pipeline
- **AND** artifact code fences can use the same artifact card behavior as assistant conversations

#### Scenario: Agent file tool artifact output

- **WHEN** an agent Read or Write tool output references an artifact-like file path such as `.html`, `.htm`, `.svg`, `.tsx`, or `.jsx`
- **THEN** the tool renderer uses the shared artifact card resolver
- **AND** non-artifact file paths continue to render as code viewer output

#### Scenario: Plain or user-authored code content

- **WHEN** a code block is not classified as an artifact or belongs to user-authored content
- **THEN** artifact designer controls are not exposed
- **AND** the content renders through the normal code path
