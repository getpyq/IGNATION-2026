import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Square,
  Ticket,
} from 'lucide-react';
import { EventPass } from '../pass/EventPass.tsx';
import { EventPoster } from '../poster/EventPoster.tsx';
import {
  downloadNodeAsPng,
  exportRegistrationsCsv,
  exportRegistrationsExcel,
  exportRegistrationsJson,
  exportRegistrationsPdf,
  sanitizeFilename,
} from '../../lib/exportHelpers.ts';
import { fetchExportDataset } from '../../services/exportService.ts';
import {
  TALENT_OPTIONS,
  type EventSettings,
  type RegistrationRecord,
} from '../../types/database.types.ts';

type ReportPreset =
  | 'complete'
  | 'vegetarian'
  | 'non_vegetarian'
  | 'talent_wise'
  | 'custom_talents'
  | 'full_event_report';

const REPORT_LABELS: Record<ReportPreset, string> = {
  complete: 'Complete Student Registration List',
  vegetarian: 'Vegetarian Student List',
  non_vegetarian: 'Non-Vegetarian Student List',
  talent_wise: 'Talent-Wise Student List',
  custom_talents: 'Custom Talent (Other) Responses',
  full_event_report: 'Complete Event Registration Report',
};

export function ExportCenter({
  settings,
  sourceRecords,
}: {
  settings: EventSettings;
  sourceRecords?: RegistrationRecord[];
}) {
  const [preset, setPreset] = useState<ReportPreset>('complete');
  const [foodFilter, setFoodFilter] = useState('');
  const [talentFilter, setTalentFilter] = useState('');
  const [fetchedRecords, setFetchedRecords] = useState<RegistrationRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!sourceRecords);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [bulkRecord, setBulkRecord] = useState<RegistrationRecord | null>(null);
  const [bulkMode, setBulkMode] = useState<'poster' | 'pass'>('poster');

  const offscreenPosterRef = useRef<HTMLDivElement | null>(null);
  const offscreenPassRef = useRef<HTMLDivElement | null>(null);
  const pollInFlightRef = useRef(false);

  const effectiveFood =
    preset === 'vegetarian'
      ? 'vegetarian'
      : preset === 'non_vegetarian'
        ? 'non_vegetarian'
        : foodFilter;

  const effectiveTalent =
    preset === 'custom_talents' ? 'Other' : talentFilter;

  const loadExportRecords = useCallback(
    async (silent = false) => {
      if (sourceRecords) return;
      if (silent && pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      if (!silent) setLoading(true);
      try {
        const list = await fetchExportDataset({
          food: effectiveFood || undefined,
          talent: effectiveTalent || undefined,
        });
        setFetchedRecords(list);
      } catch {
        // retain existing records cleanly on transient background poll failures
      } finally {
        pollInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [sourceRecords, effectiveFood, effectiveTalent]
  );

  useEffect(() => {
    if (sourceRecords) {
      setLoading(false);
      return;
    }
    void loadExportRecords(false);
  }, [sourceRecords, loadExportRecords]);

  useEffect(() => {
    if (sourceRecords) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadExportRecords(true);
      }
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [sourceRecords, loadExportRecords]);

  const records = useMemo(() => {
    const base = sourceRecords ?? fetchedRecords;
    return base.filter((r) => {
      if (effectiveFood && r.food_preference !== effectiveFood) return false;
      if (effectiveTalent && !r.selected_talents.includes(effectiveTalent)) {
        return false;
      }
      if (
        preset === 'custom_talents' &&
        !r.other_talent_description?.trim()
      ) {
        return false;
      }
      return true;
    });
  }, [sourceRecords, fetchedRecords, effectiveFood, effectiveTalent, preset]);

  useEffect(() => {
    const validIds = new Set(records.map((r) => r.id));
    setSelectedIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [records]);

  const targetRecords =
    selectedIds.length > 0
      ? records.filter((r) => selectedIds.includes(r.id))
      : records;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === records.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(records.map((r) => r.id));
    }
  };

  const runExport = (format: 'csv' | 'excel' | 'pdf' | 'json') => {
    if (targetRecords.length === 0) {
      setStatusMsg('No matching registration records to export.');
      return;
    }
    const base = `${sanitizeFilename(settings.event_name)}-${preset}`;
    if (format === 'csv') {
      exportRegistrationsCsv(targetRecords, `${base}.csv`);
    } else if (format === 'excel') {
      exportRegistrationsExcel(targetRecords, settings, `${base}.xlsx`);
    } else if (format === 'pdf') {
      exportRegistrationsPdf(
        targetRecords,
        settings,
        REPORT_LABELS[preset],
        `${base}.pdf`
      );
    } else {
      exportRegistrationsJson(targetRecords, `${base}.json`);
    }
    setStatusMsg(
      `Exported ${targetRecords.length} record${targetRecords.length === 1 ? '' : 's'} as ${format.toUpperCase()}.`
    );
  };

  const runBulkAssetDownload = async (mode: 'poster' | 'pass') => {
    const batch = targetRecords.slice(0, 25);
    if (batch.length === 0) {
      setStatusMsg('Select or filter at least one student first.');
      return;
    }
    setBulkMode(mode);
    for (let i = 0; i < batch.length; i += 1) {
      const rec = batch[i];
      setBulkRecord(rec);
      setBulkProgress(`Generating ${mode} ${i + 1} of ${batch.length}...`);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const node =
        mode === 'poster'
          ? offscreenPosterRef.current
          : offscreenPassRef.current;
      if (node) {
        const fname = `${sanitizeFilename(settings.event_name)}-${mode}-${sanitizeFilename(
          rec.pass_number
        )}.png`;
        await downloadNodeAsPng(node, fname);
      }
    }
    setBulkRecord(null);
    setBulkProgress(null);
    setStatusMsg(
      `Downloaded ${batch.length} ${mode === 'poster' ? 'posters' : 'welcome passes'}.`
    );
  };

  return (
    <div className="space-y-4">
      {/* Report Configuration Card */}
      <div className="rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] p-5 shadow-[4px_4px_0_0_#1b1b1b]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-heading text-base font-extrabold text-[#5a0f14]">
              Data Export &amp; Reports
            </h2>
            <p className="mt-0.5 text-xs text-[#4a4642]">
              Export filtered student registrations in CSV, Excel, PDF, JSON, or bulk passes.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <div>
            <label className="block text-xs font-bold uppercase text-[#5a0f14]">
              Report Type
            </label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as ReportPreset)}
              className="mt-1.5 w-full rounded-xl border-2 border-[#1b1b1b] bg-white px-3 py-2 text-sm font-medium text-[#1b1b1b] focus:outline-none"
            >
              {Object.entries(REPORT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-[#5a0f14]">
              Food Preference
            </label>
            <select
              disabled={preset === 'vegetarian' || preset === 'non_vegetarian'}
              value={
                preset === 'vegetarian'
                  ? 'vegetarian'
                  : preset === 'non_vegetarian'
                    ? 'non_vegetarian'
                    : foodFilter
              }
              onChange={(e) => setFoodFilter(e.target.value)}
              className="mt-1.5 w-full rounded-xl border-2 border-[#1b1b1b] bg-white px-3 py-2 text-sm font-medium text-[#1b1b1b] focus:outline-none disabled:opacity-50"
            >
              <option value="">All</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="non_vegetarian">Non-Vegetarian</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-[#5a0f14]">
              Talent Filter
            </label>
            <select
              disabled={preset === 'custom_talents'}
              value={preset === 'custom_talents' ? 'Other' : talentFilter}
              onChange={(e) => setTalentFilter(e.target.value)}
              className="mt-1.5 w-full rounded-xl border-2 border-[#1b1b1b] bg-white px-3 py-2 text-sm font-medium text-[#1b1b1b] focus:outline-none disabled:opacity-50"
            >
              <option value="">All Talents</option>
              {TALENT_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Export Format Buttons */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            disabled={loading || targetRecords.length === 0}
            onClick={() => runExport('csv')}
            className="btn-craft-secondary flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
          >
            <Download className="h-4 w-4 text-[#8e1b1b]" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            disabled={loading || targetRecords.length === 0}
            onClick={() => runExport('excel')}
            className="btn-craft-secondary flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4 text-[#3e9b47]" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            disabled={loading || targetRecords.length === 0}
            onClick={() => runExport('pdf')}
            className="btn-craft-secondary flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
          >
            <FileText className="h-4 w-4 text-[#c8221a]" />
            <span>Export PDF</span>
          </button>

          <button
            type="button"
            disabled={loading || targetRecords.length === 0}
            onClick={() => runExport('json')}
            className="btn-craft-turmeric flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
          >
            <FileJson className="h-4 w-4 text-[#1b1b1b]" />
            <span>Export JSON</span>
          </button>
        </div>

        {/* Bulk Poster & Welcome Pass Download */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t-2 border-[#1b1b1b]/15 pt-4">
          <p className="text-xs font-medium text-[#4a4642]">
            {selectedIds.length > 0 ? (
              <>
                <strong className="font-mono-tabular text-[#5a0f14]">
                  {selectedIds.length}
                </strong>{' '}
                selected students ready for export or bulk download
              </>
            ) : (
              <>
                <strong className="font-mono-tabular text-[#5a0f14]">
                  {records.length}
                </strong>{' '}
                filtered students matched (select specific rows below or export all)
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={Boolean(bulkProgress) || targetRecords.length === 0}
              onClick={() => void runBulkAssetDownload('poster')}
              className="btn-craft-secondary inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-40"
            >
              <ImageIcon className="h-3.5 w-3.5 text-[#8e1b1b]" />
              <span>Bulk Posters (PNG)</span>
            </button>
            <button
              type="button"
              disabled={Boolean(bulkProgress) || targetRecords.length === 0}
              onClick={() => void runBulkAssetDownload('pass')}
              className="btn-craft-secondary inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-40"
            >
              <Ticket className="h-3.5 w-3.5 text-[#3e9b47]" />
              <span>Bulk Welcome Passes (PNG)</span>
            </button>
          </div>
        </div>

        {(bulkProgress || statusMsg) && (
          <p className="mt-3 flex items-center gap-2 text-xs font-bold text-[#3e9b47]">
            {bulkProgress && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{bulkProgress || statusMsg}</span>
          </p>
        )}
      </div>

      {/* Student Selection Preview Table */}
      <div className="overflow-hidden rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] shadow-[4px_4px_0_0_#1b1b1b]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#1b1b1b] bg-[#f6efe2] px-4 py-3">
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex items-center gap-2 text-xs font-bold text-[#5a0f14] hover:text-[#8e1b1b]"
          >
            {records.length > 0 && selectedIds.length === records.length ? (
              <CheckSquare className="h-4 w-4 text-[#8e1b1b]" />
            ) : (
              <Square className="h-4 w-4 text-[#4a4642]" />
            )}
            <span>Select All Matching ({records.length})</span>
          </button>
          <span className="text-xs font-medium text-[#4a4642]">
            Bulk image downloads process up to 25 students per batch
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-[#4a4642]">
            Loading matching records...
          </div>
        ) : records.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#4a4642]">
            No records match the selected filters.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-[#1b1b1b]/15 bg-white">
            {records.map((r) => {
              const checked = selectedIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleSelect(r.id)}
                  className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm transition-colors ${
                    checked ? 'bg-[#e0a526]/20' : 'hover:bg-[#fff4e2]/65'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {checked ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-[#8e1b1b]" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-[#4a4642]" />
                    )}
                    <span className="truncate font-bold text-[#5a0f14]">
                      {r.student_name}
                    </span>
                    <span className="hidden truncate text-xs text-[#4a4642] sm:inline">
                      {r.selected_talents.join(' · ')}
                    </span>
                  </div>
                  <span className="font-mono-tabular text-xs font-bold text-[#8e1b1b] shrink-0">
                    {r.pass_number}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Offscreen Bulk Render Stage */}
      {bulkRecord && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed -left-[9999px] top-0 opacity-100"
        >
          {bulkMode === 'poster' ? (
            <EventPoster
              ref={offscreenPosterRef}
              data={bulkRecord}
              settings={settings}
            />
          ) : (
            <EventPass
              ref={offscreenPassRef}
              data={{
                ...bulkRecord,
                verification_token:
                  bulkRecord.admin_qr_token || bulkRecord.pass_number,
              }}
              settings={settings}
            />
          )}
        </div>
      )}
    </div>
  );
}
