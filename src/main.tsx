import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Client-facing portal (passcode, light theme, no team login). Loaded on demand
// so it never touches the main app bundle's auth gate.
const ClientPortal = lazy(() => import('./portal/ClientPortal.tsx'));

console.log('[BDAi] main.tsx loaded — mounting React app');

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <Routes>
          <Route
            path="/p/:slug"
            element={
              <Suspense fallback={<div style={{minHeight: '100dvh', background: '#F4F5F7'}} />}>
                <ClientPortal />
              </Suspense>
            }
          />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
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
