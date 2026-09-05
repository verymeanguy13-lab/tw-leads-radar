"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const REGIONS = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

// Real 11-category GCIS industry taxonomy (Session 20b) — confirmed
// against GCIS's own API documentation, where each
// "(測試)營業項目代碼( X類別 )查公司" dataset at data.gcis.nat.gov.tw/od/rule
// names its own letter explicitly. The previous 5-item stub (Session 13)
// had wrong letter-to-label mappings for F, G, I, and J specifically —
// not just an incomplete subset — so saved searches built against it may
// have silently filtered on the wrong category. See Section 11's
// 2026-08-22 update to the industry_codes corrections-log entry.
const INDUSTRY_CODES = [
  { code: "A", label: "農、林、漁、牧業" },
  { code: "B", label: "礦業及土石採取業" },
  { code: "C", label: "製造業" },
  { code: "D", label: "水電燃氣業" },
  { code: "E", label: "營造及工程業" },
  { code: "F", label: "零售、批發及餐飲業" },
  { code: "G", label: "運輸、倉儲及通信業" },
  { code: "H", label: "金融、保險及不動產業" },
  { code: "I", label: "專業、科學及技術服務業" },
  { code: "J", label: "文化、運動、休閒及其他服務業" },
  { code: "Z", label: "其他未分類業" },
];

// 2026-09-05: generalized the "gray out what this tier can't use, with a
// hint to upgrade" treatment that already existed here for the daily
// option (business-only) to every cadence, since free tier's own
// allowed cadence changed from weekly to monthly (see lib/tiers.ts's
// TIER_LIMITS comment for why: Plan B is priced and marketed as the
// *weekly* plan - "方案B｜週報方案", NT$600/月 - so free tier also getting
// weekly for nothing undercut the entire reason to pay for it). Before
// this, only "daily" was ever shown disabled here; "monthly" had no gate
// in this form at all even though free tier couldn't actually use it
// server-side - a free user could pick it, submit, and only then learn
// it was rejected. minTier drives both which options are disabled and
// which hint text shows, from one small table instead of duplicated
// per-option logic.
const TIER_RANK: Record<"free" | "pro" | "business", number> = {
  free: 0,
  pro: 1,
  business: 2,
};

const CADENCE_OPTIONS: {
  value: "monthly" | "weekly" | "daily";
  label: string;
  minTier: "free" | "pro" | "business";
  hint: string;
}[] = [
  { value: "monthly", label: "每月", minTier: "free", hint: "" },
  {
    value: "weekly",
    label: "每週",
    minTier: "pro",
    hint: "僅限方案B（週報方案）以上使用，",
  },
  {
    value: "daily",
    label: "每日",
    minTier: "business",
    hint: "僅限每日方案（Plan C）使用，",
  },
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
  // Default to "monthly", not "weekly" - monthly is now the one cadence
  // every tier can use (see TIER_RANK/CADENCE_OPTIONS above), so it's
  // the only safe default before the tier fetch below resolves.
  const [cadence, setCadence] = useState<"weekly" | "monthly" | "daily">("monthly");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [tier, setTier] = useState<"free" | "pro" | "business" | null>(null);

  useEffect(() => {
    // Best-effort only - if this fails (network blip, not logged in
    // for some reason), the daily option just stays disabled by
    // default (tier === null), which is the safe direction to fail in.
    // The real enforcement is server-side in POST /api/searches
    // regardless of what this returns.
    fetch("/api/user/tier")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.tier) setTier(data.tier);
      })
      .catch(() => {});
  }, []);

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
        <div className="grid grid-cols-3 gap-2">
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
        <p className="text-sm text-secondary mt-2">
          {"新設立公司的行業別分類現已於登記當日更新；少數較舊、尚未完成分類之公司資料，將隨後續資料更新逐步補齊。"}
        </p>
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
        {/* 2026-09-05: free tier's search results and email digests are
            now fully current (the old 30-day freshness gate is gone -
            see lib/matching/engine.ts and architecture.md), so the only
            thing free tier still doesn't get is unmasked identifying
            fields. Told here, not just on /search, since a user could
            otherwise create a saved search from this form without ever
            seeing that banner and be surprised the first digest email
            arrives masked. */}
        {tier === "free" && (
          <p className="text-sm text-secondary mb-2">
            {"免費方案的通知內容將以遮蔽格式顯示（統一編號、公司名稱與負責人姓名部分遮蔽）。升級"}
            <Link href="/pricing" className="underline">
              {"付費方案"}
            </Link>
            {"即可收到完整未遮蔽的通知內容。"}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {CADENCE_OPTIONS.map((opt) => {
            // tier === null means the /api/user/tier fetch above hasn't
            // resolved yet - treat that the same as the most restrictive
            // tier (rank -1, below even "free") rather than assuming
            // access, per this file's existing "safe direction to fail"
            // comment on that fetch.
            const currentRank = tier ? TIER_RANK[tier] : -1;
            const disabled = currentRank < TIER_RANK[opt.minTier];
            return (
              <div key={opt.value} className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="cadence"
                    checked={cadence === opt.value}
                    disabled={disabled}
                    onChange={() => setCadence(opt.value)}
                  />
                  {opt.label}
                </label>
                {disabled && (
                  <span className="text-xs text-secondary">
                    {opt.hint}
                    <Link href="/pricing" className="underline">
                      查看方案
                    </Link>
                  </span>
                )}
              </div>
            );
          })}
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