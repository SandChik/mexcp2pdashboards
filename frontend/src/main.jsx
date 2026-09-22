import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { resumePush } from './push';

// Keep the push service worker registered on devices that opted in.
resumePush();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
