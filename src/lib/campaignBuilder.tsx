import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AudienceKind } from "./auth";
import { COUNTRIES, COMM_TYPES, TEAMS_BY_KIND } from "./constants";
import type { CohortState } from "@/features/cohorts/CohortUploader";
import type { CommType, Country } from "./constants";
import type { ScheduledComm } from "@/components/ScheduledCommsPreview";

// ----------------------------------------------------------------------------
// Builder state (everything the campaign form holds)
// ----------------------------------------------------------------------------
export interface BuilderState {
  name: string;
  team: string;
  subTeam: string;
  country: Country;
  types: CommType[];
  cityCodes: string[];
  isRange: boolean;
  startDate: string;
  endDate: string;
  cohort: CohortState;
  actionKeys: string[];
  slotSelection: Record<string, Record<string, string>>;
  step: 1 | 2;
  activeTab: "builder" | "dashboard";
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function createInitialBuilderState(kind: AudienceKind): BuilderState {
  const firstTeam = TEAMS_BY_KIND[kind][0].team;
  return {
    name: "",
    team: firstTeam,
    subTeam: "",
    country: COUNTRIES[0],
    types: [COMM_TYPES.POPE],
    cityCodes: [],
    isRange: false,
    startDate: todayISO(),
    endDate: todayISO(),
    cohort: { general: null, byCity: {} },
    actionKeys: [],
    slotSelection: {},
    step: 1,
    activeTab: "builder",
  };
}

// ----------------------------------------------------------------------------
// Provider — one BuilderState per AudienceKind. Switching kinds swaps which
// slice is exposed; both states are preserved in memory. Navigating between
// Builder → Dashboard → My Campaigns leaves the slices untouched because
// this provider lives above the route tree.
// ----------------------------------------------------------------------------
interface BuilderContextValue {
  kind: AudienceKind;
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  reset: () => void;
  scheduledComms: ScheduledComm[];
  setScheduledComms: (items: ScheduledComm[]) => void;
}

const BuilderContext = createContext<BuilderContextValue | undefined>(undefined);

export function CampaignBuilderProvider({
  kind,
  children,
}: {
  kind: AudienceKind;
  children: ReactNode;
}) {
  // Lazy initialisation so we get two distinct slices on mount.
  const [drvState, setDrvState] = useState<BuilderState>(() => createInitialBuilderState("drv"));
  const [paxState, setPaxState] = useState<BuilderState>(() => createInitialBuilderState("pax"));
  const [drvComms, setDrvComms] = useState<ScheduledComm[]>([]);
  const [paxComms, setPaxComms] = useState<ScheduledComm[]>([]);

  const state = kind === "pax" ? paxState : drvState;
  const setState = kind === "pax" ? setPaxState : setDrvState;
  const scheduledComms = kind === "pax" ? paxComms : drvComms;
  const setScheduledComms = kind === "pax" ? setPaxComms : setDrvComms;

  const reset = useCallback(() => {
    if (kind === "pax") setPaxState(createInitialBuilderState("pax"));
    else setDrvState(createInitialBuilderState("drv"));
  }, [kind]);

  const value = useMemo<BuilderContextValue>(
    () => ({ kind, state, setState, reset, scheduledComms, setScheduledComms }),
    [kind, state, reset, scheduledComms],
  );

  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useCampaignBuilder(): BuilderContextValue {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error("useCampaignBuilder must be used within CampaignBuilderProvider");
  return ctx;
}