export default function MaintenancePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-4">{"系統暫時維護中"}</h1>
        <p className="text-secondary">
          {"我們正在進行短暫的系統維護，會盡快恢復服務。造成不便，敬請見諒。"}
        </p>
      </div>
    </div>
  );
}
