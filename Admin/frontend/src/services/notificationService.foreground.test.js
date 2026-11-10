import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A new message while the app is open: the browser notification is shown for EVERY message except one that belongs to the chat the person is looking at
// right now (this window focused, this tab showing) - like WhatsApp - and each message is shown ONCE (never again from another open tab).
let counter = 0
const payload = (overrides = {}) => {
  counter += 1
  return {
    notification: { title: 'Sarah Johnson', body: 'Please upload your passport copy.' },
    data: { type: 'message_received', notificationId: `n-${counter}`, tag: 'msg-c1', link: '/messages/c1', url: 'https://admin.example.com/messages/c1', conversationId: 'conv1', caseId: 'case1', senderId: 'u-sarah', kind: 'message', ...overrides },
  }
}

let showNotification
let service

async function load() {
  vi.resetModules()
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'k')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'p')
  vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 's')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'a')
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'v')
  service = await import('./notificationService')
}

const lookAtScreen = (focused, visibility = 'visible') => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: visibility })
}

beforeEach(async () => {
  showNotification = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn().mockResolvedValue({ showNotification }) } })
  globalThis.Notification = Object.assign(function Notification() {}, { permission: 'granted' })
  window.history.pushState({}, '', '/dashboard')
  await load()
})

afterEach(() => {
  service.setOpenChat(null)
  Object.keys(localStorage).filter((key) => key.startsWith('immiglance_')).forEach((key) => localStorage.removeItem(key))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  delete globalThis.Notification
})

