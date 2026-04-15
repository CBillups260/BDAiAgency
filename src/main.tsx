import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log('[BDAi] main.tsx loaded — mounting React app');

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  console.error('[BDAi] Failed to mount:', err);
  document.getElementById('root')!.innerHTML = `
    <div style="min-height:100vh;background:#09090F;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fff;font-family:system-ui">
      <h2>App failed to load</h2>
      <pre style="color:#f87171;max-width:600px;overflow:auto;padding:16px">${err}</pre>
    </div>`;
}
