import { QueryClient } from "@tanstack/react-query";
import type { QueryClientConfig } from "@tanstack/react-query";
import { runWithUrlRewrite, type UrlRewrite } from "./custom-fetch";

const SCOPED = Symbol("urlRewriteScoped");

type MaybeScoped = { [SCOPED]?: boolean };
type AnyFn = (...args: never[]) => unknown;

// Captured so the instance-field overrides below can delegate to the base
// implementation (instance fields shadow the prototype methods).
const baseDefaultQueryOptions = QueryClient.prototype.defaultQueryOptions;
const baseDefaultMutationOptions = QueryClient.prototype.defaultMutationOptions;

/**
 * A QueryClient whose queries and mutations all run with a fixed URL rewrite,
 * scoped to just this client. Any other QueryClient in the same page keeps
 * hitting the un-rewritten API, even while this one is mounted and fetching —
 * so a "demo world" client and the real app's client can never route requests
 * into each other's world, no matter how their renders interleave.
 *
 * Works by wrapping every resolved queryFn/mutationFn in `runWithUrlRewrite`,
 * which is safe because the generated API functions call `customFetch`
 * synchronously (the rewrite is applied before the first await). Every
 * consumer of query/mutation options (useQuery, useQueries, useMutation,
 * fetchQuery, prefetchQuery, refetches, retries, ...) resolves through
 * defaultQueryOptions/defaultMutationOptions, so wrapping there covers all
 * requests issued via this client.
 */
export class UrlRewriteScopedQueryClient extends QueryClient {
  readonly #rewrite: UrlRewrite;

  constructor(rewrite: UrlRewrite, config?: QueryClientConfig) {
    super(config);
    this.#rewrite = rewrite;
  }

  #wrap<F extends AnyFn>(fn: F): F {
    if ((fn as MaybeScoped)[SCOPED]) return fn;
    const rewrite = this.#rewrite;
    const wrapped = ((...args: never[]) =>
      runWithUrlRewrite(rewrite, () => fn(...args))) as F;
    (wrapped as MaybeScoped)[SCOPED] = true;
    return wrapped;
  }

  defaultQueryOptions: QueryClient["defaultQueryOptions"] = ((
    options: Parameters<QueryClient["defaultQueryOptions"]>[0],
  ) => {
    const defaulted = baseDefaultQueryOptions.call(this, options);
    if (typeof defaulted.queryFn === "function") {
      defaulted.queryFn = this.#wrap(defaulted.queryFn as AnyFn) as typeof defaulted.queryFn;
    }
    return defaulted;
  }) as QueryClient["defaultQueryOptions"];

  defaultMutationOptions: QueryClient["defaultMutationOptions"] = ((
    options?: Parameters<QueryClient["defaultMutationOptions"]>[0],
  ) => {
    const defaulted = baseDefaultMutationOptions.call(this, options);
    if (typeof defaulted.mutationFn === "function") {
      defaulted.mutationFn = this.#wrap(defaulted.mutationFn as AnyFn) as typeof defaulted.mutationFn;
    }
    return defaulted;
  }) as QueryClient["defaultMutationOptions"];
}
