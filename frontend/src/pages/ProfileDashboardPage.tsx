import { useParams } from "react-router-dom";

export default function ProfileDashboardPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{"\u041f\u0430\u043d\u0435\u043b\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044f"}</h2>
      <p>{"\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430-\u0437\u0430\u0433\u043b\u0443\u0448\u043a\u0430 \u0434\u043b\u044f \u043f\u0440\u043e\u0444\u0438\u043b\u044f id:"} {id}</p>
    </div>
  );
}
