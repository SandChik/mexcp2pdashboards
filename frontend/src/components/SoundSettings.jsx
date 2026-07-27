import { useState } from 'react';
import { Volume2, VolumeX, Play } from 'lucide-react';
import { getSoundPrefs, setSoundPrefs, previewSound, SOUND_EVENTS } from '../sounds';

export default function SoundSettings() {
  const [prefs, setPrefs] = useState(getSoundPrefs());
  const update = (patch) => setPrefs(setSoundPrefs(patch));

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {prefs.enabled ? <Volume2 size={15} className="text-brand-300 flex-shrink-0" /> : <VolumeX size={15} className="text-surface-300 flex-shrink-0" />}
          <h2 className="font-display font-semibold text-surface-50 text-sm truncate">Suara notifikasi</h2>
        </div>
        <button onClick={() => update({ enabled: !prefs.enabled })}
          aria-label={prefs.enabled ? 'Matikan suara' : 'Nyalakan suara'}
          className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-all ${prefs.enabled ? 'bg-brand-500 shadow-glow-sm' : 'bg-surface-700'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${prefs.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <p className="text-[11px] text-surface-300 leading-relaxed">
        Tiap kejadian punya nada berbeda supaya bisa dibedakan tanpa melihat layar.
        Nada naik = butuh perhatian, nada turun = order selesai/gugur.
      </p>

      {/* Volume */}
      <div className={prefs.enabled ? '' : 'opacity-40 pointer-events-none'}>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-surface-300 uppercase tracking-wide">Volume</label>
          <span className="text-xs font-mono text-surface-200 tnum">{Math.round(prefs.volume * 100)}%</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value={prefs.volume}
          onChange={e => update({ volume: parseFloat(e.target.value) })}
          onMouseUp={() => previewSound('newOrder')}
          onTouchEnd={() => previewSound('newOrder')}
          className="w-full accent-brand-500 cursor-pointer" />
      </div>

      {/* Per-event */}
      <div className={`space-y-1.5 ${prefs.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
        {SOUND_EVENTS.map(ev => {
          const on = prefs.events[ev.key] !== false;
          return (
            <div key={ev.key} className="flex items-center gap-2 bg-surface-900 border border-surface-700 rounded-lg px-2.5 py-2">
              <button onClick={() => previewSound(ev.key)} title="Dengarkan"
                className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-brand-300 hover:bg-brand-500/15 transition-colors">
                <Play size={13} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-surface-50 truncate">{ev.label}</p>
                <p className="text-[10px] text-surface-300 truncate">{ev.hint}</p>
              </div>
              <button onClick={() => update({ events: { [ev.key]: !on } })}
                aria-label={`${on ? 'Matikan' : 'Nyalakan'} suara ${ev.label}`}
                className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-all ${on ? 'bg-brand-500' : 'bg-surface-700'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-surface-300">
        Browser memblokir suara sampai ada interaksi pertama di halaman — klik di mana saja setelah membuka dashboard agar notifikasi terdengar.
      </p>
    </div>
  );
}
