import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import UUReport from './pages/UUReport';
import FTDReport from './pages/FTDReport';
import BuyerLog from './pages/BuyerLog';
import ActionQueue from './pages/ActionQueue';
import BingxDashboard from './pages/BingxDashboard';
import GateDashboard from './pages/GateDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import Dock from './components/Dock';

function ProtectedRoute({ children }) {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { isAuth } = useAuth();
  const { pathname } = useLocation();
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={isAuth ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/uu" element={<ProtectedRoute><UUReport /></ProtectedRoute>} />
      <Route path="/ftd" element={<ProtectedRoute><FTDReport /></ProtectedRoute>} />
      <Route path="/buyers" element={<ProtectedRoute><BuyerLog /></ProtectedRoute>} />
      <Route path="/queue" element={<ProtectedRoute><ActionQueue /></ProtectedRoute>} />
      <Route path="/bingx" element={<ProtectedRoute><BingxDashboard /></ProtectedRoute>} />
      <Route path="/gate" element={<ProtectedRoute><GateDashboard /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    {/* One dock for every page — mounted here so it persists across navigation */}
    {isAuth && pathname !== '/login' && <Dock />}
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <AuthProvider>
      {/* v7_startTransition: route changes render as React transitions — the new
          page is built in slices, so the phone dock's slide keeps getting frames
          instead of freezing until a heavy dashboard has mounted (v83). */}
      <BrowserRouter future={{ v7_startTransition: true }}>
        <AppRoutes />
        <Toaster
          position="bottom-right"
          containerStyle={{ bottom: 'calc(var(--dock-space) + 4px)' }}
          toastOptions={{
            style: {
              background: '#1a1d2e',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.08)',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '13px'
            }
          }}
        />
      </BrowserRouter>
    </AuthProvider>
  );
}
