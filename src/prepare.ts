import { computeRun } from './calc.js';
import { diffEmployees } from './diff.js';
import { atomicWritePrivateFile } from './store/fs.js';
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
  await Promise.all([
    atomicWritePrivateFile(outputs.txtPath, txt.buf),
    atomicWritePrivateFile(outputs.xlsxPath, xlsx),
  ]);
  return { warnings: txt.warnings };
}
