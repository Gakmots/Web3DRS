export class ResolutionError extends Error {
  constructor(code, message, info = {}) {
    super(message);
    this.name = 'ResolutionError';
    this.code = code;
    this.info = info;
  }
}

// Keep API keys and full RPC URLs out of visible diagnostics.
export function redactDiagnostic(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
      try { return `${new URL(raw).origin}/…`; } catch { return '[URL]'; }
    })
    .replace(/((?:api[-_]?key|token|authorization|secret)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[redacted]')
    .slice(0, 600);
}

export function errorPresentation(error) {
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const info = error?.info || {};
  let message = error?.message || '解析失败，请重试。';
  if (error?.name === 'TimeoutError') message = '解析超时，请稍后重试。';
  else if (error?.type === 'AccountDoesNotExist' || error?.type === 'DomainDoesNotExist') message = '未找到这个 SNS 域名。请确认拼写，以及 RPC 是否连接 Solana 主网。';
  else if (error?.type === 'InvalidInput' || error?.type === 'InvalidDomain') message = 'SNS 域名格式或子域层级不受支持。';
  // A failed JS module download is a packaging/load problem, never an RPC error.
  else if (/dynamically imported module|importing a module script|module script failed/i.test(message)) message = 'SNS 解析组件加载失败。请完整解压安装包，重新加载扩展并关闭旧的解析标签页。';
  const lines = [code && `错误：${code}`, info.stage && `阶段：${info.stage}`, info.method && `方法：${info.method}`, info.httpStatus && `HTTP：${info.httpStatus}`, info.rpcCode !== undefined && `JSON-RPC：${info.rpcCode}`, info.endpointHost && `RPC 主机：${info.endpointHost}`, info.detail && `详情：${redactDiagnostic(info.detail)}`].filter(Boolean);
  return { message: redactDiagnostic(message), detail: lines.join('\n') };
}
