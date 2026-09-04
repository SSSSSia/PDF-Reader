/// <reference types="vite/client" />

// pdfjs 的 worker 通过 Vite `?url` 后缀作为静态资源导入，类型由 vite/client 覆盖，
// 但若解析异常，这里兜底声明，避免 tsc 报 “Cannot find module ... ?url”。
declare module "*?url" {
  const src: string;
  export default src;
}
