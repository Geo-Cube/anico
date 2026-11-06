import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/*
 * Simulation only: mock data held in memory, no API calls. State lives in the
 * layout route provider, so it is shared across screens and resets on reload.
 */

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SharedFile {
  file_name: string;
  file_reference: string;
}

export interface Breeder {
  breeder_id: string;
  first_name: string;
  last_name: string;
  email_address: string;
  breeding_station_name: string;
  breeding_station_number: string;
  is_verified: boolean;
}

export interface VerificationRequest {
  verification_request_id: string;
  breeder_id: string;
  status: VerificationStatus;
  submitted_at: string;
  breeding_station_certificate: SharedFile;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export interface BreederRequestItem {
  breeder: Breeder;
  verification_request: VerificationRequest;
}

export type SimulationBanner = {
  text: string;
  type: 'success' | 'warning';
};

/** `saved` = decision stored; `conflict` = simulated 409, stored result shown. */
export type DecisionOutcome = 'saved' | 'conflict';

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];

export const SIMULATED_ADMIN_NAME = 'Eva Novotná';
export const PENDING_ANIMAL_DOCS_COUNT = 0;

const SIMULATED_LATENCY_MS = 250;
const SIMULATED_OTHER_ADMIN_NAME = 'Jan Dvořák';
const CONFLICT_BANNER_TEXT =
  'Konflikt (409): Jiný administrátor už o této žádosti rozhodl. Zobrazuji uložený výsledek.';
const SERVER_ERROR_TEXT =
  'Při ukládání došlo k chybě komunikace se serverem. Zkuste operaci zopakovat.';

const INITIAL_MOCK_DATA: BreederRequestItem[] = [
  {
    breeder: {
      breeder_id: 'b-1',
      first_name: 'Karel',
      last_name: 'Novák',
      email_address: 'karel.novak@example.com',
      breeding_station_name: 'Modré údolí',
      breeding_station_number: '1234/2024',
      is_verified: false,
    },
    verification_request: {
      verification_request_id: 'vr-1',
      breeder_id: 'b-1',
      status: 'PENDING',
      submitted_at: '30. 10. 2026, 09:15',
      breeding_station_certificate: {
        file_name: 'Certifikat-Modre-udoli.pdf',
        file_reference: '/files/Certifikat-Modre-udoli.pdf',
      },
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
    },
  },
  {
    breeder: {
      breeder_id: 'b-2',
      first_name: 'Lucie',
      last_name: 'Svobodová',
      email_address: 'lucie.svobodova@example.com',
      breeding_station_name: 'Stříbrný vítr',
      breeding_station_number: '5678/2025',
      is_verified: false,
    },
    verification_request: {
      verification_request_id: 'vr-2',
      breeder_id: 'b-2',
      status: 'PENDING',
      submitted_at: '30. 10. 2026, 09:25',
      breeding_station_certificate: {
        file_name: 'Certifikat-Stribrny-vitr.pdf',
        file_reference: '/files/Certifikat-Stribrny-vitr.pdf',
      },
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
    },
  },
];

export function formatRequestStatusLabel(status: VerificationStatus): string {
  if (status === 'PENDING') return 'K posouzení';
  if (status === 'APPROVED') return 'Účet ověřený';
  return 'Zamítnuto';
}

export function formatPendingCountText(count: number): string {
  if (count === 1) return '1 žádost čeká na posouzení';
  if (count >= 2 && count <= 4) return `${count} žádosti čekají na posouzení`;
  return `${count} žádostí čeká na posouzení`;
}

export function parseStatusFilter(value: string | null): VerificationStatus {
  return VERIFICATION_STATUSES.find((status) => status === value) ?? 'PENDING';
}

function formatNow(): string {
  return new Date().toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Simulated network round-trip before a decision is stored. */
function simulateLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
}

interface BreedersSimulationValue {
  items: BreederRequestItem[];
  banner: SimulationBanner | null;
  dismissBanner: () => void;
  apiError: string | null;
  toggleApiError: () => void;
  clearApiError: () => void;
  simulateConflict409: boolean;
  setSimulateConflict409: (value: boolean) => void;
  approveRequest: (requestId: string) => Promise<DecisionOutcome>;
  rejectRequest: (
    requestId: string,
    reason: string,
  ) => Promise<DecisionOutcome>;
}

