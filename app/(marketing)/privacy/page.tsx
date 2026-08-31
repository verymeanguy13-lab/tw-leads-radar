export default function PrivacyPage() {
  return (
    <div className="px-8 py-16 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">隱私權政策</h1>
      <p className="text-xs text-secondary mb-8">
        最後更新日期：2026年8月31日（草稿版本，尚未經律師審閱，正式發布前將更新本行）
      </p>

      <div className="border border-default rounded-lg p-4 mb-8 text-sm bg-card">
        ⚠️ 本頁面為草稿，供內部審閱與律師諮詢使用，尚未正式發布。文中標示「⚠️ 待律師確認」之條款為法律風險較高之部分，正式發布前務必經律師審閱。
      </div>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">一、適用範圍</h2>
        <p className="text-sm">
          本政策說明新公司快報（taiwanleads.com，以下稱「本服務」）於提供服務過程中，如何蒐集、處理及利用個人資料，適用於本服務之所有使用者。我們依中華民國個人資料保護法（PDPA）之規定處理個人資料。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">二、我們蒐集的個人資料</h2>
        <p className="text-sm mb-2">我們蒐集以下兩類個人資料：</p>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>
            <span className="font-medium">（一）使用者帳號資料：</span>
            您註冊本服務時提供之電子郵件信箱；如您訂閱付費方案，付款資訊由第三方支付服務商 Paddle 直接蒐集與處理，我們不會接觸您的完整信用卡資訊。
          </li>
          <li>
            <span className="font-medium">（二）公司登記資料中之個人資料：</span>
            本服務所整理之政府公開公司登記資料集中，部分欄位（如公司負責人姓名）屬個人資料。此類資料並非由當事人直接提供予我們，而是來自政府機關依法公開之資料集，說明詳見第四條。
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">三、蒐集之特定目的、期間、地區、對象及方式 <span className="text-xs font-normal">⚠️ 待律師確認</span></h2>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li><span className="font-medium">特定目的：</span>提供本服務之會員管理、帳號驗證、訂閱與金流處理，以及提供公司登記資訊搜尋與通知服務。</li>
          <li><span className="font-medium">期間：</span>帳號存續期間及依法令規定之保存期限，或至您請求刪除為止。</li>
          <li><span className="font-medium">地區：</span>中華民國（台灣）。</li>
          <li><span className="font-medium">對象：</span>我們，以及協助提供服務之第三方服務提供者（詳見第七條）。</li>
          <li><span className="font-medium">方式：</span>以自動化資訊系統蒐集、電子化儲存及處理。</li>
        </ul>
        <p className="text-sm mt-2">
          【第二條（二）所述公司登記資料中之個人資料（如負責人姓名），其蒐集之特定目的與本服務之利用目的（提供第三方查詢、行銷開發用途）是否符合PDPA第五條及相關規定之目的拘束原則，為本服務尚待律師確認之核心法律問題，確認後將於此處補充完整說明。】
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">四、資料來源說明 <span className="text-xs font-normal">⚠️ 待律師確認</span></h2>
        <p className="text-sm mb-2">
          本服務所呈現之公司登記資料，來源為經濟部商業司（GCIS）依政府資訊公開法等相關法令公開之資料集，非由我們自行向當事人蒐集。
        </p>
        <p className="text-sm">
          【此段說明將依律師確認之第三條核心問題結果調整，包括是否需補充告知義務（PDPA第九條）之履行方式，以及本服務已提供之資料下架／移除請求機制（見第九條）作為當事人行使權利之管道。】
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">五、您的權利</h2>
        <p className="text-sm mb-2">
          依個人資料保護法第三條規定，您就我們所持有之您的個人資料，得行使下列權利：
        </p>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>查詢或請求閱覽</li>
          <li>請求製給複製本</li>
          <li>請求補充或更正</li>
          <li>請求停止蒐集、處理或利用</li>
          <li>請求刪除</li>
        </ul>
        <p className="text-sm mt-2">
          如您的公司登記資料出現於本服務中，並希望請求下架，請至
          <a href="/data-removal" className="underline">資料下架申請頁面</a>
          提出申請，我們將於收到申請後進行審核並處理。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">六、資料安全維護</h2>
        <p className="text-sm">
          我們採取合理之技術與管理措施（包括傳輸加密、存取權限控管）保護個人資料，防止其遭未經授權之存取、竄改、洩漏或毀損。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">七、第三方服務提供者</h2>
        <p className="text-sm mb-2">為提供本服務，我們使用以下第三方服務，其可能於提供服務過程中處理相關資料：</p>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li><span className="font-medium">Paddle：</span>處理訂閱付款與帳單。</li>
          <li><span className="font-medium">Resend：</span>寄送帳號驗證信、每週／每日摘要通知信及系統通知信。</li>
          <li><span className="font-medium">Neon（資料庫託管）與 Vercel（網站託管）：</span>儲存與運行本服務所需之資料與應用程式。</li>
        </ul>
        <p className="text-sm mt-2">
          上述服務提供者均僅依我們之指示處理資料，不會將資料用於其自身行銷目的。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">八、資料保存期限</h2>
        <p className="text-sm">
          使用者帳號資料將保存至您刪除帳號或請求刪除為止。公司登記資料之保存期限依政府資料集更新頻率及本服務之各訂閱方案資料新鮮度規則處理。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">九、資料下架與移除請求</h2>
        <p className="text-sm">
          若您是本服務中所呈現公司登記資料之當事人（如公司負責人），並希望您的資料自本服務中下架，可透過
          <a href="/data-removal" className="underline">資料下架申請頁面</a>
          提出申請。我們將審核申請後，將符合條件之資料自公開查詢結果中移除。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">十、政策修改</h2>
        <p className="text-sm">
          我們得不時修改本政策，修改後將於本頁面公告，並更新最上方之最後更新日期。重大變更將另行以電子郵件通知已註冊用戶。
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-2">十一、聯絡我們</h2>
        <p className="text-sm">
          如對本政策或您的個人資料權利有任何疑問，請透過【　　】與我們聯繫。
        </p>
      </section>
    </div>
  );
}
