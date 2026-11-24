import React from 'react';
import { installErrorReporting } from './lib/reportError';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: (n, e: any) => n < 2 && !(e?.response?.status >= 400 && e?.response?.status < 500), refetchOnWindowFocus: false } },
});

installErrorReporting();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider><ToastProvider><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></ToastProvider></ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

// Installable app: register the service worker in the built site only (it would get in the way of the dev server).
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* the site works fine without it */ }); });
