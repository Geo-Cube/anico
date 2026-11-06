import { CircleCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { Alert } from '@/shared/ui/alert';

/** Výsledek dokončené akce předaný přesměrováním (`navigate(to, { state })`). */
export type ResultState = { result: string };

const resultOf = (state: unknown) =>
  state &&
  typeof state === 'object' &&
  'result' in state &&
  typeof state.result === 'string'
    ? state.result
    : null;

/** Zavíratelná zpráva o výsledku; zavření ji odebere z historie, takže se nevrátí. */
export function ResultMessage() {
  const location = useLocation();
  const navigate = useNavigate();
  const result = resultOf(location.state);
  if (!result) return null;
  return (
    <Alert
      onDismiss={() =>
        void navigate(
          { pathname: location.pathname, search: location.search },
          { replace: true, state: null },
        )
      }
    >
      <p className="flex items-start gap-2">
        <CircleCheck aria-hidden />
        {result}
      </p>
    </Alert>
  );
}
