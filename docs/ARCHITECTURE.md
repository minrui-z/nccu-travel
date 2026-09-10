# 架構與來源

這是一個 React 19 / Vite 8 純靜態網站。網站執行時只讀取自己的靜態檔案；使用者草稿留在 IndexedDB。沒有遠端計算、資料庫或匯出服務。

## 主要依據

- 政大 115 年國外出差旅費報支重點檢查表（來源 PDF 隨公開資料保存）。
- 國外出差旅費報支要點：https://law.dgbas.gov.tw/LawContent.aspx?id=FL017584
- 政大旅運費表單：https://acc.nccu.edu.tw/content/旅運費

## 工程參考

- React root：https://react.dev/reference/react-dom/client/createRoot
- React state：https://react.dev/reference/react/useState
- IndexedDB：https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- Web Worker：https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- Vite 相對路徑：https://vite.dev/guide/build.html#relative-base
- GitHub Pages：https://vite.dev/guide/static-deploy.html#github-pages
- CFB 公開讀寫 API：https://github.com/SheetJS/js-cfb
- BIFF8 格式：https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/

## 數值處理

原始金額使用十進位字串。以整數及十進位位數進行精確計算；進位只發生在各費目換算臺幣後的合計，最後再加總費目。畫面日期分組不改變逐日計算。

本校檢查表未說明進位順序，日支表尾數附註的幣別及取整階段仍待確認，算例本身不足以判別；目前依使用者選擇暫按範例四捨五入。日期合併保留完整逐日資料；介面與檔名不另加狀態標記。

## 公開邊界

公開專案包含空白模板和公開規則；不包含外層已填寫範例。測試資料須為匿名示例。靜態資料更新腳本只取得公開資料，從不處理使用者草稿。

## 產品流程與草稿儲存

`app/page.tsx` 將一般工作台分為基本資料、行程與生活費、費用、檢查與下載四步。表單可往返，費用清單一次展開一筆；錯誤導覽以完整欄位 path 選取日期、展開費用與相關匯率欄位，不依顯示名稱猜測目標。必填狀態、輸入模式及儲存狀態也以明確屬性／狀態值處理。

`?example=general`／`?example=student` 直接載入 `app/example-page.tsx`，不掛載工作台的 `useDraft`。範例只展示 `lib/public-example.ts` 的虛構資料，不讀寫 IndexedDB，不提供編輯或下載；查看範例不走草稿取代流程。

`app/use-draft.ts` 保存 `active-draft` 與單一 `previous-draft`。重新填寫及恢復皆先驗證、正規化，再於同一 IndexedDB 寫入交易保存新舊內容；交易成功才更新畫面。失敗保留目前草稿，不回報成功。恢復後仍保留被取代的版本，不是無限歷史。舊草稿無法解析時暫停自動儲存；儲存狀態用 `SaveStatus` 列舉，並防止較早的非同步結果改寫新狀態。

## 程式檢查設定

此專案是 Vite SPA，未使用 Next.js 或 React Compiler，檢查設定已移除不適用的 Next.js／Compiler 規則。保留 Hooks、型別與可及性檢查；標準 ARIA status／SVG img 不強制改為其他標籤。隨起始專案提供的 components/ui 元件單獨保留，不納入應用程式 lint。測試檔允許故意損壞資料型別以驗證草稿解析；XLS 匯出器的控制字元規則是刻意拒絕無效內容。

## 起迄路線與日支額地區

每日資料可包含 `transit`：起點、迄點及各自的選單識別碼。起迄地點組合到原表地點欄，改動不改日支額。日支額適用地區仍由 `destinationIds` 查官方季節資料；此查表在交通工具歇夜及返國日不改寫路線。國內起點依原範例使用臺北等城市名稱，國外使用國家及城市，選單仍完整保留國家。

地點選單按國家精確過濾城市，支援中英文搜尋；切換國家清空舊城市。臺灣選項僅作路線使用，沒有國外生活費額度。舊版完整路線可讀成起迄文字；只有單一城市的歇夜資料保留原文並要求補足起迄，不猜測遺漏起點。批次地點複製僅套用其他一般公差日，保留各交通與返國日。

`lib/trip-locations.ts` 處理狀態切換：改回一般出差時清除隱藏的舊路線；航程供餐與應扣免費餐食分開處理。批次套用已選官方城市必須載入日支額資料，按目標日期重新查價，不以來源日的金額跨季節代填。

國家／城市選單、文字欄與前端草稿仍全部在瀏覽器操作，不新增後台。

## 日期欄編輯

`lib/trip-groups.ts` 以日期欄為編輯單位。對任一成員的地點、工作記要、日支額及膳宿條件進行修改時，整欄各日同步更新，保留原分組識別碼。批次更新先檢查整組相容性再提交；遇到跨季節日支額等差異時保留原資料，要求先明確拆開，不自行拆組或套用錯誤日支額。

