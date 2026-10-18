// Voiceprint speaker-recognition settings: the opt-in toggle plus the
// list of enrolled speaker identities (rename/delete, delete-all).
//
// Voiceprints are biometric data. They exist only when this is switched
// on, live only in the local database, and turning the feature off wipes
// every stored embedding and identity in the same action — the confirm
// copy says exactly that before it happens.

import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { logger } from '../utils/logger';

interface IdentityRow {
  id: string;
  name: string;
  embedding_count: number;
}

export const SpeakerIdentitiesSettings: React.FC = () => {
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [identities, setIdentities] = useState<IdentityRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [flag, rows] = await Promise.all([
        window.electronAPI.db.settings.get('enableVoiceprints'),
        window.electronAPI.db.speakerIdentities.list(),
      ]);
      setEnabled(flag === 'true');
      setIdentities(rows);
    } catch (err) {
      logger.warn('Failed to load speaker identities:', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (checked: boolean) => {
    if (!checked && identities.length > 0) {
      const ok = window.confirm(
        'Turn off voiceprint recognition and delete all stored voiceprints ' +
          `(${identities.length} identit${identities.length === 1 ? 'y' : 'ies'})? ` +
          'Speaker names on transcripts are kept; only the voiceprints are removed.'
      );
      if (!ok) return;
      await window.electronAPI.db.speakerIdentities.deleteAllVoiceprints();
      setIdentities([]);
      showToast({ kind: 'success', title: 'Voiceprints deleted', duration: 4000 });
    }
    setEnabled(checked);
    await window.electronAPI.db.settings.set('enableVoiceprints', checked.toString());
  };

  const rename = async (row: IdentityRow) => {
    const name = window.prompt('Rename speaker identity', row.name);
    if (!name?.trim() || name.trim() === row.name) return;
    await window.electronAPI.db.speakerIdentities.rename(row.id, name.trim());
    void load();
  };

  const remove = async (row: IdentityRow) => {
    if (!window.confirm(`Delete the “${row.name}” identity? Its voiceprint links are removed; transcript speaker names are kept.`)) return;
    await window.electronAPI.db.speakerIdentities.delete(row.id);
    void load();
  };

  if (!loaded) return null;

  return (
    <div className="mt-4">
      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          className="rounded text-primary-800 focus:ring-primary-500"
        />
        <span className="text-sm font-medium text-surface-700">
          Recognise speakers across recordings (voiceprints)
        </span>
      </label>
      <p className="text-xs text-surface-500 ml-6">
        Off by default. When on, a voiceprint embedding for each diarised speaker is
        stored locally (never leaves this device) so naming a speaker once lets
        Debrief suggest that name in future recordings. Suggestions are never
        applied without your confirmation. Turning this off deletes all stored
        voiceprints.
      </p>

      {enabled && identities.length > 0 && (
        <div className="ml-6 mt-3 space-y-1">
          {identities.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-surface-700">
                {row.name}
                <span className="text-surface-400 text-xs ml-2">
                  {row.embedding_count} recording{row.embedding_count === 1 ? '' : 's'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <button
                  onClick={() => void rename(row)}
                  className="text-xs text-primary-700 underline decoration-dotted underline-offset-2"
                >
                  Rename
                </button>
                <button
                  onClick={() => void remove(row)}
                  className="text-surface-400 hover:text-red-600"
                  title={`Delete ${row.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {enabled && identities.length === 0 && (
        <p className="text-xs text-surface-500 ml-6 mt-2">
          No identities yet — name a speaker in any transcript and their voiceprint
          is enrolled for future suggestions.
        </p>
      )}
    </div>
  );
};
