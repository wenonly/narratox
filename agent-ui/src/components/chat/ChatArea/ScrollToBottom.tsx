'use client'

import type React from 'react'

import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'

interface Props {
  isAtBottom: boolean
  onScrollToBottom: () => void
}

/** 浮动「滚到底部」按钮:非贴底时显隐。状态由 MessageArea(Virtuoso atBottomStateChange)驱动。 */
const ScrollToBottom: React.FC<Props> = ({ isAtBottom, onScrollToBottom }) => {
  return (
    <AnimatePresence>
      {!isAtBottom && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2"
        >
          <Button
            onClick={onScrollToBottom}
            type="button"
            size="icon"
            variant="secondary"
            className="border border-overlay-15 bg-bg-card text-text-primary shadow-md transition-shadow duration-300 hover:bg-bg-cardElevated"
          >
            <Icon type="arrow-down" size="xs" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ScrollToBottom
