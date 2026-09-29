import { createApp } from 'vue';
import '@flaticon/flaticon-uicons/css/regular/rounded.css';
import './style.css';
import App from './App.vue';

/**
 * Chrome does not expose an API to set side panel width.
 * Setting document min-width can nudge the panel wider on open
 * (Chrome still clamps and the user can resize).
 */
async function applyPreferredSidePanelWidth(): Promise<void> {
  try {
    const current = await browser.windows.getCurrent();
    const windowWidth = current.width ?? screen.availWidth;
    const target = Math.max(360, Math.round(windowWidth * 0.3));
    document.documentElement.style.minWidth = `${target}px`;
    document.body.style.minWidth = `${target}px`;
  } catch {
    const fallback = Math.max(360, Math.round(screen.availWidth * 0.3));
    document.documentElement.style.minWidth = `${fallback}px`;
    document.body.style.minWidth = `${fallback}px`;
  }
}

void applyPreferredSidePanelWidth();
createApp(App).mount('#app');
