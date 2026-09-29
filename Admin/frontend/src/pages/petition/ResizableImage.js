import Image from '@tiptap/extension-image'

// Extends the stock Image node with width (resize) and align (left/center/
// right/inline) attributes, rendered as inline styles — lets the toolbar
// grow/shrink and reposition a selected image without a bespoke node view.
// True pixel cropping is a separate, larger feature (needs an in-browser
// crop UI/library) and isn't covered here.
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '100%',
        parseHTML: (element) => element.style.width || element.getAttribute('width') || '100%',
        renderHTML: (attributes) => ({ style: `width: ${attributes.width}` }),
      },
      align: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-align') || 'left',
        renderHTML: (attributes) => {
          const align = attributes.align || 'left'
          const style = align === 'center'
            ? 'display: block; margin-left: auto; margin-right: auto;'
            : align === 'right'
              ? 'display: block; margin-left: auto; margin-right: 0;'
              : 'display: inline-block;'
          return { 'data-align': align, style }
        },
      },
    }
  },
})

export default ResizableImage
