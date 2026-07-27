import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api';
import toast from 'react-hot-toast';

export default function Login() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSetup, setIsSetup] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    authApi.status().then(r => setIsSetup(r.data.isSetup)).catch(() => setIsSetup(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isSetup && password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      const r = await (isSetup ? authApi.login : authApi.setup)(password);
      login(r.data.token);
      navigate('/');
    } catch { toast.error(isSetup ? 'Invalid password' : 'Setup failed'); }
    finally { setLoading(false); }
  };

  if (isSetup === null) return (
    <div className="min-h-[100dvh] bg-surface-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* MEXC Logo style */}
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-2.5 mb-6">
            <div className="w-11 h-11 rounded-xl bg-grad-brand shadow-glow flex items-center justify-center">
              <span className="text-white font-bold font-mono text-lg">M</span>
            </div>
            <span className="text-white font-display font-bold text-2xl tracking-tight">P2P Dashboard</span>
          </div>
          <p className="text-white/50 text-sm font-mono">
            {isSetup ? 'Masukkan password dashboard' : 'Buat password untuk dashboard ini'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            ['Password', 'password', password, setPassword],
            ...(!isSetup ? [['Confirm Password', 'password', confirmPassword, setConfirmPassword]] : [])
          ].map(([label, type, val, setter]) => (
            <div key={label}>
              <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">{label}</label>
              <input type={type} value={val} onChange={e => setter(e.target.value)}
                className="w-full bg-surface-800 border-2 border-surface-700 rounded-lg px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-brand-500 transition-colors font-mono text-sm"
                placeholder="••••••••" required autoFocus={label === 'Password'}/>
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-display font-bold rounded-lg py-3 transition-colors mt-2">
            {loading ? 'Loading...' : isSetup ? 'Sign In' : 'Setup Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
