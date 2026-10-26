export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div
    className="flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400"
    role="status"
  >
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-slate-600 dark:border-t-brand-400" />
    {label}
  </div>
);
