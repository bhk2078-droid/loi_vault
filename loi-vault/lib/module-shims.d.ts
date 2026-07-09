// The browser bundle of exceljs has no types of its own; it's the same API
// as the typed Node entry point, just self-contained.
declare module "exceljs/dist/exceljs.min.js" {
  import type ExcelJS from "exceljs";
  const mod: typeof ExcelJS & { default?: typeof ExcelJS };
  export default mod;
}
