import { useCallback, useEffect, useState } from 'react';
import { fetchPublicEventSettings } from '../services/registrationService.ts';
import type { EventSettings } from '../types/database.types.ts';

export const DEFAULT_SETTINGS: EventSettings = {
  id: 'default',
  event_name: 'IGNITION 2026',
  event_tagline: 'THE FRESHERS CELEBRATION',
  department_name: 'Department of Mechanical Engineering',
  institution_name: 'Parala Maharaja Engineering College',
  event_date: 'November 28, 2026',
  event_venue: 'PMEC Main Auditorium, Berhampur',
  event_description:
    'A new beginning. A new energy. An unforgettable evening of talent, music, and welcome celebrations.',
  registration_open: true,
  maximum_registrations: 500,
  updated_at: new Date().toISOString(),
  current_registrations: 0,
};

export function normalizeEventSettings(raw: unknown): EventSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_SETTINGS;
  }
  const obj = raw as Partial<EventSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...obj,
    event_name: obj.event_name || DEFAULT_SETTINGS.event_name,
    event_tagline: obj.event_tagline || DEFAULT_SETTINGS.event_tagline,
    department_name: obj.department_name || DEFAULT_SETTINGS.department_name,
    institution_name:
      obj.institution_name || DEFAULT_SETTINGS.institution_name,
    event_date: obj.event_date || DEFAULT_SETTINGS.event_date,
    event_venue: obj.event_venue || DEFAULT_SETTINGS.event_venue,
    event_description:
      obj.event_description || DEFAULT_SETTINGS.event_description,
    registration_open:
      typeof obj.registration_open === 'boolean'
        ? obj.registration_open
        : DEFAULT_SETTINGS.registration_open,
    maximum_registrations:
      typeof obj.maximum_registrations === 'number' &&
      Number.isFinite(obj.maximum_registrations)
        ? obj.maximum_registrations
        : DEFAULT_SETTINGS.maximum_registrations,
    current_registrations:
      typeof obj.current_registrations === 'number' &&
      Number.isFinite(obj.current_registrations)
        ? obj.current_registrations
        : 0,
  };
}

export function useEventSettings() {
  const [settings, setSettingsState] =
    useState<EventSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSettings = useCallback((next: EventSettings | null | undefined) => {
    setSettingsState(normalizeEventSettings(next));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPublicEventSettings();
      setSettingsState(normalizeEventSettings(data));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load event settings.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { settings, setSettings, loading, error, reload };
}
