import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultStoreRoot = (): string => join(homedir(), '.ssomcp');
