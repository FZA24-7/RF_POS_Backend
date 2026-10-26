export const ErrorBanner = ({ message }: { message: string }) => (
  <div
    role="alert"
    className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
  >
    {message}
  </div>
);
