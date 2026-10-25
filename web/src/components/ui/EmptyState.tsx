export const EmptyState = ({ title, description }: { title: string; description?: string }) => (
  <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</p>
    {description ? (
      <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
    ) : null}
  </div>
);
