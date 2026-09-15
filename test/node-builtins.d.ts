/**
 * node:test / node:assert の最小型定義。
 *
 * このリポジトリは依存パッケージゼロを方針としているため @types/node を入れない。
 * テストで実際に使う API だけをここで宣言する。
 * 足りない API が出てきたら、ここに足すこと（npm install はしない）。
 */

declare module 'node:test' {
  export interface TestContext {
    readonly name: string;
    diagnostic(message: string): void;
    skip(message?: string): void;
    todo(message?: string): void;
  }
  export type TestFn = (t: TestContext) => void | Promise<void>;
  export interface TestOptions {
    skip?: boolean | string;
    todo?: boolean | string;
    only?: boolean;
    concurrency?: number | boolean;
    timeout?: number;
  }
  export function test(name: string, fn: TestFn): Promise<void>;
  export function test(name: string, options: TestOptions, fn: TestFn): Promise<void>;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export default test;
}

declare module 'node:assert/strict' {
  interface AssertStrict {
    (value: unknown, message?: string | Error): asserts value;
    ok(value: unknown, message?: string | Error): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string | Error): void;
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string | Error): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    throws(fn: () => unknown, expected?: unknown, message?: string | Error): void;
    doesNotThrow(fn: () => unknown, message?: string | Error): void;
    match(value: string, regExp: RegExp, message?: string | Error): void;
    fail(message?: string | Error): never;
  }
  const assert: AssertStrict;
  export default assert;
}

declare module 'node:assert' {
  export { default } from 'node:assert/strict';
}

/** テストから参照する最小限のグローバル */
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  stdout: { write(s: string): boolean };
  hrtime: { bigint(): bigint };
};
declare const globalThis: typeof window & Record<string, unknown>;
