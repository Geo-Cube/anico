import { MOCK_ANIMALS, type MockOptions } from './documents-mock';

interface DevTestBarProps {
  selectedAnimalId: string;
  isForeignAnimal: boolean;
  options: MockOptions;
  isBusy: boolean;
  onAnimalChange: (animalId: string) => void;
  onForeignAnimalChange: (isForeign: boolean) => void;
  onOptionsChange: (options: MockOptions) => void;
  onReload: () => void;
}

// DOČASNÉ: přepínače ukázky jako v UC-01, po napojení na API odebrat.
export function DevTestBar({
  selectedAnimalId,
  isForeignAnimal,
  options,
  isBusy,
  onAnimalChange,
  onForeignAnimalChange,
  onOptionsChange,
  onReload,
}: DevTestBarProps) {
  return (
    <div className="dev-test-bar">
      <span>
        🛠️ <strong>Testování DoD:</strong>
      </span>
      <label>
        Zvíře:{' '}
        <select
          value={selectedAnimalId}
          disabled={isBusy}
          onChange={(e) => onAnimalChange(e.target.value)}
        >
          {MOCK_ANIMALS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.microchipNumber ? '' : ' (bez čipu)'}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={isForeignAnimal}
          disabled={isBusy}
          onChange={(e) => onForeignAnimalChange(e.target.checked)}
        />{' '}
        Cizí zvíře
      </label>
      <label>
        Chyba 500 při nahrání:{' '}
        <select
          value={options.upload_error}
          onChange={(e) =>
            onOptionsChange({
              ...options,
              upload_error: e.target.value as MockOptions['upload_error'],
            })
          }
        >
          <option value="off">Vypnuto</option>
          <option value="all">Každý doklad</option>
          <option value="every_second">Každý druhý doklad</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.simulate_csrf}
          onChange={(e) =>
            onOptionsChange({ ...options, simulate_csrf: e.target.checked })
          }
        />{' '}
        Simulovat CSRF 403 (a opakování)
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.simulate_conflict}
          onChange={(e) =>
            onOptionsChange({ ...options, simulate_conflict: e.target.checked })
          }
        />{' '}
        Simulovat „doklad už byl doplněn“
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.simulate_load_error}
          onChange={(e) => {
            onOptionsChange({
              ...options,
              simulate_load_error: e.target.checked,
            });
            onReload();
          }}
        />{' '}
        Simulovat chybu načtení
      </label>
    </div>
  );
}
