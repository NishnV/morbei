// Mirrors the @custom-media tokens in src/styles/breakpoints.css — keep in sync.
// Portrait handhelds (phones + iPads upright) get the mobile design; landscape
// devices of any kind get the desktop design.

export const MOBILE_QUERY = '(orientation: portrait) and (max-width: 1200px), (max-width: 600px)';
export const PHONE_QUERY = '(max-width: 600px)';
export const PHONE_SM_QUERY = '(max-width: 430px)';
export const TABLET_QUERY = '(orientation: portrait) and (min-width: 601px) and (max-width: 1200px)';

export const isMobileViewport = () => window.matchMedia(MOBILE_QUERY).matches;
export const isPhoneViewport = () => window.matchMedia(PHONE_QUERY).matches;
