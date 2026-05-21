import './globalShim'; // must be first — sets window.global before other deps load
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

console.log('React app starting...');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Root element not found!');
} else {
  console.log('Root element found, rendering app...');
  const root = ReactDOM.createRoot(rootElement);
  
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}