export function MobileMovementPad() {
  const key = (value: string, pressed: boolean) => {
    window.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { key: value }));
  };
  return (
    <div className="mobile-movement-pad" aria-label="触控移动">
      {([['w', '↑'], ['a', '←'], ['s', '↓'], ['d', '→']] as const).map(([value, label]) => (
        <button key={value} type="button" className={`move-${value}`}
          onPointerDown={(event) => { event.preventDefault(); key(value, true); }}
          onPointerUp={() => key(value, false)} onPointerCancel={() => key(value, false)}
          onPointerLeave={() => key(value, false)} aria-label={`${label}移动`}>{label}</button>
      ))}
    </div>
  );
}
