import '@fontsource-variable/noto-sans-tc';
import '@fontsource-variable/noto-serif-tc';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './page';
import './globals.css';
// https://react.dev/reference/react-dom/client/createRoot
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
