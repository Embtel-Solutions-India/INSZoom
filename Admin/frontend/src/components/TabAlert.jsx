import { useEffect } from 'react'
import { useNotifications } from '../contexts/NotificationContext'
import { setTabAlert } from '../utils/tabAlert'

const MESSAGE_TYPES = new Set(['message_received', 'attorney_feedback'])

// Keeps the browser tab in step with the unopened messages: a thin ring and a small number on the tab icon (messages only), and the one or two people who wrote most
// recently in the tab title (what shows when you hover the tab). Renders nothing.
export default function TabAlert() {
  const { notifications, unreadMessageCount, unreadMessageSenders } = useNotifications()

  useEffect(() => {
    // the server names the people who wrote most recently; the unread message notifications (newest first, the sender's name is the title) are the fallback
    const fromNotifications = (Array.isArray(notifications) ? notifications : [])
      .filter((item) => !item.isRead && MESSAGE_TYPES.has(item.type))
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
      .map((item) => item.title || item.metadata?.senderName || '')
    const senders = Array.isArray(unreadMessageSenders) && unreadMessageSenders.length ? unreadMessageSenders : fromNotifications
    setTabAlert({ count: unreadMessageCount, senders })
  }, [notifications, unreadMessageCount, unreadMessageSenders])

  // leaving the portal (sign-out) puts the normal icon and title back
  useEffect(() => () => setTabAlert({ count: 0 }), [])
  return null
}
