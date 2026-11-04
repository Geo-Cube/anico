import { FlaskConical, X } from 'lucide-react';
import { Outlet } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  BreedersSimulationProvider,
  SIMULATED_ADMIN_NAME,
  useBreedersSimulation,
} from './simulation';

export function BreedersLayout() {
  return (
    <BreedersSimulationProvider>
      <div className="flex flex-col gap-4">
        <Alert variant="info">
          <FlaskConical aria-hidden="true" />
          <p>
            <strong className="font-semibold">Simulace.</strong> Ověřování
            chovatelů zatím pracuje s ukázkovými daty bez napojení na API.
            Rozhodnutí se ukládají jen v tomto okně prohlížeče (jako{' '}
            {SIMULATED_ADMIN_NAME}) a po obnovení stránky se vrátí do výchozího
            stavu.
          </p>
        </Alert>
        <SimulationControls />
        <SimulationBanners />
        <Outlet />
      </div>
    </BreedersSimulationProvider>
  );
}

function SimulationControls() {
  const {
    simulateConflict409,
    setSimulateConflict409,
    apiError,
    toggleApiError,
  } = useBreedersSimulation();

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
      <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Testovací scénáře
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={simulateConflict409}
          onChange={(event) => setSimulateConflict409(event.target.checked)}
        />
        Simulovat 409 (Konflikt)
      </label>
      <Button variant="outline" size="sm" onClick={toggleApiError}>
        {apiError ? 'Skrýt chybu serveru' : 'Simulovat chybu 500'}
      </Button>
    </Card>
  );
}

function SimulationBanners() {
  const { banner, dismissBanner, apiError, clearApiError } =
    useBreedersSimulation();

  return (
    <>
      {banner && (
        <Alert variant={banner.type === 'success' ? 'info' : 'warning'}>
          <p className="flex-1">{banner.text}</p>
          <Button
            variant="ghost"
            size="icon"
            className="-my-1.5 size-7"
            aria-label="Zavřít oznámení"
            onClick={dismissBanner}
          >
            <X aria-hidden="true" />
          </Button>
        </Alert>
      )}
      {apiError && (
        <Alert variant="error">
          <p className="flex-1">{apiError}</p>
          <Button
            variant="ghost"
            size="icon"
            className="-my-1.5 size-7"
            aria-label="Zavřít chybové hlášení"
            onClick={clearApiError}
          >
            <X aria-hidden="true" />
          </Button>
        </Alert>
      )}
    </>
  );
}
