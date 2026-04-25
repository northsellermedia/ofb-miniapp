import { Home, Search, Bell, UserRound } from 'lucide-react';

const items = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'search', label: 'Поиск', icon: Search },
  { id: 'alerts', label: 'Уведомления', icon: Bell },
  { id: 'profile', label: 'Профиль', icon: UserRound }
];

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => onChange(item.id)}
            type="button"
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