describe('showMessagePushInForeground', () => {
  it('shows the browser notification for a message (sender on top, then the text), carrying what the click needs', async () => {
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, options] = showNotification.mock.calls[0]
    expect(title).toBe('Sarah Johnson')
    expect(options).toMatchObject({ body: 'Please upload your passport copy.', renotify: true })
    expect(options.tag).toMatch(/^msg-c1:n-\d+$/) // its own tag: it always pops up, even on Safari
    expect(options.data).toEqual({ link: '/messages/c1', url: 'https://admin.example.com/messages/c1' })
  })

  it("closes this conversation's older notifications (one stays on screen) and leaves other conversations alone", async () => {
    const older = { tag: 'msg-c1:n-old', close: vi.fn() }
    const otherChat = { tag: 'msg-c9:n-x', close: vi.fn() }
    Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn().mockResolvedValue({ showNotification, getNotifications: vi.fn().mockResolvedValue([older, otherChat]) }) } })
    await load()
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
    expect(older.close).toHaveBeenCalledTimes(1)
    expect(otherChat.close).not.toHaveBeenCalled()
  })

  it('also covers an attorney feedback message', async () => {
    expect(await service.showMessagePushInForeground(payload({ type: 'attorney_feedback', kind: 'feedback' }))).toBe(true)
  })

  it('stays quiet for a message in the chat that is open and in front of the person', async () => {
    lookAtScreen(true)
    service.setOpenChat({ kind: 'message', caseId: 'case1', conversationId: 'conv1' })
    expect(await service.showMessagePushInForeground(payload())).toBe(false)
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('notifies for a message in ANOTHER chat even while on the Messages page (chatting with a, b writes)', async () => {
    lookAtScreen(true)
    window.history.pushState({}, '', '/messages')
    service.setOpenChat({ kind: 'message', caseId: 'case-a', conversationId: 'conv-a' })
    expect(await service.showMessagePushInForeground(payload({ caseId: 'case-b', conversationId: 'conv-b' }))).toBe(true)
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('a direct chat: quiet for that colleague, loud for any other colleague', async () => {
    lookAtScreen(true)
    service.setOpenChat({ kind: 'message', userId: 'u-d' })
    const fromD = payload({ caseId: undefined, conversationId: undefined, senderId: 'u-d' })
    const fromE = payload({ caseId: undefined, conversationId: undefined, senderId: 'u-e' })
    expect(await service.showMessagePushInForeground(fromD)).toBe(false)
    expect(await service.showMessagePushInForeground(fromE)).toBe(true)
  })

  it('chatting with a client case, a colleague writes to me privately: the private message notifies', async () => {
    lookAtScreen(true)
    service.setOpenChat({ kind: 'message', caseId: 'case1', conversationId: 'conv1' })
    expect(await service.showMessagePushInForeground(payload({ caseId: undefined, conversationId: 'conv-direct', senderId: 'u-d' }))).toBe(true)
  })

  it('a colleague writing in the same direct chat that is open is quiet, but the same person writing in a CASE chat notifies', async () => {
    lookAtScreen(true)
    service.setOpenChat({ kind: 'message', userId: 'u-d' })
    expect(await service.showMessagePushInForeground(payload({ caseId: undefined, conversationId: 'conv-direct', senderId: 'u-d' }))).toBe(false)
    expect(await service.showMessagePushInForeground(payload({ caseId: 'case9', conversationId: 'conv9', senderId: 'u-d' }))).toBe(true)
  })

  it("a case's client chat and its attorney feedback chat are different chats", async () => {
    lookAtScreen(true)
    service.setOpenChat({ kind: 'message', caseId: 'case1' })
    expect(await service.showMessagePushInForeground(payload({ type: 'attorney_feedback', kind: 'feedback' }))).toBe(true)
    service.setOpenChat({ kind: 'feedback', caseId: 'case1' })
    expect(await service.showMessagePushInForeground(payload({ type: 'attorney_feedback', kind: 'feedback' }))).toBe(false)
  })

  it('notifies even for the open chat when the window is on screen but not focused (working in another window or app)', async () => {
    lookAtScreen(false)
    service.setOpenChat({ kind: 'message', caseId: 'case1', conversationId: 'conv1' })
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
  })

  it('stays quiet in a second tab while the person reads that chat in another tab, and notifies for a different chat', async () => {
    lookAtScreen(false) // this tab is in the background
    localStorage.setItem('immiglance_watching_chat', JSON.stringify({ t: Date.now(), chat: { kind: 'message', caseId: 'case1', conversationId: 'conv1', userId: '' } }))
    expect(await service.showMessagePushInForeground(payload())).toBe(false)
    expect(await service.showMessagePushInForeground(payload({ caseId: 'case2', conversationId: 'conv2' }))).toBe(true)
  })

  it('notifies again as soon as the other tab stops watching (stale or cleared mark)', async () => {
    lookAtScreen(false)
    localStorage.setItem('immiglance_watching_chat', JSON.stringify({ t: Date.now() - 60000, chat: { kind: 'message', caseId: 'case1', conversationId: 'conv1', userId: '' } }))
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
    localStorage.removeItem('immiglance_watching_chat')
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
  })

  it('no open chat (the Messages list, or any other page): every message notifies', async () => {
    lookAtScreen(true)
    window.history.pushState({}, '', '/messages')
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
  })

  it('shows each message ONCE: the same message reaching a second open tab is not shown again', async () => {
    const message = payload()
    expect(await service.showMessagePushInForeground(message)).toBe(true)
    // the second tab of the same browser receives the very same push (same notification id) and finds it already claimed
    expect(await service.showMessagePushInForeground({ ...message, data: { ...message.data } })).toBe(false)
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('a NEW message in the same chat is its own message and notifies again; claims never block a different message', async () => {
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
    expect(showNotification).toHaveBeenCalledTimes(2)
  })

  it('two tabs racing for one message: exactly one shows it', async () => {
    const message = payload()
    const results = await Promise.all([service.showMessagePushInForeground(message), service.showMessagePushInForeground(message), service.showMessagePushInForeground(message)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('a message that was suppressed (open chat) is not consumed: once the person leaves the chat the next one shows', async () => {
    lookAtScreen(true)
    service.setOpenChat({ kind: 'message', caseId: 'case1' })
    expect(await service.showMessagePushInForeground(payload())).toBe(false)
    service.setOpenChat(null)
    expect(await service.showMessagePushInForeground(payload())).toBe(true)
  })

  it('leaves every other kind of notification exactly as before (nothing extra shown)', async () => {
    expect(await service.showMessagePushInForeground(payload({ type: 'case_stage_changed' }))).toBe(false)
    expect(await service.showMessagePushInForeground({ data: {} })).toBe(false)
    expect(await service.showMessagePushInForeground(undefined)).toBe(false)
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('shows nothing when the browser notification permission is not granted, and never throws', async () => {
    globalThis.Notification.permission = 'denied'
    expect(await service.showMessagePushInForeground(payload())).toBe(false)
    globalThis.Notification.permission = 'granted'
    showNotification.mockRejectedValueOnce(new Error('boom'))
    await expect(service.showMessagePushInForeground(payload())).resolves.toBe(false)
  })
})

describe('service worker registration', () => {
  it('asks the browser to check for a newer worker on every visit, so people who enabled notifications earlier get the current one', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn().mockResolvedValue({ showNotification, update }) } })
    await load()
    const registration = await service.registerServiceWorker()
    expect(registration).toBeTruthy()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('a registration that cannot update, or an update that fails, changes nothing', async () => {
    await load()
    expect(await service.registerServiceWorker()).toBeTruthy()
    Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn().mockResolvedValue({ showNotification, update: vi.fn().mockRejectedValue(new Error('offline')) }) } })
    await load()
    expect(await service.registerServiceWorker()).toBeTruthy()
  })
})

describe('isSameChat', () => {
  it('matches by conversation, by case, or by the person in a direct chat', () => {
    const { isSameChat } = service
    expect(isSameChat({ conversationId: 'c1', caseId: '', userId: '', kind: '' }, { conversationId: 'c1' })).toBe(true)
    expect(isSameChat({ conversationId: '', caseId: 'k1', userId: '', kind: '' }, { caseId: 'k1' })).toBe(true)
    expect(isSameChat({ conversationId: '', caseId: 'k1', userId: '', kind: '' }, { caseId: 'k2' })).toBe(false)
    expect(isSameChat({ conversationId: '', caseId: '', userId: 'u1', kind: '' }, { senderId: 'u1' })).toBe(true)
    expect(isSameChat({ conversationId: '', caseId: '', userId: 'u1', kind: '' }, { senderId: 'u1', caseId: 'k1' })).toBe(false)
    expect(isSameChat(null, { caseId: 'k1' })).toBe(false)
    expect(isSameChat({ caseId: 'k1' }, undefined)).toBe(false)
  })
})

describe('iPhone / iPad: notifications need the app on the Home Screen', () => {
  const setUa = (ua) => Object.defineProperty(globalThis.navigator, 'userAgent', { configurable: true, value: ua })
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

  it('an iPhone in a Safari tab is told to add the app to the Home Screen (never silently hidden)', async () => {
    setUa(IPHONE)
    Object.defineProperty(globalThis.navigator, 'standalone', { configurable: true, value: false })
    expect(service.isIosDevice()).toBe(true)
    expect(service.needsIosInstall()).toBe(true)
    expect(await service.getPushStatus()).toBe('install_ios')
    expect(service.IOS_INSTALL_HINT).toMatch(/Add to Home Screen/)
  })

  it('an iPhone running from the Home Screen continues to the normal flow', async () => {
    setUa(IPHONE)
    Object.defineProperty(globalThis.navigator, 'standalone', { configurable: true, value: true })
    expect(service.needsIosInstall()).toBe(false)
    expect(await service.getPushStatus()).not.toBe('install_ios')
  })

  it('Android, Windows and macOS desktops are never sent through the iPhone steps', () => {
    Object.defineProperty(globalThis.navigator, 'standalone', { configurable: true, value: undefined })
    for (const ua of ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15']) {
      setUa(ua)
      expect(service.needsIosInstall()).toBe(false)
    }
  })
})
