import { createContext } from 'react';
import type { ModuleContextValue } from '../shared/types';

export const ModuleContext = createContext<ModuleContextValue | null>(null);