const BreedersSimulationContext = createContext<BreedersSimulationValue | null>(
  null,
);

export function BreedersSimulationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [items, setItems] = useState<BreederRequestItem[]>(INITIAL_MOCK_DATA);
  const [banner, setBanner] = useState<SimulationBanner | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [simulateConflict409, setSimulateConflict409] = useState(false);

  const replaceRequest = useCallback(
    (
      requestId: string,
      update: (item: BreederRequestItem) => BreederRequestItem,
    ) => {
      setItems((prev) =>
        prev.map((item) =>
          item.verification_request.verification_request_id === requestId
            ? update(item)
            : item,
        ),
      );
    },
    [],
  );

  const approveRequest = useCallback(
    async (requestId: string): Promise<DecisionOutcome> => {
      setApiError(null);
      await simulateLatency();

      if (simulateConflict409) {
        replaceRequest(requestId, (item) => ({
          breeder: { ...item.breeder, is_verified: false },
          verification_request: {
            ...item.verification_request,
            status: 'REJECTED',
            reviewed_by: SIMULATED_OTHER_ADMIN_NAME,
            reviewed_at: '30. 10. 2026, 09:40',
            rejection_reason: 'Nečitelný certifikát chovatelské stanice.',
          },
        }));
        setBanner({ text: CONFLICT_BANNER_TEXT, type: 'warning' });
        return 'conflict';
      }

      const now = formatNow();
      replaceRequest(requestId, (item) => ({
        breeder: { ...item.breeder, is_verified: true },
        verification_request: {
          ...item.verification_request,
          status: 'APPROVED',
          reviewed_by: SIMULATED_ADMIN_NAME,
          reviewed_at: now,
          rejection_reason: null,
        },
      }));
      setBanner({
        text: 'Ověření účtu bylo schváleno. Výsledek byl odeslán e-mailem.',
        type: 'success',
      });
      return 'saved';
    },
    [replaceRequest, simulateConflict409],
  );

  const rejectRequest = useCallback(
    async (requestId: string, reason: string): Promise<DecisionOutcome> => {
      setApiError(null);
      await simulateLatency();

      if (simulateConflict409) {
        replaceRequest(requestId, (item) => ({
          breeder: { ...item.breeder, is_verified: true },
          verification_request: {
            ...item.verification_request,
            status: 'APPROVED',
            reviewed_by: SIMULATED_OTHER_ADMIN_NAME,
            reviewed_at: '30. 10. 2026, 09:42',
            rejection_reason: null,
          },
        }));
        setBanner({ text: CONFLICT_BANNER_TEXT, type: 'warning' });
        return 'conflict';
      }

      const now = formatNow();
      replaceRequest(requestId, (item) => ({
        breeder: { ...item.breeder, is_verified: false },
        verification_request: {
          ...item.verification_request,
          status: 'REJECTED',
          reviewed_by: SIMULATED_ADMIN_NAME,
          reviewed_at: now,
          rejection_reason: reason,
        },
      }));
      setBanner({
        text: 'Ověření účtu bylo zamítnuto. Výsledek byl odeslán e-mailem.',
        type: 'success',
      });
      return 'saved';
    },
    [replaceRequest, simulateConflict409],
  );

  const value = useMemo<BreedersSimulationValue>(
    () => ({
      items,
      banner,
      dismissBanner: () => setBanner(null),
      apiError,
      toggleApiError: () =>
        setApiError((prev) => (prev ? null : SERVER_ERROR_TEXT)),
      clearApiError: () => setApiError(null),
      simulateConflict409,
      setSimulateConflict409,
      approveRequest,
      rejectRequest,
    }),
    [
      items,
      banner,
      apiError,
      simulateConflict409,
      approveRequest,
      rejectRequest,
    ],
  );

  return (
    <BreedersSimulationContext value={value}>
      {children}
    </BreedersSimulationContext>
  );
}

export function useBreedersSimulation(): BreedersSimulationValue {
  const value = useContext(BreedersSimulationContext);
  if (!value) {
    throw new Error(
      'useBreedersSimulation must be used inside BreedersSimulationProvider',
    );
  }
  return value;
}
