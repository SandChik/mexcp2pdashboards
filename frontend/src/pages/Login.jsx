import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api';
import toast from 'react-hot-toast';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSetup, setIsSetup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0); // epoch ms while the server says 429
  const [now, setNow] = useState(Date.now());
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    authApi.status().then(r => setIsSetup(r.data.isSetup)).catch(() => setIsSetup(false));
  }, []);
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const lockedSec = lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockedSec) return;
    if (!isSetup && password !== confirmPassword) { toast.error('Password tidak sama'); return; }
    setLoading(true);
    try {
      const r = await (isSetup ? authApi.login : authApi.setup)(username.trim(), password);
      login(r.data.token);
      navigate('/');
    } catch (err) {
      const data = err.response?.data || {};
      if (err.response?.status === 429) {
        setLockedUntil(Date.now() + (Number(data.retryAfter) || 900) * 1000);
        toast.error(data.error || 'Terlalu banyak percobaan — tunggu sebentar.');
      } else if (isSetup) {
        const left = data.remaining !== undefined ? ` · sisa ${data.remaining} percobaan` : '';
        toast.error((data.error || 'Username atau password salah') + left);
      } else toast.error(data.error || 'Setup gagal');
    }
    finally { setLoading(false); }
  };

  if (isSetup === null) return (
    <div className="min-h-[100dvh] bg-surface-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  );

  const fields = [
    ['Username', 'text', username, setUsername, isSetup ? 'username' : 'pilih username (mis. admin)', 'username'],
    ['Password', 'password', password, setPassword, '••••••••', isSetup ? 'current-password' : 'new-password'],
    ...(!isSetup ? [['Confirm Password', 'password', confirmPassword, setConfirmPassword, '••••••••', 'new-password']] : []),
  ];

  return (
    <div className="min-h-[100dvh] bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-2.5 mb-6">
            <img src="/brand/sandchik-mark.png" alt="" className="w-11 h-11 rounded-xl shadow-glow" onError={e => { e.currentTarget.style.display = 'none'; }} />
            <span className="text-white font-display font-bold text-2xl tracking-tight">P2P Dashboard</span>
          </div>
          <p className="text-white/50 text-sm font-mono">
            {isSetup ? 'Masuk ke dashboard' : 'Buat akun untuk dashboard ini'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map(([label, type, val, setter, placeholder, autoComplete]) => (
            <div key={label}>
              <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">{label}</label>
              <input type={type} value={val} onChange={e => setter(e.target.value)} autoComplete={autoComplete}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="w-full bg-surface-800 border-2 border-surface-700 rounded-lg px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-brand-500 transition-colors font-mono text-sm"
                placeholder={placeholder} required autoFocus={label === 'Username'}/>
            </div>
          ))}
          {!isSetup && <p className="text-[11px] text-white/40 font-mono">Username: 3–32 karakter (huruf kecil, angka, . _ -). Password minimal 8 karakter.</p>}
          <button type="submit" disabled={loading || !!lockedSec}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-display font-bold rounded-lg py-3 transition-colors mt-2">
            {lockedSec ? `Terkunci — coba lagi dalam ${Math.floor(lockedSec / 60)}:${String(lockedSec % 60).padStart(2, '0')}`
              : loading ? 'Loading...' : isSetup ? 'Sign In' : 'Setup Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
