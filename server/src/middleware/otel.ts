import type { MiddlewareHandler } from "hono";
import { trace, context, SpanStatusCode, metrics } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const tracer = trace.getTracer("aiwork-api", "2.0.0");
const meter = metrics.getMeter("aiwork-api", "2.0.0");
const logger = logs.getLogger("aiwork-api", "2.0.0");

// ─── Metrics ────────────────────────────────────────────────────
const httpRequestCounter = meter.createCounter("http.server.requests", {
  description: "Total HTTP requests",
});
const httpErrorCounter = meter.createCounter("http.server.errors", {
  description: "Total HTTP errors (4xx/5xx)",
});
const httpDurationHistogram = meter.createHistogram("http.server.duration", {
  description: "HTTP request duration in ms",
  unit: "ms",
});
const activeRequests = meter.createUpDownCounter("http.server.active_requests", {
  description: "In-flight HTTP requests",
});

/**
 * Hono middleware that creates a span per request, records metrics,
 * and emits a structured log record to SigNoz.
 */
export const otelMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const spanName = `${method} ${path}`;
  const startMs = Date.now();

  activeRequests.add(1, { method, path });

  await tracer.startActiveSpan(spanName, async (span) => {
    span.setAttributes({
      "http.method": method,
      "http.url": c.req.url,
      "http.route": path,
      "http.scheme": "http",
      "net.host.name": "aiwork-api",
    });

    try {
      await next();
      const status = c.res.status;
      const durationMs = Date.now() - startMs;

      span.setAttributes({
        "http.status_code": status,
        "http.response_content_length": c.res.headers.get("content-length") ?? 0,
      });

      if (status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
        httpErrorCounter.add(1, { method, path, status_code: String(status) });
      } else if (status >= 400) {
        httpErrorCounter.add(1, { method, path, status_code: String(status) });
      }

      httpRequestCounter.add(1, { method, path, status_code: String(status) });
      httpDurationHistogram.record(durationMs, { method, path, status_code: String(status) });

      // Emit structured log to SigNoz
      logger.emit({
        severityNumber: status >= 500 ? SeverityNumber.ERROR : status >= 400 ? SeverityNumber.WARN : SeverityNumber.INFO,
        severityText: status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO",
        body: `${method} ${path} → ${status} (${durationMs}ms)`,
        attributes: {
          "http.method": method,
          "http.route": path,
          "http.status_code": status,
          "service.name": "aiwork-api",
          "duration_ms": durationMs,
        },
      });
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      httpErrorCounter.add(1, { method, path, status_code: "500" });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: `Unhandled error on ${method} ${path}: ${err.message}`,
        attributes: {
          "http.method": method,
          "http.route": path,
          "error.type": err.constructor?.name,
          "error.message": err.message,
        },
      });

      throw err;
    } finally {
      activeRequests.add(-1, { method, path });
      span.end();
    }
  });
};

/**
 * Emit a custom app-level log to SigNoz.
 */
export function emitLog(
  level: "info" | "warn" | "error",
  message: string,
  attrs?: Record<string, string | number | boolean>
) {
  const sevNum = level === "error" ? SeverityNumber.ERROR : level === "warn" ? SeverityNumber.WARN : SeverityNumber.INFO;
  logger.emit({
    severityNumber: sevNum,
    severityText: level.toUpperCase(),
    body: message,
    attributes: { "service.name": "aiwork-api", ...attrs },
  });
}

/**
 * Wrap an async fn in a named child span.
 */
export function withSpan<T>(name: string, fn: () => Promise<T>, attrs?: Record<string, string | number>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attrs) span.setAttributes(attrs);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
