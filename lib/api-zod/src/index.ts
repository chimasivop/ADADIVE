// `generated/api` and `generated/types` both define a `GetProviderAdvisoryParams`
// (orval emits a Zod validator for an operation's params *and* a plain type),
// which makes a bare `export *` ambiguous. Re-export the type explicitly so
// consumers still get both the validator and the type.
export type { GetProviderAdvisoryParams } from "./generated/types";
export * from "./generated/api";
export * from "./generated/types";
export * from "./validation";
