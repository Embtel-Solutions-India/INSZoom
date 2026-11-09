import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The service worker is what shows a message notification when the app is closed or in the background. It must show each message ONCE: Firebase already shows the
// notification itself just before it calls the worker's handler, so the worker must not show the same one again (that made the device alert twice).
const here = (relative) => fileURLToPath(new URL(relative, import.meta.url))
const WORKERS = {
  Admin: here('../../public/firebase-messaging-sw.js'),
  Client: here('../../../../Immiglance/Client/public/firebase-messaging-sw.js'),
  Attorney: here('../../../../Attorney/public/firebase-messaging-sw.js'),
}

function boot(file, displayed = []) {
  let backgroundHandler
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const listeners = {}
  const self = {
    registration: { showNotification, getNotifications: vi.fn().mockResolvedValue(displayed) },
    location: { origin: 'https://app.example.com' },
    addEventListener: (name, fn) => { listeners[name] = fn },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const firebase = { initializeApp: vi.fn(), messaging: () => ({ onBackgroundMessage: (fn) => { backgroundHandler = fn } }) }
  // eslint-disable-next-line no-new-func
  new Function('importScripts', 'firebase', 'self', 'clients', readFileSync(file, 'utf8'))(() => {}, firebase, self, {})
  return { handler: backgroundHandler, showNotification, self, listeners }
}

const push = (overrides = {}) => ({
  notification: { title: 'Sarah Johnson', body: 'Please upload your passport copy.' },
  data: { tag: 'msg-c1', link: '/messages/c1', url: 'https://app.example.com/messages/c1', ...overrides },
})
const alreadyShown = (overrides = {}) => ({ title: 'Sarah Johnson', body: 'Please upload your passport copy.', tag: 'msg-c1', timestamp: Date.now(), ...overrides })

describe.each(Object.entries(WORKERS))('%s service worker', (_name, file) => {
  it('does not show a message again when Firebase has already shown that very notification (one alert per message)', async () => {
    const { handler, showNotification } = boot(file, [alreadyShown()])
    await handler(push())
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('shows the notification itself when nothing is on screen for it (a push Firebase did not show)', async () => {
    const { handler, showNotification } = boot(file, [])
    await handler(push())
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, options] = showNotification.mock.calls[0]
    expect(title).toBe('Sarah Johnson')
    expect(options).toMatchObject({ body: 'Please upload your passport copy.', icon: '/icon-192.png', tag: 'msg-c1', renotify: true })
    expect(options.data).toEqual({ link: '/messages/c1', url: 'https://app.example.com/messages/c1' })
  })

  it('a different (new) message in the same chat is shown even though an older one of that chat is still on screen', async () => {
    const { handler, showNotification } = boot(file, [alreadyShown({ body: 'An older message', timestamp: Date.now() - 5000 })])
    await handler(push())
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('the same words sent again a while later are a new message and are shown', async () => {
    const { handler, showNotification } = boot(file, [alreadyShown({ timestamp: Date.now() - 60000 })])
    await handler(push())
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('shows it when the check itself cannot be made (a missed message is worse than a rare repeat)', async () => {
    const { handler, showNotification, self } = boot(file, [])
    self.registration.getNotifications.mockRejectedValueOnce(new Error('not supported'))
    await handler(push())
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('works for a push that only carries data (no notification part)', async () => {
    const { handler, showNotification } = boot(file, [])
    await handler({ data: { title: 'Sarah Johnson', body: 'Hello', tag: 'msg-c1', link: '/messages/c1' } })
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(showNotification.mock.calls[0][0]).toBe('Sarah Johnson')
  })

  it('takes over at once after an update and keeps its click handling', () => {
    const { listeners } = boot(file)
    expect(typeof listeners.install).toBe('function')
    expect(typeof listeners.activate).toBe('function')
    expect(typeof listeners.notificationclick).toBe('function')
  })
})
