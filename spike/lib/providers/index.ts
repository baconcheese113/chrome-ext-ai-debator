import { chatgpt } from './chatgpt';
import { claude } from './claude';
import { gemini } from './gemini';
import { grok } from './grok';
import type { ProviderConfig, ProviderId } from '../types';

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  claude,
  chatgpt,
  gemini,
  grok,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
