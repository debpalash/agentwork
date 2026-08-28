/**
 * Collagent OpenTelemetry Bootstrap
 * Import this FIRST before any other module.
 * Sends traces + logs to SigNoz via OTLP (http://aiwork-otel-collector:4318).
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://aiwork-otel-collector:4318";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "aiwork-api";
const SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION || "2.0.0";
const ENVIRONMENT = process.env.NODE_ENV || "development";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  "deployment.environment": ENVIRONMENT,
  "platform": "Collagent",
  "chain": "Base (EVM)",
});

const traceExporter = new OTLPTraceExporter({
  url: `${OTEL_ENDPOINT}/v1/traces`,
  headers: {},
});

const logExporter = new OTLPLogExporter({
  url: `${OTEL_ENDPOINT}/v1/logs`,
  headers: {},
});

const metricExporter = new OTLPMetricExporter({
  url: `${OTEL_ENDPOINT}/v1/metrics`,
  headers: {},
});

export const sdk = new NodeSDK({
  resource,
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
  metricReaders: [new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15_000,
  })],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
    }),
  ],
});

sdk.start();
console.log(`[OTel] Tracing → ${OTEL_ENDPOINT} | service=${SERVICE_NAME} env=${ENVIRONMENT}`);

// Flush telemetry without letting an unavailable collector block shutdown.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  void Promise.race([sdk.shutdown(), deadline]).finally(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
