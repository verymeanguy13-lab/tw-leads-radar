export default function TermsPage() {
  return (
    <div className="px-8 py-16 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">服務條款</h1>
      <p className="text-xs text-secondary mb-8">
        最後更新日期：2026年8月31日（草稿版本，尚未經律師審閱，正式發布前將更新本行）
      </p>

      <div className="border border-default rounded-lg p-4 mb-8 text-sm bg-card">
        ⚠️ 本頁面為草稿，供內部審閱與律師諮詢使用，尚未正式發布。文中標示「⚠️ 待律師確認」之條款為法律風險較高之部分，正式發布前務必經律師審閱。
      </div>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">一、服務說明</h2>
        <p className="text-sm mb-2">
          新公司快報（taiwanleads.com，以下稱「本服務」）由【　　】（以下稱「我們」或「服務提供者」）提供，整理並呈現政府公開之公司登記資訊，協助使用者依設定條件搜尋、追蹤新設立之公司與商業登記資料。
        </p>
        <p className="text-sm">
          本服務所呈現之資料來源為經濟部商業司（GCIS）等政府公開資料集，我們不對資料之正確性、完整性或即時性提供保證，詳見第六條。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">二、帳號</h2>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>使用本服務需註冊帳號，並提供有效之電子郵件信箱。</li>
          <li>您應對帳號及密碼之保密負責，並對透過您帳號進行之所有活動負責。</li>
          <li>若發現帳號遭未經授權使用，請立即通知我們。</li>
          <li>我們保留於合理懷疑帳號濫用、違反本條款，或涉及非法用途時，暫停或終止帳號之權利。</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">三、訂閱方案與付款</h2>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>本服務提供免費方案及付費訂閱方案（方案B、方案C），各方案內容與定價請參閱定價頁面。</li>
          <li>付費訂閱之金流服務由第三方支付服務商 Paddle 處理，您付款時應同意 Paddle 之相關條款。</li>
          <li>付費訂閱採自動續訂制，將於每期屆滿時以您所選週期（月繳／年繳）自動續訂，直至您取消為止。</li>
          <li>訂閱方案得隨時升級或降級，差額將依 Paddle 之比例計算方式處理。</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">四、取消訂閱</h2>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>您可隨時於帳號設定頁面取消訂閱。</li>
          <li>取消後，您仍可使用付費功能至該期已付費之期間屆滿為止，屆滿後帳號將自動轉為免費方案，恕不提供已付費期間之部分退款。</li>
          <li>取消後如欲恢復訂閱，需重新訂閱。</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">五、使用規範</h2>
        <p className="text-sm mb-2">使用本服務時，您同意不進行下列行為：</p>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>以自動化程式（爬蟲、腳本等）大量擷取、重製或再散布本服務所提供之資料。</li>
          <li>將取得之資料用於騷擾、詐欺或其他違反法令之目的。</li>
          <li>轉售、出租或以本服務資料為基礎建立競爭性資料庫或服務，供第三方使用。</li>
          <li>規避本服務之方案限制（如免費方案之資料新鮮度限制）或安全機制。</li>
          <li>若您以本服務所得之公司資料進行行銷聯繫，您應自行確保該行為符合個人資料保護法及相關法規之要求（包括對受聯繫對象提供拒絕行銷之管道），我們不對您使用資料之後續行為負責。</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">六、資料來源與免責聲明 <span className="text-xs font-normal">⚠️ 待律師確認</span></h2>
        <p className="text-sm mb-2">
          本服務所呈現之公司登記資料，來源為政府機關依法公開之資料集（含經濟部商業司網站及每月釋出之公司登記資料集），我們僅進行資料整理、比對與呈現，不負責資料原始內容之正確性。
        </p>
        <p className="text-sm mb-2">
          由於政府資料釋出存在延遲、缺漏或錯誤之可能，我們不保證本服務所呈現資料之即時性、完整性或正確性，亦不保證資料所涉公司之現況（如是否仍營業、負責人是否變更等）。
        </p>
        <p className="text-sm mb-2">
          【本段落涉及本服務之核心資料使用是否符合個人資料保護法「特定目的」與「目的拘束」原則，尚有待律師確認後補充完整說明，並與隱私權政策第四條之說明保持一致。】
        </p>
        <p className="text-sm">
          本服務之運作依賴第三方基礎設施服務，包括但不限於 GitHub（資料擷取排程與程式碼託管）、Neon（資料庫託管）及 Vercel（網站託管）。前述任一服務發生中斷、延遲、資料遺失或其他異常時，可能導致本服務全部或部分功能無法使用、資料更新延遲或暫時無法存取，我們對此類非可歸責於我們之第三方服務中斷不負賠償責任，亦不保證本服務不受中斷影響。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">七、智慧財產權</h2>
        <p className="text-sm">
          本服務之網站設計、程式碼、介面、資料整理與呈現方式，其智慧財產權歸我們所有。政府公開資料本身之權利歸屬依相關法令定之。未經授權，不得重製、修改或散布本服務之網站內容。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">八、責任限制 <span className="text-xs font-normal">⚠️ 待律師確認</span></h2>
        <p className="text-sm mb-2">
          【本條款擬限制我們對於使用本服務所生損害之賠償責任，包括排除間接、附帶或衍生性損害，並將直接損害賠償總額限制於您於求償事由發生前十二個月內已支付之訂閱費用總額。此為初步草擬方向，具體文字、是否符合消費者保護法及定型化契約相關規範，均待律師確認。】
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">九、服務終止</h2>
        <p className="text-sm">
          我們保留於合理通知後修改、暫停或終止本服務全部或部分功能之權利。如屬付費訂閱用戶，我們將依合理方式處理已付費但尚未使用之期間。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">十、準據法與管轄法院 <span className="text-xs font-normal">⚠️ 待律師確認</span></h2>
        <p className="text-sm">
          【本條款預計約定以中華民國法律為準據法，並以【　　】地方法院為第一審管轄法院，惟具體管轄法院之選擇（尤其於服務提供者尚未完成公司登記之情況下）、是否應以消費者住所地法院為優先管轄等，均待律師確認。】
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-lg mb-2">十一、條款修改</h2>
        <p className="text-sm">
          我們得不時修改本條款，修改後將於本頁面公告，並更新最上方之最後更新日期。重大變更將另行以電子郵件通知已註冊用戶。您於條款修改後繼續使用本服務，視為同意經修改之條款。
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-2">十二、聯絡我們</h2>
        <p className="text-sm">
          如對本條款有任何疑問，請透過【　　】與我們聯繫。
        </p>
      </section>
    </div>
  );
}
