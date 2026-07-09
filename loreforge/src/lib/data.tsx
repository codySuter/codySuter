/**
 * Unified data layer.
 *
 * Two interchangeable clients implement `LoreClient`:
 *  - RealClient: a thin wrapper over ConvexReactClient (live Convex deployment).
 *  - DemoClient: the actual Convex functions running in-memory in the browser
 *    via convex-test, with invalidate-on-mutation reactivity. Used for the
 *    zero-setup demo mode; data lives for the session only.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConvexReactClient } from "convex/react";
import {
  getFunctionName,
  type FunctionReference,
  type FunctionReturnType,
  type FunctionArgs,
} from "convex/server";
import { api } from "../../convex/_generated/api";

type QueryRef = FunctionReference<"query">;
type MutationRef = FunctionReference<"mutation">;

export interface LoreClient {
  kind: "real" | "demo";
  watch<Q extends QueryRef>(
    ref: Q,
    args: FunctionArgs<Q>,
    onUpdate: (value: FunctionReturnType<Q>) => void,
  ): () => void;
  /** One-shot query (used by pickers and @mention autocomplete). */
  queryOnce<Q extends QueryRef>(ref: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q>>;
  mutation<M extends MutationRef>(ref: M, args: FunctionArgs<M>): Promise<FunctionReturnType<M>>;
  uploadFile(file: File): Promise<string>;
  close(): void;
}

// ---------------- Real Convex client ----------------

export function createRealClient(url: string): LoreClient {
  const convex = new ConvexReactClient(url);
  return {
    kind: "real",
    watch(ref, args, onUpdate) {
      const watch = convex.watchQuery(ref, args);
      const existing = watch.localQueryResult();
      if (existing !== undefined) onUpdate(existing);
      return watch.onUpdate(() => {
        const value = watch.localQueryResult();
        if (value !== undefined) onUpdate(value);
      });
    },
    queryOnce(ref, args) {
      return convex.query(ref, args);
    },
    mutation(ref, args) {
      return convex.mutation(ref, args);
    },
    async uploadFile(file) {
      const postUrl = await convex.mutation(api.files.generateUploadUrl, {});
      const response = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const { storageId } = await response.json();
      const url = await convex.query(api.files.getUrl, { storageId });
      if (!url) throw new Error("Upload succeeded but no URL was returned");
      return url;
    },
    close() {
      void convex.close();
    },
  };
}

// ---------------- In-memory demo client ----------------

interface TestHarness {
  query: (ref: QueryRef, args: unknown) => Promise<unknown>;
  mutation: (ref: MutationRef, args: unknown) => Promise<unknown>;
}

export async function createDemoClient(): Promise<LoreClient> {
  // convex-test targets Node/edge runtimes; give the browser the globals it expects.
  const g = globalThis as Record<string, unknown>;
  if (g.global === undefined) g.global = globalThis;
  if (g.process === undefined) g.process = { env: {} };
  const { convexTest } = await import("convex-test");
  const schema = (await import("../../convex/schema")).default;
  const modules = import.meta.glob([
    "../../convex/**/*.*s",
    "!../../convex/**/*.test.ts",
  ]);
  const t = convexTest(schema, modules) as unknown as TestHarness;
  await t.mutation(api.seed.init as MutationRef, {});

  // Debug hook for the e2e suite: lets tests inspect demo-backend state directly.
  const { makeFunctionReference } = await import("convex/server");
  (globalThis as Record<string, unknown>).__loreDemo = {
    query: (name: string, args: unknown) =>
      t.query(makeFunctionReference(name) as QueryRef, args),
  };

  let generation = 0;
  const listeners = new Set<() => void>();
  const invalidate = () => {
    generation++;
    for (const listener of [...listeners]) listener();
  };

  return {
    kind: "demo",
    watch(ref, args, onUpdate) {
      let alive = true;
      let lastJson = "";
      const run = () => {
        const expected = generation;
        void t.query(ref, args).then((value) => {
          if (!alive || expected !== generation) return;
          const json = JSON.stringify(value ?? null);
          if (json !== lastJson) {
            lastJson = json;
            onUpdate(value as never);
          }
        }).catch((error) => console.error("demo query failed", error));
      };
      const listener = () => run();
      listeners.add(listener);
      run();
      return () => {
        alive = false;
        listeners.delete(listener);
      };
    },
    queryOnce(ref, args) {
      return t.query(ref, args) as never;
    },
    async mutation(ref, args) {
      const result = await t.mutation(ref, args);
      invalidate();
      return result as never;
    },
    async uploadFile(file) {
      return URL.createObjectURL(file);
    },
    close() {
      listeners.clear();
    },
  };
}

// ---------------- React bindings ----------------

const ClientContext = createContext<LoreClient | null>(null);

export function DataProvider({ client, children }: { client: LoreClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useLoreClient(): LoreClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useLoreClient outside DataProvider");
  return client;
}

/** Reactive query hook. Pass "skip" to pause. Returns undefined while loading. */
export function useQ<Q extends QueryRef>(
  ref: Q,
  args: FunctionArgs<Q> | "skip",
): FunctionReturnType<Q> | undefined {
  const client = useLoreClient();
  const [value, setValue] = useState<FunctionReturnType<Q> | undefined>(undefined);
  const key = args === "skip" ? "skip" : `${getFunctionName(ref)}:${JSON.stringify(args)}`;
  const argsRef = useRef(args);
  argsRef.current = args;
  useEffect(() => {
    if (argsRef.current === "skip") {
      setValue(undefined);
      return;
    }
    return client.watch(ref, argsRef.current, (next) => setValue(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client]);
  return value;
}

/** Mutation hook: returns a stable callable. */
export function useM<M extends MutationRef>(ref: M) {
  const client = useLoreClient();
  return (args: FunctionArgs<M>): Promise<FunctionReturnType<M>> => client.mutation(ref, args);
}
