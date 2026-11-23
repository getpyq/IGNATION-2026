import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Leaf, QrCode, UserCheck, Users, Utensils } from 'lucide-react';
import { AdminLayout } from '../../components/admin/AdminLayout.tsx';
import { ExportCenter } from '../../components/admin/ExportCenter.tsx';
import { StatCard } from '../../components/admin/StatCard.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { useEventSettings } from '../../hooks/useEventSettings.ts';
import { formatDateTime, formatFoodLabel } from '../../lib/utils.ts';
import { fetchAdminOverview } from '../../services/adminService.ts';
import type { AdminOverviewSummary } from '../../types/database.types.ts';

export function Dashboard() {
  const { settings } = useEventSettings();
  const [data, setData] = useState<AdminOverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const pollInFlightRef = useRef(false);

  const loadOverview = useCallback(async (silent = false) => {
    if (silent && pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await fetchAdminOverview();
      if (res && typeof res === 'object') {
        setData({
          ...res,
          recent_registrations: Array.isArray(res.recent_registrations)
            ? res.recent_registrations
            : [],
        });
      }
    } catch {
      // keep existing state cleanly on silent background refresh errors
    } finally {
      pollInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(false);
  }, [loadOverview]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadOverview(true);
      }
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [loadOverview]);

  return (
    <AdminLayout pageTitle="Overview">
      <div className="space-y-6">
        {loading || !data ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-24 animate-pulse rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0]"
              />
            ))}
          </div>
        ) : (
          <>
            {/* 2-Column Count Summary Grid */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <StatCard
                label="Total Registrations"
                value={data.total_registrations}
                icon={<Users className="h-5 w-5" />}
                accentClass="text-[#8e1b1b]"
              />
              <StatCard
                label="Events Joined"
                value={data.checked_in_count}
                icon={<UserCheck className="h-5 w-5" />}
                accentClass="text-[#3e9b47]"
              />
              <StatCard
                label="Vegetarian"
                value={data.vegetarian_count}
                icon={<Leaf className="h-5 w-5" />}
                accentClass="text-[#3e9b47]"
              />
              <StatCard
                label="Non-Vegetarian"
                value={data.non_vegetarian_count}
                icon={<Utensils className="h-5 w-5" />}
                accentClass="text-[#d97706]"
              />
            </div>

            {/* Registrations List */}
            <div className="overflow-hidden rounded-2xl border-2 border-[#1b1b1b] bg-[#fffaf0] shadow-[4px_4px_0_0_#1b1b1b]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#1b1b1b] bg-[#f6efe2] px-5 py-4">
                <div>
                  <h2 className="font-heading text-base font-extrabold text-[#5a0f14]">
                    Registrations List
                  </h2>
                  <p className="mt-0.5 text-xs text-[#4a4642]">
                    Live student registration entries and check-in status
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    to="/admin/scanner"
                    className="btn-craft-turmeric inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-extrabold tracking-wider uppercase whitespace-nowrap"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span>OPEN SCANNER</span>
                  </Link>
                  <Link
                    to="/admin/registrations"
                    className="btn-craft-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold tracking-wider uppercase whitespace-nowrap"
                  >
                    <span>VIEW ALL REGISTRATIONS</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              {data.recent_registrations.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<Users className="h-6 w-6" />}
                    title="No registrations yet"
                    description="Student registration entries and counts will appear here as soon as students register."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto bg-white">
                  <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b-2 border-[#1b1b1b] bg-[#f6efe2]/70 text-xs font-bold uppercase text-[#5a0f14]">
                        <th className="px-4 py-3">Registration ID</th>
                        <th className="px-4 py-3">Student Name</th>
                        <th className="px-4 py-3">Talents</th>
                        <th className="px-4 py-3">Food Preference</th>
                        <th className="px-4 py-3">Check-In</th>
                        <th className="px-4 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b1b1b]/15">
                      {data.recent_registrations.map((r) => (
                        <tr key={r.id} className="hover:bg-[#fff4e2]/65">
                          <td className="px-4 py-3 font-mono-tabular text-xs font-bold text-[#8e1b1b]">
                            {r.pass_number}
                          </td>
                          <td className="px-4 py-3 font-bold text-[#5a0f14]">
                            {r.student_name}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold text-[#8e1b1b]">
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
                          <td className="px-4 py-3 text-xs font-bold">
                            {r.checked_in ? (
                              <span className="text-[#3e9b47]">
                                Events Joined
                              </span>
                            ) : (
                              <span className="text-[#4a4642]">Pending</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-xs text-[#4a4642]">
                            {formatDateTime(r.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Integrated Data Export Center */}
            <ExportCenter
              settings={settings}
              sourceRecords={data.recent_registrations}
            />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
