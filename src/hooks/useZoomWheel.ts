import { useEffect, useRef } from "react";
import { useUiStore, ZOOM_STEP } from "../stores/uiStore";

/**
 * 阶段7-T1 全局缩放：阅读页根容器挂 Ctrl+滚轮缩放（0.7–2.0，步进 0.1），
 * 对照/紧跟/原版三种内容形态统一生效（zoom 写 uiStore 并持久化）。
 *
 * 实现要点：
 * - `preventDefault` 阻止 WebView2 的浏览器级 Ctrl+滚轮页面缩放
 *   （Chromium 语义：非被动监听可拦截）；
 * - `stopPropagation`：未来若出现多层容器各自挂 hook，防止重复步进；
 * - 150ms 防抖「累积」提交：连续滚动结束后按累积齿数一次步进，
 *   重排版避免高频 reflow、原版模式避免高频 canvas 重渲染（任务 §5 缓解）；
 *   ±按钮等精确路径直接走 uiStore.stepZoom，不经防抖。
 */
export function useZoomWheel<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | null = null;
    let pending = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      pending += e.deltaY < 0 ? 1 : -1;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        useUiStore.getState().stepZoom(pending * ZOOM_STEP);
        pending = 0;
      }, 150);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      pending = 0;
    };
  }, []);
  return ref;
}
