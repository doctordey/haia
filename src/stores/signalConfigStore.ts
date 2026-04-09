import { create } from 'zustand';

export interface SignalConfigForm {
  // Source/Account
  sourceId: string;
  accountId: string;
  // Master controls
  isEnabled: boolean;
  dryRun: boolean;
  // Instruments
  nqSymbol: string;
  esSymbol: string;
  // Lots
  nqSmallLots: number;
  nqMediumLots: number;
  nqLargeLots: number;
  esSmallLots: number;
  esMediumLots: number;
  esLargeLots: number;
  // Offset
  offsetMode: string;
  nqFixedOffset: number;
  esFixedOffset: number;
  nqMaxOffset: number;
  nqMinOffset: number;
  esMaxOffset: number;
  esMinOffset: number;
  // Sizing
  sizingMode: string;
  executionMode: string;
  baseRiskPercent: number;
  maxRiskPercent: number;
  nqBaseRiskPercent: number | null;
  nqMaxRiskPercent: number | null;
  esBaseRiskPercent: number | null;
  esMaxRiskPercent: number | null;
  minStopDistance: number;
  maxLotSize: number;
  smallMultiplier: number;
  mediumMultiplier: number;
  largeMultiplier: number;
  // Orders
  maxLotsPerOrder: number;
  marketOrderThreshold: number;
  maxSlippage: number;
  marginWarningThreshold: number;
  marginRejectThreshold: number;
}

const DEFAULTS: SignalConfigForm = {
  sourceId: '',
  accountId: '',
  isEnabled: false,
  dryRun: true,
  nqSymbol: 'NAS100',
  esSymbol: 'US500',
  nqSmallLots: 0.01,
  nqMediumLots: 0.05,
  nqLargeLots: 0.10,
  esSmallLots: 0.01,
  esMediumLots: 0.05,
  esLargeLots: 0.10,
  offsetMode: 'webhook',
  nqFixedOffset: 198,
  esFixedOffset: 40,
  nqMaxOffset: 400,
  nqMinOffset: 50,
  esMaxOffset: 150,
  esMinOffset: 10,
  sizingMode: 'strict',
  executionMode: 'single',
  baseRiskPercent: 1.0,
  maxRiskPercent: 5.0,
  nqBaseRiskPercent: null,
  nqMaxRiskPercent: null,
  esBaseRiskPercent: null,
  esMaxRiskPercent: null,
  minStopDistance: 10,
  maxLotSize: 0.10,
  smallMultiplier: 0.5,
  mediumMultiplier: 1.0,
  largeMultiplier: 1.5,
  maxLotsPerOrder: 50,
  marketOrderThreshold: 5.0,
  maxSlippage: 5.0,
  marginWarningThreshold: 80,
  marginRejectThreshold: 95,
};

interface SignalConfigStore {
  form: SignalConfigForm;
  loaded: boolean;
  dirty: boolean;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
  loadFromServer: (data: Partial<SignalConfigForm>) => void;
  reset: () => void;
  getDefaults: () => SignalConfigForm;
}

export const useSignalConfigStore = create<SignalConfigStore>((set) => ({
  form: { ...DEFAULTS },
  loaded: false,
  dirty: false,
  setField: (key, value) =>
    set((state) => ({
      form: { ...state.form, [key]: value },
      dirty: true,
    })),
  loadFromServer: (data) =>
    set({
      form: { ...DEFAULTS, ...data },
      loaded: true,
      dirty: false,
    }),
  reset: () => set({ form: { ...DEFAULTS }, loaded: false, dirty: false }),
  getDefaults: () => ({ ...DEFAULTS }),
}));
