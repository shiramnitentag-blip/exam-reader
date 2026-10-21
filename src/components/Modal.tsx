import { SpeakText } from './Speak';

/** A yes/no question over the screen. */
export function Modal({
  text,
  yes,
  no,
  onYes,
  onNo,
  danger = false,
}: {
  text: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
  danger?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onNo}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <SpeakText sentences={[{ id: 'modal-text', text }]} className="big-text" />
        <div className="modal-actions">
          <button className={`btn btn-big ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onYes}>
            {yes}
          </button>
          <button className="btn btn-big" onClick={onNo}>
            {no}
          </button>
        </div>
      </div>
    </div>
  );
}
