"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const REGIONS = [
  "台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "台東縣", "澎湖縣", "金門縣", "連江縣",
];

// Stubbed per Session 13 spec — replace with real 行業標準分類 codes later.
const INDUSTRY_CODES = [
  { code: "A", label: "農、林、漁、牧業" },
  { code: "F", label: "營造業" },
  { code: "G", label: "批發及零售業" },
  { code: "I", label: "住宿及餐飲業" },
  { code: "J", label: "資訊及通訊傳播業" },
];

export default function NewSearchPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industryCodes, setIndustryCodes] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [capitalMin, setCapitalMin] = useState("");
  const [capitalMax, setCapitalMax] = useState("");
  const [entityType, setEntityType] = useState<"company" | "business" | "both">("both");
  const [keyword, setKeyword] = useState("");
  const [cadence, setCadence] = useState<"weekly" | "monthly">("weekly");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const res = await fetch("/api/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        industry_codes: industryCodes,
        regions,
        capital_min: capitalMin ? Number(capitalMin) : null,
        capital_max: capitalMax ? Number(capitalMax) : null,
        entity_type: entityType,
        keyword,
        cadence,
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setErrors(data.errors ?? { _general: "儲存失敗，請稍後再試。" });
      return;
    }

    router.push(`/searches/${data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="p-8 max-w-2xl space-y-6">
      <h1 className="text-xl font-bold">新增搜尋條件</h1>

      {errors._general && (
        <p className="text-red-600 text-sm">{errors._general}</p>
      )}

      <div>
        <label className="block mb-1 font-medium">搜尋條件名稱 *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：新北市營造業新設公司"
          className="border-default border rounded px-3 py-2 w-full"
        />
        {errors.name && <p className="text-red-600 text-sm mt-1">{errors.name}</p>}
      </div>

      <div>
        <label className="block mb-1 font-medium">行業別</label>
        <div className="grid grid-cols-2 gap-2">
          {INDUSTRY_CODES.map((ind) => (
            <label key={ind.code} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={industryCodes.includes(ind.code)}
                onChange={() => toggle(industryCodes, setIndustryCodes, ind.code)}
              />
              {ind.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block mb-1 font-medium">地區</label>
        <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
          {REGIONS.map((region) => (
            <label key={region} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={regions.includes(region)}
                onChange={() => toggle(regions, setRegions, region)}
              />
              {region}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block mb-1 font-medium">最低資本額</label>
          <input
            type="number"
            min={0}
            value={capitalMin}
            onChange={(e) => setCapitalMin(e.target.value)}
            className="border-default border rounded px-3 py-2 w-full"
          />
        </div>
        <div>
          <label className="block mb-1 font-medium">最高資本額</label>
          <input
            type="number"
            min={0}
            value={capitalMax}
            onChange={(e) => setCapitalMax(e.target.value)}
            className="border-default border rounded px-3 py-2 w-full"
          />
        </div>
        {errors.capital && (
          <p className="text-red-600 text-sm col-span-2">{errors.capital}</p>
        )}
      </div>

      <div>
        <label className="block mb-1 font-medium">公司／商業類型</label>
        <div className="flex gap-4">
          {[
            { value: "both", label: "不限" },
            { value: "company", label: "僅公司" },
            { value: "business", label: "僅商業（獨資合夥）" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="entity_type"
                checked={entityType === opt.value}
                onChange={() => setEntityType(opt.value as typeof entityType)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block mb-1 font-medium">關鍵字（公司名稱）</label>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="選填，例如：科技"
          className="border-default border rounded px-3 py-2 w-full"
        />
      </div>

      <div>
        <label className="block mb-1 font-medium">通知頻率</label>
        <div className="flex gap-4">
          {[
            { value: "weekly", label: "每週" },
            { value: "monthly", label: "每月" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="cadence"
                checked={cadence === opt.value}
                onChange={() => setCadence(opt.value as typeof cadence)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="bg-[var(--accent)] text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {submitting ? "儲存中..." : "建立搜尋條件"}
      </button>
    </form>
  );
}
