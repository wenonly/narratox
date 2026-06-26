import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { AuthUser, type ChatMessage } from '@/types/os'

interface Store {
  hydrated: boolean
  setHydrated: () => void
  streamingErrorMessage: string
  setStreamingErrorMessage: (streamingErrorMessage: string) => void
  isStreaming: boolean
  setIsStreaming: (isStreaming: boolean) => void
  messages: ChatMessage[]
  setMessages: (
    messages: ChatMessage[] | ((prevMessages: ChatMessage[]) => ChatMessage[])
  ) => void
  inputMessage: string
  setChatInput: (inputMessage: string) => void
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>
  selectedEndpoint: string
  setSelectedEndpoint: (selectedEndpoint: string) => void
  authToken: string
  setAuthToken: (authToken: string) => void
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  logout: () => void
  login: (token: string, user: AuthUser | null) => void
  writingChapterOrder: number | null
  setWritingChapterOrder: (order: number | null) => void
  chapterWriteSeq: number
  bumpChapterWriteSeq: () => void
  // 大纲写入序号:set_volume / set_chapter_plan 落库时 bump,OutlineView 据此自动刷新。
  outlineWriteSeq: number
  bumpOutlineWriteSeq: () => void
  // 世界观写入序号:set_world_entry 落库时 bump,WorldView 据此自动刷新。
  worldEntryWriteSeq: number
  bumpWorldEntryWriteSeq: () => void
  // 伏笔写入序号:write_summary 落库时 bump,HooksView 据此自动刷新。
  hookWriteSeq: number
  bumpHookWriteSeq: () => void
  // 角色写入序号:write_summary 落库时 bump,CharactersView 据此自动刷新。
  characterWriteSeq: number
  bumpCharacterWriteSeq: () => void
  // 参考资料写入序号:set_references 落库时 bump,ReferencesView 据此自动刷新。
  referenceWriteSeq: number
  bumpReferenceWriteSeq: () => void
  currentChapterOrder: number | null
  setCurrentChapterOrder: (order: number | null) => void
  manualLock: boolean
  setManualLock: (lock: boolean) => void
  // 顶栏实时阶段:流式时按 tool label 映射(思考中/构建世界观中/写作中·第N章…),
  // 空闲时 null → 由 deriveIdlePhase 兜底。run 结束/停止清空。
  activePhase: string | null
  setActivePhase: (phase: string | null) => void
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      streamingErrorMessage: '',
      setStreamingErrorMessage: (streamingErrorMessage) =>
        set(() => ({ streamingErrorMessage })),
      isStreaming: false,
      setIsStreaming: (isStreaming) => set(() => ({ isStreaming })),
      messages: [],
      setMessages: (messages) =>
        set((state) => ({
          messages:
            typeof messages === 'function' ? messages(state.messages) : messages
        })),
      inputMessage: '',
      setChatInput: (inputMessage) => set(() => ({ inputMessage })),
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
          streamingErrorMessage: '',
          isStreaming: false,
          inputMessage: '',
          writingChapterOrder: null,
          chapterWriteSeq: 0,
          outlineWriteSeq: 0,
          worldEntryWriteSeq: 0,
          hookWriteSeq: 0,
          characterWriteSeq: 0,
          referenceWriteSeq: 0,
          currentChapterOrder: null,
          manualLock: false,
          activePhase: null
        })),
      // 登录/换号:写入新凭证的同时清掉上一个账号的聊天,
      // 否则换号后右侧仍会显示前一个账号的 messages。
      login: (token, user) =>
        set(() => ({
          authToken: token,
          user,
          messages: [],
          streamingErrorMessage: '',
          isStreaming: false,
          inputMessage: '',
          writingChapterOrder: null,
          chapterWriteSeq: 0,
          outlineWriteSeq: 0,
          worldEntryWriteSeq: 0,
          hookWriteSeq: 0,
          characterWriteSeq: 0,
          referenceWriteSeq: 0,
          currentChapterOrder: null,
          manualLock: false,
          activePhase: null
        })),
      writingChapterOrder: null,
      setWritingChapterOrder: (order) =>
        set(() => ({ writingChapterOrder: order })),
      chapterWriteSeq: 0,
      bumpChapterWriteSeq: () =>
        set((s) => ({ chapterWriteSeq: s.chapterWriteSeq + 1 })),
      outlineWriteSeq: 0,
      bumpOutlineWriteSeq: () =>
        set((s) => ({ outlineWriteSeq: s.outlineWriteSeq + 1 })),
      worldEntryWriteSeq: 0,
      bumpWorldEntryWriteSeq: () =>
        set((s) => ({ worldEntryWriteSeq: s.worldEntryWriteSeq + 1 })),
      hookWriteSeq: 0,
      bumpHookWriteSeq: () =>
        set((s) => ({ hookWriteSeq: s.hookWriteSeq + 1 })),
      characterWriteSeq: 0,
      bumpCharacterWriteSeq: () =>
        set((s) => ({ characterWriteSeq: s.characterWriteSeq + 1 })),
      referenceWriteSeq: 0,
      bumpReferenceWriteSeq: () =>
        set((s) => ({ referenceWriteSeq: s.referenceWriteSeq + 1 })),
      currentChapterOrder: null,
      setCurrentChapterOrder: (order) =>
        set(() => ({ currentChapterOrder: order })),
      manualLock: false,
      setManualLock: (lock) => set(() => ({ manualLock: lock })),
      activePhase: null,
      setActivePhase: (phase) => set(() => ({ activePhase: phase }))
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
