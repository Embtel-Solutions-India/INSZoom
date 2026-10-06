import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import RichTextEditor from './RichTextEditor'

const PRESETS = [
  { label: "Recipient's own portal", value: '[system.portal_link]', text: 'Open in Immiglance' },
  { label: 'Activate account', value: 'https://client.x.com/accept-invite?token=[system.invite_token]', text: 'Set Your Password' },
]
const BUTTON = '<a href="[system.portal_link]" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Upload Documents</a>'

function Harness({ initial, onValue }) {
  const [value, setValue] = useState(initial)
  return <RichTextEditor value={value} onChange={(html) => { setValue(html); onValue?.(html) }} linkPresets={PRESETS} variables={[]} />
}
const editorArea = (container) => container.querySelector('.email-editor')

describe('RichTextEditor buttons', () => {
  it('shows buttons as single click-to-edit blocks, but never saves the editor-only attributes', () => {
    const onValue = vi.fn()
    const { container } = render(<Harness initial={`<p>Hi</p><p>${BUTTON}</p>`} onValue={onValue} />)
    const button = editorArea(container).querySelector('a')
    expect(button.getAttribute('contenteditable')).toBe('false')
    expect(button.getAttribute('data-editor-btn')).toBe('1')
    // an edit anywhere emits clean HTML
    fireEvent.click(button)
    fireEvent.change(screen.getByLabelText(/Button text/), { target: { value: 'Upload Your Documents' } })
    const saved = onValue.mock.calls.at(-1)[0]
    expect(saved).toContain('>Upload Your Documents</a>')
    expect(saved).not.toMatch(/contenteditable|data-editor-btn|title=/)
  })

  it('clicking an existing button opens it for editing; typing the text changes the button itself', () => {
    const { container } = render(<Harness initial={`<p>${BUTTON}</p>`} />)
    const button = editorArea(container).querySelector('a')
    fireEvent.click(button)
    const panel = screen.getByRole('group', { name: 'Button settings' })
    expect(within(panel).getByLabelText(/Button text/).value).toBe('Upload Documents')
    expect(within(panel).getByLabelText('Link address').value).toBe('[system.portal_link]')
    expect(within(panel).getByLabelText(/Where should it go/).value).toBe('[system.portal_link]') // matches the first preset
    fireEvent.change(within(panel).getByLabelText(/Button text/), { target: { value: 'Send Documents' } })
    expect(button.textContent).toBe('Send Documents') // the text is ON the button, not beside it
  })

  it('an existing button\'s link can be changed (preset or custom) and takes effect immediately', () => {
    const onValue = vi.fn()
    const { container } = render(<Harness initial={`<p>${BUTTON}</p>`} onValue={onValue} />)
    const button = editorArea(container).querySelector('a')
    fireEvent.click(button)
    fireEvent.change(screen.getByLabelText(/Where should it go/), { target: { value: PRESETS[1].value } })
    expect(button.getAttribute('href')).toBe(PRESETS[1].value)
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://example.org/docs' } })
    expect(button.getAttribute('href')).toBe('https://example.org/docs')
    expect(screen.getByLabelText(/Where should it go/).value).toBe('__custom__')
    expect(onValue.mock.calls.at(-1)[0]).toContain('href="https://example.org/docs"')
  })

  it('the colour can be changed and a button can be removed', () => {
    const onValue = vi.fn()
    const { container } = render(<Harness initial={`<p>Hello ${BUTTON}</p>`} onValue={onValue} />)
    const button = editorArea(container).querySelector('a')
    fireEvent.click(button)
    fireEvent.click(screen.getByLabelText('Red button'))
    expect(button.getAttribute('style')).toContain('background:#dc2626')
    fireEvent.click(screen.getByText('Remove'))
    expect(editorArea(container).querySelector('a')).toBeNull()
    expect(editorArea(container).textContent).toContain('Upload Documents')
  })

  it('Add button: the link is chosen FIRST, then the text; inserting creates a styled button', () => {
    const onValue = vi.fn()
    const { container } = render(<Harness initial="<p>Hello</p>" onValue={onValue} />)
    fireEvent.mouseDown(screen.getByTitle(/Insert a button/))
    const panel = screen.getByRole('group', { name: 'Button settings' })
    const link = within(panel).getByLabelText(/Where should it go/)
    const text = within(panel).getByLabelText(/Button text/)
    // link field comes before the text field
    expect(link.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // picking a destination suggests matching button text
    fireEvent.change(link, { target: { value: PRESETS[1].value } })
    expect(text.value).toBe('Set Your Password')
    fireEvent.click(within(panel).getByText('Insert button'))
    const saved = onValue.mock.calls.at(-1)[0]
    expect(saved).toContain(`href="${PRESETS[1].value}"`)
    expect(saved).toContain('display:inline-block')
    expect(saved).toContain('>Set Your Password</a>')
    expect(saved).not.toMatch(/contenteditable|data-editor-btn/)
    // the new button is immediately a click-to-edit block
    expect(editorArea(container).querySelector('a').getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Button settings' })).toBeNull()
  })

  it('plain text links are editable too (link and text)', () => {
    const onValue = vi.fn()
    const { container } = render(<Harness initial='<p>See <a href="https://old.example.com">our site</a></p>' onValue={onValue} />)
    fireEvent.click(editorArea(container).querySelector('a'))
    const panel = screen.getByRole('group', { name: 'Link settings' })
    fireEvent.change(within(panel).getByLabelText('Link address'), { target: { value: 'https://new.example.com' } })
    fireEvent.change(within(panel).getByLabelText(/Link text/), { target: { value: 'our new site' } })
    expect(onValue.mock.calls.at(-1)[0]).toContain('<a href="https://new.example.com">our new site</a>')
  })
})
