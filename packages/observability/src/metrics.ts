export type MetricLabels = Record<string, string | number | boolean>;

type Series = { labels: Record<string, string>; value: number };
type HistogramSeries = {
  labels: Record<string, string>;
  count: number;
  sum: number;
  bucketCounts: number[];
};

type CounterDefinition = {
  type: "counter";
  help: string;
  labelNames: readonly string[];
  series: Map<string, Series>;
};

type GaugeDefinition = {
  type: "gauge";
  help: string;
  labelNames: readonly string[];
  series: Map<string, Series>;
};

type HistogramDefinition = {
  type: "histogram";
  help: string;
  labelNames: readonly string[];
  buckets: readonly number[];
  series: Map<string, HistogramSeries>;
};

type Definition = CounterDefinition | GaugeDefinition | HistogramDefinition;

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function assertMetricName(name: string) {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error(`Invalid Prometheus metric name: ${name}`);
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function normalizeLabels(labelNames: readonly string[], labels: MetricLabels): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const name of labelNames) {
    const value = labels[name];
    if (value === undefined) throw new Error(`Missing metric label: ${name}`);
    normalized[name] = String(value);
  }
  return normalized;
}

function seriesKey(labels: Record<string, string>): string {
  return JSON.stringify(labels);
}

function labelText(labels: Record<string, string>, extra?: [string, string]): string {
  const entries = Object.entries(labels);
  if (extra) entries.push(extra);
  if (!entries.length) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

export class MetricsRegistry {
  readonly contentType = "text/plain; version=0.0.4; charset=utf-8";
  private readonly definitions = new Map<string, Definition>();

  defineCounter(name: string, help: string, labelNames: readonly string[] = []) {
    this.define(name, { type: "counter", help, labelNames, series: new Map() });
  }

  defineGauge(name: string, help: string, labelNames: readonly string[] = []) {
    this.define(name, { type: "gauge", help, labelNames, series: new Map() });
  }

  defineHistogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {
    const sorted = [...buckets].sort((a, b) => a - b);
    if (!sorted.length || sorted.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Histogram ${name} needs positive finite buckets`);
    }
    this.define(name, { type: "histogram", help, labelNames, buckets: sorted, series: new Map() });
  }

  incCounter(name: string, labels: MetricLabels = {}, value = 1) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Counter ${name} cannot increase by ${value}`);
    const definition = this.get(name, "counter");
    const normalized = normalizeLabels(definition.labelNames, labels);
    const key = seriesKey(normalized);
    const current = definition.series.get(key);
    definition.series.set(key, { labels: normalized, value: (current?.value ?? 0) + value });
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}) {
    if (!Number.isFinite(value)) throw new Error(`Gauge ${name} needs a finite value`);
    const definition = this.get(name, "gauge");
    const normalized = normalizeLabels(definition.labelNames, labels);
    definition.series.set(seriesKey(normalized), { labels: normalized, value });
  }

  incGauge(name: string, labels: MetricLabels = {}, value = 1) {
    const definition = this.get(name, "gauge");
    const normalized = normalizeLabels(definition.labelNames, labels);
    const key = seriesKey(normalized);
    const current = definition.series.get(key);
    definition.series.set(key, { labels: normalized, value: (current?.value ?? 0) + value });
  }

  observeHistogram(name: string, value: number, labels: MetricLabels = {}) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Histogram ${name} needs a non-negative finite value`);
    const definition = this.get(name, "histogram");
    const normalized = normalizeLabels(definition.labelNames, labels);
    const key = seriesKey(normalized);
    const current = definition.series.get(key) ?? {
      labels: normalized,
      count: 0,
      sum: 0,
      bucketCounts: definition.buckets.map(() => 0),
    };

    current.count += 1;
    current.sum += value;
    const bucketIndex = definition.buckets.findIndex((bucket) => value <= bucket);
    if (bucketIndex >= 0) current.bucketCounts[bucketIndex] = (current.bucketCounts[bucketIndex] ?? 0) + 1;
    definition.series.set(key, current);
  }

  render(): string {
    const lines: string[] = [];
    const definitions = [...this.definitions.entries()].sort(([a], [b]) => a.localeCompare(b));

    for (const [name, definition] of definitions) {
      lines.push(`# HELP ${name} ${escapeHelp(definition.help)}`);
      lines.push(`# TYPE ${name} ${definition.type}`);

      if (definition.type === "histogram") {
        for (const series of definition.series.values()) {
          let cumulative = 0;
          for (let index = 0; index < definition.buckets.length; index += 1) {
            cumulative += series.bucketCounts[index] ?? 0;
            const bucket = definition.buckets[index];
            lines.push(`${name}_bucket${labelText(series.labels, ["le", String(bucket)])} ${cumulative}`);
          }
          lines.push(`${name}_bucket${labelText(series.labels, ["le", "+Inf"])} ${series.count}`);
          lines.push(`${name}_sum${labelText(series.labels)} ${series.sum}`);
          lines.push(`${name}_count${labelText(series.labels)} ${series.count}`);
        }
      } else {
        for (const series of definition.series.values()) {
          lines.push(`${name}${labelText(series.labels)} ${series.value}`);
        }
      }
    }

    return `${lines.join("\n")}\n`;
  }

  private define(name: string, definition: Definition) {
    assertMetricName(name);
    if (this.definitions.has(name)) throw new Error(`Metric already defined: ${name}`);
    this.definitions.set(name, definition);
  }

  private get<T extends Definition["type"]>(name: string, type: T): Extract<Definition, { type: T }> {
    const definition = this.definitions.get(name);
    if (!definition || definition.type !== type) throw new Error(`Metric ${name} is not a ${type}`);
    return definition as Extract<Definition, { type: T }>;
  }
}
