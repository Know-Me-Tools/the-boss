import Emittery from 'emittery'

type LegacyListener<T = any> = (data: T) => void | Promise<void>
type WrappedListener = (event: { readonly data: unknown }) => void | Promise<void>

const emitter = new Emittery<Record<string, unknown>>() as Emittery<any>
const listenerMap = new WeakMap<LegacyListener<any>, Map<string, WrappedListener>>()

function getWrappedListener(eventName: string, listener: LegacyListener<any>) {
  const eventListeners = listenerMap.get(listener)
  return eventListeners?.get(eventName)
}

function setWrappedListener(eventName: string, listener: LegacyListener<any>, wrapped: WrappedListener) {
  const eventListeners = listenerMap.get(listener) ?? new Map()
  eventListeners.set(eventName, wrapped)
  listenerMap.set(listener, eventListeners)
}

export const EventEmitter = {
  emit(eventName: string, data?: unknown) {
    return data === undefined ? emitter.emit(eventName, undefined) : emitter.emit(eventName, data)
  },

  on<T = any>(eventName: string, listener: LegacyListener<T>) {
    const wrapped = async (event: { readonly data: unknown }) => listener(event.data as T)
    setWrappedListener(eventName, listener, wrapped)
    return emitter.on(eventName, wrapped as any)
  },

  off<T = any>(eventName: string, listener: LegacyListener<T>) {
    const wrapped = getWrappedListener(eventName, listener)
    if (wrapped) {
      emitter.off(eventName, wrapped as any)
    }
  },

  once<T = any>(eventName: string) {
    return emitter.once(eventName).then((event: any) => event.data as T)
  }
}

export const EVENT_NAMES = {
  PLUGINS_UPDATED: 'PLUGINS_UPDATED',
  SEND_MESSAGE: 'SEND_MESSAGE',
  MESSAGE_COMPLETE: 'MESSAGE_COMPLETE',
  AI_AUTO_RENAME: 'AI_AUTO_RENAME',
  CLEAR_MESSAGES: 'CLEAR_MESSAGES',
  ADD_ASSISTANT: 'ADD_ASSISTANT',
  EDIT_MESSAGE: 'EDIT_MESSAGE',
  REGENERATE_MESSAGE: 'REGENERATE_MESSAGE',
  CHAT_COMPLETION_PAUSED: 'CHAT_COMPLETION_PAUSED',
  ESTIMATED_TOKEN_COUNT: 'ESTIMATED_TOKEN_COUNT',
  SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
  SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR',
  SWITCH_TOPIC_SIDEBAR: 'SWITCH_TOPIC_SIDEBAR',
  NEW_CONTEXT: 'NEW_CONTEXT',
  NEW_BRANCH: 'NEW_BRANCH',
  COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
  EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE',
  LOCATE_MESSAGE: 'LOCATE_MESSAGE',
  LOCATE_NOTE_LINE: 'LOCATE_NOTE_LINE',
  ADD_NEW_TOPIC: 'ADD_NEW_TOPIC',
  RESEND_MESSAGE: 'RESEND_MESSAGE',
  SHOW_MODEL_SELECTOR: 'SHOW_MODEL_SELECTOR',
  EDIT_CODE_BLOCK: 'EDIT_CODE_BLOCK',
  CHANGE_TOPIC: 'CHANGE_TOPIC'
}
