import { useState } from 'react';
import { Play } from 'lucide-react';
import { getSoundPrefs, setSoundPrefs, previewSound, SOUND_EVENTS } from '../sounds';
import { SectionHeader, Card, Toggle } from './ui';

export default function SoundSettings() {
  const [prefs, setPrefs] = useState(getSoundPrefs());
  const update = (patch) => setPrefs(setSoundPrefs(patch));
  const dim = prefs.enabled ? '' : 'opacity-40 pointer-events-none';

  return (
    <div className="space-y-3">
      <SectionHeader title="Suara"
        desc="Tersimpan di browser ini. Tiap kejadian punya nada sendiri — nada naik butuh perhatian, nada turun order selesai/gugur."
        action={<Toggle on={prefs.enabled} onChange={() => update({ enabled: !prefs.enabled })} label={prefs.enabled ? 'Matikan suara' : 'Nyalakan suara'} />} />

      <Card className={dim}>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="snd-vol" className="text-xs text-surface-200">Volume</label>
          <span className="text-xs font-mono text-surface-200 tnum">{Math.round(prefs.volume * 100)}%</span>
        </div>
        <input id="snd-vol" type="range" min="0" max="1" step="0.05" value={prefs.volume}
          onChange={e => update({ volume: parseFloat(e.target.value) })}
          onMouseUp={() => previewSound('newOrder')}
          onTouchEnd={() => previewSound('newOrder')}
          className="w-full accent-brand-500 cursor-pointer" />
      </Card>

      <div className={`card divide-y divide-surface-700 ${dim}`}>
        {SOUND_EVENTS.map(ev => {
          const on = prefs.events[ev.key] !== false;
          return (
            <div key={ev.key} className="flex items-center gap-2 px-3 py-2">
              <button onClick={() => previewSound(ev.key)} aria-label={`Dengarkan ${ev.label}`}
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-brand-300 hover:bg-brand-500/15 transition-colors">
                <Play size={13} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-surface-50 truncate">{ev.label}</p>
                <p className="text-[11px] text-surface-300 truncate">{ev.hint}</p>
              </div>
              <Toggle small on={on} onChange={() => update({ events: { [ev.key]: !on } })} label={`Suara ${ev.label}`} />
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-surface-300">Browser baru membunyikan suara setelah ada klik pertama di halaman.</p>
    </div>
  );
}
