export default function GlassCard({ children, className = '', onClick }) {
  return (
    <section className={`glass-card ${className}`} onClick={onClick}>
      {children}
    </section>
  );
}
