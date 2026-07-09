/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as entries from "../entries.js";
import type * as files from "../files.js";
import type * as pages from "../pages.js";
import type * as rolls from "../rolls.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as workspaces from "../workspaces.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  entries: typeof entries;
  files: typeof files;
  pages: typeof pages;
  rolls: typeof rolls;
  search: typeof search;
  seed: typeof seed;
  workspaces: typeof workspaces;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
