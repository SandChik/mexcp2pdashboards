import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import UUReport from './pages/UUReport';
import FTDReport from './pages/FTDReport';
import BuyerLog from './pages/BuyerLog';

function ProtectedRoute({ children }) {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { isAuth } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={isAuth ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/uu" element={<ProtectedRoute><UUReport /></ProtectedRoute>} />
      <Route path="/ftd" element={<ProtectedRoute><FTDReport /></ProtectedRoute>} />
      <Route path="/buyers" element={<ProtectedRoute><BuyerLog /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster
          position="bottom-right"
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
