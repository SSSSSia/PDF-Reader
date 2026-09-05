export default function LoadingSpinner({ text = "处理中..." }: { text?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center p-8"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-blue-200 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400"
        aria-hidden="true"
      />
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}
