import { useParams } from "react-router-dom";

export default function ProfileDashboardPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Панель профиля</h2>
      <p>Страница-заглушка для профиля id: {id}</p>
    </div>
  );
}
