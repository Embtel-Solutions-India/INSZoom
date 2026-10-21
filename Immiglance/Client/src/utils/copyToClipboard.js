// Copies text to the clipboard; resolves true on success. navigator.clipboard needs a secure context (https / localhost), so an
// off-screen textarea + execCommand("copy") is the fallback for plain-http or older browsers.
export async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // permission denied / insecure context - try the fallback
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}
