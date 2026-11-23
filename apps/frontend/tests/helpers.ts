/** Odpověď API čeká na `release`; `done` se splní, až ji MSW odešle. */
export function heldResponse(response: () => Response) {
  let release!: () => void;
  let sent!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = new Promise<void>((resolve) => (sent = resolve));
  return {
    release,
    done,
    handler: async () => {
      await gate;
      sent();
      return response();
    },
  };
}

/** Doběhnutí zpožděné odpovědi včetně jejích callbacků. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
