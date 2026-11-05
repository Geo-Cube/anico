import { Outlet } from 'react-router';

/**
 * Place in the protected flow where profile completion will be checked
 * before the dashboard or a safe `returnTo` (docs/ONBOARDING-PROFILU.md).
 *
 * Not connected yet: breeder-service has no agreed profile API. When it
 * exists, load the status here and
 * - `incomplete` → redirect to the profile form, keeping `returnTo`;
 * - API outage → show `UnavailableState`, never treat it as complete;
 * - `complete` → render the outlet.
 */
export function ProfileGate() {
  return <Outlet />;
}
