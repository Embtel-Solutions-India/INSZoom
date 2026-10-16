// Applies the firm's Settings -> Firm Profile brand (display name + brand
// colour) to the running app. Fetched from the public GET /branding endpoint,
// so it also works on pre-login screens. Kept identical across Admin,
// Immiglance Client and Immiglance Landing (see AGENTS.md "Shared code note").
import { useEffect, useState } from "react";

const DEFAULTS = { name: "Immiglance", displayName: "Immiglance", primaryColor: "", logo: "" };
const STYLE_ID = "firm-brand-theme";
const EVENT = "branding:changed";
let current = { ...DEFAULTS };
let originalTitle = null;
let lastBase = null;

function hexToHsl(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function applyColor(hex) {
  let style = document.getElementById(STYLE_ID);
  const hsl = hexToHsl(hex);
  if (!hsl) {
    if (style) style.remove();
    return;
  }
  const light = `${hsl.h} ${hsl.s}% ${hsl.l}%`;
  // Dark surfaces need a lighter brand tone to stay legible.
  const dark = `${hsl.h} ${hsl.s}% ${Math.max(hsl.l, 62)}%`;
  const fg = (l) => (l > 62 ? "222 40% 10%" : "0 0% 100%");
  const vars = (c, l) => `--primary:${c};--primary-foreground:${fg(l)};--ring:${c};--sidebar-primary:${c};--sidebar-primary-foreground:${fg(l)};--sidebar-ring:${c};--chart-1:${c};`;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `:root{${vars(light, hsl.l)}}.dark,:root[data-theme="dark"]{${vars(dark, Math.max(hsl.l, 62))}}`;
}

function applyTitle(displayName) {
  if (originalTitle === null) originalTitle = document.title;
  document.title = originalTitle.replace(/Immiglance/g, displayName || "Immiglance");
}

export function applyBranding(data = {}) {
  current = { ...DEFAULTS, ...data, displayName: data.displayName || data.name || DEFAULTS.displayName };
  applyColor(current.primaryColor);
  applyTitle(current.displayName);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: current }));
}

export async function loadBranding(baseUrl = lastBase) {
  if (baseUrl) lastBase = baseUrl;
  if (!lastBase) return current;
  try {
    const res = await fetch(`${String(lastBase).replace(/\/$/, "")}/branding`, { cache: "no-store" });
    if (!res.ok) return current;
    const body = await res.json();
    if (body?.data) applyBranding(body.data);
  } catch {
    // Branding is cosmetic - never break the app if it can't be fetched.
  }
  return current;
}

// Load once, then keep in sync (also refreshes when the tab regains focus).
export function startBranding(baseUrl, intervalMs = 60000) {
  loadBranding(baseUrl);
  setInterval(() => loadBranding(), intervalMs);
  window.addEventListener("focus", () => loadBranding());
}

export function useBranding() {
  const [branding, setBranding] = useState(current);
  useEffect(() => {
    const onChange = (e) => setBranding(e.detail);
    window.addEventListener(EVENT, onChange);
    setBranding(current);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return branding;
}
