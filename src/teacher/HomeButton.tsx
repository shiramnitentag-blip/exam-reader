/** In every teacher screen: back to the opening screen (student side). */
export function HomeButton({ onHome }: { onHome: () => void }) {
  return (
    <button className="btn btn-small home-entry" onClick={onHome}>
      🏠 חֲזָרָה לַמָּסָךְ הָרָאשִׁי
    </button>
  );
}
