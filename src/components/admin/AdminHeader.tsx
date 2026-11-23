import { Menu } from 'lucide-react';

export function AdminHeader({
  eventName,
  pageTitle,
  onOpenMobileMenu,
}: {
  eventName: string;
  pageTitle?: string;
  onOpenMobileMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b-2 border-[#1b1b1b] bg-[#fffaf0]/95 px-4 py-3.5 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="btn-craft-secondary inline-flex h-10 w-10 items-center justify-center rounded-xl lg:hidden shrink-0"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0">
          <p className="font-brand text-xs font-bold tracking-wider uppercase text-[#8e1b1b] truncate">
            {eventName}
          </p>
          <h1 className="truncate font-heading text-base font-extrabold text-[#5a0f14] sm:text-lg">
            {pageTitle || 'Registrations Overview'}
          </h1>
        </div>
      </div>
    </header>
  );
}
