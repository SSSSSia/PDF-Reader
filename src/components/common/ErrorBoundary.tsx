import { Component } from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  stack: string;
}

/**
 * 全局错误边界。崩溃时展示错误详情 + 重新加载（而不是静默白屏），
 * 详情供用户截图反馈、开发者定位根因。
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "", stack: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || String(error),
      stack: error?.stack || "",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-800">
            <p className="text-base font-semibold text-red-600 dark:text-red-400">
              页面发生错误
            </p>
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-left text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              {this.state.message || "未知错误"}
              {this.state.stack ? `\n\n${this.state.stack}` : ""}
            </pre>
            <div className="mt-4 flex justify-center gap-2">
              <button
                onClick={() => this.setState({ hasError: false, message: "", stack: "" })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                返回应用
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-700"
              >
                重新加载
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
