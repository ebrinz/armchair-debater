/**
 * The one polite live region for the whole app. Hit text, announcer banners,
 * and the verdict are pushed through here so a screen reader hears the fight
 * without the visual effects.
 */
export const LiveRegion = ({ text }: { text: string }) => (
  <div className="visually-hidden" aria-live="polite" aria-atomic="true">
    {text}
  </div>
);
