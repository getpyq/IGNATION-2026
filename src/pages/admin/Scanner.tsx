import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
} from 'html5-qrcode';
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  Loader2,
  QrCode,
  Search,
  SwitchCamera,
  UserCheck,
} from 'lucide-react';
import { AdminLayout } from '../../components/admin/AdminLayout.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { formatDateTime, formatFoodLabel } from '../../lib/utils.ts';
import {
  fetchCheckInList,
  manualCheckInStudent,
  scanCheckInCode,
} from '../../services/adminService.ts';
import type { RegistrationRecord } from '../../types/database.types.ts';

const SCANNER_ELEMENT_ID = 'ignition-qr-barcode-reader';

function extractCameraErrorMessage(err: unknown): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : 'Unable to access device camera.';
  const lower = raw.toLowerCase();

  if (
    lower.includes('notallowed') ||
    lower.includes('permission denied') ||
    lower.includes('permission dismissed')
  ) {
    return 'Camera permission was blocked. Allow camera access in your browser site settings (or open this page in a browser tab) and click Start Camera again.';
  }
  if (lower.includes('notfound') || lower.includes('requested device not found')) {
    return 'No camera hardware was detected on this device. Use manual Registration ID entry or student name search.';
  }
  if (lower.includes('notreadable') || lower.includes('trackstarterror')) {
    return 'Your camera is currently being used by another app or tab. Close other camera apps and try again.';
  }
  if (lower.includes('secure') || lower.includes('https')) {
    return 'Camera scanning requires an HTTPS connection.';
  }
  return raw;
}

