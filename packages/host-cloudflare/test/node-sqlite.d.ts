// The slice of Node's `node:sqlite` the test adapter uses; the primitives are typed over the Workers types, not Node's.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { columns(): unknown[]; all(...args: never[]): Record<string, unknown>[]; run(...args: never[]): unknown };
  }
}
