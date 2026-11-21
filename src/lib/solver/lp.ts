/**
 * A tiny modeling layer over the HiGHS solver (compiled to WebAssembly).
 *
 * Models are built with named variables and constraints and serialized to
 * CPLEX LP format, which keeps every model human-readable: call
 * `model.toLp()` to inspect exactly what the solver received.
 */
import loadHighs from "highs";

type Highs = Awaited<ReturnType<typeof loadHighs>>;

let highsPromise: Promise<Highs> | null = null;

export function getHighs(): Promise<Highs> {
  if (!highsPromise) {
    highsPromise = loadHighs().catch((err) => {
      highsPromise = null;
      throw err;
    });
  }
  return highsPromise;
}

export type VarType = "continuous" | "integer" | "binary";

export interface VarDef {
  lb: number;
  ub: number;
  type: VarType;
}

export type Terms = Iterable<readonly [string, number]>;

interface Constraint {
  name: string;
  terms: Map<string, number>;
  op: "<=" | ">=" | "=";
  rhs: number;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite coefficient ${n}`);
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e-4 && abs < 1e9) {
    return n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  }
  return n.toExponential(10);
}

export class LpModel {
  sense: "min" | "max";
  private vars = new Map<string, VarDef>();
  private objective = new Map<string, number>();
  private quadratic = new Map<string, number>(); // key "a|b" (a<=b) -> coefficient in 0.5 x'Qx convention
  private constraints: Constraint[] = [];
  private constraintNames = new Set<string>();

  constructor(sense: "min" | "max" = "min") {
    this.sense = sense;
  }

  /** Removes the linear and quadratic objective so the same constraints can be reused. */
  clearObjective() {
    this.objective.clear();
    this.quadratic.clear();
  }

  varNames(): string[] {
    return [...this.vars.keys()];
  }

  addVar(name: string, def: Partial<VarDef> = {}): string {
    if (!NAME_RE.test(name)) throw new Error(`Invalid variable name: ${name}`);
    if (this.vars.has(name)) throw new Error(`Duplicate variable: ${name}`);
    const type = def.type ?? "continuous";
    this.vars.set(name, {
      lb: def.lb ?? 0,
      ub: def.ub ?? (type === "binary" ? 1 : Infinity),
      type,
    });
    return name;
  }

  hasVar(name: string): boolean {
    return this.vars.has(name);
  }

  getVar(name: string): VarDef | undefined {
    return this.vars.get(name);
  }

  setBounds(name: string, lb: number, ub: number) {
    const v = this.vars.get(name);
    if (!v) throw new Error(`Unknown variable ${name}`);
    v.lb = lb;
    v.ub = ub;
  }

  addObjective(name: string, coef: number) {
    if (!this.vars.has(name)) throw new Error(`Unknown variable in objective: ${name}`);
    if (coef === 0) return;
    this.objective.set(name, (this.objective.get(name) ?? 0) + coef);
  }

  /**
   * Adds a quadratic objective term. The objective becomes
   * linear + 0.5 * sum Q_ij x_i x_j; pass Q_ij for i<=j (symmetric).
   */
  addQuadratic(a: string, b: string, q: number) {
    if (q === 0) return;
    const [x, y] = a <= b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    this.quadratic.set(key, (this.quadratic.get(key) ?? 0) + q);
  }

  addConstraint(name: string, terms: Terms, op: "<=" | ">=" | "=", rhs: number) {
    if (!NAME_RE.test(name)) throw new Error(`Invalid constraint name: ${name}`);
    if (this.constraintNames.has(name)) throw new Error(`Duplicate constraint: ${name}`);
    const map = new Map<string, number>();
    for (const [v, c] of terms) {
      if (!this.vars.has(v)) throw new Error(`Unknown variable ${v} in constraint ${name}`);
      if (c === 0) continue;
      map.set(v, (map.get(v) ?? 0) + c);
    }
    this.constraintNames.add(name);
    this.constraints.push({ name, terms: map, op, rhs });
  }

  /** lo <= sum <= hi, skipping infinite sides. */
  addRange(name: string, terms: Terms, lo: number, hi: number) {
    const list = [...terms];
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo === hi) {
      this.addConstraint(name, list, "=", lo);
      return;
    }
    if (Number.isFinite(lo)) this.addConstraint(`${name}_lo`, list, ">=", lo);
    if (Number.isFinite(hi)) this.addConstraint(`${name}_hi`, list, "<=", hi);
  }

  get numVars() {
    return this.vars.size;
  }

  get numConstraints() {
    return this.constraints.length;
  }

  toLp(): string {
    const lines: string[] = [];
    lines.push(this.sense === "min" ? "Minimize" : "Maximize");
    const objTerms = writeTerms(this.objective);
    let obj = ` obj: ${objTerms || "0 " + this.firstVar()}`;
    if (this.quadratic.size) {
      const q: string[] = [];
      for (const [key, coef] of this.quadratic) {
        const [a, b] = key.split("|");
        // In LP format "[ ... ] / 2": diagonal terms are written as c x^2 (meaning Q_ii = c),
        // off-diagonal pairs as c x * y where c = 2 * Q_ij (since Q is symmetric).
        if (a === b) q.push(`${fmt(coef)} ${a} ^ 2`);
        else q.push(`${fmt(2 * coef)} ${a} * ${b}`);
      }
      obj += ` + [ ${joinSigned(q)} ] / 2`;
    }
    lines.push(wrap(obj));
    lines.push("Subject To");
    for (const c of this.constraints) {
      const body = writeTerms(c.terms) || `0 ${this.firstVar()}`;
      lines.push(wrap(` ${c.name}: ${body} ${c.op} ${fmt(c.rhs)}`));
    }
    lines.push("Bounds");
    const generals: string[] = [];
    const binaries: string[] = [];
    for (const [name, v] of this.vars) {
      if (v.type === "binary") {
        binaries.push(name);
        continue;
      }
      const lb = v.lb === -Infinity ? "-inf" : fmt(v.lb);
      const ub = v.ub === Infinity ? "+inf" : fmt(v.ub);
      lines.push(` ${lb} <= ${name} <= ${ub}`);
      if (v.type === "integer") generals.push(name);
    }
    if (generals.length) {
      lines.push("General");
      for (let i = 0; i < generals.length; i += 12) lines.push(" " + generals.slice(i, i + 12).join(" "));
    }
    if (binaries.length) {
      lines.push("Binary");
      for (let i = 0; i < binaries.length; i += 12) lines.push(" " + binaries.slice(i, i + 12).join(" "));
    }
    lines.push("End");
    return lines.join("\n");
  }

  private firstVar(): string {
    const first = this.vars.keys().next();
    if (first.done) throw new Error("Model has no variables");
    return first.value;
  }
}

function writeTerms(terms: Map<string, number>): string {
  const parts: string[] = [];
  for (const [v, c] of terms) {
    if (c === 0) continue;
    parts.push(`${fmt(c)} ${v}`);
  }
  return joinSigned(parts);
}

function joinSigned(parts: string[]): string {
  let out = "";
  parts.forEach((p, i) => {
    if (i === 0) out = p;
    else out += p.startsWith("-") ? ` - ${p.slice(1)}` : ` + ${p}`;
  });
  return out;
}

/** Keeps LP lines reasonably short; the LP reader treats newlines as whitespace. */
function wrap(line: string, width = 200): string {
  if (line.length <= width) return line;
  const tokens = line.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const t of tokens) {
    if ((cur + " " + t).length > width && cur) {
      out.push(cur);
      cur = "  " + t;
    } else {
      cur = cur ? `${cur} ${t}` : t;
    }
  }
  if (cur) out.push(cur);
  return out.join("\n");
}

export type SolveStatus = "optimal" | "feasible" | "infeasible" | "unbounded" | "error";

export interface SolveResult {
  status: SolveStatus;
  rawStatus: string;
  objective: number | null;
  values: Map<string, number>;
  timeMs: number;
}

export interface SolveOptions {
  timeLimitSec?: number;
  mipRelGap?: number;
}

export async function solveModel(model: LpModel, opts: SolveOptions = {}): Promise<SolveResult> {
  const highs = await getHighs();
  const lp = model.toLp();
  const started = performance.now();
  const options: Record<string, unknown> = { output_flag: false };
  if (opts.timeLimitSec) options.time_limit = opts.timeLimitSec;
  if (opts.mipRelGap !== undefined) options.mip_rel_gap = opts.mipRelGap;
  let result: ReturnType<Highs["solve"]>;
  try {
    result = highs.solve(lp, options as Parameters<Highs["solve"]>[1]);
  } catch (err) {
    // A thrown error can leave the WASM instance in a bad state; reload next time.
    highsPromise = null;
    return {
      status: "error",
      rawStatus: err instanceof Error ? err.message : String(err),
      objective: null,
      values: new Map(),
      timeMs: performance.now() - started,
    };
  }
  const timeMs = performance.now() - started;
  const raw = String(result.Status);
  const values = new Map<string, number>();
  const cols = (result as { Columns?: Record<string, { Primal?: number }> }).Columns ?? {};
  for (const [name, col] of Object.entries(cols)) {
    if (typeof col?.Primal === "number" && Number.isFinite(col.Primal)) values.set(name, col.Primal);
  }
  let status: SolveStatus;
  if (raw === "Optimal") status = "optimal";
  else if (/infeasible/i.test(raw) && !/unbounded/i.test(raw)) status = "infeasible";
  else if (/unbounded/i.test(raw)) status = "unbounded";
  else if (values.size > 0 && /time limit|iteration limit|solution limit|interrupt/i.test(raw)) status = "feasible";
  else status = "error";
  return {
    status,
    rawStatus: raw,
    objective: status === "optimal" || status === "feasible" ? result.ObjectiveValue : null,
    values,
    timeMs,
  };
}