export function Scanner() {
  const [checkedInList, setCheckedInList] = useState<RegistrationRecord[]>([]);
  const [allStudents, setAllStudents] = useState<RegistrationRecord[]>([]);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraIdx, setActiveCameraIdx] = useState(0);

  const [manualCode, setManualCode] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [checkinFilter, setCheckinFilter] = useState('');

  const [processingCode, setProcessingCode] = useState(false);
  const [scanBanner, setScanBanner] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
    detail?: string;
  } | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScannedRef = useRef<{ code: string; at: number }>({
    code: '',
    at: 0,
  });
  const scanInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);

  const loadCheckInList = useCallback(async (silent = false) => {
    if (silent && pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    if (!silent) setListLoading(true);
    try {
      const res = await fetchCheckInList();
      if (!res || typeof res !== 'object') return;
      setCheckedInList(
        Array.isArray(res.checked_in_list) ? res.checked_in_list : []
      );
      setAllStudents(Array.isArray(res.all_students) ? res.all_students : []);
      setCheckedInCount(
        typeof res.checked_in_count === 'number' ? res.checked_in_count : 0
      );
      setTotalCount(typeof res.total_count === 'number' ? res.total_count : 0);
    } catch (err) {
      if (!silent) {
        setScanBanner({
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to sync check-in records from Google Sheets.',
        });
      }
    } finally {
      pollInFlightRef.current = false;
      if (!silent) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCheckInList(false);
  }, [loadCheckInList]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadCheckInList(true);
      }
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [loadCheckInList]);

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    setCameraActive(false);
    if (!instance) return;
    try {
      await instance.stop();
    } catch {
      // ignore if already stopped
    }
    try {
      instance.clear();
    } catch {
      // ignore cleanup errors
    }
  }, []);

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, [stopCamera]);

  const playScanBeep = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1240, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    } catch {
      // ignore audio errors
    }
  };

  const applyCheckInResult = useCallback(
    (
      record: RegistrationRecord,
      newlyCheckedIn: boolean,
      alreadyCheckedIn: boolean
    ) => {
      playScanBeep();

      setAllStudents((prev) =>
        prev.map((item) => (item.id === record.id ? record : item))
      );

      setCheckedInList((prev) => {
        const exists = prev.some((item) => item.id === record.id);
        if (exists) {
          return prev.map((item) => (item.id === record.id ? record : item));
        }
        return [record, ...prev];
      });

      const detailText = `${record.pass_number} · ${formatFoodLabel(
        record.food_preference
      )} · ${record.selected_talents.join(', ')}`;

      if (newlyCheckedIn) {
        setCheckedInCount((prev) => prev + 1);
        setScanBanner({
          type: 'success',
          message: `${record.student_name} checked in — Events Joined!`,
          detail: detailText,
        });
      } else if (alreadyCheckedIn) {
        setScanBanner({
          type: 'info',
          message: `${record.student_name} is already marked Events Joined`,
          detail: detailText,
        });
      } else {
        setScanBanner({
          type: 'info',
          message: `Found registration for ${record.student_name}`,
          detail: detailText,
        });
      }
    },
    []
  );

  const handleScannedString = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || scanInFlightRef.current) return;

      const now = Date.now();
      if (
        lastScannedRef.current.code === code &&
        now - lastScannedRef.current.at < 1200
      ) {
        return;
      }
      lastScannedRef.current = { code, at: now };
      scanInFlightRef.current = true;

      setProcessingCode(true);
      try {
        const res = await scanCheckInCode(code, true);
        if (res?.record) {
          applyCheckInResult(
            res.record,
            Boolean(res.newly_checked_in),
            Boolean(res.already_checked_in)
          );
        }
      } catch (err) {
        setScanBanner({
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'No matching student pass found for this code.',
        });
      } finally {
        scanInFlightRef.current = false;
        setProcessingCode(false);
      }
    },
    [applyCheckInResult]
  );

  const startCamera = useCallback(
    async (forcedCameraIdx?: number) => {
      setCameraError(null);
      setCameraStarting(true);

      try {
        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
          throw new Error(
            'Camera API unavailable in this browser context. Ensure you are using HTTPS.'
          );
        }

        await stopCamera();

        // 1) Request permission upfront with ideal rear camera, falling back to any camera
        let tempStream: MediaStream | null = null;
        try {
          tempStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          });
        } catch {
          tempStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        if (tempStream) {
          tempStream.getTracks().forEach((track) => track.stop());
        }

        // 2) Enumerate available cameras once permission is granted
        let deviceList: CameraDevice[] = [];
        try {
          deviceList = await Html5Qrcode.getCameras();
          setCameras(deviceList);
        } catch {
          deviceList = [];
        }

        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
          ],
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
          verbose: false,
        });
        scannerRef.current = scanner;

        const scanConfig = {
          fps: 20,
          disableFlip: false,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.max(160, Math.min(300, Math.floor(minEdge * 0.78)));
            return { width: boxSize, height: Math.floor(boxSize * 0.85) };
          },
        };

        // Pick rear/environment camera by label first unless user switched camera
        let preferredIdx = 0;
        if (typeof forcedCameraIdx === 'number' && deviceList[forcedCameraIdx]) {
          preferredIdx = forcedCameraIdx;
        } else if (deviceList.length > 1) {
          const backIdx = deviceList.findIndex((c) =>
            /back|rear|environment/i.test(c.label || '')
          );
          preferredIdx = backIdx >= 0 ? backIdx : deviceList.length - 1;
        }
        setActiveCameraIdx(preferredIdx);

        // Build clean ordered fallback candidates accepted by html5-qrcode
        const candidates: Array<string | { facingMode: string }> = [];
        if (typeof forcedCameraIdx === 'number' && deviceList[forcedCameraIdx]) {
          candidates.push(deviceList[forcedCameraIdx].id);
        } else {
          if (deviceList[preferredIdx]) {
            candidates.push(deviceList[preferredIdx].id);
          }
          candidates.push({ facingMode: 'environment' });
          candidates.push({ facingMode: 'user' });
          for (const cam of deviceList) {
            if (!candidates.includes(cam.id)) {
              candidates.push(cam.id);
            }
          }
        }

        let started = false;
        let lastErr: unknown = null;
        for (const target of candidates) {
          try {
            await scanner.start(
              target,
              scanConfig,
              (decodedText) => {
                void handleScannedString(decodedText);
              },
              () => {
                // ignore per-frame decode misses
              }
            );
            started = true;
            break;
          } catch (attemptErr) {
            lastErr = attemptErr;
          }
        }

        if (!started) {
          throw lastErr || new Error('Unable to start any available camera.');
        }

        setCameraActive(true);
      } catch (err) {
        await stopCamera();
        setCameraError(extractCameraErrorMessage(err));
      } finally {
        setCameraStarting(false);
      }
    },
    [handleScannedString, stopCamera]
  );

  const handleSwitchCamera = async () => {
    if (cameras.length < 2) return;
    const nextIdx = (activeCameraIdx + 1) % cameras.length;
    await startCamera(nextIdx);
  };

  const handleManualCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    lastScannedRef.current = { code: '', at: 0 };
    await handleScannedString(manualCode.trim());
    setManualCode('');
  };

  const handleManualCheckIn = async (student: RegistrationRecord) => {
    setProcessingCode(true);
    try {
      const res = await manualCheckInStudent(student.id);
      applyCheckInResult(
        res.record,
        res.newly_checked_in,
        res.already_checked_in
      );
    } catch (err) {
      setScanBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to mark student as Events Joined.',
      });
    } finally {
      setProcessingCode(false);
    }
  };

  const matchingStudents = useMemo(() => {
    const term = studentQuery.trim().toLowerCase();
    const list = term
      ? allStudents.filter(
          (s) =>
            s.student_name.toLowerCase().includes(term) ||
            s.pass_number.toLowerCase().includes(term)
        )
      : allStudents;
    return list.slice(0, 12);
  }, [allStudents, studentQuery]);

  const filteredCheckInList = useMemo(() => {
    const term = checkinFilter.trim().toLowerCase();
    if (!term) return checkedInList;
    return checkedInList.filter(
      (s) =>
        s.student_name.toLowerCase().includes(term) ||
        s.pass_number.toLowerCase().includes(term)
    );
  }, [checkedInList, checkinFilter]);

  return (
    <AdminLayout pageTitle="Check-In Scanner">
      <div className="space-y-6">
        {/* Compact Summary Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] p-4 shadow-[4px_4px_0_0_#1b1b1b]">
          <div>
            <h2 className="font-heading text-lg font-extrabold text-[#5a0f14]">
              QR &amp; Barcode Event Check-In
            </h2>
            <p className="text-xs text-[#4a4642]">
              Scan student QR codes or barcodes to automatically mark{' '}
              <strong className="text-[#3e9b47]">Events Joined</strong>.
            </p>
          </div>

          <div className="rounded-xl border-2 border-[#1b1b1b] bg-white px-4 py-2 text-center">
            <p className="text-[10px] font-bold tracking-wider uppercase text-[#4a4642]">
              Events Joined
            </p>
            <p className="font-mono-tabular text-lg font-extrabold text-[#3e9b47]">
              {checkedInCount} / {totalCount}
            </p>
          </div>
        </div>

        {/* Instant Scan Result Feedback */}
        {scanBanner && (
          <div
            role="status"
            className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-sm font-bold shadow-[3px_3px_0_0_#1b1b1b] ${
              scanBanner.type === 'success'
                ? 'border-[#1b1b1b] bg-[#3e9b47] text-white'
                : scanBanner.type === 'error'
                  ? 'border-[#1b1b1b] bg-[#c8221a] text-white'
                  : 'border-[#1b1b1b] bg-[#ffe066] text-[#1b1b1b]'
            }`}
          >
            {scanBanner.type === 'error' ? (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p>{scanBanner.message}</p>
              {scanBanner.detail && (
                <p className="mt-0.5 text-xs font-semibold opacity-95">
                  {scanBanner.detail}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Main 2-Column Check-In Workspace */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Embedded Camera QR/Barcode Scanner + Manual Registration ID */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] p-4 shadow-[4px_4px_0_0_#1b1b1b] sm:p-5">
              {/* Single QR Scan Viewport with Start/Stop Camera Button Inside */}
              <div className="relative min-h-[270px] overflow-hidden rounded-xl border-2 border-[#1b1b1b] bg-[#1b1b1b]">
                <div id={SCANNER_ELEMENT_ID} className="w-full" />

                {!cameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#1b1b1b]/95 p-6 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-[#e0a526] bg-[#5a0f14] text-[#ffe066]">
                      <QrCode className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="font-heading text-sm font-extrabold text-[#fff4e2]">
                        QR &amp; Barcode Scanner
                      </p>
                      <p className="mt-1 text-xs text-[#fff4e2]/75">
                        Point camera at student QR code or barcode for automatic check-in.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={cameraStarting}
                      onClick={() => void startCamera()}
                      className="btn-craft-turmeric inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-extrabold uppercase disabled:opacity-50"
                    >
                      {cameraStarting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      <span>
                        {cameraStarting ? 'Starting Camera...' : 'Start Camera'}
                      </span>
                    </button>
                  </div>
                )}

                {cameraActive && (
                  <div className="absolute right-3 bottom-3 left-3 z-10 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#1b1b1b] bg-[#3e9b47]/95 px-2.5 py-1 text-[11px] font-extrabold text-white">
                      {processingCode ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-[#ffe066]" />
                      )}
                      <span>{processingCode ? 'Checking In...' : 'Scanning Live'}</span>
                    </span>

                    <div className="flex items-center gap-2">
                      {cameras.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void handleSwitchCamera()}
                          className="btn-craft-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
                        >
                          <SwitchCamera className="h-3.5 w-3.5 text-[#8e1b1b]" />
                          <span>Switch</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void stopCamera()}
                        className="btn-craft-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[#c8221a]"
                      >
                        <CameraOff className="h-3.5 w-3.5" />
                        <span>Stop Camera</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {cameraError && (
                <p className="mt-3 rounded-xl border-2 border-[#c8221a] bg-white p-2.5 text-xs font-bold text-[#c8221a]">
                  {cameraError}
                </p>
              )}

              {/* Direct Registration ID Entry */}
              <form
                onSubmit={(e) => void handleManualCodeSubmit(e)}
                className="mt-4 flex gap-2"
              >
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Enter Registration ID (e.g. IGNITION26-00001)"
                  className="flex-1 rounded-xl border-2 border-[#1b1b1b] bg-white px-3.5 py-2.5 font-mono-tabular text-xs font-bold text-[#1b1b1b] placeholder:font-sans placeholder:font-normal placeholder:text-[#4a4642]/50 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={processingCode || !manualCode.trim()}
                  className="btn-craft-turmeric rounded-xl px-4 py-2.5 text-xs font-extrabold uppercase disabled:opacity-50"
                >
                  {processingCode ? 'Checking...' : 'Check In'}
                </button>
              </form>
            </div>
          </div>

          {/* Right: No QR Code? Select Student by Name */}
          <div className="lg:col-span-6">
            <div className="flex h-full flex-col rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] p-4 shadow-[4px_4px_0_0_#1b1b1b] sm:p-5">
              <h3 className="font-heading text-base font-extrabold text-[#5a0f14]">
                No QR Code? Select Student by Name
              </h3>
              <p className="mt-0.5 text-xs text-[#4a4642]">
                Search registered students by name or Registration ID to mark Events Joined.
              </p>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#4a4642]" />
                <input
                  type="search"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  placeholder="Type student name or IGNITION26-..."
                  className="w-full rounded-xl border-2 border-[#1b1b1b] bg-white py-2.5 pr-3 pl-9 text-sm font-medium text-[#1b1b1b] placeholder:text-[#4a4642]/50 focus:outline-none"
                />
              </div>

              <div className="mt-3 max-h-[260px] flex-1 divide-y divide-[#1b1b1b]/15 overflow-y-auto rounded-xl border-2 border-[#1b1b1b] bg-white">
                {listLoading ? (
                  <div className="p-4 text-center text-xs text-[#4a4642]">
                    Loading registered students...
                  </div>
                ) : matchingStudents.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#4a4642]">
                    No students match &ldquo;{studentQuery}&rdquo;.
                  </div>
                ) : (
                  matchingStudents.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[#fff4e2]/70"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#5a0f14]">
                          {s.student_name}
                        </p>
                        <p className="font-mono-tabular text-[11px] text-[#4a4642]">
                          {s.pass_number} · {formatFoodLabel(s.food_preference)}
                        </p>
                      </div>

                      {s.checked_in ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border-2 border-[#1b1b1b] bg-[#3e9b47] px-2.5 py-1 text-[11px] font-bold text-white shrink-0">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Joined</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={processingCode}
                          onClick={() => void handleManualCheckIn(s)}
                          className="btn-craft-primary rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase shrink-0 disabled:opacity-50"
                        >
                          Mark Joined
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Checked-In Students List & Time */}
        <div className="overflow-hidden rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] shadow-[4px_4px_0_0_#1b1b1b]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#1b1b1b] bg-[#f6efe2] px-5 py-4">
            <div>
              <h3 className="font-heading text-base font-extrabold text-[#5a0f14]">
                Checked-In Students List &amp; Time ({checkedInList.length})
              </h3>
              <p className="mt-0.5 text-xs text-[#4a4642]">
                Real-time log of students marked as Events Joined synced with Google Sheets
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[#4a4642]" />
              <input
                type="search"
                value={checkinFilter}
                onChange={(e) => setCheckinFilter(e.target.value)}
                placeholder="Filter checked-in students..."
                className="w-full rounded-xl border-2 border-[#1b1b1b] bg-white py-2 pr-3 pl-8 text-xs font-medium text-[#1b1b1b] focus:outline-none"
              />
            </div>
          </div>

          {listLoading ? (
            <div className="p-8 text-center text-sm text-[#4a4642]">
              Loading checked-in students...
            </div>
          ) : filteredCheckInList.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<UserCheck className="h-6 w-6" />}
                title="No checked-in students yet"
                description="Scanned or manually checked-in students will appear here with their check-in timestamps."
              />
            </div>
          ) : (
            <div className="overflow-x-auto bg-white">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-[#1b1b1b] bg-[#f6efe2]/70 text-xs font-bold uppercase text-[#5a0f14]">
                    <th className="px-4 py-3">Registration ID</th>
                    <th className="px-4 py-3">Student Name</th>
                    <th className="px-4 py-3">Talents</th>
                    <th className="px-4 py-3">Food</th>
                    <th className="px-4 py-3">Check-In Time</th>
                    <th className="px-4 py-3">Checked In By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b1b1b]/15">
                  {filteredCheckInList.map((r) => (
                    <tr key={r.id} className="hover:bg-[#fff4e2]/75">
                      <td className="px-4 py-3 font-mono-tabular text-xs font-bold text-[#8e1b1b]">
                        {r.pass_number}
                      </td>
                      <td className="px-4 py-3 font-bold text-[#5a0f14]">
                        {r.student_name}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-xs font-semibold text-[#4a4642]">
                        {r.selected_talents.join(' · ')}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold">
                        <span
                          className={
                            r.food_preference === 'vegetarian'
                              ? 'text-[#3e9b47]'
                              : 'text-[#8e1b1b]'
                          }
                        >
                          {formatFoodLabel(r.food_preference)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-xs font-semibold text-[#1b1b1b]">
                        {r.checkin_time ? formatDateTime(r.checkin_time) : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4642]">
                        {r.checked_in_by || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
