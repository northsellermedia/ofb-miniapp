export default function LoadingView({ text = 'Загружаем данные' }) {
  return (
    <div className="loading-view">
      <div className="loader" />
      <p>{text}</p>
    </div>
  );
}
