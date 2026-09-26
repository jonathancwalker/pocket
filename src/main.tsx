import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import Capture from './capture/Capture';
import { native } from './bridge';
import './styles.css';
const Library = lazy(() => import('./library/Library'));
const capture = new URLSearchParams(location.search).get('window') === 'capture';
document.body.dataset.surface = capture ? 'capture' : 'library';
document.documentElement.dataset.surface = capture ? 'capture' : 'library';
createRoot(document.getElementById('root')!).render(
  !native ? (
    <main className="browser-notice">
      <h1>Pocket</h1>
      <p>Open the desktop app to use your library.</p>
      <code>npm run desktop</code>
    </main>
  ) : capture ? (
    <Capture />
  ) : (
    <Suspense
      fallback={
        <div className="loading-page" role="status">
          Loading…
        </div>
      }
    >
      <Library />
    </Suspense>
  ),
);
