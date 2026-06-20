import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { AuthUser, SessionEntry, type ChatMessage } from '@/types/os'

interface Store {
  hydrated: boolean
  setHydrated: () => void
  streamingErrorMessage: string
  setStreamingErrorMessage: (streamingErrorMessage: string) => void
  endpoints: {
    endpoint: string
    id__endpoint: string
  }[]
  setEndpoints: (
    endpoints: {
      endpoint: string
      id__endpoint: string
    }[]
  ) => void
  isStreaming: boolean
  setIsStreaming: (isStreaming: boolean) => void
  isEndpointActive: boolean
  setIsEndpointActive: (isActive: boolean) => void
  isEndpointLoading: boolean
  setIsEndpointLoading: (isLoading: boolean) => void
  messages: ChatMessage[]
  setMessages: (
    messages: ChatMessage[] | ((prevMessages: ChatMessage[]) => ChatMessage[])
  ) => void
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>
  selectedEndpoint: string
  setSelectedEndpoint: (selectedEndpoint: string) => void
  authToken: string
  setAuthToken: (authToken: string) => void
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  logout: () => void
  login: (token: string, user: AuthUser | null) => void
  mode: 'agent' | 'team'
  setMode: (mode: 'agent' | 'team') => void
  sessionsData: SessionEntry[] | null
  setSessionsData: (
    sessionsData:
      | SessionEntry[]
      | ((prevSessions: SessionEntry[] | null) => SessionEntry[] | null)
  ) => void
  isSessionsLoading: boolean
  setIsSessionsLoading: (isSessionsLoading: boolean) => void
  writingChapterOrder: number | null
  setWritingChapterOrder: (order: number | null) => void
  chapterWriteSeq: number
  bumpChapterWriteSeq: () => void
  // 大纲写入序号:set_volume / set_chapter_plan 落库时 bump,OutlineView 据此自动刷新。
  outlineWriteSeq: number
  bumpOutlineWriteSeq: () => void
  currentChapterOrder: number | null
  setCurrentChapterOrder: (order: number | null) => void
  manualLock: boolean
  setManualLock: (lock: boolean) => void
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      streamingErrorMessage: '',
      setStreamingErrorMessage: (streamingErrorMessage) =>
        set(() => ({ streamingErrorMessage })),
      endpoints: [],
      setEndpoints: (endpoints) => set(() => ({ endpoints })),
      isStreaming: false,
      setIsStreaming: (isStreaming) => set(() => ({ isStreaming })),
      isEndpointActive: false,
      setIsEndpointActive: (isActive) =>
        set(() => ({ isEndpointActive: isActive })),
      isEndpointLoading: true,
      setIsEndpointLoading: (isLoading) =>
        set(() => ({ isEndpointLoading: isLoading })),
      messages: [],
      setMessages: (messages) =>
        set((state) => ({
          messages:
            typeof messages === 'function' ? messages(state.messages) : messages
        })),
      chatInputRef: { current: null },
      selectedEndpoint: 'http://localhost:3001',
      setSelectedEndpoint: (selectedEndpoint) =>
        set(() => ({ selectedEndpoint })),
      authToken: '',
      setAuthToken: (authToken) => set(() => ({ authToken })),
      user: null,
      setUser: (user) => set(() => ({ user })),
      logout: () =>
        set(() => ({
          authToken: '',
          user: null,
          messages: [],
          sessionsData: null,
          streamingErrorMessage: '',
          isStreaming: false,
          writingChapterOrder: null,
          chapterWriteSeq: 0,
          outlineWriteSeq: 0,
          currentChapterOrder: null,
          manualLock: false
        })),
      // 登录/换号:写入新凭证的同时清掉上一个账号的聊天与会话列表,
      // 否则换号后右侧仍会显示前一个账号的 messages。
      login: (token, user) =>
        set(() => ({
          authToken: token,
          user,
          messages: [],
          sessionsData: null,
          streamingErrorMessage: '',
          isStreaming: false,
          writingChapterOrder: null,
          chapterWriteSeq: 0,
          outlineWriteSeq: 0,
          currentChapterOrder: null,
          manualLock: false
        })),
      mode: 'agent',
      setMode: (mode) => set(() => ({ mode })),
      sessionsData: null,
      setSessionsData: (sessionsData) =>
        set((state) => ({
          sessionsData:
            typeof sessionsData === 'function'
              ? sessionsData(state.sessionsData)
              : sessionsData
        })),
      isSessionsLoading: false,
      setIsSessionsLoading: (isSessionsLoading) =>
        set(() => ({ isSessionsLoading })),
      writingChapterOrder: null,
      setWritingChapterOrder: (order) =>
        set(() => ({ writingChapterOrder: order })),
      chapterWriteSeq: 0,
      bumpChapterWriteSeq: () =>
        set((s) => ({ chapterWriteSeq: s.chapterWriteSeq + 1 })),
      outlineWriteSeq: 0,
      bumpOutlineWriteSeq: () =>
        set((s) => ({ outlineWriteSeq: s.outlineWriteSeq + 1 })),
      currentChapterOrder: null,
      setCurrentChapterOrder: (order) =>
        set(() => ({ currentChapterOrder: order })),
      manualLock: false,
      setManualLock: (lock) => set(() => ({ manualLock: lock }))
    }),
    {
      name: 'endpoint-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedEndpoint: state.selectedEndpoint,
        authToken: state.authToken,
        user: state.user
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated?.()
      }
    }
  )
)
