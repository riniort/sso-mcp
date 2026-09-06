import { writeFile } from 'node:fs/promises';
import { computeRun } from './calc.js';
import { diffEmployees } from './diff.js';
import type { Employee, RunContext } from './types.js';
import { generateTxt } from './txt-generator.js';
import { writeXlsx } from './xlsx-summary.js';

export async function prepareContribution(
  ctx: RunContext,
  previousEmployees: readonly Employee[],
  outputs: { txtPath: string; xlsxPath: string },
): Promise<{ warnings: string[] }> {
  const run = computeRun(ctx);
  const diff = diffEmployees(previousEmployees, ctx.employees);
  const txt = generateTxt(run);
  const xlsx = await writeXlsx(run, diff);
  await Promise.all([writeFile(outputs.txtPath, txt.buf), writeFile(outputs.xlsxPath, xlsx)]);
  return { warnings: txt.warnings };
}
