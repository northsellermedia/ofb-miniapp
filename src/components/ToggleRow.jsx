export default function ToggleRow({ label, checked, onChange, disabled }) {
  return (
    <button className="toggle-row" type="button" onClick={() => !disabled && onChange(!checked)} disabled={disabled}>
      <span>{label}</span>
      <span className={`switch ${checked ? 'on' : ''}`}>
        <span />
      </span>
    </button>
  );
}