`app/trip-form.tsx` 將待套用日期與已提交行程分開，`lib/trip-flow.ts` 的 `prepareTripDates` 先驗證再一次套用。縮短日期須確認移除範圍，受影響費用完整保留並標示日期問題。保留範圍內原有日期的分組；新增日期從獨立欄位開始。合併模式與內容編輯分開，復原合併只還原分組並保留內容編輯。合併、拆開與逐日金額計算分開處理，不因畫面分組提早取整。

## 行程狀態與匯率日期

依使用者要求，生活費與費用日期資格僅依明確選取的當日狀態判斷；週末旗標及舊核准起訖日期不再排除日期。雜費日數納入所有非私人行程日，日期合併也不比較週末申請狀態。這是本工具的產品設定，不能據此宣稱官方取消例假日或公差申請要求。

舊草稿的 `weekendOfficial`、`approvedStart` 與 `approvedEnd` 保留讀取相容性。`fxDepartureDate(draft)` 使用有效的 `approvedStart` 作為匯率基準，空白或無效時回退到實際出發日；介面名稱為「匯率基準出發日」。它僅用於銀行報價與出發前 15 日至返國日的結匯證明區間，不作行程資格門檻。銀行未報價日仍依原匯率規則處理，特定經費、行政費及艙等條件保留。

私人行程經 `normalizePrivateDays` 清空日支額、膳宿、扣款等請領資料，工作記要固定為「個人行程」，地點可選填；此處理也用於舊草稿恢復及合併欄共同修改。切回出差日保留地點，須重新填工作記要與日支額。計算保留逐日日期及不請領狀態，對應原表的請領格寫為 BIFF 原生空白，不寫零值或「無免費供餐」；地點及工作記要依前述規則列示。

匯率公開資料涵蓋 2025-01-02 至 2026-09-08 的 414 個報價日、19 種幣別；瀏覽器只讀取所需日期的靜態檔案。變更貨幣、來源或適用日期時，清除不再適用的報價與證明。`lib/draft-transitions.ts` 在匯率基準日改變時撤銷舊銀行報價，在行程日期改變時撤銷保費上限確認；有效結匯證明另按其適用期間處理。

## 匯率所有權與錯誤邊界

生活費 `fx.provenance` 與每筆費用 `fxProvenance` 採 `automatic | manual | imported`，與財務依據的 `source` 分開。`lib/fx-provenance.ts` 集中遷移舊草稿：已有數值但無 metadata 時保守視為手動，舊 CSV 證明前綴僅在此遷移為 imported；不改金額、日期或證明。正常自動填入不再用證明文案判斷來源。

手動及匯入資料受保護，手動清空值仍保護；條件切換時明確撤銷不適用的資料及 metadata。`lib/expense-state.ts` 比對完整查詢前後條件，拒絕過期回應，生活費與各筆費用保持獨立。只有資料空白且來源、日期均適用時自動取得對應快照；不得用最近快照替代缺漏日期。

`lib/report-errors.ts` 以 `ReportErrorCode` 將資料、容量、模板、檔案及逾時失敗轉成介面說明；Worker 回傳錯誤種類，畫面不直接展示內部例外。`lib/fx-errors.ts` 區分刻意提供的 `FxInputError` 與解析診斷，將 CSV 日期、驗證頁及格式問題轉成可操作的訊息。計算驗證仍保留規則代碼及欄位 path，用於定位與報帳依據；技術診斷不作產品文案。

## 模板選擇

網站發布 25 份原生 XLS：兩種表格各 1–12 欄共 24 組日期變體，以及 `student-7-private`。一般 6 欄與原學生 7 欄基準不改。僅學生表分為 7 欄且含私人行程時，選用補充版，把工作記要 C14:M14 按日期欄分開；其餘合併、字型定義、列高欄寬、簽章及列印設定保留，避免共享工作文字污染私人欄。

補充版由 `scripts/build-student-private-template.ts` 從原學生 7 欄模板離線產生，隨網站提供 XLS 與一致的雜湊描述。`npm run test:build` 對正式 Worker 執行 32 個匯出情境，包含私人行程及補充模板。

## 文字適配

`lib/xls/text-fitting.ts` 產生預覽與 Worker 共用的文字、模板描述及格式異動。只對允許填寫的欄位嘗試換行與縮小字級，最低 8pt；保持原表幾何及原字型名稱。原 XLS 中以新增 FONT／XF 副本套用結果，原有字型、樣式及非修改內容保留。完整流程見 [XLS 維護說明](XLS.md)。

## 介面設計工具

已執行 `npx impeccable install`，專案指引位於 `.github/skills/impeccable`。它用於開發時的設計與檢視，不是網站執行依賴；填表與匯出仍完全在瀏覽器內完成。操作原則見 [介面說明](UI.md)。
