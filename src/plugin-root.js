/**
 * dsh-prts-ui package root plugin — the loader row named 'dsh-prts-ui'.
 *
 * The client-modules registry discovers a package's `dsh.client` bundle by
 * matching loader entries against the package name, so the bundle patch
 * inserts this no-op row for the registry to hang the PRTS client plugin on.
 * All real work lives in the /startup, /runner and /host rows.
 * @module dsh-prts-ui
 */

export const name = 'dsh-prts-ui'

/** No-op: the bundle patch rows (startup / runner / host) do the work. */
export function apply(ctx) { /* noop */ }
