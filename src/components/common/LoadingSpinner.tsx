export default function LoadingSpinner({ text = "处理中..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      <p className="mt-3 text-gray-500 text-sm">{text}</p>
    </div>
  );
}
